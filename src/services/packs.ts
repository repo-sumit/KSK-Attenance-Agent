/**
 * BatchPackService — offline batch packs (PRD §20.1–20.3). Download scope is
 * derived from the same mapping as online marking, so the offline section can
 * never expose a batch the user could not mark online (INV-25).
 *
 * Refresh: all packs at once (PRD §20.3), or one batch from its card or its
 * Offline data row (extension, D-055). A refresh only re-downloads the roster;
 * drafts and records waiting to sync are never touched.
 */
import { parseSessionKey } from '@/domain/attendance';
import { isPackStale, type BatchPack } from '@/domain/device';
import type { Batch, Trade } from '@/domain/entities';
import { err, ok, type Result } from '@/lib/result';
import type { BatchPackRepository, MasterDataRepository, OfflineQueueRepository } from '@/repositories/interfaces';
import type { ConnectivityService } from './connectivity';
import type { SessionContext } from './context';
import { REJECTED } from './sync';

export interface PackRow {
  readonly batch: Batch;
  readonly trade: Trade;
  readonly pack: BatchPack;
  readonly stale: boolean;
  /** This batch's records locked on the phone and not yet synced. */
  readonly pendingSync: number;
  /** This batch's records the server refused for good (someone else submitted the session first): never sent again. */
  readonly rejected: number;
}

type Delay = (ms: number) => Promise<void>;
const noDelay: Delay = () => Promise.resolve();

export class BatchPackService {
  constructor(
    private readonly packs: BatchPackRepository,
    private readonly connectivity: ConnectivityService,
    private readonly queue?: OfflineQueueRepository,
    /** Simulated download time, so "Refreshing…" is seen (0 in tests). */
    private readonly delay: Delay = noDelay,
    /** Where a pack's roster comes from. The API build stores it in the pack; the mock serves it from master data. */
    private readonly rosters?: Pick<MasterDataRepository, 'getBatchRoster'>,
  ) {}

  /** Pulls each batch's current roster (the network part of a download or refresh). */
  private async pull(ctx: SessionContext, batchIds: readonly string[]): Promise<void> {
    // Believable, never a fake wait: about 0.9 s for one batch, at most 1.5 s for many.
    await this.delay(Math.min(600 + 300 * batchIds.length, 1500));
    await Promise.all(batchIds.map((id) => this.rosters?.getBatchRoster(ctx.institute.id, id)));
  }

  /** Only a batch this user can mark online, and only while they may hold packs at all (D-153, INV-25). */
  private inScope(ctx: SessionContext, batchId: string): boolean {
    return ctx.journey.offline.packs && ctx.access.batchIds.has(batchId);
  }

  /** Changing what is on the phone needs packs for this user (hiding the screen is never the only guard). */
  private mayChange(ctx: SessionContext): boolean {
    return ctx.journey.offline.packs;
  }

  /** Downloaded batches with their sync state: what is on this phone (getDownloadedBatches). */
  async list(ctx: SessionContext): Promise<PackRow[]> {
    const now = ctx.clock.now();
    const packs = await this.packs.list();
    const pending = new Map<string, number>();
    const rejected = new Map<string, number>();
    for (const item of (await this.queue?.list()) ?? []) {
      if (item.kind !== 'attendance_submission') continue;
      const batchId = parseSessionKey(item.label)?.batchId;
      const tally = item.lastError === REJECTED ? rejected : pending;
      if (batchId) tally.set(batchId, (tally.get(batchId) ?? 0) + 1);
    }
    return packs
      .filter((p) => this.inScope(ctx, p.batchId))
      .flatMap((pack) => {
        const batch = ctx.data.batches.find((b) => b.id === pack.batchId);
        const trade = batch && ctx.data.trades.find((t) => t.id === batch.tradeId);
        return batch && trade ? [{ batch, trade, pack, stale: isPackStale(pack, now, ctx.config.offline.refreshDays), pendingSync: pending.get(batch.id) ?? 0, rejected: rejected.get(batch.id) ?? 0 }] : [];
      })
      .sort((a, b) => a.trade.name.localeCompare(b.trade.name) || a.batch.shift - b.batch.shift || a.batch.unit - b.batch.unit);
  }

  /** Batches the user may download, i.e. exactly the ones they can reach online. */
  downloadable(ctx: SessionContext): Batch[] {
    return ctx.data.batches.filter((b) => this.inScope(ctx, b.id));
  }

  async download(ctx: SessionContext, batchIds: readonly string[]): Promise<Result<number, 'offline' | 'no_access' | 'too_many'>> {
    if (!this.connectivity.isOnline()) return err('offline');
    if (!this.mayChange(ctx) || batchIds.some((id) => !this.inScope(ctx, id))) return err('no_access');
    const max = ctx.config.offline.maxBatches;
    const existing = (await this.packs.list()).filter((p) => this.inScope(ctx, p.batchId)).map((p) => p.batchId);
    if (max !== null && new Set([...existing, ...batchIds]).size > max) return err('too_many');
    await this.pull(ctx, batchIds);
    const at = ctx.clock.now().toISOString();
    await this.packs.upsert(batchIds.map((batchId) => ({ batchId, downloadedAt: at })));
    return ok(batchIds.length);
  }

  /** Manual refresh pulls current data for every pack held (PRD §20.3). */
  async refreshAll(ctx: SessionContext): Promise<Result<number, 'offline' | 'no_access'>> {
    if (!this.connectivity.isOnline()) return err('offline');
    if (!this.mayChange(ctx)) return err('no_access');
    const rows = await this.list(ctx);
    await this.pull(ctx, rows.map((r) => r.batch.id));
    const at = ctx.clock.now().toISOString();
    await this.packs.upsert(rows.map((r) => ({ batchId: r.batch.id, downloadedAt: at })));
    return ok(rows.length);
  }

  /** Re-downloads one batch's roster (refreshBatchData, D-055). Only a batch already on the phone. */
  async refreshBatch(ctx: SessionContext, batchId: string): Promise<Result<BatchPack, 'offline' | 'no_access' | 'not_downloaded'>> {
    if (!this.connectivity.isOnline()) return err('offline');
    if (!this.mayChange(ctx) || !this.inScope(ctx, batchId)) return err('no_access');
    if (!(await this.packs.list()).some((p) => p.batchId === batchId)) return err('not_downloaded');
    await this.pull(ctx, [batchId]);
    const pack = { batchId, downloadedAt: ctx.clock.now().toISOString() };
    await this.packs.upsert([pack]);
    return ok(pack);
  }
}

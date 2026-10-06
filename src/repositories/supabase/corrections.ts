/**
 * Corrections on Supabase (D-143), append-only. A correction is appended on the device and sent to the server right
 * away when online, otherwise kept in a small outbox on the device. The outbox drains after an append, on reconnect,
 * after its submission synced, at app start and from Sync now (SyncService, Task 17), and counts as waiting to sync.
 *
 * One order on every device (Task 17): the server numbers corrections as they arrive (`seq`, GENERATED ALWAYS), and
 * every synced correction sorts by (timestamp, seq, correctionId); only the corrections still in this device's
 * outbox come after them. `effectiveMarks()` breaks equal timestamps (a frozen demo clock) by that list position.
 *
 * Fix round 1: a correction is put in the outbox before the device database, and only a correction this device has
 * seen on the server (delivered, or in a live read) can later be dropped as gone (a shared reset). A correction the
 * server can never take (23503: its submission is neither on the server nor waiting on this device, for example
 * after a shared reset elsewhere) is refused like a rejected record: kept in a refused list, never retried, not
 * counted as waiting, and no longer applied on this device.
 *
 * Fix round 2: an append whose device write fails takes its correction out of the outbox again, so nothing is sent.
 */
import { awaitsSync, type Correction } from '@/domain/attendance';
import { compareDates, type LocalDate } from '@/lib/time';
import type { CorrectionRepository } from '../interfaces';
import { MockCorrectionRepository } from '../mock/repositories';
import { FOREIGN_KEY_VIOLATION, UNIQUE_VIOLATION } from './data-client';
import { inScope, scoped, selectMapped, type SupabaseContext } from './context';
import { correctionToRow, rowToCorrection, type SequencedCorrection } from './mappers';

export const CORRECTIONS_CACHE = 'corr:';
const OUTBOX = 'outbox:corrections';
/** Corrections the server refused for good (their submission is gone): surfaced, never sent again. */
const REFUSED = 'refused:corrections';
/** Ids of this device's corrections the server has had (delivered, or in a live read): only these can be gone. */
const SEEN = 'seen:corrections';

/** No seq (a copy only this device has seen) sorts after every numbered one at the same instant. */
const bySeq = (a: SequencedCorrection, b: SequencedCorrection) => (a.seq === b.seq ? 0 : a.seq === undefined ? 1 : b.seq === undefined ? -1 : a.seq - b.seq);
const serverOrder = (a: SequencedCorrection, b: SequencedCorrection) => a.timestamp.localeCompare(b.timestamp) || bySeq(a, b) || a.correctionId.localeCompare(b.correctionId);
const withoutSeq = ({ seq: _seq, ...correction }: SequencedCorrection): Correction => correction;

export class SupabaseCorrectionRepository implements CorrectionRepository {
  private readonly device: MockCorrectionRepository;
  private flushing: Promise<void> | null = null;
  /** A flush was asked for while one was running: run once more when it ends. */
  private again = false;

  constructor(private readonly ctx: SupabaseContext) {
    this.device = new MockCorrectionRepository(ctx.db);
  }

  /**
   * The outbox first: it is what sends the correction, so the device copy never exists without a way to the server.
   * When the device write then fails (storage full), the correction leaves the outbox again before the error reaches
   * the screen (fix round 2): a failed append leaves nothing behind, so a retry cannot send two corrections.
   */
  async append(correction: Correction) {
    this.setOutbox([...this.outbox(), correction]);
    try {
      await this.device.append(correction);
    } catch (error) {
      this.setOutbox(this.outbox().filter((c) => c.correctionId !== correction.correctionId));
      throw error;
    }
    await this.flush();
  }

  /** Corrections the server refused for good (their submission is no longer on the server): kept to be surfaced. */
  refused(): readonly Correction[] {
    return this.ctx.store.get<Correction[]>(REFUSED) ?? [];
  }

  /** Corrections on this device that have not reached the server yet. */
  pendingCount(): number {
    return this.outbox().length;
  }

  /** The same corrections for the waiting list, in send order: id, the student's id and when (D-153). */
  pendingItems(): Array<{ id: string; label: string; at: string }> {
    return this.outbox().map((c) => ({ id: c.correctionId, label: c.studentId, at: c.timestamp }));
  }

  /**
   * Sends waiting corrections in order. A correction whose submission is still waiting on this device (23503) waits
   * for it; one whose submission is nowhere is refused. A call during a running flush is not lost: that flush runs
   * again before it settles.
   */
  flush(): Promise<void> {
    if (!this.outbox().length) return Promise.resolve();
    if (this.flushing) {
      this.again = true;
      return this.flushing;
    }
    this.flushing = (async () => {
      do {
        this.again = false;
        await this.push();
      } while (this.again && this.outbox().length);
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  /** One pass in outbox order, re-reading the outbox after each send so a correction added meanwhile goes too. */
  private async push(): Promise<void> {
    const tried = new Set<string>();
    for (;;) {
      const correction = this.outbox().find((c) => !tried.has(c.correctionId));
      if (!correction) return;
      tried.add(correction.correctionId);
      const result = await this.ctx.client.insert('corrections', correctionToRow(correction));
      const delivered = result.ok || (result.error.kind === 'server' && result.error.code === UNIQUE_VIOLATION);
      if (delivered) {
        this.seen([correction.correctionId]);
        this.setOutbox(this.outbox().filter((c) => c.correctionId !== correction.correctionId));
        this.ctx.cache.invalidate(CORRECTIONS_CACHE);
      } else if (result.error.kind === 'network') {
        return;
      } else if (result.error.code === FOREIGN_KEY_VIOLATION && !this.submissionWaiting(correction.attendanceId)) {
        this.refuse(correction);
      }
    }
  }

  /** Its submission is still on its way from this device: the correction can follow it. */
  private submissionWaiting(attendanceId: string): boolean {
    return Object.values(this.ctx.db.read('submissions')).some((s) => s.id === attendanceId && awaitsSync(s));
  }

  /** Never sent again and no longer applied here (no other device can see it); kept in the refused list. */
  private refuse(correction: Correction): void {
    this.trySet(REFUSED, [...this.refused().filter((c) => c.correctionId !== correction.correctionId), correction]);
    this.setOutbox(this.outbox().filter((c) => c.correctionId !== correction.correctionId));
    this.ctx.db.update('corrections', (all) => all.filter((c) => c.correctionId !== correction.correctionId), 'corrections', 'attendance');
  }

  private seenIds(): Set<string> {
    return new Set(this.ctx.store.get<string[]>(SEEN) ?? []);
  }

  private seen(ids: readonly string[], forget: readonly string[] = []): void {
    const all = this.seenIds();
    const before = all.size;
    for (const id of ids) all.add(id);
    for (const id of forget) all.delete(id);
    if (all.size !== before || forget.length) this.trySet(SEEN, [...all]);
  }

  private trySet(key: string, value: unknown): void {
    try {
      this.ctx.store.set(key, value);
    } catch {
      // Device storage is full: nothing else to do here; the next change tries again.
    }
  }

  private outbox(): Correction[] {
    return this.ctx.store.get<Correction[]>(OUTBOX) ?? [];
  }

  private setOutbox(items: readonly Correction[]): void {
    // Device storage full: the correction is not appended to the device database either way round it fails; one
    // already there stays (never seen on the server, so never dropped) and shows on this phone.
    this.trySet(OUTBOX, items);
    // The sync status counts the outbox: screens showing it read it again.
    this.ctx.bus.emit('offline');
  }

  /**
   * The institute's corrections (an audit log: small, append-only) in the one order every device shares, then this
   * device's outbox. This device's own corrections (scoped to the signed-in institute's staff) that a live read no
   * longer has are dropped, but only those the server had before (a shared reset); one never seen there stays, after
   * the server's at the same instant, as it does while the answer is the device copy.
   */
  private async all(): Promise<Correction[]> {
    const scope = scoped(this.ctx);
    const read = await this.ctx.cache.readLive(
      `${CORRECTIONS_CACHE}${scope.key}`,
      () => selectMapped(this.ctx.client, { table: 'corrections', order: 'correction_id', filters: scope.filters }, rowToCorrection),
      [] as SequencedCorrection[],
    );
    const onServer = new Set(read.value.map((c) => c.correctionId));
    const waiting = this.outbox().filter((c) => !onServer.has(c.correctionId));
    const outboxIds = new Set(waiting.map((c) => c.correctionId));
    const mine = await inScope(this.ctx, this.ctx.db.read('corrections'), (members, c) => members.staffIds.has(c.actorId));
    if (read.live) this.seen(mine.records.filter((c) => onServer.has(c.correctionId)).map((c) => c.correctionId));
    const seenIds = this.seenIds();
    const unseen = mine.records.filter((c) => !onServer.has(c.correctionId) && !outboxIds.has(c.correctionId));
    const gone = read.live && mine.prunable ? unseen.filter((c) => seenIds.has(c.correctionId)) : [];
    if (gone.length) {
      const ids = new Set(gone.map((c) => c.correctionId));
      this.ctx.db.update('corrections', (all) => all.filter((c) => !ids.has(c.correctionId)), 'corrections', 'attendance');
      this.seen([], [...ids]);
    }
    const kept = unseen.filter((c) => !gone.includes(c));
    const synced = [...read.value, ...kept].sort(serverOrder).map(withoutSeq);
    return [...synced, ...waiting.map((c) => ({ ...c }))];
  }

  async listForAttendance(attendanceIds: readonly string[]) {
    const ids = new Set(attendanceIds);
    return (await this.all()).filter((c) => ids.has(c.attendanceId));
  }

  async listBetween(from: LocalDate, to: LocalDate) {
    return (await this.all()).filter((c) => {
      const day = c.timestamp.slice(0, 10);
      return compareDates(from, day) <= 0 && compareDates(day, to) <= 0;
    });
  }
}

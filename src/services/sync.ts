/**
 * SyncService — pushes locally locked records to the server (PRD §20.5).
 * States: idle (nothing pending) · pending · syncing · synced · failed, plus
 * online/offline from connectivity. Triggers: automatic on reconnect, on app
 * start when online, after a record is queued and before opening another
 * batch; manual "Sync now". The last failed attempt (when, and whether it was
 * automatic) is kept until an attempt succeeds or nothing is left to sync
 * (also when the outbox drains on its own), so Home can say "Auto-sync
 * failed at 10:42 AM" (D-064). A record stays locked on the device whether or
 * not it has synced (INV-03). A record the server refuses for good (`rejected`:
 * someone else submitted that session first) is marked so, keeps its queue item
 * with the error for a later notice, and is not pushed or counted again.
 * An `outbox` (the Supabase source's correction outbox, Task 17) counts as waiting
 * too and is drained at app start, on reconnect (also with auto-sync off, as
 * corrections always were) and by every sync, Sync now included. A correction
 * the server refuses for good leaves the outbox (like a rejected record) and
 * no longer counts.
 */
import type { OfflineQueueItem } from '@/domain/attendance';
import type { EventBus } from '@/lib/events';
import type { Clock } from '@/lib/time';
import type { AttendanceRepository, OfflineQueueRepository, StaffAttendanceRepository, SyncGateway } from '@/repositories/interfaces';
import type { ConnectivityService } from './connectivity';

export type SyncPhase = 'idle' | 'pending' | 'syncing' | 'synced' | 'failed';

/** Who started an attempt: the app on its own (auto-sync) or the person ("Sync now"). */
export type SyncTrigger = 'auto' | 'manual';

/** The queue item's `lastError` for a record the server refused for good. */
export const REJECTED = 'rejected';

type PushOutcome = 'ok' | 'network' | 'rejected';

/** Still worth pushing: everything except what the server refused for good. */
const retriable = (items: readonly OfflineQueueItem[]) => items.filter((item) => item.lastError !== REJECTED);

export interface SyncAttempt {
  /** ISO time the attempt ended. */
  readonly at: string;
  readonly trigger: SyncTrigger;
}

export interface SyncStatus {
  readonly phase: SyncPhase;
  readonly online: boolean;
  readonly pending: number;
  /** The last attempt that failed, until an attempt succeeds (or nothing is left to sync). */
  readonly lastFailure: SyncAttempt | null;
}

/** Records sent by another channel than the queue (the correction outbox): counted as pending, drained by a sync. */
export interface SyncOutbox {
  pendingCount(): number;
  /** Sends what is waiting; resolves when the attempt ends (what could not be sent stays counted). */
  flush(): Promise<void>;
}

export interface SyncDeps {
  readonly queue: OfflineQueueRepository;
  readonly attendance: AttendanceRepository;
  readonly staff: StaffAttendanceRepository;
  readonly gateway: SyncGateway;
  readonly connectivity: ConnectivityService;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly autoSync: () => boolean;
  /** How long the "All attendance synced" confirmation stays before returning to idle. */
  readonly confirmationMs: () => number;
  readonly outbox?: SyncOutbox;
}

export class SyncService {
  private phase: SyncPhase = 'idle';
  /** Queue items still worth pushing (the outbox is counted live on top: `pending()`). */
  private pendingCount = 0;
  private lastFailure: SyncAttempt | null = null;
  private running: Promise<SyncStatus> | null = null;
  private confirmTimer: ReturnType<typeof setTimeout> | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(private readonly deps: SyncDeps) {}

  /** Starts listening for connectivity changes (auto-sync trigger). */
  start(): void {
    this.unsubscribe?.();
    this.unsubscribe = this.deps.connectivity.subscribe((online) => {
      this.emit();
      if (online) this.automatic();
    });
    // Records left in the queue (or the outbox) by an earlier visit go out as soon as the app opens online.
    void this.refreshCount().then(() => {
      if (this.pending() > 0 && this.deps.connectivity.isOnline()) this.automatic();
    });
  }

  /** What the app sends on its own: everything with auto-sync on; without it, only the outbox (corrections always went). */
  private automatic(): void {
    if (this.deps.autoSync()) void this.syncNow('auto');
    else if (this.outboxCount() > 0) void this.deps.outbox?.flush().then(() => this.emit());
  }

  /**
   * Nothing is left to sync, but the last attempt failed: the outbox drained without a sync (its own flush after an
   * append, or the automatic flush with auto-sync off). The failure no longer applies (fix round 1).
   */
  private settleDrained(): void {
    if (this.phase === 'failed' && this.pending() === 0) {
      this.phase = 'idle';
      this.lastFailure = null;
    }
  }

  /** Records waiting in the outbox (the Supabase source's corrections); 0 without one. */
  outboxCount(): number {
    return this.deps.outbox?.pendingCount() ?? 0;
  }

  private pending(): number {
    return this.pendingCount + this.outboxCount();
  }

  stop(): void {
    this.unsubscribe?.();
    clearTimeout(this.confirmTimer);
  }

  status(): SyncStatus {
    // The outbox changes outside a sync (and says so with `offline`, which makes screens read this again).
    this.settleDrained();
    const pending = this.pending();
    // The outbox changes outside a sync (a correction made offline): an idle phase follows its count.
    const phase = this.phase === 'idle' && pending > 0 ? 'pending' : this.phase === 'pending' && pending === 0 ? 'idle' : this.phase;
    return { phase, online: this.deps.connectivity.isOnline(), pending, lastFailure: this.lastFailure };
  }

  async pendingItems(): Promise<OfflineQueueItem[]> {
    return retriable(await this.deps.queue.list());
  }

  /** Called after a record is locked locally. */
  request(): void {
    void this.refreshCount().then(() => {
      if (this.deps.connectivity.isOnline() && this.deps.autoSync()) void this.syncNow('auto');
    });
  }

  /** Clears transient state after Reset Demo. */
  async reset(): Promise<void> {
    clearTimeout(this.confirmTimer);
    this.phase = 'idle';
    this.lastFailure = null;
    await this.refreshCount();
  }

  private emit() {
    this.deps.bus.emit('offline');
  }

  private async refreshCount() {
    this.pendingCount = retriable(await this.deps.queue.list()).length;
    this.settleDrained();
    if (this.phase === 'idle' && this.pending() > 0) this.phase = 'pending';
    if (this.phase === 'pending' && this.pending() === 0) this.phase = 'idle';
    this.emit();
  }

  /** Pushes everything waiting. `trigger` says who asked: automatic triggers pass 'auto'; a person's tap is 'manual'. */
  syncNow(trigger: SyncTrigger = 'manual'): Promise<SyncStatus> {
    this.running ??= this.run(trigger).finally(() => {
      this.running = null;
    });
    return this.running;
  }

  private async run(trigger: SyncTrigger): Promise<SyncStatus> {
    const items = retriable(await this.deps.queue.list());
    this.pendingCount = items.length;
    if (!items.length && this.outboxCount() === 0) {
      this.phase = 'idle';
      this.lastFailure = null;
      this.emit();
      return this.status();
    }
    if (!this.deps.connectivity.isOnline()) {
      this.phase = 'pending';
      this.emit();
      return this.status();
    }
    clearTimeout(this.confirmTimer);
    this.phase = 'syncing';
    this.emit();
    let failed = false;
    for (const item of items) {
      const outcome = await this.pushOne(item);
      if (outcome === 'ok') await this.deps.queue.remove([item.id]);
      else {
        // A network failure is tried again on the next trigger; a refusal is final and only waits to be surfaced.
        failed ||= outcome === 'network';
        await this.deps.queue.update({ ...item, attempts: item.attempts + 1, lastError: outcome });
      }
    }
    // After the records, so a correction whose submission just reached the server can follow it.
    if (this.deps.outbox) {
      await this.deps.outbox.flush();
      failed ||= this.outboxCount() > 0;
    }
    this.pendingCount = retriable(await this.deps.queue.list()).length;
    this.phase = failed ? 'failed' : 'synced';
    this.lastFailure = failed ? { at: this.deps.clock.now().toISOString(), trigger } : null;
    this.emit();
    if (!failed) {
      this.confirmTimer = setTimeout(() => {
        this.phase = this.pending() ? 'pending' : 'idle';
        this.emit();
      }, this.deps.confirmationMs());
    }
    return this.status();
  }

  private async pushOne(item: OfflineQueueItem): Promise<PushOutcome> {
    if (item.kind === 'attendance_submission') {
      const submission = await this.deps.attendance.getSubmissionById(item.recordId);
      if (!submission) return 'ok'; // nothing left to push
      const result = await this.deps.gateway.pushSubmission(submission);
      if (result.ok) await this.deps.attendance.markSubmissionSynced(submission.id, result.value.serverTimestamp);
      else if (result.error === 'rejected') await this.deps.attendance.markSubmissionRejected(submission.id);
      return result.ok ? 'ok' : result.error;
    }
    const record = await this.deps.staff.getById(item.recordId);
    if (!record) return 'ok';
    const result = await this.deps.gateway.pushStaffRecord(record);
    if (result.ok) await this.deps.staff.markSynced(record.id);
    else if (result.error === 'rejected') await this.deps.staff.markRejected(record.id);
    return result.ok ? 'ok' : result.error;
  }
}

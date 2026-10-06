/**
 * The mock "database": typed collections over a KeyValueStore, seeded from
 * data/mock relative to today. Every mock repository reads and writes through
 * this. Reset Demo = `reset()`; a new calendar day reseeds automatically so
 * "today" in the demo always means today (keeping what has not reached Supabase yet, in that mode, and the
 * device's own packs and face flags). A demo Data switch keeps the unsynced records and the sync queue.
 *
 * Packs on the Supabase source (Task 17 fix round 1): an explicit demo action writes the story's packs exactly as
 * the device source has them (a fresh device's first seed, Reset, and a preset through `restoreStoryPacks`); only
 * the automatic reseeds (a new day, a schema bump) keep the device's real packs and write no story packs. The first
 * seed brings them only when the demo boot path asks (`demoStoryPacks`, fix round 2): a demo-off build on Supabase
 * starts with no packs, so a new phone never claims a batch is downloaded that it never downloaded.
 */
import type { AttendanceDraft, AttendanceSubmission, Correction, OfflineQueueItem, StaffAttendanceRecord } from '@/domain/attendance';
import type { BatchPack, FaceEnrolment } from '@/domain/device';
import type { EventBus, DataTopic } from '@/lib/events';
import type { KeyValueStore } from '@/lib/kv-store';
import { toLocalDate, type Clock, type LocalDate } from '@/lib/time';
import { buildSeed } from '@/data/mock/seeds';
import type { StoredSession, VerificationPass } from '../interfaces';

/** Bump when the stored shape changes, so old demo state is discarded instead of misread. */
const SCHEMA_VERSION = 3; // 3: today's seeded submissions come from self-marked submitters (U2)

export interface Collections {
  submissions: Record<string, AttendanceSubmission>;
  drafts: Record<string, AttendanceDraft>;
  corrections: Correction[];
  staff: Record<string, StaffAttendanceRecord>;
  face: Record<string, FaceEnrolment>;
  passes: Record<string, VerificationPass>;
  queue: OfflineQueueItem[];
  packs: Record<string, BatchPack>;
  session: StoredSession | null;
  /** Voice seconds used, keyed by `voiceUsageKey(staffId, date)` (D-089). */
  voiceUsage: Record<string, number>;
}

type Key = keyof Collections;

interface SeedMarker {
  readonly version: number;
  readonly date: LocalDate;
  /** Whether the server-owned demo story was seeded on the device (absent on markers written before Task 10: true). */
  readonly serverData?: boolean;
}

export interface MockDatabaseOptions {
  /**
   * Seed the server-owned demo story (today's submissions, the correction, staff records, face enrolments) on the
   * device. True for the mock data source; false when Supabase holds those records (D-143), so the device starts
   * with only its own records. Packs are the device's own: the story's packs arrive only with an explicit demo action
   * (first seed, Reset, a preset), never with an automatic reseed. Changing it reseeds the device, keeping what has
   * not synced yet (Task 17).
   */
  readonly seedServerData?: boolean;
  /**
   * Demo builds only (passed by the demo boot path): a fresh device's first seed on the Supabase source writes the
   * story's packs, as the device source has them. Off by default, so a demo-off Supabase build starts with no packs.
   * The device source ignores it: its story is its data.
   */
  readonly demoStoryPacks?: boolean;
}

/** What a reseed keeps: a new day on the Supabase source keeps all of it; a Data switch keeps the unsynced part. */
type Kept = Partial<Pick<Collections, 'queue' | 'submissions' | 'staff' | 'corrections' | 'face' | 'packs'>>;

export const staffKey = (staffId: string, date: LocalDate) => `${staffId}@${date}`;
export const voiceUsageKey = staffKey;

export class MockDatabase {
  constructor(
    private readonly store: KeyValueStore,
    private readonly clock: Clock,
    private readonly bus: EventBus,
    private readonly options: MockDatabaseOptions = {},
  ) {}

  private get seedsServerData(): boolean {
    return this.options.seedServerData ?? true;
  }

  today(): LocalDate {
    return toLocalDate(this.clock.now());
  }

  /**
   * Seeds on first use, on schema change, and when the calendar day changes. Without the server-owned story
   * (Supabase, D-143) the device is the only copy of what has not synced yet, so a new day keeps it (deviceOwned).
   * A demo Data switch (the other source on the same device) keeps what has not synced yet too (unsynced).
   */
  ensureSeeded(): void {
    const marker = this.store.get<SeedMarker>('seed');
    const sameVersion = !!marker && marker.version === SCHEMA_VERSION;
    const sameShape = sameVersion && (marker.serverData ?? true) === this.seedsServerData;
    if (sameShape && marker.date === this.today()) return;
    // The device source has the story's packs always; on Supabase only a demo build's fresh device (no marker) does.
    if (this.seedsServerData) return this.seed(sameVersion && !sameShape ? this.unsynced() : undefined, true);
    if (!marker) return this.seed(undefined, this.options.demoStoryPacks ?? false);
    // The Supabase source's automatic reseeds keep the device's real packs and write no story packs.
    this.seed(!sameVersion ? this.ownPacks() : !sameShape ? { ...this.unsynced(), ...this.ownPacks() } : this.deviceOwned(), false);
  }

  /** The packs this device holds now (downloaded, or the story's from an earlier explicit demo action). */
  private ownPacks(): Kept {
    return { packs: this.store.get<Collections['packs']>('packs') ?? {} };
  }

  /**
   * Demo: a preset on the Supabase source writes the story's packs (downloaded today, one stale) over the device's, as
   * the device source has them from its seed; other packs the device downloaded stay. A no-op on the device source.
   */
  restoreStoryPacks(): void {
    if (this.seedsServerData) return;
    const story = Object.fromEntries(buildSeed(this.today()).packs.map((p) => [p.batchId, p]));
    this.update('packs', (all) => ({ ...all, ...story }), 'packs');
  }

  /** What has not reached a server yet: the sync queue and the records still waiting (or refused). */
  private unsynced(): Kept {
    const waiting = <T extends { readonly syncState: string }>(all: Record<string, T> | undefined) =>
      Object.fromEntries(Object.entries(all ?? {}).filter(([, r]) => r.syncState !== 'synced'));
    return {
      queue: this.store.get<Collections['queue']>('queue') ?? [],
      submissions: waiting(this.store.get<Collections['submissions']>('submissions')),
      staff: waiting(this.store.get<Collections['staff']>('staff')),
    };
  }

  /** What only this device holds on the Supabase source: the unsynced part, its corrections, face flags and packs. */
  private deviceOwned(): Kept {
    return {
      ...this.unsynced(),
      corrections: this.store.get<Collections['corrections']>('corrections') ?? [],
      face: this.store.get<Collections['face']>('face') ?? {},
      ...this.ownPacks(),
    };
  }

  /** Restores the complete demo story (Reset Demo), the story's packs included. */
  reset(): void {
    this.store.clear();
    this.seed(undefined, true);
    this.bus.emit('session', 'attendance', 'corrections', 'staff', 'face', 'verification', 'offline', 'packs', 'preferences', 'demo');
  }

  /** `storyPacks`: an explicit demo action (first seed, Reset) writes the story's packs; an automatic reseed does not. */
  private seed(keep: Kept | undefined, storyPacks: boolean): void {
    const today = this.today();
    const full = buildSeed(today);
    const server = this.seedsServerData ? full : { ...full, submissions: [], corrections: [], staffRecords: [], faceEnrolments: [] };
    const seed = storyPacks ? server : { ...server, packs: [] };
    this.store.clear();
    // What the device kept wins over the story for its key: the phone shows what it locked.
    this.store.set<Collections['submissions']>('submissions', { ...Object.fromEntries(seed.submissions.map((s) => [s.sessionKey, s])), ...keep?.submissions });
    this.store.set<Collections['drafts']>('drafts', {});
    this.store.set<Collections['corrections']>('corrections', [...(keep?.corrections ?? []), ...seed.corrections]);
    this.store.set<Collections['staff']>('staff', { ...Object.fromEntries(seed.staffRecords.map((r) => [staffKey(r.staffId, r.date), r])), ...keep?.staff });
    this.store.set<Collections['face']>('face', { ...Object.fromEntries(seed.faceEnrolments.map((f) => [f.staffId, f])), ...keep?.face });
    this.store.set<Collections['passes']>('passes', {});
    this.store.set<Collections['queue']>('queue', [...(keep?.queue ?? [])]);
    this.store.set<Collections['packs']>('packs', { ...Object.fromEntries(seed.packs.map((p) => [p.batchId, p])), ...keep?.packs });
    this.store.set<Collections['session']>('session', null);
    this.store.set<Collections['voiceUsage']>('voiceUsage', {});
    this.store.set<SeedMarker>('seed', { version: SCHEMA_VERSION, date: today, serverData: this.seedsServerData });
  }

  /** Demo: a configuration or persona change is a new session — earlier verification passes no longer apply. */
  clearPasses(): void {
    this.write('passes', {}, 'verification');
  }

  /** Demo: toggle "Face registered" for a user. */
  setFaceEnrolled(staffId: string, enrolled: boolean, at: string): void {
    this.update(
      'face',
      (all) => {
        const next = { ...all };
        if (enrolled) next[staffId] = { staffId, enrolledAt: at, sampleCount: 3, simulated: true };
        else delete next[staffId];
        return next;
      },
      'face',
    );
  }

  read<K extends Key>(key: K): Collections[K] {
    this.ensureSeeded();
    const value = this.store.get<Collections[K]>(key);
    if (value === undefined) throw new Error(`Mock collection "${key}" missing after seeding`);
    return value;
  }

  write<K extends Key>(key: K, value: Collections[K], ...topics: DataTopic[]): void {
    this.store.set(key, value);
    if (topics.length) this.bus.emit(...topics);
  }

  update<K extends Key>(key: K, fn: (current: Collections[K]) => Collections[K], ...topics: DataTopic[]): void {
    this.write(key, fn(this.read(key)), ...topics);
  }
}

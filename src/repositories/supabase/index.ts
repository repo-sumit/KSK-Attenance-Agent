/**
 * The Supabase data layer (Task 10, D-143): the server-owned repositories, the sync gateway and Realtime, built
 * over one DataClient. Device-owned repositories (drafts, queue, packs, passes, session, preferences) stay on the
 * device database; the composition root (services/container.ts) wires both. The SDK itself is only in client.ts,
 * loaded by boot when the Supabase source is chosen.
 */
import type { EventBus } from '@/lib/events';
import type { KeyValueStore } from '@/lib/kv-store';
import type { Clock } from '@/lib/time';
import type { SessionRepository } from '../interfaces';
import type { MockDatabase } from '../mock/database';
import { SupabaseAttendanceRepository } from './attendance';
import { SupabaseCorrectionRepository } from './corrections';
import type { SupabaseContext } from './context';
import { gateOnline, type DataClient } from './data-client';
import { SupabaseFaceEnrolmentRepository, SupabaseVoiceUsageRepository } from './device-flags';
import { FollowedSessionRepository, SupabaseLive } from './live';
import { SupabaseAnnouncementRepository, SupabaseMasterDataRepository } from './master-data';
import { ServerReadCache } from './read-cache';
import { SupabaseStaffAttendanceRepository } from './staff';
import { SupabaseSyncGateway } from './sync-gateway';

export { LIVE_DEBOUNCE_MS } from './live';

export interface SupabaseRepositoryDeps {
  readonly client: DataClient;
  readonly db: MockDatabase;
  /** Device store for cached server reads (offline fallback) and the correction outbox. */
  readonly cacheStore: KeyValueStore;
  readonly bus: EventBus;
  readonly clock: Clock;
  readonly isOnline: () => boolean;
  /** Demo knob: the next sync attempt fails. */
  readonly syncBlocked?: () => boolean;
  /** Real elapsed milliseconds for cache freshness (defaults to Date.now; never the demo clock). */
  readonly elapsedMs?: () => number;
}

export function createSupabaseRepositories(deps: SupabaseRepositoryDeps) {
  const client = gateOnline(deps.client, deps.isOnline);
  const cache = new ServerReadCache({ store: deps.cacheStore, elapsedMs: deps.elapsedMs });
  const live = new SupabaseLive({ client, bus: deps.bus, cache });
  // The institute's master data (one load per day, kept in memory) scopes the device's own records like the server's.
  const members = async () => {
    const instituteId = live.instituteId;
    const data = instituteId ? await masterData.getInstituteData(instituteId) : undefined;
    return data?.institutes.length ? { batchIds: new Set(data.batches.map((b) => b.id)), staffIds: new Set(data.staff.map((s) => s.id)) } : undefined;
  };
  const ctx: SupabaseContext = { client, cache, db: deps.db, store: deps.cacheStore, bus: deps.bus, clock: deps.clock, scope: () => live.instituteId, members };
  const masterData = new SupabaseMasterDataRepository(ctx);
  const corrections = new SupabaseCorrectionRepository(ctx);
  return {
    masterData,
    attendance: new SupabaseAttendanceRepository(ctx),
    corrections,
    staffAttendance: new SupabaseStaffAttendanceRepository(ctx),
    faceEnrolment: new SupabaseFaceEnrolmentRepository(ctx),
    announcements: new SupabaseAnnouncementRepository(ctx),
    voiceUsage: new SupabaseVoiceUsageRepository(ctx),
    syncGateway: new SupabaseSyncGateway({ client, clock: deps.clock, blocked: deps.syncBlocked, onSubmissionPushed: () => void corrections.flush() }),
    live,
    /** The client gated on connectivity: the demo seeds and resets the shared story through it (demo builds only). */
    client,
    /** Wraps the device's session store so Realtime and the read scope follow sign-in and sign-out. */
    followSession: (inner: SessionRepository): SessionRepository => new FollowedSessionRepository(inner, live),
  };
}

export type SupabaseRepositories = ReturnType<typeof createSupabaseRepositories>;

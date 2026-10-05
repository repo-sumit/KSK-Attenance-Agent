/**
 * Realtime (D-143): while someone is signed in, the four published tables of their institute are watched. A change
 * drops the cached server rows of that table and, once a burst settles, emits the app's data topics on the
 * EventBus so screens refetch. Signing out (or into another institute) ends the subscription.
 */
import type { DataTopic, EventBus } from '@/lib/events';
import type { SessionRepository, StoredSession } from '../interfaces';
import type { DataClient } from './data-client';
import type { ServerReadCache } from './read-cache';
import { SUBMISSIONS_CACHE } from './attendance';
import { CORRECTIONS_CACHE } from './corrections';
import { FACE_CACHE } from './device-flags';
import { STAFF_CACHE } from './staff';

export const LIVE_DEBOUNCE_MS = 300;

const LIVE_TABLES = {
  submissions: { cache: SUBMISSIONS_CACHE, topics: ['attendance'] },
  corrections: { cache: CORRECTIONS_CACHE, topics: ['corrections', 'attendance'] },
  staff_attendance: { cache: STAFF_CACHE, topics: ['staff'] },
  face_enrolment: { cache: FACE_CACHE, topics: ['face'] },
} as const satisfies Record<string, { cache: string; topics: readonly DataTopic[] }>;

type LiveTable = keyof typeof LIVE_TABLES;

const isLiveTable = (table: string): table is LiveTable => table in LIVE_TABLES;

export class SupabaseLive {
  private current: { readonly instituteId: string; readonly stop: () => void } | undefined;
  private readonly changed = new Set<LiveTable>();
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: { readonly client: DataClient; readonly bus: EventBus; readonly cache: ServerReadCache; readonly debounceMs?: number }) {}

  /** The institute being followed (the scope of server reads), if anyone is signed in. */
  get instituteId(): string | undefined {
    return this.current?.instituteId;
  }

  follow(instituteId: string | undefined): void {
    if (this.current?.instituteId === instituteId) return;
    this.current?.stop();
    this.current = undefined;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.changed.clear();
    if (!instituteId) return;
    const filter = `institute_id=eq.${instituteId}`;
    const bindings = (Object.keys(LIVE_TABLES) as LiveTable[]).map((table) => ({ table, filter }));
    const stop = this.deps.client.subscribe(`ksk-live-${instituteId}`, bindings, (table) => {
      if (isLiveTable(table)) this.onChange(table);
    });
    this.current = { instituteId, stop };
  }

  private onChange(table: LiveTable): void {
    this.deps.cache.invalidate(LIVE_TABLES[table].cache);
    this.changed.add(table);
    this.timer ??= setTimeout(() => this.emit(), this.deps.debounceMs ?? LIVE_DEBOUNCE_MS);
  }

  private emit(): void {
    this.timer = undefined;
    const topics = new Set<DataTopic>([...this.changed].flatMap((t) => LIVE_TABLES[t].topics));
    this.changed.clear();
    if (topics.size) this.deps.bus.emit(...topics);
  }
}

/**
 * The device's session store, followed by Realtime: a restored session (page load), a sign-in and a sign-out each
 * move the subscription before anyone reads with the new scope.
 */
export class FollowedSessionRepository implements SessionRepository {
  constructor(private readonly inner: SessionRepository, private readonly live: SupabaseLive) {}

  async get(): Promise<StoredSession | undefined> {
    const session = await this.inner.get();
    this.live.follow(session?.instituteId);
    return session;
  }

  async set(session: StoredSession): Promise<void> {
    this.live.follow(session.instituteId);
    await this.inner.set(session);
  }

  async clear(): Promise<void> {
    this.live.follow(undefined);
    await this.inner.clear();
  }
}

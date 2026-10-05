/**
 * Server reads, cached twice (D-143, Task 10 requirement 4):
 * - in memory for a few seconds, with concurrent reads of one query sharing a request, so one screen that asks
 *   for twenty sessions of a day makes one round trip; Realtime and the app's own writes invalidate it;
 * - on the device (the last successful answer per query, most recent first, bounded), so a phone that cannot reach
 *   the server still shows its reports.
 * A network failure is expected and silent: the read answers from the device copy (or the empty value). A server
 * refusal is a bug and throws. `readLive` also says whether the answer is the server's current one (Task 17: only
 * such an answer may drop device records the server no longer has).
 */
import type { KeyValueStore } from '@/lib/kv-store';
import type { DataError, DataResult } from './data-client';

const PREFIX = 'q:';
const INDEX = 'q-index';

export class SupabaseReadError extends Error {
  constructor(readonly error: DataError) {
    super(`Supabase read failed: ${error.kind === 'server' ? error.code : 'network'} ${error.message}`);
    this.name = 'SupabaseReadError';
  }
}

export interface ReadCacheOptions {
  readonly store: KeyValueStore;
  /** Real elapsed milliseconds (never the demo clock, which can stand still). */
  readonly elapsedMs?: () => number;
  readonly ttlMs?: number;
  /** How many query answers the device keeps for offline use. */
  readonly maxPersisted?: number;
}

export interface ReadOptions {
  /** How long the in-memory answer stays fresh (defaults to the cache's ttl). */
  readonly ttlMs?: number;
  /**
   * The device copy's key, when it differs from the in-memory key: master data is fresh per day in memory, but
   * yesterday's copy must still answer on a new day offline (sign-in, reports).
   */
  readonly persistAs?: string;
  /** Keep the device copy outside the bounded list of recent queries (an offline sign-in needs it). */
  readonly pinned?: boolean;
}

/**
 * A read's answer. `live`: the server answered (now, or within the in-memory freshness) and nothing invalidated the
 * query while the request ran; false for the device copy or the empty value.
 */
export interface LiveRead<T> {
  readonly value: T;
  readonly live: boolean;
}

export class ServerReadCache {
  private readonly memory = new Map<string, { readonly at: number; readonly value: unknown }>();
  private readonly inflight = new Map<string, Promise<LiveRead<unknown>>>();
  private generation = 0;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxPersisted: number;

  constructor(private readonly opts: ReadCacheOptions) {
    this.now = opts.elapsedMs ?? (() => Date.now());
    this.ttlMs = opts.ttlMs ?? 10_000;
    this.maxPersisted = opts.maxPersisted ?? 24;
  }

  async read<T>(key: string, fetcher: () => Promise<DataResult<T>>, empty: T, options: ReadOptions = {}): Promise<T> {
    return (await this.readLive(key, fetcher, empty, options)).value;
  }

  readLive<T>(key: string, fetcher: () => Promise<DataResult<T>>, empty: T, options: ReadOptions = {}): Promise<LiveRead<T>> {
    const hit = this.memory.get(key);
    if (hit && this.now() - hit.at < (options.ttlMs ?? this.ttlMs)) return Promise.resolve({ value: hit.value as T, live: true });
    const running = this.inflight.get(key);
    if (running) return running as Promise<LiveRead<T>>;
    const generation = this.generation;
    const stored = options.persistAs ?? key;
    const request = (async (): Promise<LiveRead<T>> => {
      const result = await fetcher();
      if (result.ok) {
        const current = generation === this.generation;
        if (current) this.memory.set(key, { at: this.now(), value: result.data });
        this.persist(stored, result.data, options.pinned ?? false);
        return { value: result.data, live: current };
      }
      if (result.error.kind === 'network') return { value: this.persisted<T>(stored) ?? empty, live: false };
      throw new SupabaseReadError(result.error);
    })().finally(() => {
      if (this.inflight.get(key) === request) this.inflight.delete(key);
    });
    this.inflight.set(key, request);
    return request;
  }

  /** Forgets in-memory answers whose key starts with `prefix` (the device copies stay for offline use). */
  invalidate(prefix = ''): void {
    this.generation++;
    for (const key of [...this.memory.keys()]) if (key.startsWith(prefix)) this.memory.delete(key);
    for (const key of [...this.inflight.keys()]) if (key.startsWith(prefix)) this.inflight.delete(key);
  }

  private persisted<T>(key: string): T | undefined {
    return this.opts.store.get<{ readonly data: T }>(PREFIX + key)?.data;
  }

  /**
   * Best effort: a full device store loses the oldest answers first and never fails the read. A pinned answer is
   * not in the bounded index, so other queries never push it out; a newer copy replaces it.
   */
  private persist(key: string, data: unknown, pinned: boolean): void {
    const { store } = this.opts;
    const index = (store.get<string[]>(INDEX) ?? []).filter((k) => k !== key);
    if (!pinned) index.push(key);
    while (index.length > this.maxPersisted) store.remove(PREFIX + index.shift());
    for (;;) {
      try {
        store.set(PREFIX + key, { data });
        break;
      } catch {
        const oldest = index.shift();
        if (!oldest || oldest === key) break;
        store.remove(PREFIX + oldest);
      }
    }
    try {
      store.set(INDEX, index);
    } catch {
      // The index is rebuilt by the next successful write.
    }
  }
}

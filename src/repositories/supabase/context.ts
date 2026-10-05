/** What every Supabase repository shares: the client, the read cache, the device database and the scope. */
import type { EventBus } from '@/lib/events';
import type { KeyValueStore } from '@/lib/kv-store';
import type { Clock } from '@/lib/time';
import type { MockDatabase } from '../mock/database';
import { eq, type DataClient, type DataResult, type Filter, type Row, type SelectRequest } from './data-client';
import type { ServerReadCache } from './read-cache';

export interface SupabaseContext {
  /** Already gated on connectivity: offline answers `network` without a request. */
  readonly client: DataClient;
  readonly cache: ServerReadCache;
  /** The device database: drafts, the queue, packs, passes, the session, and this device's own records. */
  readonly db: MockDatabase;
  /** Device store for the cached server reads and the correction outbox. */
  readonly store: KeyValueStore;
  readonly bus: EventBus;
  readonly clock: Clock;
  /** The signed-in institute (undefined before sign-in): server reads are scoped to it. */
  readonly scope: () => string | undefined;
  /** The signed-in institute's batches and staff, from its master data; undefined while that data is not known. */
  readonly members?: () => Promise<InstituteMembers | undefined>;
}

export interface InstituteMembers {
  readonly batchIds: ReadonlySet<string>;
  readonly staffIds: ReadonlySet<string>;
}

/** Every row mapped; a row the mapper skips (undefined: an invalid shared row, Task 17) is left out. */
export async function selectMapped<T>(client: DataClient, req: SelectRequest, map: (row: Row) => T | undefined): Promise<DataResult<T[]>> {
  const result = await client.select(req);
  if (!result.ok) return result;
  const data: T[] = [];
  for (const row of result.data) {
    const mapped = map(row);
    if (mapped !== undefined) data.push(mapped);
  }
  return { ok: true, data };
}

/** The institute filter and the matching cache-key part. */
export function scoped(ctx: SupabaseContext): { readonly filters: Filter[]; readonly key: string } {
  const institute = ctx.scope();
  return institute ? { filters: [eq('institute_id', institute)], key: institute } : { filters: [], key: '*' };
}

/**
 * The device's own records in the scope of the server's reads (Task 17 fix round 1): all of them before sign-in
 * (the reads are unscoped then), the signed-in institute's after it, so a device used for both demo institutes
 * never compares one institute's server answer with the other's records. `prunable` is false while the institute's
 * data is not known: the records are all kept and shown, and none may be dropped.
 */
export async function inScope<T>(ctx: SupabaseContext, local: readonly T[], member: (members: InstituteMembers, record: T) => boolean): Promise<{ readonly records: T[]; readonly prunable: boolean }> {
  if (!ctx.scope()) return { records: [...local], prunable: true };
  const members = await ctx.members?.();
  return members ? { records: local.filter((r) => member(members, r)), prunable: true } : { records: [...local], prunable: false };
}

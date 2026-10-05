/**
 * The narrow seam between the Supabase repositories and @supabase/supabase-js (D-143). Repositories speak only
 * this interface, so tests drive them with an in-memory fake and only `client.ts` imports the SDK. Results are
 * values, never thrown: a network failure is expected on a phone and must not become a console error.
 */

/** Tables the app reads or writes (supabase/migrations/*_ksk_schema.sql). */
export type TableName =
  | 'institutes'
  | 'subjects'
  | 'trades'
  | 'batches'
  | 'students'
  | 'staff'
  | 'timetable'
  | 'ojt'
  | 'announcements'
  | 'submissions'
  | 'corrections'
  | 'staff_attendance'
  | 'voice_usage'
  | 'face_enrolment'
  | 'demo_meta';

/**
 * Database functions (SECURITY DEFINER, D-144). `ksk_seed_day` is on the project; `ksk_reset_demo` and
 * `ksk_cleanup_test_institute` are applied by the owner by hand, so callers treat a missing one (PGRST202) as an answer.
 */
export type RpcName = 'ksk_seed_day' | 'ksk_reset_demo' | 'ksk_cleanup_test_institute';

export type Row = Record<string, unknown>;

export type FilterValue = string | number | boolean;

export type Filter =
  | { readonly column: string; readonly op: 'eq' | 'gte' | 'lte' | 'lt'; readonly value: FilterValue }
  | { readonly column: string; readonly op: 'in'; readonly value: readonly FilterValue[] };

export interface SelectRequest {
  readonly table: TableName;
  readonly filters?: readonly Filter[];
  /** A unique column, so paging through PostgREST's row limit is stable. */
  readonly order: string;
}

/** `network`: try again later (offline, timeout, 5xx). `server`: the server refused (Postgres or PostgREST code). */
export type DataError =
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'server'; readonly code: string; readonly message: string; readonly status: number };

export type DataResult<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: DataError };

export interface LiveBinding {
  readonly table: TableName;
  /** A Realtime filter, e.g. `institute_id=eq.inst-27410`. */
  readonly filter?: string;
}

export interface DataClient {
  /** Every matching row (pages internally). */
  select(req: SelectRequest): Promise<DataResult<Row[]>>;
  /** Inserts one row and returns it as stored (server-filled columns included). */
  insert(table: TableName, row: Row): Promise<DataResult<Row[]>>;
  /** INSERT … ON CONFLICT (`onConflict`) DO UPDATE, or DO NOTHING with `ignoreDuplicates`. */
  upsert(table: TableName, row: Row, onConflict: string, options?: { readonly ignoreDuplicates?: boolean }): Promise<DataResult<null>>;
  /** Deletes the rows matching every filter (RLS decides what anon may delete: only face enrolments). */
  remove(table: TableName, filters: readonly Filter[]): Promise<DataResult<null>>;
  /** Calls a database function with named arguments and returns its JSON answer. */
  rpc(fn: RpcName, args?: Row): Promise<DataResult<unknown>>;
  /** Realtime changes on these tables; returns the unsubscribe. */
  subscribe(channel: string, bindings: readonly LiveBinding[], onChange: (table: TableName) => void): () => void;
}

/** Postgres error codes the write-once rules depend on (Task 9 report). */
export const UNIQUE_VIOLATION = '23505';
export const FOREIGN_KEY_VIOLATION = '23503';
/** PostgREST: no such function in the schema cache (HTTP 404). */
export const FUNCTION_NOT_FOUND = 'PGRST202';

/** The server does not have this database function (the owner has not applied its migration yet). */
export const isMissingFunction = (error: DataError): boolean => error.kind === 'server' && (error.code === FUNCTION_NOT_FOUND || error.status === 404);

export const networkError = (message = 'offline'): DataResult<never> => ({ ok: false, error: { kind: 'network', message } });

export const eq = (column: string, value: FilterValue): Filter => ({ column, op: 'eq', value });

/**
 * Answers `network` without calling the server while the device is offline. The demo's simulated connectivity
 * says "offline" while the laptop is not, so this keeps reads and sync coherent with the demo's network switch.
 */
export function gateOnline(client: DataClient, isOnline: () => boolean): DataClient {
  return {
    select: (req) => (isOnline() ? client.select(req) : Promise.resolve(networkError())),
    insert: (table, row) => (isOnline() ? client.insert(table, row) : Promise.resolve(networkError())),
    upsert: (table, row, onConflict, options) => (isOnline() ? client.upsert(table, row, onConflict, options) : Promise.resolve(networkError())),
    remove: (table, filters) => (isOnline() ? client.remove(table, filters) : Promise.resolve(networkError())),
    rpc: (fn, args) => (isOnline() ? client.rpc(fn, args) : Promise.resolve(networkError())),
    subscribe: (channel, bindings, onChange) => client.subscribe(channel, bindings, onChange),
  };
}

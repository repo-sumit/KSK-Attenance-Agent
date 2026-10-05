/**
 * The only module that imports @supabase/supabase-js (boot loads it with import() when the Supabase source is
 * chosen, so the mock build never downloads it). It adapts the SDK to the DataClient seam: pages through
 * PostgREST's 1000-row limit, gives every request a timeout, does not retry for seconds (the app has its own
 * offline fallback) and turns failures into values. No Supabase Auth: the app has no Supabase identity yet (D-144),
 * so nothing is persisted and the publishable key is the only credential.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { DataClient, DataError, DataResult, Filter, LiveBinding, Row, RpcName, SelectRequest, TableName } from './data-client';

const PAGE_ROWS = 1000;
let channelSeq = 0;
const TIMEOUT_MS = 10_000;

export interface SupabaseDataClientOptions {
  /** A fetch to use instead of the global one (tests). */
  readonly fetch?: typeof fetch;
  readonly timeoutMs?: number;
}

interface PostgrestAnswer {
  readonly error: { readonly code?: string; readonly message?: string } | null;
  readonly status: number;
}

/** 0 = the request never got an answer (offline, DNS, timeout); 5xx, 408 and 429 are worth trying again later. */
export function classifyFailure(answer: PostgrestAnswer): DataError {
  const message = answer.error?.message ?? '';
  const { status } = answer;
  if (status === 0 || status >= 500 || status === 408 || status === 429) return { kind: 'network', message };
  return { kind: 'server', code: answer.error?.code ?? '', message, status };
}

// The PostgREST filter builder's generic type is not needed here: every table is addressed by name.
interface FilterBuilder {
  eq(column: string, value: unknown): FilterBuilder;
  gte(column: string, value: unknown): FilterBuilder;
  lte(column: string, value: unknown): FilterBuilder;
  lt(column: string, value: unknown): FilterBuilder;
  in(column: string, values: readonly unknown[]): FilterBuilder;
}

function applyFilter<B extends FilterBuilder>(query: B, f: Filter): B {
  switch (f.op) {
    case 'eq':
      return query.eq(f.column, f.value) as B;
    case 'gte':
      return query.gte(f.column, f.value) as B;
    case 'lte':
      return query.lte(f.column, f.value) as B;
    case 'lt':
      return query.lt(f.column, f.value) as B;
    case 'in':
      return query.in(f.column, f.value) as B;
  }
}

class SupabaseJsDataClient implements DataClient {
  constructor(private readonly sb: SupabaseClient, private readonly timeoutMs: number) {}

  private signal(): AbortSignal | undefined {
    return typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(this.timeoutMs) : undefined;
  }

  async select(req: SelectRequest): Promise<DataResult<Row[]>> {
    const rows: Row[] = [];
    for (let from = 0; ; from += PAGE_ROWS) {
      let query = this.sb.from(req.table).select('*');
      for (const f of req.filters ?? []) query = applyFilter(query as unknown as FilterBuilder, f) as unknown as typeof query;
      let ranged = query.order(req.order, { ascending: true }).range(from, from + PAGE_ROWS - 1).retry(false);
      const signal = this.signal();
      if (signal) ranged = ranged.abortSignal(signal);
      const answer = await ranged;
      if (answer.error) return { ok: false, error: classifyFailure(answer) };
      const page = (answer.data ?? []) as Row[];
      rows.push(...page);
      if (page.length < PAGE_ROWS) return { ok: true, data: rows };
    }
  }

  async insert(table: TableName, row: Row): Promise<DataResult<Row[]>> {
    let query = this.sb.from(table).insert(row).select();
    const signal = this.signal();
    if (signal) query = query.abortSignal(signal);
    const answer = await query;
    return answer.error ? { ok: false, error: classifyFailure(answer) } : { ok: true, data: (answer.data ?? []) as Row[] };
  }

  async upsert(table: TableName, row: Row, onConflict: string, options?: { readonly ignoreDuplicates?: boolean }): Promise<DataResult<null>> {
    let query = this.sb.from(table).upsert(row, { onConflict, ignoreDuplicates: options?.ignoreDuplicates ?? false });
    const signal = this.signal();
    if (signal) query = query.abortSignal(signal);
    const answer = await query;
    return answer.error ? { ok: false, error: classifyFailure(answer) } : { ok: true, data: null };
  }

  async remove(table: TableName, filters: readonly Filter[]): Promise<DataResult<null>> {
    let query = this.sb.from(table).delete();
    for (const f of filters) query = applyFilter(query as unknown as FilterBuilder, f) as unknown as typeof query;
    const signal = this.signal();
    if (signal) query = query.abortSignal(signal);
    const answer = await query;
    return answer.error ? { ok: false, error: classifyFailure(answer) } : { ok: true, data: null };
  }

  async rpc(fn: RpcName, args: Row = {}): Promise<DataResult<unknown>> {
    let query = this.sb.rpc(fn, args);
    const signal = this.signal();
    if (signal) query = query.abortSignal(signal);
    const answer = await query;
    return answer.error ? { ok: false, error: classifyFailure(answer) } : { ok: true, data: answer.data };
  }

  subscribe(channel: string, bindings: readonly LiveBinding[], onChange: (table: TableName) => void): () => void {
    // The SDK client is shared per page and returns the existing channel for a topic it already has, which refuses
    // new callbacks once subscribed: each subscription gets its own topic (two containers in one page, Strict Mode).
    const ch = this.sb.channel(`${channel}:${++channelSeq}`);
    for (const b of bindings) {
      ch.on('postgres_changes', { event: '*', schema: 'public', table: b.table, ...(b.filter ? { filter: b.filter } : {}) }, () => onChange(b.table));
    }
    ch.subscribe();
    return () => {
      void this.sb.removeChannel(ch);
    };
  }
}

/** One SDK client per page for the app's project: a second one (React Strict Mode boots twice in dev) only warns. */
const shared = new Map<string, SupabaseClient>();

export function createSupabaseDataClient(url: string, publishableKey: string, options: SupabaseDataClientOptions = {}): DataClient {
  const make = () =>
    createClient(url, publishableKey, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      ...(options.fetch ? { global: { fetch: options.fetch } } : {}),
    });
  let sb: SupabaseClient;
  if (options.fetch) {
    sb = make();
  } else {
    const key = `${url}|${publishableKey}`;
    sb = shared.get(key) ?? make();
    shared.set(key, sb);
  }
  return new SupabaseJsDataClient(sb, options.timeoutMs ?? TIMEOUT_MS);
}

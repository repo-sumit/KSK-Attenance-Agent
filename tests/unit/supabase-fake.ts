/**
 * An in-memory stand-in for the Supabase project behind the DataClient seam (Task 10 tests). It mimics what the
 * repositories rely on: unique keys (23505), the corrections → submissions foreign key (23503), the server clock on
 * submissions, timestamptz values coming back as `+00:00` (not `Z` with milliseconds), an offline switch (network
 * errors) and Realtime change events. Task 11 adds the demo's database functions (`ksk_seed_day`, and the optional
 * `ksk_reset_demo` / `ksk_cleanup_test_institute`, missing unless listed in `functions`), `demo_meta` and deletes.
 * Task 17: `corrections.seq` is a server identity (GENERATED ALWAYS): every stored correction gets the next number, and
 * an insert that supplies one is refused (428C9), as Postgres does. Inserted operational rows get `institute_id` from
 * their parent, as the ksk_fill_institute trigger does (scoped reads depend on it).
 */
import { buildAnnouncements } from '@/data/mock/announcements';
import { buildMasterData } from '@/data/mock/seeds';
import type { DataClient, DataError, DataResult, Filter, Row, RpcName, SelectRequest, TableName } from '@/repositories/supabase/data-client';
import { announcementToRow, ojtToRow } from '@/repositories/supabase/mappers';
import type { LocalDate } from '@/lib/time';
import { MASTER_TABLES, masterDataRows, type SqlValue } from '../../scripts/supabase/seed-sql';

const UNIQUE: Partial<Record<TableName, string[][]>> = {
  submissions: [['id'], ['session_key']],
  corrections: [['correction_id']],
  staff_attendance: [['id'], ['staff_id', 'date']],
  voice_usage: [['staff_id', 'date']],
  face_enrolment: [['staff_id']],
};

/** The write-once tables the app inserts into (upserts keep their rows as given). */
const FILLED = new Set<TableName>(['submissions', 'corrections', 'staff_attendance']);

const TIMESTAMPTZ = new Set(['device_timestamp', 'server_timestamp', 'timestamp', 'enrolled_at', 'published_at']);

/** How PostgREST prints a timestamptz: seconds precision when the milliseconds are zero, and `+00:00`. */
export function pgTimestamp(iso: string): string {
  return new Date(iso).toISOString().replace('.000Z', '+00:00').replace('Z', '+00:00');
}

const matches = (row: Row, f: Filter): boolean => {
  const v = row[f.column];
  switch (f.op) {
    case 'eq':
      return v === f.value;
    case 'in':
      return (f.value as readonly unknown[]).includes(v);
    case 'gte':
      return String(v) >= String(f.value);
    case 'lte':
      return String(v) <= String(f.value);
    case 'lt':
      return String(v) < String(f.value);
  }
};

const network = (): DataResult<never> => ({ ok: false, error: { kind: 'network', message: 'FetchError: Failed to fetch' } });
const server = (code: string, status = 409): DataResult<never> => ({ ok: false, error: { kind: 'server', code, message: code, status } });

interface Subscription {
  readonly channel: string;
  readonly bindings: ReadonlyArray<{ readonly table: TableName; readonly filter?: string }>;
  readonly onChange: (table: TableName) => void;
  active: boolean;
}

export class FakeDataClient implements DataClient {
  readonly tables: Partial<Record<TableName, Row[]>> = {};
  readonly calls: Array<{ readonly op: 'select' | 'insert' | 'upsert' | 'remove'; readonly table: TableName; readonly filters?: readonly Filter[] }> = [];
  readonly rpcs: Array<{ readonly fn: RpcName; readonly args?: Row }> = [];
  /** Database functions beyond ksk_seed_day that exist on this fake project (the owner applies the reset file by hand). */
  readonly functions = new Set<RpcName>(['ksk_seed_day']);
  readonly subscriptions: Subscription[] = [];
  offline = false;
  /** The next write answers with this error instead (e.g. a server refusal). */
  failNextWrite: DataError | undefined;
  serverNow = '2026-09-25T04:50:00.000Z';
  private nextSeq = 1;

  seed(table: TableName, rows: readonly Row[]): void {
    this.tables[table] = [...(this.tables[table] ?? []), ...rows.map((r) => this.identity(table, this.stored(r)))];
  }

  /** ksk_fill_institute (before insert): the owning institute from the parent row, when the fake has it. */
  private filled(table: TableName, row: Row): Row {
    if (!FILLED.has(table) || row.institute_id !== undefined) return row;
    const institute = this.instituteOf(table, row);
    return institute === undefined ? row : { ...row, institute_id: institute };
  }

  /** corrections.seq: GENERATED ALWAYS AS IDENTITY, in insert order. */
  private identity(table: TableName, row: Row): Row {
    return table === 'corrections' ? { ...row, seq: this.nextSeq++ } : row;
  }

  rows(table: TableName): Row[] {
    return this.tables[table] ?? [];
  }

  count(op: 'select' | 'insert' | 'upsert' | 'remove', table?: TableName): number {
    return this.calls.filter((c) => c.op === op && (!table || c.table === table)).length;
  }

  private stored(row: Row): Row {
    const out: Row = { ...row };
    for (const k of Object.keys(out)) if (TIMESTAMPTZ.has(k) && typeof out[k] === 'string') out[k] = pgTimestamp(out[k] as string);
    return out;
  }

  async select(req: SelectRequest): Promise<DataResult<Row[]>> {
    this.calls.push({ op: 'select', table: req.table, filters: req.filters });
    if (this.offline) return network();
    const rows = this.rows(req.table).filter((r) => (req.filters ?? []).every((f) => matches(r, f)));
    return { ok: true, data: rows.map((r) => ({ ...r })) };
  }

  private conflict(table: TableName, row: Row): Row | undefined {
    for (const cols of UNIQUE[table] ?? []) {
      const hit = this.rows(table).find((r) => cols.every((c) => r[c] === row[c]));
      if (hit) return hit;
    }
    return undefined;
  }

  private takeFailure(): DataResult<never> | undefined {
    if (this.offline) return network();
    const failure = this.failNextWrite;
    this.failNextWrite = undefined;
    return failure ? { ok: false, error: failure } : undefined;
  }

  async insert(table: TableName, row: Row): Promise<DataResult<Row[]>> {
    this.calls.push({ op: 'insert', table });
    const failure = this.takeFailure();
    if (failure) return failure;
    if (table === 'corrections' && 'seq' in row) return server('428C9', 400);
    if (this.conflict(table, row)) return server('23505');
    if (table === 'corrections' && !this.rows('submissions').some((s) => s.id === row.attendance_id)) return server('23503');
    const stored = this.identity(table, this.filled(table, this.stored(table === 'submissions' ? { ...row, server_timestamp: this.serverNow, origin: 'app' } : row)));
    this.tables[table] = [...this.rows(table), stored];
    return { ok: true, data: [{ ...stored }] };
  }

  async upsert(table: TableName, row: Row, onConflict: string, options?: { readonly ignoreDuplicates?: boolean }): Promise<DataResult<null>> {
    this.calls.push({ op: 'upsert', table });
    const failure = this.takeFailure();
    if (failure) return failure;
    const cols = onConflict.split(',');
    const existing = this.rows(table).find((r) => cols.every((c) => r[c] === row[c]));
    if (existing) {
      if (!options?.ignoreDuplicates) Object.assign(existing, this.stored(row));
    } else {
      this.tables[table] = [...this.rows(table), this.stored(row)];
    }
    return { ok: true, data: null };
  }

  async remove(table: TableName, filters: readonly Filter[]): Promise<DataResult<null>> {
    this.calls.push({ op: 'remove', table, filters });
    const failure = this.takeFailure();
    if (failure) return failure;
    this.tables[table] = this.rows(table).filter((r) => !filters.every((f) => matches(r, f)));
    return { ok: true, data: null };
  }

  async rpc(fn: RpcName, args?: Row): Promise<DataResult<unknown>> {
    this.rpcs.push({ fn, args });
    if (this.offline) return network();
    if (!this.functions.has(fn)) return server('PGRST202', 404);
    switch (fn) {
      case 'ksk_seed_day':
        return this.seedDay((args?.payload ?? {}) as Record<string, Row[] | string>);
      case 'ksk_reset_demo':
        return { ok: true, data: this.deleteOperational((id) => id !== 'inst-99999', true) };
      case 'ksk_cleanup_test_institute':
        return { ok: true, data: this.deleteOperational((id) => id === 'inst-99999', false) };
    }
  }

  /** What the ksk_fill_institute trigger decides. */
  private instituteOf(table: TableName, row: Row, rowsOf: (t: TableName) => Row[] = (t) => this.rows(t)): unknown {
    const find = (t: TableName, id: unknown) => rowsOf(t).find((r) => r.id === id)?.institute_id;
    if (table === 'submissions') return find('batches', row.batch_id);
    if (table === 'corrections') return find('submissions', row.attendance_id);
    if (table === 'ojt') return find('students', (row.student_ids as string[])[0]);
    return find('staff', row.staff_id);
  }

  /** ksk_seed_day: one transaction; write-once rows ON CONFLICT DO NOTHING; ojt and announcements updated in place. */
  private seedDay(payload: Record<string, Row[] | string>): DataResult<unknown> {
    const list = (k: string) => (Array.isArray(payload[k]) ? (payload[k] as Row[]) : []);
    const written: Record<string, number> = {};
    const staged: Partial<Record<TableName, Row[]>> = {};
    const tableRows = (t: TableName) => staged[t] ?? this.rows(t);
    const plan: Array<[string, TableName, 'nothing' | 'update', string[]]> = [
      ['submissions', 'submissions', 'nothing', []],
      ['corrections', 'corrections', 'nothing', []],
      ['staff_attendance', 'staff_attendance', 'nothing', []],
      ['ojt', 'ojt', 'update', ['id']],
      ['announcements', 'announcements', 'update', ['id']],
      ['face_enrolment', 'face_enrolment', 'nothing', []],
    ];
    for (const [key, table, mode, ids] of plan) {
      let rows = [...tableRows(table)];
      let n = 0;
      for (const raw of list(key)) {
        const row: Row = this.stored(table === 'submissions' ? { ...raw, origin: 'seed', server_timestamp: raw.server_timestamp ?? raw.device_timestamp } : raw);
        if (table !== 'announcements') {
          // A missing parent (e.g. a correction whose submission lost to another row) fails the whole call.
          const institute = this.instituteOf(table, row, tableRows);
          if (!institute) return server('23503');
          row.institute_id = institute;
        }
        const unique = mode === 'update' ? [ids] : (UNIQUE[table] ?? [['id']]);
        const hit = rows.findIndex((r) => unique.some((cols) => cols.every((c) => r[c] === row[c])));
        if (hit >= 0 && mode === 'nothing') continue;
        if (hit >= 0) rows[hit] = row;
        else rows = [...rows, this.identity(table, row)];
        n += 1;
      }
      staged[table] = rows;
      written[key] = n;
    }
    Object.assign(this.tables, staged);
    this.tables.demo_meta = [...this.rows('demo_meta').filter((r) => r.key !== 'seeded_day'), { key: 'seeded_day', value: String(payload.day), updated_at: this.serverNow }];
    return { ok: true, data: { day: payload.day, ...written } };
  }

  private deleteOperational(inScope: (instituteId: string) => boolean, meta: boolean): Record<string, number> {
    const out: Record<string, number> = {};
    for (const table of ['corrections', 'submissions', 'staff_attendance', 'voice_usage', 'face_enrolment'] as const) {
      const before = this.rows(table).length;
      this.tables[table] = this.rows(table).filter((r) => !inScope(String(r.institute_id)));
      out[table] = before - this.rows(table).length;
    }
    if (meta) {
      out.demo_meta = this.rows('demo_meta').length;
      this.tables.demo_meta = [];
    }
    return out;
  }

  subscribe(channel: string, bindings: Subscription['bindings'], onChange: (table: TableName) => void): () => void {
    const sub: Subscription = { channel, bindings, onChange, active: true };
    this.subscriptions.push(sub);
    return () => {
      sub.active = false;
    };
  }

  /** A row changed on the server (another device): fires every active binding for the table. */
  emitChange(table: TableName): void {
    for (const sub of this.subscriptions) if (sub.active && sub.bindings.some((b) => b.table === table)) sub.onChange(table);
  }

  active(): Subscription[] {
    return this.subscriptions.filter((s) => s.active);
  }
}

const unwrap = (v: SqlValue) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as { json: unknown }).json : (v ?? null));

/** The master data exactly as Task 9 seeded it (same generator), plus OJT and announcements for `today`. */
export function seedMasterData(client: FakeDataClient, today: LocalDate): void {
  const master = buildMasterData(today);
  const rows = masterDataRows(master);
  for (const t of MASTER_TABLES) client.seed(t.table, rows[t.table].map((values) => Object.fromEntries(t.columns.map((c, i) => [c, unwrap(values[i])]))));
  const instituteOfStudent = new Map(client.rows('students').map((s) => [s.id, s.institute_id]));
  client.seed('ojt', master.ojt.map((o) => ({ ...ojtToRow(o), institute_id: instituteOfStudent.get(o.studentIds[0]) })));
  client.seed('announcements', buildAnnouncements(today).map(announcementToRow));
}

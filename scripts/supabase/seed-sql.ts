/**
 * Builds the Supabase master-data seed (Task 9) from the app's own deterministic mock modules, so every id and
 * name in the database equals the mock's. Pure: no I/O. `generate-seed.ts` writes the files; the unit test is
 * tests/unit/supabase-seed-sql.test.ts. Column order and names follow supabase/migrations/*_ksk_schema.sql.
 */
import { createHash } from 'node:crypto';
import type { MasterData } from '@/domain/entities';

export type SqlValue = string | number | boolean | null | undefined | readonly string[] | { readonly json: unknown };

/** One SQL literal. Text uses standard-conforming strings (backslashes are literal), arrays are text[]. */
export function sqlLiteral(value: SqlValue): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`sqlLiteral: ${value} is not a finite number`);
    return String(value);
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return `'${value.replace(/'/g, "''")}'`;
  if (Array.isArray(value)) return value.length ? `array[${value.map((v) => sqlLiteral(v)).join(',')}]::text[]` : "'{}'::text[]";
  return `${sqlLiteral(JSON.stringify((value as { json: unknown }).json))}::jsonb`;
}

export type MasterSeed = Pick<MasterData, 'institutes' | 'trades' | 'subjects' | 'batches' | 'students' | 'staff' | 'timetable'>;
export type MasterTable = 'institutes' | 'subjects' | 'trades' | 'batches' | 'students' | 'staff' | 'timetable';

/** How a column is rendered for the fingerprint, identically in SQL and here. */
type FingerprintKind = 'value' | 'array' | 'lat' | 'lng' | 'json';

interface TableSpec {
  readonly table: MasterTable;
  readonly columns: readonly string[];
  readonly fingerprint: readonly FingerprintKind[];
  /** Whether rows carry institute_id (subjects are shared across institutes). */
  readonly owned: boolean;
}

const spec = (table: MasterTable, cols: ReadonlyArray<readonly [string, FingerprintKind]>, owned = true): TableSpec => ({
  table,
  columns: cols.map(([c]) => c),
  fingerprint: cols.map(([, k]) => k),
  owned,
});

/** Master tables in foreign-key order. */
export const MASTER_TABLES: readonly TableSpec[] = [
  spec('institutes', [['id', 'value'], ['code', 'value'], ['name', 'value'], ['short_name', 'value'], ['district', 'value'], ['locality', 'value'], ['location', 'lat'], ['shift_windows', 'json']]),
  spec('subjects', [['id', 'value'], ['name', 'value']], false),
  spec('trades', [['id', 'value'], ['institute_id', 'value'], ['name', 'value'], ['duration_years', 'value']]),
  spec('batches', [['id', 'value'], ['institute_id', 'value'], ['trade_id', 'value'], ['shift', 'value'], ['unit', 'value'], ['year', 'value']]),
  spec('students', [['id', 'value'], ['institute_id', 'value'], ['batch_id', 'value'], ['roll_no', 'value'], ['name', 'value'], ['father_name', 'value']]),
  spec('staff', [
    ['id', 'value'], ['institute_id', 'value'], ['trainer_id', 'value'], ['name', 'value'], ['role', 'value'], ['employment_type', 'value'], ['designation', 'value'],
    ['primary_trade_id', 'value'], ['secondary_trade_ids', 'array'], ['batch_ids', 'array'], ['subject_id', 'value'], ['multi_trade_allowed', 'value'],
  ]),
  spec('timetable', [
    ['id', 'value'], ['institute_id', 'value'], ['batch_id', 'value'], ['instructor_id', 'value'], ['weekday', 'value'], ['period_no', 'value'], ['kind', 'value'],
    ['window_start', 'value'], ['window_end', 'value'], ['subject_id', 'value'],
  ]),
];

const lookup = <T extends { readonly id: string }>(items: readonly T[], what: string) => {
  const byId = new Map(items.map((i) => [i.id, i]));
  return (id: string): T => {
    const found = byId.get(id);
    if (!found) throw new Error(`seed: ${what} ${id} not found`);
    return found;
  };
};

/** Row values per table, in MASTER_TABLES column order. Throws when a row points at a missing parent. */
export function masterDataRows(m: MasterSeed): Record<MasterTable, SqlValue[][]> {
  const trade = lookup(m.trades, 'trade');
  const batch = lookup(m.batches, 'batch');
  const instituteOfBatch = (batchId: string) => trade(batch(batchId).tradeId).instituteId;
  return {
    institutes: m.institutes.map((i) => [i.id, i.code, i.name, i.shortName, i.district, i.locality, { json: i.location }, i.shiftWindows ? { json: i.shiftWindows } : null]),
    subjects: m.subjects.map((s) => [s.id, s.name]),
    trades: m.trades.map((t) => [t.id, t.instituteId, t.name, t.durationYears]),
    batches: m.batches.map((b) => [b.id, trade(b.tradeId).instituteId, b.tradeId, b.shift, b.unit, b.year]),
    students: m.students.map((s) => [s.id, instituteOfBatch(s.batchId), s.batchId, s.rollNo, s.name, s.fatherName]),
    staff: m.staff.map((s) => [
      s.id, s.instituteId, s.trainerId, s.name, s.role, s.employmentType, s.designation,
      s.primaryTradeId ?? null, [...s.secondaryTradeIds], [...s.batchIds], s.subjectId ?? null, s.multiTradeAllowed,
    ]),
    timetable: m.timetable.map((t) => [
      t.id, instituteOfBatch(t.batchId), t.batchId, t.instructorId, t.weekday, t.periodNo, t.kind, t.window.start, t.window.end, t.subjectId ?? null,
    ]),
  };
}

const CHUNK_ROWS = 100;

function upserts(t: TableSpec, rows: readonly SqlValue[][]): string[] {
  const statements: string[] = [];
  const updates = t.columns.filter((c) => c !== 'id').map((c) => `${c}=excluded.${c}`).join(',');
  for (let i = 0; i < rows.length; i += CHUNK_ROWS) {
    const values = rows.slice(i, i + CHUNK_ROWS).map((r) => `(${r.map(sqlLiteral).join(',')})`).join(',\n');
    statements.push(`insert into public.${t.table} (${t.columns.join(',')}) values\n${values}\non conflict (id) do update set ${updates};\n`);
  }
  return statements;
}

/** The whole seed as SQL: upserts by id (re-runnable), tables in foreign-key order, at most 100 rows per statement. */
export function masterDataSql(m: MasterSeed, title = 'master data from src/data/mock/*'): string {
  const rows = masterDataRows(m);
  const header = `-- Generated by scripts/supabase/generate-seed.ts (${title}). Do not edit by hand.\n`;
  return header + MASTER_TABLES.flatMap((t) => upserts(t, rows[t.table])).join('');
}

const canonicalValue = (kind: FingerprintKind, v: SqlValue): string => {
  if (kind === 'array') return (v as readonly string[]).join(',');
  if (kind === 'lat') {
    const p = (v as { json: { lat: number; lng: number } }).json;
    return `${p.lat}|${p.lng}`;
  }
  if (kind === 'json') {
    if (v !== null && v !== undefined) throw new Error('fingerprint: only null json columns are supported');
    return '';
  }
  return v === null || v === undefined ? '' : String(v);
};

/** Per table: row count and md5 of the rows sorted by id, fields joined by '|', rows by '\n'. */
export function localFingerprints(m: MasterSeed): Record<MasterTable, { count: number; md5: string }> {
  const rows = masterDataRows(m);
  const out = {} as Record<MasterTable, { count: number; md5: string }>;
  for (const t of MASTER_TABLES) {
    const lines = rows[t.table]
      .map((r) => r.map((v, i) => canonicalValue(t.fingerprint[i], v)).join('|'))
      .sort((a, b) => {
        const ia = a.slice(0, a.indexOf('|'));
        const ib = b.slice(0, b.indexOf('|'));
        return ia < ib ? -1 : ia > ib ? 1 : 0;
      });
    out[t.table] = { count: lines.length, md5: createHash('md5').update(lines.join('\n')).digest('hex') };
  }
  return out;
}

const sqlExpr = (column: string, kind: FingerprintKind): string => {
  if (kind === 'array') return `array_to_string(${column},',')`;
  if (kind === 'lat') return `(${column}->>'lat')||'|'||(${column}->>'lng')`;
  if (kind === 'json') return `coalesce(${column}::text,'')`;
  return `coalesce(${column}::text,'')`;
};

/** One query returning {table: {count, md5}} computed like localFingerprints, for the given institutes. */
export function fingerprintQuery(instituteIds: readonly string[]): string {
  const ids = instituteIds.map((id) => sqlLiteral(id)).join(',');
  const parts = MASTER_TABLES.map((t) => {
    const line = t.columns.map((c, i) => sqlExpr(c, t.fingerprint[i])).join(`||'|'||`);
    const where = t.table === 'institutes' ? ` where id in (${ids})` : t.owned ? ` where institute_id in (${ids})` : '';
    return `'${t.table}',(select jsonb_build_object('count',count(*),'md5',md5(coalesce(string_agg(${line},E'\\n' order by id collate "C"),''))) from public.${t.table}${where})`;
  });
  return `select jsonb_build_object(\n${parts.join(',\n')}\n) as fingerprints;`;
}

/** The live smoke-test institute (code 99999). Ids never clash with the mock's. */
export const TEST_INSTITUTE: MasterSeed = {
  institutes: [
    { id: 'inst-99999', code: '99999', name: 'Test Industrial Training Institute (live smoke test)', shortName: 'Test ITI', district: 'Test District', locality: 'Test', location: { lat: 18.52, lng: 73.8567 } },
  ],
  subjects: [],
  trades: [{ id: 'tst', instituteId: 'inst-99999', name: 'Test Trade', durationYears: 1 }],
  batches: [{ id: 'tst-s1u1', tradeId: 'tst', shift: 1, unit: 1, year: 1 }],
  students: [
    { id: 'tst-s1u1-r01', batchId: 'tst-s1u1', rollNo: 1, name: 'Test Student One', fatherName: 'Test Father One' },
    { id: 'tst-s1u1-r02', batchId: 'tst-s1u1', rollNo: 2, name: 'Test Student Two', fatherName: 'Test Father Two' },
    { id: 'tst-s1u1-r03', batchId: 'tst-s1u1', rollNo: 3, name: 'Test Student Three', fatherName: 'Test Father Three' },
  ],
  staff: [
    {
      id: 'st-tst', instituteId: 'inst-99999', trainerId: 'TR-99001', name: 'Test Instructor', role: 'instructor', employmentType: 'regular',
      designation: 'Craft Instructor', primaryTradeId: 'tst', secondaryTradeIds: [], batchIds: ['tst-s1u1'], multiTradeAllowed: false,
    },
  ],
  timetable: [],
};

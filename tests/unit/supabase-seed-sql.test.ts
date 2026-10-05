import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { INSTITUTES } from '@/data/mock/institutes';
import { STAFF } from '@/data/mock/staff';
import { STUDENTS } from '@/data/mock/students';
import { TIMETABLE } from '@/data/mock/timetable';
import { BATCHES, SUBJECTS, TRADES } from '@/data/mock/trades';
import {
  MASTER_TABLES,
  TEST_INSTITUTE,
  fingerprintQuery,
  localFingerprints,
  masterDataRows,
  masterDataSql,
  sqlLiteral,
} from '../../scripts/supabase/seed-sql';

const MOCK = { institutes: INSTITUTES, trades: TRADES, subjects: SUBJECTS, batches: BATCHES, students: STUDENTS, staff: STAFF, timetable: TIMETABLE };

describe('sqlLiteral', () => {
  it('quotes text and doubles single quotes', () => {
    expect(sqlLiteral("D'Souza")).toBe("'D''Souza'");
    expect(sqlLiteral('back\\slash')).toBe("'back\\slash'");
  });
  it('renders null, numbers, booleans, text arrays and jsonb', () => {
    expect(sqlLiteral(null)).toBe('null');
    expect(sqlLiteral(undefined)).toBe('null');
    expect(sqlLiteral(18.5602)).toBe('18.5602');
    expect(sqlLiteral(true)).toBe('true');
    expect(sqlLiteral([])).toBe("'{}'::text[]");
    expect(sqlLiteral(['ele-s1u1', "o'k"])).toBe("array['ele-s1u1','o''k']::text[]");
    expect(sqlLiteral({ json: { lat: 1.5, name: "it's" } })).toBe('\'{"lat":1.5,"name":"it\'\'s"}\'::jsonb');
  });
  it('rejects values that would not round-trip', () => {
    expect(() => sqlLiteral(Number.NaN)).toThrow();
  });
});

describe('masterDataRows', () => {
  const rows = masterDataRows(MOCK);

  it('has one row per mock entity, in foreign-key order', () => {
    expect(MASTER_TABLES.map((t) => t.table)).toEqual(['institutes', 'subjects', 'trades', 'batches', 'students', 'staff', 'timetable']);
    expect(rows.institutes).toHaveLength(2);
    expect(rows.trades).toHaveLength(TRADES.length);
    expect(rows.subjects).toHaveLength(1);
    expect(rows.batches).toHaveLength(18);
    expect(rows.students).toHaveLength(STUDENTS.length);
    expect(rows.staff).toHaveLength(STAFF.length);
    expect(rows.timetable).toHaveLength(TIMETABLE.length);
  });

  it('keeps the app ids and puts the owning institute on batches, students and timetable rows', () => {
    const cols = (table: string) => MASTER_TABLES.find((t) => t.table === table)!.columns;
    const student = rows.students.find((r) => r[0] === 'ele-s1u2-r02')!;
    expect(Object.fromEntries(cols('students').map((c, i) => [c, student[i]]))).toEqual({
      id: 'ele-s1u2-r02', institute_id: 'inst-27410', batch_id: 'ele-s1u2', roll_no: 2, name: 'Aditi Joshi', father_name: 'Nitin Joshi',
    });
    const nashikBatch = rows.batches.find((r) => r[0] === 'nsk-ele-s1u1')!;
    expect(nashikBatch[cols('batches').indexOf('institute_id')]).toBe('inst-27613');
    const es = rows.timetable.find((r) => r[0] === 'tt-ele-s1u1-d1-p3')!;
    expect(Object.fromEntries(cols('timetable').map((c, i) => [c, es[i]]))).toMatchObject({
      institute_id: 'inst-27410', instructor_id: 'st-meera', weekday: 1, period_no: 3, kind: 'theory', window_start: '10:00', window_end: '11:00', subject_id: 'es',
    });
  });

  it('maps every staff field, with empty arrays and nulls where the app has none', () => {
    const cols = MASTER_TABLES.find((t) => t.table === 'staff')!.columns;
    const anil = Object.fromEntries(cols.map((c, i) => [c, rows.staff.find((r) => r[0] === 'st-anil')![i]]));
    expect(anil).toEqual({
      id: 'st-anil', institute_id: 'inst-27410', trainer_id: 'PR-2741', name: 'Dr. Anil Deshmukh', role: 'principal', employment_type: 'regular',
      designation: 'Principal', primary_trade_id: null, secondary_trade_ids: [], batch_ids: [], subject_id: null, multi_trade_allowed: false,
    });
  });

  it('fails loudly when a row points at a missing parent', () => {
    expect(() => masterDataRows({ ...MOCK, trades: TRADES.filter((t) => t.id !== 'ele') })).toThrow(/ele/);
  });
});

describe('masterDataSql', () => {
  const sql = masterDataSql(MOCK);

  it('is deterministic and upserts by id so it can be re-run', () => {
    expect(masterDataSql(MOCK)).toBe(sql);
    expect(sql).toContain('insert into public.students (id,institute_id,batch_id,roll_no,name,father_name) values');
    expect(sql).toMatch(/on conflict \(id\) do update set institute_id=excluded\.institute_id,batch_id=excluded\.batch_id/);
  });

  it('splits large tables into statements of at most 100 rows', () => {
    const studentStatements = sql.split(';\n').filter((s) => s.includes('insert into public.students'));
    expect(studentStatements).toHaveLength(Math.ceil(STUDENTS.length / 100));
    for (const s of studentStatements) expect(s.split('\n').filter((l) => l.startsWith('(')).length).toBeLessThanOrEqual(100);
  });

  it('writes tables in foreign-key order', () => {
    const first = (t: string) => sql.indexOf(`insert into public.${t} `);
    expect(first('institutes')).toBeLessThan(first('trades'));
    expect(first('trades')).toBeLessThan(first('batches'));
    expect(first('batches')).toBeLessThan(first('students'));
    expect(first('staff')).toBeLessThan(first('timetable'));
  });
});

describe('TEST_INSTITUTE', () => {
  it('is code 99999 with one trade, one batch, three students and one instructor, none clashing with the mock', () => {
    const t = TEST_INSTITUTE;
    expect(t.institutes.map((i) => i.code)).toEqual(['99999']);
    expect([t.trades.length, t.batches.length, t.students.length, t.staff.length]).toEqual([1, 1, 3, 1]);
    expect(t.staff[0].role).toBe('instructor');
    const mockIds = new Set([...INSTITUTES, ...TRADES, ...BATCHES, ...STUDENTS, ...STAFF].map((e) => e.id));
    for (const e of [...t.institutes, ...t.trades, ...t.batches, ...t.students, ...t.staff]) expect(mockIds.has(e.id)).toBe(false);
    expect(() => masterDataRows(t)).not.toThrow();
  });
});

describe('fingerprints', () => {
  it('hashes the canonical rows the same way the SQL query does', () => {
    const fp = localFingerprints(MOCK);
    const canonical = [...STUDENTS]
      .sort((a, b) => (a.id < b.id ? -1 : 1))
      .map((s) => [s.id, 'inst-' + (s.batchId.startsWith('nsk') ? '27613' : '27410'), s.batchId, s.rollNo, s.name, s.fatherName].join('|'))
      .join('\n');
    expect(fp.students).toEqual({ count: STUDENTS.length, md5: createHash('md5').update(canonical).digest('hex') });
    expect(Object.keys(fp)).toEqual(MASTER_TABLES.map((t) => t.table));
  });

  it('builds one query covering every master table, ordered by id in C collation', () => {
    const q = fingerprintQuery(['inst-27410', 'inst-27613']);
    for (const t of MASTER_TABLES) expect(q).toContain(`from public.${t.table}`);
    expect(q).toContain('order by id collate "C"');
    expect(q).toContain("location->>'lat'");
  });
});

describe('Task 17: the committed seed files match the mock modules (no drift)', () => {
  const committed = (path: string) => readFileSync(fileURLToPath(new URL(`../../supabase/${path}`, import.meta.url)), 'utf8');
  const regenerate = 'regenerate with: npx vitest run --config scripts/supabase/vitest.seed.config.mts';
  it('supabase/seed/master-data.sql is what the generator writes from src/data/mock/*', () => {
    expect(committed('seed/master-data.sql') === masterDataSql(MOCK), regenerate).toBe(true);
  });
  it('the smoke-test institute and the fingerprint query too', () => {
    expect(committed('seed/test-institute.sql') === masterDataSql(TEST_INSTITUTE, 'the live smoke-test institute, code 99999'), regenerate).toBe(true);
    expect(committed('checks/master-fingerprints.sql') === `${fingerprintQuery(INSTITUTES.map((i) => i.id))}\n`, regenerate).toBe(true);
  });
});

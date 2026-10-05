/**
 * Writes the Supabase seed SQL from the app's mock modules (Task 9):
 *   supabase/seed/master-data.sql      institutes, subjects, trades, batches, students, staff, timetable
 *   supabase/seed/test-institute.sql   the live smoke-test institute (code 99999)
 *   supabase/checks/master-fingerprints.sql  the query whose result must equal the fingerprints printed here
 * Run: npx vitest run --config scripts/supabase/vitest.seed.config.mts
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { INSTITUTES } from '@/data/mock/institutes';
import { STAFF } from '@/data/mock/staff';
import { STUDENTS } from '@/data/mock/students';
import { TIMETABLE } from '@/data/mock/timetable';
import { BATCHES, SUBJECTS, TRADES } from '@/data/mock/trades';
import { TEST_INSTITUTE, fingerprintQuery, localFingerprints, masterDataSql, type MasterSeed } from './seed-sql';

const MOCK: MasterSeed = { institutes: INSTITUTES, trades: TRADES, subjects: SUBJECTS, batches: BATCHES, students: STUDENTS, staff: STAFF, timetable: TIMETABLE };
const out = (path: string) => fileURLToPath(new URL(`../../supabase/${path}`, import.meta.url));

test('write the Supabase seed files', () => {
  writeFileSync(out('seed/master-data.sql'), masterDataSql(MOCK));
  writeFileSync(out('seed/test-institute.sql'), masterDataSql(TEST_INSTITUTE, 'the live smoke-test institute, code 99999'));
  writeFileSync(out('checks/master-fingerprints.sql'), `${fingerprintQuery(INSTITUTES.map((i) => i.id))}\n`);
  const fingerprints = localFingerprints(MOCK);
  console.info(JSON.stringify(fingerprints));
  expect(fingerprints.students.count).toBe(STUDENTS.length);
});

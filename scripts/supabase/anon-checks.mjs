/**
 * Live RLS checks as the anon role (Task 9, D-144), against the Supabase REST endpoint.
 * Reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from .env.development.local (git-ignored)
 * and never prints the key. Writes to the test institute (99999, batch tst-s1u1, instructor st-tst) only: one submission
 * and one correction per run, and one staff_attendance row per day (a re-run the same day finds it and gets 409). Anon
 * cannot remove them (by design), so cleanup needs the owner-run ksk_cleanup_test_institute() function.
 * Run: node scripts/supabase/anon-checks.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../../.env.development.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((line) => /^[A-Z_]+=/.test(line))
    .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1).trim()]),
);
const base = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1`;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!env.NEXT_PUBLIC_SUPABASE_URL || !key) throw new Error('Supabase URL or publishable key missing from .env.development.local');

const headers = (extra = {}) => ({ apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...extra });
async function call(method, path, body, extra) {
  const res = await fetch(`${base}/${path}`, { method, headers: headers(extra), body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json, range: res.headers.get('content-range') };
}

const results = [];
function check(name, pass, detail) {
  results.push({ name, pass, detail });
  console.info(`${pass ? 'PASS' : 'FAIL'}  ${name}  (${detail})`);
}

const stamp = new Date().toISOString();
const today = stamp.slice(0, 10);
const id = `smoke-${Date.now()}`;
const submission = {
  id,
  session_key: `tst-s1u1|${today}|smoke-${Date.now()}`,
  batch_id: 'tst-s1u1',
  date: today,
  slot: { kind: 'daily' },
  subject_id: null,
  marks: { 'tst-s1u1-r01': 'present', 'tst-s1u1-r02': 'absent', 'tst-s1u1-r03': 'present' },
  marked_by: 'st-tst',
  device_timestamp: stamp,
  location: null,
};

// 1. Master data is readable.
for (const [table, filter, expected] of [
  ['institutes', 'select=id', 3],
  ['students', 'select=id&institute_id=eq.inst-27410', 417],
  ['batches', 'select=id&institute_id=eq.inst-27410', 17],
  ['timetable', 'select=id', 504],
]) {
  const r = await call('GET', `${table}?${filter}&limit=1`, null, { Prefer: 'count=exact' });
  const total = Number(r.range?.split('/')[1]);
  // A ranged read with an exact count answers 206 Partial Content when more rows exist than the range returns.
  check(`anon SELECT ${table}`, (r.status === 200 || r.status === 206) && total === expected, `HTTP ${r.status}, count ${total}, expected ${expected}`);
}

// 2. Anon inserts a submission on the test institute; the server fills institute_id and stamps server_timestamp.
const ins = await call('POST', 'submissions', submission, { Prefer: 'return=representation' });
const row = Array.isArray(ins.json) ? ins.json[0] : null;
check('anon INSERT submission (test institute)', ins.status === 201 && row?.institute_id === 'inst-99999' && row?.origin === 'app',
  `HTTP ${ins.status}, institute_id ${row?.institute_id}, origin ${row?.origin}`);

// 3. Write-once: the same session_key again is a conflict.
const dup = await call('POST', 'submissions', { ...submission, id: `${id}-dup` });
check('anon INSERT duplicate session_key rejected', dup.status === 409, `HTTP ${dup.status}, code ${dup.json?.code}`);

// 4. Anon cannot forge seeded history.
const forged = await call('POST', 'submissions', { ...submission, id: `${id}-seed`, session_key: `${submission.session_key}-seed`, origin: 'seed' });
check("anon INSERT origin='seed' rejected", forged.status === 401 || forged.status === 403, `HTTP ${forged.status}, code ${forged.json?.code}`);

// 5. Anon cannot UPDATE or DELETE a submission.
const upd = await call('PATCH', `submissions?id=eq.${id}`, { marks: { 'tst-s1u1-r01': 'absent' } }, { Prefer: 'return=representation' });
check('anon UPDATE submission rejected', upd.status === 401 || upd.status === 403, `HTTP ${upd.status}, code ${upd.json?.code}`);
const del = await call('DELETE', `submissions?id=eq.${id}`, null, { Prefer: 'return=representation' });
check('anon DELETE submission rejected', del.status === 401 || del.status === 403, `HTTP ${del.status}, code ${del.json?.code}`);

// 6. The row is still there, unchanged.
const after = await call('GET', `submissions?id=eq.${id}&select=id,marks`);
const kept = Array.isArray(after.json) && after.json.length === 1 && after.json[0].marks['tst-s1u1-r01'] === 'present';
check('submission unchanged after UPDATE/DELETE attempts', kept, `HTTP ${after.status}, rows ${Array.isArray(after.json) ? after.json.length : '?'}`);

// 7. Master data is read-only for anon.
const master = await call('PATCH', 'students?id=eq.tst-s1u1-r01', { name: 'Changed' });
check('anon UPDATE master data rejected', master.status === 401 || master.status === 403, `HTTP ${master.status}, code ${master.json?.code}`);

// 8. Corrections are append-only: anon appends one, then cannot UPDATE or DELETE it.
const correctionId = `${id}-corr`;
const corr = await call('POST', 'corrections', {
  correction_id: correctionId,
  attendance_id: id,
  student_id: 'tst-s1u1-r02',
  old_mark: { status: 'absent' },
  new_mark: { status: 'present' },
  reason: 'smoke check',
  reason_code: 'mistake',
  actor_id: 'st-tst',
  timestamp: stamp,
}, { Prefer: 'return=representation' });
const corrRow = Array.isArray(corr.json) ? corr.json[0] : null;
check('anon INSERT correction (test institute)', corr.status === 201 && corrRow?.institute_id === 'inst-99999',
  `HTTP ${corr.status}, institute_id ${corrRow?.institute_id}, code ${corr.json?.code ?? '-'}`);
const corrUpd = await call('PATCH', `corrections?correction_id=eq.${correctionId}`, { reason: 'changed' }, { Prefer: 'return=representation' });
check('anon UPDATE correction rejected', (corrUpd.status === 401 || corrUpd.status === 403) && corrUpd.json?.code === '42501',
  `HTTP ${corrUpd.status}, code ${corrUpd.json?.code}`);
const corrDel = await call('DELETE', `corrections?correction_id=eq.${correctionId}`, null, { Prefer: 'return=representation' });
check('anon DELETE correction rejected', (corrDel.status === 401 || corrDel.status === 403) && corrDel.json?.code === '42501',
  `HTTP ${corrDel.status}, code ${corrDel.json?.code}`);
const corrAfter = await call('GET', `corrections?correction_id=eq.${correctionId}&select=correction_id,reason`);
check('correction unchanged after UPDATE/DELETE attempts',
  Array.isArray(corrAfter.json) && corrAfter.json.length === 1 && corrAfter.json[0].reason === 'smoke check',
  `HTTP ${corrAfter.status}, rows ${Array.isArray(corrAfter.json) ? corrAfter.json.length : '?'}`);

// 9. One staff mark per person per day: UNIQUE(staff_id, date), and no UPDATE or DELETE for anon.
const staffId = `smoke-staff-st-tst-${today}`;
const staffMark = { staff_id: 'st-tst', date: today, status: 'present', source: 'self', marked_by: 'st-tst', device_timestamp: stamp, location: null };
const staffIns = await call('POST', 'staff_attendance', { id: staffId, ...staffMark });
// A re-run on the same day finds today's row already there (409); either way the row exists afterwards.
check('anon INSERT staff_attendance (test institute, once a day)', staffIns.status === 201 || staffIns.status === 409,
  `HTTP ${staffIns.status}${staffIns.status === 409 ? ' (already marked today by an earlier run)' : ''}`);
const staffDup = await call('POST', 'staff_attendance', { id: `${id}-staff-dup`, ...staffMark, status: 'absent' });
check('anon INSERT second staff mark same day rejected', staffDup.status === 409 && staffDup.json?.code === '23505',
  `HTTP ${staffDup.status}, code ${staffDup.json?.code}`);
const staffUpd = await call('PATCH', `staff_attendance?id=eq.${staffId}`, { status: 'absent' }, { Prefer: 'return=representation' });
check('anon UPDATE staff_attendance rejected', (staffUpd.status === 401 || staffUpd.status === 403) && staffUpd.json?.code === '42501',
  `HTTP ${staffUpd.status}, code ${staffUpd.json?.code}`);
const staffDel = await call('DELETE', `staff_attendance?id=eq.${staffId}`, null, { Prefer: 'return=representation' });
check('anon DELETE staff_attendance rejected', (staffDel.status === 401 || staffDel.status === 403) && staffDel.json?.code === '42501',
  `HTTP ${staffDel.status}, code ${staffDel.json?.code}`);
const staffAfter = await call('GET', `staff_attendance?staff_id=eq.st-tst&date=eq.${today}&select=id,status`);
check('staff mark unchanged after UPDATE/DELETE attempts',
  Array.isArray(staffAfter.json) && staffAfter.json.length === 1 && staffAfter.json[0].id === staffId && staffAfter.json[0].status === 'present',
  `HTTP ${staffAfter.status}, rows ${Array.isArray(staffAfter.json) ? staffAfter.json.length : '?'}`);

const failed = results.filter((r) => !r.pass).length;
console.info(`${results.length - failed}/${results.length} checks passed; smoke submission id ${id}`);
process.exitCode = failed ? 1 : 0;

/**
 * Task 11: the demo's daily story on Supabase. The seeder builds the payload of `ksk_seed_day` from the app's own
 * generators (history for the days the server has not seen, today's story, yesterday's correction, OJT and
 * announcements relative to today) and calls the function once a day; Reset calls `ksk_reset_demo`, which the
 * owner applies by hand, so a missing function is an expected answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildAnnouncements } from '@/data/mock/announcements';
import { historicalSubmission } from '@/data/mock/history';
import { buildMasterData, buildSeed } from '@/data/mock/seeds';
import { STAFF } from '@/data/mock/staff';
import { buildSeedPayload, ensureDemoDay, resetSharedDemo } from '@/demo/supabase-seeder';
import { addDays, dayOfWeek } from '@/lib/time';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25'; // a Friday
const YESTERDAY = '2026-09-24';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

/** A fresh project: master data only (OJT and announcements come from the seeder). */
function project(): FakeDataClient {
  const client = new FakeDataClient();
  seedMasterData(client, TODAY);
  client.tables.ojt = [];
  client.tables.announcements = [];
  return client;
}

const dates = (rows: ReadonlyArray<Record<string, unknown>>) => [...new Set(rows.map((r) => String(r.date)))].sort();

describe('buildSeedPayload', () => {
  it('a server that was never seeded gets 45 days of history, today\'s story, yesterday\'s correction, OJT, notices and faces', () => {
    const p = buildSeedPayload(TODAY, null);
    expect(p.day).toBe(TODAY);
    const history = p.submissions.filter((s) => String(s.id).startsWith('hist-'));
    const days = dates(history);
    expect(days[0]).toBe(addDays(TODAY, -45));
    expect(days.at(-1)).toBe(YESTERDAY);
    expect(days.every((d) => dayOfWeek(d) !== 0)).toBe(true);
    // Every batch's daily record and the Employability Skills sessions, exactly as the mock generates them.
    for (const id of ['ele-s1u2', 'nsk-ele-s1u1', 'copa-s2u1']) expect(history.some((s) => s.id === historicalSubmission(id, YESTERDAY, TODAY)?.id)).toBe(true);
    expect(history.some((s) => s.id === historicalSubmission('ele-s1u1', YESTERDAY, TODAY, 'es')?.id)).toBe(true);
    // Rows carry the schema's column names and the history's own times.
    const sample = history.find((s) => s.id === `hist-ele-s1u2-${YESTERDAY}`)!;
    const domain = historicalSubmission('ele-s1u2', YESTERDAY, TODAY)!;
    expect(sample).toMatchObject({ session_key: domain.sessionKey, batch_id: 'ele-s1u2', date: YESTERDAY, slot: { kind: 'daily' }, marks: domain.marks, marked_by: domain.markedBy, device_timestamp: domain.deviceTimestamp, server_timestamp: domain.serverTimestamp });

    const story = buildSeed(TODAY);
    for (const s of story.submissions) expect(p.submissions).toContainEqual(expect.objectContaining({ id: s.id, session_key: s.sessionKey, server_timestamp: s.serverTimestamp }));
    for (const r of story.staffRecords) expect(p.staff_attendance).toContainEqual(expect.objectContaining({ id: r.id, staff_id: r.staffId, date: TODAY, source: 'self' }));
    expect(dates(p.staff_attendance)).toHaveLength(days.length + 1);

    expect(p.corrections).toEqual([
      expect.objectContaining({ correction_id: `corr-seed-kiran-${YESTERDAY}`, attendance_id: `hist-fit-s1u1-${YESTERDAY}`, student_id: 'fit-s1u1-r04', old_mark: { status: 'absent' }, new_mark: { status: 'present' }, reason_code: 'late', actor_id: 'st-anil' }),
    ]);
    expect(p.ojt.map((o) => o.id).sort()).toEqual(buildMasterData(TODAY).ojt.map((o) => o.id).sort());
    expect(p.ojt.find((o) => o.id === 'ojt-ele-s1u2-pair')).toMatchObject({ from_date: addDays(TODAY, -3), to_date: addDays(TODAY, 11) });
    expect(p.announcements.map((a) => a.id)).toEqual(buildAnnouncements(TODAY).map((a) => a.id));
    expect(p.face_enrolment.map((f) => f.staff_id).sort()).toEqual(STAFF.map((s) => s.id).sort());
  });

  it('after an earlier seeding, only the days from that day on are added (that day\'s story kept its own records)', () => {
    const p = buildSeedPayload(TODAY, '2026-09-20');
    expect(dates(p.submissions.filter((s) => String(s.id).startsWith('hist-')))).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
    expect(dates(p.staff_attendance.filter((s) => String(s.id).startsWith('hist-')))).toEqual(['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24']);
  });

  it('seeded yesterday: yesterday\'s story owns Fitter Unit 1, so the correction goes to that record and to a trainee absent there', () => {
    const p = buildSeedPayload(TODAY, YESTERDAY);
    expect(dates(p.submissions.filter((s) => String(s.id).startsWith('hist-')))).toEqual([YESTERDAY]);
    const record = buildSeed(YESTERDAY).submissions.find((s) => s.sessionKey === `fit-s1u1.${YESTERDAY}.daily`)!;
    const absent = Object.keys(record.marks).find((id) => record.marks[id].status === 'absent')!;
    expect(p.corrections).toEqual([expect.objectContaining({ correction_id: `corr-seed-kiran-${YESTERDAY}`, attendance_id: record.id, student_id: absent, old_mark: { status: 'absent' }, new_mark: { status: 'present' } })]);
  });

  it('a Monday has no correction: Sunday has no records to correct', () => {
    expect(buildSeedPayload('2026-09-28', null).corrections).toEqual([]);
  });
});

describe('ensureDemoDay', () => {
  it('seeds a fresh server once; the next start the same day only reads demo_meta', async () => {
    const client = project();
    expect(await ensureDemoDay(client, TODAY)).toMatchObject({ kind: 'seeded' });
    expect(client.rpcs.map((r) => r.fn)).toEqual(['ksk_seed_day']);
    expect(client.rows('demo_meta')).toEqual([expect.objectContaining({ key: 'seeded_day', value: TODAY })]);
    expect(client.rows('corrections')).toHaveLength(1);
    expect(client.rows('announcements')).toHaveLength(buildAnnouncements(TODAY).length);
    expect(client.rows('submissions').every((s) => s.origin === 'seed' && s.institute_id)).toBe(true);
    const counts = (['submissions', 'staff_attendance', 'face_enrolment'] as const).map((t) => client.rows(t).length);

    expect(await ensureDemoDay(client, TODAY)).toEqual({ kind: 'current' });
    expect(client.rpcs).toHaveLength(1);
    expect((['submissions', 'staff_attendance', 'face_enrolment'] as const).map((t) => client.rows(t).length)).toEqual(counts);
  });

  it('two devices starting at once both seed, harmlessly: every record exists once', async () => {
    const alone = project();
    await ensureDemoDay(alone, TODAY);
    const raced = project();
    const outcomes = await Promise.all([ensureDemoDay(raced, TODAY), ensureDemoDay(raced, TODAY)]);
    expect(outcomes.every((o) => o.kind === 'seeded')).toBe(true);
    for (const t of ['submissions', 'corrections', 'staff_attendance', 'ojt', 'announcements', 'face_enrolment'] as const) expect(raced.rows(t).length).toBe(alone.rows(t).length);
  });

  it('the next day adds yesterday\'s history and the new story, and keeps everything already there', async () => {
    const client = project();
    await ensureDemoDay(client, YESTERDAY);
    const before = client.rows('submissions').length;
    expect(await ensureDemoDay(client, TODAY)).toMatchObject({ kind: 'seeded' });
    expect(client.rows('demo_meta')[0]).toMatchObject({ value: TODAY });
    // Yesterday's story records stay; the generated history fills the batches the story did not submit.
    expect(client.rows('submissions').find((s) => s.session_key === `fit-s1u1.${YESTERDAY}.daily`)?.id).toBe(`seed-fit-s1u1.${YESTERDAY}.daily`);
    expect(client.rows('submissions').find((s) => s.session_key === `ele-s2u1.${YESTERDAY}.daily`)?.id).toBe(`hist-ele-s2u1-${YESTERDAY}`);
    expect(client.rows('submissions').length).toBeGreaterThan(before);
    expect(client.rows('corrections').map((c) => c.correction_id).sort()).toEqual([`corr-seed-kiran-${addDays(YESTERDAY, -1)}`, `corr-seed-kiran-${YESTERDAY}`]);
  });

  it('a correction whose record lost to another row is left out instead of failing the whole day', async () => {
    const client = project();
    // Someone submitted Fitter Unit 1 yesterday from the app before the server was ever seeded.
    client.seed('submissions', [{ id: 'att_someone', session_key: `fit-s1u1.${YESTERDAY}.daily`, batch_id: 'fit-s1u1', institute_id: 'inst-27410', date: YESTERDAY, slot: { kind: 'daily' }, marks: {}, marked_by: 'st-sanjay', device_timestamp: '2026-09-24T04:00:00.000Z', origin: 'app' }]);
    expect(await ensureDemoDay(client, TODAY)).toMatchObject({ kind: 'seeded' });
    expect(client.rows('corrections')).toEqual([]);
    expect(client.rows('demo_meta')[0]).toMatchObject({ value: TODAY });
  });

  it('offline: nothing is sent and nothing is thrown', async () => {
    const client = project();
    client.offline = true;
    expect(await ensureDemoDay(client, TODAY)).toEqual({ kind: 'offline' });
    expect(client.rpcs).toEqual([]);
  });
});

describe('resetSharedDemo', () => {
  it('answers "missing" when the owner has not applied the reset function yet, and changes nothing', async () => {
    const client = project();
    await ensureDemoDay(client, TODAY);
    const before = client.rows('submissions').length;
    expect(await resetSharedDemo(client, TODAY)).toBe('missing');
    expect(client.rows('submissions')).toHaveLength(before);
  });

  it('clears the demo institutes, keeps the test institute, and seeds today\'s story again', async () => {
    const client = project();
    client.functions.add('ksk_reset_demo');
    await ensureDemoDay(client, TODAY);
    client.seed('submissions', [{ id: 'att_extra', session_key: `ele-s2u1.${TODAY}.daily`, batch_id: 'ele-s2u1', institute_id: 'inst-27410', date: TODAY, slot: { kind: 'daily' }, marks: {}, marked_by: 'st-rajesh', device_timestamp: '2026-09-25T04:00:00.000Z', origin: 'app' }]);
    client.seed('submissions', [{ id: 'smoke-1', session_key: 'tst-s1u1.2051-01-02.daily', batch_id: 'tst-s1u1', institute_id: 'inst-99999', date: '2051-01-02', slot: { kind: 'daily' }, marks: {}, marked_by: 'st-tst', device_timestamp: '2051-01-02T04:00:00.000Z', origin: 'app' }]);
    expect(await resetSharedDemo(client, TODAY)).toBe('done');
    expect(client.rpcs.map((r) => r.fn)).toEqual(['ksk_seed_day', 'ksk_reset_demo', 'ksk_seed_day']);
    expect(client.rows('submissions').some((s) => s.id === 'att_extra')).toBe(false);
    expect(client.rows('submissions').some((s) => s.id === 'smoke-1')).toBe(true);
    expect(client.rows('submissions').some((s) => s.id === `seed-ele-s1u1.${TODAY}.daily`)).toBe(true);
    expect(client.rows('demo_meta')[0]).toMatchObject({ value: TODAY });
  });

  it('offline: answers "offline"', async () => {
    const client = project();
    client.functions.add('ksk_reset_demo');
    client.offline = true;
    expect(await resetSharedDemo(client, TODAY)).toBe('offline');
  });
});

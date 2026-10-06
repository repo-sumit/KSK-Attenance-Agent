/**
 * Live Supabase smoke test (Task 11, opt-in: `npm run test:supabase-live`). Two "devices" (two containers with their own
 * device stores) run the app's own Supabase repositories and services against the real project, on the test institute
 * 99999 only: master data is read, a batch is submitted and synced, a correction appended, the instructor's own
 * attendance marked, and the second device reads all of it back (and hears about the submission over Realtime). The
 * session date is a unique far-future working day per run, so runs never collide (one record per session and per
 * person per day). Clean-up goes through `ksk_cleanup_test_institute`, limited to institute 99999; until the owner has
 * applied that function the clean-up step is skipped with a note and the rows stay on the test institute.
 * Never prints the key.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { effectiveMarks, type Correction } from '@/domain/attendance';
import { MemoryStore } from '@/lib/kv-store';
import { addDays, dayOfWeek, FixedClock, instantAt, type LocalDate } from '@/lib/time';
import { createSupabaseDataClient } from '@/repositories/supabase/client';
import { eq, isMissingFunction, type DataClient } from '@/repositories/supabase/data-client';
import { createSupabaseContainer, type AppContainer } from '@/services/container';
import type { SessionContext } from '@/services/context';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';

const URL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const KEY_ENV = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
const configured = Boolean(URL_ENV && KEY_ENV);

const INSTITUTE = { id: 'inst-99999', code: '99999' };
const BATCH = 'tst-s1u1';
const TRAINER = { id: 'st-tst', trainerId: 'TR-99001' };
const STUDENTS = ['tst-s1u1-r01', 'tst-s1u1-r02', 'tst-s1u1-r03'];

/** A working day in 2050–2099 with no record of the test batch or instructor yet. */
async function uniqueDate(client: DataClient): Promise<LocalDate> {
  for (let attempt = 0; attempt < 20; attempt++) {
    let date = addDays('2050-01-03', Math.floor(Math.random() * 18_000));
    if (dayOfWeek(date) === 0) date = addDays(date, 1);
    const [subs, staff] = await Promise.all([
      client.select({ table: 'submissions', order: 'id', filters: [eq('batch_id', BATCH), eq('date', date)] }),
      client.select({ table: 'staff_attendance', order: 'id', filters: [eq('staff_id', TRAINER.id), eq('date', date)] }),
    ]);
    if (!subs.ok || !staff.ok) throw new Error('Supabase is not reachable');
    if (!subs.data.length && !staff.data.length) return date;
  }
  throw new Error('no free test date');
}

/** One device: the Supabase container over its own empty device stores, at 10:15 IST on the test date. */
function device(client: DataClient, date: LocalDate): AppContainer {
  const app = createSupabaseContainer({
    store: new MemoryStore(),
    preferencesStore: new MemoryStore(),
    clock: new FixedClock(instantAt(date, '10:15')),
    simulation: new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 }),
    // The test instructor's story: batch-mapped, location checked, no face step (no enrolment on the test institute),
    // and no own-attendance-first step (D-152): the test date has no staff records.
    configOverrides: { get: () => ({ mapping: { model: 'batch' }, verification: { face: false }, staff: { selfBeforeStudents: false } }) },
    client,
    cacheStore: new MemoryStore(),
  });
  app.services.sync.start(); // as boot does: the device database is read (and seeded) before anyone signs in
  return app;
}

/**
 * The Realtime channel joins a moment after sign-in, and a change made before it joined is never delivered. Wait until
 * the device hears a probe: the test instructor's face flag written (test institute only) and kept until it is heard
 * or a few seconds pass, then removed; tried again until it is heard. The flag must stay while Realtime looks at it:
 * with RLS on, Postgres Changes reads an inserted row back by its key before delivering the insert, so a row already
 * deleted is dropped, and the delete itself never passes the channel's institute filter (it carries only the key).
 * Removing the flag at once made the probe a race that was lost for a minute or more. The flag is removed afterwards
 * whatever happens.
 */
async function realtimeJoined(app: AppContainer, client: DataClient): Promise<void> {
  const heard = vi.fn();
  const stop = app.bus.subscribe(['face'], heard);
  try {
    for (let attempt = 0; attempt < 8 && !heard.mock.calls.length; attempt++) {
      // As the app writes face flags: insert-only (anon may insert and delete them, D-144).
      const written = await client.upsert('face_enrolment', { staff_id: TRAINER.id, enrolled_at: new Date().toISOString(), sample_count: 0, simulated: true }, 'staff_id', { ignoreDuplicates: true });
      if (!written.ok) throw new Error(`probe: ${written.error.kind}`);
      await vi.waitFor(() => expect(heard).toHaveBeenCalled(), { timeout: 4_000, interval: 100 }).catch(() => undefined);
      await client.remove('face_enrolment', [eq('staff_id', TRAINER.id)]);
    }
  } finally {
    stop();
    await client.remove('face_enrolment', [eq('staff_id', TRAINER.id)]);
  }
  expect(heard, 'the Realtime channel never joined').toHaveBeenCalled();
}

async function signIn(app: AppContainer): Promise<SessionContext> {
  const inst = await app.services.auth.lookupInstitute(INSTITUTE.code);
  if (!inst.ok) throw new Error(`institute ${INSTITUTE.code}: ${inst.error}`);
  const who = await app.services.auth.lookupInstructor(inst.value.id, TRAINER.trainerId);
  if (!who.ok) throw new Error(`instructor ${TRAINER.trainerId}: ${who.error}`);
  await app.services.auth.startSession(inst.value.id, who.value.id);
  const ctx = await app.services.session.load();
  if (!ctx) throw new Error('session');
  return ctx;
}

describe.skipIf(!configured)('Supabase live smoke (test institute 99999)', () => {
  let client: DataClient;
  let date: LocalDate;
  let key: string;
  let phone: AppContainer;
  let laptop: AppContainer;
  let phoneCtx: SessionContext;
  let laptopCtx: SessionContext;
  let submissionId = '';
  let correction: Correction;

  beforeAll(async () => {
    client = createSupabaseDataClient(URL_ENV!, KEY_ENV!);
    date = await uniqueDate(client);
    key = `${BATCH}.${date}.daily`;
    console.info(`[supabase-live] test date ${date}`);
    phone = device(client, date);
    laptop = device(client, date);
  });

  // Signing out closes each device's Realtime channel.
  afterAll(async () => {
    await phone?.services.auth.signOut();
    await laptop?.services.auth.signOut();
  });

  it('reads the test institute\'s master data from the server', async () => {
    phoneCtx = await signIn(phone);
    expect(phoneCtx.institute).toMatchObject({ id: INSTITUTE.id, code: INSTITUTE.code });
    expect(phoneCtx.user).toMatchObject({ id: TRAINER.id, role: 'instructor' });
    expect(phoneCtx.data.students.filter((s) => s.batchId === BATCH).map((s) => s.id).sort()).toEqual(STUDENTS);
    // Only the test institute's rows: nothing of the demo institutes.
    expect(phoneCtx.data.batches.map((b) => b.id)).toEqual([BATCH]);
    laptopCtx = await signIn(laptop);
  });

  it('submits a batch on one device; it syncs and the other device hears of it over Realtime', async () => {
    await realtimeJoined(laptop, client); // the laptop's channel is joined before the change it must hear
    const heard = vi.fn();
    const stop = laptop.bus.subscribe(['attendance'], heard);
    const card = (await phone.services.attendance.cardsForBatch(phoneCtx, BATCH)).find((c) => c.key === key);
    expect(card?.status).toBe('open');
    const loc = await phone.services.verification.checkLocation(phoneCtx);
    await phone.services.verification.grant(phoneCtx, { kind: 'session', key }, loc.ok ? loc.value : undefined);
    const roster = await phone.services.attendance.openRoster(phoneCtx, key);
    if (!roster.ok) throw new Error(`openRoster: ${roster.error}`);
    const marks = { ...roster.value.marks, [STUDENTS[1]]: { status: 'absent' as const } };
    const submitted = await phone.services.attendance.submit(phoneCtx, key, marks);
    if (!submitted.ok) throw new Error(`submit: ${submitted.error}`);
    submissionId = submitted.value.id;
    await phone.services.sync.syncNow();
    expect(phone.services.sync.status()).toMatchObject({ pending: 0 });
    expect((await phone.repositories.attendance.getSubmission(key))?.syncState).toBe('synced');
    await vi.waitFor(() => expect(heard).toHaveBeenCalled(), { timeout: 25_000, interval: 250 });
    stop();
  });

  it('appends a correction (insert-only) and marks the instructor\'s own attendance', async () => {
    // Through the repository: the correction service allows the principal only, and the test institute has none.
    correction = {
      correctionId: `corr-live-${date}-${Date.now()}`,
      attendanceId: submissionId,
      studentId: STUDENTS[1],
      oldMark: { status: 'absent' },
      newMark: { status: 'present' },
      reason: 'Live smoke test',
      reasonCode: 'late',
      actorId: TRAINER.id,
      timestamp: instantAt(date, '10:20').toISOString(),
    };
    await phone.repositories.corrections.append(correction);
    expect((phone.repositories.corrections as unknown as { pendingCount(): number }).pendingCount()).toBe(0);

    const loc = await phone.services.verification.checkLocation(phoneCtx);
    await phone.services.verification.grant(phoneCtx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    const mine = await phone.services.staffAttendance.markSelf(phoneCtx);
    if (!mine.ok) throw new Error(`markSelf: ${mine.error}`);
    await phone.services.sync.syncNow();
    expect(phone.services.sync.status()).toMatchObject({ pending: 0 });
  });

  it('the other device reads all of it back from the server, on the test institute only', async () => {
    const sub = await laptop.repositories.attendance.getSubmission(key);
    expect(sub).toMatchObject({ id: submissionId, markedBy: TRAINER.id, syncState: 'synced' });
    const corrections = await laptop.repositories.corrections.listForAttendance([submissionId]);
    expect(corrections.map((c) => c.correctionId)).toEqual([correction.correctionId]);
    expect(effectiveMarks(sub!, corrections)[STUDENTS[1]]).toEqual({ status: 'present' });
    expect(await laptop.repositories.staffAttendance.get(TRAINER.id, date)).toMatchObject({ staffId: TRAINER.id, source: 'self', status: 'present' });

    const rows = await Promise.all([
      client.select({ table: 'submissions', order: 'id', filters: [eq('id', submissionId)] }),
      client.select({ table: 'corrections', order: 'correction_id', filters: [eq('correction_id', correction.correctionId)] }),
      client.select({ table: 'staff_attendance', order: 'id', filters: [eq('staff_id', TRAINER.id), eq('date', date)] }),
    ]);
    for (const r of rows) expect(r.ok && r.data.map((row) => row.institute_id)).toEqual([INSTITUTE.id]);
    const elsewhere = await client.select({ table: 'submissions', order: 'id', filters: [eq('date', date)] });
    expect(elsewhere.ok && elsewhere.data.every((row) => row.institute_id === INSTITUTE.id)).toBe(true);
    void laptopCtx;
  });

  it('cleans up through ksk_cleanup_test_institute (limited to institute 99999)', async (ctx) => {
    const result = await client.rpc('ksk_cleanup_test_institute');
    if (!result.ok && isMissingFunction(result.error)) {
      ctx.skip(`ksk_cleanup_test_institute is not on the project yet (the owner applies 20261005041600_ksk_reset_functions.sql); this run's rows stay on institute 99999, date ${date}`);
    }
    expect(result.ok).toBe(true);
    const left = await client.select({ table: 'submissions', order: 'id', filters: [eq('institute_id', INSTITUTE.id)] });
    expect(left.ok && left.data).toEqual([]);
  });
});

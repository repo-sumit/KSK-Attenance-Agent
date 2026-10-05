/**
 * DEMO ONLY. The demo's daily story on the shared Supabase source (D-143). On boot, when `demo_meta.seeded_day` is not
 * today, the payload of `ksk_seed_day` is built from the same generators the device source uses (history for the days
 * the server has not seen yet within the last 45, today's story, yesterday's correction, today's staff records, OJT,
 * announcements and face flags, all relative to today) and the function runs once. It is idempotent (write-once rows
 * ON CONFLICT DO NOTHING), so two devices starting together do no harm. `ksk_reset_demo` is applied by the owner by
 * hand: a missing function is an expected answer, never an error. Loaded by boot.ts only in demo builds.
 */
import { buildAnnouncements } from '@/data/mock/announcements';
import { historicalStaffRecord, historicalSubmission, HISTORY_BATCH_IDS, historyDates, subjectsWithHistory } from '@/data/mock/history';
import { buildMasterData, buildSeed } from '@/data/mock/seeds';
import { STAFF } from '@/data/mock/staff';
import type { AttendanceSubmission, Correction } from '@/domain/attendance';
import { toSessionKey } from '@/domain/attendance';
import { addDays, compareDates, toLocalDate, type LocalDate } from '@/lib/time';
import { eq, FOREIGN_KEY_VIOLATION, isMissingFunction, type DataClient, type Row } from '@/repositories/supabase/data-client';
import { announcementToRow, correctionToRow, faceToRow, ojtToRow, staffRecordToRow, submissionToRow } from '@/repositories/supabase/mappers';
import type { AppContainer } from '@/services/container';

export interface SeedPayload {
  readonly day: LocalDate;
  readonly submissions: Row[];
  readonly corrections: Row[];
  readonly staff_attendance: Row[];
  readonly ojt: Row[];
  readonly announcements: Row[];
  readonly face_enrolment: Row[];
}

export type SeedOutcome = { readonly kind: 'current' } | { readonly kind: 'seeded'; readonly written: unknown } | { readonly kind: 'offline' } | { readonly kind: 'failed'; readonly code: string };

export type ResetOutcome = 'done' | 'missing' | 'offline' | 'failed' | 'unavailable';

/** Seeded history keeps the time it was generated with (the function falls back to the device time). */
const submissionRow = (s: AttendanceSubmission): Row => ({ ...submissionToRow(s), server_timestamp: s.serverTimestamp ?? s.deviceTimestamp });

/** Past days to add: all of the last 45 on a fresh server, else from the last seeded day on (that day only had its story). */
function missingDays(today: LocalDate, seededDay: LocalDate | null): LocalDate[] {
  return historyDates(today).filter((d) => !seededDay || compareDates(d, seededDay) >= 0);
}

/**
 * Yesterday's correction (seeds.ts), with a day-scoped id so each day's entry is its own row. It belongs to yesterday's
 * generated record when this payload adds it; when yesterday was seeded already, yesterday's story owns that session,
 * so the entry goes to the story's record and to a trainee absent in it. Sunday has no record: no correction.
 */
function yesterdaysCorrection(today: LocalDate, seededDay: LocalDate | null, submissions: readonly AttendanceSubmission[]): Correction[] {
  const yesterday = addDays(today, -1);
  const [seed] = buildSeed(today).corrections;
  const id = `${seed.correctionId}-${yesterday}`;
  if (seededDay !== yesterday) return submissions.some((s) => s.id === seed.attendanceId) ? [{ ...seed, correctionId: id }] : [];
  const story = buildSeed(yesterday).submissions.find((s) => s.sessionKey === toSessionKey({ batchId: 'fit-s1u1', date: yesterday, slot: { kind: 'daily' } }));
  const absent = story && Object.keys(story.marks).find((studentId) => story.marks[studentId].status === 'absent');
  return story && absent ? [{ ...seed, correctionId: id, attendanceId: story.id, studentId: absent }] : [];
}

export function buildSeedPayload(today: LocalDate, seededDay: LocalDate | null): SeedPayload {
  const days = missingDays(today, seededDay);
  const history: AttendanceSubmission[] = [];
  for (const date of days) {
    for (const batchId of HISTORY_BATCH_IDS) {
      for (const subjectId of [undefined, ...subjectsWithHistory(batchId).map((h) => h.subjectId)]) {
        const s = historicalSubmission(batchId, date, today, subjectId);
        if (s) history.push(s);
      }
    }
  }
  const staffHistory = days.flatMap((date) => STAFF.map((m) => historicalStaffRecord(m.id, date, today)).filter((r) => r !== undefined));
  const story = buildSeed(today);
  return {
    day: today,
    submissions: [...history, ...story.submissions].map(submissionRow),
    corrections: yesterdaysCorrection(today, seededDay, history).map(correctionToRow),
    staff_attendance: [...staffHistory, ...story.staffRecords].map(staffRecordToRow),
    ojt: buildMasterData(today).ojt.map(ojtToRow),
    announcements: buildAnnouncements(today).map(announcementToRow),
    face_enrolment: story.faceEnrolments.map(faceToRow),
  };
}

type SeededDay = { readonly ok: true; readonly day: LocalDate | null } | { readonly ok: false; readonly offline: boolean };

async function readSeededDay(client: DataClient): Promise<SeededDay> {
  const result = await client.select({ table: 'demo_meta', order: 'key', filters: [eq('key', 'seeded_day')] });
  if (!result.ok) return { ok: false, offline: result.error.kind === 'network' };
  const value = result.data[0]?.value;
  return { ok: true, day: typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null };
}

async function seed(client: DataClient, today: LocalDate, seededDay: LocalDate | null): Promise<SeedOutcome> {
  const payload = buildSeedPayload(today, seededDay);
  let result = await client.rpc('ksk_seed_day', { payload });
  // The correction's record lost to another row (someone submitted that session first): seed the day without it.
  if (!result.ok && result.error.kind === 'server' && result.error.code === FOREIGN_KEY_VIOLATION && payload.corrections.length)
    result = await client.rpc('ksk_seed_day', { payload: { ...payload, corrections: [] } });
  if (result.ok) return { kind: 'seeded', written: result.data };
  return result.error.kind === 'network' ? { kind: 'offline' } : { kind: 'failed', code: result.error.code };
}

/** Makes sure today's demo story is on the server: one read when it is, one function call when it is not. */
export async function ensureDemoDay(client: DataClient, today: LocalDate): Promise<SeedOutcome> {
  const meta = await readSeededDay(client);
  if (!meta.ok) return meta.offline ? { kind: 'offline' } : { kind: 'failed', code: 'demo_meta' };
  if (meta.day === today) return { kind: 'current' };
  return seed(client, today, meta.day);
}

/** Clears the demo institutes' records on the server (the test institute stays), then seeds today's story again. */
export async function resetSharedDemo(client: DataClient, today: LocalDate): Promise<ResetOutcome> {
  const reset = await client.rpc('ksk_reset_demo');
  if (!reset.ok) return reset.error.kind === 'network' ? 'offline' : isMissingFunction(reset.error) ? 'missing' : 'failed';
  const seeded = await seed(client, today, null);
  return seeded.kind === 'seeded' ? 'done' : seeded.kind === 'offline' ? 'offline' : 'failed';
}

/** One boot-time check per day per page (React Strict Mode boots the app twice in development); a failed one is dropped. */
const booting = new Map<LocalDate, Promise<SeedOutcome>>();

/**
 * Boot (demo builds, shared source): seeds today before the first screen reads, but never holds the app longer than
 * `waitMs` (a slow network finishes in the background; Realtime refreshes the screens when the rows land).
 */
export async function prepareSharedDemo(app: AppContainer, waitMs = 8000): Promise<void> {
  if (!app.serverClient) return;
  const today = toLocalDate(app.clock.now());
  let seeding = booting.get(today);
  if (!seeding) {
    const started = ensureDemoDay(app.serverClient, today);
    seeding = started;
    booting.set(today, started);
    // Only a seeded (or already current) day is kept: after an offline start or a refusal, the next boot tries again.
    const forget = () => {
      if (booting.get(today) === started) booting.delete(today);
    };
    void started.then((outcome) => (outcome.kind === 'seeded' || outcome.kind === 'current' ? undefined : forget()), forget);
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const waited = new Promise<void>((resolve) => (timer = setTimeout(resolve, waitMs)));
  await Promise.race([seeding, waited]);
  clearTimeout(timer);
}

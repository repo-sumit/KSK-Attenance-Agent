/**
 * Demo seed state, built relative to "today" so the demo tells the same story
 * on any date: a few batches already submitted this morning, most staff
 * self-verified, one first-time user without face enrolment, one stale pack,
 * and yesterday's correction in the audit log. Reset Demo rebuilds this.
 */
import type { AttendanceSubmission, Correction, MarkingSlot, StaffAttendanceRecord } from '@/domain/attendance';
import { toSessionKey } from '@/domain/attendance';
import type { BatchPack, FaceEnrolment } from '@/domain/device';
import type { MasterData, OjtDeclaration } from '@/domain/entities';
import type { Mark } from '@/domain/status';
import { addDays, instantAt, type LocalDate } from '@/lib/time';
import { OJT_NOTICE_BATCH, ojtNoticeDates } from './announcements';
import { INSTITUTES } from './institutes';
import { STAFF } from './staff';
import { STUDENTS } from './students';
import { TIMETABLE } from './timetable';
import { BATCHES, SUBJECTS, TRADES } from './trades';

export function buildMasterData(today: LocalDate): MasterData {
  const ojt: OjtDeclaration[] = [
    // Individual OJT: two students placed with an employer for two weeks.
    { id: 'ojt-ele-s1u2-pair', studentIds: ['ele-s1u2-r06', 'ele-s1u2-r13'], from: addDays(today, -3), to: addDays(today, 11) },
    // Whole-batch OJT declared by the principal in the ERP.
    { id: 'ojt-md-s2u1', studentIds: STUDENTS.filter((s) => s.batchId === 'md-s2u1').map((s) => s.id), from: addDays(today, -7), to: addDays(today, 21) },
    // The upcoming OJT the Home announcement tells Electrician Shift 1 Unit 1 about (announcements.ts).
    { id: `ojt-${OJT_NOTICE_BATCH}-notice`, studentIds: STUDENTS.filter((s) => s.batchId === OJT_NOTICE_BATCH).map((s) => s.id), ...ojtNoticeDates(today) },
  ];
  return { institutes: INSTITUTES, trades: TRADES, subjects: SUBJECTS, batches: BATCHES, students: STUDENTS, staff: STAFF, timetable: TIMETABLE, ojt };
}

export interface SeedState {
  readonly submissions: readonly AttendanceSubmission[];
  readonly corrections: readonly Correction[];
  readonly staffRecords: readonly StaffAttendanceRecord[];
  readonly faceEnrolments: readonly FaceEnrolment[];
  readonly packs: readonly BatchPack[];
}

interface SubmissionSeed {
  readonly batchId: string;
  readonly slots: readonly MarkingSlot[];
  readonly time: string;
  readonly by: string;
  readonly absentRolls: readonly number[];
}

const DAILY_AND_FIRST_HALF: readonly MarkingSlot[] = [{ kind: 'daily' }, { kind: 'half', part: 1 }];

/**
 * Today's submissions. Own attendance first (D-152): each submitter marked their own attendance earlier this morning
 * (STAFF_SELF_TODAY), so the batches of the still-unmarked instructors (Rajesh, Sanjay, Pradeep, Asha) were submitted
 * by self-marked colleagues of the same trade (U2).
 */
const TODAY_SUBMISSIONS: readonly SubmissionSeed[] = [
  { batchId: 'ele-s1u1', slots: DAILY_AND_FIRST_HALF, time: '09:48', by: 'st-kalpana', absentRolls: [20, 21] },
  { batchId: 'fit-s1u1', slots: DAILY_AND_FIRST_HALF, time: '09:35', by: 'st-prakash', absentRolls: [9] },
  { batchId: 'wel-s1u1', slots: DAILY_AND_FIRST_HALF, time: '09:40', by: 'st-sandeep', absentRolls: [6, 12] },
  { batchId: 'copa-s1u1', slots: DAILY_AND_FIRST_HALF, time: '09:30', by: 'st-swati', absentRolls: [] },
  { batchId: 'ele-s1u2', slots: [{ kind: 'period', periodNo: 2 }], time: '09:52', by: 'st-vikas', absentRolls: [3] },
];

/** Staff who self-verified this morning (HH:MM). Everyone else is still unmarked. */
const STAFF_SELF_TODAY: Readonly<Record<string, string>> = {
  'st-sunita': '08:51', 'st-vikas': '07:48', 'st-meera': '09:15', 'st-prakash': '08:40', 'st-suhas': '08:45', 'st-nilesh': '08:38',
  'st-bharat': '08:55', 'st-swati': '08:33', 'st-ganesh': '08:47', 'st-dattatray': '08:50', 'st-yogesh': '08:42',
  'st-sandeep': '08:52', 'st-kalpana': '09:01',
};

/** Everyone starts enrolled; the demo's "First-time user" preset removes one enrolment. */
export const NOT_ENROLLED_BY_DEFAULT: readonly string[] = [];

const PACKS_TODAY = ['ele-s1u1', 'ele-s1u2', 'ele-s1u3', 'ele-s2u2', 'ele-s2u3', 'copa-s1u1', 'wel-s2u2'];

function marksFor(batchId: string, absentRolls: readonly number[]): Record<string, Mark> {
  const marks: Record<string, Mark> = {};
  for (const s of STUDENTS.filter((st) => st.batchId === batchId)) {
    marks[s.id] = { status: absentRolls.includes(s.rollNo) ? 'absent' : 'present' };
  }
  return marks;
}

export function buildSeed(today: LocalDate): SeedState {
  const yesterday = addDays(today, -1);
  const submissions: AttendanceSubmission[] = TODAY_SUBMISSIONS.flatMap((seed) =>
    seed.slots.map((slot) => {
      const address = { batchId: seed.batchId, date: today, slot };
      const at = instantAt(today, seed.time).toISOString();
      return {
        id: `seed-${toSessionKey(address)}`,
        sessionKey: toSessionKey(address),
        address,
        marks: marksFor(seed.batchId, seed.absentRolls),
        markedBy: seed.by,
        deviceTimestamp: at,
        serverTimestamp: at,
        syncState: 'synced' as const,
      };
    }),
  );

  const corrections: Correction[] = [
    {
      correctionId: 'corr-seed-kiran',
      attendanceId: `hist-fit-s1u1-${yesterday}`,
      studentId: 'fit-s1u1-r04',
      oldMark: { status: 'absent' },
      newMark: { status: 'present' },
      reason: 'Student arrived late',
      reasonCode: 'late',
      actorId: 'st-anil',
      timestamp: instantAt(yesterday, '11:20').toISOString(),
    },
  ];

  const staffRecords: StaffAttendanceRecord[] = Object.entries(STAFF_SELF_TODAY).map(([staffId, time]) => ({
    id: `seed-staff-${staffId}-${today}`,
    staffId,
    date: today,
    status: 'present',
    source: 'self',
    markedBy: staffId,
    deviceTimestamp: instantAt(today, time).toISOString(),
    syncState: 'synced',
  }));

  const faceEnrolments: FaceEnrolment[] = STAFF.filter((s) => !NOT_ENROLLED_BY_DEFAULT.includes(s.id)).map((s) => ({
    staffId: s.id,
    enrolledAt: instantAt(addDays(today, -60), '10:00').toISOString(),
    sampleCount: 3,
    simulated: true,
  }));

  const packs: BatchPack[] = [
    ...PACKS_TODAY.map((batchId) => ({ batchId, downloadedAt: instantAt(today, '07:45').toISOString() })),
    // Downloaded over a week ago: past the refresh interval, still usable but flagged stale.
    { batchId: 'fit-s1u2', downloadedAt: instantAt(addDays(today, -8), '18:10').toISOString() },
  ];

  return { submissions, corrections, staffRecords, faceEnrolments, packs };
}

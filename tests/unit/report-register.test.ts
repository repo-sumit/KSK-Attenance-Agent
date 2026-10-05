import { describe, expect, it } from 'vitest';
import { effectiveMarks, toSessionKey, type AttendanceSubmission, type Correction, type MarkingSlot } from '@/domain/attendance';
import type { Batch, Institute, Student, Trade } from '@/domain/entities';
import type { StatusCode } from '@/domain/status';
import { addDays, eachDate, instantAt, type LocalDate } from '@/lib/time';
import { buildBatchRegister, buildRegister, type BatchSource, type RegisterRules } from '@/services/report-register';

const BATCH: Batch = { id: 'b1', tradeId: 't1', shift: 1, unit: 1, year: 1 };
const TRADE: Trade = { id: 't1', instituteId: 'i1', name: 'Fitter', durationYears: 2 };
const INSTITUTE: Institute = { id: 'i1', code: '27410', name: 'Govt ITI', shortName: 'ITI', district: 'Pune', locality: 'Aundh', location: { lat: 0, lng: 0 } };
const student = (n: number, name: string): Student => ({ id: `S${n}`, batchId: 'b1', rollNo: n, name, fatherName: '' });
const STUDENTS = [student(1, 'Aarav Patil'), student(2, 'Kiran Wagh'), student(3, 'Rohan Pawar')];
const NAMES = new Map([['t1', 'Rajesh Patil'], ['t2', 'Sanjay More'], ['p1', 'Dr. Anil Deshmukh']]);

function record(date: LocalDate, statuses: Readonly<Record<string, StatusCode>>, by: string, slot: MarkingSlot = { kind: 'daily' }): AttendanceSubmission {
  const address = { batchId: 'b1', date, slot };
  const marks = Object.fromEntries(Object.entries(statuses).map(([id, status]) => [id, { status }]));
  const at = instantAt(date, '09:30').toISOString();
  return { id: `r-${toSessionKey(address)}`, sessionKey: toSessionKey(address), address, marks, markedBy: by, deviceTimestamp: at, syncState: 'synced' };
}

const fold = (subs: readonly AttendanceSubmission[], corrections: readonly Correction[]) => subs.map((sub) => ({ sub, marks: effectiveMarks(sub, corrections) }));

// Sunday 20 September 2026 … Sunday 27; today is Friday 25 (no record yet), and the register ends today.
const DAYS = eachDate('2026-09-20', '2026-09-27');
const RULES: RegisterRules = { days: DAYS, to: '2026-09-25', today: '2026-09-25', threshold: 75, atRiskMinDays: 3 };
const SUBS = [
  record('2026-09-21', { S1: 'present', S2: 'absent', S3: 'leave' }, 't1'),
  record('2026-09-22', { S1: 'present', S2: 'present', S3: 'leave' }, 't1'),
  // Twice daily: Aarav present in the first half, absent in the second → half a day, one day counted.
  record('2026-09-23', { S1: 'present', S2: 'absent', S3: 'leave' }, 't2', { kind: 'half', part: 1 }),
  record('2026-09-23', { S1: 'absent', S2: 'absent', S3: 'leave' }, 't2', { kind: 'half', part: 2 }),
  record('2026-09-24', { S1: 'present', S2: 'absent' }, 't2'),
];
const CORRECTION: Correction = {
  correctionId: 'c1', attendanceId: SUBS[4].id, studentId: 'S2', oldMark: { status: 'absent' }, newMark: { status: 'present' },
  reason: 'Student arrived late', reasonCode: 'late', actorId: 'p1', timestamp: instantAt('2026-09-24', '11:20').toISOString(),
};
const SOURCE: BatchSource = { batch: BATCH, trade: TRADE, students: STUDENTS, rows: fold(SUBS, [CORRECTION]), corrections: [CORRECTION], sessionsPerDay: 'once' };

describe('attendance register builder (D-137)', () => {
  const reg = buildBatchRegister(SOURCE, RULES, NAMES);
  const row = (id: string) => reg.rows.find((r) => r.student.id === id)!;
  const at = (date: LocalDate) => DAYS.indexOf(date);

  it('lays out every day: class days, Sunday with no record, today pending, later days upcoming', () => {
    expect(reg.days.map((d) => [d.date, d.weekday, d.kind])).toEqual([
      ['2026-09-20', 0, 'none'],
      ['2026-09-21', 1, 'class'],
      ['2026-09-22', 2, 'class'],
      ['2026-09-23', 3, 'class'],
      ['2026-09-24', 4, 'class'],
      ['2026-09-25', 5, 'pending'],
      ['2026-09-26', 6, 'upcoming'],
      ['2026-09-27', 0, 'upcoming'],
    ]);
    expect(reg.classDays).toBe(4);
    expect(reg.days.map((d) => d.present)).toEqual([0, 1, 2, 0.5, 2, 0, 0, 0]);
  });

  it('daily records give one cell per day and per-student totals', () => {
    expect(row('S1').cells[at('2026-09-21')]).toEqual({ statuses: ['present'], share: 1, corrected: false });
    expect(row('S3').cells[at('2026-09-24')]).toBeNull();
    expect(row('S1').cells[at('2026-09-20')]).toBeNull();
    expect(row('S3')).toMatchObject({ present: 0, absent: 0, leave: 3, marked: 3, pct: 0 });
  });

  it('a twice-daily day with present and absent is half a day, counted once', () => {
    expect(row('S1').cells[at('2026-09-23')]).toEqual({ statuses: ['present', 'absent'], share: 0.5, corrected: false });
    expect(row('S1')).toMatchObject({ present: 3.5, absent: 0, leave: 0, marked: 4, pct: 88, atRisk: false });
    // Absent in both halves: one absent day, not two.
    expect(row('S2')).toMatchObject({ present: 2, absent: 2, marked: 4, pct: 50, atRisk: true });
  });

  it('a corrected mark shows as corrected and is listed with the actor and roll number', () => {
    expect(row('S2').cells[at('2026-09-24')]).toEqual({ statuses: ['present'], share: 1, corrected: true });
    expect(reg.corrections).toEqual([
      { date: '2026-09-24', studentName: 'Kiran Wagh', rollNo: 2, from: { status: 'absent' }, to: { status: 'present' }, reason: 'Student arrived late', reasonCode: 'late', by: 'Dr. Anil Deshmukh', at: CORRECTION.timestamp },
    ]);
  });

  it('batch figures: average, meeting and at-risk counts, the instructor who marked most', () => {
    // (3.5 + 2 + 0) / (4 + 4 + 3) = 50%.
    expect(reg).toMatchObject({ pct: 50, low: true, meeting: 1, atRisk: 2, instructor: 'Sanjay More', sessionsPerDay: 'once' });
    // At risk needs atRiskMinDays marked days: Rohan has 3.
    const strict = buildBatchRegister(SOURCE, { ...RULES, atRiskMinDays: 4 }, NAMES);
    expect(strict.rows.map((r) => r.atRisk)).toEqual([false, true, false]);
    expect(strict.atRisk).toBe(1);
  });

  it('instructor ties go to the latest record; no records → no instructor and no figures', () => {
    const tie = buildBatchRegister({ ...SOURCE, rows: fold(SUBS.slice(0, 3).concat(SUBS[4]), []), corrections: [] }, RULES, NAMES);
    expect(tie.instructor).toBe('Sanjay More');
    const swapped = SUBS.slice(0, 3).concat(SUBS[4]).map((s) => ({ ...s, markedBy: s.markedBy === 't1' ? 't2' : 't1' }));
    expect(buildBatchRegister({ ...SOURCE, rows: fold(swapped, []), corrections: [] }, RULES, NAMES).instructor).toBe('Rajesh Patil');
    const empty = buildBatchRegister({ ...SOURCE, rows: [], corrections: [] }, RULES, NAMES);
    expect(empty).toMatchObject({ instructor: null, classDays: 0, pct: null, low: false, meeting: 0, atRisk: 0, corrections: [] });
    expect(empty.rows.every((r) => r.pct === null && r.marked === 0 && !r.atRisk)).toBe(true);
  });

  it('threshold-safe rounding: 74.6% shows 74 with threshold 75, at risk only with enough days', () => {
    const days = eachDate('2026-07-01', addDays('2026-07-01', 62)); // 63 days
    const subs = days.map((date, i) => record(date, { S1: i < 47 ? 'present' : 'absent' }, 't1')); // 47 / 63 = 74.6%
    const source: BatchSource = { ...SOURCE, students: [STUDENTS[0]], rows: fold(subs, []), corrections: [] };
    const rules: RegisterRules = { days, to: days[62], today: '2026-09-25', threshold: 75, atRiskMinDays: 63 };
    const reg74 = buildBatchRegister(source, rules, NAMES);
    expect(reg74.rows[0]).toMatchObject({ pct: 74, atRisk: true, present: 47, marked: 63 });
    expect(reg74).toMatchObject({ pct: 74, low: true, meeting: 0, atRisk: 1 });
    expect(buildBatchRegister(source, { ...rules, atRiskMinDays: 64 }, NAMES).rows[0].atRisk).toBe(false);
    const meeting = buildBatchRegister(source, { ...rules, threshold: 74 }, NAMES);
    expect(meeting).toMatchObject({ meeting: 1, atRisk: 0, low: false });
  });

  it('buildRegister covers the whole month for each batch', () => {
    const register = buildRegister({
      institute: INSTITUTE, month: '2026-09-01', to: '2026-09-25', today: '2026-09-25', threshold: 75, atRiskMinDays: 3,
      generatedAt: '2026-09-25T04:45:00.000Z', preparedBy: { name: 'Sanjay More', role: 'instructor' }, staffNames: NAMES, sources: [SOURCE],
    });
    expect(register).toMatchObject({ month: '2026-09-01', to: '2026-09-25', threshold: 75, generatedAt: '2026-09-25T04:45:00.000Z', preparedBy: { name: 'Sanjay More' } });
    expect(register.batches).toHaveLength(1);
    const [b] = register.batches;
    expect(b.days).toHaveLength(30);
    expect(b.days[0]).toMatchObject({ date: '2026-09-01', weekday: 2, kind: 'none' });
    expect(b.days.slice(25).every((d) => d.kind === 'upcoming')).toBe(true);
    expect(b.rows[0].cells).toHaveLength(30);
    expect(b.rows.find((r) => r.student.id === 'S1')).toMatchObject({ present: 3.5, marked: 4, pct: 88 });
  });
  it('Task 15: a correction for a student who is not in the batch is left out (no raw id, no roll 0)', () => {
    const stray: Correction = { ...CORRECTION, correctionId: 'c2', studentId: 'S99', timestamp: instantAt('2026-09-24', '11:30').toISOString() };
    const reg2 = buildBatchRegister({ ...SOURCE, corrections: [CORRECTION, stray] }, RULES, NAMES);
    expect(reg2.corrections.map((c) => [c.studentName, c.rollNo])).toEqual([['Kiran Wagh', 2]]);
  });
});

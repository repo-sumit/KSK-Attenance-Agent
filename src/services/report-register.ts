/**
 * The monthly attendance register (D-137): per batch, every student's day-by-day
 * status after corrections, totals by the leaderboard's rules (report-math.ts)
 * and the corrections themselves. Pure: ReportService gathers the inputs.
 */
import type { Correction, MarkingSlot } from '@/domain/attendance';
import type { Batch, Institute, StaffRole, Student, Trade } from '@/domain/entities';
import type { Mark, StatusCode } from '@/domain/status';
import { compareDates, dayOfWeek, eachDate, endOfMonth, type LocalDate } from '@/lib/time';
import { average, dayShare, oneDecimal, shown, standingFigures, studentDays, type Rows } from './report-math';

/** One student on one day: the day's sessions as recorded after corrections, in slot order. */
export interface RegisterCell {
  readonly statuses: readonly StatusCode[];
  /** Presence share of the day (present and OJT 1, half day ½, else 0), averaged over the day's sessions. */
  readonly share: number;
  /** A correction changed one of this day's marks for this student. */
  readonly corrected: boolean;
}

export interface RegisterDay {
  readonly date: LocalDate;
  /** 0 Sunday … 6 Saturday (IST). */
  readonly weekday: number;
  /** class: the batch has a record that day · none: no record (Sunday, holiday, no class) · pending: today, not
   *  submitted yet · upcoming: after the register's last day. */
  readonly kind: 'class' | 'none' | 'pending' | 'upcoming';
  /** Sum of the students' shares that day (0 unless class). */
  readonly present: number;
}

export interface RegisterRow {
  readonly student: Student;
  /** Aligned with `days`; null where the student has no mark that day. */
  readonly cells: readonly (RegisterCell | null)[];
  /** Days present by presence weight, one decimal (as the leaderboard's daysPresent). */
  readonly present: number;
  /** Days whose sessions were all absent. */
  readonly absent: number;
  /** Days with leave in every session. */
  readonly leave: number;
  /** Days with at least one mark. */
  readonly marked: number;
  /** Threshold-safe rounding (a figure below the threshold never rounds up to it); null without marks. */
  readonly pct: number | null;
  readonly atRisk: boolean;
}

export interface RegisterCorrection {
  readonly date: LocalDate;
  readonly studentName: string;
  readonly rollNo: number;
  readonly from: Mark;
  readonly to: Mark;
  readonly reason: string;
  readonly reasonCode?: 'late' | 'mistake' | 'duty';
  readonly by: string;
  readonly at: string;
}

export interface BatchRegister {
  readonly batch: Batch;
  readonly trade: Trade;
  /** Who marked most of the period's sessions (a staff name), or null without records. */
  readonly instructor: string | null;
  readonly days: readonly RegisterDay[];
  readonly rows: readonly RegisterRow[];
  readonly classDays: number;
  readonly pct: number | null;
  readonly low: boolean;
  /** Students at or above the threshold (with a figure). */
  readonly meeting: number;
  readonly atRisk: number;
  readonly corrections: readonly RegisterCorrection[];
  /** How a day is recorded, for the legend. */
  readonly sessionsPerDay: 'once' | 'twice' | 'period';
}

export interface AttendanceRegister {
  readonly institute: Institute;
  /** First day of the month. */
  readonly month: LocalDate;
  /** The register's last day: the month's end, or today for the current month. */
  readonly to: LocalDate;
  readonly today: LocalDate;
  readonly threshold: number;
  readonly atRiskMinDays: number;
  /** ISO instant from the injected clock. */
  readonly generatedAt: string;
  readonly preparedBy: { readonly name: string; readonly role: StaffRole };
  readonly batches: readonly BatchRegister[];
}

/** One batch's inputs: its students, its records (marks folded) and the corrections on those records. */
export interface BatchSource {
  readonly batch: Batch;
  readonly trade: Trade;
  readonly students: readonly Student[];
  readonly rows: Rows;
  readonly corrections: readonly Correction[];
  readonly sessionsPerDay: BatchRegister['sessionsPerDay'];
}

export interface RegisterRules {
  /** The days the register lays out (the whole month). */
  readonly days: readonly LocalDate[];
  readonly to: LocalDate;
  readonly today: LocalDate;
  readonly threshold: number;
  readonly atRiskMinDays: number;
}

const slotRank = (slot: MarkingSlot) => (slot.kind === 'daily' ? 0 : slot.kind === 'half' ? slot.part : 10 + slot.periodNo);

/** Who marked most of the records; a tie goes to whoever marked the latest one. */
function mostMarked(rows: Rows): string | null {
  const tally = new Map<string, { n: number; last: string }>();
  for (const { sub } of rows) {
    const t = tally.get(sub.markedBy) ?? { n: 0, last: '' };
    const at = `${sub.address.date} ${sub.deviceTimestamp}`;
    tally.set(sub.markedBy, { n: t.n + 1, last: at > t.last ? at : t.last });
  }
  const [best] = [...tally].sort(([, a], [, b]) => b.n - a.n || b.last.localeCompare(a.last));
  return best ? best[0] : null;
}

export function buildBatchRegister(source: BatchSource, rules: RegisterRules, staffNames: ReadonlyMap<string, string>): BatchRegister {
  const { threshold, atRiskMinDays } = rules;
  const rows = [...source.rows].sort((a, b) => compareDates(a.sub.address.date, b.sub.address.date) || slotRank(a.sub.address.slot) - slotRank(b.sub.address.slot));
  const dateOf = new Map(rows.map((r) => [r.sub.id, r.sub.address.date]));
  const classDates = new Set(dateOf.values());
  const corrected = new Set(source.corrections.filter((c) => dateOf.has(c.attendanceId)).map((c) => `${c.studentId}|${dateOf.get(c.attendanceId)}`));

  const registerRows: RegisterRow[] = source.students.map((student) => {
    // Figures read the records in the order the leaderboard reads them, so the sums match to the last bit;
    // the cells list each day's statuses in slot order.
    const days = studentDays(source.rows, student.id);
    const inSlotOrder = studentDays(rows, student.id);
    const cells = rules.days.map((date): RegisterCell | null => {
      const marks = days.get(date);
      if (!marks) return null;
      const statuses = (inSlotOrder.get(date) ?? []).flatMap((m) => (m.status ? [m.status] : []));
      return { statuses, share: dayShare(marks), corrected: corrected.has(`${student.id}|${date}`) };
    });
    const marked = [...days.values()];
    const every = (status: StatusCode) => marked.filter((ms) => ms.every((m) => m.status === status)).length;
    const figures = standingFigures(marked.map(dayShare), threshold, atRiskMinDays);
    return { student, cells, present: figures.daysPresent, absent: every('absent'), leave: every('leave'), marked: figures.daysMarked, pct: figures.pct, atRisk: figures.atRisk };
  });

  const days: RegisterDay[] = rules.days.map((date, i) => {
    const kind = classDates.has(date) ? 'class' : compareDates(date, rules.to) > 0 ? 'upcoming' : date === rules.today ? 'pending' : 'none';
    const present = kind === 'class' ? oneDecimal(registerRows.reduce((a, r) => a + (r.cells[i]?.share ?? 0), 0)) : 0;
    return { date, weekday: dayOfWeek(date), kind, present };
  });

  const avg = average(registerRows.map((r) => ({ daysPresent: r.present, daysMarked: r.marked })));
  const studentOf = new Map(source.students.map((s) => [s.id, s]));
  // A correction for a student who is not in this batch's roster has no row to belong to: it is left out.
  const corrections = source.corrections
    .flatMap((c, i) => {
      const date = dateOf.get(c.attendanceId);
      const student = studentOf.get(c.studentId);
      return date && student ? [{ c, i, date, student }] : [];
    })
    .sort((a, b) => a.c.timestamp.localeCompare(b.c.timestamp) || a.i - b.i)
    .map(
      ({ c, date, student }): RegisterCorrection => ({
        date,
        studentName: student.name,
        rollNo: student.rollNo,
        from: c.oldMark,
        to: c.newMark,
        reason: c.reason,
        ...(c.reasonCode ? { reasonCode: c.reasonCode } : {}),
        by: staffNames.get(c.actorId) ?? c.actorId,
        at: c.timestamp,
      }),
    );
  const instructor = mostMarked(rows);

  return {
    batch: source.batch,
    trade: source.trade,
    instructor: instructor === null ? null : (staffNames.get(instructor) ?? instructor),
    days,
    rows: registerRows,
    classDays: days.filter((d) => d.kind === 'class').length,
    pct: shown(avg, threshold),
    low: avg !== null && avg < threshold,
    meeting: registerRows.filter((r) => r.pct !== null && r.pct >= threshold).length,
    atRisk: registerRows.filter((r) => r.atRisk).length,
    corrections,
    sessionsPerDay: source.sessionsPerDay,
  };
}

export interface RegisterInput extends Omit<AttendanceRegister, 'batches'> {
  readonly staffNames: ReadonlyMap<string, string>;
  /** In the order the register prints them. */
  readonly sources: readonly BatchSource[];
}

/** The register for a month: every day of the month for each batch. */
export function buildRegister(input: RegisterInput): AttendanceRegister {
  const { staffNames, sources, ...header } = input;
  const rules: RegisterRules = { days: eachDate(input.month, endOfMonth(input.month)), to: input.to, today: input.today, threshold: input.threshold, atRiskMinDays: input.atRiskMinDays };
  return { ...header, batches: sources.map((source) => buildBatchRegister(source, rules, staffNames)) };
}

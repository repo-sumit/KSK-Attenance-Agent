/**
 * The monthly staff attendance register (D-154, extends D-137): every day of the month, one row per staff member
 * with a status per day, P/A/L totals, % and unmarked days, by the staff report card's rules (report-staff.ts), so
 * the card and the register agree person by person. Pure builder plus the scope check ReportService delegates to.
 */
import type { StaffAttendanceRecord } from '@/domain/attendance';
import type { Institute, StaffMember, StaffRole } from '@/domain/entities';
import { presenceWeight } from '@/domain/marking';
import { compareDates, dayOfWeek, eachDate, endOfMonth, startOfMonth, toLocalDate, type LocalDate } from '@/lib/time';
import type { StaffAttendanceRepository } from '@/repositories/interfaces';
import type { SessionContext } from './context';
import { oneDecimal } from './report-math';
import type { RegisterCell, RegisterDay } from './report-register';
import { registerMonthsFor } from './report-register-service';
import { reportedStaff, staffReportInScope, staffStandings, totalFigure } from './report-staff';

export interface StaffRegisterRow {
  readonly member: StaffMember;
  /** The trade or subject they teach ("Electrician"); null for the principal. */
  readonly trade: string | null;
  /** Aligned with `days`; null where the person has no record that day. */
  readonly cells: readonly (RegisterCell | null)[];
  /** By presence weight, one decimal. */
  readonly present: number;
  readonly absent: number;
  readonly leave: number;
  readonly marked: number;
  /** Working days before today with no record of theirs (never counted as absent). */
  readonly unmarked: number;
  readonly pct: number | null;
  readonly low: boolean;
}

export interface StaffRegister {
  readonly institute: Institute;
  /** First day of the month. */
  readonly month: LocalDate;
  /** The register's last day: the month's end, or today for the current month. */
  readonly to: LocalDate;
  readonly today: LocalDate;
  /** report.staffThresholdPct */
  readonly threshold: number;
  /** ISO instant from the injected clock. */
  readonly generatedAt: string;
  readonly preparedBy: { readonly name: string; readonly role: StaffRole };
  /** `class`: a working day (any staff record) · `none` · `pending`: today, nobody marked yet · `upcoming`. */
  readonly days: readonly RegisterDay[];
  readonly rows: readonly StaffRegisterRow[];
  /** Working days held up to `to`. */
  readonly staffDays: number;
  readonly pct: number | null;
  readonly low: boolean;
  /** Staff at or above the threshold (with a figure). */
  readonly meeting: number;
}

export interface StaffRegisterInput extends Omit<StaffRegister, 'days' | 'rows' | 'staffDays' | 'pct' | 'low' | 'meeting'> {
  readonly people: readonly StaffMember[];
  readonly records: readonly StaffAttendanceRecord[];
  readonly tradeOf: (member: StaffMember) => string | null;
}

export function buildStaffRegister(input: StaffRegisterInput): StaffRegister {
  const { people, records, tradeOf, ...header } = input;
  const dates = eachDate(input.month, endOfMonth(input.month));
  const { staffDays, standings } = staffStandings({ people, records, from: input.month, to: input.to, today: input.today, threshold: input.threshold });
  const held = new Set(staffDays);
  const byKey = new Map(records.filter((r) => compareDates(r.date, input.to) <= 0).map((r) => [`${r.staffId}|${r.date}`, r]));
  const rows = standings.map((s): StaffRegisterRow => {
    const cells = dates.map((date): RegisterCell | null => {
      const r = byKey.get(`${s.member.id}|${date}`);
      return r ? { statuses: [r.status], share: presenceWeight({ status: r.status }), corrected: false } : null;
    });
    return { member: s.member, trade: tradeOf(s.member), cells, present: s.present, absent: s.counts.absent, leave: s.counts.leave, marked: s.marked, unmarked: s.unmarked, pct: s.pct, low: s.low };
  });
  const days = dates.map((date, i): RegisterDay => {
    const kind = held.has(date) ? 'class' : compareDates(date, input.to) > 0 ? 'upcoming' : date === input.today ? 'pending' : 'none';
    return { date, weekday: dayOfWeek(date), kind, present: kind === 'class' ? oneDecimal(rows.reduce((a, r) => a + (r.cells[i]?.share ?? 0), 0)) : 0 };
  });
  const total = totalFigure(standings, input.threshold);
  return {
    ...header,
    days,
    rows,
    staffDays: staffDays.length,
    pct: total.pct,
    low: total.low,
    meeting: rows.filter((r) => r.pct !== null && r.pct >= input.threshold).length,
  };
}

/** ReportService.staffRegister: null outside the staff report's scope or for a month the sheet does not offer. */
export async function staffMonthlyRegister(sessionCtx: SessionContext, month: LocalDate, staff: StaffAttendanceRepository): Promise<StaffRegister | null> {
  if (!staffReportInScope(sessionCtx)) return null;
  // One reading of the clock for the whole register, as the student register does.
  const now = sessionCtx.clock.now();
  const today = toLocalDate(now);
  if (!registerMonthsFor(today).includes(month)) return null;
  const { data } = sessionCtx;
  const to = month === startOfMonth(today) ? today : endOfMonth(month);
  const people = reportedStaff(data.staff);
  const records = await staff.listBetween(people.map((p) => p.id), month, to);
  return buildStaffRegister({
    institute: sessionCtx.institute,
    month,
    to,
    today,
    threshold: sessionCtx.config.reports.staffThresholdPct,
    generatedAt: now.toISOString(),
    preparedBy: { name: sessionCtx.user.name, role: sessionCtx.user.role },
    people,
    records,
    tradeOf: (m) => data.trades.find((t) => t.id === m.primaryTradeId)?.name ?? data.subjects.find((s) => s.id === m.subjectId)?.name ?? null,
  });
}

/**
 * The staff attendance report card (D-154): this month to date for the principal, every non-office staff member
 * with the principal included (D-019). Pure arithmetic beside a thin reader; ReportService delegates here.
 *
 * - Staff-days of the institute: the dates in range, up to today, with at least one staff record (there is no
 *   holiday calendar, so a day nobody was marked counts as closed).
 * - A person's unmarked days: institute staff-days before today with no record of theirs. Today is reported apart,
 *   because the day is still open. Unmarked days are shown, never counted as absent.
 * - %: present weight (present and OJT 1, half day ½) over marked days, rounded so that a figure below the
 *   threshold never shows as the threshold itself (report-math `shown`).
 */
import type { StaffAttendanceRecord } from '@/domain/attendance';
import type { StaffMember } from '@/domain/entities';
import { countMarks, effectivePresent, presenceWeight, type MarkCounts } from '@/domain/marking';
import { compareDates, endOfMonth, shiftMonth, startOfMonth, toLocalDate, type LocalDate } from '@/lib/time';
import type { StaffAttendanceRepository } from '@/repositories/interfaces';
import type { SessionContext } from './context';
import { oneDecimal, shown } from './report-math';
import type { DateRange, MonthStat } from './report-types';

export interface StaffStanding {
  readonly member: StaffMember;
  /** Today's record, reported separately from the month's days; null while not marked today. */
  readonly today: StaffAttendanceRecord | null;
  /** One per status over the range's marked days; `unmarked` holds the unmarked days and `total` both. */
  readonly counts: MarkCounts;
  /** Days present by presence weight, one decimal. */
  readonly present: number;
  readonly marked: number;
  readonly unmarked: number;
  /** Threshold-safe rounding; null without marked days. */
  readonly pct: number | null;
  /** Below report.staffThresholdPct on the unrounded figure. */
  readonly low: boolean;
}

export interface StaffOverview {
  readonly range: DateRange;
  readonly threshold: number;
  /** Days the institute recorded any staff attendance this month, today included once anyone is marked. */
  readonly staffDays: number;
  /** The institute's staff-days by presence weight over marked staff-days. */
  readonly pct: number | null;
  /** The institute's staff-days present by presence weight (present and OJT 1, half day ½), one decimal. */
  readonly present: number;
  /** Staff-days per status across the institute (`unmarked`: unmarked days before today). */
  readonly month: MarkCounts;
  /** Today, one per person (`unmarked`: not marked today). */
  readonly today: MarkCounts;
  /** Oldest first, this month last (equal to `pct`); empty when report.trendMonths is 0. */
  readonly trend: readonly MonthStat[];
  /** Lowest % first (no marks first of all), then more unmarked days, then name. */
  readonly staff: readonly StaffStanding[];
}

/** Who staff reports count: every staff member but office staff, the principal included (D-019). */
export const reportedStaff = (people: readonly StaffMember[]) => people.filter((p) => p.role !== 'office_staff');

/** A percentage from a present weight over marked days, rounded threshold-safe, and whether it is below. */
export function staffFigure(present: number, marked: number, threshold: number): { readonly pct: number | null; readonly low: boolean } {
  const raw = marked > 0 ? (present / marked) * 100 : null;
  return { pct: shown(raw, threshold), low: raw !== null && raw < threshold };
}

const ZERO = countMarks({});
const sumCounts = (all: readonly MarkCounts[]): MarkCounts =>
  Object.fromEntries((Object.keys(ZERO) as (keyof MarkCounts)[]).map((k) => [k, all.reduce((n, c) => n + c[k], 0)])) as unknown as MarkCounts;

/** The institute's figure over these standings: every marked staff-day by its weight. */
export function totalFigure(standings: readonly StaffStanding[], threshold: number) {
  const all = sumCounts(standings.map((s) => s.counts));
  return { counts: all, ...staffFigure(effectivePresent(all), all.total - all.unmarked, threshold) };
}

export interface StandingsInput {
  readonly people: readonly StaffMember[];
  /** May reach outside the range (the trend's months): only the range's records count. */
  readonly records: readonly StaffAttendanceRecord[];
  readonly from: LocalDate;
  readonly to: LocalDate;
  readonly today: LocalDate;
  readonly threshold: number;
}

/** Each person's figures over a range, in the people's order, and the institute's staff-days in it. */
export function staffStandings(input: StandingsInput): { readonly staffDays: readonly LocalDate[]; readonly standings: StaffStanding[] } {
  const people = reportedStaff(input.people);
  const ids = new Set(people.map((p) => p.id));
  const mine = input.records.filter((r) => ids.has(r.staffId));
  const inRange = mine.filter((r) => compareDates(r.date, input.from) >= 0 && compareDates(r.date, input.to) <= 0);
  const staffDays = [...new Set(inRange.map((r) => r.date))].sort(compareDates);
  const before = staffDays.filter((d) => compareDates(d, input.today) < 0);
  const standings = people.map((member): StaffStanding => {
    const byDate = new Map(inRange.filter((r) => r.staffId === member.id).map((r) => [r.date, r]));
    // Every marked day, and each institute day before today without a record of theirs (status null: not marked).
    const days = [...new Set([...byDate.keys(), ...before])];
    const counts = countMarks(Object.fromEntries(days.map((d) => [d, { status: byDate.get(d)?.status ?? null }])));
    const present = effectivePresent(counts);
    const marked = counts.total - counts.unmarked;
    const today = mine.find((r) => r.staffId === member.id && r.date === input.today) ?? null;
    return { member, today, counts, present: oneDecimal(present), marked, unmarked: counts.unmarked, ...staffFigure(present, marked, input.threshold) };
  });
  return { staffDays, standings };
}

export interface StaffOverviewInput {
  readonly people: readonly StaffMember[];
  /** This month's records, and the trend's earlier months when report.trendMonths asks for them. */
  readonly records: readonly StaffAttendanceRecord[];
  readonly today: LocalDate;
  readonly threshold: number;
  readonly trendMonths: number;
}

/** The staff list's order everywhere (the section, the detail report): lowest % first, then more unmarked days, then name. */
export const order = (a: StaffStanding, b: StaffStanding) => (a.pct ?? -1) - (b.pct ?? -1) || b.unmarked - a.unmarked || a.member.name.localeCompare(b.member.name);

export function buildStaffOverview(input: StaffOverviewInput): StaffOverview {
  const { today, threshold } = input;
  const range: DateRange = { kind: 'month', from: startOfMonth(today), to: today };
  const people = reportedStaff(input.people);
  const ids = new Set(people.map((p) => p.id));
  const { staffDays, standings } = staffStandings({ ...input, people, from: range.from, to: range.to });
  const total = totalFigure(standings, threshold);
  const trend: MonthStat[] = [];
  for (let k = Math.max(0, input.trendMonths) - 1; k >= 0; k--) {
    const month = shiftMonth(today, -k);
    const end = k === 0 ? today : endOfMonth(month);
    const rs = input.records.filter((r) => ids.has(r.staffId) && compareDates(r.date, month) >= 0 && compareDates(r.date, end) <= 0);
    trend.push({ month, pct: staffFigure(rs.reduce((a, r) => a + presenceWeight({ status: r.status }), 0), rs.length, threshold).pct });
  }
  return {
    range,
    threshold,
    staffDays: staffDays.length,
    pct: total.pct,
    present: oneDecimal(effectivePresent(total.counts)),
    month: total.counts,
    today: countMarks(Object.fromEntries(standings.map((s) => [s.member.id, { status: s.today?.status ?? null }]))),
    trend,
    staff: [...standings].sort(order),
  };
}

/** The staff report exists for whoever has the principal's staff view and the staff block (never decided by role here). */
export const staffReportInScope = (ctx: SessionContext) =>
  ctx.journey.staff.principalStaffView && ctx.journey.reports.enabled && ctx.journey.reports.blocks.includes('staff_summary');

/** ReportService.staffOverview: null outside scope; the guard is here, not only on the screen. */
export async function staffOverviewFor(ctx: SessionContext, staff: StaffAttendanceRepository): Promise<StaffOverview | null> {
  if (!staffReportInScope(ctx)) return null;
  const today = toLocalDate(ctx.clock.now());
  const trendMonths = Math.max(0, ctx.config.reports.trendMonths);
  const from = trendMonths > 1 ? shiftMonth(today, -(trendMonths - 1)) : startOfMonth(today);
  const people = reportedStaff(ctx.data.staff);
  const records = await staff.listBetween(people.map((p) => p.id), from, today);
  return buildStaffOverview({ people, records, today, threshold: ctx.config.reports.staffThresholdPct, trendMonths });
}

/** The staff detail report (range switch + print): the same figures over any range, in the staff list's order. */
export async function staffSummaryFor(ctx: SessionContext, staff: StaffAttendanceRepository, range: DateRange) {
  // Outside the staff report's scope the report is empty: no staff figures leave the service (never only the screen).
  if (!staffReportInScope(ctx)) return { block: 'staff_summary' as const, staff: [] as StaffStanding[], pct: null };
  const people = reportedStaff(ctx.data.staff);
  const records = await staff.listBetween(people.map((p) => p.id), range.from, range.to);
  const threshold = ctx.config.reports.staffThresholdPct;
  const { standings } = staffStandings({ people, records, from: range.from, to: range.to, today: toLocalDate(ctx.clock.now()), threshold });
  return { block: 'staff_summary' as const, staff: [...standings].sort(order), pct: totalFigure(standings, threshold).pct };
}

/**
 * ReportService — in-app reports computed from attendance records (PRD §19).
 * Returns structured data; screens format it in the user's language. Scope
 * follows the mapping model (§19.1); every Present figure and percentage counts
 * each status by its presence weight (present and OJT 1, half day ½).
 *
 * The Reports page (D-053) reads this month's overview: my attendance, my
 * batches with each batch's students, the at-risk list and, for the principal,
 * staff attendance (D-154, report-staff.ts). Staff attendance and the
 * correction log also keep a detail view with date ranges and print.
 */
import type { ReportBlock, DateRangeKind } from '@/config/types';
import { effectiveMarks, type Correction } from '@/domain/attendance';
import type { Batch } from '@/domain/entities';
import { presenceWeight } from '@/domain/marking';
import { addDays, compareDates, endOfMonth, shiftMonth, startOfMonth, startOfWeek, toLocalDate, type LocalDate } from '@/lib/time';
import type { AttendanceRepository, CorrectionRepository, StaffAttendanceRepository } from '@/repositories/interfaces';
import type { SessionContext } from './context';
import type { CorrectionLogEntry, CorrectionService } from './corrections';
import { average, dayShare, pct, shown, standingFigures, studentDays, tradeOf, type Rows } from './report-math';
import type { AttendanceRegister } from './report-register';
import { monthlyRegister, registerMonthsFor } from './report-register-service';
import { staffOverviewFor, staffSummaryFor, type StaffOverview, type StaffStanding } from './report-staff';
import { staffMonthlyRegister, type StaffRegister } from './report-staff-register';
import type { DateRange, StudentStanding, BatchOverview, MonthStat, MyAttendanceSummary, LeaderboardSort, RankedStanding, AtRiskReport, InstituteSummary } from './report-types';
export type { DateRange, StudentStanding, BatchOverview, MonthStat, MyAttendanceSummary, LeaderboardSort, RankedStanding, AtRiskStudent, AtRiskGroup, AtRiskReport, InstituteSummary } from './report-types';
export type { StaffOverview, StaffStanding } from './report-staff';
export type { StaffRegister } from './report-staff-register';

/** Blocks that keep a detail screen (range switch + print): the principal's staff and audit reports. */
export const DETAIL_BLOCKS = ['staff_summary', 'correction_log'] as const satisfies readonly ReportBlock[];
export type DetailBlock = (typeof DETAIL_BLOCKS)[number];
export const isDetailBlock = (block: string): block is DetailBlock => (DETAIL_BLOCKS as readonly string[]).includes(block);

export type ReportData =
  /** The staff report card's figures over the chosen range (report-staff.ts), in the staff list's order. */
  | { readonly block: 'staff_summary'; readonly staff: readonly StaffStanding[]; readonly pct: number | null }
  | { readonly block: 'correction_log'; readonly entries: readonly CorrectionLogEntry[] };

type Delay = (ms: number) => Promise<void>;
const noDelay: Delay = () => Promise.resolve();

/**
 * Leaderboard positions (brief §7: "1. Amit 94% · 2. Sneha 88%"): 1 is the best
 * attendance; equal percentages keep a stable order (more days present, then
 * name) instead of a column of repeated 1s. A student keeps their position when
 * the list is shown lowest first. Students with no marks yet come last, unranked.
 * The batch leaderboard and the at-risk list both number students this way.
 */
export function rankStandings(standings: readonly StudentStanding[], sort: LeaderboardSort): RankedStanding[] {
  const byName = (a: StudentStanding, b: StudentStanding) => a.student.name.localeCompare(b.student.name);
  const scored = standings.filter((s) => s.pct !== null);
  const best = [...scored].sort((a, b) => (b.pct ?? 0) - (a.pct ?? 0) || b.daysPresent - a.daysPresent || byName(a, b));
  const rank = new Map(best.map((s, i) => [s.student.id, i + 1]));
  const ordered = sort === 'high_first' ? best : [...best].reverse();
  const unscored = standings.filter((s) => s.pct === null).sort(byName);
  return [...ordered.map((standing) => ({ standing, rank: rank.get(standing.student.id) ?? null })), ...unscored.map((standing) => ({ standing, rank: null }))];
}

export class ReportService {
  constructor(
    private readonly attendance: AttendanceRepository,
    private readonly corrections: CorrectionRepository,
    private readonly staff: StaffAttendanceRepository,
    private readonly correctionService: CorrectionService,
    /** Simulated network time, so loading states are seen (0 in tests). */
    private readonly delay: Delay = noDelay,
  ) {}

  rangeFor(ctx: SessionContext, kind: DateRangeKind, custom?: { from: LocalDate; to: LocalDate }): DateRange {
    const today = toLocalDate(ctx.clock.now());
    switch (kind) {
      case 'day':
        return { kind, from: today, to: today };
      case 'week':
        return { kind, from: startOfWeek(today), to: today };
      case 'month':
        return { kind, from: startOfMonth(today), to: today };
      case 'custom': {
        const from = custom?.from ?? startOfMonth(today);
        const to = custom && compareDates(custom.to, today) <= 0 ? custom.to : today;
        return { kind, from: compareDates(from, to) <= 0 ? from : to, to };
      }
    }
  }

  /** "My attendance": this calendar month, to date. */
  thisMonth(ctx: SessionContext): DateRange {
    return this.rangeFor(ctx, 'month');
  }

  /** Batches, leaderboards and at-risk: the last report.windowDays days, today included. */
  recentWindow(ctx: SessionContext): DateRange {
    const today = toLocalDate(ctx.clock.now());
    return { kind: 'custom', from: addDays(today, -(ctx.config.reports.windowDays - 1)), to: today };
  }

  /** Batches this user's reports cover (PRD §19.1 and report.instructor_scope), in board order. */
  async batchesInScope(ctx: SessionContext): Promise<Batch[]> {
    if (ctx.journey.isPrincipal) return this.ordered(ctx, ctx.data.batches);
    const mapped = new Set(ctx.access.selection === 'trade_picker' ? ctx.user.batchIds : ctx.access.batchIds);
    if (ctx.access.tradeWideViewTradeId) ctx.data.batches.filter((b) => b.tradeId === ctx.access.tradeWideViewTradeId).forEach((b) => mapped.add(b.id));
    const scope = ctx.config.reports.instructorScope;
    const marked = new Set<string>();
    if (scope !== 'mapped') {
      const today = toLocalDate(ctx.clock.now());
      const subs = await this.attendance.listSubmissions({ from: startOfMonth(today), to: today });
      subs.filter((s) => s.markedBy === ctx.user.id).forEach((s) => marked.add(s.address.batchId));
    }
    const ids = scope === 'marked_only' ? marked : scope === 'mapped' ? mapped : new Set([...mapped, ...marked]);
    return this.ordered(ctx, ctx.data.batches.filter((b) => ids.has(b.id)));
  }

  private ordered(ctx: SessionContext, batches: readonly Batch[]): Batch[] {
    const tradeIndex = (b: Batch) => ctx.data.trades.findIndex((t) => t.id === b.tradeId);
    return [...batches].sort((a, b) => tradeIndex(a) - tradeIndex(b) || a.shift - b.shift || a.unit - b.unit);
  }

  private async submissions(ctx: SessionContext, batchIds: readonly string[], range: DateRange): Promise<Rows> {
    return (await this.records(ctx, batchIds, range)).rows;
  }

  /** The records reports read, with corrections folded, and the corrections themselves. */
  private async records(ctx: SessionContext, batchIds: readonly string[], range: DateRange): Promise<{ rows: Rows; corrections: readonly Correction[] }> {
    const subs = (await this.attendance.listSubmissions({ batchIds, from: range.from, to: range.to }))
      // Reports use the batch's own daily/half/period records; a subject instructor sees their subject's sessions.
      .filter((s) => (ctx.access.subjectId ? s.address.subjectId === ctx.access.subjectId : !s.address.subjectId));
    const corrections: Correction[] = await this.corrections.listForAttendance(subs.map((s) => s.id));
    return { rows: subs.map((sub) => ({ sub, marks: effectiveMarks(sub, corrections) })), corrections };
  }

  /** Per student, per day: the share of that day's sessions present (sessions of one day count as one day). */
  private standings(ctx: SessionContext, batch: Batch, rows: Rows): StudentStanding[] {
    const { eligibilityThresholdPct: threshold, atRiskMinDays } = ctx.config.reports;
    const mine = rows.filter((r) => r.sub.address.batchId === batch.id);
    return ctx.data.students
      .filter((s) => s.batchId === batch.id)
      .map((student) => ({ student, ...standingFigures([...studentDays(mine, student.id).values()].map(dayShare), threshold, atRiskMinDays) }));
  }

  /** "My attendance": this month's staff record, plus a short monthly trend (report.trendMonths). */
  async myAttendance(ctx: SessionContext): Promise<MyAttendanceSummary> {
    await this.delay(300);
    const range = this.thisMonth(ctx);
    const records = await this.staff.listBetween([ctx.user.id], range.from, range.to);
    const weight = (rs: typeof records) => rs.reduce((a, r) => a + presenceWeight({ status: r.status }), 0);
    const months = Math.max(0, ctx.config.reports.trendMonths);
    const trend: MonthStat[] = [];
    for (let k = months - 1; k >= 0; k--) {
      const month = shiftMonth(range.to, -k);
      const inMonth = k === 0 ? records : await this.staff.listBetween([ctx.user.id], month, endOfMonth(month));
      trend.push({ month, pct: pct(weight(inMonth), inMonth.length) });
    }
    return {
      range,
      presentDays: weight(records),
      absentDays: records.filter((r) => r.status === 'absent').length,
      workingDays: records.length,
      pct: pct(weight(records), records.length),
      trend,
    };
  }

  /** "My batches" (principal: every batch): average attendance and how many students are at risk. */
  async batchOverview(ctx: SessionContext): Promise<{ readonly range: DateRange; readonly threshold: number; readonly batches: readonly BatchOverview[] }> {
    await this.delay(350);
    const range = this.recentWindow(ctx);
    const threshold = ctx.config.reports.eligibilityThresholdPct;
    const batches = await this.batchesInScope(ctx);
    const rows = await this.submissions(ctx, batches.map((b) => b.id), range);
    return {
      range,
      threshold,
      batches: batches.map((batch) => {
        const standings = this.standings(ctx, batch, rows);
        const avg = average(standings);
        return { batch, trade: tradeOf(ctx.data, batch), students: standings.length, pct: shown(avg, threshold), low: avg !== null && avg < threshold, atRisk: standings.filter((s) => s.atRisk).length };
      }),
    };
  }

  /** One batch's students this month (the leaderboard); null when the batch isn't in this user's reports. */
  async batchStudents(ctx: SessionContext, batchId: string): Promise<readonly StudentStanding[] | null> {
    await this.delay(250);
    const batch = (await this.batchesInScope(ctx)).find((b) => b.id === batchId);
    if (!batch) return null;
    const rows = await this.submissions(ctx, [batch.id], this.recentWindow(ctx));
    return this.standings(ctx, batch, rows);
  }

  /**
   * Students below the threshold (report.eligibilityThresholdPct unless given), grouped by batch,
   * each with their position in the batch's leaderboard.
   */
  async atRisk(ctx: SessionContext, options: { readonly threshold?: number; readonly batchId?: string } = {}): Promise<AtRiskReport> {
    await this.delay(350);
    const range = this.recentWindow(ctx);
    const threshold = options.threshold ?? ctx.config.reports.eligibilityThresholdPct;
    const at = { ...ctx, config: { ...ctx.config, reports: { ...ctx.config.reports, eligibilityThresholdPct: threshold } } };
    const scope = await this.batchesInScope(ctx);
    const batches = options.batchId ? scope.filter((b) => b.id === options.batchId) : scope;
    const rows = await this.submissions(ctx, batches.map((b) => b.id), range);
    const groups = batches
      .map((batch) => {
        // The leaderboard's lowest-first order, so the ranks read down (31, 30, 29…) as they do there.
        const students = rankStandings(this.standings(at, batch, rows), 'low_first')
          .filter((r) => r.standing.atRisk)
          .map((r) => ({ ...r.standing, rank: r.rank }));
        return { batch, trade: tradeOf(ctx.data, batch), students };
      })
      .filter((g) => g.students.length > 0);
    return { range, threshold, groups, batchesChecked: batches.length };
  }

  /** The principal's headline over the same window as the batches: institute attendance, size, staff presence. */
  async instituteSummary(ctx: SessionContext): Promise<InstituteSummary> {
    await this.delay(300);
    const range = this.recentWindow(ctx);
    const threshold = ctx.config.reports.eligibilityThresholdPct;
    const rows = await this.submissions(ctx, ctx.data.batches.map((b) => b.id), range);
    const avg = average(ctx.data.batches.flatMap((b) => this.standings(ctx, b, rows)));
    let staffPct: number | null = null;
    if (ctx.config.staff.enabled) {
      const people = ctx.data.staff.filter((s) => s.role !== 'office_staff');
      const records = await this.staff.listBetween(people.map((p) => p.id), range.from, range.to);
      staffPct = pct(records.reduce((a, r) => a + presenceWeight({ status: r.status }), 0), records.length);
    }
    return { range, pct: shown(avg, threshold), low: avg !== null && avg < threshold, students: ctx.data.students.length, batches: ctx.data.batches.length, staffPct };
  }

  /**
   * The Institute card's trend (U3): report.trendMonths months, oldest first, this month from the 1st to today. Each is
   * the headline's method over its month (every batch's standings, threshold-safe); null for a month with no records.
   * Apart from instituteSummary, so voice's overview reads exactly what it read before.
   */
  async instituteTrend(ctx: SessionContext): Promise<MonthStat[]> {
    await this.delay(300);
    const months = Math.max(0, ctx.config.reports.trendMonths);
    // The guard is here, not only on the screen: the trend exists only beside the Institute report.
    if (!months || !ctx.journey.reports.enabled || !ctx.journey.reports.blocks.includes('institute_summary')) return [];
    const today = toLocalDate(ctx.clock.now());
    const threshold = ctx.config.reports.eligibilityThresholdPct;
    const rows = await this.submissions(ctx, ctx.data.batches.map((b) => b.id), { kind: 'custom', from: shiftMonth(today, -(months - 1)), to: today });
    return Array.from({ length: months }, (_, i) => {
      const month = shiftMonth(today, i - (months - 1));
      const inMonth = rows.filter((r) => startOfMonth(r.sub.address.date) === month);
      return { month, pct: shown(average(ctx.data.batches.flatMap((b) => this.standings(ctx, b, inMonth))), threshold) };
    });
  }

  /** The months a register can be downloaded for: this month and the one before (first days, newest first). */
  registerMonths(ctx: SessionContext): readonly LocalDate[] {
    return registerMonthsFor(toLocalDate(ctx.clock.now()));
  }

  /** The monthly register of the given batches, in board order; null when any batch is outside this user's reports or the month is not offered. */
  async register(ctx: SessionContext, request: { readonly batchIds: readonly string[]; readonly month: LocalDate }): Promise<AttendanceRegister | null> {
    await this.delay(350);
    return monthlyRegister(ctx, request, { batchesInScope: (c) => this.batchesInScope(c), records: (c, ids, range) => this.records(c, ids, range) });
  }

  /** The principal's staff attendance this month (D-154); null unless the staff view and the staff block are on. */
  async staffOverview(ctx: SessionContext): Promise<StaffOverview | null> {
    await this.delay(300);
    return staffOverviewFor(ctx, this.staff);
  }

  /** The monthly staff register for a month the sheet offers; null outside the staff report's scope. */
  async staffRegister(ctx: SessionContext, month: LocalDate): Promise<StaffRegister | null> {
    await this.delay(350);
    return staffMonthlyRegister(ctx, month, this.staff);
  }

  /** Detail reports (range switch + print). */
  async build(ctx: SessionContext, block: DetailBlock, range: DateRange): Promise<ReportData> {
    await this.delay(300);
    switch (block) {
      case 'staff_summary':
        return staffSummaryFor(ctx, this.staff, range);
      case 'correction_log':
        return { block, entries: await this.correctionService.log(ctx, range.from, range.to) };
    }
  }
}

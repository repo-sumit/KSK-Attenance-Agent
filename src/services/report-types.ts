/**
 * The shapes ReportService returns (PRD §19, D-053): kept apart from the service so it stays readable.
 * `@/services/reports` re-exports every one of them.
 */
import type { DateRangeKind } from '@/config/types';
import type { Batch, Student, Trade } from '@/domain/entities';
import type { LocalDate } from '@/lib/time';

export interface DateRange {
  readonly kind: DateRangeKind;
  readonly from: LocalDate;
  readonly to: LocalDate;
}

/**
 * One student's attendance over the window: the figure exam eligibility turns on (PRD §19.2).
 * A day counts once however many sessions it had (twice daily, periods): its sessions share the day.
 */
export interface StudentStanding {
  readonly student: Student;
  /** Rounded for display; never shows the threshold itself for a student who is below it. */
  readonly pct: number | null;
  /** By presence weight (present and OJT 1, half day ½); a day of several sessions gives partial credit. */
  readonly daysPresent: number;
  readonly daysMarked: number;
  /** Below the threshold on the unrounded figure, with at least report.atRiskMinDays marked days. */
  readonly atRisk: boolean;
}

export interface BatchOverview {
  readonly batch: Batch;
  readonly trade: Trade;
  readonly students: number;
  /** Average over every student-day in the window. */
  readonly pct: number | null;
  /** The average itself is below the threshold. */
  readonly low: boolean;
  readonly atRisk: number;
}

export interface MonthStat {
  /** First day of the month. */
  readonly month: LocalDate;
  readonly pct: number | null;
}

export interface MyAttendanceSummary {
  readonly range: DateRange;
  /** By presence weight (a half day counts ½), so it agrees with the percentage. */
  readonly presentDays: number;
  readonly absentDays: number;
  readonly workingDays: number;
  readonly pct: number | null;
  /** Oldest first, this month last; empty when report.trendMonths is 0. */
  readonly trend: readonly MonthStat[];
}

export type LeaderboardSort = 'high_first' | 'low_first';

/** A student with their leaderboard position in the batch (1 = best attendance; null = no marks yet). */
export interface RankedStanding {
  readonly standing: StudentStanding;
  readonly rank: number | null;
}

/** An at-risk student, with the position the batch's leaderboard gives them (so both lists read the same). */
export interface AtRiskStudent extends StudentStanding {
  readonly rank: number | null;
}

export interface AtRiskGroup {
  readonly batch: Batch;
  readonly trade: Trade;
  /** Only students below the threshold, lowest first (the batch leaderboard's lowest-first order). */
  readonly students: readonly AtRiskStudent[];
}

export interface AtRiskReport {
  readonly range: DateRange;
  readonly threshold: number;
  /** Batches with at least one student at risk, in batch order. */
  readonly groups: readonly AtRiskGroup[];
  /** How many batches were checked (to say "N other batches have no students at risk"). */
  readonly batchesChecked: number;
}

export interface InstituteSummary {
  readonly range: DateRange;
  readonly pct: number | null;
  readonly low: boolean;
  readonly students: number;
  readonly batches: number;
  /**
   * Staff presence over the same window (report.windowDays, not this month); null when staff attendance is off. The
   * Reports page leaves it out while its Staff attendance section shows this month's figure (D-154).
   */
  readonly staffPct: number | null;
}

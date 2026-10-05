/**
 * The arithmetic every attendance figure shares (PRD §19.2): presence weight
 * (present and OJT 1, half day ½), a day of several sessions counting once,
 * threshold-safe rounding and the at-risk rule. The leaderboard, batch averages
 * and the downloadable register (D-137) all use these, so they never drift apart.
 */
import type { AttendanceSubmission } from '@/domain/attendance';
import type { Batch, Trade } from '@/domain/entities';
import { presenceWeight } from '@/domain/marking';
import type { Mark } from '@/domain/status';
import type { LocalDate } from '@/lib/time';

/** Records with their marks after corrections (`effectiveMarks`). */
export type Rows = ReadonlyArray<{ readonly sub: AttendanceSubmission; readonly marks: Readonly<Record<string, Mark>> }>;

/** The batch's trade from the institute's data (every report and the register name a batch by it). */
export function tradeOf(data: { readonly trades: readonly Trade[] }, batch: Batch): Trade {
  const trade = data.trades.find((t) => t.id === batch.tradeId);
  if (!trade) throw new Error(`Batch ${batch.id} has no trade`);
  return trade;
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null);

/** A count of days rounded to one decimal (half days add up to .5 steps; this only removes floating-point dust). */
export const oneDecimal = (n: number) => Math.round(n * 10) / 10;

/** Rounded for display, but a figure below the threshold never rounds up to it ("74.6%" shows as 74, not 75 ⚠). */
export const shown = (raw: number | null, threshold: number) => (raw === null ? null : raw < threshold ? Math.min(Math.round(raw), threshold - 1) : Math.round(raw));

/** Unrounded average over every student-day. */
export const average = (standings: ReadonlyArray<{ readonly daysPresent: number; readonly daysMarked: number }>) => {
  const days = standings.reduce((a, s) => a + s.daysMarked, 0);
  return days ? (standings.reduce((a, s) => a + s.daysPresent, 0) / days) * 100 : null;
};

/** One student's marks on one day, in the rows' order. */
export type StudentDays = Map<LocalDate, Mark[]>;

/** A student's marks grouped by day (a day may hold several sessions: twice daily, periods). */
export function studentDays(rows: Rows, studentId: string): StudentDays {
  const days: StudentDays = new Map();
  for (const { sub, marks } of rows) {
    const m = marks[studentId];
    if (!m) continue;
    const day = days.get(sub.address.date);
    if (day) day.push(m);
    else days.set(sub.address.date, [m]);
  }
  return days;
}

/** The day's presence share: its sessions' presence weights averaged, so the day counts once. */
export const dayShare = (marks: readonly Mark[]) => (marks.length ? marks.reduce((a, m) => a + presenceWeight(m), 0) / marks.length : 0);

export interface StandingFigures {
  /** Rounded for display; never shows the threshold itself for a student who is below it. */
  readonly pct: number | null;
  /** By presence weight, one decimal. */
  readonly daysPresent: number;
  readonly daysMarked: number;
  /** Below the threshold on the unrounded figure, with at least atRiskMinDays marked days. */
  readonly atRisk: boolean;
}

/** A student's figures from the shares of the days they have marks on. */
export function standingFigures(shares: readonly number[], threshold: number, atRiskMinDays: number): StandingFigures {
  const present = shares.reduce((a, s) => a + s, 0);
  const raw = shares.length ? (present / shares.length) * 100 : null;
  const atRisk = raw !== null && shares.length >= atRiskMinDays && raw < threshold;
  return { pct: shown(raw, threshold), daysPresent: oneDecimal(present), daysMarked: shares.length, atRisk };
}

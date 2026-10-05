/**
 * The register's orchestration (D-137), kept beside ReportService: which months are offered, the scope check, one
 * reading of the clock, and the inputs gathered for the pure buildRegister (report-register.ts). ReportService
 * hands over its scope and record reads, so the register reads exactly what the leaderboard reads.
 */
import type { Correction } from '@/domain/attendance';
import type { Batch } from '@/domain/entities';
import { endOfMonth, shiftMonth, startOfMonth, toLocalDate, type LocalDate } from '@/lib/time';
import type { SessionContext } from './context';
import { tradeOf, type Rows } from './report-math';
import { buildRegister, type AttendanceRegister } from './report-register';

/** The months a register is offered for on `today`: this month and the one before (first days, newest first). */
export const registerMonthsFor = (today: LocalDate): readonly LocalDate[] => [startOfMonth(today), shiftMonth(today, -1)];

/** What ReportService lends the register: the same scope and record reads as every other report. */
export interface RegisterReads {
  batchesInScope(ctx: SessionContext): Promise<Batch[]>;
  records(ctx: SessionContext, batchIds: readonly string[], range: { readonly kind: 'custom'; readonly from: LocalDate; readonly to: LocalDate }): Promise<{ rows: Rows; corrections: readonly Correction[] }>;
}

/** The monthly register of the given batches, in board order; null when any batch is outside this user's reports or the month is not offered. */
export async function monthlyRegister(
  sessionCtx: SessionContext,
  request: { readonly batchIds: readonly string[]; readonly month: LocalDate },
  reads: RegisterReads,
): Promise<AttendanceRegister | null> {
  // One reading of the clock for the whole register: the month check, the range, today and the time it was made.
  const now = sessionCtx.clock.now();
  const ctx: SessionContext = { ...sessionCtx, clock: { now: () => new Date(now.getTime()) } };
  const today = toLocalDate(now);
  if (!request.batchIds.length || !registerMonthsFor(today).includes(request.month)) return null;
  const scope = await reads.batchesInScope(ctx);
  if (!request.batchIds.every((id) => scope.some((b) => b.id === id))) return null;
  const batches = scope.filter((b) => request.batchIds.includes(b.id));
  const to = request.month === startOfMonth(today) ? today : endOfMonth(request.month);
  const { rows, corrections } = await reads.records(ctx, batches.map((b) => b.id), { kind: 'custom', from: request.month, to });
  const { eligibilityThresholdPct: threshold, atRiskMinDays } = ctx.config.reports;
  return buildRegister({
    institute: ctx.institute,
    month: request.month,
    to,
    today,
    threshold,
    atRiskMinDays,
    generatedAt: now.toISOString(),
    preparedBy: { name: ctx.user.name, role: ctx.user.role },
    staffNames: new Map(ctx.data.staff.map((s) => [s.id, s.name])),
    sources: batches.map((batch) => {
      const mine = rows.filter((r) => r.sub.address.batchId === batch.id);
      const ids = new Set(mine.map((r) => r.sub.id));
      return {
        batch,
        trade: tradeOf(ctx.data, batch),
        students: ctx.data.students.filter((s) => s.batchId === batch.id),
        rows: mine,
        corrections: corrections.filter((c) => ids.has(c.attendanceId)),
        sessionsPerDay: ctx.config.marking.frequency,
      };
    }),
  });
}

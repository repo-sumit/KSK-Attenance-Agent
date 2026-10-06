/**
 * Detail reports (staff attendance, correction log): structured ReportData as
 * stacked mobile rows (title / subtitle parts / value chip) and a summary of
 * short parts, translated at render time. The Reports page itself is built from
 * sections. Master data (names, trades) is set as <Latin>; translated words never.
 */
import type { ReactNode } from 'react';
import type { IconName } from '@/components/ui/icons/Icon';
import type { Tone } from '@/components/ui/Badge';
import { Latin } from '@/components/ui/Latin';
import type { I18n, MessageKey } from '@/i18n';
import type { SessionContext } from '@/services/context';
import type { DateRange, DetailBlock, ReportData } from '@/services/reports';
import { toLocalDate } from '@/lib/time';
import { correctionReason, markLabel } from '../common/labels';
import { latinText, slotted } from '../common/LatinText';

export const DETAIL_META: Readonly<Record<DetailBlock, { icon: IconName; title: MessageKey; desc: MessageKey }>> = {
  staff_summary: { icon: 'user-check', title: 'reports.staff_summary', desc: 'reports.staff_summary_desc' },
  correction_log: { icon: 'history', title: 'reports.correction_log', desc: 'reports.correction_log_desc' },
};

export interface ReportRow {
  readonly id: string;
  readonly title: ReactNode;
  /** Short parts, each kept whole and joined by "·" (a wrapped line never starts with it); one part for a sentence. */
  readonly subtitle: readonly ReactNode[];
  readonly value: string;
  readonly tone: Tone;
  readonly icon?: IconName;
  /** Read after the value by a screen reader ("below 90%"). */
  readonly sr?: string;
}

type T = I18n['t'];
type F = I18n['format'];

export function rangeLabel(t: T, f: F, range: DateRange): string {
  switch (range.kind) {
    case 'day':
      return t('reports.labelDay');
    case 'week':
      return t('reports.labelWeek');
    case 'month':
      return t('reports.labelMonth');
    case 'custom':
      return t('reports.labelCustom', { from: f.dayMonth(range.from), to: f.dayMonth(range.to) });
  }
}

/** Only an exception carries status colour, as on the Reports page (RPT-9): below the threshold is amber with its icon; anything else is a plain chip. */
const pctTone = (low: boolean): Pick<ReportRow, 'tone' | 'icon'> => (low ? { tone: 'warning', icon: 'alert' } : { tone: 'neutral' });

export function buildReport(t: T, f: F, ctx: SessionContext, data: ReportData, range: DateRange): { summary: readonly string[]; rows: ReportRow[] } {
  const r = rangeLabel(t, f, range);
  const session = (batchId: string): ReactNode => {
    const batch = ctx.data.batches.find((b) => b.id === batchId);
    const trade = batch && ctx.data.trades.find((x) => x.id === batch.tradeId);
    return batch && trade ? latinText(t, 'session.batchWithTrade', { trade: trade.name, shift: String(batch.shift), unit: String(batch.unit) }, ['trade']) : batchId;
  };
  switch (data.block) {
    case 'staff_summary': {
      const threshold = ctx.config.reports.staffThresholdPct;
      return {
        summary: [r, t('reports.sumStaffPct', { pct: data.pct ?? 0 }), t('reports.staffCount', { count: data.staff.length })],
        // Built as the Staff attendance section's rows (D-154): the same order, "(you)", role · trade, "n of m days",
        // absences and unmarked days apart (unmarked never counts as absent), and the % chip.
        rows: data.staff.map((s) => {
          const trade = ctx.data.trades.find((x) => x.id === s.member.primaryTradeId)?.name ?? ctx.data.subjects.find((x) => x.id === s.member.subjectId)?.name;
          const role = t(`role.${s.member.role}`);
          return {
            id: s.member.id,
            title: s.member.id === ctx.user.id ? latinText(t, 'staff.you', { name: s.member.name }, ['name']) : <Latin>{s.member.name}</Latin>,
            subtitle: [
              trade ? latinText(t, 'role.withTrade', { role, trade }, ['trade']) : role,
              t('reports.studentDays', { present: s.present, days: s.marked }),
              t('reports.staffAbsentCount', { count: s.counts.absent }),
              t('reports.staffUnmarkedCount', { count: s.unmarked }),
            ],
            // Below report.staffThresholdPct (the service's unrounded comparison).
            ...pctTone(s.low),
            value: s.pct === null ? t('reports.noValue') : f.percent(s.pct),
            sr: s.low ? t('reports.belowTarget', { pct: threshold }) : undefined,
          };
        }),
      };
    }
    case 'correction_log':
      return {
        summary: [r, t('reports.correctionCount', { count: data.entries.length })],
        rows: data.entries.map((e) => ({
          id: e.correctionId,
          title: latinText(t, 'reports.correctionRow', { student: e.studentName, from: markLabel(t, e.oldMark), to: markLabel(t, e.newMark) }, ['student']),
          subtitle: [
            slotted(t, 'reports.correctionSub', {
              session: session(e.batchId),
              reason: correctionReason(t, e),
              by: <Latin>{e.actorName}</Latin>,
              when: `${f.dayMonth(toLocalDate(new Date(e.timestamp)))} · ${f.time(e.timestamp)}`,
            }),
          ],
          value: t('reports.logged'),
          tone: 'neutral',
          icon: 'history',
        })),
      };
  }
}

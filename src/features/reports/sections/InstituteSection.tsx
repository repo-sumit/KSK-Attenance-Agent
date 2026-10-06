'use client';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useJourney, useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { ReportSummaryCard, type SummaryFigure } from './ReportSummaryCard';

const TOPICS = ['attendance', 'corrections', 'staff'] as const;

/**
 * The principal's headline over the report window, drawn as My attendance and Staff attendance are (D-074, U3): the
 * institute's attendance captioned "Attendance", its size as icon facts, and the monthly trend. `staffFigure` false:
 * the page's Staff attendance section shows this month's staff figure instead, so one page never shows two staff
 * percentages (D-154); true, staff presence is a second figure of equal weight beside it.
 */
export function InstituteSection({ staffFigure = true }: { readonly staffFigure?: boolean }) {
  const { t, format } = useI18n();
  const ctx = useSession();
  const j = useJourney();
  const { reports } = useServices();
  const { data } = useQuery(`report-institute:${ctx.institute.id}`, () => reports.instituteSummary(ctx), TOPICS);
  const { data: trend, error: trendError } = useQuery(`report-institute-trend:${ctx.institute.id}`, () => reports.instituteTrend(ctx), TOPICS);
  // The card waits for its trend so it never jumps, but a trend that fails never holds the headline back.
  const trendSettled = trend !== undefined || trendError !== undefined;
  const figures: SummaryFigure[] = data
    ? [
        { value: data.pct === null ? t('reports.noValue') : format.percent(data.pct), label: t('reports.attendanceLabel') },
        ...(!staffFigure || data.staffPct === null ? [] : [{ value: format.percent(data.staffPct), label: t('reports.staff_summary') }]),
      ]
    : [];
  return (
    <Section id="institute" title={t('reports.institute_summary')} subtitle={t('reports.lastDays', { count: j.reports.windowDays })}>
      {!data || !trendSettled ? (
        <Skeleton variant="summary" count={Math.max(0, ctx.config.reports.trendMonths)} label={t('common.loading')} />
      ) : (
        <ReportSummaryCard
          figures={figures}
          facts={[
            { icon: 'users', tone: 'muted', text: t('common.students', { count: data.students }) },
            { icon: 'layers', tone: 'muted', text: t('reports.batchCount', { count: data.batches }) },
          ]}
          trend={trend}
        />
      )}
    </Section>
  );
}

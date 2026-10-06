'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyNote, EmptyState } from '@/components/ui/EmptyState';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import type { DateRangeKind } from '@/config/types';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { isEmbeddedWebView } from '@/lib/platform';
import { routes } from '@/lib/routes';
import { cx } from '@/lib/cx';
import { toLocalDate } from '@/lib/time';
import { isDetailBlock } from '@/services/reports';
import { DETAIL_META, buildReport, rangeLabel } from './reportRows';
import styles from './Report.module.css';

const RANGE_KEYS = { day: 'reports.day', week: 'reports.week', month: 'reports.month', custom: 'reports.custom' } as const;

/** Short parts on one line, each kept whole, a "·" after every part but the last (a wrapped line never starts with it). */
function Parts({ parts, className, as: Tag = 'span' }: { readonly parts: readonly ReactNode[]; readonly className?: string; readonly as?: 'span' | 'p' }) {
  return (
    <Tag className={cx(className, styles.parts, parts.length > 1 && styles.joined)}>
      {parts.map((part, i) => (
        <span key={i}>{part}</span>
      ))}
    </Tag>
  );
}

/**
 * A detail report (staff attendance, correction log): range switch, a one-line
 * summary, stacked rows — never a desktop table (PRD §19), and print / PDF.
 */
export function ReportScreen() {
  const { t, format } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ctx = useSession();
  const { reports } = useServices();
  const params = useSearchParams();
  const j = ctx.journey.reports;
  const requested = params.get('r') ?? '';
  const block = isDetailBlock(requested) ? requested : 'staff_summary';
  const kind = (params.get('range') ?? 'month') as DateRangeKind;
  const today = toLocalDate(ctx.clock.now());
  const custom = { from: params.get('from') ?? `${today.slice(0, 8)}01`, to: params.get('to') ?? today };
  const range = reports.rangeFor(ctx, j.dateRanges.includes(kind) ? kind : 'month', kind === 'custom' ? custom : undefined);
  const allowed = j.enabled && isDetailBlock(requested) && j.blocks.includes(block);

  const { data, loading } = useQuery(`report:${block}:${range.kind}:${range.from}:${range.to}`, () => (allowed ? reports.build(ctx, block, range) : Promise.resolve(null)), ['attendance', 'corrections', 'staff']);
  const built = data ? buildReport(t, format, ctx, data, range) : null;
  const setRange = (next: DateRangeKind, extra: { from?: string; to?: string } = {}) => router.replace(routes.report(block, next, next === 'custom' ? { from: extra.from ?? custom.from, to: extra.to ?? custom.to } : {}));

  const print = () => {
    // Android WebViews (SwiftChat included) expose window.print but ignore it unless the host wires printing.
    if (!isEmbeddedWebView() && typeof window.print === 'function') window.print();
    else toast.show(t('reports.printUnavailable'));
  };

  if (!allowed) return <ScreenLayout area="reports" width="reading" header={<AppHeader back="back" title={t('reports.title')} backHref={routes.reports} />}><EmptyState icon="chart" title={t('problem.notFoundTitle')} /></ScreenLayout>;

  return (
    <ScreenLayout area="reports" width="reading" header={<AppHeader back="back" title={t(DETAIL_META[block].title)} backHref={routes.reports} />}>
      <div className={styles.printHead}>
        <p className={styles.printTitle}>{t('reports.printTitle', { report: t(DETAIL_META[block].title), institute: ctx.institute.name })}</p>
        <p>{t('reports.printMeta', { range: rangeLabel(t, format, range), when: `${format.dayMonthYear(today)} ${format.time(ctx.clock.now())}` })}</p>
      </div>
      <Segmented
        className={styles.noPrint}
        label={t('reports.range')}
        size="sm"
        fullWidth
        value={range.kind}
        onChange={(v) => setRange(v)}
        options={j.dateRanges.map((r) => ({ value: r, label: t(RANGE_KEYS[r]) }))}
      />
      {range.kind === 'custom' && (
        <div className={`${styles.custom} ${styles.noPrint}`}>
          <label className={styles.dateField}>
            <span>{t('reports.from')}</span>
            <input type="date" max={range.to} value={range.from} onChange={(e) => e.target.value && setRange('custom', { from: e.target.value })} />
          </label>
          <label className={styles.dateField}>
            <span>{t('reports.to')}</span>
            <input type="date" min={range.from} max={today} value={range.to} onChange={(e) => e.target.value && setRange('custom', { to: e.target.value })} />
          </label>
        </div>
      )}
      {!built || loading ? (
        <Skeleton variant="rows" count={5} label={t('common.loading')} />
      ) : (
        <>
          <Card>
            <Parts className={styles.summary} parts={built.summary} as="p" />
          </Card>
          {built.rows.length === 0 ? (
            <EmptyNote>{t('reports.noData')}</EmptyNote>
          ) : (
            <Card as="ul" divided className={styles.rows}>
              {built.rows.map((row) => (
                <li key={row.id} className={styles.row}>
                  <span className={styles.text}>
                    <span className={styles.title}>{row.title}</span>
                    <Parts className={styles.sub} parts={row.subtitle} />
                  </span>
                  <Badge tone={row.tone} icon={row.icon} size="md">
                    {row.value}
                    {row.sr && <span className="visually-hidden">{` · ${row.sr}`}</span>}
                  </Badge>
                </li>
              ))}
            </Card>
          )}
          {j.pdfDownload && (
            <Button variant="ghost" size="md" leadingIcon="printer" onClick={print} className={styles.print}>
              {t('reports.print')}
            </Button>
          )}
          <p className={styles.signature}>{t('reports.signature')}</p>
        </>
      )}
    </ScreenLayout>
  );
}

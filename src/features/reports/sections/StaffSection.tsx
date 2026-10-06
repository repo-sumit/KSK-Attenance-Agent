'use client';
import { useEffect, useRef, useState, type RefObject } from 'react';
import { scrollIntoViewSettled } from '@/lib/scroll';
import { Button } from '@/components/ui/Button';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { statusIcon } from '@/components/ui/status-style';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useJourney, useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import { routes } from '@/lib/routes';
import type { LocalDate } from '@/lib/time';
import type { StaffOverview } from '@/services/reports';
import { RegisterDownloadButton, RegisterDownloadSheet, type RegisterTarget } from '../register/RegisterDownloadSheet';
import { ReportSummaryCard, type SummaryFact } from './ReportSummaryCard';
import { StaffList } from './StaffList';
import styles from './StaffList.module.css';

type T = ReturnType<typeof useI18n>['t'];

/** Today's gaps, in amber with the Not marked ring (U12): shown even before any day of the month is recorded. */
function todayFacts(t: T, data: StaffOverview): SummaryFact[] {
  return data.today.unmarked ? [{ icon: statusIcon('not_marked'), tone: 'warning', text: t('reports.staffNotMarkedToday', { count: data.today.unmarked }) }] : [];
}

/** The headline's lines: staff-days present (by weight, the service's figure) and absent, leave only where the state has it, and today's gaps. */
function headlineFacts(t: T, data: StaffOverview, leave: boolean): SummaryFact[] {
  const { month } = data;
  return [
    { icon: 'circle-check', tone: 'success', text: t('reports.presentDays', { count: data.present }) },
    { icon: 'circle-x', tone: month.absent ? 'error' : 'muted', text: t('reports.absentDays', { count: month.absent }) },
    ...(leave ? [{ icon: 'calendar', tone: month.leave ? 'info' : 'muted', text: t('reports.leaveDays', { count: month.leave }) } as const] : []),
    ...todayFacts(t, data),
  ];
}

/** Voice's requests reach a Reports screen that mounts after the navigation that opened it (D-085); a later navigation makes them stale. */
const REPLAY = { replayMissed: true, replayBound: (e: { readonly type: string }) => e.type === 'navigate' } as const;

/**
 * Voice's staff register request (`open_staff_register`, D-156): the sheet opens on the staff scope and the month, keyed
 * by the request so each one starts on its own month; when it closes, focus goes to the Staff register button (or the
 * heading), since no button opened it.
 */
function useVoiceRegister(section: RefObject<HTMLElement | null>, buttonLabel: string) {
  const [request, setRequest] = useState<{ readonly month: LocalDate; readonly seq: number } | null>(null);
  const latest = useRef(0);
  const restore = useRef(false);
  useVoiceBusEvent('open_staff_register', (e) => {
    latest.current = e.seq;
    setRequest({ month: e.month, seq: e.seq });
  }, REPLAY);
  useEffect(() => {
    if (request || !restore.current) return;
    restore.current = false;
    const button = [...(section.current?.querySelectorAll('button') ?? [])].find((b) => b.textContent?.trim() === buttonLabel);
    (button ?? section.current?.querySelector<HTMLElement>('h2'))?.focus({ preventScroll: true });
  }, [request, section, buttonLabel]);
  const close = (seq: number) => {
    // a sheet replaced by a newer request closes only itself
    if (seq === latest.current) restore.current = true;
    setRequest((r) => (r?.seq === seq ? null : r));
  };
  return { request, close };
}

/**
 * Staff attendance (D-154): the principal's report card for this month to date, after At-risk. A headline
 * (the institute's staff-days by presence weight, with a trend), then every staff member lowest first: today's status,
 * days present of days marked, days not marked (shown apart, never counted as absent) and the %, amber only below
 * report.staffThresholdPct. The detail report keeps the date ranges and print; "Staff register" downloads the month.
 * Voice brings the section into view (`show_staff_report`), also when Reports mounts after the request, and opens the
 * staff register sheet on a month (`open_staff_register`).
 */
export function StaffSection() {
  const { t, format } = useI18n();
  const ctx = useSession();
  const j = useJourney();
  const { reports } = useServices();
  const { data } = useQuery(`report-staff:${ctx.institute.id}`, () => reports.staffOverview(ctx), ['staff']);
  const section = useRef<HTMLElement>(null);
  const [shown, setShown] = useState(0);
  useVoiceBusEvent('show_staff_report', (e) => setShown(e.seq), REPLAY);
  const voiceRegister = useVoiceRegister(section, t('reports.register.staffButton'));
  const loaded = data !== undefined;
  useEffect(() => {
    // Once the list is in, so the section ends up where it will stay; the heading takes focus for a screen reader.
    if (!shown || !loaded) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    const el = section.current;
    if (!el) return;
    // Held in view while the sections above it finish loading (they grow and would push it away).
    const stop = scrollIntoViewSettled(el, reduced);
    el.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
    return stop;
  }, [shown, loaded]);
  // Outside the staff report's scope the service answers null: nothing to show.
  if (data === null) return null;
  const range = j.reports.dateRanges.includes('month') ? 'month' : j.reports.dateRanges[0];
  const target: RegisterTarget = { batchIds: [], subject: t('reports.register.staffFor', { institute: ctx.institute.shortName }), scope: { kind: 'staff' } };
  const action = j.reports.pdfDownload ? <RegisterDownloadButton target={target} /> : undefined;
  const asked = voiceRegister.request;

  return (
    <Section ref={section} id="staff" focusableHeading title={t('reports.staff_summary')} subtitle={t('reports.thisMonth')} action={action}>
      {!data ? (
        <Skeleton variant="rows" leading="none" count={3} label={t('common.loading')} />
      ) : (
        <>
          {data.staffDays === 0 ? (
            <ReportSummaryCard figures={[]} empty={t('reports.noDaysYet')} facts={todayFacts(t, data)} trend={data.trend} />
          ) : (
            <ReportSummaryCard
              figures={[{ value: data.pct === null ? t('reports.noValue') : format.percent(data.pct), label: t('reports.attendanceLabel') }]}
              facts={headlineFacts(t, data, j.staff.statusSet.includes('leave'))}
              trend={data.trend}
            />
          )}
          <StaffList staff={data.staff} threshold={data.threshold} />
          <div className={styles.more}>
            <Button variant="ghost" size="md" trailingIcon="chevron-right" href={routes.report('staff_summary', range)}>
              {t('reports.staffMore')}
            </Button>
          </div>
        </>
      )}
      {asked && j.reports.pdfDownload && <RegisterDownloadSheet key={asked.seq} target={target} initialMonth={asked.month} onClose={() => voiceRegister.close(asked.seq)} />}
    </Section>
  );
}

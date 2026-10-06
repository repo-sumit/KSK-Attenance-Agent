'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { AttendanceStatusSelect, LockedStatus } from '@/components/ui/AttendanceStatusSelect';
import { Avatar } from '@/components/ui/Avatar';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { DetailRows } from '@/components/ui/DetailRows';
import { Latin } from '@/components/ui/Latin';
import { Skeleton } from '@/components/ui/Skeleton';
import { AttendanceSummary, SummaryDate, SummaryMeta, summaryItems } from '@/components/ui/AttendanceSummary';
import { useToast } from '@/components/ui/Toast';
import { StatusLine } from '@/components/ui/StatusLine';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { TopBand } from '@/components/shell/TopBand';
import { AppHeader } from '@/features/shell/AppHeader';
import { countMarks } from '@/domain/marking';
import type { StatusCode } from '@/domain/status';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import { cx } from '@/lib/cx';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import type { StaffDayRow } from '@/services/staff-attendance';
import { ViewSwitch } from '../attendance/AttendanceTabScreen';
import { summaryLabels } from '../common/labels';
import { LatinText } from '../common/LatinText';
import { RoleLine } from '../common/RoleLine';
import styles from './Staff.module.css';

/**
 * The person Voice Agent asks about (`focus_staff`, D-156): the row scrolls into view and is outlined, as a roster row
 * is for `focus_student`; again on every new request (the same person asked again included). The request also reaches
 * a screen that mounts after voice's navigation, until voice navigates elsewhere.
 */
function useStaffFocus(loaded: boolean) {
  const list = useRef<HTMLUListElement>(null);
  const [focus, setFocus] = useState<{ readonly staffId: string; readonly seq: number } | null>(null);
  useVoiceBusEvent('focus_staff', (e) => setFocus({ staffId: e.staffId, seq: e.seq }), { replayMissed: true, replayBound: (e) => e.type === 'navigate' });
  useEffect(() => {
    if (!focus || !loaded) return;
    const row = [...(list.current?.querySelectorAll<HTMLElement>('[data-staff]') ?? [])].find((el) => el.dataset.staff === focus.staffId);
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    row?.scrollIntoView?.({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
  }, [focus, loaded]);
  return { list, focusedId: focus?.staffId ?? null };
}

/** PRD §18.3: every instructor plus the principal; self-marked rows are locked, the principal fills gaps. */
export function StaffScreen() {
  const { t, format } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ctx = useSession();
  const { staffAttendance, sync } = useServices();
  const { data: rows } = useQuery(`staff-day:${ctx.institute.id}`, () => staffAttendance.day(ctx), ['staff']);
  const [draft, setDraft] = useState<Record<string, StatusCode>>({});
  const [sheet, setSheet] = useState(false);
  const [busy, setBusy] = useState(false);
  /** A pending view switch waiting for "Discard unsaved changes?". */
  const [leaving, setLeaving] = useState<(() => void) | null>(null);
  const allowed = ctx.journey.staff.principalStaffView;
  const today = toLocalDate(ctx.clock.now());
  const { list: listRef, focusedId } = useStaffFocus(Boolean(rows));

  useEffect(() => {
    if (!allowed) router.replace(routes.attendance);
  }, [allowed, router]);
  if (!allowed) return null;

  const roleOf = (r: StaffDayRow) => ({
    role: t(`role.${r.member.role}`),
    trade: ctx.data.trades.find((x) => x.id === r.member.primaryTradeId)?.name ?? ctx.data.subjects.find((s) => s.id === r.member.subjectId)?.name,
  });
  const list = [...(rows ?? [])].sort((a, b) => Number(Boolean(a.record)) - Number(Boolean(b.record)));
  // The day as saved: staff, then each status the state enables, then who is still not marked.
  const saved = countMarks(Object.fromEntries(list.map((r) => [r.member.id, { status: r.record?.status ?? null }])));
  const summary = summaryLabels(t, format, 'staff');
  const changes = Object.keys(draft).length;
  const canMark = ctx.journey.staff.principalCanMark;
  const statuses = ctx.journey.staff.statusSet;
  const options = statuses.map((status) => ({ status, label: t(`status.${status}`) }));
  const how = (rec: NonNullable<StaffDayRow['record']>) => (rec.source === 'self' ? t('staff.selfVerified', { time: format.time(rec.deviceTimestamp) }) : t('staff.byPrincipal'));

  const save = async () => {
    setBusy(true);
    const result = await staffAttendance.markByPrincipal(ctx, Object.entries(draft).map(([staffId, status]) => ({ staffId, status })));
    setBusy(false);
    setSheet(false);
    // A failed save keeps every choice so the principal can simply try again.
    if (!result.ok) return toast.show(t('staff.saveFailed'));
    setDraft({});
    const { saved, skipped } = result.value;
    // D-032: say so when the marks are only on this phone (offline: they sync on reconnect).
    const done = sync.status().online ? t('staff.saved') : t('staff.savedOffline');
    toast.show(skipped.length ? t('staff.savedPartial', { saved, skipped: skipped.length }) : done);
  };
  const nameOf = (staffId: string) => ctx.data.staff.find((s) => s.id === staffId)?.name ?? staffId;
  const draftNames = (status: StatusCode) =>
    Object.entries(draft)
      .filter(([, s]) => s === status)
      .map(([id]) => nameOf(id));

  return (
    <ScreenLayout
      surface="raised"
      padding="none"
      header={<AppHeader title={t('nav.attendance')} />}
      top={
        // The Students view's band, with the day's totals under the switch; the date leads them as on the roster.
        <TopBand>
          <ViewSwitch value="staff" onSwitch={(go) => (changes > 0 ? setLeaving(() => go) : go())} />
          <AttendanceSummary
            counts={saved}
            statuses={ctx.journey.staff.statusSet}
            labels={summary}
            showNotMarked
            lead={<SummaryMeta icon="clock" parts={[<SummaryDate key="date" long={format.longDate(today)} short={format.shortDate(today)} />]} />}
          />
        </TopBand>
      }
      footer={
        changes > 0 ? (
          <Button fullWidth onClick={() => setSheet(true)}>
            {t('staff.save', { count: changes })}
          </Button>
        ) : undefined
      }
      area="attendance"
      // While marks are unsaved the Save action takes the nav's place (phones), and leaving asks first.
      bottomNav={changes === 0}
      guardNavigation={changes > 0 ? (go) => setLeaving(() => go) : undefined}
      width="reading"
    >
      {!rows ? (
        <Skeleton variant="rows" count={6} label={t('common.loading')} />
      ) : (
        <ul ref={listRef}>
          {list.map((row) => {
            const rec = row.record;
            const choice = draft[row.member.id];
            const focused = focusedId === row.member.id;
            return (
              <li key={row.member.id} className={cx(styles.row, focused && styles.current)} data-staff={row.member.id} data-current={focused || undefined} aria-current={focused || undefined}>
                <div className={styles.main}>
                  <Avatar name={row.member.name} size={40} />
                  <span className={styles.who}>
                    {/* Names are Latin master data; "(you)" and the role are translated words. */}
                    <span className={styles.name}>
                      {row.member.id === ctx.user.id ? <LatinText k="staff.you" params={{ name: row.member.name }} latin={['name']} /> : <Latin>{row.member.name}</Latin>}
                    </span>
                    <span className={styles.role}>
                      <RoleLine {...roleOf(row)} />
                    </span>
                  </span>
                  <span className={styles.status}>
                    {rec ? (
                      <LockedStatus status={rec.status} label={t(`status.${rec.status}`)} reason={t('staff.locked')} />
                    ) : canMark ? (
                      <AttendanceStatusSelect
                        label={t('roster.statusFor', { name: row.member.name })}
                        options={options}
                        value={choice ?? null}
                        placeholder={t('roster.choose')}
                        onChange={(s) => setDraft((d) => ({ ...d, [row.member.id]: s }))}
                      />
                    ) : (
                      <StatusLine tone="warning" icon="circle">
                        {t('status.not_marked')}
                      </StatusLine>
                    )}
                    {rec ? <span className={styles.how}>{how(rec)}</span> : choice && <span className={styles.how}>{t('staff.notSaved')}</span>}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={t('staff.sheetTitle')}
        description={t('staff.sheetBody')}
        actions={
          <>
            <Button fullWidth loading={busy} onClick={() => void save()}>{t('staff.save', { count: changes })}</Button>
            <Button variant="secondary" fullWidth disabled={busy} onClick={() => setSheet(false)}>{t('common.cancel')}</Button>
          </>
        }
      >
        <DetailRows
          variant="hero"
          emphasis
          rows={summaryItems(countMarks(Object.fromEntries(Object.entries(draft).map(([id, status]) => [id, { status }]))), statuses, summary)
            .filter((item) => item.key !== 'total')
            .map((item) => ({ key: item.key, label: item.label, value: format.number(item.value), tone: item.tone === 'neutral' ? ('default' as const) : item.tone }))}
        />
        {/* Name the people being marked Absent: the save can't be undone today. */}
        {draftNames('absent').length > 0 && (
          <p className={styles.names}>
            {t('staff.absentNames')} <Latin>{draftNames('absent').join(', ')}</Latin>
          </p>
        )}
      </BottomSheet>
      <BottomSheet
        open={Boolean(leaving)}
        onClose={() => setLeaving(null)}
        title={t('staff.discardTitle', { count: changes })}
        description={t('staff.discardBody')}
        actions={
          <>
            <Button fullWidth onClick={() => setLeaving(null)}>{t('staff.keepEditing')}</Button>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => {
                const go = leaving;
                setLeaving(null);
                setDraft({});
                go?.();
              }}
            >
              {t('staff.discard')}
            </Button>
          </>
        }
      />
    </ScreenLayout>
  );
}

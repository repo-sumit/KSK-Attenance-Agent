'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/icons/Icon';
import { Latin } from '@/components/ui/Latin';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { StatusLine } from '@/components/ui/StatusLine';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { TopBand } from '@/components/shell/TopBand';
import { AppHeader } from '@/features/shell/AppHeader';
import { awaitsSync, parseSessionKey } from '@/domain/attendance';
import { countMarks } from '@/domain/marking';
import { AttendanceSummary } from '@/components/ui/AttendanceSummary';
import { InlineNote } from '@/components/ui/InlineNote';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { cx } from '@/lib/cx';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import { batchTitle, batchWithTrade, markLabel, statusOf, summaryLabels } from '../../common/labels';
import { latinText } from '../../common/LatinText';
import { useSessionLabel } from '../useSessionLabel';
import styles from './Record.module.css';
import { useAttendanceRoot } from '../useAttendanceRoot';

/**
 * Read-only record of the session it was opened for (D-150). Instructors see the lock; with the correction right,
 * today's synced record links each student to the correction. Another day's record (a typed URL) is read-only.
 */
export function RecordScreen() {
  const { t, format } = useI18n();
  const root = useAttendanceRoot();
  const ctx = useSession();
  const { attendance } = useServices();
  const label = useSessionLabel();
  const key = useSearchParams().get('s') ?? '';
  const address = parseSessionKey(key);
  const today = toLocalDate(ctx.clock.now());
  const { data: detail, loading } = useQuery(`record:${key}`, () => attendance.getDetail(ctx, key), ['attendance', 'corrections', 'offline']);
  const { data: card } = useQuery(`record-card:${key}`, () => attendance.findCard(ctx, key), ['attendance']);

  const isToday = address?.date === today;
  const canCorrect = ctx.journey.corrections && isToday;
  const batch = ctx.data.batches.find((b) => b.id === address?.batchId);
  const trade = ctx.data.trades.find((x) => x.id === batch?.tradeId);

  const header = <AppHeader back="back" title={trade ? <Latin>{trade.name}</Latin> : t('common.loading')} subtitle={batch ? batchTitle(t, batch) : undefined} backHref={root.href} />;
  if (loading && !detail) return <ScreenLayout area={root.area} width="reading" header={header}><Skeleton variant="rows" count={6} label={t('common.loading')} /></ScreenLayout>;

  const submission = detail?.submission;
  if (!detail || !submission) {
    // A past day with nothing submitted has no card: name the batch itself.
    const session = card ? [label(card).title, label(card).meta].filter(Boolean).join(' · ') : batch && trade ? batchWithTrade(t, trade, batch) : '';
    return (
      <ScreenLayout area={root.area} width="reading" header={header}>
        <EmptyState
          icon="clipboard-check"
          title={t('record.notSubmittedTitle')}
          body={isToday ? t('record.notSubmittedBody', { session }) : t('record.notSubmittedPast', { session, date: format.dayMonth(address?.date ?? today) })}
          action={
            // Own attendance first (D-152): said as the rows say it, never a button that ends on the gateway's refusal.
            card?.selfFirst ? (
              <StatusLine tone="warning" icon="user-check">
                {t('session.selfFirst')}
              </StatusLine>
            ) : card?.canMark ? (
              <Button size="md" href={routes.open(key)}>
                {t('home.markAttendance')}
              </Button>
            ) : undefined
          }
        />
      </ScreenLayout>
    );
  }

  // A record the server refused (someone else submitted first) shows only while the server's copy cannot be read.
  const rejected = submission.syncState === 'rejected';
  const pending = awaitsSync(submission);
  const synced = submission.syncState === 'synced';
  const by = ctx.data.staff.find((s) => s.id === submission.markedBy)?.name ?? '';
  const time = format.time(submission.deviceTimestamp);
  // The submitter's name alone is set as Latin master data; the sentence around it is translated text.
  const status = rejected
    ? t('sync.rejected')
    : pending
      ? t('record.pending')
      : !isToday
        ? latinText(t, 'record.submittedOn', { date: format.dayMonth(submission.address.date), time, name: by }, ['name'])
        : ctx.journey.corrections
          ? latinText(t, 'record.submittedBy', { time, name: by }, ['name'])
          : t('record.submitted', { time });
  const note = rejected
    ? null
    : pending && ctx.journey.corrections
      ? t('record.notePending')
      : !ctx.journey.corrections
        ? t('record.noteInstructor')
        : isToday
          ? t('record.notePrincipalToday')
          : t('record.notePrincipalPast');
  const strip = rejected ? { tone: 'warning' as const, icon: 'alert' as const } : pending ? { tone: 'warning' as const, icon: 'cloud-upload' as const } : { tone: 'success' as const, icon: 'lock' as const };
  const counts = countMarks(detail.marks);

  return (
    <ScreenLayout
      area={root.area}
      width="reading"
      surface="raised"
      padding="none"
      header={header}
      top={
        // The status strip is the summary's lead: above the tiles on phones, beside them from 600px (D-069, D-159).
        <TopBand>
          <AttendanceSummary
            counts={counts}
            statuses={ctx.journey.marking.statuses}
            labels={summaryLabels(t, format)}
            lead={
              <Banner layout="strip" tone={strip.tone} icon={strip.icon}>
                {status}
              </Banner>
            }
          />
          {note && <InlineNote>{note}</InlineNote>}
        </TopBand>
      }
    >
      <ol className={styles.list}>
        {detail.students.map((student) => {
          const mark = detail.marks[student.id];
          const correctable = canCorrect && synced && mark?.status !== 'ojt';
          const content = (
            <>
              <span className={cx(styles.roll, 'tnum')}>{student.rollNo}</span>
              <span className={styles.who}>
                <span className={styles.name}>
                  <Latin>{student.name}</Latin>
                </span>
                <span className={styles.father}>{latinText(t, 'roster.father', { name: student.fatherName }, ['name'])}</span>
                {isToday && detail.correctedStudentIds.has(student.id) && (
                  <span className={styles.corrected}>
                    <Icon name="history" size={12} />
                    {t('record.corrected')}
                  </span>
                )}
              </span>
              <StatusChip status={statusOf(mark)} label={markLabel(t, mark)} />
              {correctable && (
                <span className={styles.pencil} aria-hidden="true">
                  <Icon name="pencil" size={16} />
                </span>
              )}
            </>
          );
          return (
            <li key={student.id} className={styles.itemWrap}>
              {correctable ? (
                <Link href={routes.correct(key, student.id)} className={styles.item}>
                  {content}
                </Link>
              ) : (
                <div className={styles.item}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </ScreenLayout>
  );
}

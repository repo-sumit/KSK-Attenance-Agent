'use client';
import { useSearchParams } from 'next/navigation';
import { useMemo } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { InlineNote } from '@/components/ui/InlineNote';
import { Latin } from '@/components/ui/Latin';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { parseSessionKey } from '@/domain/attendance';
import { effectivePresent } from '@/domain/marking';
import { LEAVE_TYPES } from '@/domain/status';
import { useI18n } from '@/hooks/i18n';
import { useSession } from '@/hooks/session';
import { useVoiceFocus } from '@/hooks/voice';
import { addDays, toLocalDate } from '@/lib/time';
import { batchTitle, closingSoon, statusNames } from '../../common/labels';
import { latinText } from '../../common/LatinText';
import { useSessionLabel } from '../useSessionLabel';
import { RosterSummary, type RosterContext } from './RosterSummary';
import { StudentRow, type RowLabels } from './StudentRow';
import { useRoster } from './useRoster';
import styles from './Mark.module.css';
import { useAttendanceRoot } from '../useAttendanceRoot';

/** The screen instructors use every day (PRD §9): tap the exceptions, review, submit. */
export function MarkScreen() {
  const { t, format } = useI18n();
  const root = useAttendanceRoot();
  const ctx = useSession();
  const label = useSessionLabel();
  const key = useSearchParams().get('s') ?? '';
  const { roster, marks, counts, issues, attention, onStatus, onDetail, goToReview } = useRoster(key);
  const voiceFocus = useVoiceFocus(key);
  const m = ctx.journey.marking;

  const labels = useMemo<RowLabels>(() => {
    return {
      status: statusNames(t),
      // "Father: {name}" with the name alone set as Latin master data.
      father: (name) => latinText(t, 'roster.father', { name }, ['name']),
      presentFor: t('roster.presentFor'),
      firstHalf: t('status.firstHalf'),
      secondHalf: t('status.secondHalf'),
      leaveType: t('roster.leaveType'),
      leaveTypes: { sick: t('status.sick'), casual: t('status.casual'), medical: t('status.medical') },
      leaveUntil: t('roster.leaveUntil'),
      ojtNote: t('roster.ojtNote'),
      notMarked: t('status.not_marked'),
      needsHalf: t('roster.needsHalf'),
      needsLeaveType: t('roster.needsLeaveType'),
      statusFor: (name) => t('roster.statusFor', { name }),
      choose: t('roster.choose'),
      lockedReason: t('roster.lockedErp'),
    };
  }, [t]);

  if (!roster) {
    // The batch is known from the link: the header says which one from the first paint instead of "Loading…".
    const batch = ctx.data.batches.find((b) => b.id === parseSessionKey(key)?.batchId);
    const trade = ctx.data.trades.find((x) => x.id === batch?.tradeId);
    return (
      <ScreenLayout area={root.area} width="reading" header={<AppHeader back="back" title={trade ? <Latin>{trade.name}</Latin> : t('common.loading')} subtitle={batch ? batchTitle(t, batch) : undefined} backHref={root.href} />}>
        <Skeleton variant="rows" count={6} label={t('common.loading')} />
      </ScreenLayout>
    );
  }

  const card = roster.card;
  const name = label(card);
  const w = card.scheduled.window;
  const soon = closingSoon(card, ctx.clock.now());
  const daily = card.scheduled.slot.kind === 'daily';
  // Daily marks show the date and, under a time fence, when the window closes (a closed, unsubmitted batch can't be recovered).
  // Periods and halves show their slot and window; their closing time appears only when it is minutes away.
  const context: RosterContext = daily
    ? { label: name.meta, date: { long: format.longDate(card.address.date), short: format.shortDate(card.address.date) }, closesAt: w ? format.clockTime(card.address.date, w.end) : null, closingSoon: Boolean(soon) }
    : {
        label: name.meta,
        range: w ? t('session.windowRange', { start: format.clockTime(card.address.date, w.start), end: format.clockTime(card.address.date, w.end) }) : null,
        closesAt: soon ? format.clockTime(card.address.date, soon) : null,
        closingSoon: Boolean(soon),
      };
  const defaultStatus = m.defaultStatus === 'blank' ? null : m.defaultStatus;
  const hint = m.defaultStatus === 'present' ? t('roster.hintPresent') : m.defaultStatus === 'absent' ? t('roster.hintAbsent') : t('roster.hintBlank');
  const issue = issues[0];
  const blockMsg = !issue
    ? null
    : issue.kind === 'unmarked'
      ? t('roster.blockUnmarked', { count: issue.studentIds.length })
      : issue.kind === 'half'
        ? t('roster.blockHalf', { count: issue.studentIds.length })
        : t('roster.blockLeave', { count: issue.studentIds.length });
  const leaveRange = m.leaveDateRange ? { min: card.address.date, max: addDays(card.address.date, 30) } : null;
  const incomplete = new Set(issues.flatMap((i) => i.studentIds));

  return (
    <ScreenLayout
      area={root.area}
      width="reading"
      surface="raised"
      padding="none"
      footerLayout="row"
      header={<AppHeader back="back" title={<Latin>{card.trade.name}</Latin>} subtitle={batchTitle(t, card.batch)} backHref={root.href} />}
      top={
        <RosterSummary
          context={context}
          counts={counts}
          statuses={m.statuses}
          showNotMarked={m.defaultStatus === 'blank'}
          staleSince={roster.packStale && roster.packDownloadedAt ? format.dayMonth(toLocalDate(new Date(roster.packDownloadedAt))) : undefined}
        />
      }
      footer={
        <>
          {blockMsg && (
            <p className={styles.block} id="roster-block">
              <Icon name="alert" size={16} />
              {blockMsg}
            </p>
          )}
          <Button fullWidth inactive={Boolean(blockMsg)} onInactivePress={goToReview} onClick={goToReview} aria-describedby={blockMsg ? 'roster-block' : undefined}>
            {t('roster.reviewSubmit')}
          </Button>
        </>
      }
    >
      <InlineNote className={styles.hint}>{hint}</InlineNote>
      <ol className={styles.list} aria-label={name.title}>
        {roster.students.map((student) => (
          <StudentRow
            key={student.id}
            student={student}
            mark={marks[student.id] ?? { status: null }}
            selectable={m.selectable}
            defaultStatus={defaultStatus}
            halfDayHalves={m.halfDayHalves}
            leaveTypes={LEAVE_TYPES}
            leaveRange={leaveRange}
            attention={attention && incomplete.has(student.id)}
            current={voiceFocus?.studentId === student.id}
            focusSeq={voiceFocus?.studentId === student.id ? voiceFocus.seq : undefined}
            labels={labels}
            onStatus={onStatus}
            onDetail={onDetail}
          />
        ))}
      </ol>
      <p className="visually-hidden" aria-live="polite">
        {t('roster.totalsLive', { present: format.number(effectivePresent(counts)), absent: counts.absent, total: counts.total })}
      </p>
    </ScreenLayout>
  );
}

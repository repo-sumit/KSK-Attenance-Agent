'use client';
import { memo } from 'react';
import { PressableCard } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Icon } from '@/components/ui/icons/Icon';
import { Latin } from '@/components/ui/Latin';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useSyncStatus } from '@/hooks/useSync';
import { cx } from '@/lib/cx';
import { routes } from '@/lib/routes';
import type { SessionCard } from '@/services/attendance';
import { BatchLabel } from '../../common/BatchLabel';
import { batchTitle, sessionMeta, windowRange } from '../../common/labels';
import styles from './SessionCardView.module.css';

export type CardViewer = 'marker' | 'monitor';

interface SessionCardViewProps {
  readonly card: SessionCard;
  /** batch: prototype batch card · slot: one of several marks for a batch · period: timetable card. */
  readonly variant: 'batch' | 'slot' | 'period';
  /** marker: the user can mark · monitor: principal / trade overview. */
  readonly viewer: CardViewer;
  readonly twiceShape: 'halves' | 'signin_signout';
  readonly subjectName?: string;
}

export function hrefFor(card: SessionCard, viewer: CardViewer): string {
  if (card.status === 'submitted') return routes.record(card.key);
  if (card.canMark) return routes.open(card.key);
  return viewer === 'monitor' ? routes.record(card.key) : routes.open(card.key);
}

/** The card's one action: marking is open here, on this phone or online. */
function canMarkNow(card: SessionCard, online: boolean): boolean {
  return card.status === 'open' && card.canMark && (online || card.downloaded);
}

/** Where the card stands (prototype copy), with the kit StatusLine: icon + text + colour. */
function CardState({ card, viewer }: { readonly card: SessionCard; readonly viewer: CardViewer }) {
  const { t, format } = useI18n();
  const { online } = useSyncStatus();
  switch (card.status) {
    case 'submitted':
      return (
        <span className={styles.submitted}>
          {card.submission?.rejected ? (
            // This phone's copy lost to another submission and the server's copy cannot be read right now.
            <StatusLine tone="warning" icon="alert">
              {t('sync.rejected')}
            </StatusLine>
          ) : (
            <StatusLine tone="success" icon="circle-check" nowrap>
              {t('selection.submitted')}
            </StatusLine>
          )}
          <span className={styles.view}>
            {card.submission?.pendingSync ? t('selection.waitingToSync') : t('selection.submittedView', { time: format.time(card.submission?.at ?? '') })}
            <Icon name="chevron-right" size={16} />
          </span>
        </span>
      );
    case 'future':
      return card.scheduled.window ? (
        <StatusLine tone="neutral" icon="clock">
          {t('selection.opensAt', { time: format.clockTime(card.address.date, card.scheduled.window.start) })}
        </StatusLine>
      ) : null;
    case 'closed':
      return (
        <StatusLine tone={viewer === 'monitor' ? 'error' : 'neutral'} icon="lock">
          {viewer === 'monitor'
            ? t('selection.closedPrincipal')
            : card.scheduled.window
              ? t('selection.closedAt', { time: format.clockTime(card.address.date, card.scheduled.window.end) })
              : t('selection.closed')}
        </StatusLine>
      );
    case 'open':
      // Offline and not on this phone: say so here instead of letting the tap end on "not downloaded".
      if (card.canMark && !online && !card.downloaded)
        return (
          <StatusLine tone="warning" icon="wifi-off">
            {t('selection.needsInternet')}
          </StatusLine>
        );
      return card.canMark ? (
        <span className={styles.cta}>{t('selection.markAttendance')}</span>
      ) : (
        <StatusLine tone="warning" icon="circle">
          {t('selection.pending')}
        </StatusLine>
      );
  }
}

/**
 * A class on Home, the trade screen and the principal's board. One compact
 * anatomy: what (title, meta) on the left and where it stands (its action or
 * state) on the right. The state moves under the title only when the two no
 * longer fit side by side (narrow phones, large text, Marathi), decided by the
 * content rather than a breakpoint, so it never overlaps the title.
 */
export const SessionCardView = memo(function SessionCardView({ card, variant, viewer, twiceShape, subjectName }: SessionCardViewProps) {
  const { t, format } = useI18n();
  const { online } = useSyncStatus();
  const muted = card.status === 'future' || card.status === 'closed';
  const meta = sessionMeta(t, card, twiceShape, subjectName);
  const count = t('common.students', { count: card.studentCount });

  if (variant === 'batch') {
    const byLine = viewer === 'monitor' && card.submission ? t('selection.submittedBy', { count: card.studentCount, name: card.submission.byName }) : count;
    return (
      <PressableCard href={hrefFor(card, viewer)} className={styles.card}>
        <span className={styles.row}>
          <span className={styles.text}>
            <span className={cx(styles.title, muted && styles.muted)}>{batchTitle(t, card.batch)}</span>
            <span className={styles.meta}>
              {meta ? `${meta} · ` : ''}
              <Latin>{byLine}</Latin>
            </span>
          </span>
          <span className={styles.trail}>
            <CardState card={card} viewer={viewer} />
          </span>
        </span>
      </PressableCard>
    );
  }

  const range = windowRange(format, card);
  const current = card.status === 'open' && Boolean(card.scheduled.window);
  const highlighted = card.status === 'open' && card.canMark;
  // Under a batch header the slot is named by what it is (Morning, Period 2, the subject), never the batch again.
  const title = meta ?? <Latin>{card.trade.name}</Latin>;
  return (
    <PressableCard href={hrefFor(card, viewer)} highlighted={highlighted} className={styles.slot}>
      {(range || current) && (
        <span className={styles.timeRow}>
          {range && <span className={cx(styles.time, current && styles.timeNow)}>{range}</span>}
          {current && <Badge tone="brand">{t('selection.now')}</Badge>}
        </span>
      )}
      <span className={styles.text}>
        <span className={cx(styles.title, muted && styles.muted)}>
          {variant === 'period' ? (
            <BatchLabel trade={card.trade} batch={card.batch} />
          ) : (
            <>
              {/* Shown under its batch header; the batch is still part of the link's name for screen readers. */}
              <span className="visually-hidden">{`${batchTitle(t, card.batch)} · `}</span>
              {title}
            </>
          )}
        </span>
        {variant === 'period' ? (
          <span className={styles.meta}>{[meta, count].filter(Boolean).join(' · ')}</span>
        ) : (
          // The group header already gives the batch and its student count; a slot adds only who submitted it.
          viewer === 'monitor' && card.submission && <span className={styles.meta}><Latin>{card.submission.byName}</Latin></span>
        )}
      </span>
      {canMarkNow(card, online) ? <span className={cx(styles.cta, styles.ctaFull)}>{t('selection.markAttendance')}</span> : <CardState card={card} viewer={viewer} />}
    </PressableCard>
  );
});

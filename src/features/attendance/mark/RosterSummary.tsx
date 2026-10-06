'use client';
import { useMemo, type ReactNode } from 'react';
import { AttendanceSummary, SummaryDate, SummaryMeta } from '@/components/ui/AttendanceSummary';
import { Banner } from '@/components/ui/Banner';
import { Icon } from '@/components/ui/icons/Icon';
import { TopBand } from '@/components/shell/TopBand';
import type { MarkCounts } from '@/domain/marking';
import type { StatusCode } from '@/domain/status';
import { useI18n } from '@/hooks/i18n';
import { cx } from '@/lib/cx';
import { summaryLabels } from '../../common/labels';
import styles from './Mark.module.css';

export interface RosterContext {
  /** Slot, period or subject name, when the batch has more than one mark today. */
  readonly label?: string | null;
  /** Daily marks: the date, long where it fits and short on narrow phones. */
  readonly date?: { readonly long: string; readonly short: string };
  /** When marking closes ("2:00 PM"), or the slot's window for periods and halves. */
  readonly closesAt?: string | null;
  readonly range?: string | null;
  /** The window closes within minutes: the closing time turns into the warning, in place. */
  readonly closingSoon?: boolean;
}

interface RosterSummaryProps {
  readonly context: RosterContext;
  readonly counts: MarkCounts;
  readonly statuses: readonly StatusCode[];
  readonly showNotMarked?: boolean;
  readonly staleSince?: string;
}

/**
 * The band above the roster (always visible): when this mark is for and when
 * it closes, beside the running totals on wide screens and above them on
 * phones. Everything in it holds its place while the instructor marks, so the
 * list never jumps under a finger: the closing warning replaces the closing
 * time in the same line instead of adding a banner.
 */
export function RosterSummary({ context, counts, statuses, showNotMarked, staleSince }: RosterSummaryProps) {
  const { t, format } = useI18n();
  const labels = useMemo(() => summaryLabels(t, format), [t, format]);
  const parts: ReactNode[] = [];
  if (context.label) parts.push(<span key="label">{context.label}</span>);
  if (context.date) parts.push(<SummaryDate key="date" long={context.date.long} short={context.date.short} />);
  if (context.range) parts.push(<span key="range">{context.range}</span>);
  const closing = context.closesAt ? (
    // One stable live region: its words change when the window is about to close.
    <span key="closes" role="status" className={cx(styles.closes, context.closingSoon && styles.closingSoon)}>
      {context.closingSoon && <Icon name="alert" size={14} />}
      {t(context.closingSoon ? 'roster.closesSoon' : 'roster.closesAt', { time: context.closesAt })}
    </span>
  ) : null;
  return (
    <TopBand>
      <AttendanceSummary counts={counts} statuses={statuses} labels={labels} showNotMarked={showNotMarked} lead={<SummaryMeta icon="clock" parts={closing ? [...parts, closing] : parts} />} />
      {staleSince && (
        <Banner tone="warning" icon="alert">
          {t('roster.stale', { date: staleSince })}
        </Banner>
      )}
    </TopBand>
  );
}

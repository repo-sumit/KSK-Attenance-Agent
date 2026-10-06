import type { CSSProperties, ReactNode } from 'react';
import { contributesToPresent, effectivePresent, presentTerms, summaryStatuses, type MarkCounts, type PresentTerm } from '@/domain/marking';
import type { StatusCode } from '@/domain/status';
import { cx } from '@/lib/cx';
import { Icon, type IconName } from './icons/Icon';
import { statusIcon, statusTone } from './status-style';
import styles from './AttendanceSummary.module.css';

export interface AttendanceSummaryLabels {
  /** The whole group: "Students", "Staff". */
  readonly total: string;
  readonly status: Readonly<Record<StatusCode, string>>;
  readonly notMarked: string;
  /** Locale digits (Present can be fractional: 24.5). */
  readonly number: (n: number) => string;
  /**
   * The line under the tiles when other statuses count toward Present:
   * "Present 27 = 24 + 2 Half day × ½ + 2 OJT", or, before any do, the rule
   * ("Present counts Half day as ½, OJT as 1").
   */
  readonly breakdown: (parts: { readonly total: number; readonly terms: readonly PresentTerm[]; readonly statuses: readonly StatusCode[] }) => string;
}

export interface SummaryItem {
  readonly key: StatusCode | 'total' | 'not_marked';
  readonly value: number;
  readonly label: string;
  readonly tone: 'neutral' | 'success' | 'error' | 'warning' | 'info' | 'brand';
  readonly icon?: IconName;
}

/**
 * The summary's items, for the tiles and for anything that lists the same
 * numbers (the submit sheet, a one-line summary): the total, one item per
 * status configuration shows (registry order), and Not marked when asked.
 * Present is the effective value (D-069).
 */
export function summaryItems(counts: MarkCounts, statuses: readonly StatusCode[], labels: Pick<AttendanceSummaryLabels, 'total' | 'status' | 'notMarked'>, showNotMarked = false): SummaryItem[] {
  return [
    { key: 'total', value: counts.total, label: labels.total, tone: 'neutral' },
    ...summaryStatuses(statuses, counts).map((status) => ({
      key: status,
      value: status === 'present' ? effectivePresent(counts) : counts[status],
      label: labels.status[status],
      tone: statusTone(status),
      icon: statusIcon(status),
    })),
    ...(showNotMarked ? [{ key: 'not_marked' as const, value: counts.unmarked, label: labels.notMarked, tone: counts.unmarked ? ('warning' as const) : ('neutral' as const), icon: statusIcon('not_marked') }] : []),
  ];
}

/** Six-column grid spans for phones: rows of at most three, as even as possible (5 → 3 + 2, 7 → 3 + 2 + 2), never one tile alone on a row. */
function narrowSpans(n: number): number[] {
  const rows = Math.ceil(n / 3);
  const base = Math.floor(n / rows);
  const longer = n % rows;
  return Array.from({ length: rows }, (_, r) => (r < longer ? base + 1 : base)).flatMap((size) => Array.from({ length: size }, () => 6 / size));
}

interface AttendanceSummaryProps {
  readonly counts: MarkCounts;
  /** Statuses configuration enables, in any order (present and absent are always shown). */
  readonly statuses: readonly StatusCode[];
  readonly labels: AttendanceSummaryLabels;
  /** Blank-default marking and staff: a Not marked tile that counts down to 0. */
  readonly showNotMarked?: boolean;
  /**
   * Context beside the tiles on wide screens and above them on phones (the date and closing time, a record's status).
   * Every summary in a fixed band has one (D-069, D-159), so from 600px its tiles end in line with the rows' status
   * column.
   */
  readonly lead?: ReactNode;
  /** hero: tinted tiles on a white surface · raised: tinted tiles on the grey page. */
  readonly surface?: 'hero' | 'raised';
  readonly className?: string;
}

/**
 * The running totals of a roster, review, record or staff day (D-069): the
 * group total, then one tile per status configuration enables, so a state
 * with Present and Absent shows three tiles and one with every status shows
 * six. Present counts each status by its presence weight (half day ½, OJT 1)
 * and the line under the tiles shows the sum; every other tile is the raw
 * count. Tiles for configured statuses show even at 0, and the line keeps its
 * place, so the summary never changes height while someone is marking.
 */
export function AttendanceSummary({ counts, statuses, labels, showNotMarked = false, lead, surface = 'hero', className }: AttendanceSummaryProps) {
  const items = summaryItems(counts, statuses, labels, showNotMarked);
  const shown = summaryStatuses(statuses, counts);
  const note = contributesToPresent(shown) ? labels.breakdown({ total: effectivePresent(counts), terms: presentTerms(counts), statuses: shown }) : null;
  const spans = narrowSpans(items.length);
  return (
    <div className={cx(styles.summary, styles[surface], className)}>
      <div className={cx(styles.body, lead !== undefined && styles.withLead, items.length > 3 && styles.dense, items.length > 4 && styles.many, note && styles.hasNote)}>
        {lead !== undefined && <div className={styles.lead}>{lead}</div>}
        <div className={styles.tiles} style={{ '--summary-count': items.length } as CSSProperties}>
          {items.map((item, i) => (
            <div key={item.key} className={cx(styles.tile, styles[item.tone])} style={{ '--summary-span': spans[i] } as CSSProperties} data-summary-item={item.key}>
              <span className={cx(styles.value, 'tnum')}>{labels.number(item.value)}</span>
              <span className={styles.label}>
                {/* The dashed Not marked ring keeps the rows' stroke, so it reads as the same ring (never a solid "O"). */}
                {item.icon && <Icon name={item.icon} size={12} strokeWidth={item.key === 'not_marked' ? 2 : 3} />}
                <span>{item.label}</span>
              </span>
            </div>
          ))}
        </div>
        {note && <p className={styles.note}>{note}</p>}
      </div>
    </div>
  );
}

/**
 * The quiet line a summary's lead shows (the roster's date and closing time, the staff day): an icon, then short parts
 * that never split, each but the last followed by "·", so a line that wraps never starts with the dot.
 */
export function SummaryMeta({ icon, parts }: { readonly icon: IconName; readonly parts: readonly ReactNode[] }) {
  return (
    <p className={styles.meta}>
      <Icon name={icon} size={14} />
      {parts.map((part, i) => (
        <span key={i} className={styles.metaPart}>
          {part}
        </span>
      ))}
    </p>
  );
}

/** A date for SummaryMeta: "Monday, 28 September" while the lead is 340px or wider, "Mon, 28 Sep" below that. */
export function SummaryDate({ long, short }: { readonly long: string; readonly short: string }) {
  return (
    <span>
      <span className={styles.long}>{long}</span>
      <span className={styles.short}>{short}</span>
    </span>
  );
}

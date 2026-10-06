import { Card } from '@/components/ui/Card';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useI18n } from '@/hooks/i18n';
import { cx } from '@/lib/cx';
import type { MonthStat } from '@/services/reports';
import styles from './ReportSummaryCard.module.css';

export interface SummaryFigure {
  readonly value: string;
  /** Several parts go one per line ("417 students", "17 batches"): no separator left dangling at a wrap. */
  readonly label: string | readonly string[];
}

export interface SummaryFact {
  readonly icon: IconName;
  /** `warning`: the whole line is amber (icon + text + colour), for something still to do ("5 staff not marked today"). */
  readonly tone: 'success' | 'error' | 'info' | 'warning' | 'muted';
  readonly text: string;
}

interface ReportSummaryCardProps {
  /** Headline figures, equal in weight (My attendance: one; the institute: institute and staff). */
  readonly figures: readonly SummaryFigure[];
  /** Short icon lines beside the figure ("Present: 24 days"). */
  readonly facts?: readonly SummaryFact[];
  readonly trend?: readonly MonthStat[];
  /** Shown in place of the headline when there is nothing to count yet (the trend still shows). */
  readonly empty?: string;
}

/**
 * The headline card of My attendance, Institute attendance and Staff attendance (RPT-6). Phones:
 * figures and facts, the trend underneath. From a 560px card: the headline on
 * the left and the trend on the right, split by a divider, so the card has no
 * empty half and the trend bars stay short enough to read against their month.
 * A figure with facts is always two columns, the facts beside the figure, so the
 * layout never depends on how long a fact is in a language (U11).
 */
export function ReportSummaryCard({ figures, facts, trend, empty }: ReportSummaryCardProps) {
  const hasTrend = !!trend && trend.length > 1;
  return (
    <Card className={styles.card}>
      <div className={cx(styles.layout, hasTrend && styles.withTrend)}>
        <div className={cx(styles.head, figures.length > 1 ? styles.pair : figures.length === 1 && !!facts?.length && styles.withFacts)}>
          {empty && <p className={styles.empty}>{empty}</p>}
          {figures.map((figure, i) => (
            <span key={i} className={styles.figure}>
              <span className={styles.value}>{figure.value}</span>
              {typeof figure.label === 'string' ? (
                <span className={styles.label}>{figure.label}</span>
              ) : (
                figure.label.map((part) => (
                  <span key={part} className={styles.label}>
                    {part}
                  </span>
                ))
              )}
            </span>
          ))}
          {facts && facts.length > 0 && (
            <span className={styles.facts}>
              {facts.map((fact) => (
                <span key={fact.text} className={cx(styles.fact, fact.tone === 'warning' && styles.warning)}>
                  <Icon name={fact.icon} size={20} className={styles[fact.tone]} />
                  {fact.text}
                </span>
              ))}
            </span>
          )}
        </div>
        {hasTrend && <Trend months={trend} />}
      </div>
    </Card>
  );
}

/** A simple trend: one row per month; the words carry the numbers, the bars are decoration. */
function Trend({ months }: { readonly months: readonly MonthStat[] }) {
  const { t, format } = useI18n();
  return (
    <div className={styles.trend}>
      <p className={styles.trendTitle}>{t('reports.trend', { count: months.length })}</p>
      <ul className={styles.trendList}>
        {months.map((m, i) => {
          const now = i === months.length - 1;
          return (
            <li key={m.month} className={cx(styles.trendRow, now && styles.trendNow)}>
              <span className={styles.trendMonth}>{format.monthShort(m.month)}</span>
              <ProgressBar value={(m.pct ?? 0) / 100} tone={now ? 'brand' : 'info'} decorative />
              <span className={styles.trendPct}>{m.pct === null ? t('reports.noValue') : format.percent(m.pct)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

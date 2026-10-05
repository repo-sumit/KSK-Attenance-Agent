'use client';
import { Icon } from '@/components/ui/icons/Icon';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useSession } from '@/hooks/session';
import { cx } from '@/lib/cx';
import { toLocalDate } from '@/lib/time';
import type { PackRow } from '@/services/packs';
import { BatchLabel } from '../common/BatchLabel';
import { batchWithTrade } from '../common/labels';
import { useBatchRefresh, type RefreshState } from './useBatchRefresh';
import styles from './Offline.module.css';

interface OfflineBatchRowProps {
  readonly row: PackRow;
  /** "Refresh all data" in progress or just done: every row says so. */
  readonly all: RefreshState;
  readonly canRefresh: boolean;
}

/**
 * One downloaded batch (brief §5) in two lines (RPT-5): its name, then its
 * state (ready offline / refresh needed / waiting to sync / not saved) beside when it was
 * updated (the time today, the date on an earlier day), and its own refresh.
 */
export function OfflineBatchRow({ row, all, canRefresh }: OfflineBatchRowProps) {
  const { t, format } = useI18n();
  const ctx = useSession();
  const { state: own, refresh } = useBatchRefresh(row.batch.id);
  // A refresh-all in progress wins; afterwards the row keeps whichever says "just now".
  const state: RefreshState = all === 'refreshing' ? 'refreshing' : own !== 'idle' ? own : all;
  const label = batchWithTrade(t, row.trade, row.batch);
  const day = toLocalDate(new Date(row.pack.downloadedAt));
  const updated =
    state === 'refreshing'
      ? t('batchData.refreshing')
      : state === 'done'
        ? t('batchData.justNow')
        : day === toLocalDate(ctx.clock.now())
          ? t('offline.updatedToday', { time: format.time(row.pack.downloadedAt) })
          : t('offline.updatedOn', { date: format.dayMonth(day) });
  const stale = row.stale && state === 'idle';
  const status = row.pendingSync
    ? { tone: 'warning' as const, icon: 'cloud-upload' as const, text: t('offline.waitingRow', { count: row.pendingSync }) }
    : row.rejected
      ? { tone: 'warning' as const, icon: 'alert' as const, text: t('sync.rejected') }
      : stale
        ? { tone: 'warning' as const, icon: 'alert' as const, text: t('offline.refreshNeeded') }
        : { tone: 'success' as const, icon: 'circle-check' as const, text: t('offline.ready') };

  return (
    <li className={cx(styles.pack, stale && styles.packStale)}>
      <span className={styles.packText}>
        <span className={styles.packTitle}>
          <BatchLabel trade={row.trade} batch={row.batch} />
        </span>
        <span className={styles.packMeta}>
          <StatusLine tone={status.tone} icon={status.icon}>
            {status.text}
          </StatusLine>
          {/* Its own refresh is announced here; a refresh-all is announced once, by its toast. */}
          <span role="status" aria-live={own === 'idle' && all !== 'idle' ? 'off' : undefined}>
            <span key={state} className={styles.settle}>
              {updated}
            </span>
          </span>
        </span>
      </span>
      {canRefresh && (
        // Not IconButton: the kit's has no brand tone or busy state yet (the icon spins while refreshing).
        <button type="button" className={styles.packRefresh} onClick={() => void refresh()} aria-disabled={state === 'refreshing' || undefined} aria-label={t('batchData.refreshFor', { batch: label })}>
          <Icon name="refresh" size={20} className={state === 'refreshing' ? styles.spin : undefined} />
        </button>
      )}
    </li>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { parseSessionKey } from '@/domain/attendance';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { useSyncStatus } from '@/hooks/useSync';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import { BatchLabel } from '../common/BatchLabel';
import { OfflineBatchRow } from './OfflineBatchRow';
import { SyncPendingCard } from './SyncPendingCard';
import { JUST_NOW_MS, type RefreshState } from './useBatchRefresh';
import styles from './Offline.module.css';

/**
 * Offline data = "what is on this phone, and is it synced?" (PRD §20, D-056):
 * sync first (the Sync pending card listing what is waiting, or a calm "All
 * attendance synced"), each with the end-of-day rule, then each downloaded
 * batch with its own refresh, and one action group under the list: Refresh
 * all data, and Download more batches while any are left (D-065, RPT-3/4).
 * Reached from Reports.
 */
export function OfflineScreen() {
  const { t, format } = useI18n();
  const toast = useToast();
  const ctx = useSession();
  const { packs, sync } = useServices();
  const status = useSyncStatus();
  const router = useRouter();
  const j = ctx.journey.offline;
  // No offline data for this user (e.g. the principal): an old link goes to Reports or Home.
  const fallback = ctx.journey.navTabs.includes('reports') ? routes.reports : routes.home;
  useEffect(() => {
    if (!j.enabled) router.replace(fallback);
  }, [j.enabled, fallback, router]);
  const { data: rows } = useQuery(`packs:${ctx.user.id}`, () => (j.enabled ? packs.list(ctx) : Promise.resolve([])), ['packs', 'offline']);
  const { data: pending } = useQuery(`pending:${ctx.user.id}`, () => sync.pendingItems(), ['offline']);
  const [all, setAll] = useState<RefreshState>('idle');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const today = toLocalDate(ctx.clock.now());

  const when = (iso: string) => (toLocalDate(new Date(iso)) === today ? t('offline.todayAt', { time: format.time(iso) }) : `${format.dayMonth(toLocalDate(new Date(iso)))}, ${format.time(iso)}`);
  const pendingLabel = (label: string, kind: string): ReactNode => {
    if (kind === 'staff_attendance') return t('offline.selfRecord');
    const address = parseSessionKey(label);
    const batch = ctx.data.batches.find((b) => b.id === address?.batchId);
    const trade = batch && ctx.data.trades.find((x) => x.id === batch.tradeId);
    return batch && trade ? <BatchLabel trade={trade} batch={batch} /> : label;
  };

  const refreshAll = async () => {
    if (all === 'refreshing') return;
    clearTimeout(timer.current);
    setAll('refreshing');
    const result = await packs.refreshAll(ctx);
    setAll(result.ok ? 'done' : 'idle');
    if (result.ok) timer.current = setTimeout(() => setAll('idle'), JUST_NOW_MS);
    toast.show(result.ok ? t('offline.refreshed') : t('offline.connectFirst'));
  };
  // What needs the instructor comes first: waiting to sync (or not saved), then refresh needed, then the rest in order.
  const rank = (r: NonNullable<typeof rows>[number]) => (r.pendingSync || r.rejected ? 0 : r.stale ? 1 : 2);
  const ordered = rows ? [...rows].sort((a, b) => rank(a) - rank(b)) : undefined;
  // The card owns "waiting / syncing / synced just now"; with nothing waiting, one calm line says so.
  const synced = !status.pending && status.phase !== 'syncing' && status.phase !== 'synced';
  const eod = t('offline.eodNote', { time: format.clockTime(today, ctx.config.offline.eodTriggerTime) });
  // Offer more only while a batch the user can mark is not on the phone and the limit allows it.
  const held = new Set(rows?.map((r) => r.batch.id));
  const more = !!rows && packs.downloadable(ctx).some((b) => !held.has(b.id)) && (j.maxBatches === null || rows.length < j.maxBatches);
  if (!j.enabled) return null;

  return (
    <ScreenLayout width="reading" area="reports" banner="offline" header={<AppHeader back="back" title={t('offline.title')} backHref={routes.reports} />}>
      <SyncPendingCard items={pending?.map((item) => ({ id: item.id, label: pendingLabel(item.label, item.kind), when: when(item.enqueuedAt) }))} note={eod} />
      {synced && (
        // A calm confirmation, not the loudest thing on the screen; the rule it answers to sits inside it.
        <Banner tone="success" icon="circle-check" live>
          <span className={styles.syncedText}>
            <span>{t('offline.allSynced')}</span>
            <span className={styles.syncedNote}>{eod}</span>
          </span>
        </Banner>
      )}
      <Section id="packs" variant="label" title={t('offline.downloaded')}>
        {!ordered ? (
          <Skeleton variant="rows" count={2} label={t('common.loading')} />
        ) : ordered.length === 0 ? (
          <EmptyState
            icon="hard-drive"
            title={t('offline.noPacks')}
            action={
              <Button size="md" leadingIcon="download" href={routes.offlineDownload}>
                {t('offline.downloadTitle')}
              </Button>
            }
          />
        ) : (
          <Card divided className={styles.packCard}>
            <ul className={styles.packs}>
              {ordered.map((row) => (
                <OfflineBatchRow key={row.batch.id} row={row} all={all} canRefresh={j.manualRefresh} />
              ))}
            </ul>
            {/* One action group under the list: refresh everything (outlined), add batches (text) while any are left. */}
            {(j.manualRefresh || more) && (
              <div className={styles.actions}>
                {j.manualRefresh && (
                  <Button variant="secondary" size="md" leadingIcon="refresh" loading={all === 'refreshing'} onClick={() => void refreshAll()}>
                    {all === 'refreshing' ? t('offline.refreshingAll') : t('offline.refreshAll')}
                  </Button>
                )}
                {more && (
                  <Button variant="ghost" size="md" leadingIcon="download" href={routes.offlineDownload}>
                    {t('offline.downloadMore')}
                  </Button>
                )}
              </div>
            )}
          </Card>
        )}
      </Section>
    </ScreenLayout>
  );
}

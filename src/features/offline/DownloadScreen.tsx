'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Icon } from '@/components/ui/icons/Icon';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import type { Batch } from '@/domain/entities';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { cx } from '@/lib/cx';
import { routes } from '@/lib/routes';
import { batchTitle } from '../common/labels';
import { TradeGroups } from '../common/TradeGroups';
import styles from './Download.module.css';

/**
 * Choose batches to keep on the phone; only batches the user can mark online
 * are offered (PRD §20.2). A batch already on the phone is a plain row that
 * says so, not a ticked box (RPT-3); with nothing left to add, the screen says
 * so and leads back.
 */
export function DownloadScreen() {
  const { t } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ctx = useSession();
  const { packs } = useServices();
  const { data: held } = useQuery(`packs:${ctx.user.id}`, () => packs.list(ctx), ['packs']);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const have = new Set((held ?? []).map((r) => r.batch.id));
  const batches = packs.downloadable(ctx);
  const multi = ctx.journey.offline.multiSelect;
  const enabled = ctx.journey.offline.packs;
  // No packs for this user (D-153): back to Offline data while offline is on, else to Reports or Home.
  const fallback = ctx.journey.offline.enabled ? routes.offline : ctx.journey.navTabs.includes('reports') ? routes.reports : routes.home;
  useEffect(() => {
    if (!enabled) router.replace(fallback);
  }, [enabled, fallback, router]);
  const max = ctx.journey.offline.maxBatches;
  const full = max !== null && have.size >= max;
  const left = batches.some((b) => !have.has(b.id));

  const toggle = (id: string) =>
    setChosen((prev) => {
      const next = new Set(multi ? prev : []);
      if (prev.has(id)) next.delete(id);
      else if (max === null || have.size + next.size < max) next.add(id);
      else toast.show(t('offline.maxReached', { max }));
      return next;
    });

  const download = async () => {
    if (busy) return;
    setBusy(true);
    const result = await packs.download(ctx, [...chosen]);
    setBusy(false);
    toast.show(result.ok ? t('offline.downloadedToast', { count: result.value }) : result.error === 'offline' ? t('offline.connectFirst') : t('offline.maxReached', { max: max ?? 0 }));
    if (result.ok) router.replace(routes.offline);
  };

  const row = (batch: Batch) => {
    if (have.has(batch.id))
      return (
        <li key={batch.id} className={styles.row}>
          {/* The success mark stands where the box would be; the words beside it stay quiet, so five held rows are not five green lines. */}
          <Icon name="circle-check" size={24} className={styles.held} />
          <span className={styles.label}>{batchTitle(t, batch)}</span>
          <span className={styles.heldNote}>{t('offline.ready')}</span>
        </li>
      );
    const on = chosen.has(batch.id);
    return (
      <li key={batch.id}>
        <button type="button" role="checkbox" aria-checked={on} className={cx(styles.row, styles.choice, on && styles.on)} onClick={() => toggle(batch.id)}>
          <span className={cx(styles.box, on && styles.boxOn)} aria-hidden="true">
            {on && <Icon name="check" size={16} strokeWidth={3} />}
          </span>
          <span className={styles.label}>{batchTitle(t, batch)}</span>
        </button>
      </li>
    );
  };

  if (!enabled) return null;
  const trades = ctx.access.tradeIds.flatMap((id) => ctx.data.trades.filter((tr) => tr.id === id));
  return (
    <ScreenLayout
      width="reading"
      area="reports"
      header={<AppHeader back="back" title={t('offline.downloadTitle')} backHref={routes.offline} />}
      footer={
        chosen.size > 0 ? (
          <Button fullWidth leadingIcon="download" loading={busy} onClick={() => void download()}>
            {busy ? t('offline.downloading') : t('offline.downloadCta', { count: chosen.size })}
          </Button>
        ) : undefined
      }
    >
      {!held ? (
        <Skeleton variant="rows" leading="none" count={3} label={t('common.loading')} />
      ) : !left || full ? (
        <EmptyState
          icon={left ? 'hard-drive' : 'circle-check'}
          title={left ? t('offline.maxReached', { max: max ?? 0 }) : t('offline.allOnPhone')}
          action={
            <Button variant="secondary" size="md" leadingIcon="arrow-left" href={routes.offline}>
              {t('offline.backToOffline')}
            </Button>
          }
        />
      ) : (
        <TradeGroups trades={trades} items={batches} tradeId={(b) => b.tradeId} idPrefix="dl" as="ul" level={2}>
          {row}
        </TradeGroups>
      )}
    </ScreenLayout>
  );
}

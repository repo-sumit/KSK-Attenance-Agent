'use client';
import { useSearchParams } from 'next/navigation';
import { Latin } from '@/components/ui/Latin';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { toLocalDate } from '@/lib/time';
import { ProblemScreen } from '../feedback/ProblemScreen';
import { SessionList } from './SessionList';
import { useAttendanceRoot } from './useAttendanceRoot';

/** Batches of one trade: pick a batch (open / trade mapping) or monitor it (principal, group instructor). */
export function TradeScreen() {
  const { t, format } = useI18n();
  const root = useAttendanceRoot();
  const ctx = useSession();
  const { attendance } = useServices();
  const tradeId = useSearchParams().get('trade') ?? '';
  const trade = ctx.data.trades.find((x) => x.id === tradeId);
  const monitoring = ctx.journey.homeVariant === 'institute' || (ctx.access.tradeWideViewTradeId === tradeId && !ctx.access.tradeIds.includes(tradeId));
  const visible = trade && (ctx.access.tradeIds.includes(trade.id) || ctx.access.tradeWideViewTradeId === trade.id);
  const { data } = useQuery(`trade:${tradeId}`, () => (visible ? attendance.boardForTrade(ctx, tradeId) : Promise.resolve([])), ['attendance', 'offline', 'corrections', 'staff']);

  if (!trade || !visible) return <ProblemScreen kind="notFound" header={<AppHeader plain />} area={root.area} />;
  const overview = ctx.access.tradeWideViewTradeId === tradeId;
  return (
    <ScreenLayout
      area={root.area}
      header={
        <AppHeader back="back"
          title={<Latin>{trade.name}</Latin>}
          subtitle={monitoring || overview ? t('common.todayDate', { date: format.longDate(toLocalDate(ctx.clock.now())) }) : t('selection.selectBatch')}
          backHref={root.href}
        />
      }
    >
      {data ? <SessionList cards={data} viewer={monitoring || overview ? 'monitor' : 'marker'} /> : <Skeleton label={t('common.loading')} />}
    </ScreenLayout>
  );
}

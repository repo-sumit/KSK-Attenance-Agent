'use client';
import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { Latin } from '@/components/ui/Latin';
import { Section } from '@/components/ui/Section';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import type { UiEvent } from '@/services/voice/action-bus';
import { PeriodList, SessionList, TradeRows } from './SessionList';
import { useBoard } from './useBoard';
import styles from './AttendanceBoard.module.css';

/** Voice showed Home: a trade it chose before that is not replayed over the board Home mounts (the F7 replay's bound). */
const homeShown = (e: UiEvent) => e.type === 'navigate' && e.href.split('?')[0] === routes.home;

/** The instructor/principal "which class?" block; the same component serves Home and the Attendance tab. */
export function AttendanceBoard({ showGroupTitles = true }: { readonly showGroupTitles?: boolean }) {
  const { t, format } = useI18n();
  const ctx = useSession();
  const toast = useToast();
  const board = useBoard();
  const { voice } = useServices();
  const [tradeId, setTradeId] = useState<string | null>(null);
  // Voice Agent chose a trade (trade switcher): the same local state a tap on the switch sets. Voice pushes Home and
  // shows the trade in one tick, before this board mounts, so a show_trade no board has seen yet is replayed (F7),
  // unless voice showed Home again after it.
  useVoiceBusEvent('show_trade', (e) => setTradeId(e.tradeId), { replayMissed: true, replayBound: homeShown });
  // A tapped trade is where voice looks for a batch next (the executor's trade case): the switcher has no route to sync.
  const chooseTrade = (id: string) => {
    setTradeId(id);
    voice.current()?.onScreen({ kind: 'trade', tradeId: id });
  };

  if (!board.data) return <Skeleton label={t('common.loading')} />;
  const data = board.data;

  switch (data.kind) {
    case 'trades':
      return (
        <TradeRows
          label={t('selection.trades')}
          trades={data.trades.map((tr) => {
            const p = tr.progress;
            if (!p) return { id: tr.id, name: tr.name, meta: t('selection.tradeBatches', { count: tr.batches }) };
            const today = toLocalDate(ctx.clock.now());
            const opens = p.nextOpen ? format.clockTime(today, p.nextOpen) : null;
            const missing = p.total - p.done - p.later;
            // The same denominator as Home's "4 of 17" (every trade session today), then the one thing to know next.
            return {
              id: tr.id,
              name: tr.name,
              meta: t('selection.tradeSubmitted', { ...p, count: p.total }),
              state:
                p.total > 0 && p.done === p.total ? (
                  <StatusLine tone="success" icon="circle-check" nowrap>
                    {t('principal.tradeAllSubmitted')}
                  </StatusLine>
                ) : missing > 0 ? (
                  <StatusLine tone="warning" icon="alert" nowrap>
                    {t('principal.tradeNotSubmitted', { count: missing })}
                  </StatusLine>
                ) : opens ? (
                  <StatusLine tone="neutral" icon="clock" nowrap>
                    {t('selection.opensAt', { time: opens })}
                  </StatusLine>
                ) : undefined,
            };
          })}
        />
      );
    case 'periods':
      return <PeriodList cards={data.cards} />;
    case 'switcher': {
      const active = data.groups.find((g) => g.trade.id === tradeId) ?? data.groups[0];
      if (!active) return null;
      return (
        <>
          <Segmented
            label={t('selection.trades')}
            fullWidth
            value={active.trade.id}
            onChange={chooseTrade}
            options={data.groups.map((g) => ({ value: g.trade.id, label: g.trade.name, lang: 'en' }))}
          />
          <SessionList cards={active.cards} viewer="marker" />
        </>
      );
    }
    case 'groups':
      if (!data.groups.length)
        return (
          <EmptyState
            icon="users"
            title={t('selection.emptyTitle')}
            body={t('selection.emptyBody')}
            action={
              <Button variant="secondary" size="md" onClick={() => toast.show(t('selection.noNewBatches'))}>
                {t('common.refresh')}
              </Button>
            }
          />
        );
      if (data.groups.length === 1 && !showGroupTitles) return <SessionList cards={data.groups[0].cards} viewer="marker" />;
      // One grid for every trade: a trade with a single batch takes one column, a bigger one the full width,
      // so batches across several trades (Employability Skills) don't all stack in the left column.
      return (
        <div className={styles.groups}>
          <div className={styles.groupGrid}>
            {data.groups.map((group) => (
              <Section key={group.trade.id} variant="label" title={<Latin>{group.trade.name}</Latin>} className={group.cards.length > 1 ? styles.span : undefined}>
                <SessionList cards={group.cards} viewer="marker" />
              </Section>
            ))}
          </div>
        </div>
      );
  }
}

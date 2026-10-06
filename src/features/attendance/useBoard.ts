'use client';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import type { LocalTime } from '@/lib/time';
import type { BatchGroup, SessionCard } from '@/services/attendance';
import { sessionProgress } from '@/services/session-progress';

// 'staff': own attendance first (D-152) frees the rows the moment the user's own attendance is marked.
const TOPICS = ['attendance', 'corrections', 'offline', 'packs', 'staff'] as const;

export interface TradeSummary {
  readonly id: string;
  readonly name: string;
  readonly batches: number;
  /**
   * Institute view: sessions submitted of all today's sessions (the principal Home's
   * denominator, sessionProgress), and how many open later and when.
   */
  readonly progress?: { readonly done: number; readonly total: number; readonly later: number; readonly nextOpen?: LocalTime };
}

export type Board =
  | { readonly kind: 'trades'; readonly trades: readonly TradeSummary[] }
  | { readonly kind: 'groups'; readonly groups: readonly BatchGroup[] }
  | { readonly kind: 'periods'; readonly cards: readonly SessionCard[] }
  | { readonly kind: 'switcher'; readonly groups: readonly BatchGroup[] };

/** Loads what the Attendance tab shows, driven only by the journey's selection mode. */
export function useBoard() {
  const ctx = useSession();
  const { attendance } = useServices();
  return useQuery<Board>(
    `board:${ctx.user.id}:${ctx.journey.selection}`,
    async () => {
      switch (ctx.journey.selection) {
        case 'timetable':
          return { kind: 'periods', cards: await attendance.timetableBoard(ctx) };
        case 'batch_list':
          return { kind: 'groups', groups: await attendance.myBoard(ctx) };
        case 'trade_switcher':
          return { kind: 'switcher', groups: await attendance.myBoard(ctx) };
        case 'trade_picker':
          return {
            kind: 'trades',
            trades: ctx.access.tradeIds.map((id) => {
              const trade = ctx.data.trades.find((x) => x.id === id);
              return { id, name: trade?.name ?? id, batches: ctx.data.batches.filter((b) => b.tradeId === id).length };
            }),
          };
        case 'institute': {
          const trades = await Promise.all(
            ctx.access.tradeIds.map(async (id) => {
              const p = sessionProgress(await attendance.boardForTrade(ctx, id));
              const trade = ctx.data.trades.find((x) => x.id === id);
              return { id, name: trade?.name ?? id, batches: p.total, progress: { done: p.submitted, total: p.total, later: p.later, nextOpen: p.nextOpen } };
            }),
          );
          return { kind: 'trades', trades };
        }
      }
    },
    TOPICS,
  );
}

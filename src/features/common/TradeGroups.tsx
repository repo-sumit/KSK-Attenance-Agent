import type { ReactNode } from 'react';
import { Card } from '@/components/ui/Card';
import { Latin } from '@/components/ui/Latin';
import { Section } from '@/components/ui/Section';
import type { Trade } from '@/domain/entities';

interface TradeGroupsProps<T> {
  /** Trades in board order; a trade with no items is left out. */
  readonly trades: readonly Trade[];
  readonly items: readonly T[];
  readonly tradeId: (item: T) => string;
  /** One keyed row per item: a direct child of the trade's list card (an li when `as` is ul). */
  readonly children: (item: T) => ReactNode;
  /** Makes each group's heading id unique on the page. */
  readonly idPrefix: string;
  readonly as?: 'div' | 'ul';
  /** 3 under a page section (Reports' batches); 2 when the trades are the page's own sections (Download). */
  readonly level?: 2 | 3;
  /** An optional control on each group's label line, given that trade and its items in this list. */
  readonly action?: (trade: Trade, items: readonly T[]) => ReactNode;
}

/**
 * Items grouped under their trade, one way everywhere (RPT-8): the trade name
 * as a group label (an h3 under the page section, or an h2 when it is the
 * page's top level) and one divided list card per trade. Reports' batches and
 * the Download screen use it.
 */
export function TradeGroups<T>({ trades, items, tradeId, children, idPrefix, as = 'div', level = 3, action }: TradeGroupsProps<T>) {
  return trades.map((trade) => {
    const mine = items.filter((item) => tradeId(item) === trade.id);
    if (!mine.length) return null;
    return (
      <Section key={trade.id} id={`${idPrefix}-${trade.id}`} level={level} variant="label" title={<Latin>{trade.name}</Latin>} action={action?.(trade, mine)}>
        <Card divided as={as}>
          {mine.map(children)}
        </Card>
      </Section>
    );
  });
}

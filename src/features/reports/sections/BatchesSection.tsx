'use client';
import { useEffect, useRef, useState } from 'react';
import { Disclosure } from '@/components/ui/Disclosure';
import { EmptyState } from '@/components/ui/EmptyState';
import { Latin } from '@/components/ui/Latin';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useJourney, useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import type { LocalDate } from '@/lib/time';
import type { SessionContext } from '@/services/context';
import type { BatchOverview } from '@/services/reports';
import { batchTitle, batchWithTrade } from '../../common/labels';
import { TradeGroups } from '../../common/TradeGroups';
import { RegisterDownloadButton, RegisterDownloadSheet, type RegisterTarget } from '../register/RegisterDownloadSheet';
import { Leaderboard } from './Leaderboard';
import { PctBadge } from './PctBadge';
import styles from '../Reports.module.css';

const TOPICS = ['attendance', 'corrections'] as const;

/** Voice's requests reach a Reports screen that mounts after the navigation that opened it (D-085); a later navigation makes them stale. */
const REPLAY = { replayMissed: true, replayBound: (e: { readonly type: string }) => e.type === 'navigate' } as const;

interface RegisterRequest {
  readonly batchIds: readonly string[];
  readonly tradeId: string | null;
  readonly month: LocalDate;
  /** The bus event's sequence: the sheet is keyed by it, so each request remounts it on its own month. */
  readonly seq: number;
}

type T = ReturnType<typeof useI18n>['t'];

/** The accessible name of the button that opens the same register by tap (the batch row's icon, the trade's button). */
function openerName(t: T, target: RegisterTarget): string {
  return target.scope.kind === 'trade' ? t('reports.register.tradeButtonName', { trade: target.scope.tradeName }) : t('reports.register.downloadFor', { name: target.subject });
}

/** Focus after voice's sheet closed: the matching register button, or the section heading when it is not shown. */
function restoreFocus(section: HTMLElement | null, name: string): void {
  if (!section) return;
  const button = [...section.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name);
  if (button) return button.focus({ preventScroll: true });
  // The heading is focusable from script by its own props (Section focusableHeading).
  section.querySelector<HTMLElement>('h2')?.focus({ preventScroll: true });
}

/** The sheet's target for voice's request, named as the row and trade buttons name theirs; null for an unknown id. */
function requestTarget(t: T, data: SessionContext['data'], request: RegisterRequest): RegisterTarget | null {
  if (request.tradeId !== null) {
    const trade = data.trades.find((x) => x.id === request.tradeId);
    return trade ? { batchIds: request.batchIds, subject: trade.name, scope: { kind: 'trade', tradeName: trade.name } } : null;
  }
  const batch = data.batches.find((b) => b.id === request.batchIds[0]);
  const trade = batch && data.trades.find((x) => x.id === batch.tradeId);
  return batch && trade ? { batchIds: [batch.id], subject: batchWithTrade(t, trade, batch), scope: { kind: 'batch' } } : null;
}

/**
 * "My batches" / every batch (brief §7): the average over the report window,
 * grouped under the trade as on Home; a tap opens the batch's students. Voice
 * (D-140) opens a batch's row and scrolls it into view (`show_batch_report`) and
 * opens the register sheet on a batch or trade and month (`open_register`); the
 * download itself still needs the trainer's tap.
 */
export function BatchesSection({ title }: { readonly title: string }) {
  const { t } = useI18n();
  const ctx = useSession();
  const j = useJourney();
  const { reports } = useServices();
  const { data } = useQuery(`report-batches:${ctx.user.id}`, () => reports.batchOverview(ctx), TOPICS);
  const [reveal, setReveal] = useState<{ readonly batchId: string; readonly seq: number } | null>(null);
  const [register, setRegister] = useState<RegisterRequest | null>(null);
  const section = useRef<HTMLElement>(null);
  /** Where focus goes once voice's sheet has left the page (no button opened it, so none takes focus back by itself). */
  const returnTo = useRef<string | null>(null);
  useEffect(() => {
    if (register || !returnTo.current) return;
    restoreFocus(section.current, returnTo.current);
    returnTo.current = null;
  }, [register]);
  useVoiceBusEvent('show_batch_report', (e) => setReveal({ batchId: e.batchId, seq: e.seq }), REPLAY);
  /** The newest request's sequence: only its sheet hands focus back (an older one closes because it was replaced). */
  const latest = useRef(0);
  useVoiceBusEvent(
    'open_register',
    (e) => {
      latest.current = e.seq;
      setRegister({ batchIds: e.batchIds, tradeId: e.tradeId, month: e.month, seq: e.seq });
    },
    REPLAY,
  );
  const registerTarget = register && j.reports.pdfDownload ? requestTarget(t, ctx.data, register) : null;

  return (
    <Section ref={section} id="batches" focusableHeading title={title} subtitle={t('reports.batchesSub', { days: j.reports.windowDays })}>
      {!data ? (
        <Skeleton variant="rows" leading="none" count={2} label={t('common.loading')} />
      ) : !data.batches.length ? (
        <EmptyState icon="users" title={t('reports.noStudentData')} />
      ) : (
        <TradeGroups
          trades={ctx.data.trades}
          items={data.batches}
          tradeId={(b) => b.trade.id}
          idPrefix="batches"
          action={
            j.reports.pdfDownload
              ? (trade, items) => (
                  <RegisterDownloadButton target={{ batchIds: items.map((b) => b.batch.id), subject: trade.name, scope: { kind: 'trade', tradeName: trade.name } }} />
                )
              : undefined
          }
        >
          {(item) => <BatchRow key={item.batch.id} item={item} threshold={data.threshold} reveal={reveal?.batchId === item.batch.id ? reveal.seq : 0} />}
        </TradeGroups>
      )}
      {registerTarget && register && (
        <RegisterDownloadSheet
          key={register.seq}
          target={registerTarget}
          initialMonth={register.month}
          // A sheet replaced by a newer request (its download still finishing) closes only itself.
          onClose={() => {
            if (register.seq === latest.current) returnTo.current = openerName(t, registerTarget);
            setRegister((r) => (r?.seq === register.seq ? null : r));
          }}
        />
      )}
    </Section>
  );
}

/** `reveal`: the sequence of voice's latest request to show this batch (0: none); each new one opens and scrolls to it. */
function BatchRow({ item, threshold, reveal }: { readonly item: BatchOverview; readonly threshold: number; readonly reveal: number }) {
  const { t } = useI18n();
  const j = useJourney();
  const subject = batchWithTrade(t, item.trade, item.batch);
  const [open, setOpen] = useState(false);
  const [revealed, setRevealed] = useState(0);
  if (reveal && reveal !== revealed) {
    // Adjusting state while rendering: voice's new request opens the row in this same render.
    setRevealed(reveal);
    setOpen(true);
  }
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!reveal) return;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    row.current?.scrollIntoView?.({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  }, [reveal]);
  const hide = () => {
    setOpen(false);
    // Back to the row that was opened, not wherever the long list ended; focus goes with it
    // (the Hide button it was on is gone), so a keyboard or screen reader user lands on the batch.
    row.current?.querySelector('button')?.focus({ preventScroll: true });
    row.current?.scrollIntoView({ block: 'nearest' });
  };
  return (
    <div ref={row}>
      <Disclosure
        open={open}
        onOpenChange={setOpen}
        // One tap from the collapsed list (owner follow-up to D-137); the expanded list still ends with its own button.
        action={j.reports.pdfDownload ? <RegisterDownloadButton appearance="icon" target={{ batchIds: [item.batch.id], subject, scope: { kind: 'batch' } }} /> : undefined}
        summary={
          <>
            <span className={styles.rowText}>
              <span className={styles.rowTitle}>
                {/* Shown under its trade; the trade is still part of the name a screen reader hears. */}
                <span className="visually-hidden">
                  <Latin>{item.trade.name}</Latin>
                  {' · '}
                </span>
                {batchTitle(t, item.batch)}
              </span>
              <span className={styles.rowSub}>{t('common.students', { count: item.students })}</span>
            </span>
            <PctBadge pct={item.pct} low={item.low} threshold={threshold} />
          </>
        }
      >
        <Leaderboard batchId={item.batch.id} subject={subject} expected={item.students} onHide={hide} />
      </Disclosure>
    </div>
  );
}

'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { summaryItems } from '@/components/ui/AttendanceSummary';
import { Button } from '@/components/ui/Button';
import { Card, PressableCard } from '@/components/ui/Card';
import { EmptyNote } from '@/components/ui/EmptyState';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { IconTile } from '@/components/ui/IconWell';
import { List, ListRow } from '@/components/ui/ListRow';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { routes } from '@/lib/routes';
import { dayPart, toLocalDate, type Clock } from '@/lib/time';
import { sessionProgress } from '@/services/session-progress';
import { BatchLabel } from '../common/BatchLabel';
import { firstName, greetingKey, markLabel, summaryLabels, summaryLine } from '../common/labels';
import { LatinText, slotted } from '../common/LatinText';
import { RoleLine } from '../common/RoleLine';
import { userRole } from './roleLine';
import type { MyStaffRecord } from './useMyStaffRecord';
import styles from './Home.module.css';

/**
 * "Good afternoon, Rajesh": the real time of day (`ctx.wallClock`, D-151), refreshed when the day part changes while
 * Home is open. The trainer's name is Latin master data inside the translated sentence; a `salutation` (the
 * principal's "Principal", D-034) is translated text. Under it, one subtitle for everyone (D-159): today's date and
 * the user's role ("Monday, 5 October · Instructor · Electrician", "… · Principal"); the header names the institute.
 */
export function Greeting({ salutation }: { readonly salutation?: string }) {
  const { t, format } = useI18n();
  const ctx = useSession();
  useDayPartTick(ctx.wallClock);
  const key = greetingKey(ctx.wallClock.now());
  const date = format.longDate(toLocalDate(ctx.clock.now()));
  return (
    <div className={styles.greeting}>
      <h2 className={styles.hello}>{salutation === undefined ? <LatinText k={key} params={{ name: firstName(ctx.user) }} latin={['name']} /> : t(key, { name: salutation })}</h2>
      <p className={styles.sub}>{slotted(t, 'common.dateRole', { date, role: <RoleLine {...userRole(t, ctx)} /> })}</p>
    </div>
  );
}

/** Re-renders the caller when the wall clock's day part changes (checked once a minute; the greeting's only tick). */
function useDayPartTick(wallClock: Clock): void {
  const [, setPart] = useState(() => dayPart(wallClock.now()));
  useEffect(() => {
    const timer = setInterval(() => setPart(dayPart(wallClock.now())), 60_000);
    return () => clearInterval(timer);
  }, [wallClock]);
}

/**
 * The user's own attendance today. While own attendance first blocks the classes (D-152) it is Home's first step: one
 * line says why and its action is the primary one. One layout for both actions (D-159): md, full width under the text
 * on phones, beside the text from a 520px card (as the Sync pending card).
 */
export function MyAttendanceCard({ mine }: { readonly mine: MyStaffRecord }) {
  const { t, format } = useI18n();
  const ctx = useSession();
  const { record, selfFirst } = mine;
  // Hold the card's space while loading so the page doesn't jump when it arrives.
  if (!mine.loaded) return <Skeleton count={1} height={120} label={t('common.loading')} />;
  const action = selfFirst ? (
    <Button size="md" fullWidth href={routes.selfAttendance}>
      {t('selfFirst.action')}
    </Button>
  ) : (
    !record &&
    ctx.journey.staff.selfCanMark && (
      <Button variant="secondary" size="md" fullWidth href={routes.selfAttendance}>
        {t('home.markAttendance')}
      </Button>
    )
  );
  return (
    <Card className={styles.actionCard}>
      <div className={styles.cardBody}>
        <div className={styles.cardRow}>
          <IconTile icon="user-check" tint="green" />
          <div className={styles.cardText}>
            <p className={styles.cardTitle}>{t('home.myAttendance')}</p>
            {/* A state is always icon + text + colour; marked by the principal is a plain fact beside the status chip. */}
            {!record ? (
              <StatusLine tone="warning" icon="circle">
                {t('home.notMarked')}
              </StatusLine>
            ) : record.source === 'self' ? (
              <StatusLine tone="success" icon="circle-check">
                {t('home.markedToday', { time: format.time(record.deviceTimestamp) })}
              </StatusLine>
            ) : (
              <p className={styles.cardSub}>{t('home.markedByPrincipal', { status: markLabel(t, { status: record.status }).toLowerCase() })}</p>
            )}
            {selfFirst && <p className={styles.cardSub}>{t('home.selfFirst')}</p>}
          </div>
          {record && <StatusChip status={record.status} label={markLabel(t, { status: record.status })} />}
        </div>
        {action && <div className={styles.cardAction}>{action}</div>}
      </div>
    </Card>
  );
}

interface ProgressCardProps {
  readonly title: ReactNode;
  readonly tint: 'blue' | 'green';
  readonly icon: IconName;
  readonly done: number;
  readonly total: number;
  /** "batches submitted" / "staff marked", shown after "4 of 17". */
  readonly unit: string;
  readonly note?: string;
  readonly href: string;
}

/**
 * One anatomy for an "x of y" card (D-159): tile, title and chevron; the count as a figure with its unit; the bar; an
 * optional note. The principal's Students and Staff cards and the instructor's trade overview (the same fact, D-077).
 */
export function ProgressCard({ title, tint, icon, done, unit, total, note, href }: ProgressCardProps) {
  const { t } = useI18n();
  const count = t('principal.countOf', { done, total });
  return (
    <PressableCard href={href}>
      <span className={styles.progressTop}>
        <IconTile icon={icon} tint={tint} />
        <span className={styles.progressTitle}>{title}</span>
        <Icon name="chevron-right" size={20} className={styles.chevron} />
      </span>
      <span className={styles.count}>
        <span className={`${styles.big} tnum`}>{count}</span>
        <span className={styles.unit}>{unit}</span>
      </span>
      <ProgressBar value={total ? done / total : 0} label={`${count} ${unit}`} />
      {note && <span className={styles.note}>{note}</span>}
    </PressableCard>
  );
}

/** Two cards side by side once the column has 640px (the one two-up rule, D-159); one column below; a lone card takes the row. */
export function CardPair({ children }: { readonly children: ReactNode }) {
  return (
    <div className={styles.pairWrap}>
      <div className={styles.pair}>{children}</div>
    </div>
  );
}

export function TradeOverviewCard() {
  const { t } = useI18n();
  const ctx = useSession();
  const { attendance } = useServices();
  const tradeId = ctx.access.tradeWideViewTradeId;
  const { data } = useQuery(`trade-overview:${tradeId}`, async () => (tradeId ? attendance.boardForTrade(ctx, tradeId) : []), ['attendance']);
  const trade = ctx.data.trades.find((x) => x.id === tradeId);
  if (!trade || !data) return null;
  // One counter for every "x of y submitted" (principal Home, the Attendance tab, this card).
  const { submitted, total } = sessionProgress(data);
  return (
    <ProgressCard
      title={<LatinText k="home.tradeOverview" params={{ trade: trade.name }} latin={['trade']} />}
      tint="blue"
      icon="users"
      done={submitted}
      total={total}
      unit={t('principal.sessionsSubmitted', { count: total })}
      href={routes.trade(trade.id)}
    />
  );
}

/**
 * What this user submitted today, newest first, with the counts that went in
 * (Present as the summary counts it, D-069). A full-width section of its own
 * under the cards, never half a row beside one.
 */
export function SubmittedToday() {
  const { t, format } = useI18n();
  const ctx = useSession();
  const { attendance } = useServices();
  const { data, loading } = useQuery(`submitted-today:${ctx.user.id}`, () => attendance.submittedTodayBy(ctx, ctx.user.id), ['attendance', 'offline']);
  const labels = summaryLabels(t, format);
  return (
    <Section id="recent" title={t('home.submittedToday')}>
      {!data && loading ? (
        <Skeleton count={1} height={64} label={t('common.loading')} />
      ) : !data?.length ? (
        <EmptyNote>{t('home.nothingYet')}</EmptyNote>
      ) : (
        <List grid label={t('home.submittedToday')}>
          {data.map((card) => {
            const s = card.submission;
            const counts = s ? summaryLine(t, format, summaryItems(s.counts, ctx.journey.marking.statuses, labels)) : '';
            const when = s?.rejected ? t('sync.rejected') : s?.pendingSync ? t('selection.waitingToSync') : t('home.submittedAt', { time: format.time(s?.at ?? '') });
            const warn = s?.rejected || s?.pendingSync;
            return (
              <ListRow
                key={card.key}
                href={routes.record(card.key)}
                leading={<Icon name={s?.rejected ? 'alert' : s?.pendingSync ? 'cloud-upload' : 'circle-check'} size={20} className={warn ? styles.iconWarning : styles.iconSuccess} />}
                title={<BatchLabel trade={card.trade} batch={card.batch} />}
                subtitle={
                  <>
                    {/* The refused line is a sentence: it wraps instead of being clipped on a narrow phone. */}
                    <span className={s?.rejected ? undefined : styles.phrase}>{when}</span>
                    {' · '}
                    <span className={styles.phrase}>{counts}</span>
                  </>
                }
                trailing="chevron"
              />
            );
          })}
        </List>
      )}
    </Section>
  );
}

'use client';
import { summaryItems } from '@/components/ui/AttendanceSummary';
import { Button } from '@/components/ui/Button';
import { Card, PressableCard } from '@/components/ui/Card';
import { Icon } from '@/components/ui/icons/Icon';
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
import { sessionProgress } from '@/services/session-progress';
import { BatchLabel } from '../common/BatchLabel';
import { firstName, greetingKey, markLabel, summaryLabels, summaryLine } from '../common/labels';
import styles from './Home.module.css';

export function Greeting({ subtitle, name }: { readonly subtitle: string; readonly name?: string }) {
  const { t } = useI18n();
  const ctx = useSession();
  return (
    <div className={styles.greeting}>
      <h2 className={styles.hello}>{t(greetingKey(ctx.clock.now()), { name: name ?? firstName(ctx.user) })}</h2>
      <p className={styles.sub}>{subtitle}</p>
    </div>
  );
}

export function MyAttendanceCard() {
  const { t, format } = useI18n();
  const ctx = useSession();
  const { staffAttendance } = useServices();
  const { data: record, loading } = useQuery(`my-staff:${ctx.user.id}`, () => staffAttendance.myRecord(ctx), ['staff']);
  // Hold the card's space while loading so the page doesn't jump when it arrives.
  if (loading && !record) return <Skeleton count={1} height={120} label={t('common.loading')} />;
  const marked = Boolean(record);
  const bySelf = record?.source === 'self';
  const sub = !record
    ? t('home.notMarked')
    : bySelf
      ? t('home.markedToday', { time: format.time(record.deviceTimestamp) })
      : t('home.markedByPrincipal', { status: markLabel(t, { status: record.status }).toLowerCase() });
  return (
    <Card>
      <div className={styles.cardRow}>
        <IconTile icon="user-check" tint="green" />
        <div className={styles.cardText}>
          <p className={styles.cardTitle}>{t('home.myAttendance')}</p>
          {marked ? (
            <p className={bySelf ? styles.subSuccess : styles.cardSub}>{sub}</p>
          ) : (
            <StatusLine tone="warning" icon="circle">
              {sub}
            </StatusLine>
          )}
        </div>
        {record && <StatusChip status={record.status} label={markLabel(t, { status: record.status })} />}
      </div>
      {!marked && ctx.journey.staff.selfCanMark && (
        <Button variant="secondary" size="md" fullWidth href={routes.selfAttendance}>
          {t('home.markAttendance')}
        </Button>
      )}
    </Card>
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
  const { submitted: done, total } = sessionProgress(data);
  return (
    <PressableCard href={routes.trade(trade.id)}>
      <div className={styles.cardRow}>
        <IconTile icon="users" tint="blue" />
        <div className={styles.cardText}>
          <p className={styles.cardTitle}>{t('home.tradeOverview', { trade: trade.name })}</p>
          <p className={styles.cardSub}>{t('selection.tradeSubmitted', { done, total, count: total })}</p>
        </div>
        <Icon name="chevron-right" size={20} className={styles.chevron} />
      </div>
      <ProgressBar value={total ? done / total : 0} label={t('selection.tradeSubmitted', { done, total, count: total })} />
    </PressableCard>
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
        <Card>
          <p className={styles.empty}>{t('home.nothingYet')}</p>
        </Card>
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

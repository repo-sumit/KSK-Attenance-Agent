'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { Latin } from '@/components/ui/Latin';
import { List, ListRow } from '@/components/ui/ListRow';
import { Section } from '@/components/ui/Section';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { useI18n } from '@/hooks/i18n';
import { useSession } from '@/hooks/session';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import { sessionProgress } from '@/services/session-progress';
import { AnnouncementBanner } from '../announcements/AnnouncementBanner';
import { BatchLabel } from '../common/BatchLabel';
import { slotted } from '../common/LatinText';
import { SyncPendingCard } from '../offline/SyncPendingCard';
import { CardPair, Greeting, ProgressCard } from './parts';
import { usePrincipalOverview } from './usePrincipalOverview';
import styles from './PrincipalHome.module.css';

/**
 * One rule for both attention rows: the first two names, then "and N more".
 * Each name stays on one line and keeps its own script (Latin master data).
 */
function ShortList({ names }: { readonly names: readonly { readonly key: string; readonly label: ReactNode }[] }) {
  const { t } = useI18n();
  const shown = names.slice(0, 2).map((n, i) => (
    <span key={n.key}>
      {i > 0 && ', '}
      <span className={styles.nowrap}>{n.label}</span>
    </span>
  ));
  if (names.length <= 2) return <>{shown}</>;
  // The names stay elements inside the translated "… and N more".
  return <>{slotted(t, 'principal.andMore', { list: shown, count: names.length - 2 })}</>;
}

/** Institute overview: how much is submitted, what needs attention, and the two things a principal does. */
export function PrincipalHome() {
  const { t, format } = useI18n();
  const ctx = useSession();
  const today = toLocalDate(ctx.clock.now());
  const { data } = usePrincipalOverview();

  const sessions = data?.sessions ?? [];
  // The same count as the Attendance tab's trade rows: submitted of all today's sessions, and the later ones.
  const progress = sessionProgress(sessions);
  const laterNote = !progress.later || !progress.nextOpen
    ? undefined
    : progress.laterShift
      ? t('principal.shiftNote', { count: progress.later, shift: progress.laterShift, time: format.clockTime(today, progress.nextOpen) })
      : t('principal.laterNote', { count: progress.later, time: format.clockTime(today, progress.nextOpen) });
  const missing = sessions.filter((c) => c.status === 'open' || c.status === 'closed');
  const staff = data?.staff ?? [];
  const staffMarked = staff.filter((r) => r.record).length;
  const staffMissing = staff.filter((r) => !r.record);

  return (
    // Staff marks saved offline wait here too; the card owns sync on Home (D-064).
    <ScreenLayout header={<AppHeader />} area="home" bottomNav banner="offline">
      <Greeting salutation={t('principal.salutation')} />
      <SyncPendingCard />
      <AnnouncementBanner />
      <Section id="today" title={t('home.todays')}>
        {!data ? (
          <Skeleton count={2} height={140} label={t('common.loading')} />
        ) : (
          <CardPair>
            <ProgressCard
              title={t('principal.studentCard')}
              tint="blue"
              icon="clipboard-check"
              done={progress.submitted}
              total={progress.total}
              unit={t('principal.sessionsSubmitted', { count: progress.total })}
              note={laterNote}
              href={routes.attendance}
            />
            {ctx.journey.staff.principalStaffView && (
              <ProgressCard
                title={t('principal.staffCard')}
                tint="green"
                icon="user-check"
                done={staffMarked}
                total={staff.length}
                unit={t('principal.staffMarked')}
                href={routes.staff}
              />
            )}
          </CardPair>
        )}
      </Section>
      {data && (missing.length > 0 || staffMissing.length > 0) && (
        <Section id="attention" title={t('principal.needsAttention')}>
          <List>
            {missing.length > 0 && (
              <ListRow
                href={routes.attendance}
                leading={<Icon name="alert" size={20} className={styles.warn} />}
                title={t('principal.notSubmitted', { count: missing.length })}
                subtitle={<ShortList names={missing.map((c) => ({ key: c.key, label: <BatchLabel trade={c.trade} batch={c.batch} /> }))} />}
                trailing="chevron"
                minHeight={56}
              />
            )}
            {staffMissing.length > 0 && (
              <ListRow
                href={routes.staff}
                leading={<Icon name="alert" size={20} className={styles.warn} />}
                title={t('principal.staffNotMarked', { count: staffMissing.length })}
                subtitle={<ShortList names={staffMissing.map((r) => ({ key: r.member.id, label: <Latin>{r.member.name}</Latin> }))} />}
                trailing="chevron"
                minHeight={56}
              />
            )}
          </List>
        </Section>
      )}
      <div className={styles.actions}>
        <Button fullWidth href={routes.attendance}>
          {t('principal.viewStudents')}
        </Button>
        {ctx.journey.staff.principalCanMark && (
          <Button variant="secondary" fullWidth href={routes.staff}>
            {t('principal.markStaff')}
          </Button>
        )}
      </div>
    </ScreenLayout>
  );
}

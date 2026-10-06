'use client';
import { Section } from '@/components/ui/Section';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { useI18n } from '@/hooks/i18n';
import { useSession } from '@/hooks/session';
import { AnnouncementBanner } from '../announcements/AnnouncementBanner';
import { AttendanceBoard } from '../attendance/AttendanceBoard';
import { SyncPendingCard } from '../offline/SyncPendingCard';
import { CardPair, Greeting, MyAttendanceCard, SubmittedToday, TradeOverviewCard } from './parts';
import { useMyStaffRecord } from './useMyStaffRecord';

/**
 * Instructor home = "what do I need to do today?" (D-052): anything waiting
 * to sync, notices, today's classes (shape set by the mapping model), my
 * attendance, submitted today.
 * Past attendance lives in Reports.
 */
export function InstructorHome() {
  const { t } = useI18n();
  const ctx = useSession();
  const j = ctx.journey;
  const subject = ctx.data.subjects.find((s) => s.id === ctx.access.subjectId);
  const mine = useMyStaffRecord();
  // Own attendance first (D-152): until it is marked, My attendance is the first thing on Home. While the rule applies
  // and the record is still loading, its placeholder holds that slot, so an unmarked trainer's card never jumps up.
  const selfFirst = j.staff.selfCard && (mine.selfFirst || (j.staff.selfFirst && !mine.loaded));

  const access = (() => {
    switch (j.selection) {
      case 'trade_picker':
        // Open mapping: any trade, then a batch. The trades are right here, one tap from marking.
        return (
          <Section id="today" title={t('home.todays')} subtitle={t('home.chooseTrade')}>
            <AttendanceBoard groupLevel={3} />
          </Section>
        );
      case 'timetable':
        return (
          <Section id="today" title={t('home.timetable')}>
            <AttendanceBoard groupLevel={3} />
          </Section>
        );
      default:
        return (
          <Section
            id="today"
            title={t('home.yourBatches')}
            subtitle={subject ? t('home.subjectSub', { subject: subject.name, count: ctx.access.batchIds.size, trades: ctx.access.tradeIds.length }) : undefined}
          >
            <AttendanceBoard groupLevel={3} />
          </Section>
        );
    }
  })();

  return (
    // The Sync pending card owns sync on Home; the bar under the header only says "offline" (D-064).
    <ScreenLayout header={<AppHeader />} area="home" bottomNav banner="offline">
      <Greeting />
      {selfFirst && <MyAttendanceCard mine={mine} />}
      {/* Work waiting on this phone comes before notices. */}
      <SyncPendingCard />
      <AnnouncementBanner />
      {access}
      {/* Wide screens: the two cards side by side (one column on phones); a lone card takes the whole row. */}
      {(j.tradeWideView || (j.staff.selfCard && !selfFirst)) && (
        <CardPair>
          {j.tradeWideView && <TradeOverviewCard />}
          {j.staff.selfCard && !selfFirst && <MyAttendanceCard mine={mine} />}
        </CardPair>
      )}
      <SubmittedToday />
    </ScreenLayout>
  );
}

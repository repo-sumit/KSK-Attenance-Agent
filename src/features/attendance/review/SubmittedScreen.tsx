'use client';
import { useSearchParams } from 'next/navigation';
import { summaryItems } from '@/components/ui/AttendanceSummary';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { Latin } from '@/components/ui/Latin';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { useSyncStatus } from '@/hooks/useSync';
import { routes } from '@/lib/routes';
import { ResultScreen } from '../../feedback/ResultScreen';
import { summaryLabels, summaryLine } from '../../common/labels';
import { useSessionLabel } from '../useSessionLabel';
import { AppHeader } from '@/features/shell/AppHeader';
import { useAttendanceRoot } from '../useAttendanceRoot';

/**
 * Submitted — or "saved on this phone" when it cannot be sent right now
 * (offline, failed, or waiting). While a send is in flight it reads as
 * submitted, as in the prototype; the sync banner shows the send itself.
 */
export function SubmittedScreen() {
  const { t, format } = useI18n();
  const root = useAttendanceRoot();
  const ctx = useSession();
  const { attendance } = useServices();
  const label = useSessionLabel();
  const sync = useSyncStatus();
  const key = useSearchParams().get('s') ?? '';
  const { data: card } = useQuery(`submitted:${key}`, () => attendance.findCard(ctx, key), ['attendance', 'offline']);

  if (!card?.submission) return <ScreenLayout card><Skeleton label={t('common.loading')} /></ScreenLayout>;
  const s = card.submission;
  // The same numbers as the review summary: Present as it counts (D-069), then every status that has marks.
  const summary = summaryLine(t, format, summaryItems(s.counts, ctx.journey.marking.statuses, summaryLabels(t, format)));
  const name = label(card);
  const saved = s.pendingSync && sync.phase !== 'syncing';
  // Sent, but someone else had submitted this session first: never "Submitted".
  const refused = s.rejected;
  return (
    <ResultScreen
      tone={saved || refused ? 'warning' : 'success'}
      icon={refused ? 'alert' : saved ? 'cloud-upload' : 'circle-check'}
      title={refused ? t('sync.rejected') : saved ? t('result.savedTitle') : t('result.submittedTitle')}
      sub={summary}
      meta={
        <>
          <Latin>{name.title}</Latin> · {format.time(s.at)}
        </>
      }
      note={saved ? t(sync.online ? 'result.savedNoteLater' : 'result.savedNote') : undefined}
      primary={{ label: t('common.done'), href: routes.home }}
      header={<AppHeader plain />}
      area={root.area}
    />
  );
}

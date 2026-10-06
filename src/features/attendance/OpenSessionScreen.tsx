'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { routes } from '@/lib/routes';
import type { OpenRosterError, SessionCard } from '@/services/attendance';
import { ProblemScreen } from '../feedback/ProblemScreen';
import { VerificationFlow } from '../verification/VerificationFlow';
import { SessionName, useSessionLabel } from './useSessionLabel';
import { useAttendanceRoot } from './useAttendanceRoot';

type Gate = { readonly kind: 'ready' | OpenRosterError; readonly card?: SessionCard };

/**
 * Gateway to a roster (PRD §8, §11, §20): sync pending records first, then
 * refuse closed/not-yet-open/undownloaded sessions with the reason, enrol a face
 * if needed, verify, and only then replace itself with the student list.
 */
export function OpenSessionScreen() {
  const { t, format } = useI18n();
  const root = useAttendanceRoot();
  const router = useRouter();
  const ctx = useSession();
  const { attendance, sync, verification } = useServices();
  const label = useSessionLabel();
  const key = useSearchParams().get('s') ?? '';

  const { data: gate } = useQuery<Gate>(
    `open:${key}`,
    async () => {
      const status = sync.status();
      if (ctx.config.offline.syncOnOpen && status.online && status.pending > 0) void sync.syncNow('auto');
      const opened = await attendance.openRoster(ctx, key);
      const card = await attendance.findCard(ctx, key);
      return opened.ok ? { kind: 'ready', card } : { kind: opened.error, card };
    },
    [],
  );

  const enrolFirst = gate?.kind === 'not_verified' && ctx.journey.faceEnrolmentRequired;
  useEffect(() => {
    if (!gate) return;
    if (gate.kind === 'ready') router.replace(routes.mark(key));
    else if (gate.kind === 'already_submitted') router.replace(routes.record(key));
    else if (enrolFirst) {
      // Voice Agent tells the person why the screen changed: their face has to be registered before the check.
      verification.notify({ kind: 'session', key }, 'face_enrolment');
      router.replace(routes.face(routes.open(key)));
    }
  }, [gate, enrolFirst, key, router, verification]);

  const back = () => router.back();
  if (!gate || gate.kind === 'ready' || gate.kind === 'already_submitted' || enrolFirst) {
    return (
      <ScreenLayout area={root.area} width="form" header={<AppHeader title={t('verify.title')} back="close" onBack={back} />}>
        <Skeleton count={1} height={200} label={t('common.loading')} />
      </ScreenLayout>
    );
  }

  const card = gate.card;
  const name = card ? label(card) : undefined;
  const session = name ? [name.title, name.meta].filter(Boolean).join(' · ') : '';
  const goBack = { label: t('common.goBack'), onPress: back };
  // Signed in: every problem keeps the app header (avatar top right), its own heading below it.
  const signedIn = { header: <AppHeader plain />, area: root.area };

  switch (gate.kind) {
    case 'not_verified':
      return (
        <VerificationFlow
          purpose={{ kind: 'session', key }}
          area={root.area}
          subtitle={card ? <SessionName card={card} /> : undefined}
          passedSubtitle={t('verify.openingList')}
          onPassed={() => router.replace(routes.mark(key))}
          onExit={back}
        />
      );
    case 'window_not_open':
      return (
        <ProblemScreen
          kind="notOpen"
          params={{ session, time: card?.scheduled.window ? format.clockTime(card.address.date, card.scheduled.window.start) : '' }}
          primary={goBack}
          {...signedIn}
        />
      );
    case 'window_closed':
      return <ProblemScreen kind="closed" params={{ session }} primary={goBack} {...signedIn} />;
    case 'not_downloaded':
      return <ProblemScreen kind="noPack" params={{ session }} primary={goBack} {...signedIn} />;
    case 'needs_connection':
      return <ProblemScreen kind="noConnection" params={{ session }} primary={goBack} {...signedIn} />;
    case 'no_access':
      return <ProblemScreen kind="noAccess" primary={goBack} {...signedIn} />;
    case 'self_first':
      // Own attendance first (D-152): the class opens after the trainer's own attendance is marked today.
      // It names the class the user tapped, as every other gateway problem does (U16).
      return <ProblemScreen kind="selfFirst" params={{ session }} primary={{ label: t('selfFirst.action'), href: routes.selfAttendance }} secondary={goBack} {...signedIn} />;
    default:
      return <ProblemScreen kind="notFound" {...signedIn} />;
  }
}

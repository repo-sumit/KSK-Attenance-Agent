'use client';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/Button';
import { Latin } from '@/components/ui/Latin';
import { useToast } from '@/components/ui/Toast';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import { FaceCheck } from '../face/FaceCheck';
import { PermissionPrimer } from '../feedback/PermissionPrimer';
import { DistanceChip, ProblemScreen } from '../feedback/ProblemScreen';
import { useVerification } from './useVerification';
import type { NavTab } from '@/config/journey';
import { purposeKey, type VerificationPurpose } from '@/services/verification';
import { VerifyRun } from './VerifyRun';

interface VerificationFlowProps {
  readonly purpose: VerificationPurpose;
  /** The app area the flow runs in (marked current in the header navigation). */
  readonly area: NavTab;
  /** Header subtitle: the session being opened, or "My attendance". */
  readonly subtitle: ReactNode;
  readonly passedSubtitle: string;
  readonly onPassed: () => void;
  readonly onExit: () => void;
}

/** Renders the verification state machine: primers, the run screen, and each failure with its one remedy. */
export function VerificationFlow({ purpose, area, subtitle, passedSubtitle, onPassed, onExit }: VerificationFlowProps) {
  const { t, format } = useI18n();
  const toast = useToast();
  const ctx = useSession();
  const { faceCapture, faceMatch } = useServices();
  const flow = useVerification(purpose, onPassed);
  const { phase } = flow;
  // Voice Agent's "check again": the same retry as this screen's own button, only where the screen offers one.
  useVoiceBusEvent('verify_retry', (e) => {
    if (purposeKey(purpose) === e.purpose && phase.kind === 'problem' && phase.retry !== 'none') flow.retry();
  });
  const j = ctx.journey.verification;
  const help = { label: t('common.needHelp'), onPress: () => toast.show(t(ctx.journey.homeVariant === 'institute' ? 'common.helpToastPrincipal' : 'common.helpToast')) };
  const header = <AppHeader title={t('verify.title')} subtitle={subtitle} back="close" onBack={onExit} />;

  if (phase.kind === 'primer')
    return <PermissionPrimer kind={phase.permission} onAllow={phase.permission === 'location' ? flow.allowLocation : flow.allowCamera} onNotNow={onExit} header={header} area={area} />;

  if (phase.kind === 'problem') {
    switch (phase.problem) {
      case 'outside':
        return (
          <ProblemScreen
            kind="outside"
            params={{ distance: format.distance(phase.distanceM ?? 0) }}
            chip={<DistanceChip>{t('problem.distanceChip', { distance: format.distance(phase.distanceM ?? 0), institute: ctx.institute.shortName })}</DistanceChip>}
            primary={{ label: t('problem.checkAgain'), onPress: flow.retry }}
            secondary={help}
            header={header}
            area={area}
          />
        );
      case 'locationDenied':
        return <ProblemScreen kind="locationDenied" primary={{ label: t('permission.allowLocation'), onPress: flow.allowLocation }} secondary={{ label: t('common.goBack'), onPress: onExit }} header={header} area={area} />;
      case 'cameraDeniedVerify':
        // After a block the browser won't ask again by itself: the person changes the setting, then tries again.
        return <ProblemScreen kind="cameraDeniedVerify" primary={{ label: t('common.tryAgain'), onPress: flow.allowCamera }} secondary={{ label: t('common.goBack'), onPress: onExit }} header={header} area={area} />;
      case 'faceLimit':
        return <ProblemScreen kind="faceLimit" primary={{ label: t('common.goBack'), onPress: onExit }} header={header} area={area} />;
      default:
        return <ProblemScreen kind={phase.problem} primary={{ label: t('common.tryAgain'), onPress: flow.retry }} secondary={help} header={header} area={area} />;
    }
  }

  if (phase.kind === 'confirm')
    return (
      <ScreenLayout surface="default" banner={false} header={header} area={area} padding="none" width="form" inlineFooter footer={<Button fullWidth onClick={flow.confirmLocation}>{t('common.continue')}</Button>}>
        <VerifyRun
          showLocationStep
          showFaceStep={j.face}
          locationState="done"
          faceState="idle"
          visual="location"
          success
          title={t('verify.confirmTitle', { institute: ctx.institute.shortName })}
          subtitle={t('verify.confirmBody', { distance: format.distance(phase.distanceM) })}
          labels={{ location: t('verify.stepLocation'), identity: t('verify.stepIdentity') }}
        />
      </ScreenLayout>
    );

  // Geo-tagging alone has no visible component (PRD §8.1): a neutral "getting ready" state while coordinates arrive.
  const cameraOn = phase.kind === 'facing' || phase.kind === 'matching' || phase.kind === 'faced';
  const faceVisual = cameraOn || phase.kind === 'passed';
  const locationDone = phase.kind !== 'starting' && phase.kind !== 'locating';
  const visibleLocation = j.location === 'fence';
  const text: [ReactNode, ReactNode] = (() => {
    switch (phase.kind) {
      case 'locating':
        return phase.visible && visibleLocation ? [t('verify.checkingLocation'), t('verify.stayHere')] : [t('verify.preparing'), ''];
      case 'located':
        return [t('verify.locationVerified'), <Latin key="inst">{ctx.institute.shortName}</Latin>];
      case 'facing':
        return [t('verify.lookAtCamera'), t('verify.lookHint')];
      case 'matching':
        return [t('verify.checkingFace'), t('verify.stayHere')];
      case 'faced':
      case 'passed':
        return [t('verify.identityVerified'), passedSubtitle];
      default:
        return [t('verify.preparing'), ''];
    }
  })() as [ReactNode, ReactNode];

  return (
    <ScreenLayout surface="default" banner={false} header={header} area={area} padding="none" width="form">
      <VerifyRun
        showLocationStep={visibleLocation}
        showFaceStep={j.face}
        locationState={locationDone ? 'done' : 'active'}
        faceState={phase.kind === 'faced' || phase.kind === 'passed' ? 'done' : cameraOn ? 'active' : 'idle'}
        visual={faceVisual || (!visibleLocation && j.face) ? 'face' : 'location'}
        success={phase.kind === 'located' || phase.kind === 'faced' || phase.kind === 'passed'}
        title={text[0]}
        subtitle={text[1]}
        labels={{ location: t('verify.stepLocation'), identity: t('verify.stepIdentity') }}
        simulatedNote={faceCapture.source() === 'simulated' ? t('face.simulatedCamera') : faceMatch.simulated ? t('face.prototypeShort') : undefined}
        faceSlot={cameraOn ? <FaceCheck guided={flow.guidedCapture} onDone={(frame) => void flow.faceCaptured(frame)} onFail={flow.faceFailed} /> : undefined}
      />
    </ScreenLayout>
  );
}

'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Banner } from '@/components/ui/Banner';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DetailRows } from '@/components/ui/DetailRows';
import { Latin } from '@/components/ui/Latin';
import { Skeleton } from '@/components/ui/Skeleton';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import type { StaffAttendanceRecord } from '@/domain/attendance';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { useVoiceBusEvent } from '@/hooks/useVoiceBus';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import { ResultScreen } from '../feedback/ResultScreen';
import { roleLine } from '../home/roleLine';
import { VerificationFlow } from '../verification/VerificationFlow';
import styles from './Self.module.css';

/** Instructor self-attendance: the same verification as student marking, then one tap (PRD §18.1). */
export function SelfAttendanceScreen() {
  const { t, format } = useI18n();
  const router = useRouter();
  const ctx = useSession();
  const { staffAttendance, verification } = useServices();
  const j = ctx.journey;
  const { data } = useQuery(`self:${ctx.user.id}`, async () => ({ record: await staffAttendance.myRecord(ctx), verified: await verification.hasPass(ctx, { kind: 'self' }) }), ['staff', 'verification']);
  const [saved, setSaved] = useState<StaffAttendanceRecord | null>(null);
  const [busy, setBusy] = useState(false);
  /** The screen saw the trainer unmarked: their own mark made after that (a tap racing voice) is shown, not left for Home. */
  const [sawUnmarked, setSawUnmarked] = useState(false);
  if (data && !data.record && !sawUnmarked) setSawUnmarked(true);
  // Voice saved it (D-141): shown as this screen's own result, also when the screen mounts after voice's navigation.
  useVoiceBusEvent('self_marked', (e) => setSaved(e.record), { replayMissed: true, replayBound: (e) => e.type === 'navigate' });
  const done = saved ?? (sawUnmarked && data?.record?.source === 'self' ? data.record : null);

  const blocked = !j.staff.selfCanMark;
  useEffect(() => {
    if (blocked) router.replace(routes.home);
    else if (data?.record && !done) router.replace(routes.home);
  }, [blocked, data, done, router]);

  if (done) {
    const offline = done.syncState !== 'synced';
    return (
      <ResultScreen
        tone={offline ? 'warning' : 'success'}
        icon={offline ? 'cloud-upload' : 'circle-check'}
        title={t('self.resultTitle')}
        sub={t('self.resultSub', { status: t('status.present'), time: format.time(done.deviceTimestamp) })}
        meta={offline ? t('self.resultOffline') : j.verification.required ? t('self.verified') : t('self.resultOnline')}
        primary={{ label: t('common.done'), href: routes.home }}
        header={<AppHeader plain />}
        area="home"
      />
    );
  }
  if (!data || blocked || data.record) return <ScreenLayout area="home" width="form" header={<AppHeader back="back" title={t('self.title')} />}><Skeleton count={1} height={200} label={t('common.loading')} /></ScreenLayout>;

  if (j.verification.required && !data.verified)
    return <VerificationFlow purpose={{ kind: 'self' }} area="home" subtitle={t('self.title')} passedSubtitle={t('verify.oneMoreStep')} onPassed={() => undefined} onExit={() => router.back()} />;

  const mark = async () => {
    setBusy(true);
    const result = await staffAttendance.markSelf(ctx);
    setBusy(false);
    if (result.ok) setSaved(result.value);
    // Already marked (voice saved it a moment ago): the refreshed record shows as the result, or Home when it is not their own.
    else if (result.error !== 'already_marked') router.replace(routes.home);
  };
  const now = ctx.clock.now();
  const verifiedText = j.verification.location !== 'none' && j.verification.face ? t('self.verified') : j.verification.face ? t('self.verifiedIdentity') : t('self.verifiedLocation');

  return (
    <ScreenLayout
      area="home"
      width="form"
      header={<AppHeader back="back" title={t('self.title')} backHref={routes.home} />}
      footer={
        <Button fullWidth leadingIcon="check" onClick={() => void mark()} loading={busy}>
          {t('self.markPresent')}
        </Button>
      }
    >
      {j.verification.required && (
        <Banner tone="success" icon="shield-check" strong>
          {verifiedText}
        </Banner>
      )}
      <Card>
        <span className={styles.person}>
          <Avatar name={ctx.user.name} size={48} />
          <span className={styles.who}>
            <span className={styles.name}><Latin>{ctx.user.name}</Latin></span>
            <span className={styles.role}>{roleLine(t, ctx)}</span>
          </span>
        </span>
        <DetailRows
          rows={[
            { key: 'date', label: t('self.rowDate'), value: format.longDate(toLocalDate(now)) },
            { key: 'time', label: t('self.rowTime'), value: format.time(now) },
            { key: 'place', label: t('self.rowLocation'), value: <Latin>{ctx.institute.shortName}</Latin> },
          ]}
        />
      </Card>
    </ScreenLayout>
  );
}

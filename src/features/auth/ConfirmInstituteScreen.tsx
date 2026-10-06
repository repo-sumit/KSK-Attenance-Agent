'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { Latin } from '@/components/ui/Latin';
import { StatusLine } from '@/components/ui/StatusLine';
import { InlineBackBar } from '@/components/shell/Headers';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { useT } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { routes } from '@/lib/routes';
import { assistCredentials, assistErrorText, continueAfterInstitute } from './assistSignIn';
import { useLoginFlow } from './LoginFlow';
import styles from './Login.module.css';

/**
 * Step 2: show the institute's name and district; a wrong code becomes visible here (PRD §6.3). After a demo account
 * was picked, "Yes, continue" looks up that person instead of asking for a Trainer ID (assistSignIn).
 */
export function ConfirmInstituteScreen() {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    router.prefetch(routes.loginTrainer);
    router.prefetch(routes.loginIdentity);
  }, [router]);
  const services = useServices();
  const flow = useLoginFlow();
  const institute = flow.institute;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Set by a deny or by leaving: a person lookup still running then neither moves on nor signs in. */
  const abandoned = useRef(false);
  useEffect(() => {
    abandoned.current = false;
    return () => {
      abandoned.current = true;
    };
  }, []);

  useEffect(() => {
    if (!institute) router.replace(routes.login);
  }, [institute, router]);
  if (!institute) return null;

  const deny = () => {
    abandoned.current = true;
    flow.reset();
    router.replace(routes.login);
  };

  const confirm = async () => {
    // Without a picked account (production, a typed code): the Trainer ID step, as always.
    if (!assistCredentials(services, flow)) return router.push(routes.loginTrainer);
    if (busy) return;
    setBusy(true);
    setError(null);
    // continueAfterInstitute answers every failure itself; the catch is the last guard against a stuck button.
    const step = await continueAfterInstitute(services, flow, () => abandoned.current).catch(() => null);
    if (abandoned.current) return;
    if (!step?.ok) {
      setBusy(false);
      setError(step ? assistErrorText(t, step.error) : t('login.lookupFailed'));
      return;
    }
    if (step.signedIn) router.replace(step.route);
    else router.push(step.route);
  };

  return (
    <ScreenLayout
      card
      surface="default"
      banner={false}
      padding="none"
      header={<InlineBackBar onBack={deny} />}
      footer={
        <>
          <Button fullWidth onClick={() => void confirm()} loading={busy}>
            {busy ? t('login.checkingTrainer') : t('login.yesContinue')}
          </Button>
          <Button variant="secondary" fullWidth onClick={deny} disabled={busy}>
            {t('login.changeInstitute')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <h1 className={styles.title}>{t('login.instituteTitle')}</h1>
        <div className={styles.card}>
          <span className={styles.well} aria-hidden="true">
            <Icon name="building" size={24} />
          </span>
          <div className={styles.cardText}>
            <p className={styles.instName}>
              <Latin>{institute.name}</Latin>
            </p>
            <p className={styles.instPlace}>
              <Latin>{t('login.instituteLocation', { locality: institute.locality, district: institute.district })}</Latin>
            </p>
            <p className={styles.instCode}>{t('login.instituteCode', { code: institute.code })}</p>
          </div>
        </div>
        {error && (
          <p role="alert">
            <StatusLine tone="error" icon="alert">
              {error}
            </StatusLine>
          </p>
        )}
      </div>
    </ScreenLayout>
  );
}

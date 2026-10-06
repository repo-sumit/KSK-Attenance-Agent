'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Latin } from '@/components/ui/Latin';
import { InlineBackBar } from '@/components/shell/Headers';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { useT } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { routes } from '@/lib/routes';
import { finishLogin } from './finishLogin';
import { useAssistAccountValue } from './LoginAssistList';
import { useLoginFlow } from './LoginFlow';
import styles from './Login.module.css';

const FORM_ID = 'trainer-id';
const INPUT_ID = 'trainer-id-input';

/** Step 3 (PRD §6.2): the Trainer ID, checked against the confirmed institute only. */
export function TrainerIdScreen() {
  const t = useT();
  const router = useRouter();
  useEffect(() => {
    router.prefetch(routes.loginIdentity);
    router.prefetch(routes.home);
  }, [router]);
  const params = useSearchParams();
  const services = useServices();
  const flow = useLoginFlow();
  const institute = flow.institute;
  const picked = useAssistAccountValue('trainerId');
  // An account picked from the demo accounts in this attempt brings its Trainer ID (the user still presses Continue).
  const [trainerId, setTrainerId] = useState(params.get('tid') ?? picked.value ?? '');
  const [error, setError] = useState<string>();
  /** What the Continue button is waiting for: the Trainer ID lookup, then (without a confirmation step) the sign-in. */
  const [busy, setBusy] = useState<'checking' | 'signingIn' | null>(null);

  useEffect(() => {
    if (!institute) router.replace(routes.login);
  }, [institute, router]);
  if (!institute) return null;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!trainerId.trim() || busy) return;
    setBusy('checking');
    try {
      const result = await services.auth.lookupInstructor(institute.id, trainerId);
      if (!result.ok) {
        setBusy(null);
        setError(result.error === 'invalid_format' ? t('login.trainerInvalid') : t('login.trainerNotFound', { institute: institute.shortName }));
        return;
      }
      flow.setInstructor(result.value);
      if (services.configuration.base().identity.instructorConfirmStep) {
        setBusy(null);
        router.push(routes.loginIdentity);
        return;
      }
      setBusy('signingIn');
      router.replace(await finishLogin(services, institute.id, result.value.id));
    } catch {
      // The server unreachable (lookup or sign-in): say so and let the user try again, never a stuck Continue.
      setBusy(null);
      setError(t('login.lookupFailed'));
    }
  };

  return (
    <ScreenLayout
      card
      surface="default"
      banner={false}
      padding="none"
      header={<InlineBackBar onBack={() => router.back()} />}
      footer={
        <Button type="submit" form={FORM_ID} fullWidth disabled={!trainerId.trim()} loading={busy !== null}>
          {busy === 'checking' ? t('login.checkingTrainer') : busy === 'signingIn' ? t('login.signingIn') : t('common.continue')}
        </Button>
      }
    >
      <form id={FORM_ID} className={styles.body} onSubmit={submit} noValidate>
        <div className={styles.heading}>
          <h1 className={styles.title}>{t('login.trainerTitle')}</h1>
          <p className={styles.hint}>
            <Latin>{institute.shortName}</Latin>
          </p>
        </div>
        <Input
          id={INPUT_ID}
          label={t('login.trainerLabel')}
          value={trainerId}
          onChange={(v) => {
            const next = v.toUpperCase().slice(0, 12);
            setTrainerId(next);
            setError(undefined);
            picked.edited(next);
          }}
          placeholder={t('login.trainerPlaceholder')}
          autoCapitalize="characters"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="go"
          latin
          error={error}
        />
      </form>
    </ScreenLayout>
  );
}

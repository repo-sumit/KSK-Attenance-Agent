'use client';
import Image from 'next/image';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { useT } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { routes } from '@/lib/routes';
import { LoginAssistList, useAssistAccountValue } from './LoginAssistList';
import { useLoginFlow } from './LoginFlow';
import styles from './Login.module.css';

const FORM_ID = 'institute-code';
const INPUT_ID = 'institute-code-input';

/** Step 1 (PRD §6.1): the institute code, checked live before anything else is asked. */
export function InstituteCodeScreen() {
  const t = useT();
  const router = useRouter();
  // The next steps load while the code is typed, so moving on never shows an empty screen.
  useEffect(() => {
    router.prefetch(routes.loginInstitute);
    router.prefetch(routes.loginTrainer);
  }, [router]);
  const params = useSearchParams();
  const { auth, configuration, loginAssist } = useServices();
  const flow = useLoginFlow();
  const picked = useAssistAccountValue('instituteCode');
  // Back from a later step: the account picked in this attempt is still in the field.
  const [code, setCode] = useState(params.get('code') ?? picked.value ?? '');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  /** A demo account is being looked up: Continue waits, so one lookup runs at a time. */
  const [assistBusy, setAssistBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!code.trim() || busy || assistBusy) return;
    setBusy(true);
    // A lookup that throws (the server unreachable, nothing cached) is a failure with a message, as on the list.
    const result = await auth.lookupInstitute(code).catch(() => null);
    setBusy(false);
    if (!result) return setError(t('login.lookupFailed'));
    if (!result.ok) {
      setError(result.error === 'invalid_format' ? t('login.codeInvalid') : t('login.codeNotFound', { code }));
      return;
    }
    flow.setInstitute(result.value);
    router.push(configuration.base().identity.instituteConfirmStep ? routes.loginInstitute : routes.loginTrainer);
  };

  return (
    <ScreenLayout
      card
      surface="default"
      banner={false}
      padding="none"
      // Demo builds: the Demo accounts list scrolls under Continue, so the footer gets its divider (U17).
      footerDivider={Boolean(loginAssist)}
      footer={
        <Button type="submit" form={FORM_ID} fullWidth disabled={!code.trim() || assistBusy} loading={busy}>
          {busy ? t('login.checkingInstitute') : t('common.continue')}
        </Button>
      }
    >
      <div className={`${styles.body} ${styles.bodyFirst}`}>
        <div className={styles.lockup}>
          <Image src="/branding/ksk-emblem.png" alt={t('app.emblemAlt')} width={72} height={72} className={styles.emblem} priority />
          <div className={styles.lockupText}>
            {/* The brand stays English in Marathi (D-035): lang on the element, so its face and line height are Latin. */}
            <p className={styles.brandName} lang="en">
              {t('app.name')}
            </p>
            <p className={styles.brandState}>{t('app.state')}</p>
          </div>
        </div>
        <form id={FORM_ID} className={styles.form} onSubmit={submit} noValidate>
          <div className={styles.heading}>
            <h1 className={styles.title}>{t('login.codeTitle')}</h1>
            <p className={styles.hint}>{t('login.codeHint')}</p>
          </div>
          <Input
            id={INPUT_ID}
            label={t('login.codeLabel')}
            value={code}
            onChange={(v) => {
              const next = v.replace(/\D/g, '').slice(0, 6);
              setCode(next);
              setError(undefined);
              picked.edited(next);
            }}
            placeholder={t('login.codePlaceholder')}
            inputMode="numeric"
            autoComplete="off"
            enterKeyHint="go"
            latin
            error={error}
          />
          <LoginAssistList
            disabled={busy}
            onFill={(v) => {
              setCode(v);
              setError(undefined);
            }}
            onError={setError}
            onBusyChange={setAssistBusy}
          />
        </form>
      </div>
    </ScreenLayout>
  );
}

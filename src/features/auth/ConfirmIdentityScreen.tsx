'use client';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { DetailRows, type DetailRow } from '@/components/ui/DetailRows';
import { Latin } from '@/components/ui/Latin';
import { InlineBackBar } from '@/components/shell/Headers';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { useT } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { routes } from '@/lib/routes';
import { designationLabel } from '../common/labels';
import { RoleLine } from '../common/RoleLine';
import { finishLogin } from './finishLogin';
import { useLoginFlow } from './LoginFlow';
import styles from './Login.module.css';

/** Step 4: name, employment type and designation, then the session opens. */
export function ConfirmIdentityScreen() {
  const t = useT();
  const router = useRouter();
  const services = useServices();
  const flow = useLoginFlow();
  const { institute, instructor } = flow;
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!institute || !instructor) router.replace(routes.login);
  }, [institute, instructor, router]);
  if (!institute || !instructor) return null;

  const role = t(`role.${instructor.role}`);
  const specialty = instructor.subjectName ?? instructor.tradeName;
  const rows: DetailRow[] = [
    { key: 'designation', label: t('login.rowDesignation'), value: designationLabel(t, instructor.designation) ?? <Latin>{instructor.designation}</Latin> },
    ...(specialty
      ? [{ key: 'trade', label: instructor.subjectName ? t('login.rowSubject') : t('login.rowTrade'), value: <Latin>{specialty}</Latin> }]
      : []),
    { key: 'employment', label: t('login.rowEmployment'), value: t(`employment.${instructor.employmentType}`) },
    { key: 'institute', label: t('login.rowInstitute'), value: <Latin>{institute.shortName}</Latin> },
  ];

  const confirm = async () => {
    setBusy(true);
    router.replace(await finishLogin(services, institute.id, instructor.id));
  };

  return (
    <ScreenLayout
      card
      surface="default"
      banner={false}
      padding="none"
      header={<InlineBackBar onBack={() => router.back()} />}
      footer={
        <>
          <Button fullWidth onClick={confirm} loading={busy}>
            {busy ? t('login.signingIn') : t('login.yesContinue')}
          </Button>
          <Button
            variant="ghost"
            fullWidth
            onClick={() => {
              flow.setInstructor(null);
              // A picked demo account is forgotten too, so the next "Yes, continue" asks for a Trainer ID.
              flow.setAssistAccount(null);
              router.back();
            }}
          >
            {t('login.notYou')}
          </Button>
        </>
      }
    >
      <div className={styles.body}>
        <h1 className={styles.title}>{t('login.identityTitle')}</h1>
        <div className={`${styles.card} ${styles.cardColumn}`}>
          <div className={styles.cardRow}>
            <Avatar name={instructor.name} size={56} />
            <div className={styles.cardText}>
              <p className={styles.personName}>
                <Latin>{instructor.name}</Latin>
              </p>
              <p className={styles.personRole}>
                <RoleLine role={role} trade={instructor.role !== 'principal' ? specialty : null} />
              </p>
            </div>
          </div>
          <DetailRows rows={rows} />
        </div>
      </div>
    </ScreenLayout>
  );
}

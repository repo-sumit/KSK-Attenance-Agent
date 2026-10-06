'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Banner } from '@/components/ui/Banner';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ChoicePill } from '@/components/ui/ChoicePill';
import { DetailRows } from '@/components/ui/DetailRows';
import { Input } from '@/components/ui/Input';
import { Latin } from '@/components/ui/Latin';
import { SelectionCard } from '@/components/ui/SelectionCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { StatusChip } from '@/components/ui/StatusChip';
import { useToast } from '@/components/ui/Toast';
import { statusIcon, statusTone } from '@/components/ui/status-style';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { marksEqual, type Mark } from '@/domain/status';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { routes } from '@/lib/routes';
import { CORRECTION_REASON_CODES, type Correction, type CorrectionReasonCode } from '@/domain/attendance';
import { BatchLabel } from '../common/BatchLabel';
import { correctionReason, markLabel, reasonKey, statusOf } from '../common/labels';
import { LatinText, slotted } from '../common/LatinText';
import { ResultScreen } from '../feedback/ResultScreen';
import styles from './Correct.module.css';

/** Correction targets offered: from the status set and halves flag. OJT is ERP-only (PRD §9.6). */
function options(selectable: readonly string[], halves: boolean): Mark[] {
  const out: Mark[] = [];
  for (const s of selectable) {
    if (s === 'half_day' && halves) out.push({ status: 'half_day', half: 1 }, { status: 'half_day', half: 2 });
    else if (s === 'present' || s === 'absent' || s === 'half_day' || s === 'leave') out.push({ status: s });
  }
  return out;
}

export function CorrectScreen() {
  const { t, format } = useI18n();
  const router = useRouter();
  const toast = useToast();
  const ctx = useSession();
  const { attendance, corrections } = useServices();
  const params = useSearchParams();
  const key = params.get('s') ?? '';
  const studentId = params.get('student') ?? '';
  const { data: detail } = useQuery(`correct:${key}`, () => attendance.getDetail(ctx, key), ['corrections']);
  const [target, setTarget] = useState<Mark | null>(null);
  const [reason, setReason] = useState('');
  const [reasonCode, setReasonCode] = useState<CorrectionReasonCode | undefined>(undefined);
  const [sheet, setSheet] = useState(false);
  const [done, setDone] = useState<Correction | null>(null);

  const back = routes.record(key);
  const invalid = Boolean(detail) && (!detail?.students.some((s) => s.id === studentId) || !detail?.marks[studentId] || !ctx.journey.corrections);
  useEffect(() => {
    if (invalid && !done) router.replace(back);
  }, [invalid, done, back, router]);
  if (!detail) return <ScreenLayout area="attendance" width="form" header={<AppHeader back="back" title={t('correction.title')} backHref={back} />}><Skeleton label={t('common.loading')} /></ScreenLayout>;
  const student = detail.students.find((s) => s.id === studentId);
  const current = detail.marks[studentId];
  if (!student || !current || !ctx.journey.corrections) return null;
  // The trade is Latin master data; "Shift 1 · Unit 2" is translated (U14).
  const session = <BatchLabel trade={detail.card.trade} batch={detail.card.batch} />;

  if (done)
    return (
      <ResultScreen
        tone="success"
        icon="circle-check"
        title={t('correction.resultTitle')}
        sub={<Latin>{student.name}</Latin>}
        meta={session}
        primary={{ label: t('common.done'), onPress: () => router.replace(back) }}
        header={<AppHeader plain />}
        area="attendance"
      >
        <DetailRows
          variant="card"
          rows={[
            { key: 'by', label: t('correction.changedBy'), value: <Latin>{ctx.user.name}</Latin> },
            { key: 'time', label: t('correction.time'), value: format.time(done.timestamp) },
            { key: 'prev', label: t('correction.previous'), value: markLabel(t, done.oldMark) },
            { key: 'next', label: t('correction.next'), value: markLabel(t, done.newMark) },
            { key: 'reason', label: t('correction.reason'), value: correctionReason(t, done) },
          ]}
        />
      </ResultScreen>
    );

  const save = async () => {
    if (!target) return;
    const result = await corrections.correct(ctx, key, studentId, target, reason, reasonCode);
    setSheet(false);
    if (result.ok) setDone(result.value);
    else toast.show(result.error === 'not_today' ? t('record.notePrincipalPast') : result.error === 'not_synced' ? t('record.notePending') : t('correction.audit'));
  };

  return (
    <ScreenLayout
      area="attendance"
      width="form"
      header={<AppHeader back="back" title={t('correction.title')} subtitle={session} backHref={back} />}
      footer={
        <Button
          fullWidth
          inactive={!target || !reason.trim()}
          onInactivePress={() => toast.show(t(!target ? 'correction.needStatus' : 'correction.needReason'))}
          onClick={() => setSheet(true)}
        >
          {t('correction.save')}
        </Button>
      }
    >
      <Card>
        <span className={styles.student}>
          <span className={styles.name}><Latin>{student.name}</Latin></span>
          <span className={styles.father}>
            <LatinText k="roster.father" params={{ name: student.fatherName }} latin={['name']} />
          </span>
          <span className={styles.meta}>{slotted(t, 'correction.meta', { session, n: student.rollNo })}</span>
        </span>
      </Card>
      <div className={styles.row}>
        <span className={styles.label}>{t('correction.currentStatus')}</span>
        <StatusChip status={statusOf(current)} label={markLabel(t, current)} size="md" />
      </div>
      <div className={styles.group} role="radiogroup" aria-label={t('correction.changeTo')}>
        <span className={styles.label}>{t('correction.changeTo')}</span>
        {options(ctx.journey.marking.selectable, ctx.journey.marking.halfDayHalves).map((option) => (
          <SelectionCard
            key={`${option.status}-${option.half ?? ''}`}
            icon={statusIcon(statusOf(option))}
            iconTone={statusTone(statusOf(option))}
            label={markLabel(t, option)}
            current={marksEqual(option, current)}
            currentTag={t('correction.current')}
            selected={Boolean(target && marksEqual(target, option))}
            onSelect={() => setTarget(option)}
          />
        ))}
      </div>
      <div className={styles.group}>
        <Input
          label={t('correction.reasonLabel')}
          value={reason}
          onChange={(text) => {
            setReason(text);
            setReasonCode(undefined);
          }}
          placeholder={t('correction.reasonPlaceholder')}
          maxLength={200}
        />
        <div className={styles.chips}>
          {CORRECTION_REASON_CODES.map((code) => (
            <ChoicePill
              key={code}
              role="button"
              selected={reasonCode === code}
              onPress={() => {
                setReason(t(reasonKey(code)));
                setReasonCode(code);
              }}
            >
              {t(reasonKey(code))}
            </ChoicePill>
          ))}
        </div>
      </div>
      <Banner tone="info" icon="shield-check">
        {t('correction.audit')}
      </Banner>
      <BottomSheet
        open={sheet}
        onClose={() => setSheet(false)}
        title={t('correction.sheetTitle')}
        description={t('correction.audit')}
        actions={
          <>
            <Button fullWidth onClick={() => void save()}>{t('correction.save')}</Button>
            <Button variant="secondary" fullWidth onClick={() => setSheet(false)}>{t('common.cancel')}</Button>
          </>
        }
      >
        <DetailRows
          variant="hero"
          rows={[
            { key: 'change', label: <Latin>{student.name}</Latin>, value: t('correction.change', { from: markLabel(t, current), to: target ? markLabel(t, target) : '' }) },
            { key: 'reason', label: t('correction.reason'), value: reasonCode ? t(reasonKey(reasonCode)) : reason.trim() },
          ]}
        />
      </BottomSheet>
    </ScreenLayout>
  );
}

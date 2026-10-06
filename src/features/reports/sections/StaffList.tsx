'use client';
import { Card } from '@/components/ui/Card';
import { AttendanceSummary } from '@/components/ui/AttendanceSummary';
import { Disclosure } from '@/components/ui/Disclosure';
import { Latin } from '@/components/ui/Latin';
import { StatusLine, type StatusLineTone } from '@/components/ui/StatusLine';
import { statusIcon } from '@/components/ui/status-style';
import { STATUS_REGISTRY, type StatusCode } from '@/domain/status';
import { useI18n } from '@/hooks/i18n';
import { useJourney, useSession } from '@/hooks/session';
import type { StaffStanding } from '@/services/reports';
import { summaryLabels } from '../../common/labels';
import { LatinText } from '../../common/LatinText';
import { RoleLine } from '../../common/RoleLine';
import { PctBadge } from './PctBadge';
import { StandingPanel } from './StandingList';
import list from './StaffList.module.css';
import styles from '../Reports.module.css';

/** A status as a short line: its own icon and colour (OJT's brand tone reads as info here), always with its name. */
const lineTone = (status: StatusCode): StatusLineTone => {
  const tone = STATUS_REGISTRY[status].tone;
  return tone === 'brand' ? 'info' : tone;
};

/** The staff, lowest % first (the service's order), each row opening onto its day counts per status. */
export function StaffList({ staff, threshold }: { readonly staff: readonly StaffStanding[]; readonly threshold: number }) {
  return (
    <Card divided>
      {staff.map((s) => (
        <StaffRow key={s.member.id} standing={s} threshold={threshold} />
      ))}
    </Card>
  );
}

function StaffRow({ standing: s, threshold }: { readonly standing: StaffStanding; readonly threshold: number }) {
  const { t, format } = useI18n();
  const ctx = useSession();
  const j = useJourney();
  const trade = ctx.data.trades.find((x) => x.id === s.member.primaryTradeId)?.name ?? ctx.data.subjects.find((x) => x.id === s.member.subjectId)?.name;
  const role = t(`role.${s.member.role}`);
  return (
    <Disclosure
      summary={
        <>
          <span className={styles.rowText}>
            <span className={styles.rowTitle}>
              {s.member.id === ctx.user.id ? <LatinText k="staff.you" params={{ name: s.member.name }} latin={['name']} /> : <Latin>{s.member.name}</Latin>}
            </span>
            <span className={styles.rowSub}>
              <RoleLine role={role} trade={trade} />
            </span>
            <span className={list.lines}>
              {s.today ? (
                <StatusLine tone={lineTone(s.today.status)} icon={statusIcon(s.today.status)}>
                  {t('reports.staffToday', { status: t(`status.${s.today.status}`) })}
                </StatusLine>
              ) : (
                <StatusLine tone="warning" icon="circle">
                  {t('reports.notMarkedToday')}
                </StatusLine>
              )}
              <span className={list.days}>{t('reports.studentDays', { present: s.present, days: s.marked })}</span>
              {s.unmarked > 0 && (
                <StatusLine tone="warning" icon={statusIcon('not_marked')}>
                  {t('reports.staffUnmarkedDays', { count: s.unmarked })}
                </StatusLine>
              )}
            </span>
          </span>
          <PctBadge pct={s.pct} low={s.low} threshold={threshold} />
        </>
      }
    >
      {/* The person's days as every attendance total is drawn (D-069): Days, Present by weight, each status, Not marked. */}
      <StandingPanel>
        <AttendanceSummary counts={s.counts} statuses={j.staff.statusSet} labels={summaryLabels(t, format, 'days')} showNotMarked />
      </StandingPanel>
    </Disclosure>
  );
}

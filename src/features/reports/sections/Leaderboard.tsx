'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Segmented } from '@/components/ui/Segmented';
import { Skeleton } from '@/components/ui/Skeleton';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useJourney, useSession } from '@/hooks/session';
import { useQuery } from '@/hooks/useQuery';
import { rankStandings, type LeaderboardSort } from '@/services/reports';
import { RegisterDownloadButton } from '../register/RegisterDownloadSheet';
import { StandingList, StandingPanel } from './StandingList';
import styles from './StandingList.module.css';

/**
 * One batch's students over the report window as a light leaderboard (brief
 * §7): rank, name, %, at risk flagged. The ranking is the service's
 * (rankStandings), so the at-risk list numbers students the same way.
 */
export function Leaderboard({ batchId, subject, expected, onHide }: { readonly batchId: string; readonly subject: string; readonly expected: number; readonly onHide: () => void }) {
  const { t } = useI18n();
  const ctx = useSession();
  const j = useJourney();
  const { reports } = useServices();
  const [sort, setSort] = useState<LeaderboardSort>(j.reports.leaderboardSort);
  const { data } = useQuery(`report-students:${ctx.user.id}:${batchId}`, () => reports.batchStudents(ctx, batchId), ['attendance', 'corrections']);

  if (data === undefined)
    return (
      <StandingPanel>
        <Skeleton variant="rows" count={Math.max(1, Math.min(expected, 4))} label={t('common.loading')} />
      </StandingPanel>
    );
  if (!data?.length)
    return (
      <StandingPanel>
        <p className={styles.empty}>{t('reports.noStudentData')}</p>
      </StandingPanel>
    );
  return (
    <StandingPanel>
      <div className={styles.toolbar}>
        <p className={styles.caption}>{t('reports.boardCaption', { count: data.length, days: j.reports.windowDays })}</p>
        <Segmented
          className={styles.sort}
          label={t('reports.sortLabel')}
          size="sm"
          fullWidth
          value={sort}
          onChange={setSort}
          options={[
            { value: 'high_first', label: t('reports.sortHigh') },
            { value: 'low_first', label: t('reports.sortLow') },
          ]}
        />
      </div>
      <StandingList as="ol" items={rankStandings(data, sort)} flagAtRisk />
      <div className={styles.end}>
        {j.reports.pdfDownload && <RegisterDownloadButton target={{ batchIds: [batchId], subject, scope: { kind: 'batch' } }} />}
        {/* A long list can be closed from its end, back to its batch (D-053). */}
        <Button variant="ghost" size="md" trailingIcon="chevron-up" onClick={onHide}>
          {t('reports.hideStudents')}
        </Button>
      </div>
    </StandingPanel>
  );
}

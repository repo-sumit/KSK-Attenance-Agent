'use client';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { AppHeader } from '@/features/shell/AppHeader';
import { useI18n } from '@/hooks/i18n';
import { useJourney } from '@/hooks/session';
import { AtRiskSection } from './sections/AtRiskSection';
import { BatchesSection } from './sections/BatchesSection';
import { InstituteSection } from './sections/InstituteSection';
import { MyAttendanceSection } from './sections/MyAttendanceSection';
import { MoreReports, OfflineEntry } from './sections/ReportLinks';
import { StaffSection } from './sections/StaffSection';

/**
 * Reports = "how am I and my students doing over time?" (D-053). One page of
 * sections for this month, each present only when its block is enabled
 * (report.blocks): my attendance or the institute, the batches with each
 * batch's students, at-risk students, staff attendance (D-154), offline data,
 * and the detail reports. Staff attendance shows the page's one staff figure:
 * the institute card leaves its own out, and More reports leaves the staff
 * report out (the section links to it).
 */
export function ReportsScreen() {
  const { t } = useI18n();
  const j = useJourney();
  const has = (block: (typeof j.reports.blocks)[number]) => j.reports.enabled && j.reports.blocks.includes(block);
  const staff = has('staff_summary') && j.staff.principalStaffView;
  return (
    <ScreenLayout header={<AppHeader title={t('reports.title')} />} area="reports" bottomNav width="reading">
      {has('institute_summary') && <InstituteSection staffFigure={!staff} />}
      {has('my_attendance') && <MyAttendanceSection />}
      {has('trade_batch') ? <BatchesSection title={t('reports.trade_batch')} /> : has('my_batches') && <BatchesSection title={t('reports.my_batches')} />}
      {has('student_percentage') && <AtRiskSection />}
      {staff && <StaffSection />}
      {j.offline.enabled && <OfflineEntry />}
      <MoreReports onPage={staff ? ['staff_summary'] : []} />
    </ScreenLayout>
  );
}

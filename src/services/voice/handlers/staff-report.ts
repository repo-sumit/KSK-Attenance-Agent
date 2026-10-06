/**
 * The staff report by voice (D-154, D-156), with the Reports screen's Staff attendance section
 * (`capabilities.reportSections.staff`): get_staff_report answers from ReportService.staffOverview (this month, the
 * figures the section shows), show_report then brings the section into view, and download_register with the target
 * "staff" opens the register sheet on the staff scope. The principal's own row is "you", never their name. The screen
 * changes only through typed bus events (show_staff_report, open_staff_register), never from model text.
 */
import type { LocalDate } from '@/lib/time';
import { routes } from '@/lib/routes';
import { nameText } from '../labels';
import { staffRegisterInstruction, staffReportInstruction, type InstituteHeadline, type StaffFigure } from '../report-texts';
import type { ToolResult } from '../tools';
import { fail, type BaseContext, type BaseDeps, type BaseHandler } from './base';

const LOWEST = 5;

export const getStaffReport: BaseHandler = async (h) => {
  const { ctx, reports } = h.deps;
  const o = await reports.staffOverview(ctx);
  if (!o) return fail('NOT_AVAILABLE', 'The staff report is not available here. Say so in one short line.');
  const scored = o.staff.filter((s) => s.pct !== null); // lowest first, as the section lists them
  const lowest: StaffFigure[] = scored.slice(0, LOWEST).map((s) => {
    const self = s.member.id === ctx.user.id;
    return { name: self ? 'you' : nameText(s.member.name), self, pct: s.pct, days_present: s.present, days_marked: s.marked };
  });
  const below = scored.filter((s) => s.low).length;
  const noMarks = o.staff.length - scored.length;
  h.state.report = { kind: 'staff' };
  return {
    ok: true, month_pct: o.pct, threshold: o.threshold, staff_days: o.staffDays,
    lowest: lowest.map((s) => (s.self ? s : { name: s.name, pct: s.pct, days_present: s.days_present, days_marked: s.days_marked })),
    below_threshold: below, no_days_marked: noMarks, not_marked_today: o.today.unmarked,
    instruction: staffReportInstruction({ pct: o.pct, threshold: o.threshold, lowest, below, noMarks, notMarkedToday: o.today.unmarked }),
  };
};

/**
 * The principal's headline for get_reports_overview: the staff figure is this month's from the staff report where the
 * screen has the Staff attendance section (the Institute card then shows none), else the card's own over the window.
 */
export async function instituteHeadline(deps: BaseDeps): Promise<InstituteHeadline> {
  const staffSection = deps.voice.capabilities.reportSections.staff;
  const [summary, month] = await Promise.all([deps.reports.instituteSummary(deps.ctx), staffSection ? deps.reports.staffOverview(deps.ctx) : null]);
  return {
    avg_pct: summary.pct, students: summary.students, batches: summary.batches,
    staff_pct: month ? month.pct : summary.staffPct, staff_range: month ? 'this_month' : 'window',
  };
}

/** "staff", "the staff register", "स्टाफ", "कर्मचारी": the staff register, where the screen has the Staff attendance section. */
export function namesStaffRegister(h: BaseContext, said: string): boolean {
  return h.deps.voice.capabilities.reportSections.staff && /\bstaff\b|स्टाफ|कर्मचारी/iu.test(said);
}

/** Reports opens, then the Staff attendance section opens the register sheet on the staff scope and `month`. */
export async function openStaffRegister(h: BaseContext, month: LocalDate, monthName: string): Promise<ToolResult> {
  h.navigate(routes.reports, false);
  h.deps.bus.emit({ type: 'open_staff_register', month });
  const then = await h.afterNavigate();
  return { ok: true, target: 'staff', scope: 'staff', month: monthName, instruction: `${staffRegisterInstruction(monthName)}${then}` };
}

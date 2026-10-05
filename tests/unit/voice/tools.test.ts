// tests/unit/voice/tools.test.ts
import { describe, expect, it } from 'vitest';
import type { FlowPlan } from '@/domain/voice/plan';
import { buildTools } from '@/services/voice/tools';
import { CAPS, PRINCIPAL_PLAN, voicePlan } from '../../helpers/voice-view';

const PLAN: FlowPlan = {
  selection: 'trade_picker', tradeStep: true, slotWords: 'once',
  verification: { location: 'fence', face: true, required: true },
  defaultStatus: 'present', startStyle: 'exceptions', rollCallSwitch: true,
  statuses: ['present', 'absent'], ojtVisible: false,
  details: { half: false, leaveType: false, leaveDays: false },
  languages: ['en', 'mr'], openingLanguage: 'en', timeFencing: true,
};
const names = (p: FlowPlan) => buildTools(voicePlan(p)).map((t) => t.name);
const tool = (p: FlowPlan, n: string) => buildTools(voicePlan(p)).find((t) => t.name === n)!;

describe('buildTools', () => {
  it('declares every tool BLOCKING', () => {
    expect(buildTools(voicePlan(PLAN)).every((t) => t.behavior === 'BLOCKING')).toBe(true);
  });
  it('Maharashtra open mapping: the full set', () => {
    expect(names(PLAN)).toEqual([
      'get_trades', 'select_trade', 'select_batch', 'start_roll_call', 'mark_attendance', 'set_student_status', 'skip_student', 'mark_remaining', 'go_back', 'get_status', 'verify_again',
      'get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register',
      'get_my_attendance', 'mark_my_attendance', 'navigate', 'get_announcements', 'submit_attendance', 'end_voice_session',
    ]);
  });
  it('a disabled feature has no tool', () => {
    const p = { ...PLAN, tradeStep: false, rollCallSwitch: false, verification: { location: 'none' as const, face: false, required: false } };
    expect(names(p)).not.toEqual(expect.arrayContaining(['get_trades']));
    expect(names(p)).not.toContain('select_trade');
    expect(names(p)).not.toContain('start_roll_call');
    expect(names(p)).not.toContain('verify_again');
    expect(tool(p, 'go_back').parameters!.properties.to.enum).toEqual(['batch']);
  });
  it('status enums come from the status set; details only where the state uses them', () => {
    expect(tool(PLAN, 'mark_attendance').parameters!.properties.status.enum).toEqual(['PRESENT', 'ABSENT']);
    expect(Object.keys(tool(PLAN, 'mark_attendance').parameters!.properties)).toEqual(['student_id', 'status', 'heard']);
    const rich = { ...PLAN, statuses: ['present', 'absent', 'half_day', 'leave'] as const, details: { half: true, leaveType: true, leaveDays: true } };
    const props = tool(rich as FlowPlan, 'set_student_status').parameters!.properties;
    expect(props.status.enum).toEqual(['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE']);
    expect(props.half.enum).toEqual(['first', 'second']);
    expect(props.leave_type.enum).toEqual(['SICK', 'CASUAL', 'MEDICAL']);
    expect(props.leave_days.type).toBe('INTEGER');
  });
  it('confirmations are codes, never booleans', () => {
    const json = JSON.stringify(buildTools(voicePlan(PLAN)));
    expect(json).not.toContain('confirmed');
    expect(tool(PLAN, 'submit_attendance').parameters!.properties.confirm_token.type).toBe('STRING');
    expect(tool(PLAN, 'submit_attendance').parameters!.required).toBeUndefined();
  });
  it('keeps the MVP wording of the select_batch and set_student_status texts', () => {
    const batch = tool(PLAN, 'select_batch');
    expect(batch.description).toBe('Choose a batch, half or period of the selected trade and start marking: a roll call (it returns the first student to call) or, where everyone starts present, by exception (ask who is not).');
    expect(batch.parameters!.properties.batch.description).toBe('Batch id from the last tool result, or the spoken label such as "shift 1 unit 2"');
    const student = tool(PLAN, 'set_student_status');
    expect(student.description).toBe('Change the status of any student in the batch: corrections ("Rahul absent tha"), "the last one was wrong" (use last_marked), or several students named at once (one call each).');
    expect(student.parameters!.properties.student.description).toBe('Student id, roll number or name (add the father name if the name repeats)');
  });
  it('select_trade, select_batch and go_back have no confirm_token and no marks-lost text (spec section 7, D-083)', () => {
    for (const n of ['select_trade', 'select_batch', 'go_back']) {
      const t = tool(PLAN, n);
      expect(Object.keys(t.parameters!.properties)).not.toContain('confirm_token');
      expect(t.description).not.toMatch(/NEEDS_CONFIRMATION|marks would be lost|confirm_token/);
    }
    expect(tool(PLAN, 'select_trade').description).toBe('Choose the trade the trainer named, in any language or phrasing. Returns its batches.');
    expect(tool(PLAN, 'go_back').description).toBe('Go back to trade selection or batch selection. To fix one student use set_student_status instead.');
    expect(Object.keys(tool(PLAN, 'mark_remaining').parameters!.properties)).toContain('confirm_token');
    expect(Object.keys(tool(PLAN, 'submit_attendance').parameters!.properties)).toContain('confirm_token');
  });
  it('the confirmation code may come from a result that asked the submit question up front (Task 23)', () => {
    const code = 'The confirmation code from the latest result that asked this question (NEEDS_CONFIRMATION, or an instruction that gives the code). Pass it only after the trainer clearly said yes to that question.';
    expect(tool(PLAN, 'submit_attendance').parameters!.properties.confirm_token.description).toBe(code);
    expect(tool(PLAN, 'mark_remaining').parameters!.properties.confirm_token.description).toBe(code);
    expect(tool(PLAN, 'submit_attendance').description).toBe(
      'Submit the attendance for the batch. Final: it locks the record. Returns NEEDS_CONFIRMATION with the counts first (the screen shows the review), unless an earlier result already asked to submit and gave its confirm_token; call it with the confirm_token only after a clear yes. Also call it when the trainer says that is all ("bas", "aur koi nahi").',
    );
  });
  it('argument-less tools declare no parameters; navigate offers the plan targets', () => {
    expect(tool(PLAN, 'get_status').parameters).toBeUndefined();
    expect(tool(PLAN, 'end_voice_session').parameters).toBeUndefined();
    expect(tool(PLAN, 'navigate').parameters!.properties.to.enum).toEqual(['home', 'reports', 'my_attendance', 'offline', 'announcements']);
    expect(tool(PLAN, 'go_back').parameters!.properties.to.enum).toEqual(['trade', 'batch']);
  });

  it('the principal (D-139): no marking tool, only today\'s state, reports, staff, the screens, announcements and the end', () => {
    const declared = buildTools(PRINCIPAL_PLAN);
    expect(declared.map((t) => t.name)).toEqual([
      'get_status', 'get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register',
      'get_staff_today', 'mark_staff', 'navigate', 'get_announcements', 'end_voice_session',
    ]);
    expect(declared.every((t) => t.behavior === 'BLOCKING')).toBe(true);
    const nav = declared.find((t) => t.name === 'navigate')!;
    expect(nav.parameters!.properties.to.enum).toEqual(['home', 'attendance', 'reports', 'staff_attendance', 'announcements']);
    expect(nav.description).toBe('Open a screen the trainer asks for: Home, Attendance, Reports, Staff attendance or Announcements.');
    expect(declared.find((t) => t.name === 'get_status')!.description).toMatch(/^Today's attendance at the institute/);
    expect(JSON.stringify(declared)).not.toMatch(/select_batch|select_trade|get_trades|mark_my_attendance/);
    expect(declared.filter((t) => JSON.stringify(t).includes('confirm_token')).map((t) => t.name)).toEqual(['mark_staff']); // the one write asks first
  });
  it('own and staff attendance (D-141): declared only with their capability; mark_staff takes the person, a state status and a code', () => {
    const own = buildTools(voicePlan(PLAN)).map((t) => t.name);
    expect(own).toEqual(expect.arrayContaining(['get_my_attendance', 'mark_my_attendance']));
    expect(own).not.toEqual(expect.arrayContaining([expect.stringMatching(/get_staff_today|mark_staff/)]));
    expect(tool(PLAN, 'mark_my_attendance').parameters).toBeUndefined();
    expect(tool(PLAN, 'mark_my_attendance').description).toContain('runs the same check as the screen');
    expect(buildTools(voicePlan(PLAN, { ...CAPS, selfAttendance: false })).map((t) => t.name)).not.toEqual(expect.arrayContaining([expect.stringMatching(/my_attendance$/)]));
    const mark = buildTools(PRINCIPAL_PLAN).find((t) => t.name === 'mark_staff')!;
    expect(mark.parameters!.required).toEqual(['staff', 'status']);
    expect(mark.parameters!.properties.status.enum).toEqual(['PRESENT', 'ABSENT']);
    expect(Object.keys(mark.parameters!.properties)).toEqual(['staff', 'status', 'confirm_token']);
    const noMarking = buildTools({ ...PRINCIPAL_PLAN, capabilities: { ...PRINCIPAL_PLAN.capabilities, staffMarking: false, staffStatuses: [] } }).map((t) => t.name);
    expect(noMarking).not.toEqual(expect.arrayContaining([expect.stringMatching(/staff_today|mark_staff/)]));
  });
  it('report tools (D-140): read-only, declared only with reports; download_register only with the download', () => {
    const report = (n: string) => tool(PLAN, n);
    expect(report('get_reports_overview').parameters).toBeUndefined();
    expect(report('get_reports_overview').description).toContain("the trainer's batches");
    expect(buildTools(PRINCIPAL_PLAN).find((t) => t.name === 'get_reports_overview')!.description).toContain('every batch of the institute');
    expect(report('get_batch_report').parameters!.required).toEqual(['batch']);
    expect(report('get_student_report').parameters!.required).toEqual(['student']);
    expect(Object.keys(report('get_student_report').parameters!.properties)).toEqual(['student', 'batch']);
    expect(report('get_at_risk').parameters!.required).toBeUndefined();
    expect(report('show_report').parameters).toBeUndefined();
    expect(report('download_register').parameters!.properties.month.enum).toEqual(['THIS_MONTH', 'LAST_MONTH']);
    // the month defaults to this month (the handler's own default), so it is optional, as the prompt says
    expect(report('download_register').parameters!.required).toEqual(['target']);
    expect(report('download_register').parameters!.properties.month.description).toBe('Which month: this month (to date; the default when the trainer does not say) or last month');
    const reportNames = ['get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register'];
    expect(buildTools(voicePlan(PLAN, { ...CAPS, reports: null, downloads: false })).map((t) => t.name)).not.toEqual(expect.arrayContaining([expect.stringMatching(new RegExp(reportNames.join('|')))]));
    const noPdf = buildTools(voicePlan(PLAN, { ...CAPS, downloads: false })).map((t) => t.name);
    expect(noPdf).toContain('get_at_risk');
    expect(noPdf).not.toContain('download_register');
    expect(JSON.stringify(reportNames.map(report))).not.toMatch(/confirm_token/);
  });
  it('report tools follow the report sections the screen has: batches, at-risk, the institute headline', () => {
    const declared = (reportSections: { batches: boolean; atRisk: boolean; institute: boolean }, downloads = reportSections.batches) =>
      buildTools(voicePlan(PLAN, { ...CAPS, reportSections, downloads })).map((t) => t.name).filter((n) => /report|at_risk|register/.test(n));
    expect(declared({ batches: true, atRisk: true, institute: false })).toEqual(['get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register']);
    expect(declared({ batches: true, atRisk: false, institute: false })).toEqual(['get_reports_overview', 'get_batch_report', 'get_student_report', 'show_report', 'download_register']);
    expect(declared({ batches: false, atRisk: true, institute: false })).toEqual(['get_student_report', 'get_at_risk', 'show_report']);
    const principal = (reportSections: { batches: boolean; atRisk: boolean; institute: boolean }) =>
      buildTools({ ...PRINCIPAL_PLAN, capabilities: { ...PRINCIPAL_PLAN.capabilities, reportSections, downloads: reportSections.batches } });
    const headline = principal({ batches: true, atRisk: true, institute: true }).find((t) => t.name === 'get_reports_overview')!;
    expect(headline.description).toContain("with the institute's average and staff presence");
    const noHeadline = principal({ batches: true, atRisk: true, institute: false }).find((t) => t.name === 'get_reports_overview')!;
    expect(noHeadline.description).toContain('every batch of the institute');
    expect(noHeadline.description).not.toContain("institute's average");
    expect(principal({ batches: false, atRisk: false, institute: true }).map((t) => t.name).filter((n) => /report|at_risk|register/.test(n))).toEqual(['get_reports_overview', 'show_report']);
  });
  it('get_reports_overview\'s description names students at risk only with the at-risk section (fix round 1)', () => {
    const overview = (reportSections: { batches: boolean; atRisk: boolean; institute: boolean }) =>
      buildTools(voicePlan(PLAN, { ...CAPS, reportSections })).find((t) => t.name === 'get_reports_overview')!.description;
    expect(overview({ batches: true, atRisk: true, institute: false })).toBe(
      'The attendance report of the trainer\'s batches: each batch\'s average over the report window, students at risk, this month against last month. Use it for "how are my batches doing?", "report batao", "how is the institute doing?".',
    );
    expect(overview({ batches: true, atRisk: false, institute: false })).toBe(
      'The attendance report of the trainer\'s batches: each batch\'s average over the report window, this month against last month. Use it for "how are my batches doing?", "report batao", "how is the institute doing?".',
    );
    const principal = (reportSections: { batches: boolean; atRisk: boolean; institute: boolean }) =>
      buildTools({ ...PRINCIPAL_PLAN, capabilities: { ...PRINCIPAL_PLAN.capabilities, reportSections, downloads: reportSections.batches } }).find((t) => t.name === 'get_reports_overview')!.description;
    expect(principal({ batches: true, atRisk: true, institute: true })).toMatch(/students at risk/);
    expect(principal({ batches: true, atRisk: false, institute: true })).not.toMatch(/at risk/);
    expect(principal({ batches: false, atRisk: false, institute: true })).not.toMatch(/at risk|each batch's average/);
  });
  it('get_trades is not needed at the start: the first [APP] message already names the trades', () => {
    const trades = tool(PLAN, 'get_trades').description;
    expect(trades).not.toMatch(/call it at the start/i);
    expect(trades).toBe('List the trades of this institute with their ids. Not needed at the start: the first [APP] message already names the trades to ask about. Use it when the trainer asks which trades there are.');
  });
  it('navigate names every screen of the plan; get_announcements exists only with announcements', () => {
    expect(tool(PLAN, 'navigate').description).toBe('Open a screen the trainer asks for: Home, Reports, My attendance, Offline data or Announcements. Never use it to choose a trade or batch.');
    expect(tool(PLAN, 'get_announcements').parameters).toBeUndefined();
    const quiet = buildTools(voicePlan(PLAN, { ...CAPS, announcements: false, navTargets: ['home', 'reports'] })).map((t) => t.name);
    expect(quiet).not.toContain('get_announcements');
  });
});

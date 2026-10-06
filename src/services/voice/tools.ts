/**
 * Tool declarations sent in the Live setup (voice design §7, D-081, D-139). Built per session from the voice plan:
 * the marking tools from its marking plan (none where nobody marks batches), the rest from its capabilities, so a
 * feature that is switched off has no tool. Every declaration is BLOCKING: the 3.8 Live model defaults
 * to non-blocking and would say the next name before the app has answered. Descriptions are ported from
 * MVP-04 (the per-tool sections) with KSK names. Model-facing text is English.
 * Pure TypeScript: no I/O, no framework.
 */
import type { FlowPlan, VoicePlan } from '@/domain/voice/plan';
import { toModelStatus } from '@/domain/voice/types';
import { screenNames } from './screens';

export type ToolName =
  | 'get_trades' | 'select_trade' | 'select_batch' | 'start_roll_call' | 'mark_attendance' | 'set_student_status'
  | 'skip_student' | 'mark_remaining' | 'go_back' | 'get_status' | 'verify_again' | 'navigate' | 'get_announcements'
  | 'get_reports_overview' | 'get_batch_report' | 'get_student_report' | 'get_at_risk' | 'show_report' | 'download_register'
  | 'get_my_attendance' | 'mark_my_attendance' | 'get_staff_today' | 'mark_staff' | 'mark_remaining_staff' | 'get_staff_report'
  | 'submit_attendance' | 'end_voice_session';

export const TOOL_NAMES: readonly ToolName[] = [
  'get_trades', 'select_trade', 'select_batch', 'start_roll_call', 'mark_attendance', 'set_student_status',
  'skip_student', 'mark_remaining', 'go_back', 'get_status', 'verify_again', 'navigate', 'get_announcements',
  'get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register',
  'get_my_attendance', 'mark_my_attendance', 'get_staff_today', 'mark_staff', 'mark_remaining_staff', 'get_staff_report',
  'submit_attendance', 'end_voice_session',
];

export interface ToolParam { readonly type: 'STRING' | 'INTEGER'; readonly description: string; readonly enum?: readonly string[] }
export interface ToolDeclaration {
  readonly name: ToolName;
  readonly description: string;
  readonly behavior: 'BLOCKING';
  readonly parameters?: { readonly type: 'OBJECT'; readonly properties: Readonly<Record<string, ToolParam>>; readonly required?: readonly string[] };
}

/** The tool contract (MVP-04 §2.7): every handler returns this; the model receives it wrapped as { output }. Defined here so the transport (Task 15) and the executor (Task 13) share it. */
export interface ToolResult { readonly ok: boolean; readonly instruction: string; readonly error?: string; readonly [key: string]: unknown }
export interface ToolCall { readonly id?: string; readonly name?: string; readonly args?: Record<string, unknown> }

const LEAVE_TYPES = ['SICK', 'CASUAL', 'MEDICAL'] as const;

/** `required` is left out when empty (submit_attendance requires nothing). */
const obj = (properties: Record<string, ToolParam>, required: readonly string[]): NonNullable<ToolDeclaration['parameters']> =>
  required.length ? { type: 'OBJECT', properties, required } : { type: 'OBJECT', properties };

const CONFIRM_TOKEN: ToolParam = {
  type: 'STRING',
  description: 'The confirmation code from the latest result that asked this question (NEEDS_CONFIRMATION, or an instruction that gives the code). Pass it only after the trainer clearly said yes to that question.',
};

const tool = (name: ToolName, description: string, parameters?: ToolDeclaration['parameters']): ToolDeclaration =>
  parameters ? { name, description, behavior: 'BLOCKING', parameters } : { name, description, behavior: 'BLOCKING' };

/** The tools every voice plan may have: the screens, today's notices and the end of voice. */
function capabilityTools(voice: VoicePlan): { navigate: ToolDeclaration; announcements: ToolDeclaration | false; end: ToolDeclaration } {
  const targets = voice.capabilities.navTargets;
  return {
    navigate: tool(
      'navigate',
      `Open a screen the trainer asks for: ${screenNames(targets)}.${voice.marking ? ' Never use it to choose a trade or batch.' : ''}`,
      obj({ to: { type: 'STRING', enum: targets, description: 'The screen to open' } }, ['to']),
    ),
    announcements: voice.capabilities.announcements && tool(
      'get_announcements',
      "Today's notices (announcements) for the trainer: the title and dates of each, at most three. Use it when the trainer asks about notices, announcements, holidays or news.",
    ),
    end: tool('end_voice_session', 'End Voice Agent when the trainer asks to stop talking to you or wants to use the screen. The attendance marked so far stays on screen and is kept.'),
  };
}

/** What download_register's target names: a batch or a trade (the batches section), "staff" (the staff section, D-156). */
function registerTarget(sections: VoicePlan['capabilities']['reportSections']): string {
  const batch = 'Batch id or spoken batch label ("Electrician shift 1 unit 2"), or a trade name for the whole trade\'s register';
  if (!sections.staff) return batch;
  return sections.batches ? `${batch}, or "staff" for the staff register` : '"staff" for the staff register';
}

/**
 * The report tools (D-140), with reports on: read-only figures the app works out, and show_report for the screen.
 * Each answer tool only with the Reports section it answers from (the batches, the at-risk students, the institute
 * headline); download_register only with the register download (reports.pdfDownload, in the batches section).
 */
function reportTools(voice: VoicePlan): (ToolDeclaration | false)[] {
  const scope = voice.capabilities.reports;
  if (!scope) return [];
  const sections = voice.capabilities.reportSections;
  const batch: ToolParam = { type: 'STRING', description: 'Batch id from a report result, or the spoken label such as "Electrician shift 1 unit 2"' };
  const staffFigure = sections.staff ? 'this month\'s staff attendance' : 'staff presence';
  const headline = sections.institute ? `, with the institute's average and ${staffFigure}` : '';
  const mine = scope === 'institute' ? `every batch of the institute${headline}` : 'the trainer\'s batches';
  // the overview's parts as the screen has them: no batch averages without the batches, no at-risk without that section
  const overview = [sections.batches && 'each batch\'s average over the report window', sections.atRisk && 'students at risk', 'this month against last month'];
  return [
    (sections.batches || sections.institute) && tool(
      'get_reports_overview',
      `The attendance report of ${mine}: ${overview.filter(Boolean).join(', ')}. Use it for "how are my batches doing?", "report batao", "how is the institute doing?".`,
    ),
    sections.batches && tool(
      'get_batch_report',
      'One batch\'s report: its average, the five lowest and three highest students with their percentage and days, the students at risk, this month against last month. Use it for "how is shift 1 unit 2 doing?", "sabse kam attendance kiski hai?".',
      obj({ batch }, ['batch']),
    ),
    (sections.batches || sections.atRisk) && tool(
      'get_student_report',
      'One student\'s attendance: percentage, days present of days marked, whether at risk, the last absences. Use it for "Rahul ki attendance kitni hai?", "how is roll 5 doing?".',
      obj({
        student: { type: 'STRING', description: 'Student name or roll number as spoken (add the father name if the name repeats)' },
        batch: { ...batch, description: `Only when the trainer names the batch. ${batch.description}` },
      }, ['student']),
    ),
    sections.atRisk && tool(
      'get_at_risk',
      'Students at risk of not being eligible: below the attendance threshold over the report window, lowest first. Use it for "kaun at risk hai?", "who may not be eligible?". Without a batch: every batch.',
      obj({ batch: { ...batch, description: `Only when the trainer names the batch. ${batch.description}` } }, []),
    ),
    sections.staff && tool(
      'get_staff_report',
      'This month\'s staff attendance report: the institute\'s staff attendance %, the five lowest staff with their %, how many are below the threshold and how many are not marked today. Use it for "how is staff attendance this month?", "staff ki attendance kaisi hai?".',
    ),
    tool('show_report', 'Show on the screen the report you just answered from. Call it only after the trainer said yes to seeing it.'),
    voice.capabilities.downloads && tool(
      'download_register',
      `Open the monthly attendance register on the screen, ready to download, for ${[sections.batches && 'one batch or a whole trade', sections.staff && 'all staff'].filter(Boolean).join(', or ')}, this month or last month. The trainer then taps Download.`,
      obj({
        target: { type: 'STRING', description: registerTarget(sections) },
        month: { type: 'STRING', enum: ['THIS_MONTH', 'LAST_MONTH'], description: 'Which month: this month (to date; the default when the trainer does not say) or last month' },
      }, ['target']),
    ),
  ];
}

/**
 * Own attendance (D-141), with selfAttendance: read it, or mark it through the screen's own check. Staff attendance,
 * with staffMarking (the principal): today's counts, and one person marked after a confirmation code.
 */
function attendanceTools(voice: VoicePlan): (ToolDeclaration | false)[] {
  const caps = voice.capabilities;
  const codes = caps.staffStatuses.map(toModelStatus);
  return [
    caps.selfAttendance && tool(
      'get_my_attendance',
      'The trainer\'s own attendance: whether it is marked today, and this month\'s present days and percentage. Use it for "meri attendance kitni hai?", "am I marked today?".',
    ),
    caps.selfAttendance && tool(
      'mark_my_attendance',
      'Mark the trainer\'s own attendance for today ("mark my attendance", "meri attendance lagao"). The app opens My attendance, runs the same check as the screen (location, face) where one is set, and marks it present when the check passes. It says when it is already marked.',
    ),
    caps.staffMarking && tool(
      'get_staff_today',
      'Staff attendance today: how many staff are marked, by status, and who is not marked yet (at most five named, "you" first for the principal). Use it for "staff ki hajeri", "who has not marked attendance?".',
    ),
    caps.staffMarking && codes.length > 0 && tool(
      'mark_staff',
      'Mark one staff member who has no attendance today, the principal included ("mark me present": staff "me"). Returns NEEDS_CONFIRMATION first; call again with the confirm_token only after a clear yes. A mark the person made themselves is never changed.',
      obj({
        staff: { type: 'STRING', description: 'The staff member\'s name as spoken, or "me" for the principal themselves' },
        status: { type: 'STRING', enum: codes, description: `Attendance status: ${codes.join(', ')}` },
        confirm_token: CONFIRM_TOKEN,
      }, ['staff', 'status']),
    ),
    caps.staffMarking && codes.length > 0 && tool(
      'mark_remaining_staff',
      'Mark every staff member not marked yet today with one status ("mark everyone else present", "baaki sab staff present"). For "everyone present except Pradeep" first mark Pradeep with mark_staff, then call this. Returns NEEDS_CONFIRMATION first; call again with the confirm_token only after a clear yes.',
      obj({
        status: { type: 'STRING', enum: codes, description: `Attendance status: ${codes.join(', ')}` },
        confirm_token: CONFIRM_TOKEN,
      }, ['status']),
    ),
  ];
}

export function buildTools(voice: VoicePlan): ToolDeclaration[] {
  const caps = capabilityTools(voice);
  const plan = voice.marking;
  const tools: (ToolDeclaration | false)[] = plan
    ? markingTools(plan, caps, [...reportTools(voice), ...attendanceTools(voice)])
    : [
        tool('get_status', "Today's attendance at the institute: batches submitted of the total, and staff not marked yet. Use it when the trainer asks how today is going, and after a reconnect."),
        ...reportTools(voice),
        ...attendanceTools(voice),
        caps.navigate,
        caps.announcements,
        caps.end,
      ];
  return tools.filter((t): t is ToolDeclaration => t !== false);
}

function markingTools(plan: FlowPlan, caps: ReturnType<typeof capabilityTools>, extra: readonly (ToolDeclaration | false)[]): (ToolDeclaration | false)[] {
  const codes = plan.statuses.map(toModelStatus);
  const status: ToolParam = { type: 'STRING', enum: codes, description: `Attendance status: ${codes.join(', ')}` };
  // The extra input of half day and leave, declared only where the state uses it.
  const details: Record<string, ToolParam> = {
    ...(plan.details.half
      ? { half: { type: 'STRING', enum: ['first', 'second'], description: 'HALF_DAY only: which half the student was there ("pehla half", "lunch ke baad" = second)' } }
      : {}),
    ...(plan.details.leaveType
      ? { leave_type: { type: 'STRING', enum: LEAVE_TYPES, description: `LEAVE only: the kind of leave (${LEAVE_TYPES.join(', ')})` } }
      : {}),
    ...(plan.details.leaveDays
      ? { leave_days: { type: 'INTEGER', description: 'LEAVE only, when the trainer says how long: days of leave counting today (1 = only today)' } }
      : {}),
  };
  const heard: ToolParam = { type: 'STRING', description: 'What the trainer actually said, verbatim' };

  return [
    plan.tradeStep && tool(
      'get_trades',
      'List the trades of this institute with their ids. Not needed at the start: the first [APP] message already names the trades to ask about. Use it when the trainer asks which trades there are.',
    ),
    plan.tradeStep && tool(
      'select_trade',
      'Choose the trade the trainer named, in any language or phrasing. Returns its batches.',
      obj({ trade: { type: 'STRING', description: 'Trade id from get_trades, or the trade name as spoken' } }, ['trade']),
    ),
    tool(
      'select_batch',
      `Choose a batch, half or period${plan.tradeStep ? ' of the selected trade' : ''} and start marking: a roll call (it returns the first student to call) or, where everyone starts present, by exception (ask who is not).`,
      obj({
        batch: { type: 'STRING', description: 'Batch id from the last tool result, or the spoken label such as "shift 1 unit 2"' },
      }, ['batch']),
    ),
    plan.rollCallSwitch && tool(
      'start_roll_call',
      'Call every student by name, one by one, instead of asking only who is not present ("naam se bulao", "ek ek karke bulao", "call the names"). Students the trainer already marked are not called again.',
    ),
    tool(
      'mark_attendance',
      'Record the status of the CURRENT student and move to the next one. Use only right after the trainer answers for the student you just called. To change anyone else use set_student_status.',
      obj({ student_id: { type: 'STRING', description: 'id of the current student, exactly as in the last tool result' }, status, ...details, heard }, ['student_id', 'status']),
    ),
    tool(
      'set_student_status',
      'Change the status of any student in the batch: corrections ("Rahul absent tha"), "the last one was wrong" (use last_marked), or several students named at once (one call each).',
      obj({
        student: { type: 'STRING', description: 'Student id, roll number or name (add the father name if the name repeats)' },
        status,
        ...details,
        heard,
      }, ['student', 'status']),
    ),
    tool(
      'skip_student',
      'Skip the current student for now ("skip", "baad mein"). They are asked again later.',
      obj({ student_id: { type: 'STRING', description: 'id of the current student' } }, ['student_id']),
    ),
    tool(
      'mark_remaining',
      'Mark every student not yet marked with one status ("baaki sab present"). For "sab present, sirf Rahul absent" first mark the named students with set_student_status, then call this for the rest. Returns NEEDS_CONFIRMATION first; call again with the confirm_token only after a clear yes.',
      obj({ status, confirm_token: CONFIRM_TOKEN }, ['status']),
    ),
    tool(
      'go_back',
      'Go back to trade selection or batch selection. To fix one student use set_student_status instead.',
      obj({
        to: { type: 'STRING', enum: plan.tradeStep ? ['trade', 'batch'] : ['batch'], description: 'Where to go back to' },
      }, ['to']),
    ),
    tool('get_status', 'Where we are: step, counts, who is left, the current student. Use it for "kitne bache?" and after a reconnect.'),
    plan.verification.required && tool('verify_again', 'Run the location / face check again when the trainer asks ("phir se check karo", "check again") after it failed.'),
    ...extra,
    caps.navigate,
    caps.announcements,
    tool(
      'submit_attendance',
      'Submit the attendance for the batch. Final: it locks the record. Returns NEEDS_CONFIRMATION with the counts first (the screen shows the review), unless an earlier result already asked to submit and gave its confirm_token; call it with the confirm_token only after a clear yes. Also call it when the trainer says that is all ("bas", "aur koi nahi").',
      obj({ confirm_token: CONFIRM_TOKEN }, []),
    ),
    caps.end,
  ];
}

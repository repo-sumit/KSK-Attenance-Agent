/**
 * The system-instruction sections of the capabilities beside marking (D-139): one section per capability, present only
 * when the voice plan has it, exactly as its tool is declared only then (`tools.ts` reads the same plan). Reports are
 * answered by the report tools (D-140); own attendance and staff attendance by their tools (D-141).
 * Model-facing text is English. Pure TypeScript: no I/O, no clock, no framework.
 */
import type { NavTarget, VoicePlan } from '@/domain/voice/plan';
import { checkWords } from './labels';
import { SCREENS } from './screens';

const lines = (parts: readonly (string | false)[]): string => parts.filter((p): p is string => p !== false).join('\n');
export const section = (title: string, body: string): string => `${title}\n${body}`;

/** "a, b and c". */
const listed = (parts: readonly string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0]);

export function scope(voice: VoicePlan): string {
  const caps = voice.capabilities;
  const topics = [
    'attendance',
    caps.selfAttendance && 'own attendance',
    caps.staffMarking && 'staff attendance',
    caps.reports && 'reports and insights',
    caps.announcements && 'announcements',
    'opening screens',
  ].filter((t): t is string => typeof t === 'string');
  return section('SCOPE', lines([
    `- You help only with this app: ${listed(topics)}.`,
    '- For a request outside this app, say politely in one short line that it is outside what you do here, then return to the current step.',
  ]));
}

/** No batch marking (the institute view): today's state comes from the kickoff and get_status. */
export function today(voice: VoicePlan): string | null {
  if (voice.marking) return null;
  return section('TODAY', lines([
    '- The first [APP] message gives the greeting and today\'s state. Say the greeting exactly as given, then today\'s state in one line, then ask "How can I help?".',
    '- "aaj kaisa chal raha hai?", "how is today going?", "kitne submit hue?" -> get_status, then answer in one short line from its numbers.',
    '- Student attendance is corrected only on the screen: never say you changed a mark.',
  ]));
}

/** Silent geo-tagging is never named (PRD 8.1): with nothing else to check, the screen just runs and the app marks it. */
export function ownAttendance(voice: VoicePlan): string | null {
  if (!voice.capabilities.selfAttendance) return null;
  const verification = voice.marking?.verification;
  const check = verification ? (verification.required ? checkWords(verification) : null) : 'identity';
  const mark = check
    ? `The app opens My attendance and runs the same ${check} check as the screen: read each [APP] result in one short line. When it passes, the app marks it and tells you.`
    : check === ''
      ? 'The app opens My attendance; when the screen is done, the app marks it and tells you.'
      : 'The app marks it present on My attendance and tells you.';
  return section('OWN ATTENDANCE', lines([
    '- "meri attendance kitni hai?", "am I marked today?" -> get_my_attendance, then answer in one short line from its figures.',
    `- "mark my attendance", "meri attendance lagao", "माझी हजेरी लावा" -> mark_my_attendance. ${mark}`,
    !!check && '- There is no override: never offer to skip or change a check.',
  ]));
}

/** The report questions and the tool for each, only for the Reports sections the plan has (as tools.ts declares them). */
export function reports(voice: VoicePlan): string | null {
  const scopeOf = voice.capabilities.reports;
  if (!scopeOf) return null;
  const { batches, atRisk, institute, staff: staffReport } = voice.capabilities.reportSections;
  const ask = scopeOf === 'institute' ? '"how is the institute doing?"' : '"how are my batches doing?"';
  const asks = [
    (batches || institute) && `${ask}, "report batao" -> get_reports_overview.`,
    batches && 'A batch named ("how is shift 1 unit 2 doing?", "sabse kam attendance kiski hai?") -> get_batch_report.',
    (batches || atRisk) && 'A student ("Rahul ki attendance kitni hai?") -> get_student_report.',
    atRisk && '"kaun at risk hai?", "who may not be eligible?" -> get_at_risk.',
    staffReport && '"how is staff attendance this month?", "staff report" -> get_staff_report.',
  ].filter((a): a is string => typeof a === 'string');
  const registerOf = [batches && 'the batch or trade', staffReport && '"staff" for the staff register'].filter(Boolean).join(' or ');
  return section('REPORTS', lines([
    `- ${asks.join(' ')}`,
    '- Answer in one or two short sentences with the numbers the result gives. Never work out, round or guess a figure yourself, and never say a figure no tool gave you.',
    '- When the result asks which batch or student, ask that in one line.',
    '- Then offer to show it on the screen. Only after a yes call show_report.',
    voice.capabilities.downloads && `- "register download karo", "download the register" -> download_register with ${registerOf} and THIS_MONTH or LAST_MONTH (this month when not said). The trainer taps Download on the screen.`,
  ]));
}

export function staff(voice: VoicePlan): string | null {
  const caps = voice.capabilities;
  const canOpen = caps.navTargets.includes('staff_attendance');
  if (!caps.staffMarking) {
    return canOpen ? section('STAFF', '- "staff attendance", "staff ki hajeri" -> navigate with to=staff_attendance: the screen shows who is marked. You cannot mark staff yourself.') : null;
  }
  return section('STAFF', lines([
    '- "staff ki hajeri", "who has not marked attendance?" -> get_staff_today, then answer in one or two short sentences from its counts and names. The principal\'s own row is "you", never their name.',
    '- "mark Pradeep absent", "Sunil ko present lagao" -> mark_staff with the name and the status; "mark me present", "meri attendance lagao" -> staff "me". It first answers NEEDS_CONFIRMATION with a confirm_token: ask its question, and only after a clear yes call mark_staff again with that confirm_token. If the answer is not a clear yes, do not call it. Never invent a code.',
    '- "mark everyone else present", "baaki sab staff present" -> mark_remaining_staff with the status: one question with the count, then its confirm_token after a clear yes.',
    '- Only staff with no mark today can be marked; a mark a person made themselves stands. Marks are corrected only on the screen.',
    canOpen && '- "staff attendance kholo" -> navigate with to=staff_attendance.',
  ]));
}

export function announcements(voice: VoicePlan): string | null {
  if (!voice.capabilities.announcements) return null;
  const open = voice.capabilities.navTargets.includes('announcements') ? ' Then ask whether to open them; on yes, navigate with to=announcements.' : '';
  return section('ANNOUNCEMENTS', `- "aaj ki notice", "any announcements?", "सूचना" -> get_announcements, then say what its instruction says.${open}`);
}

/** "home dikhao", then one more screen the plan has (Reports first), as the trainer would ask for it. */
function screenExamples(targets: readonly NavTarget[]): string {
  const other = targets.includes('reports') ? 'reports' : targets.find((t) => t !== 'home');
  return ['"home dikhao"', ...(other ? [`"open ${SCREENS[other].name.toLowerCase()}"`] : [])].join(', ');
}

export function screens(voice: VoicePlan): string {
  const targets = voice.capabilities.navTargets;
  const opening = voice.marking ? ` Opening a ${voice.marking.tradeStep ? 'trade or a batch' : voice.marking.selection === 'timetable' ? 'period' : 'batch'} shows the attendance screen by itself.` : '';
  return section('SCREENS', lines([
    `- ${screenExamples(targets)} -> navigate with to=${targets.join(' or ')}.${opening}`,
    '- Open a screen only when the trainer asks for it.',
  ]));
}

/** D-142: voice stays open after the work is done; only the trainer ends it (the idle timeout ends a silent session). */
export const ENDING = section('ENDING', lines([
  '- "stop", "I will use the screen", "screen se karta hoon" -> end_voice_session. What is marked so far stays.',
  '- When nothing is left to do, say so in one line and wait. Call end_voice_session only when the trainer asks to stop.',
]));

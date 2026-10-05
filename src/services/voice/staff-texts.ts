/**
 * Texts of the own-attendance and staff tools (D-141): every figure, time and name is put in by the app, so the model
 * only says it. The trainer's own mark is saved only after the screen's own check passes (no override); a staff mark
 * is asked with a confirmation code first (D-082) and never replaces a mark the person made themselves.
 * Model-facing text is English; names pass through `nameText` (data, never instructions).
 * Tuned against the live model: change wording only with a rehearsal (`npm run test:voice-live`).
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import { nameText, word } from './labels';

/** The trainer's own record today, as get_my_attendance returns it. */
export type MyToday =
  | { readonly marked: false }
  | { readonly marked: true; readonly status: string; readonly by: 'SELF' | 'PRINCIPAL'; readonly time: string };

/** This month's own figures (ReportService.myAttendance): present days by presence weight, of the days with a record. */
export interface MyMonth {
  readonly present_days: number;
  readonly marked_days: number;
  readonly pct: number | null;
}

/** "marked present at 10:15 am" / "marked absent by the principal". */
function todayText(today: MyToday): string {
  if (!today.marked) return 'not marked yet';
  return `marked ${word(today.status)} ${today.by === 'SELF' ? `at ${today.time}` : `by the principal at ${today.time}`}`;
}

/** get_my_attendance: today and this month in one or two short sentences; an unmarked day can be marked by voice. */
export function myAttendanceInstruction(today: MyToday, month: MyMonth, canMark: boolean): string {
  const figures =
    month.pct === null || !month.marked_days
      ? 'This month: no days recorded yet.'
      : `This month: present on ${month.present_days} of ${month.marked_days} marked days (${month.pct}%).`;
  const offer = !today.marked && canMark ? ' If they want it marked now, call mark_my_attendance.' : '';
  return `Today: ${todayText(today)}. ${figures} Answer in one or two short sentences with these figures.${offer}`;
}

export const alreadyMineInstruction = (status: string, time: string): string =>
  `The trainer's own attendance is already marked ${word(status)} today (at ${time}). Say so in one short line.`;

export const selfMarkedInstruction = (time: string): string => `The trainer's own attendance is marked present at ${time}. Say so in one short line.`;

/**
 * The check runs on My attendance (`words`: "location and face", "location" or "face"; "" when nothing is named, such as
 * silent geo-tagging alone, PRD 8.1: then only the screen is mentioned).
 */
export const selfCheckInstruction = (words: string): string =>
  words
    ? `The ${words} check for the trainer's own attendance is on the screen now. Say in one short line: please follow the screen. Then wait for the next [APP] message; the app marks it when the check passes.`
    : 'My attendance is open on the screen. Say in one short line: please follow the screen. Then wait for the next [APP] message; the app marks it when the screen is done.';

export const selfPassedEvent = (time: string): string => `[APP] The check passed and the trainer's own attendance is marked present at ${time}. Say so in one short line.`;

/** The save after a pass did not go through (the day is shut, or the check is no longer valid): nothing is marked. */
export const SELF_NOT_SAVED =
  "The trainer's own attendance could not be marked now, and nothing was saved. Say so in one short line; they can try again on the My attendance screen or ask the principal.";

/** Staff today, as get_staff_today returns it. */
export interface StaffDay {
  readonly total: number;
  readonly marked: number;
  /** By status, in the state's order (upper case). */
  readonly counts: Readonly<Record<string, number>>;
  /** Not marked yet, at most five named. */
  readonly names: readonly string[];
  readonly notMarked: number;
}

/** get_staff_today: the counts, then who is not marked yet, then whether to mark anyone. */
export function staffTodayInstruction(d: StaffDay): string {
  const byStatus = Object.entries(d.counts).map(([status, n]) => `${n} ${word(status)}`).join(', ');
  const more = d.notMarked - d.names.length;
  const who = d.names.map(nameText).join(', ');
  const rest = d.notMarked ? `${d.notMarked} not marked yet: ${who}${more > 0 ? ` and ${more} more` : ''}` : 'everyone is marked';
  const ask = d.notMarked ? ', then ask whether to mark anyone' : '';
  return `Staff today: ${d.total} in all; ${d.marked} marked (${byStatus}); ${rest}. Answer in one or two short sentences with these counts and names${ask}.`;
}

/** mark_staff without a valid code: the question, with the code for one clear yes. */
export function confirmStaffInstruction(name: string, status: string, token: string): string {
  const who = nameText(name);
  return `In one line, ask whether to mark ${who} ${word(status)} for today, saying it is final for today (for example "Mark ${who} ${word(status)} for today? It is final."). Call mark_staff with confirm_token "${nameText(token)}" only after a clear yes.`;
}

/** A staff member who already has a record today: their own mark stands; the principal's is final too. */
export function staffAlreadyInstruction(name: string, status: string, source: 'self' | 'principal', time: string): string {
  const how = source === 'self' ? `they marked it themselves at ${time}, and their own mark stands` : `the principal marked it at ${time}`;
  return `${nameText(name)} is already marked ${word(status)} today: ${how}. Say so in one short line.`;
}

/** markByPrincipal saved nothing (and no self-mark explains it): nothing changed. */
export const STAFF_NOT_SAVED =
  'The mark could not be saved, and nothing changed. Say so in one short line; the principal can mark it on the staff screen.';

export function staffMarkedInstruction(name: string, status: string, notMarked: number): string {
  const left = notMarked ? `${notMarked} staff not marked yet.` : 'Every staff member is marked now.';
  return `${nameText(name)} is marked ${word(status)} for today. ${left} Say so in one short line.`;
}

/** "a, b or c". */
const either = (parts: readonly string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}` : (parts[0] ?? ''));

export const staffStatusInstruction = (statuses: readonly string[]): string => `Staff can be marked ${either(statuses)}. Ask which one in one short line.`;

export const staffNotFoundInstruction = (heard: string): string =>
  `No staff member here is called "${nameText(heard)}". Ask the trainer to say the name again in one short line.`;

export const staffAmbiguousInstruction = (heard: string, names: readonly string[]): string =>
  `"${nameText(heard)}" could mean ${either(names.map(nameText))}. Ask which one in one short line.`;

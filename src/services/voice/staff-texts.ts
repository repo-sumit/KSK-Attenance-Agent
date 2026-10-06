/**
 * Texts of the own-attendance and staff tools (D-141): every figure, time and name is put in by the app, so the model
 * only says it. The trainer's own mark is saved only after the screen's own check passes (no override); a staff mark
 * is asked with a confirmation code first (D-082) and never replaces a mark the person made themselves.
 * Model-facing text is English; names pass through `nameText` (data, never instructions).
 * Tuned against the live model: change wording only with a rehearsal (`npm run test:voice-live`).
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import { checkLine, nameText, word, type CheckWords } from './labels';

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

/** `next`: the lead-on to the students in the same turn (D-152, ./kickoff leadOn), or ''. */
export const selfMarkedInstruction = (time: string, next = ''): string =>
  `The trainer's own attendance is marked present at ${time}. Say so in one short line.${next ? ` ${next}` : ''}`;

/** select_trade or select_batch while own attendance first (journey.staff.selfFirst, D-152) blocks every batch. */
export const SELF_FIRST_INSTRUCTION =
  'The trainer\'s own attendance is not marked today, and it must be marked before any student attendance. Say so in one short line ("Please mark your attendance first.") and ask whether to start it now. Then stop and wait: call mark_my_attendance only after the trainer says yes.';

/**
 * The check runs on My attendance (`words`: "location and face", "location" or "face"; "" when nothing is named, such as
 * silent geo-tagging alone, PRD 8.1: then only the screen is mentioned).
 */
export const selfCheckInstruction = (words: CheckWords | ''): string =>
  words
    ? `The ${words} check for the trainer's own attendance is on the screen now. Say in one short line, in the trainer's language: "${checkLine(words)}" Then stop and wait for the next [APP] message; the app marks it when the check passes.`
    : 'My attendance is open on the screen. Say in one short line: please follow the screen. Then wait for the next [APP] message; the app marks it when the screen is done.';

export const selfPassedEvent = (time: string, next = ''): string =>
  `[APP] The check passed and the trainer's own attendance is marked present at ${time}. Say so in one short line.${next ? ` ${next}` : ''}`;

/** The save after a pass did not go through (the day is shut, or the check is no longer valid): nothing is marked. */
export const SELF_NOT_SAVED =
  "The trainer's own attendance could not be marked now, and nothing was saved. Say so in one short line; they can try again on the My attendance screen or ask the principal.";

/**
 * A staff member as the staff texts name them (D-156): the principal's own row is "the principal's own attendance" to
 * the model and "you" when spoken, never their name in the third person.
 */
export interface StaffPerson {
  readonly name: string;
  readonly self: boolean;
}

/** Staff today, as get_staff_today returns it. */
export interface StaffDay {
  readonly total: number;
  readonly marked: number;
  /** By status, in the state's order (upper case). */
  readonly counts: Readonly<Record<string, number>>;
  /** Not marked yet, at most five named, the principal's own row first. */
  readonly names: readonly StaffPerson[];
  readonly notMarked: number;
}

const SAY_YOU = 'saying "you" (never their name)';

/** get_staff_today: the counts, then who is not marked yet ("you" first), then whether to mark anyone. */
export function staffTodayInstruction(d: StaffDay): string {
  const byStatus = Object.entries(d.counts).map(([status, n]) => `${n} ${word(status)}`).join(', ');
  const more = d.notMarked - d.names.length;
  const who = d.names.map((p) => (p.self ? 'you' : nameText(p.name))).join(', ');
  const rest = d.notMarked ? `${d.notMarked} not marked yet: ${who}${more > 0 ? ` and ${more} more` : ''}` : 'everyone is marked';
  const you = d.names.some((p) => p.self) ? ', saying "you" for the principal\'s own attendance (never their name)' : '';
  const ask = d.notMarked ? ', then ask whether to mark anyone' : '';
  return `Staff today: ${d.total} in all; ${d.marked} marked (${byStatus}); ${rest}. Answer in one or two short sentences with these counts and names${you}${ask}.`;
}

/** mark_staff without a valid code: the question, with the code for one clear yes. */
export function confirmStaffInstruction(person: StaffPerson, status: string, token: string): string {
  const s = word(status);
  const code = `Call mark_staff with confirm_token "${nameText(token)}" only after a clear yes.`;
  if (person.self) return `In one line, ask whether to mark the principal's own attendance ${s} for today, saying it is final for today (for example "Mark yourself ${s} for today? It is final."). ${code}`;
  const who = nameText(person.name);
  return `In one line, ask whether to mark ${who} ${s} for today, saying it is final for today (for example "Mark ${who} ${s} for today? It is final."). ${code}`;
}

/** A staff member who already has a record today: their own mark stands; the principal's is final too. */
export function staffAlreadyInstruction(person: StaffPerson, status: string, source: 'self' | 'principal', time: string): string {
  const how = source === 'self' ? `they marked it themselves at ${time}, and their own mark stands` : `the principal marked it at ${time}`;
  if (person.self) return `The principal's own attendance is already marked ${word(status)} today: ${how}. Say so in one short line, ${SAY_YOU}.`;
  return `${nameText(person.name)} is already marked ${word(status)} today: ${how}. Say so in one short line.`;
}

/** markByPrincipal saved nothing (and no self-mark explains it): nothing changed. */
export const STAFF_NOT_SAVED =
  'The mark could not be saved, and nothing changed. Say so in one short line; the principal can mark it on the staff screen.';

/** The principal is not on today's staff list ("mark me" has no row to mark). */
export const STAFF_SELF_MISSING = "The principal is not on today's staff list, so their own attendance cannot be marked here. Say so in one short line.";

/** After a save: the next person not marked yet, offered with a code of its own, so one clear yes marks them (D-156). */
export interface NextOffer {
  readonly person: StaffPerson;
  readonly status: string;
  readonly token: string;
}

/** The saved line as said: "Pradeep Gawde is marked absent." / "You are marked present." */
const savedSaid = (person: StaffPerson, status: string): string =>
  person.self ? `You are marked ${word(status)}.` : `${nameText(person.name)} is marked ${word(status)}.`;

function nextOffer(saved: StaffPerson, savedStatus: string, n: NextOffer): string {
  const s = word(n.status);
  const said = savedSaid(saved, savedStatus);
  const call = (staff: string) => `Call mark_staff with staff "${staff}", status ${n.status} and confirm_token "${nameText(n.token)}" only after a clear yes.`;
  if (n.person.self) {
    return `next is the principal's own attendance. Say in one short line that it is saved, then ask in one line whether to mark the principal ${s} too, saying it is final (for example "${said} Next is you. Mark yourself ${s} for today? It is final."). ${call('me')}`;
  }
  const who = nameText(n.person.name);
  return `next is ${who}. Say in one short line that it is saved, then ask in one line whether to mark ${who} ${s} too, saying it is final (for example "${said} Next is ${who}. Mark ${who} ${s} for today? It is final."). ${call(who)}`;
}

export function staffMarkedInstruction(person: StaffPerson, status: string, notMarked: number, next: NextOffer | null = null): string {
  const head = person.self ? `The principal's own attendance is marked ${word(status)} for today.` : `${nameText(person.name)} is marked ${word(status)} for today.`;
  if (!notMarked) return `${head} Every staff member is marked now. Say so in one short line.`;
  return next ? `${head} ${notMarked} staff not marked yet; ${nextOffer(person, status, next)}` : `${head} ${notMarked} staff not marked yet. Say so in one short line.`;
}

/** mark_remaining_staff without a valid code: one question for everyone not marked yet, with the count (D-156). */
export function confirmRestInstruction(count: number, status: string, includesYou: boolean, only: StaffPerson | null, token: string): string {
  const s = word(status);
  const code = `Call mark_remaining_staff with confirm_token "${nameText(token)}" only after a clear yes.`;
  if (count === 1 && only) {
    const example = only.self ? `"You are the last one. Mark yourself ${s} for today? It is final."` : `"${nameText(only.name)} is the last one. Mark ${nameText(only.name)} ${s} for today? It is final."`;
    return `In one line, ask whether to mark the last staff member not marked yet, ${only.self ? "the principal's own attendance" : nameText(only.name)}, ${s} for today, saying it is final (for example ${example}). ${code}`;
  }
  return `In one line, ask whether to mark the other ${count} staff not marked yet ${s} for today, saying it is final (for example "Mark the other ${count} staff ${s}${includesYou ? ', you included' : ''}? It is final."). ${code}`;
}

/** "a, b and c". */
const listed = (parts: readonly string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''));

/**
 * mark_remaining_staff saved: how many; anyone who marked themselves between the yes and the save keeps their own mark
 * (the principal's own, said as "you", D-156).
 */
export function restMarkedInstruction(saved: number, status: string, standing: readonly StaffPerson[], notMarked: number): string {
  const names = listed(standing.map((p) => (p.self ? 'the principal' : nameText(p.name))));
  const stood = standing.length ? `${names} marked their own attendance meanwhile, and ${standing.length === 1 ? 'it stands' : 'those marks stand'}` : '';
  const head = saved ? `${saved} staff ${saved === 1 ? 'is' : 'are'} marked ${word(status)} for today${stood ? `; ${stood}` : ''}` : `Nobody else was marked: ${stood}`;
  const you = standing.some((p) => p.self) ? ', saying "you" for the principal\'s own attendance (never their name)' : '';
  return `${head}. ${notMarked ? `${notMarked} staff not marked yet.` : 'Every staff member is marked now.'} Say so in one short line${you}.`;
}

/** mark_remaining_staff with nobody left to mark. */
export const NO_STAFF_LEFT = 'Every staff member is marked already. Say so in one short line.';

/** "a, b or c". */
const either = (parts: readonly string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} or ${parts.at(-1)}` : (parts[0] ?? ''));

export const staffStatusInstruction = (statuses: readonly string[]): string => `Staff can be marked ${either(statuses)}. Ask which one in one short line.`;

export const staffNotFoundInstruction = (heard: string): string =>
  `No staff member here is called "${nameText(heard)}". Ask the trainer to say the name again in one short line.`;

export const staffAmbiguousInstruction = (heard: string, names: readonly string[]): string =>
  `"${nameText(heard)}" could mean ${either(names.map(nameText))}. Ask which one in one short line.`;

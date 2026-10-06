/**
 * Staff attendance by voice (D-141, D-156), with `capabilities.staffMarking` (the principal): get_staff_today counts
 * today's staff as the staff screen does, mark_staff marks one person who has no record yet, and mark_remaining_staff
 * marks everyone not marked yet with one status, all through StaffAttendanceService.markByPrincipal (the same rules as
 * the screen's Save). Each first answers NEEDS_CONFIRMATION with a code issued here (D-082): bound to the person (or the
 * exact set of people not marked yet) and the status, today's staff records (any change voids it), this connection,
 * two minutes, and a trainer turn after the asking turn; a code is used once. The principal's own row is "you" (never
 * their name), and "me", "myself", "mujhe", "माझी" … name it. The staff screen opens on the question and outlines the
 * person asked about (focus_staff). After a save the next person not marked yet is offered by name with a code of its
 * own, so one clear yes marks them. A mark the person made themselves always stands: before the question, and when it
 * arrives between the yes and the save. A question still open when a goAway swap moves to a new connection (which voids
 * every code) is asked again with a code issued for the new connection (staffRefreshQuestion).
 * No browser globals.
 */
import { checkConfirm, issueConfirm, type ConfirmAction, type ConfirmNow, type ConfirmTicket } from '@/domain/voice/confirm';
import { resolveStudent } from '@/domain/voice/match';
import type { StatusCode } from '@/domain/status';
import { parseModelStatus, toModelStatus } from '@/domain/voice/types';
import { routes } from '@/lib/routes';
import type { StaffDayRow } from '@/services/staff-attendance';
import { clockTime, nameText } from '../labels';
import {
  confirmRestInstruction, confirmStaffInstruction, NO_STAFF_LEFT, restMarkedInstruction, STAFF_NOT_SAVED, STAFF_SELF_MISSING, staffAlreadyInstruction,
  staffAmbiguousInstruction, staffMarkedInstruction, staffNotFoundInstruction, staffStatusInstruction, staffTodayInstruction, type StaffPerson,
} from '../staff-texts';
import type { ToolResult } from '../tools';
import { fail, str, type BaseContext, type BaseHandler } from './base';

const MAX_NAMED = 5;

const isSelf = (h: BaseContext, row: StaffDayRow): boolean => row.member.id === h.deps.ctx.user.id;
const personOf = (h: BaseContext, row: StaffDayRow): StaffPerson => ({ name: row.member.name, self: isSelf(h, row) });
/** A person as results give them: the principal's own row is named "you", never by name. */
const who = (h: BaseContext, row: StaffDayRow) => (isSelf(h, row) ? { id: row.member.id, name: 'you', self: true } : { id: row.member.id, name: nameText(row.member.name) });

/** Not marked yet, in the staff list's order, with the principal's own row first. */
function unmarkedOf(h: BaseContext, rows: readonly StaffDayRow[]): StaffDayRow[] {
  const left = rows.filter((r) => !r.record);
  return [...left.filter((r) => isSelf(h, r)), ...left.filter((r) => !isSelf(h, r))];
}

export const getStaffToday: BaseHandler = async (h) => {
  const { ctx, staffAttendance } = h.deps;
  const rows = await staffAttendance.day(ctx);
  const counts = Object.fromEntries(ctx.journey.staff.statusSet.map((s) => [toModelStatus(s), rows.filter((r) => r.record?.status === s).length]));
  const unmarked = unmarkedOf(h, rows);
  const named = unmarked.slice(0, MAX_NAMED);
  const marked = rows.length - unmarked.length;
  return {
    ok: true,
    total: rows.length,
    marked,
    not_marked: unmarked.length,
    counts,
    not_marked_names: named.map((r) => who(h, r)),
    instruction: staffTodayInstruction({ total: rows.length, marked, counts, names: named.map((r) => personOf(h, r)), notMarked: unmarked.length }),
  };
};

/** What today's staff records are: a new record anywhere voids an open code (as a draft change voids a submit code). */
const revisionOf = (rows: readonly StaffDayRow[]): number => rows.filter((r) => r.record).length;

function confirmNow(h: BaseContext, action: ConfirmAction, argsKey: string, rows: readonly StaffDayRow[]): ConfirmNow {
  const d = h.deps;
  return { action, argsKey, revision: revisionOf(rows), now: d.nowMs(), speechSeq: d.speechSeq(), turnSeq: d.turnSeq(), spokeAtTurn: d.spokeAtTurn(), generation: d.generation() };
}

const issue = (h: BaseContext, now: ConfirmNow): ConfirmTicket => issueConfirm(now, [h.deps.entropy(), h.deps.entropy(), h.deps.entropy(), h.deps.entropy()]);
const oneKey = (staffId: string, status: StatusCode): string => `${staffId}|${status}`;
/** Everyone not marked yet, as a set: the code is for exactly these people. */
const restKey = (ids: readonly string[], status: StatusCode): string => `${[...ids].sort().join(',')}|${status}`;

/** A code for marking `row` with `status`, bound to today's staff records and this connection; kept as the open question. */
function issueStaff(h: BaseContext, row: StaffDayRow, status: StatusCode, rows: readonly StaffDayRow[]): string {
  const ticket = issue(h, confirmNow(h, 'mark_staff', oneKey(row.member.id, status), rows));
  h.state.staffTicket = ticket;
  h.state.staffQuestion = { staffId: row.member.id, status };
  return ticket.token;
}

function issueRest(h: BaseContext, ids: readonly string[], status: StatusCode, rows: readonly StaffDayRow[]): string {
  const ticket = issue(h, confirmNow(h, 'mark_remaining_staff', restKey(ids, status), rows));
  h.state.staffRestTicket = ticket;
  h.state.staffRestQuestion = { status };
  return ticket.token;
}

/** The staff screen shows the day while a question is asked (the same URL again is skipped by the screen), with the person outlined. */
function showStaff(h: BaseContext, staffId: string | null): void {
  if (!h.deps.voice.capabilities.navTargets.includes('staff_attendance')) return;
  h.navigate(routes.staff, false);
  if (staffId) h.deps.bus.emit({ type: 'focus_staff', staffId });
}

/** A mark_staff question (its instruction names the tool with a code), as the session keeps it pending. */
const STAFF_QUESTION = /Call mark_staff with (?:staff "[^"]*", status [A-Z_]+ and )?confirm_token "/;
const REST_QUESTION = /Call mark_remaining_staff with confirm_token "/;

/**
 * Everyone else, for `status`: the people not marked yet, less a person with an open mark_staff question for another
 * status ("Pradeep absent, everyone else present"), so the bulk save never marks them first, whatever the call order.
 */
function everyoneElse(h: BaseContext, rows: readonly StaffDayRow[], status: StatusCode): StaffDayRow[] {
  const asked = h.state.staffQuestion;
  const held = asked && asked.status !== status ? asked.staffId : null;
  return unmarkedOf(h, rows).filter((r) => r.member.id !== held);
}

/** The everyone-else question for the people not marked yet, with a new code; null when nobody is left. */
function restQuestion(h: BaseContext, rows: readonly StaffDayRow[], status: StatusCode): { readonly text: string; readonly ids: readonly string[]; readonly token: string } | null {
  const left = everyoneElse(h, rows, status);
  if (!left.length) return null;
  const ids = left.map((r) => r.member.id);
  const token = issueRest(h, ids, status, rows);
  const text = confirmRestInstruction(ids.length, toModelStatus(status), left.some((r) => isSelf(h, r)), left.length === 1 ? personOf(h, left[0]) : null, token);
  return { text, ids, token };
}

/**
 * After a goAway swap: the pending staff question with a code issued for the new connection (whose adoption voided the
 * old one), so one clear yes still saves it. null when it can no longer be asked (the person has a mark now, nobody is
 * left, or no question is known); undefined when the pending question is not a staff question.
 */
export async function staffRefreshQuestion(h: BaseContext, pendingQuestion: string | null): Promise<string | null | undefined> {
  if (!pendingQuestion) return undefined;
  if (REST_QUESTION.test(pendingQuestion)) {
    const asked = h.state.staffRestQuestion;
    if (!asked) return null;
    const again = restQuestion(h, await h.deps.staffAttendance.day(h.deps.ctx), asked.status);
    if (!again) h.state.staffRestQuestion = null;
    return again?.text ?? null;
  }
  if (!STAFF_QUESTION.test(pendingQuestion)) return undefined;
  const asked = h.state.staffQuestion;
  if (!asked) return null;
  const rows = await h.deps.staffAttendance.day(h.deps.ctx);
  const row = rows.find((r) => r.member.id === asked.staffId);
  if (!row || row.record) {
    h.state.staffQuestion = null;
    return null;
  }
  return confirmStaffInstruction(personOf(h, row), toModelStatus(asked.status), issueStaff(h, row, asked.status, rows));
}

function alreadyMarked(h: BaseContext, row: StaffDayRow): ToolResult {
  const rec = row.record!;
  return fail('ALREADY_MARKED', staffAlreadyInstruction(personOf(h, row), toModelStatus(rec.status), rec.source, clockTime(rec.deviceTimestamp)), { staff: who(h, row) });
}

/** Words for the principal themselves (D-156): English, Hinglish and Marathi, and "you" (what results call the principal). */
const SELF_WORDS: ReadonlySet<string> = new Set([
  'me', 'myself', 'my', 'mine', 'self', 'you', 'yourself', 'mujhe', 'mujhko', 'meri', 'mera', 'mere', 'main', 'mi', 'maza', 'majha', 'mazi', 'majhi',
  'मला', 'माझी', 'माझा', 'माझे', 'मी',
]);
const SELF_FILLER: ReadonlySet<string> = new Set(['attendance', 'hajeri', 'hajri', 'haajri', 'हजेरी', 'own']);

/** "me", "Me.", "meri attendance", "माझी हजेरी": words that name only the speaker. */
export function namesSelf(heard: string): boolean {
  const words = heard.toLowerCase().split(/[\s.,!?;:'"()।-]+/u).filter((w) => w && !SELF_FILLER.has(w));
  return words.length > 0 && words.every((w) => SELF_WORDS.has(w));
}

/** The person the principal named, among today's staff (marked or not, so a mark already made can be said). */
function findStaff(h: BaseContext, heard: string, rows: readonly StaffDayRow[]): { readonly row: StaffDayRow } | { readonly result: ToolResult } {
  if (namesSelf(heard)) {
    const mine = rows.find((r) => isSelf(h, r));
    return mine ? { row: mine } : { result: fail('NOT_FOUND', STAFF_SELF_MISSING) };
  }
  const byId = rows.find((r) => r.member.id === heard);
  if (byId) return { row: byId };
  const match = resolveStudent(heard, rows.map((row) => ({ id: row.member.id, rollNo: -1, name: row.member.name, fatherName: '', row })));
  if (match.kind === 'found') return { row: match.value.row };
  if (match.kind === 'none') return { result: fail('NOT_FOUND', staffNotFoundInstruction(heard)) };
  const candidates = match.candidates.map((c) => who(h, c.row));
  return { result: fail('AMBIGUOUS', staffAmbiguousInstruction(heard, candidates.map((c) => c.name)), { candidates }) };
}

/** The status the next person is offered with: present where the state has it. */
const offerStatus = (statuses: readonly StatusCode[]): StatusCode => (statuses.includes('present') ? 'present' : statuses[0]);

export const markStaff: BaseHandler = async (h, args) => {
  const { ctx, staffAttendance, voice } = h.deps;
  const rows = await staffAttendance.day(ctx);
  const found = findStaff(h, str(args.staff), rows);
  if ('result' in found) return found.result;
  const { row } = found;
  if (row.record) return alreadyMarked(h, row);
  const statuses = voice.capabilities.staffStatuses;
  const status = parseModelStatus(args.status, statuses);
  if (!status) return fail('INVALID', staffStatusInstruction(statuses.map(toModelStatus)));

  if (!checkConfirm(h.state.staffTicket, args.confirm_token, confirmNow(h, 'mark_staff', oneKey(row.member.id, status), rows)).ok) {
    const token = issueStaff(h, row, status, rows);
    showStaff(h, row.member.id);
    return fail('NEEDS_CONFIRMATION', confirmStaffInstruction(personOf(h, row), toModelStatus(status), token), { staff: who(h, row), status: toModelStatus(status), confirm_token: token });
  }
  h.state.staffTicket = null; // a code is used once
  h.state.staffQuestion = null;
  const saved = await staffAttendance.markByPrincipal(ctx, [{ staffId: row.member.id, status }]);
  const after = await staffAttendance.day(ctx);
  const now = after.find((r) => r.member.id === row.member.id);
  // self-mark precedence (PRD 18.3): a mark made between the yes and the save stands, and is said
  if (saved.ok && saved.value.skipped.includes(row.member.id) && now?.record) return alreadyMarked(h, now);
  if (!saved.ok || !saved.value.saved) return fail('NOT_SAVED', STAFF_NOT_SAVED);
  h.deps.bus.emit({ type: 'saved', what: 'staff' });
  const left = unmarkedOf(h, after);
  const done = { ok: true, staff: who(h, row), status: toModelStatus(status), not_marked: left.length };
  const next = left[0];
  if (!next) return { ...done, instruction: staffMarkedInstruction(personOf(h, row), toModelStatus(status), 0) };
  // the next person, offered with a code of its own (one clear yes marks them); the screen moves its outline to them
  const offer = offerStatus(statuses);
  const token = issueStaff(h, next, offer, after);
  showStaff(h, next.member.id);
  const instruction = staffMarkedInstruction(personOf(h, row), toModelStatus(status), left.length, { person: personOf(h, next), status: toModelStatus(offer), token });
  return { ...done, next: who(h, next), confirm_token: token, instruction };
};

export const markRemainingStaff: BaseHandler = async (h, args) => {
  const { ctx, staffAttendance, voice } = h.deps;
  const statuses = voice.capabilities.staffStatuses;
  const status = parseModelStatus(args.status, statuses);
  if (!status) return fail('INVALID', staffStatusInstruction(statuses.map(toModelStatus)));
  const rows = await staffAttendance.day(ctx);
  const ids = everyoneElse(h, rows, status).map((r) => r.member.id);
  if (!ids.length) return fail('NOTHING_LEFT', NO_STAFF_LEFT);

  if (!checkConfirm(h.state.staffRestTicket, args.confirm_token, confirmNow(h, 'mark_remaining_staff', restKey(ids, status), rows)).ok) {
    const asked = restQuestion(h, rows, status)!;
    showStaff(h, null);
    const includesYou = ids.includes(ctx.user.id);
    return fail('NEEDS_CONFIRMATION', asked.text, { count: ids.length, status: toModelStatus(status), ...(includesYou ? { includes_you: true } : {}), confirm_token: asked.token });
  }
  h.state.staffRestTicket = null; // a code is used once
  h.state.staffRestQuestion = null;
  const saved = await staffAttendance.markByPrincipal(ctx, ids.map((staffId) => ({ staffId, status })));
  if (!saved.ok) return fail('NOT_SAVED', STAFF_NOT_SAVED);
  const after = await staffAttendance.day(ctx);
  // self-mark precedence (PRD 18.3): anyone who marked themselves between the yes and the save keeps their own mark
  const standing = saved.value.skipped.flatMap((id) => after.filter((r) => r.member.id === id && r.record?.source === 'self')).map((r) => personOf(h, r));
  if (!saved.value.saved && !standing.length) return fail('NOT_SAVED', STAFF_NOT_SAVED);
  if (saved.value.saved) h.deps.bus.emit({ type: 'saved', what: 'staff' });
  const left = after.filter((r) => !r.record).length;
  return { ok: true, saved: saved.value.saved, status: toModelStatus(status), not_marked: left, instruction: restMarkedInstruction(saved.value.saved, toModelStatus(status), standing, left) };
};

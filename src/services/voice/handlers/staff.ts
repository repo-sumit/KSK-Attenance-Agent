/**
 * Staff attendance by voice (D-141), with `capabilities.staffMarking` (the principal): get_staff_today counts today's
 * staff as the staff screen does, and mark_staff marks one person who has no record yet, through
 * StaffAttendanceService.markByPrincipal (the same rules as the screen's Save). mark_staff first answers
 * NEEDS_CONFIRMATION with a code issued here (D-082): bound to the person and the status, today's staff records (any
 * change voids it), this connection, two minutes, and a trainer turn after the asking turn. A mark the person made
 * themselves always stands: before the question, and when it arrives between the yes and the save. Names are matched
 * by the student matcher (whole name, first name, near spelling); ambiguous names are asked about. A question still
 * open when a goAway swap moves to a new connection (which voids every code) is asked again with a code issued for the
 * new connection (staffRefreshQuestion), as the marking executor does for the submit question.
 * No browser globals.
 */
import { checkConfirm, issueConfirm, type ConfirmNow } from '@/domain/voice/confirm';
import { resolveStudent } from '@/domain/voice/match';
import type { StatusCode } from '@/domain/status';
import { parseModelStatus, toModelStatus } from '@/domain/voice/types';
import { routes } from '@/lib/routes';
import type { StaffDayRow } from '@/services/staff-attendance';
import { clockTime, nameText } from '../labels';
import {
  confirmStaffInstruction, STAFF_NOT_SAVED, staffAlreadyInstruction, staffAmbiguousInstruction, staffMarkedInstruction, staffNotFoundInstruction,
  staffStatusInstruction, staffTodayInstruction,
} from '../staff-texts';
import type { ToolResult } from '../tools';
import { fail, str, type BaseContext, type BaseHandler } from './base';

const MAX_NAMED = 5;

export const getStaffToday: BaseHandler = async (h) => {
  const { ctx, staffAttendance } = h.deps;
  const rows = await staffAttendance.day(ctx);
  const counts = Object.fromEntries(ctx.journey.staff.statusSet.map((s) => [toModelStatus(s), rows.filter((r) => r.record?.status === s).length]));
  const unmarked = rows.filter((r) => !r.record);
  const named = unmarked.slice(0, MAX_NAMED).map((r) => ({ id: r.member.id, name: nameText(r.member.name) }));
  const marked = rows.length - unmarked.length;
  return {
    ok: true,
    total: rows.length,
    marked,
    not_marked: unmarked.length,
    counts,
    not_marked_names: named,
    instruction: staffTodayInstruction({ total: rows.length, marked, counts, names: named.map((n) => n.name), notMarked: unmarked.length }),
  };
};

/** What today's staff records are: a new record anywhere voids an open code (as a draft change voids a submit code). */
const revisionOf = (rows: readonly StaffDayRow[]): number => rows.filter((r) => r.record).length;

function confirmNow(h: BaseContext, argsKey: string, revision: number): ConfirmNow {
  const d = h.deps;
  return { action: 'mark_staff', argsKey, revision, now: d.nowMs(), speechSeq: d.speechSeq(), turnSeq: d.turnSeq(), spokeAtTurn: d.spokeAtTurn(), generation: d.generation() };
}

const who = (row: StaffDayRow) => ({ id: row.member.id, name: nameText(row.member.name) });

/** A code for marking `row` with `status`, bound to today's staff records and this connection; kept as the open question. */
function issueStaff(h: BaseContext, row: StaffDayRow, status: StatusCode, rows: readonly StaffDayRow[]): string {
  const ticket = issueConfirm(confirmNow(h, `${row.member.id}|${status}`, revisionOf(rows)), [h.deps.entropy(), h.deps.entropy(), h.deps.entropy(), h.deps.entropy()]);
  h.state.staffTicket = ticket;
  h.state.staffQuestion = { staffId: row.member.id, status };
  return ticket.token;
}

/** A mark_staff question (its instruction names the tool with a code), as the session keeps it pending. */
const STAFF_QUESTION = /Call mark_staff with confirm_token "/;

/**
 * After a goAway swap: the pending mark_staff question with a code issued for the new connection (whose adoption voided
 * the old one), so one clear yes still saves it. null when it can no longer be asked (the person has a mark now, or no
 * question is known); undefined when the pending question is not a mark_staff question.
 */
export async function staffRefreshQuestion(h: BaseContext, pendingQuestion: string | null): Promise<string | null | undefined> {
  if (!pendingQuestion || !STAFF_QUESTION.test(pendingQuestion)) return undefined;
  const asked = h.state.staffQuestion;
  if (!asked) return null;
  const rows = await h.deps.staffAttendance.day(h.deps.ctx);
  const row = rows.find((r) => r.member.id === asked.staffId);
  if (!row || row.record) {
    h.state.staffQuestion = null;
    return null;
  }
  return confirmStaffInstruction(row.member.name, toModelStatus(asked.status), issueStaff(h, row, asked.status, rows));
}

function alreadyMarked(row: StaffDayRow): ToolResult {
  const rec = row.record!;
  return fail('ALREADY_MARKED', staffAlreadyInstruction(row.member.name, toModelStatus(rec.status), rec.source, clockTime(rec.deviceTimestamp)), { staff: who(row) });
}

/** The person the principal named, among today's staff (marked or not, so a mark already made can be said). */
function findStaff(heard: string, rows: readonly StaffDayRow[]): { readonly row: StaffDayRow } | { readonly result: ToolResult } {
  const match = resolveStudent(heard, rows.map((row) => ({ id: row.member.id, rollNo: -1, name: row.member.name, fatherName: '', row })));
  if (match.kind === 'found') return { row: match.value.row };
  if (match.kind === 'none') return { result: fail('NOT_FOUND', staffNotFoundInstruction(heard)) };
  const candidates = match.candidates.map((c) => who(c.row));
  return { result: fail('AMBIGUOUS', staffAmbiguousInstruction(heard, candidates.map((c) => c.name)), { candidates }) };
}

export const markStaff: BaseHandler = async (h, args) => {
  const { ctx, staffAttendance, voice } = h.deps;
  const heard = str(args.staff);
  const rows = await staffAttendance.day(ctx);
  const found = findStaff(heard, rows);
  if ('result' in found) return found.result;
  const { row } = found;
  if (row.record) return alreadyMarked(row);
  const statuses = voice.capabilities.staffStatuses;
  const status = parseModelStatus(args.status, statuses);
  if (!status) return fail('INVALID', staffStatusInstruction(statuses.map(toModelStatus)));

  if (!checkConfirm(h.state.staffTicket, args.confirm_token, confirmNow(h, `${row.member.id}|${status}`, revisionOf(rows))).ok) {
    const token = issueStaff(h, row, status, rows);
    // the staff screen shows the day while the question is asked (the same URL again is skipped by the screen)
    if (voice.capabilities.navTargets.includes('staff_attendance')) h.navigate(routes.staff, false);
    return fail('NEEDS_CONFIRMATION', confirmStaffInstruction(row.member.name, toModelStatus(status), token), { staff: who(row), status: toModelStatus(status), confirm_token: token });
  }
  h.state.staffTicket = null; // a code is used once
  h.state.staffQuestion = null;
  const saved = await staffAttendance.markByPrincipal(ctx, [{ staffId: row.member.id, status }]);
  const after = await staffAttendance.day(ctx);
  const now = after.find((r) => r.member.id === row.member.id);
  // self-mark precedence (PRD 18.3): a mark made between the yes and the save stands, and is said
  if (saved.ok && saved.value.skipped.includes(row.member.id) && now?.record) return alreadyMarked(now);
  if (!saved.ok || !saved.value.saved) return fail('NOT_SAVED', STAFF_NOT_SAVED);
  const left = after.filter((r) => !r.record).length;
  return { ok: true, staff: who(row), status: toModelStatus(status), not_marked: left, instruction: staffMarkedInstruction(row.member.name, toModelStatus(status), left) };
};

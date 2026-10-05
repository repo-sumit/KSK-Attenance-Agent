/**
 * The trainer's own attendance by voice (D-141), with `capabilities.selfAttendance`: get_my_attendance reads today's
 * record and this month's figures; mark_my_attendance opens My attendance, where the screen runs the same location
 * and face check as a tap does. Voice follows that check's events as it follows a batch's gateway (./check), and only
 * its pass saves the mark, through StaffAttendanceService.markSelf, which checks the pass itself. There is no
 * override: a failed check is read out, and "check again" is the screen's own retry (verify_again).
 * No browser globals.
 */
import type { StaffAttendanceRecord } from '@/domain/attendance';
import { toModelStatus } from '@/domain/voice/types';
import { routes } from '@/lib/routes';
import { purposeKey, type VerificationEvent } from '@/services/verification';
import { checkWords, clockTime } from '../labels';
import {
  alreadyMineInstruction, myAttendanceInstruction, SELF_NOT_SAVED, selfCheckInstruction, selfMarkedInstruction, selfPassedEvent, type MyMonth,
  type MyToday,
} from '../staff-texts';
import type { ToolResult } from '../tools';
import { freshCheck, type BaseContext, type BaseHandler } from './base';
import { followCheck } from './check';

const SELF = { kind: 'self' } as const;

export const getMyAttendance: BaseHandler = async (h) => {
  const { ctx, staffAttendance, reports, voice } = h.deps;
  const [record, month] = await Promise.all([staffAttendance.myRecord(ctx), reports.myAttendance(ctx)]);
  const today: MyToday = record
    ? { marked: true, status: toModelStatus(record.status), by: record.source === 'self' ? 'SELF' : 'PRINCIPAL', time: clockTime(record.deviceTimestamp) }
    : { marked: false };
  const figures: MyMonth = { present_days: month.presentDays, marked_days: month.workingDays, pct: month.pct };
  return { ok: true, today, month: figures, instruction: myAttendanceInstruction(today, figures, voice.capabilities.selfAttendance) };
};

const already = (record: StaffAttendanceRecord): ToolResult => ({
  ok: false,
  error: 'ALREADY_MARKED',
  instruction: alreadyMineInstruction(toModelStatus(record.status), clockTime(record.deviceTimestamp)),
});

/** My attendance on screen (voice's navigation is skipped when the screen already shows it). */
function openMine(h: BaseContext): void {
  if (h.state.screen !== routes.selfAttendance) h.navigate(routes.selfAttendance, false);
}

/** The save after the check (or with no check to run). A mark made meanwhile (the screen's own Mark present, the principal) stands. */
async function save(h: BaseContext): Promise<{ readonly record: StaffAttendanceRecord } | { readonly result: ToolResult }> {
  const { ctx, staffAttendance } = h.deps;
  const saved = await staffAttendance.markSelf(ctx);
  if (saved.ok) return { record: saved.value };
  const record = saved.error === 'already_marked' ? await staffAttendance.myRecord(ctx) : undefined;
  return { result: record ? already(record) : { ok: false, error: 'NOT_SAVED', instruction: SELF_NOT_SAVED } };
}

/** My attendance shows the saved mark as its result (it replays the event when it mounts after the navigation). */
const showSaved = (h: BaseContext, record: StaffAttendanceRecord): void => void h.deps.bus.emit({ type: 'self_marked', record });

export const markMyAttendance: BaseHandler = async (h) => {
  const { ctx, staffAttendance, verification } = h.deps;
  const record = await staffAttendance.myRecord(ctx);
  if (record) {
    h.state.self = null;
    return already(record);
  }
  if (await verification.hasPass(ctx, SELF)) {
    // checked already today (or no check is configured): saved now, then My attendance shows it
    h.state.self = null;
    const done = await save(h);
    if ('result' in done) return done.result;
    openMine(h);
    showSaved(h, done.record);
    const time = clockTime(done.record.deviceTimestamp);
    return { ok: true, marked: true, time, instruction: selfMarkedInstruction(time) };
  }
  // the check runs on the screen; a check already in progress keeps its count of face tries
  h.state.self ??= freshCheck();
  openMine(h);
  return { ok: true, step: 'VERIFY', instruction: selfCheckInstruction(checkWords(ctx.journey.verification)) };
};

/**
 * A verification event of the check mark_my_attendance opened (events of any other check are not ours): read out as
 * a batch's are; the pass saves the mark and says so. The check is over with the pass, whatever the save says.
 */
export async function selfCheckHook(h: BaseContext, e: VerificationEvent): Promise<string | null> {
  const v = h.state.self;
  if (!v || e.purpose !== purposeKey(SELF)) return null;
  if (e.type !== 'granted') return followCheck(v, e, { faceRetryLimit: h.deps.ctx.journey.verification.faceRetryLimit });
  h.state.self = null;
  const done = await save(h);
  if ('result' in done) return `[APP] ${done.result.instruction}`;
  showSaved(h, done.record);
  return selfPassedEvent(clockTime(done.record.deviceTimestamp));
}

/** The trainer left My attendance: the check voice opened is no longer followed (a later pass there is the screen's own). */
export function leftMine(h: BaseContext, onMine: boolean): void {
  if (!onMine) h.state.self = null;
}

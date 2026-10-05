/**
 * The capability tools every voice plan may have (D-139): navigate (every screen of the plan), get_announcements
 * (today's notices), end_voice_session, and, without a marking flow, get_status as today's state at the institute.
 * They read services only and change no record. Every href comes from the SCREENS map (`routes`), never from a model
 * string.
 */
import { localized } from '@/domain/announcement';
import type { NavTarget } from '@/domain/voice/plan';
import { toLocalDate } from '@/lib/time';
import { sessionProgress } from '@/services/session-progress';
import { nameText } from '../labels';
import { announcementsInstruction, NO_NOTICES, noticeDates, todayLine, type TodayFacts } from '../overview';
import { SCREENS, screenNames } from '../screens';
import { fail, str, type BaseDeps, type BaseHandler } from './base';

/** Today at the institute, counted as the principal's Home counts it (trade sessions, staff without a record). */
export async function loadToday(deps: BaseDeps): Promise<TodayFacts> {
  const { ctx, attendance, staffAttendance } = deps;
  const [boards, staff] = await Promise.all([
    Promise.all(ctx.access.tradeIds.map((id) => attendance.boardForTrade(ctx, id))),
    ctx.journey.staff.principalStaffView ? staffAttendance.day(ctx) : Promise.resolve(null),
  ]);
  const progress = sessionProgress(boards.flat());
  return { batchesSubmitted: progress.submitted, batchesTotal: progress.total, staffNotMarked: staff ? staff.filter((r) => !r.record).length : null };
}

/** get_status without a marking flow: today's numbers, answered in one short line. */
export const getToday: BaseHandler = async (h) => {
  const t = await loadToday(h.deps);
  return {
    ok: true,
    batches_submitted: t.batchesSubmitted,
    batches_total: t.batchesTotal,
    ...(t.staffNotMarked === null ? {} : { staff_not_marked: t.staffNotMarked }),
    instruction: `${todayLine(t)} Answer the trainer in one short line from these numbers.`,
  };
};

/** "open reports", "staff attendance kholo": the screen only (a trade or batch opens with its own tools). */
export const navigateTool: BaseHandler = async (h, args) => {
  const targets = h.deps.voice.capabilities.navTargets;
  const asked = str(args.to).toLowerCase().replace(/\s+/g, '_');
  const target = targets.find((t) => t === asked);
  if (!target) return fail('INVALID', `There is no "${nameText(str(args.to))}" screen. The screens are ${screenNames(targets, 'and')}.`);
  if (target === 'my_attendance' && (await h.deps.staffAttendance.myRecord(h.deps.ctx))) {
    return fail('ALREADY_MARKED', "The trainer's own attendance is already marked today, so that screen is not needed. Say so in one short line.");
  }
  // the reader's notices first, as get_announcements reads them: with none, nothing opens (the sheet would be empty)
  if (target === 'announcements' && !(await h.deps.announcements.forUser(h.deps.ctx)).length) {
    return fail('NO_NOTICES', NO_NOTICES);
  }
  h.navigate(SCREENS[target].href, false);
  if (target === 'announcements') h.deps.bus.emit({ type: 'show_announcements' });
  const then = await h.afterNavigate();
  return { ok: true, screen: target, instruction: `The ${SCREENS[target].name} screen is open. Say so in a few words.${then}` };
};

const MAX_NOTICES = 3;

/** Today's notices for this reader, most important first: at most three read out, the rest counted. */
export const getAnnouncements: BaseHandler = async (h) => {
  const { ctx, announcements, voice } = h.deps;
  const today = toLocalDate(ctx.clock.now());
  const all = await announcements.forUser(ctx);
  const notices = all.slice(0, MAX_NOTICES).map((a) => {
    const dates = noticeDates(a.eventFrom, a.eventTo, today);
    return { title: nameText(localized(a.title, 'en')), ...(dates ? { dates } : {}) };
  });
  const more = all.length - notices.length;
  const canOpen = voice.capabilities.navTargets.includes('announcements' satisfies NavTarget);
  return { ok: true, notices, ...(more ? { more } : {}), instruction: announcementsInstruction(notices, more, canOpen) };
};

export const endVoiceSession: BaseHandler = async (h) => {
  h.state.endRequested = true;
  h.deps.bus.emit({ type: 'end_voice' });
  return { ok: true, instruction: 'Say goodbye in a few words. The attendance on screen is kept.' };
};

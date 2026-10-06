import { describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { compileVoicePlan } from '@/domain/voice/plan';
import { sessionProgress } from '@/services/session-progress';
import { ActionBus, type UiEvent } from '@/services/voice/action-bus';
import { RESUME_EVENT } from '@/services/voice/app-events';
import { createExecutor } from '@/services/voice/executor';
import { setup, signIn } from '../helpers/app';

/** Voice for everyone (D-139, D-142): the plan's capabilities beside marking, and the principal, who marks no batch. */
async function voiceFor(trainerId: string, layer: ConfigLayer = {}) {
  const env = setup({ voice: { enabled: true }, ...layer });
  const ctx = await signIn(env.app, trainerId);
  const plan = compileVoicePlan(ctx, 'en')!;
  const bus = new ActionBus();
  const events: UiEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { services } = env.app;
  const ex = createExecutor({
    ctx, plan, bus,
    attendance: services.attendance, verification: services.verification, drafts: services.drafts,
    announcements: services.announcements, staffAttendance: services.staffAttendance, reports: services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => 0, turnSeq: () => 0, spokeAtTurn: () => 0, generation: () => 1, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  const nav = () => events.filter((e) => e.type === 'navigate').map((e) => (e as Extract<UiEvent, { type: 'navigate' }>).href);
  return { env, ctx, plan, ex, call, events, nav };
}

/** Today's numbers as the principal's Home counts them. */
async function todayOf(s: Awaited<ReturnType<typeof voiceFor>>) {
  const { attendance, staffAttendance } = s.env.app.services;
  const boards = await Promise.all(s.ctx.access.tradeIds.map((id) => attendance.boardForTrade(s.ctx, id)));
  const progress = sessionProgress(boards.flat());
  const unmarked = (await staffAttendance.day(s.ctx)).filter((r) => !r.record).length;
  return { ...progress, unmarked };
}

const NO_CHECK: ConfigLayer = { verification: { geoMode: 'off', face: false } };

describe('voice for the principal (D-139): no batch flow, today\'s state, the screens', () => {
  it('kickoff: the greeting by the salutation, one line with today\'s state, then "How can I help?" and wait', async () => {
    const s = await voiceFor('PR-2741');
    expect(s.plan.marking).toBeNull();
    const t = await todayOf(s);
    expect(t.total).toBeGreaterThan(0);
    expect(await s.ex.kickoff('start', 'English')).toBe(
      `[APP] Session started. Today: ${t.submitted} of ${t.total} batches submitted, ${t.unmarked} staff not marked yet, the principal included. Say exactly: "Good morning, Principal." Then say today's state in one line, in English (for example "${t.submitted} of ${t.total} batches are in; ${t.unmarked} staff haven't marked yet, including you."), then ask "How can I help?". Then wait.`,
    );
    expect(s.nav()).toEqual([]); // nothing is opened
  });

  it('every staff member marked, and no staff view at all, are said as such', async () => {
    const s = await voiceFor('PR-2741');
    const rows = await s.env.app.services.staffAttendance.day(s.ctx);
    const saved = await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, rows.filter((r) => !r.record).map((r) => ({ staffId: r.member.id, status: 'present' })));
    expect(saved.ok).toBe(true);
    expect(await s.ex.kickoff('start', 'English')).toMatch(/batches submitted, every staff member marked\. Say exactly/);
    const noStaff = await voiceFor('PR-2741', { staff: { enabled: false } });
    expect(await noStaff.ex.kickoff('start', 'English')).toMatch(/^\[APP\] Session started\. Today: \d+ of \d+ batches submitted\. Say exactly/);
  });

  it('get_status answers with today\'s numbers; the marking tools do not exist', async () => {
    const s = await voiceFor('PR-2741');
    const t = await todayOf(s);
    const status = await s.call('get_status');
    expect(status).toMatchObject({ ok: true, batches_submitted: t.submitted, batches_total: t.total, staff_not_marked: t.unmarked });
    expect(status.instruction).toBe(`Today: ${t.submitted} of ${t.total} batches submitted, ${t.unmarked} staff not marked yet, the principal included. Answer the trainer in one short line from these numbers.`);
    for (const name of ['select_batch', 'get_trades', 'submit_attendance', 'set_student_status', 'mark_remaining']) {
      expect(await s.call(name, { batch: 'shift 1 unit 2' })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    }
  });

  it('navigate opens every screen of the plan and nothing else', async () => {
    const s = await voiceFor('PR-2741');
    expect(await s.call('navigate', { to: 'staff_attendance' })).toMatchObject({ ok: true, screen: 'staff_attendance', instruction: 'The Staff attendance screen is open. Say so in a few words.' });
    expect(await s.call('navigate', { to: 'Attendance' })).toMatchObject({ ok: true, screen: 'attendance' });
    expect(await s.call('navigate', { to: 'reports' })).toMatchObject({ ok: true });
    // Offline for every user (D-153): the principal's Offline data screen.
    expect(await s.call('navigate', { to: 'offline' })).toMatchObject({ ok: true, screen: 'offline' });
    expect(s.nav()).toEqual(['/attendance/staff', '/attendance', '/reports', '/reports/offline']);
    expect(await s.call('navigate', { to: 'my_attendance' })).toMatchObject({
      ok: false, error: 'INVALID', instruction: 'There is no "my_attendance" screen. The screens are Home, Attendance, Reports, Offline data, Staff attendance and Announcements.',
    });
    expect(s.nav()).toHaveLength(4);
  });

  it('the hooks for taps, screens and verification say nothing; a refresh and a reconnect re-read today', async () => {
    const s = await voiceFor('PR-2741');
    expect(await s.ex.onScreen({ kind: 'home' })).toBeNull();
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: 'ele-s1u2.2026-09-25.d' })).toBeNull();
    expect(await s.ex.onVerification({ type: 'granted', purpose: 'session:x' })).toBeNull();
    expect(s.ex.onDraftChange({ key: 'k', kind: 'mark', via: 'tap', studentIds: ['a'], after: undefined } as never)).toBeNull();
    const t = await todayOf(s);
    expect(await s.ex.refresh(null)).toBe(`[APP] The connection was refreshed; trust these facts over your memory. Today: ${t.submitted} of ${t.total} batches submitted, ${t.unmarked} staff not marked yet, the principal included. Wait for the trainer.`);
    expect(await s.ex.refresh('Ask whether to open the notices.', 'any notices')).toBe(
      `[APP] The connection was refreshed; trust these facts over your memory. Today: ${t.submitted} of ${t.total} batches submitted, ${t.unmarked} staff not marked yet, the principal included. The trainer last said: "any notices" (already handled: do not act on it again). Your last question to the trainer was lost in the refresh: ask it again now, then wait. Its instruction was: Ask whether to open the notices.`,
    );
    // spoken facts, never "say nothing": telling the model to stay silent made it skip its next reply (refreshEvent)
    expect(await s.ex.kickoff('reconnect', 'English')).toBe('[APP] Reconnected. Call get_status and say today\'s state in one short line, then wait for the trainer.');
    expect(s.ex.flow().step).toBe('IDLE');
  });

  it('Resume after Pause: the principal is told the trainer is back and to wait, with no student to continue from', async () => {
    const s = await voiceFor('PR-2741');
    expect(s.ex.resumeText()).toBe('[APP] The trainer is back from the screen. Say in a few words that you are listening, then wait for their request. Do not read out today\'s numbers unless they ask.');
    expect(s.ex.resumeText()).not.toMatch(/student/);
    const instructor = await voiceFor('TR-10432');
    expect(instructor.ex.resumeText()).toBe(RESUME_EVENT); // the marking executor keeps today's text
  });

  it('a handler that throws answers INTERNAL, as the marking executor does', async () => {
    const s = await voiceFor('PR-2741');
    vi.spyOn(s.env.app.services.attendance, 'boardForTrade').mockRejectedValue(new Error('storage broke'));
    expect(await s.call('get_status')).toEqual({
      ok: false, error: 'INTERNAL', instruction: 'Something went wrong in the app. Say sorry in a few words and repeat your last question.',
    });
  });

  it('end_voice_session ends voice when asked', async () => {
    const s = await voiceFor('PR-2741');
    expect(s.ex.endRequested).toBe(false);
    expect(await s.call('end_voice_session')).toMatchObject({ ok: true });
    expect(s.ex.endRequested).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ type: 'end_voice' });
  });
});

describe('announcements by voice', () => {
  it('reads at most three of today\'s notices, title and dates, and offers to open them', async () => {
    const s = await voiceFor('PR-2741');
    const r = await s.call('get_announcements');
    expect(r).toMatchObject({
      ok: true,
      notices: [
        { title: 'Special holiday: institute closed', dates: 'Saturday, 26 September' },
        { title: 'Welding workshop closed for maintenance', dates: 'today' },
        { title: 'Shift 2 timing change', dates: 'Monday, 28 September' },
      ],
      more: 3,
    });
    expect(r.instruction).toBe(
      'Read these notices in the trainer\'s language, one short line each, with their dates: "Special holiday: institute closed" (Saturday, 26 September); "Welding workshop closed for maintenance" (today); "Shift 2 timing change" (Monday, 28 September). 3 more are on Home. Then ask whether to open them on the screen; on yes, call navigate with to=announcements.',
    );
    expect(s.nav()).toEqual([]); // reading opens nothing
  });

  it('an instructor hears only the notices meant for them; a range is read from and to', async () => {
    // the helper's fixed clock: Friday 25 September 2026, 10:15 IST (the notices are dated from it)
    const s = await voiceFor('TR-10432');
    const r = await s.call('get_announcements');
    expect(r).toMatchObject({
      ok: true,
      notices: [
        { title: 'Special holiday: institute closed', dates: 'Saturday, 26 September' },
        { title: 'Shift 2 timing change', dates: 'Monday, 28 September' },
        { title: 'Batch on OJT', dates: 'from 28 September to 3 October' },
      ],
      more: 2,
    });
    expect(JSON.stringify(r)).not.toContain('Welding workshop closed for maintenance'); // a Welder trade notice
  });

  it('open: Home, then the notices sheet (a typed bus event)', async () => {
    const s = await voiceFor('PR-2741');
    expect(await s.call('navigate', { to: 'announcements' })).toMatchObject({ ok: true, screen: 'announcements', instruction: 'The Announcements screen is open. Say so in a few words.' });
    expect(s.events.map((e) => e.type)).toEqual(['navigate', 'show_announcements']);
    expect(s.nav()).toEqual(['/home']);
  });

  it('the marking executor opens them the same way: Home, then the notices sheet', async () => {
    const s = await voiceFor('TR-10432');
    expect(s.plan.marking).not.toBeNull();
    expect(await s.call('navigate', { to: 'announcements' })).toMatchObject({ ok: true, screen: 'announcements' });
    expect(s.events.map((e) => e.type)).toEqual(['navigate', 'show_announcements']);
    expect(s.nav()).toEqual(['/home']);
  });

  it('no notices for this reader: nothing opens, and the answer says there are none today (never that the screen opened)', async () => {
    for (const who of ['PR-2741', 'TR-10432']) {
      const s = await voiceFor(who);
      vi.spyOn(s.env.app.services.announcements, 'forUser').mockResolvedValue([]);
      expect(await s.call('navigate', { to: 'announcements' })).toEqual({
        ok: false, error: 'NO_NOTICES', instruction: 'There are no notices today. Say so in one short line.',
      });
      expect(s.events).toEqual([]);
    }
  });

  it('announcements switched off: no tool and no screen', async () => {
    const off = await voiceFor('TR-10432', { announcements: { enabled: false } });
    expect(await off.call('get_announcements')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(await off.call('navigate', { to: 'announcements' })).toMatchObject({ ok: false, error: 'INVALID' });
  });
});

describe('the instructor\'s new screens', () => {
  it('navigate opens My attendance and Offline data; during a roll call it repeats the current student', async () => {
    const s = await voiceFor('TR-10432', NO_CHECK);
    expect(await s.call('navigate', { to: 'my_attendance' })).toMatchObject({ ok: true, screen: 'my_attendance' });
    expect(await s.call('navigate', { to: 'offline' })).toMatchObject({ ok: true, screen: 'offline' });
    expect(s.nav()).toEqual(['/me/attendance', '/reports/offline']);
    expect(await s.call('navigate', { to: 'staff_attendance' })).toMatchObject({ ok: false, error: 'INVALID' });
    await s.call('select_trade', { trade: 'Electrician' });
    expect(await s.call('select_batch', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: true, step: 'ROLL_CALL' });
    const called = await s.call('start_roll_call');
    const current = (called.current as { call_as: string }).call_as;
    expect((await s.call('navigate', { to: 'reports' })).instruction).toBe(`The Reports screen is open. Say so in a few words. The roll call is still open: then call out ${current}.`);
  });

  it('my attendance already marked today: the screen is not opened, the trainer hears it is marked', async () => {
    const s = await voiceFor('TR-10432', NO_CHECK);
    expect((await s.env.app.services.staffAttendance.markSelf(s.ctx)).ok).toBe(true);
    expect(await s.call('navigate', { to: 'my_attendance' })).toMatchObject({
      ok: false, error: 'ALREADY_MARKED', instruction: "The trainer's own attendance is already marked today, so that screen is not needed. Say so in one short line.",
    });
    expect(s.nav()).toEqual([]);
  });
});


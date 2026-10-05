import { describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { compileVoicePlan } from '@/domain/voice/plan';
import { ActionBus, type UiEvent } from '@/services/voice/action-bus';
import { createExecutor } from '@/services/voice/executor';
import { STAFF_NOT_SAVED } from '@/services/voice/staff-texts';
import { setup, signIn } from '../helpers/app';

/** Own attendance and staff attendance by voice (D-141): the same services and checks as the screens. */
async function voiceFor(trainerId: string, layer: ConfigLayer = {}) {
  const env = setup({ voice: { enabled: true }, ...layer });
  const ctx = await signIn(env.app, trainerId);
  const plan = compileVoicePlan(ctx, 'en')!;
  const bus = new ActionBus();
  const events: UiEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { services } = env.app;
  // the confirmation counters (D-082): a code counts only after the asking turn ended and the trainer spoke again
  const turns = { speech: 0, turn: 0, spokeAt: 0, generation: 1 };
  const ex = createExecutor({
    ctx, plan, bus,
    attendance: services.attendance, verification: services.verification, drafts: services.drafts,
    announcements: services.announcements, staffAttendance: services.staffAttendance, reports: services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => turns.speech, turnSeq: () => turns.turn, spokeAtTurn: () => turns.spokeAt,
    generation: () => turns.generation, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  /** The model's asking turn ends, then the trainer answers. */
  const answer = () => {
    turns.turn += 1;
    turns.spokeAt = turns.turn;
    turns.speech += 1;
  };
  const nav = () => events.filter((e) => e.type === 'navigate').map((e) => (e as Extract<UiEvent, { type: 'navigate' }>).href);
  const marked = () => events.filter((e) => e.type === 'self_marked') as Extract<UiEvent, { type: 'self_marked' }>[];
  return { env, ctx, plan, ex, call, answer, events, nav, marked, turns };
}

const NO_CHECK: ConfigLayer = { verification: { geoMode: 'off', face: false } };

describe('own attendance by voice (D-141): the instructor', () => {
  it('get_my_attendance: today not marked yet, and this month\'s present days and percentage', async () => {
    const s = await voiceFor('TR-10432');
    const month = await s.env.app.services.reports.myAttendance(s.ctx);
    const r = await s.call('get_my_attendance');
    expect(r).toMatchObject({ ok: true, today: { marked: false }, month: { present_days: month.presentDays, marked_days: month.workingDays, pct: month.pct } });
    expect(r.instruction).toBe(
      `Today: not marked yet. This month: present on ${month.presentDays} of ${month.workingDays} marked days (${month.pct}%). Answer in one or two short sentences with these figures. If they want it marked now, call mark_my_attendance.`,
    );
    expect(s.nav()).toEqual([]); // reading opens nothing
  });

  it('get_my_attendance after a mark: marked present, by whom and when', async () => {
    const s = await voiceFor('TR-10432', NO_CHECK);
    expect((await s.env.app.services.staffAttendance.markSelf(s.ctx)).ok).toBe(true);
    const r = await s.call('get_my_attendance');
    expect(r).toMatchObject({ ok: true, today: { marked: true, status: 'PRESENT', by: 'SELF', time: '10:15 am' } });
    expect(r.instruction).toMatch(/^Today: marked present at 10:15 am\. This month: present on \d+(\.5)? of \d+ marked days \(\d+%\)\. Answer in one or two short sentences with these figures\.$/);
  });

  it('mark_my_attendance already marked: says so, opens nothing and saves nothing', async () => {
    const s = await voiceFor('TR-10432', NO_CHECK);
    expect((await s.env.app.services.staffAttendance.markSelf(s.ctx)).ok).toBe(true);
    const r = await s.call('mark_my_attendance');
    expect(r).toMatchObject({
      ok: false, error: 'ALREADY_MARKED',
      instruction: "The trainer's own attendance is already marked present today (at 10:15 am). Say so in one short line.",
    });
    expect(s.nav()).toEqual([]);
    expect(s.marked()).toEqual([]);
  });

  it('mark_my_attendance with the check: My attendance opens, nothing is saved before the pass; the pass saves it and the screen shows it', async () => {
    const s = await voiceFor('TR-10432');
    const r = await s.call('mark_my_attendance');
    expect(r).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(r.instruction).toBe(
      "The location and face check for the trainer's own attendance is on the screen now. Say in one short line: please follow the screen. Then wait for the next [APP] message; the app marks it when the check passes.",
    );
    expect(s.nav()).toEqual(['/me/attendance']);
    expect(await s.env.app.services.staffAttendance.myRecord(s.ctx)).toBeUndefined();

    // the screen's own check reports, as for a batch: the face camera, then the pass
    expect(await s.ex.onVerification({ type: 'camera', purpose: 'self', on: true })).toBe('[APP] The face camera is open. Say nothing until the next [APP] message.');
    expect(await s.ex.onVerification({ type: 'location', purpose: 'self', result: 'inside', distanceM: 40 })).toBeNull();
    const loc = await s.env.app.services.verification.checkLocation(s.ctx);
    await s.env.app.services.verification.grant(s.ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    const text = await s.ex.onVerification({ type: 'granted', purpose: 'self' });
    expect(text).toBe("[APP] The check passed and the trainer's own attendance is marked present at 10:15 am. Say so in one short line.");
    const record = await s.env.app.services.staffAttendance.myRecord(s.ctx);
    expect(record).toMatchObject({ status: 'present', source: 'self' });
    expect(s.marked()).toEqual([expect.objectContaining({ type: 'self_marked', record })]);
    // done: a later pass event says nothing more
    expect(await s.ex.onVerification({ type: 'granted', purpose: 'self' })).toBeNull();
  });

  it('silent geo-tagging is never named (PRD 8.1): the face check alone, or just the screen when nothing else is checked', async () => {
    const tagged = await voiceFor('TR-10432', { verification: { geoMode: 'tagging', face: true } });
    expect((await tagged.call('mark_my_attendance')).instruction).toBe(
      "The face check for the trainer's own attendance is on the screen now. Say in one short line: please follow the screen. Then wait for the next [APP] message; the app marks it when the check passes.",
    );
    const only = await voiceFor('TR-10432', { verification: { geoMode: 'tagging', face: false } });
    const r = await only.call('mark_my_attendance');
    expect(r).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(r.instruction).toBe(
      'My attendance is open on the screen. Say in one short line: please follow the screen. Then wait for the next [APP] message; the app marks it when the screen is done.',
    );
    expect(r.instruction).not.toMatch(/location|identity/);
  });

  it('a failed check is read out with no override; "check again" is the screen\'s own retry, never a save', async () => {
    const s = await voiceFor('TR-10432');
    await s.call('mark_my_attendance');
    expect(await s.ex.onVerification({ type: 'location', purpose: 'self', result: 'outside', distanceM: 1240 })).toBe(
      '[APP] Location check failed: the trainer is 1.24 kilometres from the institute; attendance can only be marked at the institute. Say this in one short sentence with the exact distance. Checking again will not help until they are there.',
    );
    expect(await s.call('verify_again')).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(s.events.at(-1)).toMatchObject({ type: 'verify_retry', purpose: 'self' });
    expect(await s.ex.onVerification({ type: 'face', purpose: 'self', result: 'no_match' })).toMatch(/^\[APP\] Face check failed: the face did not match\. Ask the trainer to face the light and try again \(retry is unlimited\)\.$/);
    expect(await s.env.app.services.staffAttendance.myRecord(s.ctx)).toBeUndefined();
    expect(s.marked()).toEqual([]);
  });

  it('no face tries left: the principal marks it today; verify_again cannot check again', async () => {
    const s = await voiceFor('TR-10432', { verification: { faceRetryLimit: 2 } });
    const limit = s.ctx.journey.verification.faceRetryLimit!;
    expect(limit).toBe(2);
    await s.call('mark_my_attendance');
    let last: string | null = null;
    for (let i = 0; i < limit; i++) last = await s.ex.onVerification({ type: 'face', purpose: 'self', result: 'no_match' });
    expect(last).toBe("[APP] Face check failed: the face did not match, and no tries are left. Say in one short line, in the trainer's language: please ask your principal to mark your attendance today. Then wait.");
    expect(await s.call('verify_again')).toMatchObject({ ok: false, error: 'NO_TRIES_LEFT' });
  });

  it('events of a check voice did not ask for, or of a batch, never save the trainer\'s attendance', async () => {
    const s = await voiceFor('TR-10432');
    await s.env.app.services.verification.grant(s.ctx, { kind: 'self' });
    expect(await s.ex.onVerification({ type: 'granted', purpose: 'self' })).toBeNull(); // a tap-opened check: the screen's Mark present
    expect(await s.env.app.services.staffAttendance.myRecord(s.ctx)).toBeUndefined();

    const left = await voiceFor('TR-10432');
    await left.call('mark_my_attendance');
    await left.ex.onScreen({ kind: 'home' }); // the trainer left My attendance
    await left.env.app.services.verification.grant(left.ctx, { kind: 'self' });
    expect(await left.ex.onVerification({ type: 'granted', purpose: 'self' })).toBeNull();
    expect(await left.env.app.services.staffAttendance.myRecord(left.ctx)).toBeUndefined();
  });

  it('with a pass already (or no check): it is saved at once, My attendance opens and shows it', async () => {
    const s = await voiceFor('TR-10432', NO_CHECK);
    const r = await s.call('mark_my_attendance');
    expect(r).toMatchObject({ ok: true, marked: true, time: '10:15 am', instruction: "The trainer's own attendance is marked present at 10:15 am. Say so in one short line." });
    const record = await s.env.app.services.staffAttendance.myRecord(s.ctx);
    expect(record).toMatchObject({ status: 'present', source: 'self' });
    expect(s.events.map((e) => e.type)).toEqual(['navigate', 'self_marked']); // the screen mounts after the navigation and replays it
    expect(s.nav()).toEqual(['/me/attendance']);
  });

  it('own attendance switched off: no tools; the principal has none either', async () => {
    const off = await voiceFor('TR-10432', { staff: { enabled: false } });
    expect(await off.call('get_my_attendance')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(await off.call('mark_my_attendance')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    const principal = await voiceFor('PR-2741');
    expect(await principal.call('mark_my_attendance')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
  });
});

describe('staff attendance by voice (D-141): the principal', () => {
  it('get_staff_today: counts by status, who is not marked (at most five named)', async () => {
    const s = await voiceFor('PR-2741');
    const rows = await s.env.app.services.staffAttendance.day(s.ctx);
    const unmarked = rows.filter((r) => !r.record);
    const r = await s.call('get_staff_today');
    expect(r).toMatchObject({ ok: true, total: rows.length, marked: rows.length - unmarked.length, not_marked: unmarked.length, counts: { PRESENT: rows.length - unmarked.length, ABSENT: 0 } });
    const named = r.not_marked_names as { id: string; name: string }[];
    expect(named.map((n) => n.id)).toEqual(unmarked.slice(0, 5).map((u) => u.member.id));
    expect(named.length).toBeLessThanOrEqual(5);
    expect(r.instruction).toBe(
      `Staff today: ${rows.length} in all; ${rows.length - unmarked.length} marked (${rows.length - unmarked.length} present, 0 absent); ${unmarked.length} not marked yet: ${named.map((n) => n.name).join(', ')}${unmarked.length > 5 ? ` and ${unmarked.length - 5} more` : ''}. Answer in one or two short sentences with these counts and names, then ask whether to mark anyone.`,
    );
  });

  it('mark_staff asks first with a code bound to the person and status; one clear yes saves it through markByPrincipal', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    expect(ask).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', staff: { id: 'st-pradeep', name: 'Pradeep Gawde' }, status: 'ABSENT' });
    const token = ask.confirm_token as string;
    expect(token).toMatch(/^[A-Z2-9]{4}$/);
    expect(ask.instruction).toBe(
      `In one line, ask whether to mark Pradeep Gawde absent for today, saying it is final for today (for example "Mark Pradeep Gawde absent for today? It is final."). Call mark_staff with confirm_token "${token}" only after a clear yes.`,
    );
    expect(s.nav()).toEqual(['/attendance/staff']); // the staff screen shows the list while the question is asked
    expect((await s.env.app.services.staffAttendance.day(s.ctx)).find((r) => r.member.id === 'st-pradeep')?.record).toBeUndefined();

    // the same breath (no trainer turn after the question) never confirms
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    const again = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    s.answer();
    // a code for another status or another person does not count
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'PRESENT', confirm_token: again.confirm_token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    const fresh = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    s.answer();
    const done = await s.call('mark_staff', { staff: 'Pradeep Gawde', status: 'absent', confirm_token: fresh.confirm_token });
    const left = (await s.env.app.services.staffAttendance.day(s.ctx)).filter((r) => !r.record).length;
    expect(done).toMatchObject({ ok: true, staff: { id: 'st-pradeep', name: 'Pradeep Gawde' }, status: 'ABSENT', not_marked: left });
    expect(done.instruction).toBe(`Pradeep Gawde is marked absent for today. ${left} staff not marked yet. Say so in one short line.`);
    const saved = (await s.env.app.services.staffAttendance.day(s.ctx)).find((r) => r.member.id === 'st-pradeep')?.record;
    expect(saved).toMatchObject({ status: 'absent', source: 'principal' });
    // used once
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: fresh.confirm_token })).toMatchObject({ ok: false, error: 'ALREADY_MARKED' });
  });

  it('a self-mark made meanwhile wins and is reported; the code is void', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Asha Naik', status: 'ABSENT' });
    s.answer();
    // Asha marks herself on her own phone before the principal says yes
    const asha = await signIn(s.env.app, 'TR-10483');
    await s.env.app.services.verification.grant(asha, { kind: 'self' });
    expect((await s.env.app.services.staffAttendance.markSelf(asha)).ok).toBe(true);
    const r = await s.call('mark_staff', { staff: 'Asha Naik', status: 'ABSENT', confirm_token: ask.confirm_token });
    expect(r).toMatchObject({
      ok: false, error: 'ALREADY_MARKED',
      instruction: 'Asha Naik is already marked present today: they marked it themselves at 10:15 am, and their own mark stands. Say so in one short line.',
    });
    expect((await s.env.app.services.staffAttendance.day(s.ctx)).find((x) => x.member.id === 'st-asha')?.record).toMatchObject({ status: 'present', source: 'self' });
  });

  it('a self-mark landing between the yes and the save is reported: markByPrincipal skips that person and their mark stands', async () => {
    const s = await voiceFor('PR-2741');
    const { staffAttendance, verification } = s.env.app.services;
    const ask = await s.call('mark_staff', { staff: 'Asha Naik', status: 'ABSENT' });
    s.answer();
    const asha = await signIn(s.env.app, 'TR-10483');
    const save = staffAttendance.markByPrincipal.bind(staffAttendance);
    const spy = vi.spyOn(staffAttendance, 'markByPrincipal').mockImplementation(async (ctx, marks) => {
      // Asha marks herself on her own phone after the code was checked and before the principal's save runs
      await verification.grant(asha, { kind: 'self' });
      expect((await staffAttendance.markSelf(asha)).ok).toBe(true);
      return save(ctx, marks);
    });
    const r = await s.call('mark_staff', { staff: 'Asha Naik', status: 'ABSENT', confirm_token: ask.confirm_token });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await spy.mock.results[0].value).toMatchObject({ ok: true, value: { skipped: ['st-asha'] } });
    expect(r).toEqual({
      ok: false, error: 'ALREADY_MARKED', staff: { id: 'st-asha', name: 'Asha Naik' },
      instruction: 'Asha Naik is already marked present today: they marked it themselves at 10:15 am, and their own mark stands. Say so in one short line.',
    });
    expect((await staffAttendance.day(s.ctx)).find((x) => x.member.id === 'st-asha')?.record).toMatchObject({ status: 'present', source: 'self' });
  });

  it('a save that does not go through answers NOT_SAVED with the staff text', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    s.answer();
    vi.spyOn(s.env.app.services.staffAttendance, 'markByPrincipal').mockResolvedValue({ ok: true, value: { saved: 0, skipped: [] } });
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: ask.confirm_token })).toEqual({ ok: false, error: 'NOT_SAVED', instruction: STAFF_NOT_SAVED });
  });

  it('a question pending across a goAway swap is asked again with a fresh code, so one yes saves it (D-082)', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    expect(ask.error).toBe('NEEDS_CONFIRMATION');
    // the swap: the new connection voids every code, then the refresh carries the pending question
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    const text = await s.ex.refresh(ask.instruction, 'mark Pradeep absent');
    const fresh = /confirm_token "([A-Z2-9]{4})"/.exec(text)?.[1];
    expect(fresh, 'the question carries a code').toBeDefined();
    expect(text).toContain('Your last question to the trainer was lost in the refresh: ask it again now, then wait. Its instruction was: In one line, ask whether to mark Pradeep Gawde absent for today');
    expect(text).toContain('The trainer last said: "mark Pradeep absent"');
    // the model asks again (its turn ends), the trainer says yes: the code issued for the new connection saves it
    s.answer();
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: fresh })).toMatchObject({ ok: true, staff: { id: 'st-pradeep' }, status: 'ABSENT' });
    expect((await s.env.app.services.staffAttendance.day(s.ctx)).find((r) => r.member.id === 'st-pradeep')?.record).toMatchObject({ status: 'absent', source: 'principal' });
  });

  it('a question pending at a Reconnect is asked again with a fresh code, so one yes saves it (D-082)', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    expect(ask.error).toBe('NEEDS_CONFIRMATION');
    // Reconnect: a new connection voids every code; its kickoff carries the question still pending
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    const text = await s.ex.kickoff('reconnect', 'English', ask.instruction);
    const fresh = /confirm_token "([A-Z2-9]{4})"/.exec(text)?.[1];
    expect(fresh, 'the question carries a code').toBeDefined();
    expect(text).toMatch(/^\[APP\] Reconnected\. Your last question to the trainer was lost in the reconnect: ask it again now, then wait\. Its instruction was: In one line, ask whether to mark Pradeep Gawde absent for today/);
    s.answer();
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: fresh })).toMatchObject({ ok: true, staff: { id: 'st-pradeep' }, status: 'ABSENT' });
    // nothing pending, or a question that is not mark_staff's: the usual Reconnect text
    const plain = "[APP] Reconnected. Call get_status and say today's state in one short line, then wait for the trainer.";
    expect(await s.ex.kickoff('reconnect', 'English', null)).toBe(plain);
    expect(await s.ex.kickoff('reconnect', 'English', 'Ask whether to open the notices.')).toBe(plain);
    // the person was marked meanwhile: not asked again
    const again = await s.call('mark_staff', { staff: 'Asha Naik', status: 'ABSENT' });
    expect(again.error).toBe('NEEDS_CONFIRMATION');
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, [{ staffId: (again.staff as { id: string }).id, status: 'present' }]);
    expect(await s.ex.kickoff('reconnect', 'English', again.instruction)).toBe(plain);
  });

  it('after a swap, a question about someone marked meanwhile is not asked again; an uncoded question stays as it was', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, [{ staffId: 'st-pradeep', status: 'present' }]);
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    const text = await s.ex.refresh(ask.instruction, 'mark Pradeep absent');
    expect(text).toMatch(/Wait for the trainer\.$/);
    expect(text).not.toMatch(/confirm_token|Pradeep/);
    const which = await s.call('mark_staff', { staff: 'Sunita Sanjay', status: 'ABSENT' });
    expect(await s.ex.refresh(which.instruction, 'Sunita Sanjay absent')).toContain(`Its instruction was: ${which.instruction}`);
  });

  it('any other staff change voids the code; a new connection voids it', async () => {
    const s = await voiceFor('PR-2741');
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'PRESENT' });
    s.answer();
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, [{ staffId: 'st-asha', status: 'present' }]);
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'PRESENT', confirm_token: ask.confirm_token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });

    const next = await s.call('mark_staff', { staff: 'Pradeep', status: 'PRESENT' });
    s.answer();
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'PRESENT', confirm_token: next.confirm_token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    expect((await s.env.app.services.staffAttendance.day(s.ctx)).find((r) => r.member.id === 'st-pradeep')?.record).toBeUndefined();
  });

  it('already marked, unknown, ambiguous and a status the state does not use are answered without a code', async () => {
    const s = await voiceFor('PR-2741');
    expect(await s.call('mark_staff', { staff: 'Sunita', status: 'ABSENT' })).toMatchObject({
      ok: false, error: 'ALREADY_MARKED',
      instruction: 'Sunita Jadhav is already marked present today: they marked it themselves at 8:51 am, and their own mark stands. Say so in one short line.',
    });
    expect(await s.call('mark_staff', { staff: 'Zubin Mehta', status: 'ABSENT' })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'LEAVE' })).toMatchObject({
      ok: false, error: 'INVALID', instruction: 'Staff can be marked PRESENT or ABSENT. Ask which one in one short line.',
    });
    expect(s.nav()).toEqual([]);
  });

  it('a first name that fits one staff member asks about that person; words that fit two people ask which one', async () => {
    const s = await voiceFor('PR-2741');
    // Sanjay More is the only Sanjay on the staff, and has no mark yet
    expect(await s.call('mark_staff', { staff: 'Sanjay', status: 'ABSENT' })).toMatchObject({
      ok: false, error: 'NEEDS_CONFIRMATION', staff: { id: 'st-sanjay', name: 'Sanjay More' }, status: 'ABSENT',
    });
    const both = await s.call('mark_staff', { staff: 'Sunita Sanjay', status: 'ABSENT' });
    expect(both).toMatchObject({ ok: false, error: 'AMBIGUOUS', candidates: expect.arrayContaining([{ id: 'st-sanjay', name: 'Sanjay More' }, { id: 'st-sunita', name: 'Sunita Jadhav' }]) });
    expect(both.instruction).toMatch(/^"Sunita Sanjay" could mean .+\. Ask which one in one short line\.$/);
  });

  it('staff marking switched off: no tools; an instructor has none', async () => {
    const off = await voiceFor('PR-2741', { staff: { principalMarking: false } });
    expect(await off.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(await off.call('get_staff_today')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    const instructor = await voiceFor('TR-10432');
    expect(await instructor.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
  });
});

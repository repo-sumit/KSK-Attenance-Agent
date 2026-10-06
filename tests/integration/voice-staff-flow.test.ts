import { describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { compileVoicePlan } from '@/domain/voice/plan';
import { ActionBus, type UiEvent } from '@/services/voice/action-bus';
import { createExecutor } from '@/services/voice/executor';
import { setup, signIn } from '../helpers/app';

/** Staff attendance by voice, said well (D-156, extends D-141): "you", "me", the row in focus, the next person, everyone else at once. */
async function principal(layer: ConfigLayer = {}) {
  const env = setup({ voice: { enabled: true }, ...layer });
  const ctx = await signIn(env.app, 'PR-2741');
  const plan = compileVoicePlan(ctx, 'en')!;
  const bus = new ActionBus();
  const events: UiEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { services } = env.app;
  const turns = { speech: 0, turn: 0, spokeAt: 0, generation: 1 };
  const ex = createExecutor({
    ctx, plan, bus,
    attendance: services.attendance, verification: services.verification, drafts: services.drafts,
    announcements: services.announcements, staffAttendance: services.staffAttendance, reports: services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => turns.speech, turnSeq: () => turns.turn, spokeAtTurn: () => turns.spokeAt,
    generation: () => turns.generation, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  /** The model's asking turn ends, then the principal answers. */
  const answer = () => {
    turns.turn += 1;
    turns.spokeAt = turns.turn;
    turns.speech += 1;
  };
  const focus = () => events.filter((e) => e.type === 'focus_staff').map((e) => (e as Extract<UiEvent, { type: 'focus_staff' }>).staffId);
  const nav = () => events.filter((e) => e.type === 'navigate').map((e) => (e as Extract<UiEvent, { type: 'navigate' }>).href);
  const day = () => services.staffAttendance.day(ctx);
  const recordOf = async (id: string) => (await day()).find((r) => r.member.id === id)?.record;
  return { env, ctx, ex, call, answer, events, focus, nav, day, recordOf, turns };
}

const tokenOf = (text: string) => /confirm_token "([A-Z2-9]{4})"/.exec(text)?.[1];

describe('staff today: the principal is "you" (D-156)', () => {
  it('get_staff_today names the principal\'s own row first, as "you", never by name', async () => {
    const s = await principal();
    const unmarked = (await s.day()).filter((r) => !r.record);
    expect(unmarked.map((r) => r.member.id)).toContain('st-anil');
    const r = await s.call('get_staff_today');
    const named = r.not_marked_names as { id: string; name: string; self?: boolean }[];
    expect(named[0]).toEqual({ id: 'st-anil', name: 'you', self: true });
    expect(named.slice(1).map((n) => n.id)).toEqual(unmarked.filter((u) => u.member.id !== 'st-anil').slice(0, 4).map((u) => u.member.id));
    expect(r.instruction).toContain(`${unmarked.length} not marked yet: you, Rajesh Patil, Sanjay More, Pradeep Gawde, Asha Naik.`);
    expect(r.instruction).toContain('saying "you" for the principal\'s own attendance (never their name)');
    expect(JSON.stringify(r)).not.toMatch(/Anil|Deshmukh/);
  });

  it('once the principal is marked, the list has no "you" and no self line', async () => {
    const s = await principal();
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, [{ staffId: 'st-anil', status: 'present' }]);
    const r = await s.call('get_staff_today');
    expect((r.not_marked_names as { id: string }[]).map((n) => n.id)).not.toContain('st-anil');
    expect(r.instruction).not.toContain('"you"');
  });
});

describe('"mark me present" (D-156)', () => {
  it.each(['me', 'myself', 'mujhe', 'meri', 'मला', 'माझी', 'Me.', 'meri attendance', 'माझी हजेरी'])('"%s" is the principal\'s own row, asked in the second person', async (said) => {
    const s = await principal();
    const ask = await s.call('mark_staff', { staff: said, status: 'PRESENT' });
    expect(ask).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', staff: { id: 'st-anil', name: 'you', self: true }, status: 'PRESENT' });
    expect(ask.instruction).toBe(
      `In one line, ask whether to mark the principal's own attendance present for today, saying it is final for today (for example "Mark yourself present for today? It is final."). Call mark_staff with confirm_token "${ask.confirm_token}" only after a clear yes.`,
    );
    expect(JSON.stringify(ask)).not.toMatch(/Anil|Deshmukh/);
  });

  it('one clear yes saves the principal\'s own mark through markByPrincipal, said as "you"', async () => {
    const s = await principal();
    const ask = await s.call('mark_staff', { staff: 'me', status: 'PRESENT' });
    s.answer();
    const done = await s.call('mark_staff', { staff: 'me', status: 'PRESENT', confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, staff: { id: 'st-anil', name: 'you', self: true }, status: 'PRESENT' });
    expect(done.instruction).toMatch(/^The principal's own attendance is marked present for today\. /);
    expect(await s.recordOf('st-anil')).toMatchObject({ status: 'present', source: 'principal' });
    // already marked: said in the second person too
    const again = await s.call('mark_staff', { staff: 'myself', status: 'ABSENT' });
    expect(again).toMatchObject({ ok: false, error: 'ALREADY_MARKED' });
    expect(again.instruction).toBe("The principal's own attendance is already marked present today: the principal marked it at 10:15 am. Say so in one short line, saying \"you\" (never their name).");
  });

  it('the staff id and "you" (the name results give the principal) also reach the own row; other words still go to the name matcher', async () => {
    const s = await principal();
    expect(await s.call('mark_staff', { staff: 'st-anil', status: 'PRESENT' })).toMatchObject({ error: 'NEEDS_CONFIRMATION', staff: { id: 'st-anil' } });
    expect(await s.call('mark_staff', { staff: 'you', status: 'PRESENT' })).toMatchObject({ error: 'NEEDS_CONFIRMATION', staff: { id: 'st-anil' } });
    expect(await s.call('mark_staff', { staff: 'st-pradeep', status: 'ABSENT' })).toMatchObject({ error: 'NEEDS_CONFIRMATION', staff: { id: 'st-pradeep' } });
    expect(await s.call('mark_staff', { staff: 'Meera', status: 'ABSENT' })).toMatchObject({ error: 'ALREADY_MARKED', staff: { id: 'st-meera' } });
  });
});

describe('the row in focus and the next person (D-156)', () => {
  it('the question opens the staff screen and focuses the row asked about', async () => {
    const s = await principal();
    await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    expect(s.nav()).toEqual(['/attendance/staff']);
    expect(s.focus()).toEqual(['st-pradeep']);
    const order = s.events.map((e) => e.type);
    expect(order.indexOf('navigate')).toBeLessThan(order.indexOf('focus_staff')); // the screen first, so a replay after mount finds it
  });

  it('after a save the agent offers the next person by name with a code, so one yes marks them; the focus moves with it', async () => {
    const s = await principal();
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    s.answer();
    const done = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: ask.confirm_token });
    const next = tokenOf(done.instruction);
    expect(next).toBeDefined();
    expect(done).toMatchObject({ ok: true, staff: { id: 'st-pradeep' }, not_marked: 4, next: { id: 'st-anil', name: 'you', self: true }, confirm_token: next });
    // the principal's own row is next ("you"), offered present with the code the question carries
    expect(done.instruction).toBe(
      `Pradeep Gawde is marked absent for today. 4 staff not marked yet; next is the principal's own attendance. Say in one short line that it is saved, then ask in one line whether to mark the principal present too, saying it is final (for example "Pradeep Gawde is marked absent. Next is you. Mark yourself present for today? It is final."). Call mark_staff with staff "me", status PRESENT and confirm_token "${next}" only after a clear yes.`,
    );
    expect(s.focus()).toEqual(['st-pradeep', 'st-anil']);
    s.answer();
    const mine = await s.call('mark_staff', { staff: 'me', status: 'PRESENT', confirm_token: next });
    expect(mine).toMatchObject({ ok: true, staff: { id: 'st-anil' }, next: { id: 'st-rajesh', name: 'Rajesh Patil' } });
    expect(mine.instruction).toMatch(/^The principal's own attendance is marked present for today\. 3 staff not marked yet; next is Rajesh Patil\. .*\(for example "You are marked present\. Next is Rajesh Patil\. Mark Rajesh Patil present for today\? It is final\."\)\. Call mark_staff with staff "Rajesh Patil", status PRESENT and confirm_token "[A-Z2-9]{4}" only after a clear yes\.$/);
    expect(s.focus()).toEqual(['st-pradeep', 'st-anil', 'st-rajesh']);
    // a different status for the person offered asks again (the code was for present)
    s.answer();
    expect(await s.call('mark_staff', { staff: 'Rajesh Patil', status: 'ABSENT', confirm_token: tokenOf(mine.instruction) })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
  });

  it('the last save offers nobody', async () => {
    const s = await principal();
    const rows = await s.day();
    const left = rows.filter((r) => !r.record && r.member.id !== 'st-asha');
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, left.map((r) => ({ staffId: r.member.id, status: 'present' })));
    const ask = await s.call('mark_staff', { staff: 'Asha Naik', status: 'PRESENT' });
    s.answer();
    const done = await s.call('mark_staff', { staff: 'Asha Naik', status: 'PRESENT', confirm_token: ask.confirm_token });
    expect(done).toEqual({ ok: true, staff: { id: 'st-asha', name: 'Asha Naik' }, status: 'PRESENT', not_marked: 0, instruction: 'Asha Naik is marked present for today. Every staff member is marked now. Say so in one short line.' });
  });

  it('a refresh after the offer asks the offered question again with a new code', async () => {
    const s = await principal();
    const ask = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    s.answer();
    const done = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: ask.confirm_token });
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    const text = await s.ex.refresh(done.instruction, 'yes');
    const fresh = tokenOf(text);
    expect(fresh).toBeDefined();
    expect(text).toContain('Its instruction was: In one line, ask whether to mark the principal\'s own attendance present for today');
    s.answer();
    expect(await s.call('mark_staff', { staff: 'me', status: 'PRESENT', confirm_token: fresh })).toMatchObject({ ok: true, staff: { id: 'st-anil' } });
  });
});

describe('everyone else at once: mark_remaining_staff (D-156)', () => {
  it('one question with the count, a code bound to the set, one yes saves them all', async () => {
    const s = await principal();
    // the principal marks themselves first, as in the rehearsal
    const mine = await s.call('mark_staff', { staff: 'me', status: 'PRESENT' });
    s.answer();
    await s.call('mark_staff', { staff: 'me', status: 'PRESENT', confirm_token: mine.confirm_token });
    const ask = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    const token = ask.confirm_token as string;
    expect(token).toMatch(/^[A-Z2-9]{4}$/);
    expect(ask).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', count: 4, status: 'PRESENT' });
    expect(ask.instruction).toBe(
      `In one line, ask whether to mark the other 4 staff not marked yet present for today, saying it is final (for example "Mark the other 4 staff present? It is final."). Call mark_remaining_staff with confirm_token "${token}" only after a clear yes.`,
    );
    expect(s.nav().at(-1)).toBe('/attendance/staff');
    // the same breath never confirms
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    const again = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    s.answer();
    // a code for another status does not count
    expect(await s.call('mark_remaining_staff', { status: 'ABSENT', confirm_token: again.confirm_token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    const fresh = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    s.answer();
    const before = await s.day();
    const done = await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: fresh.confirm_token });
    expect(done).toEqual({ ok: true, saved: 4, status: 'PRESENT', not_marked: 0, instruction: '4 staff are marked present for today. Every staff member is marked now. Say so in one short line.' });
    const rows = await s.day();
    expect(rows.every((r) => r.record)).toBe(true);
    for (const id of ['st-rajesh', 'st-sanjay', 'st-pradeep', 'st-asha']) expect(await s.recordOf(id)).toMatchObject({ status: 'present', source: 'principal' });
    // used once: with today's records read as they were before the save (the same set, the same revision), the code is spent
    const { staffAttendance } = s.env.app.services;
    vi.spyOn(staffAttendance, 'day').mockResolvedValueOnce(before);
    const save = vi.spyOn(staffAttendance, 'markByPrincipal');
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: fresh.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
    expect(save).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // and with the records as they are, nothing is left to mark
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: fresh.confirm_token })).toEqual({
      ok: false, error: 'NOTHING_LEFT', instruction: 'Every staff member is marked already. Say so in one short line.',
    });
  });

  it('"Pradeep absent, everyone else present": the everyone-else set leaves out the person asked about with another status', async () => {
    const s = await principal();
    const unmarked = (await s.day()).filter((r) => !r.record).length;
    const one = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT' });
    expect(one).toMatchObject({ error: 'NEEDS_CONFIRMATION', staff: { id: 'st-pradeep' } });
    const rest = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    expect(rest).toMatchObject({ error: 'NEEDS_CONFIRMATION', count: unmarked - 1 });
    expect(rest.instruction).toContain(`the other ${unmarked - 1} staff not marked yet present`);
    s.answer();
    // the model calls the bulk tool first, in a message of its own: Pradeep is not marked present
    const done = await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: rest.confirm_token });
    expect(done).toMatchObject({ ok: true, saved: unmarked - 1, not_marked: 1 });
    expect(await s.recordOf('st-pradeep')).toBeUndefined();
    for (const id of ['st-anil', 'st-rajesh', 'st-sanjay', 'st-asha']) expect(await s.recordOf(id)).toMatchObject({ status: 'present' });
    // the records changed, so Pradeep's code is void: asked again, and one yes saves him absent
    const again = await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: one.confirm_token });
    expect(again).toMatchObject({ error: 'NEEDS_CONFIRMATION', staff: { id: 'st-pradeep' } });
    s.answer();
    expect(await s.call('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: again.confirm_token })).toMatchObject({ ok: true, staff: { id: 'st-pradeep' }, status: 'ABSENT' });
    expect(await s.recordOf('st-pradeep')).toMatchObject({ status: 'absent', source: 'principal' });
  });

  it('a pending question with the same status is part of everyone else', async () => {
    const s = await principal();
    const unmarked = (await s.day()).filter((r) => !r.record).length;
    await s.call('mark_staff', { staff: 'Pradeep', status: 'PRESENT' });
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT' })).toMatchObject({ error: 'NEEDS_CONFIRMATION', count: unmarked });
  });

  it('with the principal not marked yet, the question says "you included"', async () => {
    const s = await principal();
    const ask = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION', count: 5, includes_you: true });
    expect(ask.instruction).toContain('(for example "Mark the other 5 staff present, you included? It is final.")');
  });

  it('any staff change voids the code; so does another set with the same number of records, and a new connection', async () => {
    const s = await principal();
    const { staffAttendance } = s.env.app.services;
    const ask = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    s.answer();
    await staffAttendance.markByPrincipal(s.ctx, [{ staffId: 'st-asha', status: 'present' }]);
    const changed = await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: ask.confirm_token });
    expect(changed).toMatchObject({ error: 'NEEDS_CONFIRMATION', count: 4 });
    expect((await s.day()).filter((r) => !r.record)).toHaveLength(4); // nothing else was saved

    // the same number of records but another set of people left: the code was for the exact set
    s.answer();
    const real = staffAttendance.day.bind(staffAttendance);
    const spy = vi.spyOn(staffAttendance, 'day').mockImplementation(async (ctx) => {
      const rows = await real(ctx);
      const asha = rows.find((r) => r.member.id === 'st-asha')!;
      // Asha's record moves to Rajesh: still one record more than at the start, but Asha is left instead of Rajesh
      return rows.map((r) => (r.member.id === 'st-asha' ? { member: r.member } : r.member.id === 'st-rajesh' ? { member: r.member, record: { ...asha.record!, staffId: 'st-rajesh' } } : r));
    });
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: changed.confirm_token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    spy.mockRestore();

    const next = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    s.answer();
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: next.confirm_token })).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    expect((await s.day()).filter((r) => !r.record)).toHaveLength(4);
  });

  it('a self-mark landing between the yes and the save stands and is said', async () => {
    const s = await principal();
    const { staffAttendance, verification } = s.env.app.services;
    const ask = await s.call('mark_remaining_staff', { status: 'ABSENT' });
    s.answer();
    const asha = await signIn(s.env.app, 'TR-10483');
    const save = staffAttendance.markByPrincipal.bind(staffAttendance);
    vi.spyOn(staffAttendance, 'markByPrincipal').mockImplementation(async (ctx, marks) => {
      await verification.grant(asha, { kind: 'self' });
      expect((await staffAttendance.markSelf(asha)).ok).toBe(true);
      return save(ctx, marks);
    });
    const done = await s.call('mark_remaining_staff', { status: 'ABSENT', confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, saved: 4, status: 'ABSENT', not_marked: 0 });
    expect(done.instruction).toBe('4 staff are marked absent for today; Asha Naik marked their own attendance meanwhile, and it stands. Every staff member is marked now. Say so in one short line.');
    expect(await s.recordOf('st-asha')).toMatchObject({ status: 'present', source: 'self' });
  });

  it('a refresh asks the everyone-else question again with a new code for the set as it is now', async () => {
    const s = await principal();
    const ask = await s.call('mark_remaining_staff', { status: 'PRESENT' });
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, [{ staffId: 'st-asha', status: 'present' }]);
    s.ex.voidConfirmations();
    s.turns.generation = 2;
    const text = await s.ex.refresh(ask.instruction, 'mark everyone else present');
    expect(text).toContain('Its instruction was: In one line, ask whether to mark the other 4 staff not marked yet present for today');
    const fresh = tokenOf(text);
    s.answer();
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT', confirm_token: fresh })).toMatchObject({ ok: true, saved: 4 });
  });

  it('nothing left, or a status the state does not use, is answered without a code; an instructor has no such tool', async () => {
    const s = await principal();
    expect(await s.call('mark_remaining_staff', { status: 'LEAVE' })).toMatchObject({ ok: false, error: 'INVALID', instruction: 'Staff can be marked PRESENT or ABSENT. Ask which one in one short line.' });
    const rows = await s.day();
    await s.env.app.services.staffAttendance.markByPrincipal(s.ctx, rows.filter((r) => !r.record).map((r) => ({ staffId: r.member.id, status: 'present' })));
    expect(await s.call('mark_remaining_staff', { status: 'PRESENT' })).toMatchObject({ ok: false, error: 'NOTHING_LEFT' });
    const env = setup({ voice: { enabled: true } });
    const ctx = await signIn(env.app, 'TR-10432');
    const plan = compileVoicePlan(ctx, 'en')!;
    const { services } = env.app;
    const ex = createExecutor({
      ctx, plan, bus: new ActionBus(), attendance: services.attendance, verification: services.verification, drafts: services.drafts,
      announcements: services.announcements, staffAttendance: services.staffAttendance, reports: services.reports,
      isOnline: () => true, nowMs: () => 0, speechSeq: () => 0, turnSeq: () => 0, spokeAtTurn: () => 0, generation: () => 1, entropy: () => 0.42,
    });
    expect(await ex.execute({ id: 'x', name: 'mark_remaining_staff', args: { status: 'PRESENT' } })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
  });
});

describe('the principal\'s kickoff suggests staff (D-156)', () => {
  it('today\'s state names the staff not marked, the principal included, in an example line', async () => {
    const s = await principal();
    const text = await s.ex.kickoff('start', 'English');
    expect(text).toMatch(/^\[APP\] Session started\. Today: \d+ of \d+ batches submitted, 5 staff not marked yet, the principal included\. Say exactly: "Good [a-z]+, Principal\." /);
    expect(text).toMatch(/Then say today's state in one line, in English \(for example "\d+ of \d+ batches are in; 5 staff haven't marked yet, including you\."\), then ask "How can I help\?"\. Then wait\.$/);
  });
});

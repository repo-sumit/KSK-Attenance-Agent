import { describe, expect, it, vi } from 'vitest';
import { completenessIssues } from '@/domain/marking';
import { compileVoicePlan } from '@/domain/voice/plan';
import { ActionBus, type UiEvent } from '@/services/voice/action-bus';
import { createExecutor, type ToolResult, type VoiceExecutor } from '@/services/voice/executor';
import type { ConfigLayer } from '@/config/types';
import { addDays, instantAt } from '@/lib/time';
import { routes } from '@/lib/routes';
import type { SessionContext } from '@/services/context';
import type { DraftChange } from '@/services/marking-draft';
import { RECONNECT_EVENT, RESUME_EVENT } from '@/services/voice/app-events';
import { TrainerTurns } from '@/services/voice/trainer-turns';
import { setup, signIn, TODAY, verify } from '../helpers/app';

const SUBMIT_QUESTION = /ask whether to submit/i;
/** mark_remaining's check question in the review: one question, never also a yes to submitting (kept without a code). */
const CHECK_QUESTION = /ask only whether it is right/;
const TEXT_HOOKS: ReadonlySet<PropertyKey> = new Set(['onDraftChange', 'onScreen', 'onVerification', 'refresh', 'kickoff']);

async function voiceSession(
  trainerId = 'TR-10432', layer: ConfigLayer = {}, adjust: (ctx: SessionContext) => SessionContext = (c) => c, opts: { entropy?: () => number } = {},
) {
  const env = setup({ voice: { enabled: true }, ...layer });
  const ctx = adjust(await signIn(env.app, trainerId));
  const voicePlan = compileVoicePlan(ctx, 'en')!;
  const plan = voicePlan.marking!;
  const bus = new ActionBus();
  const nav: string[] = [];
  const events: UiEvent[] = [];
  bus.subscribe((e) => e.type === 'navigate' && nav.push(e.href));
  bus.subscribe((e) => events.push(e));
  const turns = new TrainerTurns(); // the session's counters, fed the events a real conversation would bring
  let generation = 1;
  const raw = createExecutor({
    ctx, plan: voicePlan, bus,
    attendance: env.app.services.attendance, verification: env.app.services.verification, drafts: env.app.services.drafts,
    announcements: env.app.services.announcements, staffAttendance: env.app.services.staffAttendance, reports: env.app.services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => turns.counts.speechSeq, turnSeq: () => turns.counts.turnSeq, spokeAtTurn: () => turns.counts.spokeAtTurn, generation: () => generation, entropy: opts.entropy ?? (() => 0.42),
  });
  /**
   * The invariant (Task 23 Part A), checked on every instruction and [APP] text of every scenario: a text that asks
   * whether to submit, while a submit could go ahead now, is asked in the review and carries its code.
   */
  const asked: string[] = [];
  let submitting = 0; // confirmed submit_attendance calls still running: no submit can go ahead meanwhile
  const check = (text: unknown) => {
    if (typeof text !== 'string' || !SUBMIT_QUESTION.test(text) || CHECK_QUESTION.test(text)) return;
    const flow = raw.flow();
    const draft = flow.sessionKey ? env.app.services.drafts.get(flow.sessionKey) : undefined;
    const could = !submitting && !!draft && !draft.locked && (flow.step === 'ROLL_CALL' || flow.step === 'REVIEW') && !completenessIssues(draft.marks, ctx.config.marking).length;
    if (!could) return;
    asked.push(text);
    expect(text, 'a submit question without its code').toMatch(/confirm_token "[A-Z0-9]{4}"/);
    expect(flow.step, 'a submit question outside the review').toBe('REVIEW');
  };
  const ex = new Proxy(raw, {
    get(target, prop) {
      const value: unknown = Reflect.get(target, prop);
      if (typeof value !== 'function' || !TEXT_HOOKS.has(prop)) return value;
      return (...a: unknown[]) => {
        const out: unknown = value.apply(target, a);
        if (out instanceof Promise) return out.then((t: unknown) => (check(t), t));
        check(out);
        return out;
      };
    },
  }) as VoiceExecutor;
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const confirmed = name === 'submit_attendance' && args.confirm_token !== undefined;
    if (confirmed) submitting += 1;
    const result = await ex.execute({ id: name, name, args }).finally(() => {
      if (confirmed) submitting -= 1;
    });
    check(result.instruction);
    return result;
  };
  return {
    env, ctx, plan, ex, call, nav, events, asked,
    /** The model's turn ends (it asked), then the trainer speaks. */
    speak: () => { turns.observe({ turnComplete: true }); turns.observe({ inputText: 'yes' }); },
    /** Raw server events, for the ordering cases (late transcript fragments, a turn that has not ended). */
    observe: (e: { inputText?: string; interrupted?: boolean; turnComplete?: boolean }) => turns.observe(e),
    /** A new connection: every code is void, then texts are built for the next generation (the session's adopted hook). */
    newConnection: () => { raw.voidConfirmations(); generation += 1; },
  };
}

type Student = { id: string; roll: number; name: string; call_as: string };
const cur = (r: ToolResult) => (r.current as Student | undefined) ?? null;
const NO_CHECK: ConfigLayer = { verification: { geoMode: 'off', face: false } };

/** Electrician, Shift 1 Unit 2: the prototype roster (31 students; Aditi Joshi is roll 2, Rahul Kumar roll 21). */
async function openEleS1U2(s: Awaited<ReturnType<typeof voiceSession>>) {
  await s.call('select_trade', { trade: 'Electrician' });
  const opened = await s.call('select_batch', { batch: 'shift 1 unit 2' });
  expect(opened.ok).toBe(true);
  return { opened, key: s.ex.flow().sessionKey! };
}

/** The trainer taps Aditi Joshi (roll 2) absent on the roster; the change goes to the executor as the voice session forwards it. */
function tapAditiAbsent(s: Awaited<ReturnType<typeof voiceSession>>, key: string): string | null {
  const { drafts } = s.env.app.services;
  let change: DraftChange | undefined;
  const stop = drafts.subscribe(key, (c) => (change = c));
  drafts.setMark(key, 'ele-s1u2-r02', { status: 'absent' }, { via: 'tap' });
  stop();
  return change ? s.ex.onDraftChange(change) : null; // a held draft (a submit is saving) takes no tap: no change, nothing told
}

describe('voice executor: Maharashtra open mapping, fence + face, by exception', () => {
  it('trade → batch → verification → exceptions → confirmed submit', async () => {
    const s = await voiceSession();
    expect((await s.call('get_trades')).trades).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Electrician' })]));
    const trade = await s.call('select_trade', { trade: 'electrician' });
    expect(trade).toMatchObject({ ok: true, step: 'SELECT_BATCH', counts: null, current: null });
    expect(s.nav.at(-1)).toBe('/attendance/trade?trade=ele');

    const opening = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(opening).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(JSON.stringify(opening)).not.toMatch(/Aarav|Aditi/); // no names before the pass
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/open\?s=ele-s1u2\./);

    const key = s.ex.flow().sessionKey!;
    const loc = await s.env.app.services.verification.checkLocation(s.ctx, { kind: 'session', key });
    await s.env.app.services.verification.grant(s.ctx, { kind: 'session', key }, loc.ok ? loc.value : undefined);
    const opened = await s.ex.onVerification({ type: 'granted', purpose: `session:${key}` });
    expect(opened).toMatch(/^\[APP\]/);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', rollCall: false, currentId: null });

    const absent = await s.call('set_student_status', { student: 'Aditi', status: 'absent', heard: 'Aditi absent' });
    expect(absent).toMatchObject({ ok: true, by_exception: true });
    expect(Object.values(s.env.app.services.drafts.get(key)!.sources)).toEqual([expect.objectContaining({ via: 'voice', heard: 'Aditi absent' })]);

    const ask = await s.call('submit_attendance');
    expect(ask).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', confirm_token: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}$/) });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);

    expect(await s.call('submit_attendance', { confirm_token: ask.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' }); // trainer has not spoken
    s.speak();
    const again = await s.call('submit_attendance');
    s.observe({ inputText: 'haan' }); // a late fragment of the trainer's turn, the asking turn not over: it does not count
    expect(await s.call('submit_attendance', { confirm_token: again.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
    const third = await s.call('submit_attendance');
    s.speak();
    const done = await s.call('submit_attendance', { confirm_token: third.confirm_token });
    expect(done).toMatchObject({ ok: true, step: 'SUBMITTED', submission_id: expect.any(String) });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/submitted\?s=/);
    expect(await s.call('set_student_status', { student: 'Aditi', status: 'present' })).toMatchObject({ ok: false, error: 'LOCKED' });
  });

  it('roll call (blank default): first student, NOT_CURRENT, a skipped student comes back last, REVIEW when all are marked', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, marking: { defaultStatus: 'blank' } });
    const { opened } = await openEleS1U2(s);
    expect(opened).toMatchObject({ step: 'ROLL_CALL', current: { roll: 1, name: 'Aarav Pawar' } });
    const first = cur(opened)!;
    expect(await s.call('mark_attendance', { student_id: 'ele-s1u2-r05', status: 'PRESENT' })).toMatchObject({ ok: false, error: 'NOT_CURRENT', current: { id: first.id } });

    const marked = await s.call('mark_attendance', { student_id: first.id, status: 'PRESENT', heard: 'haazir' });
    expect(marked).toMatchObject({ ok: true, last_marked: { id: first.id, status: 'PRESENT' }, current: { roll: 2 } });
    const second = cur(marked)!;
    let r = await s.call('skip_student', { student_id: second.id });
    expect(r).toMatchObject({ ok: true, skipped: { id: second.id }, current: { roll: 3 } });
    while (cur(r) && cur(r)!.id !== second.id) r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: 'present' });
    expect(cur(r)?.id).toBe(second.id);
    r = await s.call('mark_attendance', { student_id: second.id, status: 'absent' });
    expect(r).toMatchObject({ ok: true, step: 'REVIEW', all_marked: true, counts: { PRESENT: 30, ABSENT: 1, UNMARKED: 0 } });
    expect(s.ex.flow().step).toBe('REVIEW');
  });

  it('namesakes: AMBIGUOUS with both candidates and their fathers; mark_remaining is refused once and sweeps nobody in', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, time: { fencing: false } });
    const first = (name: string) => name.split(' ')[0];
    let found: { batchId: string; name: string; ids: string[] } | undefined;
    for (const b of s.ctx.data.batches.filter((x) => s.ctx.access.batchIds.has(x.id))) {
      const students = s.ctx.data.students.filter((st) => st.batchId === b.id);
      const pair = (n: string) => students.filter((st) => first(st.name) === n);
      // a father who shares the first name would tell the two apart, so such a pair is no namesake test
      const name = [...new Set(students.map((st) => first(st.name)))].find((n) => pair(n).length === 2 && pair(n).every((st) => first(st.fatherName) !== n));
      const cards = await s.env.app.services.attendance.cardsForBatch(s.ctx, b.id);
      if (name && cards.some((c) => c.status === 'open')) {
        found = { batchId: b.id, name, ids: pair(name).map((st) => st.id) };
        break;
      }
    }
    if (!found) throw new Error('No open batch has two students with the same first name: add two namesakes to the seed in src/data/mock');
    const batch = s.ctx.data.batches.find((b) => b.id === found!.batchId)!;
    await s.call('select_trade', { trade: s.ctx.data.trades.find((t) => t.id === batch.tradeId)!.name });
    expect(await s.call('select_batch', { batch: `shift ${batch.shift} unit ${batch.unit}` })).toMatchObject({ ok: true, step: 'ROLL_CALL' });
    const key = s.ex.flow().sessionKey!;

    const amb = await s.call('set_student_status', { student: found.name, status: 'absent' });
    expect(amb).toMatchObject({ ok: false, error: 'AMBIGUOUS' });
    const candidates = amb.candidates as { id: string; father_name: string }[];
    expect(candidates.map((c) => c.id).sort()).toEqual([...found.ids].sort());
    expect(candidates.every((c) => c.father_name.length > 0)).toBe(true);

    expect(await s.call('mark_remaining', { status: 'PRESENT' })).toMatchObject({ ok: false, error: 'WRONG_STEP', unresolved: [found.name] });
    const sources = s.env.app.services.drafts.get(key)!.sources;
    expect(found.ids.filter((id) => id in sources)).toEqual([]);
  });

  it('details: half day asks for the half, leave asks for its type and converts leave_days with the session date', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, marking: { statusSet: ['present', 'absent', 'half_day', 'leave'], halfDayHalves: true } });
    const { key } = await openEleS1U2(s);
    const drafts = s.env.app.services.drafts;
    expect(await s.call('set_student_status', { student: 'Aditi', status: 'HALF_DAY' })).toMatchObject({ ok: false, error: 'NEEDS_DETAIL', need: 'half' });
    expect(await s.call('set_student_status', { student: 'Aditi', status: 'half day', half: 'second' })).toMatchObject({ ok: true, new_status: 'HALF_DAY', half: 'second' });
    expect(drafts.get(key)!.marks['ele-s1u2-r02']).toEqual({ status: 'half_day', half: 2 });

    expect(await s.call('set_student_status', { student: 'Rahul', status: 'leave' })).toMatchObject({ ok: false, error: 'NEEDS_DETAIL', need: 'leave_type' });
    expect(await s.call('set_student_status', { student: 'Rahul', status: 'LEAVE', leave_type: 'SICK', leave_days: 61 })).toMatchObject({ ok: false, error: 'INVALID' });
    expect(await s.call('set_student_status', { student: 'Rahul', status: 'LEAVE', leave_type: 'SICK', leave_days: 3 })).toMatchObject({ ok: true, leave_type: 'SICK', leave_until: addDays(TODAY, 2) });
    expect(drafts.get(key)!.marks['ele-s1u2-r21']).toEqual({ status: 'leave', leaveType: 'sick', leaveUntil: addDays(TODAY, 2) });
    // "only today" shortens the leave again
    await s.call('set_student_status', { student: 'Rahul', status: 'LEAVE', leave_days: 1 });
    expect(drafts.get(key)!.marks['ele-s1u2-r21']).toEqual({ status: 'leave', leaveType: 'sick' });
  });

  it('OJT: LOCKED_OJT, never current in a roll call, counted under OJT', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, marking: { statusSet: ['present', 'absent', 'ojt'], defaultStatus: 'blank' } });
    const { opened } = await openEleS1U2(s);
    expect(opened.counts).toMatchObject({ OJT: 2 });
    expect(await s.call('set_student_status', { student: 'Ankita', status: 'absent' })).toMatchObject({ ok: false, error: 'LOCKED_OJT' });
    const called: number[] = [];
    let r = opened;
    while (cur(r)) {
      called.push(cur(r)!.roll);
      r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: 'PRESENT' });
    }
    expect(called).not.toContain(6);
    expect(called).not.toContain(13);
    expect(r).toMatchObject({ step: 'REVIEW', counts: { PRESENT: 29, OJT: 2, UNMARKED: 0 } });
  });

  it('time fence: the window closes mid-marking → WINDOW_CLOSED with the closing time, the draft survives', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    const ask = await s.call('submit_attendance');
    s.speak();
    s.env.clock.set(instantAt(TODAY, '14:30'));
    expect(await s.call('submit_attendance', { confirm_token: ask.confirm_token })).toMatchObject({ ok: false, error: 'WINDOW_CLOSED', closes: '2:00 pm' });
    expect(s.env.app.services.drafts.get(key)!.marks['ele-s1u2-r02']).toEqual({ status: 'absent' });
    expect(s.ex.flow().step).toBe('REVIEW');
  });

  it('already submitted: ALREADY_SUBMITTED and the screen shows the record', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    expect(await s.call('select_batch', { batch: 'shift 1 unit 1' })).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/record\?s=ele-s1u1\./);
    expect(s.ex.flow().step).toBe('SELECT_BATCH');
  });

  it('a tap during the confirmation voids the token and is told to the model', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK, undefined, { entropy: varyingEntropy() });
    const { key } = await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION', counts: { PRESENT: 31, ABSENT: 0 } });
    let change: DraftChange | undefined;
    s.env.app.services.drafts.subscribe(key, (c) => (change = c));
    s.env.app.services.drafts.setMark(key, 'ele-s1u2-r02', { status: 'absent' }, { via: 'tap' });
    const told = s.ex.onDraftChange(change!);
    expect(told).toMatch(/^\[APP\] Trainer tapped ABSENT for Aditi Joshi/);
    expect(told).not.toContain(`confirm_token "${ask.confirm_token}"`); // the tap asks again with a new code (Task 23 A1)
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: ask.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', counts: { PRESENT: 30, ABSENT: 1 } });
    // voice's own changes and rebuilds say nothing
    expect(s.ex.onDraftChange({ ...change!, via: 'voice' })).toBeNull();
    expect(s.ex.onDraftChange({ ...change!, kind: 'opened', via: 'system' })).toBeNull();
  });

  it('a tap while the confirmed submit is saving is refused by the held draft: nothing is told, and the record, voice and the screen agree', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const { attendance, drafts } = s.env.app.services;
    const ask = await s.call('submit_attendance');
    s.speak();
    let heard: string | null = 'not tapped';
    let during: unknown;
    const real = attendance.submit.bind(attendance);
    vi.spyOn(attendance, 'submit').mockImplementationOnce(async (...a) => {
      heard = tapAditiAbsent(s, key); // the trainer taps Aditi absent on the roster while the service saves
      during = drafts.get(key)!.marks['ele-s1u2-r02'];
      return real(...a);
    });
    const done = await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, step: 'SUBMITTED', counts: { PRESENT: 31, ABSENT: 0 } });
    expect(done.instruction).not.toMatch(/changed/);
    expect(heard).toBeNull();
    expect(during).not.toEqual({ status: 'absent' }); // the tap did not reach the draft (the screen shows what is sent)
    // the stored submission, the voice side's locked snapshot and get_status all agree
    expect((await attendance.getDetail(s.ctx, key))!.submission!.marks['ele-s1u2-r02']).toEqual({ status: 'present' });
    expect(await s.call('get_status')).toMatchObject({ step: 'SUBMITTED', counts: { PRESENT: 31, ABSENT: 0 }, last_marked: null });
    expect(drafts.get(key)).toBeUndefined();
  });

  it('a tap while the submit is saving is refused even when the submit fails; once it ends, taps count again', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    s.speak();
    let heard: string | null = 'not tapped';
    vi.spyOn(s.env.app.services.attendance, 'submit').mockImplementationOnce(async () => {
      heard = tapAditiAbsent(s, key);
      return { ok: false, error: 'window_closed' };
    });
    expect(await s.call('submit_attendance', { confirm_token: ask.confirm_token })).toMatchObject({ ok: false, error: 'WINDOW_CLOSED' });
    expect(heard).toBeNull();
    expect(s.env.app.services.drafts.get(key)!.marks['ele-s1u2-r02']).not.toEqual({ status: 'absent' });
    expect(s.env.app.services.drafts.isSubmitting(key)).toBe(false);
    expect(tapAditiAbsent(s, key)).toMatch(/^\[APP\] Trainer tapped ABSENT for Aditi Joshi/);
    expect(await s.call('get_status')).toMatchObject({ step: 'REVIEW', counts: { PRESENT: 30, ABSENT: 1 } });
  });

  it('a tap during the flush, before the marks are sent, is part of the submit and told as saved', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const { attendance, drafts } = s.env.app.services;
    const ask = await s.call('submit_attendance');
    s.speak();
    let heard: string | null = null;
    const flush = drafts.flush.bind(drafts);
    vi.spyOn(drafts, 'flush').mockImplementationOnce(async (k) => {
      heard = tapAditiAbsent(s, key);
      await flush(k);
    });
    expect(await s.call('submit_attendance', { confirm_token: ask.confirm_token })).toMatchObject({ ok: true, counts: { PRESENT: 30, ABSENT: 1 } });
    expect(heard).toMatch(/^\[APP\] Trainer tapped ABSENT for Aditi Joshi .*Already saved/);
    expect((await attendance.getDetail(s.ctx, key))!.submission!.marks['ele-s1u2-r02']).toEqual({ status: 'absent' });
  });

  it('leaving the review for the list voids its confirmation: a later yes is asked again', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    expect(await s.ex.onScreen({ kind: 'review', sessionKey: key })).toBeNull(); // voice opened it
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toMatch(/^\[APP\] Trainer went back to the student list on screen/);
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: ask.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
    expect(s.env.app.services.drafts.get(key)).toBeDefined();
  });

  it('verification off: select_batch opens the roster directly', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { opened } = await openEleS1U2(s);
    expect(opened).toMatchObject({ step: 'ROLL_CALL', by_exception: true, all_marked: true, counts: { PRESENT: 31 } });
    expect(opened.instruction).toContain('31 students');
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/mark\?s=ele-s1u2\./);
    expect(s.events.filter((e) => e.type === 'navigate').map((e) => e.type === 'navigate' && e.replace)).toEqual([false, false]);
  });

  it('batch mapping (TR-10518): no trade step, select_batch straight away, nothing about students before the pass', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    expect(s.plan.tradeStep).toBe(false);
    expect(await s.call('get_trades')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect((await s.call('get_status')).instruction).toContain('Shift 1, Unit 2, Electrician');
    expect(await s.call('select_batch', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/open\?s=ele-s1u2\./);
    const status = await s.call('get_status');
    expect(status).toMatchObject({ ok: true, step: 'VERIFY', batch: { label: 'Shift 1, Unit 2, Electrician' } });
    expect(status).not.toHaveProperty('current');
    expect(JSON.stringify(status)).not.toMatch(/Aarav|Aditi/);
  });

  it('timetable (TR-10377): periods, "period 3" opens it, a lone number is read as a shift', async () => {
    const s = await voiceSession('TR-10377', { ...NO_CHECK, mapping: { model: 'timetable' }, marking: { frequency: 'period' } });
    expect((await s.call('get_status')).instruction).toContain('Period 3');
    const lone = await s.call('select_batch', { batch: '3' });
    expect(lone).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(lone.instruction).toContain('"period <n>"');
    const opened = await s.call('select_batch', { batch: 'period 3' });
    expect(opened).toMatchObject({ ok: true, step: 'ROLL_CALL' });
    expect(s.ex.flow().sessionKey).toMatch(/^ele-s1u2\.\d{4}-\d{2}-\d{2}\.p3$/);
    expect(opened.instruction).toContain('Period 3');
  });

  it('unknown tool, a wrong status before an unknown student, and a throwing service', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    expect(await s.call('dance')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL', instruction: 'The app has no tool called dance. Use only the tools you were given.' });
    await openEleS1U2(s);
    expect(await s.call('set_student_status', { student: 'Nobody Here', status: 'maybe' })).toMatchObject({ ok: false, error: 'INVALID_STATUS' });
    expect(await s.call('set_student_status', { student: 'Nobody Here', status: 'absent' })).toMatchObject({ ok: false, error: 'NOT_FOUND' });

    const t = await voiceSession('TR-10432', NO_CHECK);
    vi.spyOn(t.env.app.services.attendance, 'openRoster').mockRejectedValue(new Error('boom'));
    await t.call('select_trade', { trade: 'Electrician' });
    expect(await t.call('select_batch', { batch: 'shift 1 unit 2' })).toEqual({
      ok: false,
      error: 'INTERNAL',
      instruction: 'Something went wrong in the app. Say sorry in a few words and repeat your last question.',
    });
  });

  it('end_voice_session asks for a goodbye and ends voice', async () => {
    const s = await voiceSession();
    expect(s.ex.endRequested).toBe(false);
    expect(await s.call('end_voice_session')).toEqual({ ok: true, instruction: 'Say goodbye in a few words. The attendance on screen is kept.' });
    expect(s.ex.endRequested).toBe(true);
    expect(s.events.at(-1)).toMatchObject({ type: 'end_voice' });
  });
});

describe('voice executor: marking details beyond the brief scenarios', () => {
  it('a roll call over a default status records the spoken answer even when it equals the default', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const started = await s.call('start_roll_call');
    expect(started).toMatchObject({ ok: true, current: { roll: 1 } });
    const r = await s.call('mark_attendance', { student_id: cur(started)!.id, status: 'PRESENT', heard: 'haan' });
    expect(r).toMatchObject({ ok: true, current: { roll: 2 }, progress: '1/31' });
    expect(s.env.app.services.drafts.get(key)!.sources['ele-s1u2-r01']).toMatchObject({ via: 'voice', heard: 'haan' });
  });

  it('mark_remaining asks with a token, then marks everyone not called yet', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, marking: { defaultStatus: 'blank' } });
    const { opened, key } = await openEleS1U2(s);
    await s.call('mark_attendance', { student_id: cur(opened)!.id, status: 'ABSENT' });
    const ask = await s.call('mark_remaining', { status: 'PRESENT' });
    expect(ask).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', count: 30, confirm_token: expect.any(String) });
    expect(ask.instruction).toContain('whether to mark the remaining 30 students present');
    s.speak();
    const done = await s.call('mark_remaining', { status: 'PRESENT', confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, count_marked: 30, step: 'REVIEW', counts: { PRESENT: 30, ABSENT: 1, UNMARKED: 0 } });
    expect(s.env.app.services.drafts.get(key)!.sources['ele-s1u2-r31']).toMatchObject({ via: 'voice', heard: 'mark_remaining' });
  });

  it('history: forward steps push, the result screens replace; the trade switcher shows the trade in place', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    s.speak();
    await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    const navs = s.events.flatMap((e) => (e.type === 'navigate' ? [[e.href.split('?')[0], e.replace] as const] : []));
    expect(navs).toEqual([
      ['/attendance/trade', false],
      ['/attendance/mark', false],
      ['/attendance/review', false],
      ['/attendance/submitted', true],
    ]);

    const sw = await voiceSession('TR-10455', { mapping: { model: 'trade' } }); // Fitter and Welder: the trade switcher
    expect(sw.plan.selection).toBe('trade_switcher');
    expect(await sw.call('select_trade', { trade: 'welder' })).toMatchObject({ ok: true, step: 'SELECT_BATCH', trade: { id: 'wel' } });
    expect(sw.events).toEqual([expect.objectContaining({ type: 'show_trade', tradeId: 'wel' })]);
  });

  it('go_back keeps the marks (D-083) and returns to the batch list', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    expect(await s.call('go_back', { to: 'batch' })).toMatchObject({ ok: true, step: 'SELECT_BATCH', counts: null, current: null });
    expect(s.nav.at(-1)).toBe('/attendance/trade?trade=ele');
    expect(s.env.app.services.drafts.get(key)!.marks['ele-s1u2-r02']).toEqual({ status: 'absent' });
    expect(await s.call('go_back', { to: 'trade' })).toMatchObject({ ok: true, step: 'SELECT_TRADE' });
    expect(s.nav.at(-1)).toBe('/home');
    expect(await s.call('verify_again')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' }); // no check, no tool
  });
});

describe('voice executor: screens and verification events', () => {
  it('a roll call opened by the verification pass or by a tap marks its first student current (m13)', async () => {
    const focusOf = (s: Awaited<ReturnType<typeof voiceSession>>) => s.events.filter((e) => e.type === 'focus_student');
    // the pass opens the batch (Maharashtra: fence + face)
    const v = await voiceSession('TR-10432', { marking: { defaultStatus: 'blank' } });
    await v.call('select_trade', { trade: 'Electrician' });
    expect(await v.call('select_batch', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: true, step: 'VERIFY' });
    const key = v.ex.flow().sessionKey!;
    const loc = await v.env.app.services.verification.checkLocation(v.ctx, { kind: 'session', key });
    await v.env.app.services.verification.grant(v.ctx, { kind: 'session', key }, loc.ok ? loc.value : undefined);
    expect(focusOf(v)).toEqual([]);
    expect(await v.ex.onVerification({ type: 'granted', purpose: `session:${key}` })).toMatch(/^\[APP\]/);
    const first = v.ex.flow();
    expect(first).toMatchObject({ step: 'ROLL_CALL', rollCall: true, currentId: expect.any(String) });
    expect(focusOf(v)).toEqual([expect.objectContaining({ sessionKey: key, studentId: first.currentId })]);

    // a batch the trainer opens on screen
    const t = await voiceSession('TR-10432', { ...NO_CHECK, marking: { defaultStatus: 'blank' } });
    const tapped = (await t.env.app.services.attendance.cardsForBatch(t.ctx, 'ele-s1u2'))[0].key;
    expect(await t.ex.onScreen({ kind: 'mark', sessionKey: tapped })).toMatch(/^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen\./);
    expect(t.ex.flow()).toMatchObject({ step: 'ROLL_CALL', rollCall: true, currentId: expect.any(String) });
    expect(focusOf(t)).toEqual([expect.objectContaining({ sessionKey: tapped, studentId: t.ex.flow().currentId })]);
  });

  it('tap navigation: voice-made screens say nothing; a tapped trade, the home tab, a batch and the review are told', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await s.call('select_trade', { trade: 'Electrician' });
    expect(await s.ex.onScreen({ kind: 'trade', tradeId: 'ele' })).toBeNull();
    expect(await s.ex.onScreen({ kind: 'trade', tradeId: 'fit' })).toMatch(/^\[APP\] Trainer chose Fitter on screen\./);
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'fit' });
    expect(await s.ex.onScreen({ kind: 'home' })).toMatch(/^\[APP\] Trainer went back to the trade list on screen\./);
    expect(s.ex.flow().step).toBe('SELECT_TRADE');

    const key = (await s.env.app.services.attendance.cardsForBatch(s.ctx, 'ele-s1u2'))[0].key;
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toMatch(/^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen\./);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: key, tradeId: 'ele' });
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toBeNull();

    const review = await s.ex.onScreen({ kind: 'review', sessionKey: key });
    expect(review).toMatch(/^\[APP\] Trainer opened the review on screen/);
    const token = /confirm_token "([A-Z0-9]{4})"/.exec(review!)![1];
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: token })).toMatchObject({ ok: true, step: 'SUBMITTED' });
  });

  it('a batch opened by hand while voice showed Reconnect: after Reconnect, the flow and get_status are about that batch (final fix F6)', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, time: { fencing: false } });
    const { key: a } = await openEleS1U2(s);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: a });
    // the session runs the screen hooks while in error (their texts are not sent): Back, then batch B's roster
    const b = (await s.env.app.services.attendance.cardsForBatch(s.ctx, 'ele-s1u3'))[0].key;
    await s.ex.onScreen({ kind: 'home' });
    await s.ex.onScreen({ kind: 'mark', sessionKey: b });
    s.newConnection(); // Reconnect
    await s.ex.kickoff('reconnect', 'English');
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: b });
    const status = await s.call('get_status');
    expect(status).toMatchObject({ ok: true, step: 'ROLL_CALL', batch: { label: 'Shift 1, Unit 3, Electrician' } });
  });

  it('verification events: only the session being verified, prompts once, an unfinished face check, a failed face', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    expect(await s.call('verify_again')).toMatchObject({ ok: false, error: 'WRONG_STEP', step: 'SELECT_BATCH' });
    await s.call('select_batch', { batch: 'shift 1 unit 2' });
    const purpose = `session:${s.ex.flow().sessionKey}`;
    expect(await s.ex.onVerification({ type: 'prompt', purpose: 'session:other', need: 'location_permission' })).toBeNull();
    expect(await s.ex.onVerification({ type: 'prompt', purpose, need: 'location_permission' })).toMatch(/allow location on the screen/);
    expect(await s.ex.onVerification({ type: 'prompt', purpose, need: 'location_permission' })).toBeNull();
    expect(await s.ex.onVerification({ type: 'location', purpose, result: 'inside', distanceM: 40 })).toBeNull();
    expect(await s.ex.onVerification({ type: 'camera', purpose, on: true })).toMatch(/face camera is open/);
    expect(await s.ex.onVerification({ type: 'camera', purpose, on: false })).toMatch(/face check did not finish/);
    await s.ex.onVerification({ type: 'camera', purpose, on: true });
    expect(await s.ex.onVerification({ type: 'face', purpose, result: 'no_match' })).toMatch(/Face check failed: the face did not match/);
    expect(await s.ex.onVerification({ type: 'camera', purpose, on: false })).toBeNull();
    expect(await s.call('verify_again')).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(s.events.at(-1)).toMatchObject({ type: 'verify_retry', purpose: `session:${s.ex.flow().sessionKey}` });
    expect(s.ex.flow().step).toBe('VERIFY');
  });

  it('face enrolment first: the gateway still opens and the trainer is asked to register on screen', async () => {
    const s = await voiceSession('TR-10432', {}, (ctx) => ({ ...ctx, journey: { ...ctx.journey, faceEnrolmentRequired: true } }));
    await s.call('select_trade', { trade: 'Electrician' });
    const r = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(r).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(r.instruction).toContain('register their face on the screen first');
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/open\?s=/);
    // the gateway's own prompt for the same thing is not repeated
    expect(await s.ex.onVerification({ type: 'prompt', purpose: `session:${s.ex.flow().sessionKey}`, need: 'face_enrolment' })).toBeNull();
  });

  it('kickoff and refresh texts come from the flow', async () => {
    const s = await voiceSession();
    expect(await s.ex.kickoff('start', 'English')).toMatch(/^\[APP\] Session started\. Greet the trainer by first name in one short line in English \("Good morning, <first name>\."\), then ask which trade/);
    expect(await s.ex.kickoff('reconnect', 'English')).toBe('[APP] Reconnected. Call get_status and continue from the current student.');
    expect(await s.ex.refresh(null)).toMatch(/^\[APP\] The connection was refreshed; trust these facts over your memory\. We are choosing the trade\./);
  });
});

type Session = Awaited<ReturnType<typeof voiceSession>>;
const BLANK_ROLL_CALL: ConfigLayer = { ...NO_CHECK, marking: { defaultStatus: 'blank' } };
/** Codes that differ from one ticket to the next (the golden-ratio sequence), so an old code can be told from a new one. */
const varyingEntropy = () => {
  let n = 0;
  return () => (n++ * 0.6180339887) % 1;
};
/** Every async step of the mock services is a microtask (speed 0): one macrotask lets every pending call run as far as it can. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/** As the voice session forwards every draft change to the executor, synchronously, voice's own included (Task 16). */
function forwardDraftChanges(s: Session): string[] {
  const told: string[] = [];
  s.env.app.services.drafts.subscribe('*', (c) => {
    const text = s.ex.onDraftChange(c);
    if (text) told.push(text);
  });
  return told;
}

/** A roll call over Shift 1 Unit 2 to its last student: Rahul Kumar (roll 21) absent, everyone else present. */
async function rollCallToReview(s: Session) {
  const { opened, key } = await openEleS1U2(s);
  let r = opened;
  while (cur(r)) r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: cur(r)!.roll === 21 ? 'ABSENT' : 'PRESENT' });
  return { last: r, key };
}

describe('voice executor: a result that leaves everyone marked asks the submit question with its code', () => {
  it('roll call: the last mark asks with a code and shows the review, so one clear yes submits', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    forwardDraftChanges(s); // voice's own last mark must not void the code its result carries
    const { last } = await rollCallToReview(s);
    expect(last).toMatchObject({ ok: true, step: 'REVIEW', all_marked: true, counts: { PRESENT: 30, ABSENT: 1 }, confirm_token: expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}$/) });
    expect(last.instruction).toContain('Then say everyone is marked. In one line, read the counts: 30 present, 1 absent (absent: Rahul Kumar), then ask whether to submit, saying it is final');
    expect(last.instruction).toContain(`Call submit_attendance with confirm_token "${last.confirm_token}" only after a clear yes.`);
    expect(s.events.filter((e) => e.type === 'navigate').at(-1)).toMatchObject({ href: expect.stringMatching(/^\/attendance\/review\?s=/), replace: false });
    const submit = vi.spyOn(s.env.app.services.attendance, 'submit');
    s.speak(); // "haan"
    expect(await s.call('submit_attendance', { confirm_token: last.confirm_token })).toMatchObject({ ok: true, step: 'SUBMITTED', counts: { PRESENT: 30, ABSENT: 1 } });
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it('the code still needs the trainer to speak after it, and a tap voids it (D-082)', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { last } = await rollCallToReview(s);
    expect(last.confirm_token).toEqual(expect.any(String));
    expect(await s.call('submit_attendance', { confirm_token: last.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' }); // asked and confirmed in one breath

    const t = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    const { last: asked, key } = await rollCallToReview(t);
    expect(asked.confirm_token).toEqual(expect.any(String));
    const told = tapAditiAbsent(t, key);
    expect(told).toMatch(/^\[APP\] Trainer tapped ABSENT for Aditi Joshi/);
    expect(told).not.toContain(`confirm_token "${asked.confirm_token}"`); // the tap asks again with a new code (Task 23 A1)
    t.speak();
    expect(await t.call('submit_attendance', { confirm_token: asked.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', counts: { PRESENT: 29, ABSENT: 2 } });
    expect(t.env.app.services.drafts.get(key)).toBeDefined();
  });

  it('mark_remaining completing asks with a code', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    const { opened } = await openEleS1U2(s);
    await s.call('mark_attendance', { student_id: cur(opened)!.id, status: 'ABSENT' });
    const ask = await s.call('mark_remaining', { status: 'PRESENT' });
    s.speak();
    const done = await s.call('mark_remaining', { status: 'PRESENT', confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, count_marked: 30, step: 'REVIEW', confirm_token: expect.any(String) });
    expect(done.confirm_token).not.toBe(ask.confirm_token);
    expect(done.instruction).toMatch(/^Say everyone is marked\. In one line, read the counts: 30 present, 1 absent \(absent: Aarav Pawar\), then /);
    expect(done.instruction).toContain(`Call submit_attendance with confirm_token "${done.confirm_token}" only after a clear yes.`);
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: done.confirm_token })).toMatchObject({ ok: true, step: 'SUBMITTED' });
  });

  it('a correction in the review asks again with a new code for the new counts; the old code is refused', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    const { last } = await rollCallToReview(s);
    const fix = await s.call('set_student_status', { student: 'Aditi', status: 'absent', heard: 'Aditi absent thi' });
    expect(fix).toMatchObject({ ok: true, step: 'REVIEW', counts: { PRESENT: 29, ABSENT: 2 }, confirm_token: expect.any(String) });
    expect(fix.confirm_token).not.toBe(last.confirm_token);
    expect(fix.instruction).toContain('Then say everyone is marked. In one line, read the counts: 29 present, 2 absent (absent: Aditi Joshi, Rahul Kumar), then');
    expect(fix.instruction).toContain(`confirm_token "${fix.confirm_token}"`);
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: last.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });

    const t = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    await rollCallToReview(t);
    const again = await t.call('set_student_status', { student: 'Aditi', status: 'absent' });
    t.speak();
    expect(await t.call('submit_attendance', { confirm_token: again.confirm_token })).toMatchObject({ ok: true, step: 'SUBMITTED', counts: { PRESENT: 29, ABSENT: 2 } });
  });

  it('get_status and a roll-call tool in the review ask with a code; the check question of mark_remaining drops it', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    await rollCallToReview(s);
    const status = await s.call('get_status');
    expect(status).toMatchObject({ ok: true, step: 'REVIEW', counts: { PRESENT: 30, ABSENT: 1 }, confirm_token: expect.any(String) });
    expect(status.instruction).toMatch(/^Everyone is marked\. In one line, read the counts: 30 present, 1 absent \(absent: Rahul Kumar\), then /);
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: status.confirm_token })).toMatchObject({ ok: true, step: 'SUBMITTED' });

    const t = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { last } = await rollCallToReview(t);
    const wrong = await t.call('mark_attendance', { student_id: 'ele-s1u2-r05', status: 'PRESENT' });
    expect(wrong).toMatchObject({ ok: false, error: 'WRONG_STEP', step: 'REVIEW', confirm_token: expect.any(String) });
    expect(wrong.instruction).toContain(`Call submit_attendance with confirm_token "${wrong.confirm_token}" only after a clear yes.`);
    // "nahi, sab present, sirf Rahul absent": one check question, so a yes to it is never a yes to submitting
    const check = await t.call('mark_remaining', { status: 'PRESENT' });
    expect(check).toMatchObject({ ok: false, error: 'WRONG_STEP', step: 'REVIEW' });
    expect(check).not.toHaveProperty('confirm_token');
    t.speak();
    expect(await t.call('submit_attendance', { confirm_token: last.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
  });

  it('a roll call over the default status: start_roll_call in the review asks with a code too', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    let r = await s.call('select_trade', { trade: 'Electrician' }).then(() => s.call('select_batch', { batch: 'shift 1 unit 2' })).then(() => s.call('start_roll_call'));
    while (cur(r)) r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: 'PRESENT' });
    expect(r).toMatchObject({ ok: true, step: 'REVIEW', counts: { PRESENT: 31 }, confirm_token: expect.any(String) });
    const again = await s.call('start_roll_call');
    expect(again).toMatchObject({ ok: true, step: 'REVIEW', confirm_token: expect.any(String) });
    expect(again.instruction).toMatch(/^Every student is already marked\. Say so\. In one line, read the counts: 31 present \(everyone present\), then /);
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: again.confirm_token })).toMatchObject({ ok: true, step: 'SUBMITTED' });
  });
});

/**
 * The review screen's own Submit (ReviewScreen.submit): the draft held while the service saves the snapshot it
 * returned, then closed as a tap submit carrying what was sent, then released.
 */
async function screenSubmit(s: Session, key: string) {
  const { attendance, drafts } = s.env.app.services;
  return drafts.whileSubmitting(key, async (sent) => {
    const result = await attendance.submit(s.ctx, key, sent!.marks);
    if (result.ok) drafts.close(key, { kind: 'submitted', via: 'tap', sent });
    return result;
  });
}

/** Spies on the service submit: records every saved submission, and can hold call number `hold` (0-based) until released. */
function watchSubmits(s: Session, hold: number | null = null) {
  const { attendance } = s.env.app.services;
  const real = attendance.submit.bind(attendance);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const saved: string[] = [];
  let calls = 0;
  const spy = vi.spyOn(attendance, 'submit').mockImplementation(async (...a) => {
    if (calls++ === hold) await gate;
    const result = await real(...a);
    if (result.ok) saved.push(result.value.id);
    return result;
  });
  return { spy, saved, release };
}

/** By exception on Shift 1 Unit 2, the submit question asked and the trainer has answered: a valid code in hand. */
async function readyToSubmit() {
  const s = await voiceSession('TR-10432', NO_CHECK);
  const { key } = await openEleS1U2(s);
  const told = forwardDraftChanges(s);
  const ask = await s.call('submit_attendance');
  s.speak();
  return { s, key, told, token: ask.confirm_token };
}

/** After any race: one submission, and the voice side, get_status and a later submit all agree with it. */
async function oneSubmission(s: Session, key: string, saved: readonly string[], answer: ToolResult) {
  const stored = (await s.env.app.services.attendance.getDetail(s.ctx, key))!.submission!;
  expect(saved).toEqual([stored.id]);
  if (answer.error !== 'SUBMITTING') expect(answer.submission_id).toBe(stored.id); // SUBMITTING: voice saved nothing, said to wait
  expect(s.ex.flow().step).toBe('SUBMITTED');
  expect(s.env.app.services.drafts.get(key)).toBeUndefined();
  expect(await s.call('get_status')).toMatchObject({ step: 'SUBMITTED', submission_id: stored.id, counts: { PRESENT: 31, ABSENT: 0 } });
  expect(await s.call('submit_attendance')).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED', submission_id: stored.id });
}

describe('voice executor: submit races share one save', () => {
  it('two confirmed submit_attendance calls at once: one save, one submission, the same answer for both', async () => {
    const { s, key, token } = await readyToSubmit();
    const w = watchSubmits(s, 0);
    const first = s.call('submit_attendance', { confirm_token: token });
    const second = s.call('submit_attendance', { confirm_token: token });
    await settle(); // one call is saving; the other found that save running and waits on it
    expect(w.spy).toHaveBeenCalledTimes(1);
    w.release();
    const [a, b] = await Promise.all([first, second]);
    expect(a).toMatchObject({ ok: true, step: 'SUBMITTED', submission_id: expect.any(String), counts: { PRESENT: 31, ABSENT: 0 } });
    expect(b).toEqual(a);
    expect(w.spy).toHaveBeenCalledTimes(1);
    expect(s.nav.filter((href) => href.startsWith('/attendance/submitted'))).toHaveLength(1);
    await oneSubmission(s, key, w.saved, a);
  });

  it('the screen saves first while voice is saving: voice answers ALREADY_SUBMITTED and leaves the screen to the tap', async () => {
    const { s, key, told, token } = await readyToSubmit();
    const w = watchSubmits(s, 0); // voice's save is the first call: held
    const voice = s.call('submit_attendance', { confirm_token: token });
    await settle();
    const screen = await screenSubmit(s, key);
    expect(screen.ok).toBe(true);
    expect(told.at(-1)).toMatch(/^\[APP\] Trainer pressed Submit on screen\. Attendance for Shift 1, Unit 2, Electrician is submitted and locked/);
    w.release();
    const answer = await voice;
    expect(answer).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' });
    expect(s.nav.some((href) => href.startsWith('/attendance/record'))).toBe(false); // the screen shows its own submit
    await oneSubmission(s, key, w.saved, answer);
  });

  it('a voice yes while the screen is saving starts no second save: voice answers SUBMITTING and the screen saves (E4)', async () => {
    const { s, key, token } = await readyToSubmit();
    const w = watchSubmits(s, 0); // the screen's save is the first call: held
    const screen = screenSubmit(s, key);
    await settle();
    const answer = await s.call('submit_attendance', { confirm_token: token });
    expect(answer).toMatchObject({ ok: false, error: 'SUBMITTING' });
    expect(answer).not.toHaveProperty('confirm_token');
    expect(w.spy).toHaveBeenCalledTimes(1); // only the screen's save
    w.release();
    expect(await screen).toMatchObject({ ok: true });
    await oneSubmission(s, key, w.saved, answer);
  });

  it('the screen submit lands while voice flushes the draft: voice answers ALREADY_SUBMITTED, not a wrong step', async () => {
    const { s, key, token } = await readyToSubmit();
    const w = watchSubmits(s);
    const { drafts } = s.env.app.services;
    const flush = drafts.flush.bind(drafts);
    let screen: Awaited<ReturnType<typeof screenSubmit>> | undefined;
    vi.spyOn(drafts, 'flush').mockImplementationOnce(async (k) => {
      screen = await screenSubmit(s, key);
      await flush(k);
    });
    const answer = await s.call('submit_attendance', { confirm_token: token });
    expect(screen?.ok).toBe(true);
    expect(answer).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' });
    await oneSubmission(s, key, w.saved, answer);
  });

  it('a free race between the screen and voice: one submission, and voice answers ok, ALREADY_SUBMITTED or SUBMITTING to match', async () => {
    const { s, key, token } = await readyToSubmit();
    const w = watchSubmits(s);
    const [answer, screen] = await Promise.all([s.call('submit_attendance', { confirm_token: token }), screenSubmit(s, key)]);
    expect(answer.ok ? !screen.ok : screen.ok).toBe(true);
    expect(answer).toMatchObject(answer.ok ? { step: 'SUBMITTED' } : { error: expect.stringMatching(/^(ALREADY_SUBMITTED|SUBMITTING)$/) });
    await oneSubmission(s, key, w.saved, answer);
  });
});

/** The code a text asks with. */
const codeIn = (text: string | null) => /confirm_token "([A-Z0-9]{4})"/.exec(text ?? '')?.[1] ?? null;
const navigations = (s: Session) => s.events.filter((e) => e.type === 'navigate').length;

/** One clear yes with the code submits: SUBMITTED, and the service saved once. */
async function oneYesSubmits(s: Session, token: string | null) {
  expect(token).toEqual(expect.stringMatching(/^[A-HJ-NP-Z2-9]{4}$/));
  const submit = vi.spyOn(s.env.app.services.attendance, 'submit');
  s.speak(); // "haan"
  expect(await s.call('submit_attendance', { confirm_token: token })).toMatchObject({ ok: true, step: 'SUBMITTED' });
  expect(submit).toHaveBeenCalledTimes(1);
}

describe('voice executor: one clear yes everywhere (Task 23 Part A)', () => {
  it('A1: a tap on the last student of a voice roll call asks with a code and shows the review', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { opened, key } = await openEleS1U2(s);
    let r = opened;
    while (cur(r) && r.progress !== '30/31') r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: 'PRESENT' });
    const told = forwardDraftChanges(s);
    s.env.app.services.drafts.setMark(key, cur(r)!.id, { status: 'absent' }, { via: 'tap' });
    expect(told.at(-1)).toMatch(/^\[APP\] Trainer tapped ABSENT for .* Everyone is marked: 30 present, 1 absent\. .* Call submit_attendance with confirm_token "[A-Z0-9]{4}" only after a clear yes\.$/);
    expect(s.ex.flow().step).toBe('REVIEW');
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);
    await oneYesSubmits(s, codeIn(told.at(-1)!));
  });

  it('A1 while paused (Use screen): the last tap moves the flow only; no code, no review pushed; get_status asks on Resume', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { opened, key } = await openEleS1U2(s);
    let r = opened;
    while (cur(r) && r.progress !== '30/31') r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: 'PRESENT' });
    const { drafts } = s.env.app.services;
    const quiet: (string | null)[] = [];
    const stop = drafts.subscribe('*', (c) => quiet.push(s.ex.onDraftChange(c, true))); // the session is paused
    const before = navigations(s);
    drafts.setMark(key, cur(r)!.id, { status: 'absent' }, { via: 'tap' });
    stop();
    expect(quiet).toEqual([null]);
    expect(s.ex.flow().step).toBe('REVIEW');
    expect(navigations(s)).toBe(before); // the trainer's list stays on screen
    expect(await s.call('submit_attendance', { confirm_token: 'ABCD' })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' }); // no code was issued
    // Resume: get_status asks with the review, as today
    const status = await s.call('get_status');
    expect(status).toMatchObject({ step: 'REVIEW', confirm_token: expect.any(String) });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);
    await oneYesSubmits(s, status.confirm_token as string);
  });

  it('A2: by exception, "baaki sab present" (count 0) moves to the review and asks with a code', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await openEleS1U2(s);
    await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    const rest = await s.call('mark_remaining', { status: 'PRESENT' });
    expect(rest).toMatchObject({ ok: true, count_marked: 0, step: 'REVIEW', counts: { PRESENT: 30, ABSENT: 1 }, confirm_token: expect.any(String) });
    expect(rest.instruction).toMatch(/^Everyone not named is already present: 30 present, 1 absent\. Say that in one line\. In one line, read the counts: 30 present, 1 absent \(absent: Aditi Joshi\), then /);
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);
    await oneYesSubmits(s, rest.confirm_token as string);
  });

  it('A2: by exception, mark_remaining with another status completes the batch: the review, with a code', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK, undefined, { entropy: varyingEntropy() });
    await openEleS1U2(s);
    const ask = await s.call('mark_remaining', { status: 'ABSENT' });
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION', count: 31 });
    s.speak();
    const done = await s.call('mark_remaining', { status: 'ABSENT', confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, count_marked: 31, step: 'REVIEW', counts: { ABSENT: 31 }, confirm_token: expect.any(String) });
    expect(done.confirm_token).not.toBe(ask.confirm_token);
    await oneYesSubmits(s, done.confirm_token as string);
  });

  it('A3: start_roll_call when everyone already has a source moves to the review and asks with a code', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const { drafts } = s.env.app.services;
    drafts.setMany(key, drafts.get(key)!.students.map((st) => st.id), { status: 'absent' }, { via: 'tap' }); // tapped before voice heard of it
    const started = await s.call('start_roll_call');
    expect(started).toMatchObject({ ok: true, step: 'REVIEW', counts: { ABSENT: 31 }, confirm_token: expect.any(String) });
    expect(started.instruction).toMatch(/^Every student is already marked\. Say so\. In one line, read the counts: 31 absent, then /);
    await oneYesSubmits(s, started.confirm_token as string);
  });

  it('A4: a mark after the trainer went back from the review to the list asks with a code when everyone is marked', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    const { key } = await rollCallToReview(s);
    expect(await s.ex.onScreen({ kind: 'review', sessionKey: key })).toBeNull(); // voice showed it
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toMatch(/^\[APP\] Trainer went back to the student list/);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', currentId: null });
    const fix = await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    expect(fix).toMatchObject({ ok: true, step: 'REVIEW', counts: { PRESENT: 29, ABSENT: 2 }, confirm_token: expect.any(String) });
    expect(fix.instruction).toContain('Then say everyone is marked. In one line, read the counts: 29 present, 2 absent (absent: Aditi Joshi, Rahul Kumar), then');
    await oneYesSubmits(s, fix.confirm_token as string);
  });

  it('other sites: select_batch on an open batch in the review, and "sab present" in the review with nobody to check', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    await rollCallToReview(s);
    const again = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(again).toMatchObject({ ok: true, step: 'REVIEW', confirm_token: expect.any(String) });
    expect(again.instruction).toMatch(/^This batch is already open\. Everyone is marked\. In one line, read the counts: 30 present, 1 absent/);
    await oneYesSubmits(s, again.confirm_token as string);

    const t = await voiceSession('TR-10432', NO_CHECK);
    await openEleS1U2(t);
    await t.call('submit_attendance'); // the review
    const none = await t.call('mark_remaining', { status: 'PRESENT' });
    expect(none).toMatchObject({ ok: false, error: 'WRONG_STEP', step: 'REVIEW', confirm_token: expect.any(String) });
    expect(none.instruction).toMatch(/^Everyone is already marked \(31 present\), so nobody was changed\. In one line, read the counts: 31 present/);
    await oneYesSubmits(t, none.confirm_token as string);
  });

  it('select_batch on a batch where everyone already has a status opens it at the review, with a code', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { key } = await openEleS1U2(s);
    const { drafts } = s.env.app.services;
    drafts.setMany(key, drafts.get(key)!.students.map((st) => st.id), { status: 'present' }, { via: 'tap' });
    await s.call('go_back', { to: 'batch' });
    const opened = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(opened).toMatchObject({ ok: true, step: 'REVIEW', counts: { PRESENT: 31 }, confirm_token: expect.any(String) });
    expect(opened.instruction).toContain('Every student already has a status: 31 present. Say that in one line. In one line, read the counts: 31 present');
    // only the review is pushed (a list pushed first could send its signal and take the review back to the list)
    expect(s.nav.slice(-2).map((href) => href.split('?')[0])).toEqual(['/attendance/trade', '/attendance/review']);
    await oneYesSubmits(s, opened.confirm_token as string);
  });

  it('the invariant held across the scenarios that asked (every scenario checks it on each text)', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { last } = await rollCallToReview(s);
    expect(s.asked).toEqual([last.instruction]);
  });
});

describe('voice executor: refresh and reconnect at the review (Task 23 Part B1)', () => {
  it('a goAway refresh at the review asks with a code issued for the new connection; one yes submits', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL, undefined, { entropy: varyingEntropy() });
    const { last } = await rollCallToReview(s);
    s.newConnection();
    const text = await s.ex.refresh(last.instruction, 'bas');
    expect(text).toMatch(/^\[APP\] The connection was refreshed; trust these facts over your memory\. Last marked/);
    expect(text).toContain('The trainer last said: "bas" (already handled: do not act on it again). Your last question to the trainer was lost in the refresh: ask it again now, then wait. Its instruction was: In one line, read the counts: 30 present, 1 absent');
    expect(codeIn(text)).not.toBe(last.confirm_token);
    await oneYesSubmits(s, codeIn(text));

    const t = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    await rollCallToReview(t);
    t.newConnection();
    await oneYesSubmits(t, codeIn(await t.ex.refresh(null)));
  });

  it('Reconnect at the review asks with a code for the new connection; one yes submits', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    await rollCallToReview(s);
    s.newConnection();
    const text = await s.ex.kickoff('reconnect', 'English');
    expect(text).toMatch(/^\[APP\] Reconnected\. The trainer is at the review\. Ask this now, then wait: In one line, read the counts: 30 present, 1 absent/);
    await oneYesSubmits(s, codeIn(text));
  });

  it('elsewhere the texts are unchanged: a pending question without a code is asked again, and no code is issued', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    await rollCallToReview(s);
    s.newConnection();
    const which = 'More than one student matches "Rahul". Ask which one.';
    const text = await s.ex.refresh(which, 'Rahul absent');
    expect(text).toContain(`The trainer last said: "Rahul absent" (already handled: do not act on it again). Your last question to the trainer was lost in the refresh: ask it again now, then wait. Its instruction was: ${which}`);
    expect(codeIn(text)).toBeNull();
    const u = await voiceSession('TR-10432', NO_CHECK);
    await openEleS1U2(u);
    expect(await u.ex.kickoff('reconnect', 'English')).toBe('[APP] Reconnected. Call get_status and continue from the current student.');
  });
});

describe('voice executor: follow-ups (Task 23 Part C)', () => {
  it('C1: the review is not pushed again when the screen already shows it', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { key } = await rollCallToReview(s);
    expect(await s.ex.onScreen({ kind: 'review', sessionKey: key })).toBeNull();
    const before = navigations(s);
    const status = await s.call('get_status');
    expect(status.confirm_token).toEqual(expect.any(String));
    expect(navigations(s)).toBe(before);
    // nothing waits for a screen signal: a tap back to the list is told
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toMatch(/^\[APP\] Trainer went back to the student list/);
  });

  it('C2: an open that resolves after another path opened the batch answers with the current state, not a second open', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    await s.call('select_batch', { batch: 'shift 1 unit 2' });
    const key = s.ex.flow().sessionKey!;
    const { attendance, verification, drafts } = s.env.app.services;
    const loc = await verification.checkLocation(s.ctx, { kind: 'session', key });
    await verification.grant(s.ctx, { kind: 'session', key }, loc.ok ? loc.value : undefined);
    const real = attendance.openRoster.bind(attendance);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.spyOn(attendance, 'openRoster').mockImplementationOnce(async (...a) => {
      await gate;
      return real(...a);
    });
    const granted = s.ex.onVerification({ type: 'granted', purpose: `session:${key}` });
    await settle();
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toMatch(/^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen\./);
    const revision = drafts.get(key)!.revision;
    release();
    expect(await granted).toBeNull();
    expect(drafts.get(key)!.revision).toBe(revision);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: key });
  });

  it('C3: select_trade and go_back leave the flow and the screen unchanged when loading fails', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { attendance } = s.env.app.services;
    vi.spyOn(attendance, 'boardForTrade').mockRejectedValueOnce(new Error('boom'));
    expect(await s.call('select_trade', { trade: 'Electrician' })).toMatchObject({ ok: false, error: 'INTERNAL' });
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_TRADE', tradeId: null });
    expect(s.events).toEqual([]);

    await openEleS1U2(s);
    const before = { flow: s.ex.flow(), navs: navigations(s) };
    vi.spyOn(attendance, 'boardForTrade').mockRejectedValueOnce(new Error('boom'));
    expect(await s.call('go_back', { to: 'batch' })).toMatchObject({ ok: false, error: 'INTERNAL' });
    expect(s.ex.flow()).toBe(before.flow);
    expect(navigations(s)).toBe(before.navs);
  });

  it('C4: a review signal for a batch voice has not opened opens it and keeps its facts', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const key = (await s.env.app.services.attendance.cardsForBatch(s.ctx, 'ele-s1u2'))[0].key;
    const review = await s.ex.onScreen({ kind: 'review', sessionKey: key });
    expect(review).toMatch(/^\[APP\] Trainer opened the review of Shift 1, Unit 2, Electrician on screen: 31 present \(everyone present\)\. /);
    expect(s.ex.flow()).toMatchObject({ step: 'REVIEW', sessionKey: key });
    await oneYesSubmits(s, codeIn(review));

    const t = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    expect(await t.ex.onScreen({ kind: 'review', sessionKey: key })).toMatch(/^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen\. The first student is Aarav Pawar/);
    expect(t.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: key });
  });

  it('C5: a screen signal for a submitted batch says it is locked, never an open-batch instruction; its live draft is closed', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const submitted = (await s.env.app.services.attendance.cardsForBatch(s.ctx, 'ele-s1u1'))[0].key;
    const locked = '[APP] Trainer opened Shift 1, Unit 1, Electrician on screen. It was already submitted today and is locked; the screen shows what was saved. Say so in one short line and ask for another batch.';
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: submitted })).toBe(locked);
    expect(await s.ex.onScreen({ kind: 'record', sessionKey: submitted })).toBe(locked);

    // the record screen's Yesterday switch is only browsing: nothing is said and the open batch stays
    const { key: open } = await openEleS1U2(s);
    const yesterday = submitted.replace(TODAY, addDays(TODAY, -1));
    expect((await s.env.app.services.attendance.findCard(s.ctx, yesterday))?.status).toBe('submitted');
    expect(await s.ex.onScreen({ kind: 'record', sessionKey: yesterday })).toBeNull();
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: open });
    expect(s.env.app.services.drafts.get(open)).toBeDefined();
    expect(await s.ex.onScreen({ kind: 'review', sessionKey: yesterday })).toBeNull();
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: open });
    await s.call('go_back', { to: 'batch' });

    // E3: voice learns that the batch it left open was submitted elsewhere: the live draft for it is closed
    const { key } = await openEleS1U2(s);
    await s.call('go_back', { to: 'batch' });
    const { attendance, drafts } = s.env.app.services;
    expect((await attendance.submit(s.ctx, key, drafts.get(key)!.marks)).ok).toBe(true); // another device
    expect(await s.call('select_batch', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' });
    expect(drafts.get(key)).toBeUndefined();
  });

  it('C6: a tap while voice saves, when the save finds the attendance already submitted: the tap is refused, nothing claims it', async () => {
    const { s, key } = await readyToSubmit();
    const ask = await s.call('submit_attendance');
    s.speak();
    let heard: string | null = 'not tapped';
    vi.spyOn(s.env.app.services.attendance, 'submit').mockImplementationOnce(async () => {
      heard = tapAditiAbsent(s, key);
      return { ok: false, error: 'already_submitted' };
    });
    const answer = await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    expect(heard).toBeNull();
    expect(answer).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED' });
    expect(answer.instruction).not.toMatch(/changed|next submit/);
  });

  it('C7: the service-side submit mappings window_closed (after the precheck) and not_verified save nothing', async () => {
    for (const [error, code, text] of [
      ['window_closed', 'WINDOW_CLOSED', 'The attendance window for Shift 1, Unit 2, Electrician closed before this submit, so nothing was saved'],
      ['not_verified', 'NOT_VERIFIED', 'The location and face check for Shift 1, Unit 2, Electrician is missing, so nothing was saved.'],
    ] as const) {
      const { s, key, token } = await readyToSubmit();
      vi.spyOn(s.env.app.services.attendance, 'submit').mockResolvedValueOnce({ ok: false, error });
      const answer = await s.call('submit_attendance', { confirm_token: token });
      expect(answer).toMatchObject({ ok: false, error: code });
      expect(answer.instruction).toContain(text);
      expect(s.ex.flow().step).toBe('REVIEW');
      expect(s.env.app.services.drafts.get(key)).toBeDefined();
    }
  });
});

describe('voice executor: the live draft survives an equal configuration (Task 23 Part E)', () => {
  it('an open submit code survives a session reload with an equal configuration: one yes submits', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    forwardDraftChanges(s);
    const ask = await s.call('submit_attendance');
    // SessionService reloads (a session, face or demo bus event): a new but equal configuration, and the screen re-opens the draft
    const reloaded = (await s.env.app.services.session.load())!;
    expect(reloaded.config).not.toBe(s.ctx.config);
    expect(reloaded.config).toEqual(s.ctx.config);
    const roster = await s.env.app.services.attendance.openRoster(reloaded, key);
    if (!roster.ok) throw new Error(roster.error);
    s.env.app.services.drafts.open(reloaded, roster.value);
    await oneYesSubmits(s, ask.confirm_token as string);
  });
});

describe('voice executor: final fixes (executor, handlers, the shared submit hold)', () => {
  it('F2: a submit code dies when the trainer leaves the review by voice: go_back, the same batch again, "bas" asks again', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK, undefined, { entropy: varyingEntropy() });
    await openEleS1U2(s);
    await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    const ask = await s.call('submit_attendance');
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION', confirm_token: expect.any(String) });
    s.speak(); // "nahi"
    s.speak(); // "go back"
    expect(await s.call('go_back', { to: 'batch' })).toMatchObject({ ok: true, step: 'SELECT_BATCH' });
    const again = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(again).toMatchObject({ ok: true, step: 'ROLL_CALL' });
    expect(again).not.toHaveProperty('confirm_token');
    s.speak(); // "bas"
    const old = await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    expect(old).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION', confirm_token: expect.any(String) });
    expect(old.confirm_token).not.toBe(ask.confirm_token);
    expect(s.env.app.services.drafts.get(s.ex.flow().sessionKey!)?.locked).toBe(false);
    await oneYesSubmits(s, old.confirm_token as string); // a legitimate yes in the review still submits in one step
  });

  it('F2: the same on screen: Home, then the same batch card, then the old code asks again', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK, undefined, { entropy: varyingEntropy() });
    const { key } = await openEleS1U2(s);
    await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    const ask = await s.call('submit_attendance');
    expect(await s.ex.onScreen({ kind: 'home' })).toMatch(/^\[APP\] Trainer went back to the trade list on screen/);
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key })).toMatch(/^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen/);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: key });
    s.speak();
    const old = await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    expect(old).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
    expect(old.confirm_token).not.toBe(ask.confirm_token);
    // a trade tap from the review voids it too
    const t = await voiceSession('TR-10432', NO_CHECK, undefined, { entropy: varyingEntropy() });
    await openEleS1U2(t);
    const asked = await t.call('submit_attendance');
    await t.ex.onScreen({ kind: 'trade', tradeId: 'ele' });
    t.speak();
    expect(await t.call('submit_attendance', { confirm_token: asked.confirm_token })).toMatchObject({ ok: false, error: 'WRONG_STEP' });
  });

  it('F3: a fully marked batch reopened on screen opens at the review and asks with a code; one yes submits', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK, undefined, { entropy: varyingEntropy() });
    const { key } = await openEleS1U2(s);
    const ask = await s.call('mark_remaining', { status: 'ABSENT' });
    s.speak();
    expect(await s.call('mark_remaining', { status: 'ABSENT', confirm_token: ask.confirm_token })).toMatchObject({ ok: true, step: 'REVIEW' });
    await s.ex.onScreen({ kind: 'home' });
    const text = await s.ex.onScreen({ kind: 'mark', sessionKey: key }); // the invariant checks this text
    expect(text).toMatch(/^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen\./);
    expect(text).toContain('Every student already has a status: 31 absent. Say that in one line. In one line, read the counts: 31 absent');
    expect(s.ex.flow()).toMatchObject({ step: 'REVIEW', sessionKey: key });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);
    await oneYesSubmits(s, codeIn(text));
  });

  it('F3: a pass that finds everyone set leaves the question to the list screen signal, which asks with a code', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    await s.call('select_batch', { batch: 'shift 1 unit 2' });
    const key = s.ex.flow().sessionKey!;
    const { attendance, verification, drafts } = s.env.app.services;
    const loc = await verification.checkLocation(s.ctx, { kind: 'session', key });
    await verification.grant(s.ctx, { kind: 'session', key }, loc.ok ? loc.value : undefined);
    const roster = await attendance.openRoster(s.ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    drafts.open(s.ctx, roster.value);
    drafts.setMany(key, roster.value.students.map((st) => st.id), { status: 'absent' }, { via: 'tap' }); // marked on another visit
    expect(await s.ex.onVerification({ type: 'granted', purpose: `session:${key}` })).toBeNull();
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: key });
    const text = await s.ex.onScreen({ kind: 'mark', sessionKey: key }); // the gateway replaced itself with the list
    expect(text).toMatch(/Every student already has a status: \d+ absent/);
    expect(s.ex.flow().step).toBe('REVIEW');
    expect(await s.ex.onScreen({ kind: 'review', sessionKey: key })).toBeNull(); // voice pushed it
    await oneYesSubmits(s, codeIn(text));
  });

  it('F3: get_status on the list the trainer went back to never asks the submit question without a code', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { key } = await rollCallToReview(s);
    await s.ex.onScreen({ kind: 'review', sessionKey: key });
    await s.ex.onScreen({ kind: 'mark', sessionKey: key });
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', currentId: null });
    const status = await s.call('get_status');
    expect(status).not.toHaveProperty('confirm_token');
    expect(status.instruction).toBe('Everyone has a status: 30 present, 1 absent. Answer the trainer in one short line and wait. When the trainer wants to submit, call submit_attendance (it reads the counts and asks once).');
    s.speak();
    const ask = await s.call('submit_attendance');
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION' });
    await oneYesSubmits(s, ask.confirm_token as string);
  });

  it('F8: a voice mark while the screen Submit saves is refused, and the record, get_status and ALREADY_SUBMITTED agree', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await openEleS1U2(s);
    const told = forwardDraftChanges(s);
    await s.call('submit_attendance'); // the review
    const w = watchSubmits(s, 0); // the screen's save is held
    const screen = screenSubmit(s, key);
    await settle();
    const rahul = await s.call('set_student_status', { student: 'Rahul', status: 'absent' });
    expect(rahul).toMatchObject({ ok: false, error: 'SUBMITTING' });
    expect(rahul.instruction).toContain('is being submitted right now, so this change was not made');
    expect(await s.call('mark_remaining', { status: 'ABSENT' })).toMatchObject({ ok: false });
    expect(s.env.app.services.drafts.get(key)!.marks['ele-s1u2-r21']).not.toEqual({ status: 'absent' });
    w.release();
    expect((await screen).ok).toBe(true);
    expect(told.at(-1)).toMatch(/^\[APP\] Trainer pressed Submit on screen\./);
    const stored = (await s.env.app.services.attendance.getDetail(s.ctx, key))!.submission!;
    expect(Object.values(stored.marks).filter((m) => m.status === 'absent')).toHaveLength(0);
    expect(await s.call('get_status')).toMatchObject({ step: 'SUBMITTED', counts: { PRESENT: 31, ABSENT: 0 } });
    expect(await s.call('submit_attendance')).toMatchObject({ ok: false, error: 'ALREADY_SUBMITTED', counts: { PRESENT: 31, ABSENT: 0 } });
  });

  it('m4: after the check question in the review, a yes goes to submit_attendance, which asks once with its code', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    await rollCallToReview(s);
    const check = await s.call('mark_remaining', { status: 'PRESENT' });
    expect(check.instruction).toContain('On a yes, call submit_attendance (it reads the counts and asks once, with its code)');
    expect(check.instruction).not.toMatch(/On a yes, say submit is final/);
    s.speak(); // "haan" to the check
    const ask = await s.call('submit_attendance');
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION', confirm_token: expect.any(String) });
    await oneYesSubmits(s, ask.confirm_token as string);
  });

  it('m5: select_batch on the batch already open brings its list back after voice showed Home', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { key } = await openEleS1U2(s);
    await s.call('navigate', { to: 'home' });
    expect(s.nav.at(-1)).toBe('/home');
    const again = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(again.instruction).toMatch(/^This batch is already open\. Roll call is in progress/);
    expect(s.nav.at(-1)).toBe(`/attendance/mark?s=${encodeURIComponent(key)}`);
    const navs = navigations(s);
    await s.call('select_batch', { batch: 'shift 1 unit 2' }); // already on the list: nothing pushed
    expect(navigations(s)).toBe(navs);
  });

  it('m6: a last tap that still needs its half is not told as "everyone is marked"; the half then asks with a code', async () => {
    const s = await voiceSession('TR-10432', { ...NO_CHECK, marking: { defaultStatus: 'blank', statusSet: ['present', 'absent', 'half_day', 'ojt'], halfDayHalves: true } });
    const { opened, key } = await openEleS1U2(s);
    let r = opened;
    while (cur(r) && r.progress !== '30/31') r = await s.call('mark_attendance', { student_id: cur(r)!.id, status: 'PRESENT' });
    const last = cur(r)!.id;
    const told = forwardDraftChanges(s);
    s.env.app.services.drafts.setMark(key, last, { status: 'half_day' }, { via: 'tap' });
    expect(told.at(-1)).toContain('The trainer is still choosing a detail on screen (the half or the leave type). Say nothing more; wait for the trainer.');
    expect(told.at(-1)).not.toMatch(/Everyone is marked|ask whether to submit/);
    expect(s.ex.flow().step).toBe('ROLL_CALL');
    s.env.app.services.drafts.setMark(key, last, { status: 'half_day', half: 1 }, { via: 'tap' });
    expect(s.ex.flow().step).toBe('REVIEW');
    await oneYesSubmits(s, codeIn(told.at(-1)!));
  });

  it('m7/m17: voice counts face tries as the screen does, and "check again" never promises a check the screen will not run', async () => {
    const limited = (ctx: SessionContext): SessionContext => ({ ...ctx, journey: { ...ctx.journey, verification: { ...ctx.journey.verification, faceRetryLimit: 2 } } });
    const s = await voiceSession('TR-10432', {}, limited);
    await s.call('select_trade', { trade: 'Electrician' });
    await s.call('select_batch', { batch: 'shift 1 unit 2' });
    const purpose = `session:${s.ex.flow().sessionKey}`;
    // the primer waits for a tap: "check again" says what the screen needs instead
    await s.ex.onVerification({ type: 'prompt', purpose, need: 'camera_permission' });
    const waiting = await s.call('verify_again');
    expect(waiting).toMatchObject({ ok: false, error: 'WAITING_FOR_SCREEN' });
    expect(waiting.instruction).toContain('it waits for the trainer to allow the camera on the screen');
    // a check that saw no clear face is one try, as on screen; the camera closing after it says nothing more
    await s.ex.onVerification({ type: 'camera', purpose, on: true });
    expect(await s.call('verify_again')).toMatchObject({ ok: true, instruction: expect.stringMatching(/^The check is running on the screen now/) });
    expect(await s.ex.onVerification({ type: 'face', purpose, result: 'check_failed' })).toMatch(/could not see one clear face\. .*\(1 try left\)/);
    expect(await s.ex.onVerification({ type: 'camera', purpose, on: false })).toBeNull();
    const retries = s.events.filter((e) => e.type === 'verify_retry').length;
    expect(await s.call('verify_again')).toMatchObject({ ok: true, instruction: expect.stringMatching(/^Checking again\./) });
    expect(s.events.filter((e) => e.type === 'verify_retry')).toHaveLength(retries + 1);
    await s.ex.onVerification({ type: 'camera', purpose, on: true });
    expect(await s.ex.onVerification({ type: 'face', purpose, result: 'no_match' })).toMatch(/no tries are left/);
    const none = await s.call('verify_again');
    expect(none).toMatchObject({ ok: false, error: 'NO_TRIES_LEFT' });
    expect(s.events.filter((e) => e.type === 'verify_retry')).toHaveLength(retries + 1); // nothing sent the screen would ignore
    // the gateway opened again counts from zero, as the screen does
    await s.call('go_back', { to: 'batch' });
    await s.call('select_batch', { batch: 'shift 1 unit 2' });
    await s.ex.onVerification({ type: 'camera', purpose, on: true });
    expect(await s.ex.onVerification({ type: 'face', purpose, result: 'no_match' })).toMatch(/\(1 try left\)/);
  });

  it('C1: a pending question whose code is void now (back on the list) is not re-asked with that code: the step hint stands', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { last, key } = await rollCallToReview(s);
    await s.ex.onScreen({ kind: 'review', sessionKey: key });
    await s.ex.onScreen({ kind: 'mark', sessionKey: key }); // back on the list: no submit can be asked now
    s.newConnection();
    const text = await s.ex.refresh(last.instruction, 'bas');
    expect(codeIn(text)).toBeNull();
    expect(text).not.toContain(String(last.confirm_token));
    expect(text).not.toMatch(/was lost/);
    expect(text).toContain('Everyone has a status: 30 present, 1 absent. Answer the trainer in one short line and wait.');
  });

  it('C3: go_back keeps a trade tapped while it loaded: the list and the screen follow the tap', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await openEleS1U2(s);
    const { attendance } = s.env.app.services;
    const real = attendance.boardForTrade.bind(attendance);
    vi.spyOn(attendance, 'boardForTrade').mockImplementationOnce(async (...a) => {
      const cards = await real(...a);
      await s.ex.onScreen({ kind: 'trade', tradeId: 'fit' }); // the trainer taps Fitter meanwhile
      return cards;
    });
    const back = await s.call('go_back', { to: 'batch' });
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'fit' });
    expect(back).toMatchObject({ ok: true, trade: { id: 'fit' } });
    expect((back.batches as { id: string }[]).every((b) => b.id.startsWith('fit-'))).toBe(true);
    expect(s.nav.at(-1)).toBe('/attendance/trade?trade=fit');
  });

  it('C4: select_batch on a fully marked batch pushes the review alone, never the list first', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { key } = await openEleS1U2(s);
    const { drafts } = s.env.app.services;
    drafts.setMany(key, drafts.get(key)!.students.map((st) => st.id), { status: 'present' }, { via: 'tap' });
    await s.call('go_back', { to: 'batch' });
    const before = s.nav.length;
    const opened = await s.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(s.nav.slice(before)).toEqual([`/attendance/review?s=${encodeURIComponent(key)}`]);
    expect(await s.ex.onScreen({ kind: 'review', sessionKey: key })).toBeNull();
    await oneYesSubmits(s, opened.confirm_token as string);
  });

  it('C5: a refresh at the review with no pending question asks the submit question without saying one was lost', async () => {
    const s = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    await rollCallToReview(s);
    s.newConnection();
    const text = await s.ex.refresh(null);
    expect(text).not.toMatch(/lost/);
    expect(text).toContain('The trainer is at the review. Ask this now, then wait: In one line, read the counts: 30 present, 1 absent');
    await oneYesSubmits(s, codeIn(text));
  });

  it("C6: another batch's record (the Today switch on a submitted batch) never resets the batch open by voice", async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const submitted = (await s.env.app.services.attendance.cardsForBatch(s.ctx, 'ele-s1u1'))[0].key;
    const { key: open } = await openEleS1U2(s);
    await s.call('set_student_status', { student: 'Aditi', status: 'absent' });
    expect(await s.ex.onScreen({ kind: 'record', sessionKey: submitted })).toBeNull();
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', sessionKey: open });
    expect(s.env.app.services.drafts.get(open)!.marks['ele-s1u2-r02']).toEqual({ status: 'absent' });
    const ask = await s.call('submit_attendance');
    expect(await s.ex.onScreen({ kind: 'record', sessionKey: submitted })).toBeNull();
    expect(s.ex.flow()).toMatchObject({ step: 'REVIEW', sessionKey: open });
    await oneYesSubmits(s, ask.confirm_token as string);
  });
});

describe('voice executor: final follow-ups (task-final-executor-2)', () => {
  /** By exception, everyone marked absent by voice (the code of that ask is the one every ticket carries at entropy 0.42). */
  async function allMarked(s: Session) {
    const { key } = await openEleS1U2(s);
    const ask = await s.call('mark_remaining', { status: 'ABSENT' });
    s.speak();
    expect(await s.call('mark_remaining', { status: 'ABSENT', confirm_token: ask.confirm_token })).toMatchObject({ ok: true, step: 'REVIEW' });
    return { key, code: ask.confirm_token as string };
  }
  const QUIET = () => true;

  it('E1: a fully marked batch tapped while paused moves to the review only: no code, no review pushed; get_status asks on Resume', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key, code } = await allMarked(s);
    await s.ex.onScreen({ kind: 'home' });
    const before = navigations(s);
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key }, QUIET)).toBeNull();
    expect(s.ex.flow()).toMatchObject({ step: 'REVIEW', sessionKey: key });
    expect(navigations(s)).toBe(before); // the trainer's list stays on screen
    s.speak();
    expect(await s.call('submit_attendance', { confirm_token: code })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' }); // no code was issued
    const status = await s.call('get_status'); // Resume
    expect(status).toMatchObject({ step: 'REVIEW', confirm_token: expect.any(String) });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/review\?s=/);
    await oneYesSubmits(s, status.confirm_token as string);
  });

  it('E1: the same for the list a pass reveals with everyone set, and for the review reached on screen', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    await s.call('select_batch', { batch: 'shift 1 unit 2' });
    const key = s.ex.flow().sessionKey!;
    const { attendance, verification, drafts } = s.env.app.services;
    const loc = await verification.checkLocation(s.ctx, { kind: 'session', key });
    await verification.grant(s.ctx, { kind: 'session', key }, loc.ok ? loc.value : undefined);
    const roster = await attendance.openRoster(s.ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    drafts.open(s.ctx, roster.value);
    drafts.setMany(key, roster.value.students.map((st) => st.id), { status: 'absent' }, { via: 'tap' });
    expect(await s.ex.onVerification({ type: 'granted', purpose: `session:${key}` })).toBeNull();
    const before = navigations(s);
    expect(await s.ex.onScreen({ kind: 'mark', sessionKey: key }, QUIET)).toBeNull();
    expect(s.ex.flow().step).toBe('REVIEW');
    expect(navigations(s)).toBe(before);

    // the review reached on screen while paused: the flow follows, but no code is issued for a yes nobody was asked for
    const t = await voiceSession('TR-10432', BLANK_ROLL_CALL);
    const { last, key: k } = await rollCallToReview(t);
    await t.ex.onScreen({ kind: 'review', sessionKey: k });
    await t.ex.onScreen({ kind: 'mark', sessionKey: k }); // back on the list: the code is void
    expect(await t.ex.onScreen({ kind: 'review', sessionKey: k }, QUIET)).toBeNull();
    expect(t.ex.flow().step).toBe('REVIEW');
    t.speak();
    expect(await t.call('submit_attendance', { confirm_token: last.confirm_token })).toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
  });

  it('E2/E4: while the screen Submit saves, replies say it is being submitted; submit_attendance issues no code and starts no save', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    const { key } = await allMarked(s);
    const w = watchSubmits(s, 0); // the screen's save is held
    const screen = screenSubmit(s, key);
    await settle();
    const before = navigations(s);
    const SAVING = 'Shift 1, Unit 2, Electrician is being submitted on screen right now. Say so in one short line and ask the trainer to wait a moment';
    const status = await s.call('get_status');
    expect(status).not.toHaveProperty('confirm_token');
    expect(status.instruction).toContain(SAVING);
    const remaining = await s.call('mark_remaining', { status: 'ABSENT' }); // the nobody-to-check path in the review
    expect(remaining).toMatchObject({ ok: false, error: 'SUBMITTING' });
    expect(remaining).not.toHaveProperty('confirm_token');
    const skip = await s.call('skip_student', { student_id: 'ele-s1u2-r02' });
    expect(skip).toMatchObject({ ok: false, error: 'SUBMITTING' });
    expect(skip.instruction).toContain(SAVING);
    const submit = await s.call('submit_attendance');
    expect(submit).toMatchObject({ ok: false, error: 'SUBMITTING' });
    expect(submit).not.toHaveProperty('confirm_token');
    expect(submit.instruction).toContain(SAVING);
    s.newConnection();
    const refresh = await s.ex.refresh(null);
    expect(refresh).toContain(SAVING);
    expect(codeIn(refresh)).toBeNull();
    for (const text of [status.instruction, remaining.instruction, skip.instruction, submit.instruction, refresh]) expect(text).not.toMatch(SUBMIT_QUESTION);
    expect(navigations(s)).toBe(before);
    expect(w.spy).toHaveBeenCalledTimes(1);
    w.release();
    expect((await screen).ok).toBe(true);
    expect(w.spy).toHaveBeenCalledTimes(1);
  });

  it('U1: a trade tapped on the switcher changes where select_batch looks, and leaves a pending Home navigation of voice alone', async () => {
    const s = await voiceSession('TR-10455', { ...NO_CHECK, mapping: { model: 'trade' }, time: { fencing: false } });
    expect(s.plan.selection).toBe('trade_switcher');
    expect(await s.call('select_trade', { trade: 'fitter' })).toMatchObject({ ok: true, trade: { id: 'fit' } });
    expect(await s.ex.onScreen({ kind: 'trade', tradeId: 'wel' })).toMatch(/^\[APP\] Trainer chose Welder on screen\./);
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'wel' });
    const opened = await s.call('select_batch', { batch: 'shift 2 unit 1' });
    expect(opened).toMatchObject({ ok: true, batch: { id: expect.stringMatching(/^wel-/) } });
    // voice shows Home (go_back); the trainer taps Fitter before Home's own screen signal arrives
    await s.call('go_back', { to: 'batch' });
    expect(s.nav.at(-1)).toBe('/home');
    await s.ex.onScreen({ kind: 'trade', tradeId: 'fit' });
    expect(await s.ex.onScreen({ kind: 'home' })).toBeNull(); // still voice's own navigation: nothing said, the flow stays
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'fit' });
  });
});

describe('voice executor: only what can be marked now (D-134)', () => {
  const MEERA_PERIODS: ConfigLayer = { mapping: { model: 'timetable' }, marking: { frequency: 'period' } };
  const keyOf = (batchId: string, slot = 'daily') => `${batchId}.${TODAY}.${slot}`;
  /** Shift 1's window closed at 10:00, so at 10:15 nothing is open until Shift 2 at 2:00 pm. */
  const SHIFT_1_SHUT: ConfigLayer = { ...NO_CHECK, time: { shiftWindows: { 1: { start: '07:00', end: '10:00' }, 2: { start: '14:00', end: '20:00' } } } };

  it('kickoff with the only open batch opens it itself: VERIFY, a navigate event, and the open text after the greeting', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    const text = await s.ex.kickoff('start', 'English');
    expect(text).toMatch(/^\[APP\] Session started\. Only Shift 1, Unit 2, Electrician can be marked now, so the app opened it: do not call select_batch for it\. Greet the trainer by first name in one short line in English \("Good morning, <first name>\."\), then: Before the student list/);
    expect(text).not.toMatch(/Shift 2/);
    expect(s.ex.flow()).toMatchObject({ step: 'VERIFY', sessionKey: keyOf('ele-s1u2') });
    expect(s.events).toContainEqual(expect.objectContaining({ type: 'navigate', href: expect.stringMatching(/^\/attendance\/open\?s=ele-s1u2\./) }));
  });

  it('kickoff with the only open batch and a pass already given opens the list (ROLL_CALL)', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    await verify(s.env.app, s.ctx, keyOf('ele-s1u2'));
    const text = await s.ex.kickoff('start', 'English');
    expect(text).toMatch(/^\[APP\] Session started\. Only Shift 1, Unit 2, Electrician can be marked now, so the app opened it: do not call select_batch for it\. .*, then: In the trainer's language, with numbers said the way that language says them, in one short line, say Shift 1, Unit 2, Electrician, 31 students, everyone present, and ask who is absent/);
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', rollCall: false, sessionKey: keyOf('ele-s1u2') });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/mark\?s=ele-s1u2\./);
  });

  it('voice started on My attendance, Reports or the staff screen opens nothing: it offers own attendance or reads the open batch', async () => {
    // Rajesh Patil: only Shift 1 Unit 1 is open at 10:15, and his own attendance is not marked yet
    const self = await voiceSession('TR-10432', { mapping: { model: 'batch' } });
    await self.ex.onScreen({ kind: 'self' });
    const offer = await self.ex.kickoff('start', 'English');
    expect(offer).toMatch(/^\[APP\] Session started\. The trainer is on My attendance, and their own attendance is not marked today\. Greet the trainer .*call mark_my_attendance\.$/);
    expect(self.ex.flow().step).not.toBe('VERIFY');
    expect(self.nav).toEqual([]); // the screen the trainer chose stays
    // Sunita Jadhav marked her own attendance already: the open batch is read, still not opened
    const marked = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    expect(await marked.env.app.services.staffAttendance.myRecord(marked.ctx)).toBeDefined();
    await marked.ex.onScreen({ kind: 'self' });
    const read = await marked.ex.kickoff('start', 'English');
    expect(read).toMatch(/^\[APP\] Session started\. Greet the trainer .*Only Shift 1, Unit 2, Electrician can be marked now\. Say that in one short line and ask whether to open it; on yes, call select_batch with id ele-s1u2\./);
    expect(marked.nav).toEqual([]);
    for (const screen of ['reports', 'staff_attendance', undefined] as const) {
      const away = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
      await away.ex.onScreen(screen ? { kind: 'other', screen } : { kind: 'other' });
      expect(await away.ex.kickoff('start', 'English')).toMatch(/Only Shift 1, Unit 2, Electrician can be marked now\. Say that in one short line and ask whether to open it/);
      expect(away.ex.flow().step, `nothing opened on ${screen ?? 'another screen'}`).toBe('SELECT_BATCH');
      expect(away.nav).toEqual([]);
    }
    // back on Home before the start: the only open batch is opened as usual
    const home = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    await home.ex.onScreen({ kind: 'other', screen: 'reports' });
    await home.ex.onScreen({ kind: 'home' });
    expect(await home.ex.kickoff('start', 'English')).toMatch(/so the app opened it/);
  });

  it('Resume, Reconnect and a refresh away from the batch screens say where the trainer is and wait; on a batch they keep the marking texts', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    await s.ex.onScreen({ kind: 'other', screen: 'reports' });
    await s.ex.kickoff('start', 'English');
    expect(s.ex.resumeText()).toBe('[APP] The trainer is back from the screen. They are on the Reports screen; no batch is being marked. Say in a few words that you are listening, then wait for their request.');
    expect(await s.ex.kickoff('reconnect', 'English')).toBe('[APP] Reconnected. The trainer is on the Reports screen; no batch is being marked. Say in a few words that you are listening, then wait for their request.');
    expect(await s.ex.refresh(null)).toBe("[APP] The connection was refreshed; trust these facts over your memory. The trainer is on the Reports screen; no batch is being marked. Wait for the trainer's request.");
    // a question still waiting is asked again, wherever the trainer is
    expect(await s.ex.refresh('Ask which batch: Shift 1, Unit 2; Shift 2, Unit 2.', 'report')).toContain('Your last question to the trainer was lost in the refresh: ask it again now, then wait.');
    await s.ex.onScreen({ kind: 'self' });
    expect(s.ex.resumeText()).toMatch(/They are on the My attendance screen;/);
    // Home again: the marking texts
    await s.ex.onScreen({ kind: 'home' });
    expect(s.ex.resumeText()).toBe(RESUME_EVENT);
    expect(await s.ex.kickoff('reconnect', 'English')).toBe(RECONNECT_EVENT);
    expect(await s.ex.refresh(null)).toMatch(/We are choosing the batch\./);
  });

  it('a batch waiting for its check on the face enrolment screen is not "away": Resume, Reconnect and a refresh keep the check texts (Task 19)', async () => {
    // Sunita Jadhav: the kickoff opens the only open batch, which waits for the check; OpenSessionScreen sends a trainer
    // whose face enrolment is owed to /face?next=..., a screen voice cannot name ({ kind: 'other' })
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    await s.ex.kickoff('start', 'English');
    expect(s.ex.flow()).toMatchObject({ step: 'VERIFY', sessionKey: keyOf('ele-s1u2') });
    await s.ex.onScreen({ kind: 'other' });
    expect(s.ex.resumeText()).toBe(RESUME_EVENT);
    expect(await s.ex.kickoff('reconnect', 'English')).toBe(RECONNECT_EVENT);
    const refresh = await s.ex.refresh(null);
    expect(refresh).not.toMatch(/no batch is being marked|another screen/);
    expect(refresh).toMatch(/check/i);
    // back to the list by voice: its navigation's screen signal ends the detour, and the marking texts return
    await s.call('go_back', { to: 'batch' });
    expect(s.ex.flow().step).toBe('SELECT_BATCH');
    expect(s.nav.at(-1)).toBe(routes.home);
    expect(await s.ex.onScreen({ kind: 'home' })).toBeNull();
    expect(s.ex.resumeText()).toBe(RESUME_EVENT);
  });

  it('a real tap to Reports while a batch waits for its check is kept: hidden during the check, said once the check is left (fix round 1)', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    await s.ex.kickoff('start', 'English');
    expect(s.ex.flow()).toMatchObject({ step: 'VERIFY', sessionKey: keyOf('ele-s1u2') });
    await s.ex.onScreen({ kind: 'other', screen: 'reports' }); // the trainer tapped Reports during the check
    expect(s.ex.resumeText()).toBe(RESUME_EVENT); // the batch still owns the texts while it waits for its check
    expect(await s.ex.refresh(null)).toMatch(/check/i);
    // the check is left by voice before the screen follows: the texts say where the trainer really is
    await s.call('go_back', { to: 'batch' });
    expect(s.ex.flow().step).toBe('SELECT_BATCH');
    expect(s.ex.resumeText()).toMatch(/Reports screen/);
  });

  it('a batch open by voice while the trainer glances at Reports keeps the roll call texts', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' }, ...NO_CHECK });
    await s.ex.kickoff('start', 'English');
    expect(s.ex.flow().step).toBe('ROLL_CALL');
    await s.ex.onScreen({ kind: 'other', screen: 'reports' });
    expect(s.ex.resumeText()).toBe(RESUME_EVENT);
    expect(await s.ex.kickoff('reconnect', 'English')).toBe(RECONNECT_EVENT);
  });

  it('kickoff with two open periods and later ones names only the open two, with their ids', async () => {
    const s = await voiceSession('TR-11024', MEERA_PERIODS);
    const text = await s.ex.kickoff('start', 'English');
    expect(text).toMatch(/^\[APP\] Session started\. Greet the trainer by first name in one short line in English \("Good morning, <first name>\."\), then: Read only the periods open now/);
    expect(text).toContain('Shift 1, Unit 1, Electrician, Period 3 (theory); Shift 1, Unit 1, COPA, Period 3 (theory).');
    expect(text).toContain(`Their ids for select_batch: Shift 1, Unit 1, Electrician, Period 3 (theory): ${keyOf('ele-s1u1', 'p3.es')}; Shift 1, Unit 1, COPA, Period 3 (theory): ${keyOf('copa-s1u1', 'p3.es')}.`);
    expect(text).not.toMatch(/Shift 2|Fitter|Welder|2:00|5:00|closed/);
    expect(s.ex.flow().step).toBe('SELECT_BATCH'); // nothing opened
    expect(s.nav).toEqual([]);
  });

  it('kickoff with nothing open says when the next one opens and asks what the trainer needs, never ends (D-142)', async () => {
    const s = await voiceSession('TR-11024', MEERA_PERIODS);
    s.env.clock.set(instantAt(TODAY, '11:30'));
    expect(await s.ex.kickoff('start', 'English')).toBe(
      '[APP] Session started. Nothing can be marked right now: the next period opens at 2:00 pm. Greet the trainer by first name in one short line in English ("Good morning, <first name>."), say that in one line, then ask "What do you need?". Then wait.',
    );
    s.env.clock.set(instantAt(TODAY, '18:30'));
    expect(await s.ex.kickoff('start', 'English')).toMatch(/^\[APP\] Session started\. Nothing can be marked right now: today's attendance windows are closed\. Greet the trainer by first name in one short line in English \("Good evening, <first name>\."\)/);
    expect(s.ex.flow().step).toBe('SELECT_BATCH');
  });

  it('kickoff with a trade step reads only the trades with a batch open now; voice started on a batch list or screen is unchanged', async () => {
    const s = await voiceSession();
    // Welder and COPA have only a submitted batch and later ones at 10:15: not read
    expect(await s.ex.kickoff('start', 'English')).toBe(
      '[APP] Session started. Greet the trainer by first name in one short line in English ("Good morning, <first name>."), then ask which trade, reading the trade names: Electrician, Fitter, Mechanic Diesel. No tool call is needed before the trainer answers. When the trainer names one, call select_trade.',
    );
    await s.call('select_trade', { trade: 'Electrician' });
    expect(await s.ex.kickoff('start', 'English')).toBe('[APP] Session started again. Call get_status and continue from where we were.');
    const t = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    await t.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(await t.ex.kickoff('start', 'English')).toBe('[APP] Session started again. Call get_status and continue from where we were.');
    expect(t.nav).toHaveLength(1); // no second open
  });

  it('kickoff with a trade step and nothing open in any trade: why, then what the trainer needs (D-142)', async () => {
    const s = await voiceSession();
    s.env.clock.set(instantAt(TODAY, '20:30')); // after both shifts' windows
    expect(await s.ex.kickoff('start', 'English')).toBe(
      '[APP] Session started. Nothing can be marked right now: today\'s attendance windows are closed. Greet the trainer by first name in one short line in English ("Good evening, <first name>."), say that in one line, then ask "What do you need?". Then wait.',
    );
    expect(s.ex.flow().step).toBe('SELECT_TRADE');
    const t = await voiceSession('TR-10432', SHIFT_1_SHUT);
    expect(await t.ex.kickoff('start', 'English')).toMatch(/^\[APP\] Session started\. Nothing can be marked right now: the next batch opens at 2:00 pm\. Greet the trainer/);
  });

  it('get_status and select_trade at the batch list give the open batches only', async () => {
    const s = await voiceSession();
    const trade = await s.call('select_trade', { trade: 'Electrician' });
    const open = [{ id: keyOf('ele-s1u2'), label: 'Shift 1, Unit 2, Electrician' }, { id: keyOf('ele-s1u3'), label: 'Shift 1, Unit 3, Electrician' }];
    expect(trade.batches).toEqual(open);
    expect(trade.instruction).not.toMatch(/Shift 2|2:00|submitted/);
    const status = await s.call('get_status');
    expect(status).toMatchObject({ step: 'SELECT_BATCH', batches: open });
    expect(status.instruction).toContain('Shift 1, Unit 2; Shift 1, Unit 3.');
  });

  it('select_batch looks among the open batches first; a later batch named on its own still says why it cannot open', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    // "unit 2" is Shift 1 Unit 2 (open) and Shift 2 Unit 2 (opens at 2:00 pm): the open one
    expect(await s.call('select_batch', { batch: 'unit 2' })).toMatchObject({ ok: true, step: 'VERIFY', batch: { id: keyOf('ele-s1u2') } });
    const t = await voiceSession();
    await t.call('select_trade', { trade: 'Electrician' });
    expect(await t.call('select_batch', { batch: 'shift 2 unit 2' })).toMatchObject({ ok: false, error: 'WINDOW_NOT_OPEN', opens: '2:00 pm' });
    const missing = await t.call('select_batch', { batch: 'shift 1 unit 9' });
    expect(missing).toMatchObject({ ok: false, error: 'NOT_FOUND', batches: [{ id: keyOf('ele-s1u2') }, { id: keyOf('ele-s1u3') }] });
    expect(missing.instruction).toBe('Electrician has these batches open now: Shift 1, Unit 2, Electrician; Shift 1, Unit 3, Electrician. Read them and ask which one.');
  });

  it('after a voice submit: the next open batch is offered by its id, or, with none, it says so and waits (D-142)', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    s.speak();
    const done = await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    expect(done).toMatchObject({ ok: true, step: 'SUBMITTED' });
    expect(done.instruction).toContain(`then ask whether to open Shift 1, Unit 3, Electrician next, in one short question. On yes, call select_batch with id ${keyOf('ele-s1u3')}.`);
    expect(await s.call('select_batch', { batch: keyOf('ele-s1u3') })).toMatchObject({ ok: true, step: 'ROLL_CALL', batch: { id: keyOf('ele-s1u3') } });

    const t = await voiceSession('TR-10518', { ...NO_CHECK, mapping: { model: 'batch' } });
    await t.call('select_batch', { batch: 'shift 1 unit 2' });
    const q = await t.call('submit_attendance');
    t.speak();
    const last = await t.call('submit_attendance', { confirm_token: q.confirm_token });
    expect(last.instruction).toContain('Say in one short line that it is submitted and nothing else can be marked right now (the next batch opens at 2:00 pm), then stop and wait for the trainer.');
    expect(last.instruction).not.toMatch(/end_voice_session|goodbye/);
  });

  it('words that match only later batches say when they open, never "which one"', async () => {
    const s = await voiceSession();
    await s.call('select_trade', { trade: 'Electrician' });
    // "shift 2" is Shift 2 Units 1, 2 and 3, all opening at 2:00 pm; Units 2 and 3 of Shift 1 are open
    const later = await s.call('select_batch', { batch: 'shift 2' });
    expect(later).toMatchObject({ ok: false, error: 'WINDOW_NOT_OPEN', opens: '2:00 pm' });
    expect(later.instruction).toBe(
      'The attendance windows for Shift 2, Unit 1, Electrician and Shift 2, Unit 2, Electrician and Shift 2, Unit 3, Electrician open at 2:00 pm. Say so in one line and ask for another batch.',
    );
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'ele' });
    // with nothing open in the trade, no other batch is asked for; a submitted and closed mix says why nothing can be marked
    const t = await voiceSession('TR-10432', SHIFT_1_SHUT);
    await t.call('select_trade', { trade: 'Electrician' });
    expect((await t.call('select_batch', { batch: 'shift 2' })).instruction).toMatch(/open at 2:00 pm\. Say so in one short line\.$/);
    expect(await t.call('select_batch', { batch: 'shift 1' })).toMatchObject({
      ok: false, error: 'NOT_FOUND', batches: [], instruction: 'Nothing can be marked right now: the next batch opens at 2:00 pm. Say so in one short line.',
    });
    const closed = await voiceSession('TR-10432', SHIFT_1_SHUT);
    closed.env.clock.set(instantAt(TODAY, '20:30'));
    await closed.call('select_trade', { trade: 'Electrician' });
    expect(await closed.call('select_batch', { batch: 'shift 2' })).toMatchObject({
      ok: false, error: 'WINDOW_CLOSED',
      instruction: 'The attendance windows for Shift 2, Unit 1, Electrician and Shift 2, Unit 2, Electrician and Shift 2, Unit 3, Electrician closed earlier today, so they cannot be marked now; only the principal can correct them. Say so in one short line.',
    });
  });

  it('after the last open batch of a trade: the next open batch of another trade is offered, and one select_batch opens it', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await s.ex.kickoff('start', 'English');
    await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    s.speak();
    expect((await s.call('submit_attendance', { confirm_token: ask.confirm_token })).instruction).toContain(`call select_batch with id ${keyOf('ele-s1u3')}.`);
    expect(await s.call('select_batch', { batch: keyOf('ele-s1u3') })).toMatchObject({ ok: true, step: 'ROLL_CALL' });
    const ask2 = await s.call('submit_attendance');
    s.speak();
    const done = await s.call('submit_attendance', { confirm_token: ask2.confirm_token });
    expect(done).toMatchObject({ ok: true, step: 'SUBMITTED' });
    expect(done.instruction).toContain(`then ask whether to open Shift 1, Unit 2, Fitter next, in one short question. On yes, call select_batch with id ${keyOf('fit-s1u2')}.`);
    expect(done.instruction).not.toMatch(/end_voice_session/);
    const opened = await s.call('select_batch', { batch: keyOf('fit-s1u2') });
    expect(opened).toMatchObject({ ok: true, step: 'ROLL_CALL', batch: { id: keyOf('fit-s1u2'), label: 'Shift 1, Unit 2, Fitter' } });
    expect(s.ex.flow()).toMatchObject({ step: 'ROLL_CALL', tradeId: 'fit', sessionKey: keyOf('fit-s1u2') });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/mark\?s=fit-s1u2\./);
  });

  it('a session key of another trade that cannot be marked now says why and keeps the trade', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await s.call('select_trade', { trade: 'Electrician' });
    expect(await s.call('select_batch', { batch: keyOf('wel-s2u1') })).toMatchObject({ ok: false, error: 'WINDOW_NOT_OPEN', opens: '2:00 pm' });
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'ele' });
  });

  it('another trade\'s session key: a check or a roster that fails leaves the flow and the screen as they were', async () => {
    const s = await voiceSession('TR-10432');
    await s.call('select_trade', { trade: 'Electrician' });
    const nav = [...s.nav];
    const hasPass = vi.spyOn(s.env.app.services.verification, 'hasPass').mockRejectedValueOnce(new Error('storage broke'));
    expect(await s.call('select_batch', { batch: keyOf('fit-s1u2') })).toMatchObject({ ok: false, error: 'INTERNAL' });
    expect(s.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'ele', sessionKey: null });
    expect(s.nav).toEqual(nav);
    hasPass.mockRestore();
    // the same words again: the gateway of that batch, in its own trade
    expect(await s.call('select_batch', { batch: keyOf('fit-s1u2') })).toMatchObject({ ok: true, step: 'VERIFY', batch: { id: keyOf('fit-s1u2') } });
    expect(s.ex.flow()).toMatchObject({ step: 'VERIFY', tradeId: 'fit', sessionKey: keyOf('fit-s1u2') });
    expect(s.nav.at(-1)).toMatch(/^\/attendance\/open\?s=fit-s1u2\./);

    const t = await voiceSession('TR-10432', NO_CHECK);
    await t.call('select_trade', { trade: 'Electrician' });
    const before = [...t.nav];
    vi.spyOn(t.env.app.services.attendance, 'openRoster').mockRejectedValueOnce(new Error('storage broke'));
    expect(await t.call('select_batch', { batch: keyOf('fit-s1u2') })).toMatchObject({ ok: false, error: 'INTERNAL' });
    expect(t.ex.flow()).toMatchObject({ step: 'SELECT_BATCH', tradeId: 'ele', sessionKey: null });
    expect(t.nav).toEqual(before);
  });

  it('opening the offered batch of another trade reuses the board the submit loaded: one load of the list on offer, one after opening', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await s.ex.kickoff('start', 'English');
    await openEleS1U2(s);
    for (const key of [null, keyOf('ele-s1u3')]) {
      if (key) await s.call('select_batch', { batch: key });
      const ask = await s.call('submit_attendance');
      s.speak();
      await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    }
    const loads = vi.spyOn(s.env.app.services.attendance, 'boardForTrade');
    expect(await s.call('select_batch', { batch: keyOf('fit-s1u2') })).toMatchObject({ ok: true, step: 'ROLL_CALL', batch: { id: keyOf('fit-s1u2') } });
    expect(loads.mock.calls.map(([, tradeId]) => tradeId)).toEqual(['ele', 'fit']);
  });

  it('after the on-screen Submit of the last open batch of a trade: another trade\'s open batch is offered', async () => {
    const s = await voiceSession('TR-10432', NO_CHECK);
    await s.ex.kickoff('start', 'English');
    await openEleS1U2(s);
    const ask = await s.call('submit_attendance');
    s.speak();
    await s.call('submit_attendance', { confirm_token: ask.confirm_token });
    await s.call('select_batch', { batch: keyOf('ele-s1u3') });
    const told = forwardDraftChanges(s);
    expect((await screenSubmit(s, keyOf('ele-s1u3'))).ok).toBe(true);
    expect(told.at(-1)).toMatch(/^\[APP\] Trainer pressed Submit on screen\. Attendance for Shift 1, Unit 3, Electrician is submitted and locked\. Say "submitted" in a few words, then ask whether to open Shift 1, Unit 2, Fitter next/);
  });

  it('after the on-screen Submit: the same offer of the next open batch', async () => {
    const { s, key, told } = await readyToSubmit();
    expect((await screenSubmit(s, key)).ok).toBe(true);
    expect(told.at(-1)).toMatch(/^\[APP\] Trainer pressed Submit on screen\. Attendance for Shift 1, Unit 2, Electrician is submitted and locked\. Say "submitted" in a few words, then ask whether to open Shift 1, Unit 3, Electrician next/);
  });

  // last in the file: once seen, the ?voiceDebug=1 flag holds for the module (src/services/voice/debug.ts)
  it('a kickoff auto-open that throws falls back to the offer and leaves a debug line with ids only', async () => {
    const s = await voiceSession('TR-10518', { mapping: { model: 'batch' } });
    vi.spyOn(s.env.app.services.verification, 'hasPass').mockRejectedValue(new TypeError('Sunita Patil broke it'));
    vi.stubGlobal('location', { search: '?voiceDebug=1' });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      const text = await s.ex.kickoff('start', 'English');
      expect(text).toMatch(/^\[APP\] Session started\. Greet the trainer .*Only Shift 1, Unit 2, Electrician can be marked now\. .*call select_batch with id ele-s1u2\./);
      expect(info).toHaveBeenCalledWith(`[voice] kickoff auto-open failed for ${keyOf('ele-s1u2')}: TypeError`);
      expect(info.mock.calls.flat().join(' ')).not.toMatch(/Sunita|Patil|broke/);
    } finally {
      info.mockRestore();
      vi.unstubAllGlobals();
    }
  });
});

/**
 * Own attendance first by voice (D-152, T9): at every fresh start with the trainer's own attendance unmarked, the first
 * turn is the greeting and the ask, never an auto-open. With the rule (journey.staff.selfFirst) select_trade and
 * select_batch answer SELF_FIRST; without it the ask is a suggestion. After the self mark the same turn leads on to the
 * students, and a recent self pass opens the batch without a second check (verification.selfPassReuseMinutes).
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { compileVoicePlan } from '@/domain/voice/plan';
import { instantAt } from '@/lib/time';
import { ActionBus } from '@/services/voice/action-bus';
import { createExecutor } from '@/services/voice/executor';
import { setup, signIn, TODAY } from '../helpers/app';

const RULE_ON: ConfigLayer = { voice: { enabled: true }, staff: { selfBeforeStudents: true } };
const RULE_OFF: ConfigLayer = { voice: { enabled: true } };

async function voice(layer: ConfigLayer = RULE_ON, trainer = 'TR-10432', at = '10:15', screenLanguage: 'en' | 'mr' = 'en') {
  const env = setup(layer);
  env.clock.set(instantAt(TODAY, at));
  const ctx = await signIn(env.app, trainer);
  const bus = new ActionBus();
  const nav: string[] = [];
  bus.subscribe((e) => e.type === 'navigate' && nav.push(e.href));
  const turns = { speech: 0 };
  const s = env.app.services;
  const ex = createExecutor({
    ctx, plan: compileVoicePlan(ctx, screenLanguage)!, bus,
    attendance: s.attendance, verification: s.verification, drafts: s.drafts, announcements: s.announcements, staffAttendance: s.staffAttendance, reports: s.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => turns.speech, turnSeq: () => 0, spokeAtTurn: () => 0, generation: () => 1, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  /** The trainer speaks (a new trainer turn). */
  const speak = () => void (turns.speech += 1);
  /** The screen's own check for the trainer's attendance passes, as VerificationFlow grants it, and voice hears it. */
  const selfPass = async (quiet?: () => boolean) => {
    const loc = await s.verification.checkLocation(ctx, { kind: 'self' });
    await s.verification.grant(ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    return ex.onVerification({ type: 'granted', purpose: 'self' }, quiet);
  };
  return { env, ctx, ex, call, nav, selfPass, speak };
}

describe('own attendance first by voice (D-152)', () => {
  it('with the rule, the kickoff on Home greets and asks for own attendance first; nothing opens', async () => {
    const v = await voice();
    const text = await v.ex.kickoff('start', 'Indian English');
    expect(text).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today; it must be marked before any student attendance\. Say exactly: "Hi Rajesh, good morning\." Then say in one short line, in Indian English: "Please mark your attendance first\. Shall I start\?"/);
    expect(text).not.toMatch(/select_trade|Electrician/);
    expect(v.nav).toEqual([]);
  });

  it('with the rule, select_trade and select_batch answer SELF_FIRST and open nothing', async () => {
    const v = await voice();
    await v.ex.kickoff('start', 'Indian English');
    const trade = await v.call('select_trade', { trade: 'Electrician' });
    expect(trade).toMatchObject({ ok: false, error: 'SELF_FIRST' });
    expect(String(trade.instruction)).toMatch(/must be marked before any student attendance.+call mark_my_attendance/);
    // before any trade is chosen, by name: the same refusal, never "choose the trade first" (one round trip, not two)
    const batch = await v.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(batch).toMatchObject({ ok: false, error: 'SELF_FIRST' });
    expect(v.nav).toEqual([]);
    expect(v.ex.flow().sessionKey).toBeFalsy();
  });

  it('a batch asked for by its id while the rule blocks: SELF_FIRST with the reason, never the gateway', async () => {
    const v = await voice();
    const board = await v.env.app.services.attendance.boardForTrade(v.ctx, 'ele');
    const open = board.find((c) => c.status === 'open' && c.canMark)!;
    expect(open.selfFirst).toBe(true);
    const result = await v.call('select_batch', { batch: open.key });
    expect(result).toMatchObject({ ok: false, error: 'SELF_FIRST' });
    expect(v.nav).toEqual([]);
  });

  it('without the rule it is a suggestion: "later" continues to the normal start, and a trade still opens', async () => {
    const v = await voice(RULE_OFF);
    const text = await v.ex.kickoff('start', 'Indian English');
    expect(text).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today\. Say exactly: "Hi Rajesh, good morning\." /);
    expect(text).toContain('If the trainer says later, or names a trade or batch instead, continue without it: ');
    expect(text).toContain('"Right now only Electrician, Fitter and Mechanic Diesel have batches open and not yet marked. Which one?"');
    expect(await v.call('select_trade', { trade: 'Electrician' })).toMatchObject({ ok: true, step: 'SELECT_BATCH' });
  });

  it('no auto-open while the trainer\'s own attendance is pending (the only open batch waits)', async () => {
    const v = await voice({ ...RULE_OFF, mapping: { model: 'batch' } }, 'TR-10518');
    vi.spyOn(v.env.app.services.staffAttendance, 'myRecord').mockResolvedValue(undefined);
    const text = await v.ex.kickoff('start', 'Indian English');
    expect(text).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today\. Say exactly: "Hi Sunita, good morning\."/);
    expect(text).toContain('Only Shift 1, Unit 2, Electrician can be marked now.');
    expect(v.nav).toEqual([]);
    expect(v.ex.flow().step).not.toBe('VERIFY');
  });

  it('after the self pass the same turn names the open trades; the batch then opens without a second check', async () => {
    const v = await voice();
    await v.ex.kickoff('start', 'Indian English');
    expect(await v.call('mark_my_attendance')).toMatchObject({ ok: true, step: 'VERIFY' });
    const text = await v.selfPass();
    expect(text).toMatch(/^\[APP\] The check passed and the trainer's own attendance is marked present at 10:15 am\. Say so in one short line\. Then, in the same turn: /);
    expect(text).toContain('"Right now only Electrician, Fitter and Mechanic Diesel have batches open and not yet marked. Which one?"');
    expect(await v.call('select_trade', { trade: 'Electrician' })).toMatchObject({ ok: true });
    const opened = await v.call('select_batch', { batch: 'shift 1 unit 2' });
    expect(opened).toMatchObject({ ok: true });
    expect(v.ex.flow().step).toBe('ROLL_CALL'); // the self pass was reused: no gateway, no second check
    expect(v.nav.at(-1)).toMatch(/^\/attendance\/mark\?s=ele-s1u2\./);
  });

  it('after the self pass with one markable batch, the app opens it at once (reusing the pass)', async () => {
    const v = await voice({ ...RULE_ON, mapping: { model: 'batch' } }, 'TR-10432', '14:15');
    const kickoff = await v.ex.kickoff('start', 'Indian English');
    expect(kickoff).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today/);
    expect(v.ex.flow().step).not.toBe('VERIFY');
    await v.call('mark_my_attendance');
    const text = await v.selfPass();
    expect(text).toContain('Then, in the same turn: Only Shift 2, Unit 1, Electrician can be marked now, so the app opened it: do not call select_batch for it.');
    expect(v.ex.flow().step).toBe('ROLL_CALL');
    expect(v.nav.at(-1)).toMatch(/^\/attendance\/mark\?s=ele-s2u1\./);
  });

  it('a pass while the session is quiet (Reconnect showing, a hidden pause) saves the mark but opens nothing', async () => {
    const v = await voice({ ...RULE_ON, mapping: { model: 'batch' } }, 'TR-10432', '14:15');
    await v.ex.kickoff('start', 'Indian English');
    await v.call('mark_my_attendance');
    const before = v.nav.length;
    const text = await v.selfPass(() => true);
    expect(text).toBe("[APP] The check passed and the trainer's own attendance is marked present at 2:15 pm. Say so in one short line.");
    expect(await v.env.app.services.staffAttendance.myRecord(v.ctx)).toMatchObject({ status: 'present', source: 'self' });
    expect(v.nav.length).toBe(before); // no jump from My attendance to a roster nobody was told about
    expect(v.ex.flow().sessionKey).toBeFalsy();
  });

  it('own attendance already marked: the normal start, and the batch opens as before', async () => {
    const v = await voice();
    const { verification, staffAttendance } = v.env.app.services;
    const loc = await verification.checkLocation(v.ctx);
    await verification.grant(v.ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    expect((await staffAttendance.markSelf(v.ctx)).ok).toBe(true);
    expect(await v.ex.kickoff('start', 'Indian English')).toMatch(/^\[APP\] Session started\. The trainer sees 5 trades on screen; right now only Electrician, Fitter and Mechanic Diesel/);
    await v.call('select_trade', { trade: 'Electrician' });
    expect(await v.call('select_batch', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: true });
  });
});

const NO_CHECK: ConfigLayer = { verification: { geoMode: 'off', face: false } };

describe('carried over from the Task 9 review (D-152, D-156)', () => {
  it('M1: in a Marathi session the question after the self mark is the opening language\'s line, never English', async () => {
    const v = await voice({ ...RULE_ON, ...NO_CHECK }, 'TR-10432', '20:30', 'mr'); // every window has closed: the help question follows
    await v.ex.kickoff('start', 'Marathi');
    const r = await v.call('mark_my_attendance');
    expect(r).toMatchObject({ ok: true, marked: true });
    expect(r.instruction).toContain('Then, in the same turn: ');
    expect(r.instruction).toContain('ask "मी काय मदत करू?"');
    expect(r.instruction).not.toContain('How can I help?');
  });

  it('M3: when the screen state cannot be read after the self mark is saved, the follow-on is dropped, never "something went wrong"', async () => {
    const v = await voice({ ...RULE_ON, ...NO_CHECK, mapping: { model: 'batch' } }, 'TR-10432', '14:15');
    await v.ex.kickoff('start', 'Indian English');
    vi.spyOn(v.env.app.services.attendance, 'myBoard').mockRejectedValue(new Error('offline'));
    const r = await v.call('mark_my_attendance');
    expect(r).toEqual({ ok: true, marked: true, time: '2:15 pm', instruction: "The trainer's own attendance is marked present at 2:15 pm. Say so in one short line." });
    expect((await v.env.app.services.staffAttendance.myRecord(v.ctx))?.status).toBe('present');
  });

  it('M3: the same on the check path: the pass is said, without the follow-on', async () => {
    const v = await voice({ ...RULE_ON, mapping: { model: 'batch' } }, 'TR-10432', '14:15');
    await v.ex.kickoff('start', 'Indian English');
    expect(await v.call('mark_my_attendance')).toMatchObject({ ok: true, step: 'VERIFY' });
    vi.spyOn(v.env.app.services.attendance, 'myBoard').mockRejectedValue(new Error('offline'));
    expect(await v.selfPass()).toBe("[APP] The check passed and the trainer's own attendance is marked present at 2:15 pm. Say so in one short line.");
  });

  it('M5: a refresh or a Reconnect before the trainer answers "Shall I start?" asks for own attendance again, never the trade', async () => {
    const v = await voice();
    await v.ex.kickoff('start', 'Indian English');
    const refreshed = await v.ex.refresh(null);
    expect(refreshed).toBe(
      '[APP] The connection was refreshed; trust these facts over your memory. The trainer\'s own attendance is not marked today; it must be marked before any student attendance. Your question about it may have been lost: say in one short line, in Indian English: "Please mark your attendance first. Shall I start?" Then wait. On yes, call mark_my_attendance. Until it is marked, no trade or batch can be opened. If the trainer asks for one instead, call no tool: say in one short line that their own attendance comes first and ask whether to start it. Then stop and wait: call mark_my_attendance only after the trainer says yes.',
    );
    expect(refreshed).not.toMatch(/choosing the trade/);
    const reconnected = await v.ex.kickoff('reconnect', 'Indian English');
    expect(reconnected).toMatch(/^\[APP\] Reconnected\. The trainer's own attendance is not marked today; it must be marked before any student attendance\. Your question about it may have been lost: say in one short line, in Indian English: "Please mark your attendance first\. Shall I start\?"/);
    // a Marathi session asks in Marathi
    const mr = await voice(RULE_ON, 'TR-10432', '10:15', 'mr');
    await mr.ex.kickoff('start', 'Marathi');
    expect(await mr.ex.refresh(null)).toContain('in Marathi: "कृपया आधी तुमची हजेरी नोंदवा. सुरू करू का?"');
  });

  it('M5: without the rule the refresh keeps the "later" path; once own attendance is marked the refresh is the usual one', async () => {
    const soft = await voice(RULE_OFF);
    await soft.ex.kickoff('start', 'Indian English');
    expect(await soft.ex.refresh(null)).toContain('If the trainer says later, or names a trade or batch instead, continue without it: ');
    const v = await voice({ ...RULE_ON, ...NO_CHECK });
    await v.ex.kickoff('start', 'Indian English');
    await v.call('mark_my_attendance');
    const after = await v.ex.refresh(null);
    expect(after).not.toMatch(/own attendance/);
    // while the check voice opened is running, the refresh does not ask again either
    const checking = await voice();
    await checking.ex.kickoff('start', 'Indian English');
    await checking.call('mark_my_attendance');
    expect(await checking.ex.refresh(null)).not.toMatch(/Shall I start/);
  });

  it('without the rule, once the trainer answered the ask ("later"), a refresh or Reconnect does not ask again', async () => {
    const said = await voice(RULE_OFF);
    await said.ex.kickoff('start', 'Indian English');
    said.speak(); // "later": the model answers with the offer, no tool
    expect(await said.ex.refresh(null)).not.toMatch(/Shall I start|own attendance/);
    expect(await said.ex.kickoff('reconnect', 'Indian English')).not.toMatch(/Shall I start|own attendance/);
    const picked = await voice(RULE_OFF);
    await picked.ex.kickoff('start', 'Indian English');
    expect(await picked.call('get_status')).toMatchObject({ ok: true }); // the model reads the batches
    expect(await picked.ex.refresh(null)).not.toMatch(/Shall I start|own attendance/);
  });

  it('with the rule, the ask stands after any answer: a refresh asks again until it is marked', async () => {
    const v = await voice();
    await v.ex.kickoff('start', 'Indian English');
    v.speak();
    expect(await v.call('select_trade', { trade: 'Electrician' })).toMatchObject({ error: 'SELF_FIRST' });
    expect(await v.ex.refresh(null)).toContain('"Please mark your attendance first. Shall I start?"');
  });

  it('M8: the kickoff never auto-opens a card own attendance first blocks (here the own record could not be read)', async () => {
    const v = await voice({ ...RULE_ON, mapping: { model: 'batch' } }, 'TR-10432', '14:15');
    const board = await v.env.app.services.attendance.myBoard(v.ctx);
    const open = board.flatMap((g) => g.cards).filter((c) => c.status === 'open' && c.canMark);
    expect(open).toHaveLength(1);
    expect(open[0].selfFirst).toBe(true);
    vi.spyOn(v.env.app.services.staffAttendance, 'myRecord').mockRejectedValue(new Error('offline'));
    const text = await v.ex.kickoff('start', 'Indian English');
    expect(text).toMatch(/^\[APP\] Session started\. /);
    expect(text).not.toContain('so the app opened it');
    expect(v.nav).toEqual([]);
    expect(v.ex.flow().step).not.toBe('VERIFY');
  });
});

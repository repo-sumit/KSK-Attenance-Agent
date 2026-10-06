/**
 * Live-model harness (Task 20, Step 3): the REAL Gemini Live model, the real executor and the mock container. The
 * trainer is a script of typed turns; verification is granted through the service where the screen would do it.
 * Run with `npm run test:voice-live` (GEMINI_API_KEY from .env.development); without a key every test is skipped.
 * Costs quota: a run is forty conversations. VOICE_LIVE_TRANSCRIPT=1 prints what the model said (mock names only).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileVoicePlan } from '@/domain/voice/plan';
import { voiceFor } from '@/domain/voice/voices';
import { mergeConfigLayer } from '@/config/resolve';
import type { ConfigLayer, Language } from '@/config/types';
import { instantAt } from '@/lib/time';
import { createExecutor, type VoiceExecutor } from '@/services/voice/executor';
import { ActionBus } from '@/services/voice/action-bus';
import { PAUSE_EVENT } from '@/services/voice/app-events';
import type { LiveSetup } from '@/services/voice/live/transport';
import { buildSystemPrompt, firstName, SPEECH_LANGUAGE } from '@/services/voice/prompt';
import { buildTools } from '@/services/voice/tools';
import { setup as appSetup, signIn, TODAY } from '../helpers/app';
import { LiveDriver, type TurnReport } from './driver';

const MODEL = 'gemini-3.8-live';
const apiKey = process.env.GEMINI_API_KEY ?? '';
const TODAY_TEXT = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });

const drivers: LiveDriver[] = [];
afterEach(() => {
  for (const d of drivers.splice(0)) d.close();
});

/** Own attendance first as the rule (D-152, Maharashtra): the helpers run with it off unless a scenario is about it. */
const RULE_ON: ConfigLayer = { staff: { selfBeforeStudents: true } };

/**
 * A signed-in trainer with voice on, the real executor, and a live connection with the production prompt and tools.
 * `screen`: the language the app is shown in (voice opens in it, as VoiceProvider passes the screen's language).
 * `selfMarked`: the trainer's own attendance is marked before voice starts (Rajesh is not, in the seed), for scenarios
 * that are not about own attendance first (D-152); its pass is not reused for a batch, so the batch check still runs.
 */
async function conversation(layer: ConfigLayer = {}, trainerId = 'TR-10432', screen: Language = 'en', { selfMarked = false } = {}) {
  const noReuse: ConfigLayer = selfMarked ? { verification: { selfPassReuseMinutes: 0 } } : {};
  const env = appSetup(mergeConfigLayer<ConfigLayer>(mergeConfigLayer<ConfigLayer>({ voice: { enabled: true } }, noReuse), layer));
  const ctx = await signIn(env.app, trainerId);
  if (selfMarked) {
    const loc = await env.app.services.verification.checkLocation(ctx, { kind: 'self' });
    await env.app.services.verification.grant(ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    expect((await env.app.services.staffAttendance.markSelf(ctx)).ok, 'own attendance marked first').toBe(true);
  }
  const plan = compileVoicePlan(ctx, screen)!;
  const holder: { driver?: LiveDriver } = {}; // the executor reads the trainer's turn count live, from the driver built next
  let generation = 1; // a goAway swap's new connection (newConnection) bumps it, as the session's link does
  const bus = new ActionBus();
  const navigated: string[] = [];
  bus.subscribe((e) => e.type === 'navigate' && navigated.push(e.href));
  const shown: string[] = []; // the other screen events (open_register, show_at_risk, ...): what voice put on the screen
  bus.subscribe((e) => e.type !== 'navigate' && shown.push(e.type));
  const executor: VoiceExecutor = createExecutor({
    ctx, plan, bus,
    attendance: env.app.services.attendance, verification: env.app.services.verification, drafts: env.app.services.drafts,
    announcements: env.app.services.announcements, staffAttendance: env.app.services.staffAttendance, reports: env.app.services.reports,
    isOnline: () => true, nowMs: () => performance.now(), speechSeq: () => holder.driver?.speech.counts.speechSeq ?? 0, turnSeq: () => holder.driver?.speech.counts.turnSeq ?? 0,
    spokeAtTurn: () => holder.driver?.speech.counts.spokeAtTurn ?? 0, generation: () => generation,
    entropy: () => crypto.getRandomValues(new Uint32Array(1))[0] / 2 ** 32,
  });
  const who = { trainerFirstName: firstName(ctx.user.name), instituteName: ctx.institute.shortName, todayText: TODAY_TEXT.format(env.clock.now()) };
  const liveSetup: LiveSetup = { model: MODEL, systemInstruction: buildSystemPrompt(plan, who), tools: buildTools(plan), voiceName: voiceFor(ctx.journey.voice, plan.openingLanguage) }; // as VoiceService chooses it (D-155)
  const driver = await LiveDriver.open(apiKey, liveSetup, executor);
  holder.driver = driver;
  drivers.push(driver);
  const log: string[] = [];
  const say = async (text: string, trainer = true, replyWithinMs?: number): Promise<TurnReport> => {
    const turn = await driver.say(text, trainer, replyWithinMs);
    // a late reply to the previous turn (logged above as "model: " with nothing), drained before this send
    if (process.env.VOICE_LIVE_TRANSCRIPT && turn.drained !== null) log.push(`        model (late): ${turn.drained}`);
    const calls = turn.tools.map((t) => `${t.name}${t.error ? `!${t.error}` : ''}`).join(', ') || '-';
    const ms = (v: number | null) => (v === null ? '-' : String(v));
    log.push(`${trainer ? 'trainer' : '[APP]  '} "${text.slice(0, 60)}"  tools: ${calls}  first audio ${ms(turn.firstAudioMs)} ms, first tool ${ms(turn.firstToolMs)} ms, turn ${turn.totalMs} ms`);
    if (process.env.VOICE_LIVE_TRANSCRIPT) log.push(`        model: ${turn.said}`);
    return turn;
  };
  /** Prints the timeline once the scenario is over, pass or fail. */
  const report = (title: string) => console.info(`\n[voice-live] ${title}\n${log.join('\n')}`);

  const flow = () => executor.flow();
  const key = () => flow().sessionKey!;
  /** The kickoff text (it may open the only open batch itself), then the model's first turn on it. */
  const kickoff = () => executor.kickoff('start', SPEECH_LANGUAGE[screen]);
  const sessionStart = async () => say(await kickoff(), false);
  /**
   * The trainer's check as the verification screen runs it: the face camera opens (its text goes once the agent's check
   * line is over, D-148, as here after the turn) and the agent stays quiet; the face matches and the camera closes;
   * then the pass, as the screen would grant it, and the executor's [APP] text.
   */
  const verifyPass = async () => {
    const purpose = `session:${key()}`;
    const camera = await executor.onVerification({ type: 'camera', purpose, on: true });
    expect(camera, 'the camera text').toMatch(/^\[APP\] The face camera is open\./);
    const quiet = await say(camera!, false, 8_000); // "say nothing": the model may give no turn at all
    expect(quiet.tools, 'no tool while the camera is open').toEqual([]);
    expect(quiet.said.trim().split(/\s+/).filter(Boolean).length, 'quiet (a few words at most) while the camera is open').toBeLessThanOrEqual(6);
    expect(await executor.onVerification({ type: 'face', purpose, result: 'match' }), 'a match says nothing').toBeNull();
    expect(await executor.onVerification({ type: 'camera', purpose, on: false }), 'the camera closing says nothing').toBeNull();
    const target = { kind: 'session', key: key() } as const;
    const loc = await env.app.services.verification.checkLocation(ctx, target);
    await env.app.services.verification.grant(ctx, target, loc.ok ? loc.value : undefined);
    const text = await executor.onVerification({ type: 'granted', purpose: `session:${key()}` });
    expect(text, 'the executor tells the model the batch opened').toMatch(/^\[APP\]/);
    return say(text!, false);
  };
  /** Trade, batch and the verification pass: the batch is open for marking. */
  const openBatch = async () => {
    await sessionStart();
    await say('Electrician');
    expect(flow().step, 'after the trade').toBe('SELECT_BATCH');
    const line = await say('shift 1 unit 2');
    expect(flow().step, 'after the batch').toBe('VERIFY');
    expect(line.said, 'the check line names the location or the camera (D-148)').toMatch(CHECK_LINE);
    await verifyPass();
    expect(flow().step, 'after the pass').toBe('ROLL_CALL');
  };
  const draft = () => env.app.services.drafts.get(key())!;
  const submission = () => env.app.repositories.attendance.getSubmission(key());
  const toolsOf = () => driver.turns.flatMap((t) => t.tools);
  /** A goAway swap as the session makes it: the new connection voids every code (adopted), then the refresh text goes out. */
  const newConnection = () => {
    executor.voidConfirmations();
    generation += 1;
  };
  /** Speech after the last reported turn (a reply in a turn of its own), logged with the timeline. */
  const lateSpeech = async () => {
    const said = await driver.lateSpeech();
    if (process.env.VOICE_LIVE_TRANSCRIPT) log.push(`        model (late): ${said}`);
    return said;
  };
  return { env, ctx, executor, say, report, flow, key, kickoff, verifyPass, openBatch, draft, submission, toolsOf, navigated, shown, turns: driver.turns, newConnection, lateSpeech };
}

/** The agent's one line as a check starts (D-148): it names the location or the camera, in English or Marathi. */
const CHECK_LINE = /camera|location|कॅमेर|कॅमर|स्थान|लोकेशन|ठिकाण|जागा/i;

const absents = (marks: Readonly<Record<string, { status: string | null }>>) => Object.entries(marks).filter(([, m]) => m.status === 'absent').map(([id]) => id);

/** Hindi the model must never answer with (Task 19): romanised, as whole lower-case words or word runs. */
const HINDI_WORDS = ['karein', 'kijiye', 'hai', 'hain', 'kya', 'yeh', 'aaj', 'kar do', 'nahi aaya'];
/** Hindi that is never Marathi either, romanised and in Devanagari. */
const HINDI_ONLY = ['karein', 'kijiye', 'hai', 'hain', 'kya', 'करें', 'कीजिए', 'करिए', 'है', 'हैं', 'क्या'];
const DEVANAGARI = /[\u0900-\u097F]/;
/** The tokens of `tokens` that `said` contains as whole words (letters and marks, so Devanagari words stay whole). */
const hindiIn = (said: string, tokens: readonly string[]): string[] => {
  const words = ` ${said.toLowerCase().split(/[^\p{L}\p{M}']+/u).filter(Boolean).join(' ')} `;
  return tokens.filter((t) => words.includes(` ${t} `));
};

describe.skipIf(!apiKey)('Voice Agent against the live model', () => {
  it('(a) by exception: one absent, a check question, then one confirmed submission', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.openBatch();
      await c.say('sab present, sirf Aditi absent');
      expect(absents(c.draft().marks), 'Aditi is marked absent by voice').toEqual(['ele-s1u2-r02']);
      // "sirf" says that is all: the submit question comes next (an older wording asked a check question first): the trainer answers each.
      for (let i = 0; i < 4 && !(await c.submission()); i++) await c.say('haan');
      const done = await c.submission();
      expect(done, 'a submission exists').toBeDefined();
      expect(absents(done!.marks)).toEqual(['ele-s1u2-r02']);
      expect(Object.keys(done!.marks)).toHaveLength(31);
      expect(c.toolsOf().filter((t) => t.name === 'submit_attendance' && t.ok), 'submitted exactly once').toHaveLength(1);
      expect(c.flow().step).toBe('SUBMITTED');
    } finally {
      c.report('(a) by exception');
    }
  });

  /** The Hinglish absentee flow of Task 19 on a batch already open: one absent, "bas", then the yes until it is submitted. */
  const hinglishFlow = async (c: Awaited<ReturnType<typeof conversation>>) => {
    await c.openBatch();
    await c.say('aaj Rahul nahi aaya');
    expect(absents(c.draft().marks), 'Rahul is marked absent by voice').toEqual(['ele-s1u2-r21']);
    await c.say('bas');
    for (let i = 0; i < 3 && !(await c.submission()); i++) await c.say('haan submit kar do');
    expect(await c.submission(), 'a submission exists').toBeDefined();
    expect(c.toolsOf().filter((t) => t.name === 'submit_attendance' && t.ok), 'submitted exactly once').toHaveLength(1);
    const late = await c.lateSpeech(); // the reply to the submit may come in a turn of its own
    return [...c.turns.map((t) => t.said), late].filter(Boolean);
  };

  it('(aa) English screen, a Hinglish trainer: every reply is English, never Hindi; one submission (Task 19)', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      const replies = await hinglishFlow(c);
      for (const said of replies) {
        expect(said, 'no Devanagari in an English reply').not.toMatch(DEVANAGARI);
        expect(hindiIn(said, HINDI_WORDS), `no Hindi words in "${said}"`).toEqual([]);
      }
    } finally {
      c.report('(aa) Hinglish on an English screen');
    }
  });

  it('(ab) Marathi screen, a Hinglish trainer: Marathi (or English) replies, never Hindi-only words; one submission (Task 19)', async () => {
    const c = await conversation({}, 'TR-10432', 'mr', { selfMarked: true });
    try {
      const replies = await hinglishFlow(c);
      for (const said of replies) expect(hindiIn(said, HINDI_ONLY), `no Hindi-only words in "${said}"`).toEqual([]);
    } finally {
      c.report('(ab) Hinglish on a Marathi screen');
    }
  });

  it('(b) roll call: three answers, then mark_remaining only after a confirmation', async () => {
    const c = await conversation({ marking: { defaultStatus: 'blank' } }, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.openBatch();
      for (let i = 0; i < 3; i++) await c.say('present');
      const voiced = Object.values(c.draft().sources).filter((s) => s.via === 'voice');
      expect(voiced, 'three students were marked by voice').toHaveLength(3);
      expect(Object.values(c.draft().marks).filter((m) => m.status === 'present')).toHaveLength(3);

      await c.say('baaki sab present');
      const remaining = c.toolsOf().filter((t) => t.name === 'mark_remaining');
      expect(remaining[0], 'mark_remaining first asks for a confirmation').toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
      expect(Object.keys(c.draft().sources), 'nobody else is marked before the yes').toHaveLength(3);

      await c.say('haan');
      expect(c.toolsOf().some((t) => t.name === 'mark_remaining' && t.ok && t.args.confirm_token !== undefined), 'the confirmed call went through').toBe(true);
      expect(Object.values(c.draft().marks).filter((m) => m.status === 'present')).toHaveLength(31);
      expect(await c.submission(), 'nothing was submitted').toBeUndefined();
    } finally {
      c.report('(b) roll call');
    }
  });

  it('(c) a misheard name: the model asks again instead of marking', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.openBatch();
      const turn = await c.say('sirf Quentin absent');
      expect(absents(c.draft().marks), 'nobody is marked absent').toEqual([]);
      expect(Object.keys(c.draft().sources), 'nobody is marked at all').toEqual([]);
      expect(turn.tools.some((t) => t.name === 'mark_remaining')).toBe(false);
      expect(await c.submission()).toBeUndefined();
      // It either tried the name (NOT_FOUND) or asked at once; either way it ends on a question to the trainer.
      expect(turn.tools.every((t) => t.name !== 'set_student_status' || t.error === 'NOT_FOUND')).toBe(true);
      expect(turn.said, 'the model asks again').toMatch(/\?|कृपया|फिर से|पुन्हा|again|repeat|dobara/i);
    } finally {
      c.report('(c) misheard name');
    }
  });

  /** Meera Kulkarni (Employability Skills, batch mapping) at 10:15: three Shift 1 batches open, two Shift 2 batches open at 2:00 pm. */
  const MEERA: [ConfigLayer, string] = [{ mapping: { model: 'batch' } }, 'TR-11024'];
  /** What a later batch would sound like in English, Hindi or Marathi. */
  const LATER = /welder|वेल्डर|shift (2|two)|शिफ्ट (2|दो|दोन)|2(:00)? ?(pm|p\.m\.)|two o.?clock|दोपहर|दुपारी|later|baad mein|नंतर/i;

  it('(d) two or more open and later batches: the first turn names no later batch and asks which one', async () => {
    const c = await conversation(...MEERA);
    try {
      const text = await c.kickoff();
      expect(text, 'the kickoff reads only the open batches').not.toMatch(/Shift 2|Welder|2:00/);
      const turn = await c.say(text, false);
      expect(turn.said, 'the model names no later batch').not.toMatch(LATER);
      expect(turn.said, 'the model asks which one').toMatch(/\?|which|kaun|कौन|कोणत/i);
      expect(turn.tools.some((t) => t.name === 'select_batch'), 'nothing is opened before the trainer picks').toBe(false);
      expect(c.flow().step).toBe('SELECT_BATCH');
    } finally {
      c.report('(d) only the open batches');
    }
  });

  it('(e) exactly one open batch: the kickoff opens it before the model calls any tool', async () => {
    const c = await conversation({ mapping: { model: 'batch' } }, 'TR-10518');
    try {
      const text = await c.kickoff();
      expect(text).toMatch(/^\[APP\] Session started\. Only Shift 1, Unit 2, Electrician can be marked now, so the app opened it: do not call select_batch for it\./);
      expect(['VERIFY', 'ROLL_CALL'], 'opened by the kickoff').toContain(c.flow().step);
      const first = await c.say(text, false);
      expect(first.tools.some((t) => t.name === 'select_batch'), 'the model does not open it again').toBe(false);
      expect(first.said, 'the model names no later batch').not.toMatch(LATER);
      await c.verifyPass();
      expect(c.flow().step).toBe('ROLL_CALL');
    } finally {
      c.report('(e) the only open batch');
    }
  });

  it('(f) after a submit with another open batch, the model offers it and "haan" opens it', async () => {
    const c = await conversation(...MEERA);
    try {
      await c.say(await c.kickoff(), false);
      await c.say('Fitter');
      expect(c.flow().step, 'after the batch').toBe('VERIFY');
      await c.verifyPass();
      await c.say('koi absent nahi');
      for (let i = 0; i < 3 && !(await c.submission()); i++) await c.say('haan');
      expect(await c.submission(), 'a submission exists').toBeDefined();
      const submitted = c.toolsOf().find((t) => t.name === 'submit_attendance' && t.ok)!;
      const offered = /call select_batch with id ([^\s.]+(?:\.[^\s.]+)*?)\.(?: |$)/.exec(submitted.instruction)?.[1];
      expect(offered, 'the submit result offers the next open batch').toBeDefined();
      const offer = c.turns.at(-1)!;
      expect(offer.said, 'the model offers the next batch').toMatch(/\?/);
      await c.say('haan');
      expect(c.toolsOf().some((t) => t.name === 'select_batch' && t.ok && t.args.batch === offered), 'select_batch with the offered id').toBe(true);
      expect(c.flow().sessionKey).toBe(offered);
    } finally {
      c.report('(f) the next open batch');
    }
  });

  it('(g) the last open batch of a trade submitted: the model offers another trade\'s open batch and "haan" opens it', async () => {
    const c = await conversation({ verification: { geoMode: 'off', face: false } }, 'TR-10432', 'en', { selfMarked: true });
    const submitAndOffer = async (n: number) => {
      await c.say('koi absent nahi');
      for (let i = 0; i < 3 && c.toolsOf().filter((t) => t.name === 'submit_attendance' && t.ok).length < n; i++) await c.say('haan');
      const submitted = c.toolsOf().filter((t) => t.name === 'submit_attendance' && t.ok)[n - 1];
      expect(submitted, `submission ${n}`).toBeDefined();
      return /call select_batch with id ([^\s.]+(?:\.[^\s.]+)*?)\.(?: |$)/.exec(submitted.instruction)?.[1];
    };
    try {
      const text = await c.kickoff();
      expect(text, 'the kickoff offers only the trades with a batch open now').toContain('"Right now only Electrician, Fitter and Mechanic Diesel have batches open and not yet marked. Which one?"');
      const first = await c.say(text, false);
      expect(first.said, 'no trade without an open batch').not.toMatch(/welder|copa|वेल्डर/i);
      expect(first.tools.some((t) => t.name === 'get_trades'), 'no get_trades before the trainer answers (the kickoff named the trades)').toBe(false);
      await c.say('Electrician');
      await c.say('shift 1 unit 2');
      expect(c.flow().step, 'after the batch').toBe('ROLL_CALL');
      const s1u3 = await submitAndOffer(1);
      expect(s1u3, 'Electrician S1U3 offered').toMatch(/^ele-s1u3\./);
      await c.say('haan');
      expect(c.flow().sessionKey).toBe(s1u3);
      const fitter = await submitAndOffer(2);
      expect(fitter, 'the open Fitter batch offered').toMatch(/^fit-s1u2\./);
      expect(c.turns.at(-1)!.said, 'the model offers it').toMatch(/fitter|फिटर/i);
      await c.say('haan');
      expect(c.toolsOf().some((t) => t.name === 'select_batch' && t.ok && t.args.batch === fitter), 'select_batch with the offered id').toBe(true);
      expect(c.flow()).toMatchObject({ sessionKey: fitter, tradeId: 'fit' });
    } finally {
      c.report('(g) another trade\'s open batch');
    }
  });

  /** One line (at most 25 words) or a question: never a run of sentences. */
  const brief = (said: string) => /\?/.test(said) || said.trim().split(/\s+/).length <= 25;
  const GOODBYE = /good ?bye|\bbye\b|alvida|अलविदा|निरोप/i;
  const ended = (tools: readonly { name: string }[]) => tools.some((t) => t.name === 'end_voice_session');

  it('(j) nothing can be marked at the start: the model says why in one line and asks "How can I help?"; voice stays open (D-142)', async () => {
    // Meera Kulkarni with periods at 11:30: period 3 has closed, the next period opens at 2:00 pm
    const c = await conversation({ mapping: { model: 'timetable' }, marking: { frequency: 'period' } }, 'TR-11024');
    try {
      c.env.clock.set(instantAt(TODAY, '11:30'));
      const text = await c.kickoff();
      expect(text, 'the nothing-markable kickoff').toMatch(/^\[APP\] Session started\. Nothing can be marked right now: the next period opens at 2:00 pm\. Say exactly: "Hi Meera, good morning\." Then: Say that in one line and ask "How can I help\?"\. Then wait\.$/);
      const turn = await c.say(text, false);
      expect(ended(turn.tools), 'voice stays open (D-142)').toBe(false);
      expect(turn.tools.some((t) => t.name === 'select_batch'), 'nothing is opened').toBe(false);
      expect(turn.said, 'the model says something').not.toBe('');
      expect(brief(turn.said), 'one line or a question').toBe(true);
      expect(turn.said, 'no goodbye').not.toMatch(GOODBYE);
      expect(c.flow().step).toBe('SELECT_BATCH');
    } finally {
      c.report('(j) nothing to mark at the start');
    }
  });

  it('(k) the last open batch submitted: the model says so in one line and waits; voice stays open (D-142)', async () => {
    // Sunita Jadhav (batch mapping) at 10:15: only Shift 1 Unit 2 is open; the next batch opens at 2:00 pm
    const c = await conversation({ mapping: { model: 'batch' }, verification: { geoMode: 'off', face: false } }, 'TR-10518');
    try {
      const text = await c.kickoff();
      expect(text).toMatch(/^\[APP\] Session started\. Only Shift 1, Unit 2, Electrician can be marked now, so the app opened it/);
      await c.say(text, false);
      expect(c.flow().step, 'opened by the kickoff').toBe('ROLL_CALL');
      await c.say('koi absent nahi');
      for (let i = 0; i < 3 && !(await c.submission()); i++) await c.say('haan');
      expect(await c.submission(), 'a submission exists').toBeDefined();
      const submitted = c.toolsOf().find((t) => t.name === 'submit_attendance' && t.ok)!;
      expect(submitted.instruction, 'the last-submit text').toContain('nothing else can be marked right now (the next batch opens at 2:00 pm), then stop and wait for the trainer.');
      // the reply to the submit may come in the turn with the call or in a turn of its own right after it
      const said = c.turns.find((t) => t.tools.includes(submitted))!.said || (await c.lateSpeech());
      expect(said, 'the model says it is submitted').not.toBe('');
      expect(brief(said), 'one line or a question').toBe(true);
      expect(said, 'no goodbye').not.toMatch(GOODBYE);
      expect(ended(c.toolsOf()), 'voice stays open (D-142)').toBe(false);
      expect(c.toolsOf().some((t) => t.name === 'select_batch'), 'no later batch is opened').toBe(false);
    } finally {
      c.report('(k) the last open batch submitted');
    }
  });

  /** The output transcript spells numbers out ("Four of seventeen"): a number said as digits or as an English word. */
  const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const saysNumber = (said: string, n: number) => new RegExp(`\\b(${n}${WORDS[n] ? `|${WORDS[n]}` : ''})\\b`, 'i').test(said);

  /** The principal (D-139): no batch flow, today's state, the screens and the notices. */
  const PRINCIPAL: [ConfigLayer, string] = [{}, 'PR-2741'];

  it('(h) the principal\'s kickoff: today\'s state in one line, then what they need; voice stays open', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      const text = await c.kickoff();
      const facts = /Today: (\d+) of (\d+) batches submitted, (\d+) staff not marked yet(?:, the principal included)?\./.exec(text);
      expect(facts, 'the kickoff carries today\'s numbers').not.toBeNull();
      const turn = await c.say(text, false);
      const [, submitted, total, staff] = facts!;
      for (const n of [submitted, total, staff]) expect(saysNumber(turn.said, Number(n)), `the model says ${n}`).toBe(true);
      expect(turn.said, 'the model asks what they need').toMatch(/\?/);
      expect(turn.tools.some((t) => t.name === 'end_voice_session'), 'voice stays open (D-142)').toBe(false);
    } finally {
      c.report('(h) the principal\'s kickoff');
    }
  });

  it('(i) the principal asks for a screen and for today\'s notices: navigate and get_announcements', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      const open = await c.say('open staff attendance');
      expect(open.tools.some((t) => t.name === 'navigate' && t.ok && t.args.to === 'staff_attendance'), 'navigate to staff attendance').toBe(true);
      expect(c.navigated.at(-1)).toBe('/attendance/staff');
      const notices = await c.say('any notices today?');
      expect(notices.tools.some((t) => t.name === 'get_announcements' && t.ok), 'get_announcements').toBe(true);
      expect(notices.said, 'the first notice is read').toMatch(/holiday|सुट्टी|छुट्टी/i);
      expect(notices.said, 'it offers to open them').toMatch(/\?/);
      const yes = await c.say('haan, kholo');
      expect(yes.tools.some((t) => t.name === 'navigate' && t.ok && t.args.to === 'announcements'), 'yes opens the notices').toBe(true);
      expect(c.toolsOf().some((t) => t.name === 'end_voice_session'), 'voice stays open (D-142)').toBe(false);
    } finally {
      c.report('(i) a screen and the notices');
    }
  });

  /** A whole number said as digits or English words ("forty-six", "forty six"), for the report figures. */
  const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
  const saysFigure = (said: string, n: number) => {
    const words = n < 21 ? WORDS[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `[- ]${WORDS[n % 10]}` : ''}`;
    return new RegExp(`\\b(${n}|${words})\\b`, 'i').test(said);
  };

  it('(l) an instructor asks who is at risk: get_at_risk, the lowest names with their figures, then the screen on yes (D-140)', async () => {
    // Rajesh Patil: Electrician Shift 1 Unit 1 and Shift 2 Unit 1; 6 students at risk, Tushar Hande lowest at 56%
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('mere batches mein kaun kaun at risk hai?');
      const risk = asked.tools.find((t) => t.name === 'get_at_risk' && t.ok);
      expect(risk, 'get_at_risk answered').toBeDefined();
      expect(risk!.instruction).toMatch(/^6 students at risk \(below 75% over the last 30 days\) in 2 batches; lowest first: Tushar Hande 56%/);
      expect(asked.said, 'the lowest student is named').toMatch(/tushar/i);
      expect(saysFigure(asked.said, 56), 'with the lowest student\'s percentage from the result').toBe(true);
      expect(asked.said, 'it offers to show it').toMatch(/\?/);
      expect(asked.tools.some((t) => t.name === 'show_report'), 'nothing is shown before a yes').toBe(false);
      const yes = await c.say('haan, dikhao');
      expect(yes.tools.some((t) => t.name === 'show_report' && t.ok), 'yes shows the report').toBe(true);
      expect(c.navigated.at(-1)).toBe('/reports');
      expect(c.flow().step, 'no batch was opened').not.toBe('ROLL_CALL');
    } finally {
      c.report('(l) who is at risk');
    }
  });

  it('(m) the principal asks for the lowest student of a batch: get_batch_report, the right name and percentage (D-140)', async () => {
    // Electrician Shift 1 Unit 2: Aniket Bhosale is lowest at 46% (12 of 26 days)
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('who has the lowest attendance in Electrician shift 1 unit 2?');
      const report = asked.tools.find((t) => t.name === 'get_batch_report' && t.ok);
      expect(report, 'get_batch_report answered').toBeDefined();
      expect(report!.instruction).toContain(' Lowest: Aniket Bhosale 46% (12 of 26 days), ');
      expect(asked.said, 'the lowest student is named').toMatch(/aniket/i);
      expect(saysFigure(asked.said, 46), 'with their percentage').toBe(true);
      expect(brief(asked.said), 'one or two short sentences').toBe(true);
      expect(c.navigated, 'answering opens nothing').toEqual([]);
    } finally {
      c.report('(m) the lowest student of a batch');
    }
  });

  it('(n) an instructor asks to mark their own attendance: mark_my_attendance, the screen\'s check, the pass marks it (D-141)', async () => {
    const c = await conversation();
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('meri attendance lagao');
      expect(asked.tools.some((t) => t.name === 'mark_my_attendance' && t.ok), 'mark_my_attendance opened the check').toBe(true);
      expect(c.navigated.at(-1)).toBe('/me/attendance');
      expect(await c.env.app.services.staffAttendance.myRecord(c.ctx), 'nothing is saved before the pass').toBeUndefined();
      expect(asked.said, 'the check line names the location or the camera (D-148)').toMatch(CHECK_LINE);
      // the screen's check passes (simulated location and face), as VerificationFlow would grant it
      const target = { kind: 'self' } as const;
      const loc = await c.env.app.services.verification.checkLocation(c.ctx, target);
      await c.env.app.services.verification.grant(c.ctx, target, loc.ok ? loc.value : undefined);
      const text = await c.executor.onVerification({ type: 'granted', purpose: 'self' });
      expect(text, 'the executor saves it, tells the model and leads on to the students').toMatch(/^\[APP\] The check passed and the trainer's own attendance is marked present at .+ Then, in the same turn: /);
      const done = await c.say(text!, false);
      expect(await c.env.app.services.staffAttendance.myRecord(c.ctx)).toMatchObject({ status: 'present', source: 'self' });
      expect(done.said, 'the model says it is marked').toMatch(/mark|हजेरी|लगा|लावली|present/i);
      expect(brief(done.said), 'one short line').toBe(true);
      expect(c.toolsOf().some((t) => t.name === 'end_voice_session'), 'voice stays open (D-142)').toBe(false);
    } finally {
      c.report('(n) mark my attendance');
    }
  });

  it('(o) the principal marks one staff member: mark_staff asks with a code, and only the yes saves it (D-141)', async () => {
    const c = await conversation(...PRINCIPAL);
    const record = async () => (await c.env.app.services.staffAttendance.day(c.ctx)).find((r) => r.member.id === 'st-pradeep')?.record;
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('mark Pradeep Gawde absent');
      const ask = asked.tools.find((t) => t.name === 'mark_staff');
      expect(ask, 'mark_staff asked first').toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
      expect(await record(), 'nothing is saved before the yes').toBeUndefined();
      expect(asked.said, 'the model asks the question').toMatch(/\?/);
      expect(asked.said, 'it names the person').toMatch(/pradeep/i);
      const yes = await c.say('haan');
      expect(yes.tools.some((t) => t.name === 'mark_staff' && t.ok && t.args.confirm_token !== undefined), 'the confirmed call went through').toBe(true);
      expect(await record()).toMatchObject({ status: 'absent', source: 'principal' });
      expect(c.toolsOf().filter((t) => t.name === 'mark_staff' && t.ok), 'saved exactly once').toHaveLength(1);
      expect(yes.said, 'the model says it is marked').toMatch(/absent|marked|हजेरी/i);
    } finally {
      c.report('(o) the principal marks a staff member');
    }
  });

  it('(p) the principal resumes after Pause: no student to continue from, no numbers unasked, the next request is answered', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      const kickoff = await c.kickoff();
      const figures = /Today: (\d+) of (\d+) batches submitted/.exec(kickoff)!;
      await c.say(kickoff, false);
      await c.say(PAUSE_EVENT, false);
      const resume = c.executor.resumeText();
      expect(resume).not.toMatch(/student/);
      const back = await c.say(resume, false);
      expect(back.tools.some((t) => t.name === 'get_status'), 'today\'s numbers are not read unasked').toBe(false);
      expect(saysNumber(back.said, Number(figures[1])) && saysNumber(back.said, Number(figures[2])), 'no numbers unasked').toBe(false);
      expect(back.said, 'nothing about a student').not.toMatch(/student|विद्यार्थी/i);
      const notices = await c.say('any notices today?');
      expect(notices.tools.some((t) => t.name === 'get_announcements' && t.ok), 'the next request is answered').toBe(true);
      expect(notices.said, 'the model speaks again after the resume').not.toBe('');
    } finally {
      c.report('(p) the principal resumes after Pause');
    }
  });

  it('(q) the principal\'s Reconnect: get_status and today\'s state in one line, then the next request is answered (no silence)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      await c.say('any notices today?');
      const text = await c.executor.kickoff('reconnect', SPEECH_LANGUAGE.en);
      expect(text).not.toMatch(/say nothing/i);
      const back = await c.say(text, false);
      expect(back.tools.some((t) => t.name === 'get_status' && t.ok), 'get_status after the reconnect').toBe(true);
      expect(back.said, 'it says today\'s state').not.toBe('');
      expect(brief(back.said), 'one line').toBe(true);
      const open = await c.say('open staff attendance');
      expect(open.tools.some((t) => t.name === 'navigate' && t.ok && t.args.to === 'staff_attendance'), 'the next request is answered').toBe(true);
      expect(open.said, 'the model speaks after the reconnect').not.toBe('');
    } finally {
      c.report('(q) the principal\'s Reconnect');
    }
  });

  it('(r) a mark_staff question pending across a goAway swap is asked again with a fresh code; one yes saves it (D-082)', async () => {
    const c = await conversation(...PRINCIPAL);
    const record = async () => (await c.env.app.services.staffAttendance.day(c.ctx)).find((r) => r.member.id === 'st-pradeep')?.record;
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('mark Pradeep Gawde absent');
      const ask = asked.tools.find((t) => t.name === 'mark_staff' && t.error === 'NEEDS_CONFIRMATION');
      expect(ask, 'mark_staff asked first').toBeDefined();
      c.newConnection(); // the old code is void now
      const refresh = await c.executor.refresh(ask!.instruction, 'mark Pradeep Gawde absent');
      const fresh = /confirm_token "([A-Z2-9]{4})"/.exec(refresh)?.[1];
      expect(fresh, 'the refresh carries a new code').toBeDefined();
      const again = await c.say(refresh, false);
      expect(again.said, 'the question is asked again').toMatch(/\?/);
      expect(again.said, 'it names the person').toMatch(/pradeep/i);
      expect(await record(), 'nothing is saved before the yes').toBeUndefined();
      const yes = await c.say('haan');
      expect(yes.tools.some((t) => t.name === 'mark_staff' && t.ok && t.args.confirm_token === fresh), 'the yes saves it with the new code').toBe(true);
      expect(await record()).toMatchObject({ status: 'absent', source: 'principal' });
      expect(c.toolsOf().filter((t) => t.name === 'mark_staff' && t.ok), 'saved exactly once').toHaveLength(1);
    } finally {
      c.report('(r) mark_staff across a goAway swap');
    }
  });

  it('(s) the announcements asked for with none today: nothing opens, and the model says there are no notices', async () => {
    const c = await conversation(...PRINCIPAL);
    vi.spyOn(c.env.app.services.announcements, 'forUser').mockResolvedValue([]);
    try {
      await c.say(await c.kickoff(), false);
      const turn = await c.say('open the announcements');
      const nav = turn.tools.find((t) => t.name === 'navigate');
      if (nav) expect(nav, 'navigate opens nothing').toMatchObject({ ok: false, error: 'NO_NOTICES' });
      expect(turn.tools.some((t) => t.name === 'navigate' || t.name === 'get_announcements'), 'a notices tool answered').toBe(true);
      expect(c.navigated, 'nothing opens').toEqual([]);
      expect(turn.said, 'it says there are none').toMatch(/no (notices|announcements)|not any|none|koi .*nahi|नाही|नहीं/i);
    } finally {
      c.report('(s) no notices today');
    }
  });

  /** A percentage the result gave ("87%"), as a number. */
  const pctsIn = (text: string) => [...text.matchAll(/(\d+)%/g)].map((m) => Number(m[1]));

  it('(t) an instructor on Reports: Resume, Reconnect and a refresh say where they are, read no batch, and the next request is answered', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.say(await c.kickoff(), false);
      await c.executor.onScreen({ kind: 'other', screen: 'reports' }); // the trainer tapped Reports
      await c.say(PAUSE_EVENT, false, 10_000); // Pause: the model may stay quiet without a turn
      const resume = c.executor.resumeText();
      expect(resume).toMatch(/^\[APP\] The trainer is back from the screen\. They are on the Reports screen;/);
      const back = await c.say(resume, false);
      expect(back.tools, 'no tool call on Resume').toEqual([]);
      expect(back.said, 'a few words, not silence').not.toBe('');
      expect(brief(back.said), 'one short line').toBe(true);
      expect(back.said, 'no batch or trade read out').not.toMatch(/electrician|fitter|shift|शिफ्ट|इलेक्ट्रिशियन/i);
      const reconnect = await c.executor.kickoff('reconnect', SPEECH_LANGUAGE.en);
      expect(reconnect).toMatch(/^\[APP\] Reconnected\. The trainer is on the Reports screen;/);
      const again = await c.say(reconnect, false);
      expect(again.tools, 'no tool call on Reconnect').toEqual([]);
      expect(again.said, 'a few words after the reconnect').not.toBe('');
      expect(again.said, 'no batch or trade read out').not.toMatch(/electrician|fitter|shift|शिफ्ट|इलेक्ट्रिशियन/i);
      // a refresh only says where the trainer is and to wait: a reply is not required
      const refresh = await c.say(await c.executor.refresh(null), false, 10_000);
      expect(refresh.tools, 'no tool call on a refresh').toEqual([]);
      expect(refresh.said, 'no batch or trade read out').not.toMatch(/electrician|fitter|shift|शिफ्ट|इलेक्ट्रिशियन/i);
      const asked = await c.say('how are my batches doing?');
      expect(asked.tools.some((t) => t.name === 'get_reports_overview' && t.ok), 'the next request is answered').toBe(true);
      expect(ended(c.toolsOf()), 'voice stays open (D-142)').toBe(false);
    } finally {
      c.report('(t) Resume, Reconnect and a refresh on Reports');
    }
  });

  it('(u) voice started on My attendance: it asks for own attendance first, opens no batch, and "haan" runs mark_my_attendance', async () => {
    const c = await conversation({ mapping: { model: 'batch' } });
    try {
      await c.executor.onScreen({ kind: 'self' }); // voice started on My attendance
      const text = await c.kickoff();
      expect(text).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today\./);
      const first = await c.say(text, false);
      expect(first.tools.some((t) => t.name === 'select_batch' || t.name === 'mark_my_attendance'), 'nothing before the trainer answers').toBe(false);
      expect(first.said, 'it asks whether to mark it').toMatch(/\?/);
      expect(c.navigated, 'the screen the trainer chose stays').toEqual([]);
      const yes = await c.say('haan');
      expect(yes.tools.some((t) => t.name === 'mark_my_attendance' && t.ok), 'yes runs mark_my_attendance').toBe(true);
      expect(c.flow().step, 'no batch was opened').not.toBe('VERIFY');
    } finally {
      c.report('(u) voice started on My attendance');
    }
  });

  it('(v) the principal\'s Reconnect with a mark_staff question pending: asked again with a fresh code; one yes saves it (D-082)', async () => {
    const c = await conversation(...PRINCIPAL);
    const record = async () => (await c.env.app.services.staffAttendance.day(c.ctx)).find((r) => r.member.id === 'st-pradeep')?.record;
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('mark Pradeep Gawde absent');
      const ask = asked.tools.find((t) => t.name === 'mark_staff' && t.error === 'NEEDS_CONFIRMATION');
      expect(ask, 'mark_staff asked first').toBeDefined();
      c.newConnection(); // Reconnect: the old code is void now
      const text = await c.executor.kickoff('reconnect', SPEECH_LANGUAGE.en, ask!.instruction);
      const fresh = /confirm_token "([A-Z2-9]{4})"/.exec(text)?.[1];
      expect(fresh, 'the Reconnect text carries a new code').toBeDefined();
      const again = await c.say(text, false);
      expect(again.said, 'the question is asked again').toMatch(/\?/);
      expect(again.said, 'it names the person').toMatch(/pradeep/i);
      expect(await record(), 'nothing is saved before the yes').toBeUndefined();
      const yes = await c.say('haan');
      expect(yes.tools.some((t) => t.name === 'mark_staff' && t.ok && t.args.confirm_token === fresh), 'the yes saves it with the new code').toBe(true);
      expect(await record()).toMatchObject({ status: 'absent', source: 'principal' });
    } finally {
      c.report('(v) mark_staff across a Reconnect');
    }
  });

  it('(w) download the register: the sheet opens on Reports, the model says to tap Download; nothing downloads by itself', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('download the register of Electrician shift 1 unit 1');
      const done = asked.tools.find((t) => t.name === 'download_register' && t.ok);
      expect(done, 'download_register answered').toBeDefined();
      expect(done!.instruction).toMatch(/^The register of Shift 1, Unit 1, Electrician for .+ \(so far\) is open on the screen\. Tell the trainer to tap Download/);
      expect(c.navigated.at(-1)).toBe('/reports');
      expect(c.shown, 'only the sheet opens: no download event exists').toEqual(['open_register']);
      const said = asked.said || (await c.lateSpeech());
      expect(said, 'the model says to tap Download').toMatch(/download|डाउनलोड/i);
      expect(said, 'it never claims the file was downloaded').not.toMatch(/\b(downloaded|has been saved|is saved)\b/i);
    } finally {
      c.report('(w) download the register');
    }
  });

  it('(x) an instructor asks how their batches are doing: get_reports_overview, figures from the result only', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('how are my batches doing?');
      const overview = asked.tools.find((t) => t.name === 'get_reports_overview' && t.ok);
      expect(overview, 'get_reports_overview answered').toBeDefined();
      expect(overview!.instruction).toMatch(/^The trainer's 2 batches over the last 30 days: /);
      const figures = pctsIn(overview!.instruction);
      expect(figures.some((n) => saysFigure(asked.said, n)), 'a percentage from the result is said').toBe(true);
      for (const n of pctsIn(asked.said)) expect(figures, `${n}% comes from the result`).toContain(n);
      expect(asked.said, 'it offers to show it').toMatch(/\?/);
      expect(c.navigated, 'answering opens nothing').toEqual([]);
    } finally {
      c.report('(x) how are my batches doing');
    }
  });

  it('(y) an instructor asks about one student by name: get_student_report, the right percentage', async () => {
    // Tushar Hande (one of Rajesh Patil's Electrician batches): 56%, at risk
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('Tushar Hande ki attendance kitni hai?');
      const report = asked.tools.find((t) => t.name === 'get_student_report' && t.ok);
      expect(report, 'get_student_report answered').toBeDefined();
      expect(report!.instruction).toMatch(/^Tushar Hande \(roll \d+, Shift \d, Unit \d, Electrician\) over the last 30 days: 56% /);
      expect(saysFigure(asked.said, 56), 'with the student\'s percentage from the result').toBe(true);
      expect(brief(asked.said), 'one or two short sentences').toBe(true);
    } finally {
      c.report('(y) one student by name');
    }
  });

  it('(z) an instructor asks whether they are marked today: get_my_attendance, today\'s state', async () => {
    const c = await conversation();
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('am I marked today?');
      const mine = asked.tools.find((t) => t.name === 'get_my_attendance' && t.ok);
      expect(mine, 'get_my_attendance answered').toBeDefined();
      expect(asked.said, 'not marked yet').toMatch(/not|n['’]t\b|nahi|नाही|नहीं/i); // "not", "aren't", "haven't"...
      expect(asked.tools.some((t) => t.name === 'mark_my_attendance'), 'nothing is marked unasked').toBe(false);
      expect(await c.env.app.services.staffAttendance.myRecord(c.ctx)).toBeUndefined();
    } finally {
      c.report('(z) am I marked today');
    }
  });

  /** "I can only help with ..." (the round-2 complaint): never said about trades. */
  const ONLY_HELP = /only help|can only (help|assist)/i;
  /** The grant the self screen would give, then the executor's text (with its lead-on). */
  const selfPass = async (c: Awaited<ReturnType<typeof conversation>>) => {
    const loc = await c.env.app.services.verification.checkLocation(c.ctx, { kind: 'self' });
    await c.env.app.services.verification.grant(c.ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    return c.executor.onVerification({ type: 'granted', purpose: 'self' });
  };

  it('(ac) own attendance first: the greeting and the ask, the check, then the same turn names the open trades; the batch opens with no second check', async () => {
    const c = await conversation(RULE_ON);
    try {
      const text = await c.kickoff();
      expect(text).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today; it must be marked before any student attendance\. Say exactly: "Hi Rajesh, good morning\."/);
      const first = await c.say(text, false);
      expect(first.said, 'the app-filled greeting').toMatch(/hi,? rajesh,? good morning/i);
      expect(first.said, 'it asks for own attendance first').toMatch(/attendance/i);
      expect(first.said, 'a question').toMatch(/\?/);
      expect(first.tools, 'nothing before the trainer answers').toEqual([]);
      const yes = await c.say('yes');
      expect(yes.tools.some((t) => t.name === 'mark_my_attendance' && t.ok), 'yes runs mark_my_attendance').toBe(true);
      const passed = await selfPass(c);
      expect(passed).toContain('Then, in the same turn: The trainer sees 5 trades on screen; right now only Electrician, Fitter and Mechanic Diesel');
      const lead = await c.say(passed!, false);
      expect(lead.said, 'it says own attendance is marked').toMatch(/mark|present/i);
      expect(lead.said, 'and leads on to the open trades').toMatch(/electrician|fitter|mechanic/i);
      expect(lead.said, 'with a question').toMatch(/\?/);
      expect(lead.said).not.toMatch(ONLY_HELP);
      await c.say('Electrician');
      expect(c.flow().step, 'after the trade').toBe('SELECT_BATCH');
      await c.say('shift 1 unit 2');
      expect(c.flow().step, 'the self pass is reused: the list opens without a second check').toBe('ROLL_CALL');
      expect(c.navigated.at(-1)).toMatch(/^\/attendance\/mark\?s=ele-s1u2\./);
    } finally {
      c.report('(ac) own attendance first, then the students');
    }
  });

  it('(ad) a batch asked for before own attendance is refused with the reason; nothing opens', async () => {
    const c = await conversation(RULE_ON);
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('Open Electrician shift 1 unit 2');
      // the model refuses from the kickoff's facts, or a selection tool answers SELF_FIRST: either way no batch opens.
      // Live runs: about one in four goes straight on to the trainer's own check (mark_my_attendance only opens it;
      // nothing is saved without the pass), which is where the rule sends them anyway.
      const started = asked.tools.some((t) => t.name === 'mark_my_attendance' && t.ok);
      expect(asked.tools.every((t) => t.error === 'SELF_FIRST' || t.name === 'mark_my_attendance'), 'only a SELF_FIRST refusal or the own check').toBe(true);
      expect(asked.said, 'it says own attendance comes first').toMatch(/attendance/i);
      expect(c.navigated.filter((href) => href !== '/me/attendance'), 'no batch screen opened').toEqual([]);
      expect(c.flow().sessionKey).toBeNull();
      if (!started) {
        expect(asked.said, 'it asks again whether to start').toMatch(/\?/);
        const yes = await c.say('ok, yes');
        expect(yes.tools.some((t) => t.name === 'mark_my_attendance' && t.ok), 'the yes starts it').toBe(true);
      }
      expect(c.navigated, 'only My attendance opens').toEqual(['/me/attendance']);
    } finally {
      c.report('(ad) a batch before own attendance');
    }
  });

  it('(ae) own attendance marked: one line offers the open trades; asked why only those, it gives the reason (never "I can only help with")', async () => {
    const c = await conversation({}, 'TR-10432', 'en', { selfMarked: true });
    try {
      const first = await c.say(await c.kickoff(), false);
      expect(first.said, 'the open trades are offered').toMatch(/electrician/i);
      expect(first.said, 'as open and not yet marked').toMatch(/open|not yet marked|unmarked/i);
      expect(first.said, 'a question').toMatch(/\?/);
      expect(first.said).not.toMatch(ONLY_HELP);
      expect(first.said, 'no other trade read out unasked').not.toMatch(/welder|copa/i);
      const why = await c.say('Why only these? I can see five trades.');
      expect(why.said, 'it names the other trades').toMatch(/welder|copa/i);
      expect(why.said, 'with their reason').toMatch(/submitted|2(:00)? ?(pm|p\.m\.)|two|later|open/i);
      expect(why.said).not.toMatch(ONLY_HELP);
      expect(why.tools.some((t) => t.ok && t.name === 'select_trade'), 'nothing chosen for the trainer').toBe(false);
    } finally {
      c.report('(ae) the trade offer and the reason');
    }
  });

  it('(af) Marathi screen: the Marathi greeting line and the Marathi own-attendance ask', async () => {
    const c = await conversation(RULE_ON, 'TR-10432', 'mr');
    try {
      const text = await c.kickoff();
      expect(text).toContain('Say exactly: "नमस्कार Rajesh, सुप्रभात."');
      expect(text).toContain('"कृपया आधी तुमची हजेरी नोंदवा. सुरू करू का?"');
      const first = await c.say(text, false);
      expect(first.said, 'the Marathi greeting').toMatch(/नमस्कार/);
      expect(first.said, 'the Marathi ask').toMatch(/हजेरी/);
      expect(hindiIn(first.said, HINDI_ONLY), 'no Hindi-only words').toEqual([]);
      expect(first.tools).toEqual([]);
    } finally {
      c.report('(af) the Marathi greeting and ask');
    }
  });

  it('(ag) the principal: "Good morning, Principal", today\'s state, then "How can I help?"', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      const text = await c.kickoff();
      expect(text).toContain('Say exactly: "Good morning, Principal."');
      const first = await c.say(text, false);
      expect(first.said, 'the salutation, not the first name').toMatch(/good morning,? principal/i);
      expect(first.said).not.toMatch(/\banil\b/i);
      expect(first.said, 'the help question').toMatch(/how can i help/i);
      expect(ended(first.tools), 'voice stays open (D-142)').toBe(false);
    } finally {
      c.report('(ag) the principal\'s greeting');
    }
  });

  /** Staff said well (D-156): the principal's own row is "you"; no third-person self. */
  const noOwnName = (said: string) => !/\banil\b|deshmukh/i.test(said);
  const staffRecord = async (c: Awaited<ReturnType<typeof conversation>>, id: string) => (await c.env.app.services.staffAttendance.day(c.ctx)).find((r) => r.member.id === id)?.record;

  it('(ah) "who hasn\'t marked attendance?": get_staff_today, "you" named first, never the principal\'s own name (D-156)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      const turn = await c.say("Who hasn't marked attendance?");
      expect(turn.tools.map((t) => t.name), 'get_staff_today').toContain('get_staff_today');
      expect(turn.said, '"you" for the principal').toMatch(/\byou\b/i);
      expect(noOwnName(turn.said), 'never the principal\'s own name').toBe(true);
      const you = turn.said.search(/\byou\b/i);
      const rajesh = turn.said.search(/rajesh/i);
      if (rajesh >= 0) expect(you, '"you" before the others').toBeLessThan(rajesh);
      expect(ended(turn.tools)).toBe(false);
    } finally {
      c.report('(ah) who has not marked: "you" first');
    }
  });

  it('(ai) "mark me present": mark_staff for the principal\'s own row, asked in the second person, one yes saves it (D-156)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      const asked = await c.say('Mark me present');
      const ask = asked.tools.find((t) => t.name === 'mark_staff');
      expect(ask, 'mark_staff asked first').toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
      expect(await staffRecord(c, 'st-anil'), 'nothing is saved before the yes').toBeUndefined();
      expect(asked.said, 'the model asks the question').toMatch(/\?/);
      expect(noOwnName(asked.said), 'never the principal\'s own name').toBe(true);
      const yes = await c.say('Yes');
      expect(yes.tools.some((t) => t.name === 'mark_staff' && t.ok && t.args.confirm_token !== undefined), 'the confirmed call went through').toBe(true);
      expect(await staffRecord(c, 'st-anil')).toMatchObject({ status: 'present', source: 'principal' });
      expect(c.toolsOf().filter((t) => t.name === 'mark_staff' && t.ok), 'saved exactly once').toHaveLength(1);
      expect(noOwnName(yes.said)).toBe(true);
    } finally {
      c.report('(ai) mark me present');
    }
  });

  it('(aj) "mark everyone else present": one question with the count, one yes, everyone saved (D-156)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      await c.say('Mark me present');
      await c.say('Yes');
      expect(await staffRecord(c, 'st-anil'), 'own row first').toMatchObject({ status: 'present' });
      const left = (await c.env.app.services.staffAttendance.day(c.ctx)).filter((r) => !r.record).length;
      expect(left).toBeGreaterThan(1);
      const asked = await c.say('Mark everyone else present');
      const ask = asked.tools.find((t) => t.name === 'mark_remaining_staff');
      expect(ask, 'mark_remaining_staff asked first').toMatchObject({ ok: false, error: 'NEEDS_CONFIRMATION' });
      expect(asked.said, 'one question').toMatch(/\?/);
      expect(saysNumber(asked.said, left), `the count ${left}`).toBe(true);
      expect((await c.env.app.services.staffAttendance.day(c.ctx)).filter((r) => !r.record), 'nothing saved before the yes').toHaveLength(left);
      const yes = await c.say('Yes');
      expect(yes.tools.some((t) => t.name === 'mark_remaining_staff' && t.ok), 'the confirmed call went through').toBe(true);
      expect((await c.env.app.services.staffAttendance.day(c.ctx)).every((r) => r.record), 'every staff member is marked').toBe(true);
      expect(c.toolsOf().filter((t) => t.name === 'mark_remaining_staff' && t.ok), 'saved exactly once').toHaveLength(1);
    } finally {
      c.report('(aj) everyone else present');
    }
  });

  it('(ak) after a save the agent offers the next person by name; one yes marks them (D-156)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      await c.say('Mark Pradeep Gawde absent');
      const saved = await c.say('Yes');
      expect(await staffRecord(c, 'st-pradeep')).toMatchObject({ status: 'absent', source: 'principal' });
      // the save is said, then the next person not marked yet (the principal's own row) is offered as "you", with a question
      expect(saved.said, 'the save is said first').toMatch(/pradeep|absent|marked/i);
      expect(saved.said, 'the offer is a question').toMatch(/\?/);
      expect(saved.said, 'the next one, as "you"').toMatch(/\b(you|yourself)\b/i);
      expect(noOwnName(saved.said)).toBe(true);
      const yes = await c.say('Yes');
      expect(yes.tools.some((t) => t.name === 'mark_staff' && t.ok), 'one yes marks the person offered').toBe(true);
      expect(await staffRecord(c, 'st-anil')).toMatchObject({ status: 'present', source: 'principal' });
      expect(yes.said, 'then the next one by name').toMatch(/rajesh/i);
    } finally {
      c.report('(ak) the next-person offer');
    }
  });

  it('(al) "how is staff attendance this month?": get_staff_report, one or two sentences with the month\'s % (D-156)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      const o = (await c.env.app.services.reports.staffOverview(c.ctx))!;
      const turn = await c.say('How is staff attendance this month?');
      expect(turn.tools.map((t) => t.name), 'get_staff_report').toContain('get_staff_report');
      expect(saysNumber(turn.said, o.pct!), `the month's ${o.pct}%`).toBe(true);
      const sentences = turn.said.split(/[.?!।]+/).map((x) => x.trim()).filter(Boolean);
      expect(sentences.length, 'one or two sentences (and the offer to show it)').toBeLessThanOrEqual(3);
      expect(noOwnName(turn.said)).toBe(true);
      expect(c.navigated, 'an answer opens nothing').toEqual([]);
    } finally {
      c.report('(al) the staff report');
    }
  });

  it('(am) the principal asks to open offline data: navigate to=offline (D-153)', async () => {
    const c = await conversation(...PRINCIPAL);
    try {
      await c.say(await c.kickoff(), false);
      const turn = await c.say('Open offline data');
      expect(turn.tools.some((t) => t.name === 'navigate' && t.ok && t.args.to === 'offline'), 'navigate to=offline').toBe(true);
      expect(c.navigated).toContain('/reports/offline');
      expect(ended(turn.tools)).toBe(false);
    } finally {
      c.report('(am) open offline data');
    }
  });

  it('(an) a refresh before the trainer answers "Shall I start?": the ask again, never the trade (Task 9 review M5)', async () => {
    const c = await conversation(RULE_ON);
    try {
      const first = await c.say(await c.kickoff(), false);
      expect(first.said, 'it asks for own attendance first').toMatch(/attendance/i);
      c.newConnection(); // a goAway swap before the trainer answered
      const refresh = await c.executor.refresh(null);
      expect(refresh).toMatch(/^\[APP\] The connection was refreshed; trust these facts over your memory\. The trainer's own attendance is not marked today/);
      const again = await c.say(refresh, false);
      expect(again.said, 'the ask again').toMatch(/attendance/i);
      expect(again.said, 'a question').toMatch(/\?/);
      expect(again.said, 'never the trades').not.toMatch(/electrician|fitter|which (one|trade)/i);
      expect(again.tools, 'no tool before the trainer answers').toEqual([]);
      const yes = await c.say('haan');
      expect(yes.tools.some((t) => t.name === 'mark_my_attendance' && t.ok), 'yes runs mark_my_attendance').toBe(true);
    } finally {
      c.report('(an) a refresh before "Shall I start?"');
    }
  });
});

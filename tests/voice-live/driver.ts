/**
 * The live-model driver (Task 20): one Gemini Live connection used the way VoiceSession uses it, minus audio. Trainer
 * turns are typed text (`sendRealtimeInput({ text })`), tool calls run through the REAL executor on one queue, in
 * `toolCallOrder`, answered with one sendToolResponse in the model's order, and a turn is over when the model has
 * finished (turnComplete) and no tool call is running or arrived in a short grace window after it.
 * The API key never leaves this file's SDK call: every message that could carry it goes through redact().
 */
import { GoogleGenAI, type LiveConnectConfig, type Session } from '@google/genai';
import { LIVE_API_VERSION } from '@/server/voice/token';
import { INTERNAL_RESULT, toolCallOrder, type VoiceExecutor } from '@/services/voice/executor';
import { liveConfig, type LiveSetup, type LiveToolCall } from '@/services/voice/live/transport';
import { normalizeMessage } from '@/services/voice/live/normalize';
import type { ToolResult } from '@/services/voice/tools';
import { TrainerTurns } from '@/services/voice/trainer-turns';

const CONNECT_TIMEOUT_MS = 20_000;
const TURN_TIMEOUT_MS = 70_000;
const POLL_MS = 50;

/** The driver's waits (ms). Live runs use the defaults; the unit test passes short ones. */
export interface DriverTiming {
  /** After a turnComplete: how long no new output or tool call must come before the turn is over. */
  readonly graceMs: number;
  /** How long an unfinished sentence in the output transcript may wait for the rest (it can lag the audio past the turn's end). */
  readonly transcriptWaitMs: number;
  /** After a text that got no reply within its window: how long the next say() waits for a late reply to start. */
  readonly lateStartMs: number;
  /**
   * A text that may get no reply (`replyWithinMs`) whose reply started but never sends turnComplete (T18/T19 live runs:
   * (t) hung 70 s after the Use-screen pause text): the reply is over once no output came for this long...
   */
  readonly quietMs: number;
  /** ...or, while output keeps coming, at most this long after the no-reply window. */
  readonly noTurnCapMs: number;
}
export const DEFAULT_TIMING: DriverTiming = { graceMs: 1500, transcriptWaitMs: 4000, lateStartMs: 3000, quietMs: 3000, noTurnCapMs: 15_000 };
/** The output transcript ends a sentence (or the turn said nothing): nothing more is coming. */
const FINISHED = /(^|[.?!।…"”'’)])\s*$/;

export interface ToolLogEntry { readonly name: string; readonly args: Record<string, unknown>; readonly ok: boolean; readonly error?: string; readonly instruction: string }
export interface TurnReport {
  readonly sent: string;
  readonly trainer: boolean;
  readonly tools: readonly ToolLogEntry[];
  /** What the model said (output transcript), for diagnosing wording. */
  readonly said: string;
  /**
   * A late reply to the previous turn (it returned at its no-reply window), drained before this text was sent: it is
   * also that turn's `said` now; here so a log written when that turn returned can still show it. Null when none came.
   */
  readonly drained: string | null;
  /** ms from the send to the first audio / first tool call / the end of the turn (null when none came). */
  readonly firstAudioMs: number | null;
  readonly firstToolMs: number | null;
  readonly totalMs: number;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export class LiveDriver {
  readonly turns: TurnReport[] = [];
  /**
   * The session's confirmation counters (D-082): model turns from the real server's turnComplete/interrupted, and a
   * trainer turn for each typed trainer text (no input transcription comes for text), so a code is accepted only
   * when the model's asking turn ended before the trainer's next turn, as in production.
   */
  readonly speech = new TrainerTurns();
  private session: Session | null = null;
  private closed: string | null = null;
  /** The first failure the queue could not turn into a tool result (sendToolResponse threw): settle() throws it at once. */
  private fault: string | null = null;
  private activity = 0;
  /** When `activity` last moved (performance.now()). */
  private activityAt = 0;
  /** `activity` when the last text was sent: unchanged means the model has not started a reply. */
  private idleMark = 0;
  /**
   * A reply was taken as over without its turnComplete (the quiet rule): if that turnComplete still arrives after the
   * next send, before any output of the next turn, it ends the old turn, not the new one.
   */
  private stray = false;
  private completes = 0;
  private running = 0;
  private queue: Promise<void> = Promise.resolve();
  private cur = { said: '', tools: [] as ToolLogEntry[], firstAudio: null as number | null, firstTool: null as number | null, sentAt: 0 };
  /** Where the last report ended: what was said by then, and the turns complete by then (for lateSpeech). */
  private reported = { said: 0, completes: 0 };
  /** The last say() returned at its no-reply window: a reply may still come, and belongs to that turn. */
  private unanswered = false;

  private constructor(private readonly apiKey: string, private readonly executor: VoiceExecutor, private readonly timing: DriverTiming) {}

  /** Redacts the key from anything printed or thrown. */
  private redact(value: unknown): string {
    return String(value instanceof Error ? value.message : value).split(this.apiKey).join('[redacted]').replace(/(access_token|key)=[^&\s"']+/gi, '$1=[redacted]');
  }

  static async open(apiKey: string, setup: LiveSetup, executor: VoiceExecutor, timing: Partial<DriverTiming> = {}): Promise<LiveDriver> {
    const driver = new LiveDriver(apiKey, executor, { ...DEFAULT_TIMING, ...timing });
    // The plan's API-key connection, on the API version production connects with (the token route's LIVE_API_VERSION).
    const ai = new GoogleGenAI({ apiKey, httpOptions: { apiVersion: LIVE_API_VERSION } });
    const connecting = ai.live.connect({
      model: setup.model,
      config: liveConfig(setup) as LiveConnectConfig,
      callbacks: {
        onmessage: (msg) => driver.onMessage(msg),
        onerror: () => undefined, // onclose follows with the code
        onclose: (e) => {
          driver.closed = `closed (${e?.code ?? 1006}) ${driver.redact(e?.reason ?? '')}`.trim();
        },
      },
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`No setupComplete within ${CONNECT_TIMEOUT_MS / 1000} s`)), CONNECT_TIMEOUT_MS);
    });
    try {
      driver.session = await Promise.race([connecting, timeout]);
    } catch (error) {
      // A session that resolves after the race was lost is closed when it arrives: no socket is left open.
      void connecting.then((late) => { try { late.close(); } catch { /* already closed */ } }, () => undefined);
      throw new Error(`Live connect failed: ${driver.redact(error)}${driver.closed ? ` [${driver.closed}]` : ''}`);
    } finally {
      clearTimeout(timer);
    }
    return driver;
  }

  close(): void {
    try {
      this.session?.close();
    } catch {
      // already closed
    }
    this.session = null;
  }

  /**
   * Sends a trainer turn (`trainer: true`, the default) or an [APP] text, and returns when the model is done with it.
   * `replyWithinMs`: a text that may get no reply turn at all (a refresh that only says to wait) returns after this long
   * without one, instead of failing; and a reply to it that never sends turnComplete is over once its output has been
   * quiet for a while (see DriverTiming.quietMs), so the scenario's own assertions decide.
   */
  async say(text: string, trainer = true, replyWithinMs?: number): Promise<TurnReport> {
    if (!this.session) throw new Error(`The Live connection is not open${this.closed ? `: ${this.closed}` : ''}`);
    const drained = await this.drainLate();
    if (!this.session) throw new Error(`The Live connection is not open${this.closed ? `: ${this.closed}` : ''}`);
    if (trainer) this.speech.spoke();
    this.cur = { said: '', tools: [], firstAudio: null, firstTool: null, sentAt: performance.now() };
    this.fault = null;
    const baseline = this.completes;
    this.idleMark = this.activity;
    this.session.sendRealtimeInput({ text });
    this.unanswered = !(await this.settle(baseline, replyWithinMs));
    await this.settleTranscript();
    const report: TurnReport = {
      sent: text,
      trainer,
      tools: this.cur.tools,
      said: this.cur.said.trim(),
      drained,
      firstAudioMs: this.cur.firstAudio,
      firstToolMs: this.cur.firstTool,
      totalMs: Math.round(performance.now() - this.cur.sentAt),
    };
    this.turns.push(report);
    this.reported = { said: this.cur.said.length, completes: this.completes };
    return report;
  }

  /**
   * What the model said after the last turn was reported, without a new send: a reply it gave in a turn of its own
   * (for example to a tool result, after the turn with the call had ended). Waits up to `ms` for such a turn to end.
   */
  async lateSpeech(ms = 10_000): Promise<string> {
    const deadline = performance.now() + ms;
    while (this.completes === this.reported.completes && performance.now() < deadline) await sleep(POLL_MS);
    if (this.completes !== this.reported.completes) await sleep(this.timing.graceMs);
    return this.cur.said.slice(this.reported.said).trim();
  }

  /**
   * The last say() returned at its no-reply window (T18 review): a reply that starts after it is waited for here and
   * kept with that turn (its report's `said`; its tool calls were already logged there), so it is never attributed to
   * the next turn. Waits `lateStartMs` for it to start. Returns what the late reply said (null when none came), so
   * the caller can log it.
   */
  private async drainLate(): Promise<string | null> {
    if (!this.unanswered) return null;
    this.unanswered = false;
    const startBy = performance.now() + this.timing.lateStartMs;
    while (this.activity === this.idleMark && this.completes === this.reported.completes && !this.closed && performance.now() < startBy) await sleep(POLL_MS);
    if (this.activity === this.idleMark && this.completes === this.reported.completes) return null; // nothing came
    await this.settle(this.reported.completes, 0); // a reply to a no-reply text: the quiet rule applies to it too
    await this.settleTranscript();
    const late = this.cur.said.slice(this.reported.said).trim();
    const last = this.turns.at(-1);
    if (last) this.turns[this.turns.length - 1] = { ...last, said: this.cur.said.trim() };
    this.reported = { said: this.cur.said.length, completes: this.completes };
    return late;
  }

  /**
   * Resolves true when the model replied, false when it gave no reply turn within `replyWithinMs` (allowed then).
   * With `replyWithinMs`, a reply that started but sends no turnComplete is over once no output or tool call came for
   * `quietMs` (or `noTurnCapMs` after the no-reply window while output keeps coming).
   */
  private async settle(baseline: number, replyWithinMs?: number): Promise<boolean> {
    const deadline = performance.now() + TURN_TIMEOUT_MS;
    const noReplyBy = replyWithinMs === undefined ? Infinity : performance.now() + replyWithinMs;
    let seen = baseline;
    for (;;) {
      while (this.completes === seen) {
        this.throwFault();
        if (this.closed) throw new Error(`The model closed the connection: ${this.closed}`);
        const now = performance.now();
        if (seen === baseline && this.activity === this.idleMark && now > noReplyBy) return false; // no reply turn: allowed here
        if (this.quietEnd(replyWithinMs, now, noReplyBy)) {
          this.stray = true;
          return true;
        }
        if (now > deadline) throw new Error(`The model did not finish its turn within ${TURN_TIMEOUT_MS / 1000} s`);
        await sleep(POLL_MS);
      }
      seen = this.completes;
      const before = this.activity;
      await sleep(this.timing.graceMs);
      while (this.running > 0 && performance.now() < deadline) await sleep(POLL_MS); // a tool call is still running
      this.throwFault();
      if (this.activity === before && this.running === 0) return true;
    }
  }

  /** The quiet rule: a reply to a no-reply text started, no tool call is running, and its output stopped (or ran too long). */
  private quietEnd(replyWithinMs: number | undefined, now: number, noReplyBy: number): boolean {
    if (replyWithinMs === undefined || this.activity === this.idleMark || this.running > 0) return false;
    return now - this.activityAt > this.timing.quietMs || now > noReplyBy + this.timing.noTurnCapMs;
  }

  /**
   * The turn is over, but its output transcript may still be arriving (T16: a run cut it at "Good morning, Meera. Shift"
   * with the audio already played): while the text stops mid-sentence, wait a little longer for the rest.
   */
  private async settleTranscript(): Promise<void> {
    const deadline = performance.now() + this.timing.transcriptWaitMs;
    while (!FINISHED.test(this.cur.said.trim()) && performance.now() < deadline) await sleep(POLL_MS);
  }

  private throwFault(): void {
    if (this.fault) throw new Error(`A tool call could not be answered: ${this.fault}`);
  }

  private onMessage(msg: unknown): void {
    const e = normalizeMessage(msg);
    this.speech.observe(e);
    const since = Math.round(performance.now() - this.cur.sentAt);
    if (e.audio.length && this.cur.firstAudio === null) this.cur.firstAudio = since;
    if (e.outputText) this.cur.said += e.outputText;
    if (e.audio.length || e.outputText || e.toolCalls?.length) this.moved();
    if (e.toolCalls?.length) {
      if (this.cur.firstTool === null) this.cur.firstTool = since;
      this.running += 1; // counted at once: the grace window must not end before the queue starts
      this.queue = this.queue.then(() => this.answer(e.toolCalls ?? [])).catch((error: unknown) => void (this.fault ??= this.redact(error))).finally(() => void (this.running -= 1));
    }
    if (e.turnComplete) {
      // the end of a reply already taken as over (quiet rule), arriving before any output of the next turn: not this turn's
      const old = this.stray && this.activity === this.idleMark;
      this.stray = false;
      if (!old) this.completes += 1;
    }
  }

  /** New output or a tool call: a stray turnComplete can no longer be told from this turn's own end. */
  private moved(): void {
    this.activity += 1;
    this.activityAt = performance.now();
    this.stray = false;
  }

  /** The calls of one toolCall message: run in toolCallOrder, answered together in the model's order. */
  private async answer(calls: readonly LiveToolCall[]): Promise<void> {
    const results = new Map<LiveToolCall, ToolResult>();
    for (const call of toolCallOrder(calls)) {
      // A throwing executor answers INTERNAL, as production does (session-tools.ts), and the turn report records it.
      let result: ToolResult;
      try {
        result = await this.executor.execute({ id: call.id, name: call.name, args: call.args });
      } catch (error) {
        result = { ...INTERNAL_RESULT };
        console.info(`[live] ${call.name} threw, answered INTERNAL: ${this.redact(error)}`);
      }
      results.set(call, result);
      this.cur.tools.push({ name: call.name, args: call.args, ok: result.ok, ...(result.error ? { error: result.error } : {}), instruction: result.instruction });
    }
    this.moved();
    // `id` is always an own key (the SDK throws without it in Gemini API mode).
    this.session?.sendToolResponse({ functionResponses: calls.map((c) => ({ id: c.id, name: c.name, response: { output: results.get(c) } })) });
  }
}

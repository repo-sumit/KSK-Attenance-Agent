/**
 * Tool calls of a voice session (MVP-02 §7 answerToolCalls and onToolCancel; voice design D-081, §10).
 * The SDK does not await `onmessage`, so the calls of consecutive toolCall messages, and the executor's
 * screen and verification hooks, run on one promise queue: one call at a time, in `toolCallOrder`, answered
 * in the model's order with one response, to the connection that asked. A call cancelled before it starts
 * is skipped; one cancelled while running keeps its effect (it is in the draft and on screen) but is not
 * answered. Guards: 5 failures in a row, or more than 40 calls in 60 s, stop the session.
 */
import { INTERNAL_RESULT, toolCallOrder, type VoiceExecutor } from './executor';
import type { LiveToolCall, LiveToolResponse } from './live/transport';
import type { ToolResult } from './tools';

/** Results that make the model ask the trainer something: a goAway refresh asks it again (so does any result carrying a confirm_token). */
const QUESTION_CODES: ReadonlySet<string> = new Set(['NEEDS_CONFIRMATION', 'AMBIGUOUS', 'NOT_FOUND']);
const FAILURE_CODES: ReadonlySet<string> = new Set(['INTERNAL', 'UNKNOWN_TOOL']);
const MAX_FAILURES_IN_ROW = 5;
const MAX_CALLS = 40;
const CALL_WINDOW_MS = 60_000;

export interface ToolHost {
  readonly executor: VoiceExecutor;
  now(): number;
  /** The attempt the session is in now (it changes on every start, reconnect, stop and loss). */
  stamp(): number;
  /** Whether work queued in attempt `stamp` may still run: the session is live and in that same attempt. */
  accepts(stamp: number): boolean;
  /** Sends the answers if `gen` is still the current connection. */
  answer(gen: number, responses: readonly LiveToolResponse[]): void;
  /** Too many failures or calls. */
  failed(): void;
  /** end_voice_session was answered. */
  ending(): void;
  /** Answering a toolCall message started (true) or ended (false): the working status (D-156). */
  busy(on: boolean): void;
  /** Ids and codes only, never names or what was heard. */
  log(line: string): void;
}

export class ToolRunner {
  private queue: Promise<void> = Promise.resolve();
  private waiting = 0;
  /** `${generation}:${id}` of every cancelled call. */
  private readonly cancelled = new Set<string>();
  private failuresInRow = 0;
  private stamps: number[] = [];
  private question: string | null = null;
  /** Bumped by reset(): a task of an earlier conversation that settles late no longer counts as waiting. */
  private epoch = 0;

  constructor(private readonly host: ToolHost) {}

  /** Nothing queued or running. */
  get idle(): boolean {
    return this.waiting === 0;
  }

  /** The instruction of the last question result (one carrying a confirm_token included), cleared by any later ok result without one. */
  get pendingQuestion(): string | null {
    return this.question;
  }

  /**
   * A new conversation: nothing carries over (rate stamps, failures in a row, the question, cancellations), and
   * a fresh queue, so a call of an earlier attempt that never settles cannot hold this one's calls. Not for a reconnect.
   */
  reset(): void {
    this.cancelled.clear();
    this.failuresInRow = 0;
    this.stamps = [];
    this.question = null;
    this.epoch += 1;
    this.queue = Promise.resolve();
    this.waiting = 0;
  }

  /**
   * Runs `task` after everything queued before it, unless `accepts` refuses it then (by default: the attempt it was
   * queued in is over); a rejection never escapes the queue.
   */
  enqueue(task: (stamp: number) => Promise<void>, accepts: (stamp: number) => boolean = (s) => this.host.accepts(s)): void {
    const stamp = this.host.stamp();
    const epoch = this.epoch;
    this.waiting += 1;
    this.queue = this.queue
      .then(() => (accepts(stamp) ? task(stamp) : undefined))
      .catch(() => undefined)
      .then(() => {
        if (epoch === this.epoch) this.waiting -= 1;
      });
  }

  /**
   * Runs `task` after everything queued before it, whatever the attempt (the caller checks its own), and settles with
   * its result: the kickoff of a new connection reads the flow the hooks queued before it have moved.
   */
  after<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => this.enqueue(() => task().then(resolve, reject), () => true));
  }

  run(calls: readonly LiveToolCall[], gen: number): void {
    this.enqueue(async (stamp) => {
      this.host.busy(true);
      try {
        await this.answerAll(calls, gen, stamp);
      } finally {
        this.host.busy(false);
      }
    });
  }

  cancel(ids: readonly string[], gen: number): void {
    for (const id of ids) this.cancelled.add(`${gen}:${id}`);
    this.host.log(`cancelled ${ids.length} call(s)`);
  }

  private isCancelled(call: LiveToolCall, gen: number): boolean {
    return call.id !== undefined && this.cancelled.has(`${gen}:${call.id}`);
  }

  private overRate(): boolean {
    const now = this.host.now();
    this.stamps = this.stamps.filter((t) => now - t < CALL_WINDOW_MS);
    this.stamps.push(now);
    return this.stamps.length > MAX_CALLS;
  }

  private async execute(call: LiveToolCall): Promise<ToolResult> {
    try {
      return await this.host.executor.execute(call);
    } catch {
      return { ...INTERNAL_RESULT };
    }
  }

  private async answerAll(calls: readonly LiveToolCall[], gen: number, stamp: number): Promise<void> {
    const answers = new Map<LiveToolCall, LiveToolResponse>();
    for (const call of toolCallOrder(calls)) {
      if (!this.host.accepts(stamp)) return;
      if (this.isCancelled(call, gen)) continue;
      if (this.overRate()) return this.host.failed();
      const result = await this.execute(call);
      if (!this.host.accepts(stamp)) return; // stopped meanwhile: the effect stays, nothing else is counted or answered
      this.failuresInRow = FAILURE_CODES.has(String(result.error)) ? this.failuresInRow + 1 : 0;
      this.host.log(`tool ${call.name} ${result.ok ? 'ok' : String(result.error)}`);
      if (this.failuresInRow >= MAX_FAILURES_IN_ROW) return this.host.failed();
      if (this.isCancelled(call, gen)) continue; // its effect stays; the model no longer waits for it
      answers.set(call, { id: call.id, name: call.name, result });
      if (typeof result.confirm_token === 'string') this.question = result.instruction; // the submit question asked up front
      else if (result.ok) this.question = null;
      else if (QUESTION_CODES.has(String(result.error))) this.question = result.instruction;
    }
    const responses = calls.flatMap((c) => answers.get(c) ?? []); // in the order the model sent them
    if (responses.length) this.host.answer(gen, responses);
    if (calls.some((c) => c.name === 'end_voice_session') && this.host.executor.endRequested) this.host.ending();
  }
}

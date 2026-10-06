/**
 * When the agent is quiet, and the texts that wait for it (D-148). A check's [APP] text sent while the agent speaks
 * interrupts it: the server answers `interrupted` and the session flushes the player mid-sentence. So the camera,
 * pass and failure texts of a check go through a polite outbox, and the screen waits for the agent (`whenQuiet`).
 *
 * Quiet: the session is streaming, nothing has played for 300 ms, no model turn is in progress (audio or a tool call
 * until turnComplete; a spoken turn with no tool call that sends no turnComplete, as the live model does after "say
 * nothing", stops counting 1 s after its last output), and no reply is owed (a tool response or the kickoff was sent,
 * and neither its audio, a turnComplete nor an interruption came yet; a reply owed stops counting after the same 1 s).
 * Held texts are first in, first out, stamped with the connection attempt, and released from the session's 200 ms poll
 * (turnComplete runs it too); each keeps its own cap (see release). Pause, stop, loss and a new connection drop them.
 * Nothing here runs on the tool queue: a held text never delays a tool call.
 */
import type { Timers } from './session-types';

/** The player has been idle this long: a gap between two audio chunks (network jitter) is not the end of a line. */
const IDLE_MS = 300;
/** A spoken turn (no tool call) with no output for this long is over, though its turnComplete never came. */
const STALE_TURN_MS = 1000;
/**
 * A reply owed (after a tool response, the kickoff, the resume text or a swap's refresh text) that has produced no
 * audio, turnComplete or interruption for this long is given up. Longer than STALE_TURN_MS: the model's first audio can take a couple of seconds,
 * and a check text released into that silence would cut the agent's first sentence (the bug D-148 fixed).
 */
export const REPLY_STALE_MS = 3000;

export interface QuietHost {
  /** Listening or speaking (not paused, connecting, reconnecting, stopped). */
  streaming(): boolean;
  playing(): boolean;
  /** A model turn is in progress: its audio or a tool call came, its turnComplete not yet. */
  busy(): boolean;
  /** The connection attempt now: a text held in another one is dropped. */
  stamp(): number;
  send(text: string): void;
  /** Debug lines (ids only, never the text). */
  log(line: string): void;
  readonly timers: Timers;
}

/** At the cap: `drop` the text (it no longer helps), or `send` it anyway (the screen already shows what it says). */
export type AtCap = 'drop' | 'send';

interface Held {
  readonly text: string;
  readonly stamp: number;
  readonly until: number;
  readonly atCap: AtCap;
}

interface Waiter {
  readonly until: number;
  readonly done: () => void;
}

export class QuietOutbox {
  private held: Held[] = [];
  private readonly waiters = new Set<Waiter>();
  private lastPlaying = Number.NEGATIVE_INFINITY;
  /** When a reply became owed; null when none is. It goes stale after REPLY_STALE_MS with no audio, turnComplete or interruption. */
  private replyOwedAt: number | null = null;
  /** The current model turn: when its last audio or transcript came, and whether it called a tool. */
  private lastOutput = Number.NEGATIVE_INFINITY;
  private toolTurn = false;

  constructor(private readonly host: QuietHost) {}

  /** A tool response, the kickoff, the resume text or a swap's refresh text went out: the model owes a reply. */
  expectReply(): void {
    this.replyOwedAt = this.host.timers.now();
  }

  /** Every server event: its audio, turnComplete or an interruption settles the reply owed. */
  observe(e: { readonly audio: readonly unknown[]; readonly outputText?: string; readonly toolCalls?: readonly unknown[]; readonly turnComplete?: boolean; readonly interrupted?: boolean }): void {
    if (e.audio.length || e.turnComplete || e.interrupted) this.replyOwedAt = null;
    if (e.audio.length || e.outputText) this.lastOutput = this.host.timers.now();
    if (e.toolCalls?.length) this.toolTurn = true;
    if (e.turnComplete || e.interrupted) this.toolTurn = false;
  }

  isQuiet(): boolean {
    const now = this.host.timers.now();
    if (this.host.playing()) {
      this.lastPlaying = now;
      return false;
    }
    const busy = this.host.busy() && (this.toolTurn || now - this.lastOutput < STALE_TURN_MS);
    const owed = this.replyOwedAt !== null && now - this.replyOwedAt < REPLY_STALE_MS;
    return this.host.streaming() && !owed && !busy && now - this.lastPlaying >= IDLE_MS;
  }

  /** Sends now when quiet and nothing is held before it; holds it otherwise (dropped at once while not streaming). */
  sendWhenQuiet(text: string | null, capMs: number, atCap: AtCap): void {
    if (!text || !this.host.streaming()) return;
    if (!this.held.length && this.isQuiet()) return this.host.send(text);
    this.host.log('check text held');
    this.held.push({ text, stamp: this.host.stamp(), until: this.host.timers.now() + capMs, atCap });
  }

  /**
   * From the poll and turnComplete: held texts whose moment came, and screens waiting for the agent. Quiet: every held
   * text goes, in order. Otherwise each text keeps its own cap: a 'send' text whose cap ran out goes now, even behind a
   * text whose cap has not, and takes every text held before it along (earlier 'send' texts go first, earlier 'drop'
   * texts are dropped), so the texts that are sent keep their order; a 'drop' text whose cap ran out is dropped.
   */
  release(): void {
    const now = this.host.timers.now();
    const quiet = this.isQuiet(); // every poll samples the player, so the 300 ms idle counts from audio heard last
    if (!this.host.streaming() || this.held.some((h) => h.stamp !== this.host.stamp())) this.held = [];
    const due = quiet ? this.held.length - 1 : this.held.findLastIndex((h) => h.atCap === 'send' && now >= h.until);
    for (const next of this.held.splice(0, due + 1)) this.leave(next, quiet);
    const waiting: Held[] = [];
    for (const next of this.held) {
      if (now < next.until) waiting.push(next);
      else this.leave(next, false); // a 'drop' text whose cap ran out
    }
    this.held = waiting;
    for (const w of [...this.waiters]) if (quiet || now >= w.until || !this.host.streaming()) w.done();
  }

  private leave(next: Held, quiet: boolean): void {
    if (quiet || next.atCap === 'send') this.host.send(next.text);
    this.host.log(quiet ? 'check text sent (quiet)' : `check text ${next.atCap === 'send' ? 'sent' : 'dropped'} (cap)`);
  }

  /**
   * Resolves when the session is not streaming, when the agent is quiet, or after `capMs`; at once when aborted.
   * Checked on every release (the 200 ms poll) and at the cap.
   */
  whenQuiet(capMs: number, signal?: AbortSignal): Promise<void> {
    if (capMs <= 0 || signal?.aborted || !this.host.streaming() || this.isQuiet()) return Promise.resolve();
    const { timers } = this.host;
    return new Promise<void>((resolve) => {
      const waiter: Waiter = {
        until: timers.now() + capMs,
        done: () => {
          if (!this.waiters.delete(waiter)) return;
          timers.clearTimeout(timer);
          signal?.removeEventListener('abort', waiter.done);
          resolve();
        },
      };
      const timer = timers.setTimeout(waiter.done, capMs);
      signal?.addEventListener('abort', waiter.done);
      this.waiters.add(waiter);
    });
  }

  /** Pause, stop, loss or a new connection: held texts are dropped; screens stop waiting when the session is not streaming. */
  drop(): void {
    this.held = [];
    this.replyOwedAt = null;
    this.toolTurn = false;
    this.release();
  }
}

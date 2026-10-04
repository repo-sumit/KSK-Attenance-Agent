/**
 * The Live connection of one voice session (voice design §5.3 goAway and Drop): connect, reconnect with the
 * resumption handle, safe sends, and the seamless goAway swap. Ported from the MVP's connect fallback,
 * forwardMic, onGoAway, swapSession and onClose (MVP-02 §5, §8–§9, L1742–L1898) with these adaptations: the
 * token is raced against 8 s (the token client has no timeout), every send is wrapped (the SDK throws on a
 * socket that is not open), events before connect resolves are ignored, and a swap always ends with the
 * executor's refresh text (spoken facts; telling the model to stay silent made it skip its next reply).
 * The AudioContexts and the mic are untouched by a swap: only the socket changes.
 */
import { err, ok, type Result } from '@/lib/result';
import type { TokenError, TokenFailure } from './live/token-client';
import type { LiveCallbacks, LiveConnection, LiveEvent, LiveSetup, LiveToken, LiveToolResponse, LiveTransport } from './live/transport';
import type { Timers } from './session-types';

const TOKEN_TIMEOUT_MS = 8000;
const SWAP_MARGIN_MS = 2500;
const RETRY_MS = 3000;
const MAX_HELD_CHUNKS = 75; // the newest 3 s of 40 ms chunks: older speech is stale by then
const PRE_ROLL_CHUNKS = 16; // the last 0.64 s sent to the old connection, replayed after a quiet swap

export type OpenError = 'unavailable' | 'rate_limited' | 'connect_failed' | 'stale';

export interface LinkHost {
  readonly setup: (resumeHandle?: string) => Promise<LiveSetup>;
  readonly transport: () => Promise<LiveTransport>;
  readonly token: () => Promise<Result<LiveToken, TokenError>>;
  readonly timers: Timers;
  log(line: string): void;
  /** An event of the current connection: never one from before connect resolved, nor from an old socket. */
  event(e: LiveEvent, gen: number): void;
  /** A new connection is current (the generation was bumped). */
  adopted(gen: number): void;
  /** The connection is gone and no swap can take over. */
  lost(): void;
  /** No turn in progress: nothing playing, no unanswered trainer utterance, no tool running. */
  quiet(): boolean;
  /** The first text of the connection a swap moved to (null: say nothing, e.g. while the trainer uses the screen). */
  refresh(): Promise<string | null>;
}

interface Ticket { readonly transport: LiveTransport; readonly token: LiveToken | null }
/** One connect attempt; `gen` is 0 until the connection is adopted. */
interface Slot { conn: LiveConnection | null; gen: number; readonly resumed: boolean }
interface Hold { readonly audio: Int16Array[]; readonly preRoll: Int16Array[]; readonly texts: string[]; end: boolean }

function safe(fn: () => void): boolean {
  try {
    fn();
    return true;
  } catch {
    return false; // the socket is closing or gone
  }
}

export class LiveLink {
  private conn: LiveConnection | null = null;
  private gen = 0;
  /** Bumped by close(): an async step that started before it gives up. */
  private epoch = 0;
  private handle: string | undefined;
  private recent: Int16Array[] = [];
  private hold: Hold | null = null;
  /** goAway arrived and the swap has not happened yet. */
  private ending = false;
  private goAwayAt = 0;
  private retryAt = 0;
  private deadline: ReturnType<typeof setTimeout> | undefined;
  /** Token fetches under way: close() ends each at once (clearing its 8 s timer). */
  private readonly tokenWaits = new Set<() => void>();

  constructor(private readonly host: LinkHost) {}

  generation(): number { return this.gen; }
  /** A goAway swap is under way: texts sent now are held, and only its refresh reaches the new connection. */
  swapping(): boolean { return this.hold !== null; }
  keepHandle(handle: string): void { this.handle = handle; }
  /** The handle is used once: a handle the server accepts and then kills must not loop. */
  takeHandle(): string | undefined {
    const handle = this.handle;
    this.handle = undefined;
    return handle;
  }

  /** Connects (with `handle`, else, if that fails, once more without it) and adopts the connection. */
  async open(handle?: string): Promise<'ok' | OpenError> {
    const epoch = this.epoch;
    const ticket = await this.prepare();
    if (epoch !== this.epoch) return 'stale';
    if (!ticket.ok) return ticket.error;
    const slot = await this.resume(ticket.value, handle, epoch);
    if (epoch !== this.epoch) return 'stale';
    if (!slot) return 'connect_failed';
    this.adopt(slot);
    return 'ok';
  }

  /** Ends the connection and any swap. Keeps the handle (Reconnect resumes with it). */
  close(): void {
    this.epoch += 1;
    this.disarm();
    for (const cancel of [...this.tokenWaits]) cancel(); // the awaiting step sees the new epoch and gives up
    this.hold = null;
    this.ending = false;
    this.retryAt = 0;
    this.recent = [];
    const conn = this.conn;
    this.conn = null;
    if (conn) safe(() => conn.close());
  }

  sendText(text: string): boolean {
    if (this.hold) {
      this.hold.texts.push(text);
      return true;
    }
    const conn = this.conn;
    return !!conn && safe(() => conn.sendText(text));
  }

  sendAudio(pcm: Int16Array): void {
    if (this.hold) {
      this.hold.audio.push(pcm);
      if (this.hold.audio.length > MAX_HELD_CHUNKS) this.hold.audio.shift();
      return;
    }
    const conn = this.conn;
    if (!conn || !safe(() => conn.sendAudio(pcm))) return;
    this.recent.push(pcm);
    if (this.recent.length > PRE_ROLL_CHUNKS) this.recent.shift();
  }

  /** Forgets the audio recorded so far (the pre-roll and what a swap holds): after a pause it is stale. */
  dropAudio(): void {
    this.recent = [];
    if (!this.hold) return;
    this.hold.audio.length = 0;
    this.hold.preRoll.length = 0;
  }

  streamEnd(): void {
    if (this.hold) this.hold.end = true;
    const conn = this.conn;
    if (conn && !this.hold) safe(() => conn.sendAudioStreamEnd());
  }

  /** Answers go to the connection that asked, never to a newer one. */
  sendToolResponses(gen: number, responses: readonly LiveToolResponse[]): boolean {
    const conn = this.conn;
    return gen === this.gen && !!conn && safe(() => conn.sendToolResponses(responses));
  }

  goAway(ms: number): void {
    if (!this.conn || this.ending || this.hold) return;
    this.ending = true;
    this.goAwayAt = this.host.timers.now() + ms;
    this.host.log(`goAway in ${Math.round(ms / 1000)} s`);
    this.arm(Math.max(0, ms - SWAP_MARGIN_MS));
    this.maybeSwap();
  }

  /** Swaps at the first quiet moment after goAway (called after every event and every second). */
  maybeSwap(): void {
    if (this.ending && !this.hold && this.conn && this.host.timers.now() >= this.retryAt && this.host.quiet()) this.swapSoon(false);
  }

  private swapSoon(atDeadline: boolean, oldGone = false): void {
    void this.swap(atDeadline, oldGone).catch(() => undefined);
  }

  private arm(ms: number): void {
    this.disarm();
    this.deadline = this.host.timers.setTimeout(() => this.swapSoon(true), ms);
  }

  private disarm(): void {
    if (this.deadline !== undefined) this.host.timers.clearTimeout(this.deadline);
    this.deadline = undefined;
  }

  private adopt(slot: Slot): void {
    this.gen += 1;
    slot.gen = this.gen;
    this.conn = slot.conn;
    this.recent = [];
    this.ending = false;
    this.host.log(`connected (generation ${this.gen})`);
    this.host.adopted(this.gen);
  }

  /** The current socket closed by itself. */
  private closed(code: number): void {
    this.conn = null;
    this.host.log(`connection closed (code ${code})`);
    if (this.hold) return; // a swap is under way: it takes over, or reports the loss
    if (this.ending) return this.swapSoon(true, true); // the server ended it after goAway: resume instead
    this.host.lost();
  }

  private fetchToken(): Promise<Result<LiveToken, TokenError>> {
    const { timers } = this.host;
    return new Promise((resolve) => {
      const done = (result: Result<LiveToken, TokenError>) => {
        timers.clearTimeout(timer);
        this.tokenWaits.delete(cancel);
        resolve(result);
      };
      const cancel = () => done(err('unavailable', { why: 'cancelled' }));
      const timer = timers.setTimeout(() => done(err('unavailable', { why: 'timeout' })), TOKEN_TIMEOUT_MS);
      this.tokenWaits.add(cancel);
      Promise.resolve()
        .then(() => this.host.token())
        .then(done, () => done(err('network', { why: 'network' })));
    });
  }

  /**
   * The transport and, when it needs one, a fresh single-use token. A failure is logged by step (the transport
   * import, or the token with its code: network, origin, the HTTP status class, a malformed body, the 8 s timeout),
   * so "Voice isn't available right now" can be told apart in the debug log; never the token or the body.
   */
  private async prepare(): Promise<Result<Ticket, 'unavailable' | 'rate_limited'>> {
    let transport: LiveTransport;
    try {
      transport = await this.host.transport();
    } catch {
      this.host.log('transport import failed');
      return err('unavailable');
    }
    if (!transport.needsToken) return ok({ transport, token: null });
    const token = await this.fetchToken();
    if (token.ok) return ok({ transport, token: token.value });
    const why = (token.detail?.why as TokenFailure | undefined) ?? token.error;
    if (why !== 'cancelled') this.host.log(`token failed (${why})`); // a Stop or a loss took over: nothing failed
    return err(token.error === 'rate_limited' ? 'rate_limited' : 'unavailable');
  }

  private async dial(ticket: Ticket, handle: string | undefined, epoch: number): Promise<Slot | null> {
    const slot: Slot = { conn: null, gen: 0, resumed: !!handle };
    const mine = () => slot.gen !== 0 && slot.conn === this.conn;
    const cb: LiveCallbacks = {
      onEvent: (e) => {
        if (mine()) this.host.event(e, slot.gen);
      },
      onClose: (code) => {
        if (mine()) this.closed(code);
      },
    };
    try {
      const setup = await this.host.setup(handle);
      if (epoch !== this.epoch) return null;
      slot.conn = await ticket.transport.connect(ticket.token, setup, cb);
    } catch {
      this.host.log(`connect failed (resume ${handle ? 'yes' : 'no'})`);
      return null;
    }
    const conn = slot.conn;
    if (epoch === this.epoch) return slot;
    safe(() => conn.close()); // Stop or a loss took over meanwhile
    return null;
  }

  /** With the handle first; if that fails, without it on a fresh token (a token is single-use). */
  private async resume(ticket: Ticket, handle: string | undefined, epoch: number): Promise<Slot | null> {
    const first = await this.dial(ticket, handle, epoch);
    if (first || !handle || epoch !== this.epoch) return first;
    const again = await this.prepare();
    if (!again.ok || epoch !== this.epoch) return null;
    return this.dial(again.value, undefined, epoch);
  }

  /**
   * The token first, while the old connection still works; then close it (the server refuses to resume a
   * session that is still connected: 1011), resume with the latest handle, send the refresh, and replay
   * what the trainer said meanwhile (with the pre-roll only after a quiet moment: at the deadline it could
   * hold the tail of words the old connection was already answering).
   */
  private async swap(atDeadline: boolean, oldGone: boolean): Promise<void> {
    if ((!this.conn && !oldGone) || this.hold) return;
    this.disarm();
    const epoch = this.epoch;
    const hold: Hold = { audio: [], preRoll: atDeadline ? [] : [...this.recent], texts: [], end: false };
    this.hold = hold;
    this.host.log(`switching connections (${atDeadline ? 'deadline' : 'quiet moment'})`);
    const ticket = await this.prepare();
    if (epoch !== this.epoch) return;
    if (!ticket.ok) {
      this.hold = null;
      if (!this.conn) return this.host.lost();
      // Keep the old connection while it lasts; try again from 3 s on, or by the deadline.
      for (const pcm of hold.audio) this.sendAudio(pcm);
      for (const text of hold.texts) this.sendText(text);
      if (hold.end) this.streamEnd();
      const now = this.host.timers.now();
      this.retryAt = now + RETRY_MS;
      this.arm(Math.max(RETRY_MS, this.goAwayAt - SWAP_MARGIN_MS - now));
      return;
    }
    const handle = this.takeHandle(); // read after the token: a newer handle may have arrived meanwhile
    const old = this.conn;
    this.conn = null; // its close is ignored from now on
    if (old) safe(() => old.close());
    const slot = await this.resume(ticket.value, handle, epoch);
    if (epoch !== this.epoch) return;
    if (!slot) {
      this.hold = null;
      return this.host.lost();
    }
    this.adopt(slot);
    const text = await this.host.refresh().catch(() => null);
    if (epoch !== this.epoch) return;
    this.hold = null;
    if (!this.conn) return this.host.lost(); // the new connection closed during the refresh
    // The refresh carries the facts, taps included: held [APP] texts are not replayed.
    if (text) this.sendText(text);
    for (const pcm of [...hold.preRoll, ...hold.audio]) this.sendAudio(pcm);
    if (hold.end) this.streamEnd();
    this.host.log(`switched connections: resume ${slot.resumed ? 'yes' : 'no'}, ${hold.audio.length} chunks carried over`);
  }
}

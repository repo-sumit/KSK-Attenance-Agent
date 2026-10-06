/**
 * VoiceSession (voice design §5.3, D-081, D-085, D-086, D-089): one voice session: audio, the Live connection
 * (./session-swap), routing every server event, the tool queue (./session-tools), captions, status, caps, and the
 * taps and verification events that reach the model as [APP] texts (./session-taps). Ported from the MVP's
 * liveClient open, onMessage, shutdown and teardownAudio (MVP-02 §5–§9, MVP-03). No React: the UI reads getState().
 */
import type { VerificationEvent } from '../verification';
import { limitEvent, PAUSE_EVENT } from './app-events';
import type { AudioIO } from './audio/types';
import { captionsAfter } from './captions';
import type { ScreenSignal } from './executor';
import type { LiveEvent } from './live/transport';
import { SessionCues } from './session-cues';
import { QuietOutbox, type AtCap } from './session-outbox';
import { LiveLink } from './session-swap';
import { MicGate } from './session-mic';
import { attachTaps } from './session-taps';
import { ToolRunner } from './session-tools';
import { TrainerTurns } from './trainer-turns';
import { MIC_ERRORS, StateCell, systemTimers, type Timers, type VoiceErrorCode, type VoiceSessionDeps, type VoiceState } from './session-types';

export type { Caption } from './captions';
export type { Timers, VoiceErrorCode, VoiceSessionDeps, VoiceState, VoiceStatus } from './session-types';

const STOP_AFTER_MS = 4000; // the goodbye line of a limit or end_voice_session
const TICK_MS = 1000; // caps, minutes left
const POLL_MS = 200; // speaking state and mic level
const MAX_FAILED_CONNECTS = 3; // in a row, across Reconnect taps (spec §11): then voice stops with 'failures'
/** A check's texts wait for the agent (D-148): the camera-on text is dropped after 4 s, the others are sent after 3 s. */
const CAMERA_TEXT: readonly [number, AtCap] = [4000, 'drop'];
const CHECK_TEXT: readonly [number, AtCap] = [3000, 'send'];
type Goodbye = { readonly reason: VoiceErrorCode | 'user'; readonly atTurnEnd: boolean };

export class VoiceSession {
  private readonly timers: Timers;
  private readonly link: LiveLink;
  private readonly tools: ToolRunner;
  private readonly cell: StateCell<VoiceState>;
  private audio: AudioIO | null = null;
  /** Bumped by every start, reconnect, stop and loss: a stale async step gives up. */
  private attempt = 0;
  /** Model turns and trainer turns, for the confirmation rule (D-082). */
  private readonly turns = new TrainerTurns();
  /** Connects that failed since a connection was last adopted (or the last start). */
  private failedConnects = 0;
  private readonly mic: MicGate;
  private readonly outbox: QuietOutbox;
  /** Earcons and the working status (D-156). */
  private readonly cues: SessionCues;
  /** PAUSE_EVENT was sent while a goAway swap held texts: it reached no connection, so the swap's new one is told. */
  private pauseHeld = false;
  private userSpeaking = false;
  private modelBusy = false;
  /** A goodbye is under way: stop with its reason after 4 s (or at the next turnComplete when `atTurnEnd`). */
  private ending: Goodbye | null = null;
  private unsubs: (() => void)[] = [];
  private intervals: ReturnType<typeof setInterval>[] = [];
  private readonly timeouts = new Set<ReturnType<typeof setTimeout>>();
  /** When the last start click happened, until its first model audio is logged (D-138); null otherwise. */
  private startedAt: number | null = null;

  constructor(private readonly deps: VoiceSessionDeps) {
    this.timers = deps.timers ?? systemTimers();
    const minutesLeft = Math.ceil(deps.usage.secondsLeft / 60);
    this.cell = new StateCell<VoiceState>({ status: 'idle', error: null, captions: [], level: 0, pushToTalk: false, talking: false, canReconnect: false, minutesLeft, focus: null, micHeld: null });
    this.link = new LiveLink({
      setup: deps.setup, transport: deps.transport, token: deps.token, timers: this.timers, log: deps.log,
      event: (e, gen) => this.route(e, gen),
      adopted: () => {
        this.userSpeaking = this.modelBusy = false;
        this.outbox.drop(); // a text held for the last connection is not this one's
        this.failedConnects = 0;
        deps.executor.voidConfirmations(); // a confirmation never survives a new connection (D-082)
        deps.usage.activity(this.timers.now());
      },
      lost: () => (this.ending ? this.stop(this.ending.reason) : this.lose('dropped')),
      quiet: () => !this.audio?.isPlaying() && !this.userSpeaking && !this.modelBusy && this.tools.idle,
      refresh: () => this.refreshText(),
      sentRefresh: () => this.outbox.expectReply(),
    });
    this.tools = new ToolRunner({
      executor: deps.executor, log: deps.log, now: () => this.timers.now(),
      stamp: () => this.attempt,
      accepts: (stamp) => stamp === this.attempt && this.state.status !== 'error' && this.state.status !== 'ended', // from the connection on, until a stop or loss
      answer: (gen, responses) => {
        if (gen === this.link.generation()) this.outbox.expectReply(); // the model owes its reply now
        void this.link.sendToolResponses(gen, responses);
      },
      failed: () => this.stop('failures'),
      ending: () => this.goodbye({ reason: 'user', atTurnEnd: true }),
      busy: (on) => this.cues.toolsBusy(on),
    });
    this.cues = new SessionCues({ timers: this.timers, audio: () => this.audio, changed: () => this.poll(), log: deps.log });
    this.mic = new MicGate({ timers: this.timers, audio: () => this.audio, live: () => this.live(), streamEnd: () => this.link.streamEnd(), hiddenTooLong: () => this.pauseFor('hidden') });
    this.outbox = new QuietOutbox({ timers: this.timers, streaming: () => this.streaming(), playing: () => !!this.audio?.isPlaying(), busy: () => this.modelBusy, stamp: () => this.attempt, send: (text) => this.link.sendText(text), log: deps.log });
  }

  getState(): VoiceState { return this.cell.get(); }
  subscribe(listener: () => void): () => void { return this.cell.subscribe(listener); }
  /** Trainer turns so far (one per turn, at its first words after a model turn ended). */
  speechSeq(): number { return this.turns.counts.speechSeq; }
  /** Model turns that ended (turnComplete or interrupted). */
  turnSeq(): number { return this.turns.counts.turnSeq; }
  /** turnSeq() when the trainer's latest turn began. */
  spokeAtTurn(): number { return this.turns.counts.spokeAtTurn; }
  generation(): number { return this.link.generation(); }
  /** Resolves when the agent is quiet (nothing played for 300 ms, no model turn in progress or owed), when the session is not streaming, at the cap, or on abort (D-148). */
  whenQuiet(capMs: number, signal?: AbortSignal): Promise<void> { return this.outbox.whenQuiet(capMs, signal); }
  private get state(): VoiceState { return this.cell.get(); }
  private set(patch: Partial<VoiceState>): void { this.cell.set(patch); }

  /** Call synchronously from the click handler (creates the AudioContexts first). No-op unless idle, ended or error. */
  start(): void {
    const { status } = this.state;
    if (status !== 'idle' && status !== 'ended' && status !== 'error') return;
    this.link.close();
    this.link.takeHandle(); // a fresh conversation
    this.tools.reset(); // nothing of the last conversation counts in this one
    this.failedConnects = 0;
    this.startedAt = this.timers.now();
    this.begin('start', { status: 'connecting', captions: [], focus: null });
  }

  /** From a click: new AudioContexts, the resumption handle once, then without it; kickoff RECONNECT_EVENT. */
  reconnect(): void {
    if (this.state.status === 'error' && this.state.canReconnect) this.begin('reconnect', { status: 'reconnecting' });
  }

  stop(reason: VoiceErrorCode | 'user' = 'user'): void {
    const { status } = this.state;
    if (status === 'idle' || status === 'ended') return;
    this.deps.log(`stop (${reason})`);
    const wasLive = this.live();
    this.attempt += 1;
    if (wasLive) this.link.streamEnd();
    if (wasLive) this.cues.ended(); // before the audio closes (it plays out first)
    this.halt();
    for (const off of this.unsubs.splice(0)) off();
    this.mic.cameras.reset(); // nothing listens now: the next start reads the camera again
    const error = reason === 'user' ? null : reason;
    this.set({ status: error ? 'error' : 'ended', error, canReconnect: false, talking: false, level: 0, micHeld: null });
    this.outbox.drop();
  }

  /** Pause: mic off, audioStreamEnd, the agent told to stay quiet. Audio recorded before the pause is stale: dropped. */
  pause(): void {
    this.pauseFor('user');
  }

  /** From a click: mic on, the agent re-reads the state (the executor's resume text). */
  resume(): void {
    this.resumeBy('tap');
  }

  /** Resume by tap, or automatically after a check (D-148); `text`: the pass's own text, in place of the resume text. */
  private resumeBy(by: 'tap' | 'auto', text: string | null = null): void {
    if (this.state.status !== 'paused') return;
    this.mic.resumed();
    this.pauseHeld = false;
    this.deps.log(`resume (${by})`);
    this.set({ status: this.liveStatus() });
    this.syncMic();
    this.deps.usage.activity(this.timers.now());
    this.link.sendText(text ?? this.deps.executor.resumeText());
    this.outbox.expectReply();
  }

  /**
   * WebView hidden: stop sending audio (audioStreamEnd); after 20 s hidden, pause(). Visible: stream again unless
   * paused. Coming back is activity: a trainer returning to a session the hidden page paused gets the full idle
   * window to tap Resume (the hidden time itself still counted toward the idle cap).
   */
  setHidden(hidden: boolean): void {
    const { changed, resume } = this.mic.setHidden(hidden);
    if (!changed) return;
    if (!hidden && this.live()) this.activity();
    this.syncMic();
    if (resume) this.resumeBy('auto'); // a hidden pause that began during a check (D-148)
  }

  setPushToTalk(on: boolean): void {
    this.set({ pushToTalk: on, talking: false });
    this.syncMic();
  }

  /** Push-to-talk: the mic is on only while held; release sends audioStreamEnd. */
  talk(down: boolean): void {
    if (!this.state.pushToTalk || this.state.talking === down) return;
    this.set({ talking: down });
    this.syncMic();
  }

  /**
   * A screen the trainer reached (the voice UI's screen sync, or Home's trade switcher): activity, and the executor's
   * text, on the tool queue. While the text would be dropped (paused, not live) the executor asks nothing (quiet).
   */
  onScreen(signal: ScreenSignal): void {
    if (!this.unsubs.length) return;
    this.activity();
    this.mic.leave();
    this.queueText(() => this.deps.executor.onScreen(signal, () => !this.streaming()));
  }

  private pauseFor(by: 'user' | 'hidden'): void {
    if (!this.streaming()) return;
    this.audio?.flush();
    this.link.dropAudio();
    this.mic.paused(by, this.deps.executor.checking());
    this.deps.log(`pause (${by})`);
    this.pauseHeld = this.link.swapping();
    this.set({ status: 'paused' });
    this.outbox.drop();
    this.syncMic();
    this.link.sendText(PAUSE_EVENT);
  }

  private begin(kind: 'start' | 'reconnect', patch: Partial<VoiceState>): void {
    const my = ++this.attempt;
    this.cues.connecting(); // a tap: the first listening plays "ready"
    this.mic.fresh(); // start and reconnect come from a click: the page is visible, the new mic starts on
    this.audio = null;
    try { this.audio = this.deps.audio(); } catch { /* no usable AudioContext: stopped as unsupported below */ } // synchronously, inside the click
    if (!this.unsubs.length) {
      this.mic.cameras.reset(this.deps.verification.camerasOn());
      this.set({ micHeld: this.mic.held });
      this.unsubs = attachTaps(this.deps, {
        text: (text) => this.sendIfLive(text),
        live: () => this.streaming(),
        activity: () => this.activity(),
        verification: (e) => this.onVerification(e),
        focus: (focus) => this.set({ focus }),
        saved: () => this.streaming() && this.cues.saved(),
        offline: () => this.stop('offline'),
      });
    }
    this.syncMic();
    this.set({ ...patch, error: null, canReconnect: false, talking: false, level: 0 });
    if (!this.audio) return this.stop('unsupported');
    this.deps.log(kind);
    void this.open(kind, my).catch(() => {
      if (my === this.attempt) this.lose('connect_failed');
    });
  }

  /** Online, the daily cap, the mic (its prompt can be slow; a token must start a session within 60 s), then the connection. */
  private async open(kind: 'start' | 'reconnect', my: number): Promise<void> {
    const { deps } = this;
    if (!deps.isOnline()) return this.stop('offline');
    // The transport module downloads while the mic starts (D-138); a failed load here is retried by link.open.
    try { deps.transport().catch(() => undefined); } catch { /* link.open loads it again and logs the failure */ }
    const usage = await deps.usage.canStart();
    if (my !== this.attempt) return;
    if (!usage.ok) return this.stop('daily_limit');
    const mic = await this.audio?.startMic((pcm) => this.onMic(pcm), () => my === this.attempt && this.lose('mic_unavailable'));
    if (my !== this.attempt || !mic) return;
    if (!mic.ok) return this.stop(MIC_ERRORS[mic.error]);
    const opened = await this.link.open(kind === 'reconnect' ? this.link.takeHandle() : undefined);
    if (my !== this.attempt || opened === 'stale') return;
    if (opened !== 'ok') return opened === 'connect_failed' ? this.lose('connect_failed') : this.stop(opened);
    // On the tool queue, after the screen and verification hooks already queued (one queued while Reconnect showed
    // may wait behind a slow call of the dropped connection): the kickoff reads the flow those hooks moved. A Reconnect
    // passes the question still waiting for the trainer, so it is asked again with a code for the new connection.
    const kickoff = await this.tools.after(() => deps.executor.kickoff(kind, deps.languageName, kind === 'reconnect' ? this.tools.pendingQuestion : null));
    if (my !== this.attempt) return;
    this.link.sendText(kickoff);
    this.outbox.expectReply();
    this.set({ status: 'listening', minutesLeft: this.minutesLeft() });
    this.cues.listening();
    this.intervals = [this.timers.setInterval(() => this.tick(), TICK_MS), this.timers.setInterval(() => this.poll(), POLL_MS)];
  }

  /** Every part of every event, in order (MVP-02 onMessage): audio, captions, speech, handle, goAway, cancellations, calls. */
  private route(e: LiveEvent, gen: number): void {
    const now = this.timers.now();
    const paused = this.state.status === 'paused';
    if (e.interrupted) this.deps.log('interrupted');
    try {
      if (e.interrupted) this.audio?.flush(); // the trainer barged in: play nothing of this message
      else if (!paused) for (const pcm of e.audio) this.audio?.play(pcm); // Paused: the agent stays quiet
    } catch {
      /* a playback error never stops the rest of the message */
    }
    // Paused: the agent's words are not played, so they are not shown either (the trainer's and every close stay)
    this.set({ captions: captionsAfter(this.state.captions, paused && e.outputText ? { ...e, outputText: undefined } : e) });
    this.turns.observe(e);
    this.outbox.observe(e);
    if (e.inputText || e.inputFinished) this.deps.usage.activity(now);
    if (e.inputText) this.userSpeaking = true;
    if (e.audio.length && !e.interrupted && this.startedAt !== null) { // flushed audio was never heard: not the first reply
      this.deps.log(`first audio ${Math.round(now - this.startedAt)} ms after start`);
      this.startedAt = null;
    }
    if ((e.audio.length && !paused) || e.toolCalls?.length) this.modelBusy = true; // not the output transcript: it lags the audio
    if (e.turnComplete) this.userSpeaking = this.modelBusy = false;
    if (e.resumption?.resumable && e.resumption.handle) this.link.keepHandle(e.resumption.handle);
    if (e.goAwayMs !== undefined) this.link.goAway(e.goAwayMs);
    if (e.cancelledIds?.length) this.tools.cancel(e.cancelledIds, gen);
    if (e.toolCalls?.length) {
      this.deps.usage.activity(now);
      this.tools.run(e.toolCalls, gen);
    }
    if (e.turnComplete && this.ending?.atTurnEnd) return this.stop(this.ending.reason);
    this.poll();
    this.link.maybeSwap();
  }

  /**
   * The first text of the connection a goAway swap moved to, decided when the swap completes. Paused (Pause):
   * nothing when the old connection heard PAUSE_EVENT (the resumed conversation keeps it; Resume makes the model
   * call get_status), PAUSE_EVENT when the swap held it. Otherwise the executor's refresh, with what the trainer
   * last said when a question is pending (passed on, never logged); a pause while it was being built held its
   * PAUSE_EVENT, so PAUSE_EVENT goes instead.
   */
  private async refreshText(): Promise<string | null> {
    if (this.paused()) return this.heldPause();
    const pending = this.tools.pendingQuestion;
    const text = await this.deps.executor.refresh(pending, pending ? this.lastHeard() : '');
    if (!this.paused()) return text;
    this.pauseHeld = false;
    return PAUSE_EVENT;
  }

  private heldPause(): string | null {
    const held = this.pauseHeld;
    this.pauseHeld = false;
    return held ? PAUSE_EVENT : null;
  }

  /** The trainer's last finished utterance (the newest closed trainer caption). */
  private lastHeard(): string {
    return this.state.captions.findLast((c) => c.who === 'trainer' && c.final)?.text.trim() ?? '';
  }

  /** Once a second while live: the caps, the speaking state, a pending swap. Pause on a visible page holds the idle clock. */
  private tick(): void {
    const now = this.timers.now();
    if (this.state.status === 'paused' && this.mic.holdsIdle()) this.deps.usage.activity(now);
    const reason = this.ending ? null : this.deps.usage.tick(now);
    this.set({ minutesLeft: this.minutesLeft() });
    this.poll();
    this.link.maybeSwap();
    if (!reason) return;
    this.sendIfLive(limitEvent(reason));
    this.goodbye({ reason, atTurnEnd: false });
  }

  private goodbye(ending: Goodbye): void {
    if (this.ending) return;
    this.ending = ending;
    this.timeouts.add(this.timers.setTimeout(() => this.stop(ending.reason), STOP_AFTER_MS));
  }

  /** Trainer speech, a tap, a screen or a verification event, or a tool call: resets the idle clock. */
  private activity(): void {
    this.deps.usage.activity(this.timers.now());
  }

  /**
   * A check's event (D-086, D-148): the mic goes off the moment the camera opens (the player is never flushed for it);
   * the event's text waits until the agent is quiet. The pass of a check a trainer's pause (Pause) began during resumes voice
   * with it on a visible page; a hidden pause resumes only when the page shows again.
   */
  private onVerification(e: VerificationEvent): void {
    this.activity();
    if (e.type === 'camera') this.deps.log(`camera ${e.on ? 'on' : 'off'}`);
    if (this.mic.apply(e)) {
      this.set({ micHeld: this.mic.held });
      this.syncMic();
    }
    const [cap, atCap] = e.type === 'camera' && e.on ? CAMERA_TEXT : CHECK_TEXT;
    const passed = e.type === 'granted' && this.paused() && this.mic.resumesOn(e.purpose) ? e.purpose : null;
    // quiet: the text would be dropped (not live, or a pass that resumes only when a hidden page shows again)
    const resumesNow = () => !!passed && this.paused() && this.mic.resumesOn(passed) && !this.mic.hidden;
    this.queueText(() => this.deps.executor.onVerification(e, () => !this.streaming() && !resumesNow()), (text) => {
      if (passed && this.paused() && this.mic.resumesOn(passed)) {
        // never on a hidden page: a pass while hidden ends the pause when the page shows again
        if (resumesNow()) return this.resumeBy('auto', text);
        this.mic.owe();
      }
      this.outbox.sendWhenQuiet(text, cap, atCap);
    });
  }

  /**
   * The executor's hook for an event, on the tool queue. It runs whenever the taps are attached, Reconnect showing
   * included, so the flow follows what the trainer did by hand meanwhile; its text is sent only in the attempt it
   * was queued in, and only while live (the Reconnect kickoff re-reads the state).
   */
  private queueText(read: () => Promise<string | null>, send: (text: string | null) => void = (text) => this.sendIfLive(text)): void {
    this.tools.enqueue(async (stamp) => {
      const text = await read();
      if (stamp === this.attempt) send(text);
    }, () => this.unsubs.length > 0 && this.state.status !== 'ended');
  }

  private onMic(pcm: Int16Array): void {
    if (this.mic.isOn && this.streaming()) this.link.sendAudio(pcm); // chunks before live are dropped
  }

  private syncMic(): void {
    this.mic.sync(this.state);
  }

  /** Dropped, not queued, while not live or paused: every kickoff and Resume makes the model re-read the state. */
  private sendIfLive(text: string | null): void {
    if (text && this.streaming()) this.link.sendText(text);
  }

  private paused(): boolean { return this.state.status === 'paused'; }
  private streaming(): boolean { return this.state.status === 'listening' || this.state.status === 'speaking' || this.state.status === 'working'; }
  /** While streaming: the agent's audio plays, a blocking call runs long (D-156), or it listens. */
  private liveStatus(): 'speaking' | 'working' | 'listening' { return this.audio?.isPlaying() ? 'speaking' : this.cues.working ? 'working' : 'listening'; }
  private live(): boolean { return this.streaming() || this.state.status === 'paused'; }

  /** Speaking comes from the player, never from transcripts; the level from the mic. */
  private poll(): void {
    const level = Math.round((this.audio?.level() ?? 0) * 20) / 20;
    this.set(this.streaming() ? { level, status: this.liveStatus() } : { level });
    this.outbox.release();
  }

  private minutesLeft(): number {
    return Math.ceil(this.deps.usage.secondsLeft / 60);
  }

  /** A connect failure, a drop or the mic gone: Reconnect (a tap) continues; subscriptions stay. */
  private lose(code: 'connect_failed' | 'dropped' | 'mic_unavailable'): void {
    if (code === 'connect_failed' && ++this.failedConnects >= MAX_FAILED_CONNECTS) return this.stop('failures');
    this.deps.log(`lost (${code})`);
    this.attempt += 1;
    this.halt();
    this.set({ status: 'error', error: code, canReconnect: true, talking: false, level: 0 });
    this.outbox.drop();
  }

  /** Teardown on every path: timers, the connection, both AudioContexts (audio.close), the usage write. */
  private halt(): void {
    this.startedAt = null; // a later Reconnect is not the start: its first audio is not timed
    for (const id of this.intervals.splice(0)) this.timers.clearInterval(id);
    for (const id of this.timeouts) this.timers.clearTimeout(id);
    this.timeouts.clear();
    this.mic.halt();
    this.link.close();
    this.audio?.close();
    this.audio = null;
    this.ending = null;
    this.userSpeaking = this.modelBusy = false;
    this.pauseHeld = false;
    this.cues.reset();
    void this.deps.usage.flush().catch(() => undefined);
  }
}

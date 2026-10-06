/**
 * What holds a voice session's microphone (D-086, D-119, D-120, D-148): a pause (Pause, or a page hidden for
 * 20 s), the hidden page itself, a face camera, a released push-to-talk. Also which checks a pause began during: the
 * pass of such a check ends a trainer's pause (Pause) (on a visible page; a pass while the page is hidden ends it when the page
 * shows again), and the page showing again ends a hidden pause that began during one. A hidden pause never ends while
 * the page stays hidden.
 * While a screen waits for the camera permission (a native dialog can hide the page) the hidden timer is 60 s instead:
 * the wait is bounded, so a face check stalled on a hidden page still pauses.
 */
import type { VerificationEvent } from '../verification';
import type { AudioIO } from './audio/types';
import { CameraWatch } from './session-taps';
import type { Timers, VoiceState } from './session-types';

const HIDDEN_PAUSE_MS = 20_000;
/** The hidden timer while a camera permission is asked: long enough for the device dialog, never unbounded. */
const ASKING_HIDDEN_PAUSE_MS = 60_000;

export interface MicHost {
  readonly timers: Timers;
  audio(): AudioIO | null;
  /** Live or paused: an audioStreamEnd can be sent. */
  live(): boolean;
  streamEnd(): void;
  /** The page stayed hidden for 20 s. */
  hiddenTooLong(): void;
}

export class MicGate {
  readonly cameras = new CameraWatch();
  /** Why the session is paused: Pause ('user') holds the idle clock while the page is visible; a hidden page does not. */
  pausedBy: 'user' | 'hidden' | null = null;
  private during: ReadonlySet<string> = new Set();
  /** A trainer's pause (Pause) whose check passed while the page was hidden: it ends when the page shows again. */
  private owed = false;
  private on = true;
  private hiddenNow = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  /** How long the running hidden timer was armed for. */
  private timerMs = 0;

  constructor(private readonly host: MicHost) {}

  get hidden(): boolean { return this.hiddenNow; }
  get isOn(): boolean { return this.on; }
  /** 'camera' while a face camera is on. */
  get held(): VoiceState['micHeld'] { return this.cameras.isOn ? 'camera' : null; }

  /** Start or Reconnect, from a click: the page is visible and the new microphone starts on. */
  fresh(): void {
    this.hiddenNow = false;
    this.on = true;
  }

  /** A pause began: `checks` are the checks voice follows now (a camera on counts as one too). */
  paused(by: 'user' | 'hidden', checks: readonly string[]): void {
    this.pausedBy = by;
    this.during = new Set([...this.cameras.purposes, ...checks]);
    this.owed = false;
  }

  resumed(): void {
    this.pausedBy = null;
    this.during = new Set();
    this.owed = false;
  }

  /**
   * The pass of `purpose` ends the pause: Pause made it during that check. A hidden pause is not ended by a pass:
   * the page showing again ends it (setHidden).
   */
  resumesOn(purpose: string): boolean { return this.pausedBy === 'user' && this.during.has(purpose); }

  /** That pass came while the page is hidden: the pause ends when the page shows again, not now. */
  owe(): void {
    if (this.pausedBy === 'user') this.owed = true;
  }

  /** Pause on a visible page holds the idle clock (D-119). */
  holdsIdle(): boolean { return this.pausedBy === 'user' && !this.hiddenNow; }

  /** Changed: true. `resume`: visible again after a hidden pause that began during a check, or a check's pass owed. */
  setHidden(hidden: boolean): { readonly changed: boolean; readonly resume: boolean } {
    if (hidden === this.hiddenNow) return { changed: false, resume: false };
    this.hiddenNow = hidden;
    this.arm();
    const resume = !hidden && ((this.pausedBy === 'hidden' && this.during.size > 0) || (this.pausedBy === 'user' && this.owed));
    return { changed: true, resume };
  }

  /** A verification event: the cameras and permission prompts it changes. True when it was a camera event. */
  apply(e: VerificationEvent): boolean {
    this.cameras.apply(e);
    this.arm();
    return e.type === 'camera';
  }

  /** The trainer reached another screen: a permission screen left behind waits for nothing. */
  leave(): void {
    this.cameras.leave();
    this.arm();
  }

  /** The mic is on unless paused, hidden, under the face camera, or push-to-talk is released. */
  sync(state: Pick<VoiceState, 'status' | 'pushToTalk' | 'talking'>): void {
    const on = state.status !== 'paused' && !this.hiddenNow && !this.cameras.isOn && (!state.pushToTalk || state.talking);
    if (on === this.on) return;
    this.on = on;
    this.host.audio()?.setMicEnabled(on);
    if (!on && this.host.live()) this.host.streamEnd();
  }

  /** Teardown: no timer, no pause. The cameras keep being followed while the taps stay attached. */
  halt(): void {
    this.clearTimer();
    this.resumed();
  }

  private arm(): void {
    const ms = !this.hiddenNow ? 0 : this.cameras.askingPermission ? ASKING_HIDDEN_PAUSE_MS : HIDDEN_PAUSE_MS;
    if (ms === (this.timer !== undefined ? this.timerMs : 0)) return;
    this.clearTimer();
    if (ms) {
      this.timerMs = ms;
      this.timer = this.host.timers.setTimeout(() => {
        this.timer = undefined; // fired: the next arm() can start it again
        this.host.hiddenTooLong();
      }, ms);
    }
  }

  private clearTimer(): void {
    if (this.timer !== undefined) this.host.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }
}

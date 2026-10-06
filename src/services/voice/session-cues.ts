/**
 * A voice session's feedback while nobody speaks (D-156): the earcons, through the session's AudioIO ("ready" at the
 * first listening after a start or a Reconnect, never after a goAway swap; "saved" when voice saved a record while
 * live; "ended" when a live session stops), and the working status: a batch of blocking tool calls that has run longer
 * than WORKING_AFTER_MS. The session shows "working" only while no agent audio plays ("speaking" wins). A cue is not
 * agent speech: it never sets "speaking", so it neither re-opens a collapsed card nor holds a check's text.
 */
import type { Earcon } from './audio/earcons';
import type { AudioIO } from './audio/types';
import type { Timers } from './session-types';

/** A tool call running longer than this shows the working status. */
export const WORKING_AFTER_MS = 400;

export interface CueHost {
  readonly timers: Timers;
  audio(): AudioIO | null;
  /** The working status changed: the session re-reads its status. */
  changed(): void;
  /** Debug lines (`[voice] earcon ready`): the cue's name only. */
  log(line: string): void;
}

export class SessionCues {
  private readyOwed = false;
  private busy = false;
  private slow = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly host: CueHost) {}

  /** A start or a Reconnect (a tap): the first listening after it plays "ready". */
  connecting(): void {
    this.readyOwed = true;
  }

  /** The connection is live and listening. */
  listening(): void {
    if (!this.readyOwed) return;
    this.readyOwed = false;
    this.cue('ready');
  }

  /** Voice saved a record (a submit, the trainer's own mark, a staff mark); the caller checks the session is live. */
  saved(): void {
    this.cue('saved');
  }

  /** A live session stops: the agent's audio is cut first, so the cue is never over its speech. */
  ended(): void {
    this.cue('ended', true);
  }

  /** A cue is only feedback: one that cannot play never stops or breaks the session. */
  private cue(kind: Earcon, cutSpeech = false): void {
    let played = false;
    try {
      const audio = this.host.audio();
      if (cutSpeech) audio?.flush();
      played = audio?.earcon(kind) ?? false;
    } catch {
      /* no cue */
    }
    this.host.log(`earcon ${kind}${played ? '' : ' (not played)'}`);
  }

  /** The tool queue started (true) or finished (false) answering a toolCall message. */
  toolsBusy(on: boolean): void {
    this.busy = on;
    this.clearTimer();
    if (on) {
      this.timer = this.host.timers.setTimeout(() => {
        this.timer = null;
        if (!this.busy) return;
        this.slow = true;
        this.host.changed();
      }, WORKING_AFTER_MS);
      return;
    }
    if (!this.slow) return;
    this.slow = false;
    this.host.changed();
  }

  /** A blocking call has run longer than WORKING_AFTER_MS and still runs. */
  get working(): boolean {
    return this.slow;
  }

  /** Teardown (stop, loss): nothing is owed or running. */
  reset(): void {
    this.readyOwed = false;
    this.busy = false;
    this.slow = false;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) this.host.timers.clearTimeout(this.timer);
    this.timer = null;
  }
}

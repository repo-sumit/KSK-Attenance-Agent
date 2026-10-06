/**
 * Earcons (D-156): three short, quiet cues synthesised with WebAudio on the output AudioContext, no asset files:
 * "ready" (the first listening after a connect), "saved" (a submit, the trainer's own mark or a staff mark that was
 * saved) and "ended" (voice stopped). Each lasts at most EARCON_MAX_MS and peaks at EARCON_GAIN, below a quarter of
 * the agent's speech (played at full scale). A cue never plays while the agent speaks, and speech that arrives while a
 * cue sounds starts when it ends (PcmPlayer.holdUntil). The cues are not agent audio: they never count as speaking, so
 * they neither re-open a collapsed card nor hold a check's text. The microphone's echo cancellation keeps them from the
 * model; the spoken rehearsal checks it.
 */

export type Earcon = 'ready' | 'saved' | 'ended';

/** The longest cue, in ms. */
export const EARCON_MAX_MS = 200;
/** The loudest a cue may be, as a share of the agent's speech (full scale). */
export const EARCON_MAX_GAIN = 0.25;
/** The peak every cue uses. */
const EARCON_GAIN = 0.18;
const ATTACK_S = 0.012;
const SILENT = 0.0001; // an exponential ramp cannot reach 0

interface Note {
  readonly hz: number;
  /** From the cue's start, in ms. */
  readonly at: number;
  readonly ms: number;
}

/** Two soft sine notes each: rising for ready, a rising fifth for saved, falling for ended. */
export const EARCONS: Readonly<Record<Earcon, readonly Note[]>> = {
  ready: [{ hz: 660, at: 0, ms: 80 }, { hz: 880, at: 90, ms: 90 }],
  saved: [{ hz: 784, at: 0, ms: 70 }, { hz: 1175, at: 80, ms: 110 }],
  ended: [{ hz: 660, at: 0, ms: 80 }, { hz: 440, at: 90, ms: 100 }],
};

/** The part of an AudioContext the cues use (a fake one in unit tests). */
export interface ToneContext {
  readonly currentTime: number;
  readonly destination: AudioNode;
  createOscillator(): OscillatorNode;
  createGain(): GainNode;
}

/** The agent's speech on the same context: whether it plays, and the hold that makes it wait for a cue. */
export interface SpeechOut {
  isPlaying(): boolean;
  holdUntil(time: number): void;
}

export class EarconPlayer {
  private end = 0;

  constructor(
    private readonly ctx: ToneContext,
    private readonly speech: SpeechOut,
  ) {}

  /** When the last cue ends, in context seconds (0 before any). */
  get endsAt(): number {
    return this.end;
  }

  /** Plays `kind` now; false when the agent speaks (never over it) or the context cannot make it. Never throws. */
  play(kind: Earcon): boolean {
    if (this.speech.isPlaying()) return false;
    try {
      const start = this.ctx.currentTime;
      let end = start;
      for (const note of EARCONS[kind]) end = Math.max(end, this.note(note, start));
      this.end = end;
      this.speech.holdUntil(end);
      return true;
    } catch {
      return false;
    }
  }

  /** How long the last cue still sounds, in ms (0 when it is over). */
  sounding(): number {
    return Math.max(0, (this.end - this.ctx.currentTime) * 1000);
  }

  private note(n: Note, start: number): number {
    const t0 = start + n.at / 1000;
    const t1 = t0 + n.ms / 1000;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(n.hz, t0);
    gain.gain.setValueAtTime(0, t0);
    gain.gain.linearRampToValueAtTime(EARCON_GAIN, t0 + ATTACK_S);
    gain.gain.exponentialRampToValueAtTime(SILENT, t1);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(t0);
    osc.stop(t1);
    return t1;
  }
}

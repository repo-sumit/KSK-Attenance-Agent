import { describe, expect, it, vi } from 'vitest';
import { EARCON_MAX_GAIN, EARCON_MAX_MS, EarconPlayer, EARCONS, type Earcon } from '@/services/voice/audio/earcons';

/** A fake output AudioContext: records every oscillator and gain node with their automation. */
function fakeContext(currentTime = 5) {
  const oscillators: { type: string; hz: [number, number][]; connect: ReturnType<typeof vi.fn>; start: ReturnType<typeof vi.fn>; stop: ReturnType<typeof vi.fn> }[] = [];
  const gains: { values: number[]; connect: ReturnType<typeof vi.fn>; node: object }[] = [];
  const destination = { name: 'speaker' };
  const ctx = {
    currentTime,
    destination,
    createOscillator: vi.fn(() => {
      const osc = { type: 'sine', hz: [] as [number, number][], connect: vi.fn(), start: vi.fn(), stop: vi.fn(), frequency: { setValueAtTime: (v: number, t: number) => osc.hz.push([v, t]) } };
      oscillators.push(osc);
      return osc;
    }),
    createGain: vi.fn(() => {
      const values: number[] = [];
      const node = { connect: vi.fn(), gain: { setValueAtTime: (v: number) => values.push(v), linearRampToValueAtTime: (v: number) => values.push(v), exponentialRampToValueAtTime: (v: number) => values.push(v) } };
      gains.push({ values, connect: node.connect, node });
      return node;
    }),
  };
  return { ctx, oscillators, gains, destination };
}

function speech(playing = false) {
  return { playing, isPlaying() { return this.playing; }, holdUntil: vi.fn() };
}

const KINDS: readonly Earcon[] = ['ready', 'saved', 'ended'];

describe('earcons (D-156)', () => {
  it.each(KINDS)('"%s": short (≤ 200 ms), quiet (≤ 0.25 of speech), sine notes into the speaker', (kind) => {
    const { ctx, oscillators, gains, destination } = fakeContext();
    const voice = speech();
    const cues = new EarconPlayer(ctx as never, voice);
    expect(cues.play(kind)).toBe(true);
    expect(oscillators.length).toBe(EARCONS[kind].length);
    for (const [i, osc] of oscillators.entries()) {
      expect(osc.type).toBe('sine');
      const [startAt] = osc.start.mock.calls[0] as [number];
      const [stopAt] = osc.stop.mock.calls[0] as [number];
      expect(startAt).toBeGreaterThanOrEqual(5);
      expect(stopAt).toBeLessThanOrEqual(5 + EARCON_MAX_MS / 1000 + 1e-9);
      expect(osc.connect).toHaveBeenCalledWith(gains[i].node); // each note through its own gain
      expect(gains[i].connect).toHaveBeenCalledWith(destination);
      expect(Math.max(...gains[i].values)).toBeLessThanOrEqual(EARCON_MAX_GAIN);
      expect(Math.min(...gains[i].values)).toBeGreaterThanOrEqual(0);
    }
    expect(EARCON_MAX_GAIN).toBeLessThanOrEqual(0.25);
    // speech that arrives meanwhile waits for the cue to end
    expect(voice.holdUntil).toHaveBeenCalledWith(cues.endsAt);
    expect(cues.endsAt).toBeLessThanOrEqual(5 + EARCON_MAX_MS / 1000 + 1e-9);
  });

  it('the three cues sound different: rising for ready, a rising leap for saved, falling for ended', () => {
    const pitch = (kind: Earcon) => EARCONS[kind].map((n) => n.hz);
    expect(pitch('ready')[1]).toBeGreaterThan(pitch('ready')[0]);
    expect(pitch('saved')[1] / pitch('saved')[0]).toBeGreaterThan(pitch('ready')[1] / pitch('ready')[0]);
    expect(pitch('ended')[1]).toBeLessThan(pitch('ended')[0]);
  });

  it('never while the agent speaks: nothing is made and nothing is held', () => {
    const { ctx, oscillators } = fakeContext();
    const voice = speech(true);
    const cues = new EarconPlayer(ctx as never, voice);
    expect(cues.play('saved')).toBe(false);
    expect(oscillators).toEqual([]);
    expect(voice.holdUntil).not.toHaveBeenCalled();
    voice.playing = false;
    expect(cues.play('saved')).toBe(true);
  });

  it('sounding(): true until the cue has ended, so the context closes after it (the "ended" cue)', () => {
    const { ctx } = fakeContext(5);
    const cues = new EarconPlayer(ctx as never, speech());
    expect(cues.sounding()).toBe(0);
    cues.play('ended');
    expect(cues.sounding()).toBeCloseTo((cues.endsAt - 5) * 1000, 5);
    ctx.currentTime = 6;
    expect(cues.sounding()).toBe(0);
  });

  it('a context that cannot make nodes plays nothing and never throws', () => {
    const { ctx } = fakeContext();
    ctx.createOscillator.mockImplementation(() => {
      throw new Error('closed');
    });
    const voice = speech();
    const cues = new EarconPlayer(ctx as never, voice);
    expect(cues.play('ready')).toBe(false);
    expect(voice.holdUntil).not.toHaveBeenCalled();
  });
});

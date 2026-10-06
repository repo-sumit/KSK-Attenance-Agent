import { EarconPlayer } from './earcons';
import { PcmPlayer } from './player';
import { startMic, type Mic } from './recorder';
import type { AudioFactory, AudioIO } from './types';

/**
 * Real browser audio. Call synchronously inside the click handler: both AudioContexts are created
 * and resumed before any await, which keeps them inside the user activation (autoplay rule).
 */
export const createBrowserAudio: AudioFactory = () => {
  const inCtx = new AudioContext({ sampleRate: 16000 });
  let outCtx: AudioContext;
  try {
    outCtx = new AudioContext({ sampleRate: 24000 });
  } catch (error) {
    void inCtx.close().catch(() => undefined); // do not leak the first context when the second cannot be made
    throw error;
  }
  void inCtx.resume().catch(() => undefined);
  void outCtx.resume().catch(() => undefined);
  const player = new PcmPlayer(outCtx);
  const cues = new EarconPlayer(outCtx, player);
  let mic: Mic | null = null;
  let enabled = true;
  let closed = false;
  /** Bumped by every startMic: only the newest one keeps its stream (two overlapping starts would leak the first). */
  let starts = 0;

  const io: AudioIO = {
    async startMic(onChunk, onEnded) {
      if (closed) return { ok: false, error: 'failed' };
      const mine = ++starts;
      // A microphone is already open: release its stream before opening another, so no track is left running.
      mic?.stop();
      mic = null;
      const result = await startMic(inCtx, onChunk, onEnded);
      if (!result.ok) return result;
      if (closed || mine !== starts) {
        // closed meanwhile, or a newer start took over: this stream is nobody's
        result.mic.stop();
        return { ok: false, error: 'failed' };
      }
      mic = result.mic;
      mic.setEnabled(enabled);
      return { ok: true };
    },
    setMicEnabled(on) {
      enabled = on;
      mic?.setEnabled(on);
    },
    play: (pcm) => player.play(pcm),
    flush: () => player.flush(),
    isPlaying: () => player.isPlaying(),
    earcon: (kind) => !closed && cues.play(kind),
    level: () => mic?.level() ?? 0,
    close() {
      if (closed) return;
      closed = true;
      mic?.stop();
      mic = null;
      player.flush();
      // the "ended" cue plays out first: the output context closes once it has ended
      const linger = cues.sounding();
      const closeOut = () => void outCtx.close().catch(() => undefined);
      if (linger > 0) setTimeout(closeOut, Math.ceil(linger) + 30);
      else closeOut();
      void inCtx.close().catch(() => undefined);
    },
  };
  return io;
};

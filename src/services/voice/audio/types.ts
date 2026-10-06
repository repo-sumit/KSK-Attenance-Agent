/** Browser audio seam for Voice Agent: PCM16 mono in at 16 kHz, PCM16 mono out at 24 kHz. */
import type { Earcon } from './earcons';

export type MicError = 'permission_denied' | 'not_found' | 'busy' | 'insecure' | 'unsupported' | 'failed';

export interface AudioIO {
  startMic(
    onChunk: (pcm: Int16Array) => void,
    onEnded: () => void,
  ): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: MicError }>;
  /** Stop or resume sending chunks without closing the track (Pause, push-to-talk, face camera). */
  setMicEnabled(on: boolean): void;
  play(pcm: Int16Array): void;
  flush(): void;
  isPlaying(): boolean;
  /** A short quiet cue on the output (D-156), never over the agent's speech: false when it was not played. */
  earcon(kind: Earcon): boolean;
  /** 0..1 RMS of the latest input chunk, for the level bar. */
  level(): number;
  /** Stops the mic and the agent's audio; the output context closes once a cue still sounding has ended. */
  close(): void;
}

/** MUST be called synchronously inside the click handler: it creates and resumes both AudioContexts. */
export type AudioFactory = () => AudioIO;

/** Secure context + getUserMedia + AudioWorklet: without all three the mic cannot run. */
export function audioSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.isSecureContext === true &&
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getUserMedia === 'function' &&
    typeof AudioContext !== 'undefined' &&
    'audioWorklet' in AudioContext.prototype
  );
}

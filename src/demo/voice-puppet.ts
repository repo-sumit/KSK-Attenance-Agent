/**
 * DEMO ONLY. Drives the scripted voice model (`services.voice.scripted`) from the browser:
 * `window.__kskDemo.voice` plays the model's side for E2E tests and for a demo without a
 * microphone or network. Sessions use the scripted transport only while the demo's
 * "Voice model" is Scripted (simulation.voice). Nothing here reaches Google.
 */
import type { Earcon } from '@/services/voice/audio/earcons';
import type { MicError } from '@/services/voice/audio/types';
import type { LiveEvent, LiveToolResponse } from '@/services/voice/live/transport';
import type { VoiceService } from '@/services/voice/service';
import type { ToolResult } from '@/services/voice/tools';

export interface VoicePuppet {
  /** The model calls a tool; resolves with the app's response to it. */
  toolCall(name: string, args?: Record<string, unknown>): Promise<ToolResult>;
  /** The trainer finishes saying `text` (a finished input transcription). */
  speak(text: string): void;
  /** One raw server event (captions, interruption, turn complete...). */
  emit(event: Partial<LiveEvent>): void;
  /** Every text the app has sent to the model (kickoff, [APP] events, typed text), oldest first. */
  texts(): string[];
  /** Every tool response the app has sent, oldest first. */
  responses(): LiveToolResponse[];
  /** Every cue Voice Agent played (ready, saved, ended), oldest first (D-156). */
  earcons(): Earcon[];
  /** The connection drops (default: abnormal close, 1006). */
  drop(code?: number): void;
  /** The server announces it will close in `ms` (the session swaps connections). */
  goAway(ms: number): void;
  /** The next Voice Agent start finds the microphone unavailable with `error`. */
  denyMic(error?: MicError): void;
  /** The agent's audio is playing (true) or done (false): the checks wait for its line (D-148). */
  playing(on: boolean): void;
}

export function createVoicePuppet(voice: VoiceService): VoicePuppet {
  const scripted = voice.scripted;
  return {
    toolCall: (name, args = {}) => scripted.toolCall(name, args),
    speak: (text) => scripted.speak(text),
    emit: (event) => scripted.emit(event),
    // Copies: the page reads the record, it never rewrites it.
    texts: () => [...scripted.texts],
    responses: () => [...scripted.toolResponses],
    earcons: () => [...scripted.earcons],
    drop: (code) => scripted.drop(code),
    goAway: (ms) => scripted.goAway(ms),
    denyMic: (error = 'permission_denied') => scripted.denyNextMic(error),
    playing: (on) => scripted.setPlaying(on),
  };
}

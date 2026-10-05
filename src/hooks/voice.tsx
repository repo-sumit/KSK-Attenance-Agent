'use client';
import { createContext, useContext } from 'react';
import type { VoiceState } from '@/services/voice/session';

/** What screens read and call for Voice Agent (D-085). Provided by features/voice/VoiceProvider. */
export interface VoiceApi {
  /**
   * A voice plan exists for this session (instructors and the principal alike, wherever voice is enabled, D-139) and the
   * browser can run the mic (or the voice is scripted).
   */
  readonly available: boolean;
  /** The voice plan marks batches (it has a marking flow): the button's hint says what voice is for here. */
  readonly marks: boolean;
  readonly online: boolean;
  /** Null while Voice Agent is off. */
  readonly state: VoiceState | null;
  /** Synchronous: call it from the click handler (the AudioContexts are created inside it). */
  start(): void;
  stop(): void;
  pause(): void;
  resume(): void;
  reconnect(): void;
  setPushToTalk(on: boolean): void;
  talk(down: boolean): void;
}

export const VoiceContext = createContext<VoiceApi | null>(null);

/**
 * The agent's current student only. A separate context, because the voice state changes several times a second
 * (mic level, captions) while the focus does not: a roster re-renders only when the focus moves.
 */
export const VoiceFocusContext = createContext<VoiceState['focus']>(null);

const noop = () => undefined;
const INERT: VoiceApi = Object.freeze({
  available: false,
  marks: false,
  online: true,
  state: null,
  start: noop,
  stop: noop,
  pause: noop,
  resume: noop,
  reconnect: noop,
  setPushToTalk: noop,
  talk: noop,
});

/** The voice API, or an inert one (nothing available, every call a no-op) outside a VoiceProvider. */
export function useVoice(): VoiceApi {
  return useContext(VoiceContext) ?? INERT;
}

/**
 * The student the agent is on in this marking session, or null. `seq` changes on every focus_student, also when the
 * agent asks again for the student who is already current (the row scrolls back into view).
 */
export function useVoiceFocus(sessionKey: string): { readonly studentId: string; readonly seq: number } | null {
  const focus = useContext(VoiceFocusContext);
  return focus && focus.sessionKey === sessionKey ? { studentId: focus.studentId, seq: focus.seq } : null;
}

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
  /**
   * A screen that moves on its own (the verification run) waits for the agent before its next step (D-148): resolves
   * when voice is not streaming, when the agent has been quiet for 300 ms with no model turn pending or in progress,
   * at `capMs` (scaled by the simulation speed), or when `signal` aborts. At once while Voice Agent is off.
   */
  settle(capMs: number, signal?: AbortSignal): Promise<void>;
}

export const VoiceContext = createContext<VoiceApi | null>(null);

/**
 * What paces a screen that moves on its own (the verification run, D-148): whether voice is live (listening or
 * speaking) and `settle`. A separate context, because the voice state changes several times a second (mic level,
 * captions) while these do not: the verification screen re-renders only when voice goes live or stops being live.
 */
export interface VoicePace {
  readonly live: boolean;
  settle(capMs: number, signal?: AbortSignal): Promise<void>;
}

/**
 * The agent's current student only. A separate context, because the voice state changes several times a second
 * (mic level, captions) while the focus does not: a roster re-renders only when the focus moves.
 */
export const VoiceFocusContext = createContext<VoiceState['focus']>(null);

const noop = () => undefined;
const settled = () => Promise.resolve();
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
  settle: settled,
});

const INERT_PACE: VoicePace = Object.freeze({ live: false, settle: settled });

export const VoicePaceContext = createContext<VoicePace>(INERT_PACE);

/** Whether voice is live, and settle(); not live and settled at once outside a VoiceProvider. */
export function useVoicePace(): VoicePace {
  return useContext(VoicePaceContext);
}

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

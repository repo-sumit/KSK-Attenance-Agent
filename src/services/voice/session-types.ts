/**
 * The public types of a voice session (used by VoiceService and the voice UI), its injectable timers, the
 * mapping of microphone errors to the codes the dock explains, and its state cell. Re-exported by ./session.
 */
import type { Result } from '@/lib/result';
import type { MarkingDraftService } from '../marking-draft';
import type { VerificationService } from '../verification';
import type { ActionBus } from './action-bus';
import type { AudioFactory, MicError } from './audio/types';
import type { Caption } from './captions';
import type { VoiceExecutor } from './executor';
import type { TokenError } from './live/token-client';
import type { LiveSetup, LiveToken, LiveTransport } from './live/transport';
import type { VoiceUsage } from './usage';

/** `working`: live, while a blocking tool call has run longer than 400 ms with no agent audio playing (D-156). */
export type VoiceStatus = 'idle' | 'connecting' | 'listening' | 'speaking' | 'working' | 'paused' | 'reconnecting' | 'error' | 'ended';
export type VoiceErrorCode =
  | 'mic_denied' | 'mic_unavailable' | 'insecure' | 'unsupported' | 'unavailable' | 'rate_limited' | 'connect_failed'
  | 'dropped' | 'offline' | 'daily_limit' | 'session_limit' | 'idle' | 'failures';

export interface VoiceState {
  readonly status: VoiceStatus;
  readonly error: VoiceErrorCode | null;
  /** Newest last, at most 14. */
  readonly captions: readonly Caption[];
  readonly level: number;
  readonly pushToTalk: boolean;
  readonly talking: boolean;
  readonly canReconnect: boolean;
  readonly minutesLeft: number;
  /** The agent's current student; `seq` (the focus_student event's) changes on every focus, the same student asked again included. */
  readonly focus: { readonly sessionKey: string; readonly studentId: string; readonly seq: number } | null;
  /** 'camera' while a face camera holds the mic off (D-086, D-148): voice comes back by itself when it closes. */
  readonly micHeld: 'camera' | null;
}

export interface Timers {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  /** Wall-clock milliseconds (the idle cap and the call rate are wall-clock). */
  now: () => number;
}

export interface VoiceSessionDeps {
  readonly executor: VoiceExecutor;
  readonly setup: (resumeHandle?: string) => Promise<LiveSetup>;
  readonly transport: () => Promise<LiveTransport>;
  readonly audio: AudioFactory;
  readonly token: () => Promise<Result<LiveToken, TokenError>>;
  readonly usage: VoiceUsage;
  readonly drafts: MarkingDraftService;
  readonly verification: VerificationService;
  readonly bus: ActionBus;
  readonly isOnline: () => boolean;
  readonly onOnlineChange: (listener: (online: boolean) => void) => () => void;
  readonly languageName: string;
  /** Ids and codes only: never audio, tokens, URLs, names or what was heard. */
  readonly log: (line: string) => void;
  readonly timers?: Timers;
}

/** Bound, because a browser throws "Illegal invocation" for a timer function called on another object. */
export function systemTimers(): Timers {
  const g = globalThis;
  return {
    setTimeout: g.setTimeout.bind(g),
    clearTimeout: g.clearTimeout.bind(g),
    setInterval: g.setInterval.bind(g),
    clearInterval: g.clearInterval.bind(g),
    now: () => Date.now(),
  };
}

export const MIC_ERRORS: Readonly<Record<MicError, VoiceErrorCode>> = {
  permission_denied: 'mic_denied',
  not_found: 'mic_unavailable',
  busy: 'mic_unavailable',
  failed: 'mic_unavailable',
  insecure: 'insecure',
  unsupported: 'unsupported',
};

/** A value for useSyncExternalStore: a new object on every change, listeners told synchronously. */
export class StateCell<T extends object> {
  private readonly listeners = new Set<() => void>();
  constructor(private current: T) {}

  get(): T {
    return this.current;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** No change, no new object and no call. */
  set(patch: Partial<T>): void {
    const keys = Object.keys(patch) as (keyof T)[];
    if (keys.every((k) => patch[k] === this.current[k])) return;
    this.current = { ...this.current, ...patch };
    for (const fn of [...this.listeners]) {
      try {
        fn();
      } catch {
        /* a UI listener never breaks the session */
      }
    }
  }
}

/**
 * Builds VoiceSession dependencies for the session tests: the scripted transport, silent audio that records
 * what the session asked of it, a stub executor that records calls, the real ActionBus, MarkingDraftService
 * and VerificationService, an in-memory VoiceUsage, and timers that follow vi.useFakeTimers().
 */
import { vi } from 'vitest';
import type { RosterData } from '@/services/attendance';
import type { SessionContext } from '@/services/context';
import { MarkingDraftService, type DraftChange } from '@/services/marking-draft';
import { ScriptedLiveTransport, SilentAudio } from '@/services/simulated/voice';
import { VerificationService, type VerificationEvent } from '@/services/verification';
import { ActionBus } from '@/services/voice/action-bus';
import { RECONNECT_EVENT, RESUME_EVENT } from '@/services/voice/app-events';
import type { ScreenSignal, ToolCall, ToolResult, VoiceExecutor } from '@/services/voice/executor';
import { fetchLiveToken } from '@/services/voice/live/token-client';
import type { LiveTransport } from '@/services/voice/live/transport';
import type { VoiceSessionDeps } from '@/services/voice/session';
import { VoiceUsage, type VoiceLimits } from '@/services/voice/usage';
import type { AttendanceRepository } from '@/repositories/interfaces';
import { batch, card, STUDENTS } from '../../helpers/voice-view';

export const OK: ToolResult = { ok: true, instruction: 'x' };
export const KEY = card(batch(2)).key;

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets every pending promise callback run (no timers move). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 50; i++) await Promise.resolve();
}

/** SilentAudio that remembers the mic callbacks and what the session asked of it. */
export class TestAudio extends SilentAudio {
  playing = false;
  closed = 0;
  flushed = 0;
  readonly micEnabled: boolean[] = [];
  private onChunk: ((pcm: Int16Array) => void) | null = null;
  private onEnded: (() => void) | null = null;

  override async startMic(onChunk: (pcm: Int16Array) => void, onEnded: () => void) {
    this.onChunk = onChunk;
    this.onEnded = onEnded;
    return super.startMic(onChunk, onEnded);
  }
  override setMicEnabled(on: boolean): void { this.micEnabled.push(on); }
  override isPlaying(): boolean { return this.playing; }
  override flush(): void { this.flushed += 1; }
  override close(): void { this.closed += 1; }
  /** One 40 ms mic chunk, as the worklet would deliver it. */
  chunk(): void { this.onChunk?.(new Int16Array(640)); }
  endMic(): void { this.onEnded?.(); }
}

export function stubExecutor() {
  let respond: (call: ToolCall) => ToolResult | Promise<ToolResult> = () => OK;
  let refreshed: () => Promise<string> = async () => '[APP] Refreshed.';
  const ex = {
    calls: [] as ToolCall[],
    refreshes: [] as (string | null)[],
    /** What the trainer last said, as the session passed it with each refresh. */
    heards: [] as string[],
    verifications: [] as VerificationEvent[],
    screens: [] as ScreenSignal[],
    /** Whether each screen hook ran quiet (the session would drop its text), read when the hook ran. */
    quiets: [] as boolean[],
    voids: 0,
    endRequested: false,
    respond(fn: (call: ToolCall) => ToolResult | Promise<ToolResult>) { respond = fn; },
    /** How refresh answers (default: '[APP] Refreshed.' at once). */
    refreshWith(fn: () => Promise<string>) { refreshed = fn; },
    async execute(call: ToolCall) {
      ex.calls.push(call);
      if (call.name === 'end_voice_session') ex.endRequested = true;
      return respond(call);
    },
    flow: () => { throw new Error('flow() is not used by the session'); },
    /** The question pending when each kickoff ran, as the session passed it. */
    kickoffs: [] as (string | null | undefined)[],
    kickoff: async (kind: 'start' | 'reconnect', _language?: string, pending?: string | null): Promise<string> => {
      ex.kickoffs.push(pending);
      return kind === 'start' ? '[APP] Session started.' : RECONNECT_EVENT;
    },
    resumeText: (): string => RESUME_EVENT,
    async refresh(pending: string | null, heard = '') { ex.refreshes.push(pending); ex.heards.push(heard); return refreshed(); },
    onDraftChange: (change: DraftChange) => (change.via === 'tap' ? `[APP] Tapped ${change.studentIds.join(',')}` : null),
    async onScreen(signal: ScreenSignal, quiet?: () => boolean) {
      ex.screens.push(signal);
      ex.quiets.push(quiet?.() ?? false);
      return signal.kind === 'home' ? '[APP] Home.' : null;
    },
    async onVerification(e: VerificationEvent) { ex.verifications.push(e); return e.type === 'face' ? '[APP] Face.' : null; },
    voidConfirmations() { ex.voids += 1; },
  };
  return ex satisfies VoiceExecutor;
}

export interface HarnessOptions {
  readonly limits?: Partial<VoiceLimits>;
  readonly usedSeconds?: number;
  /** Wraps the scripted transport in one that needs a token, fetched with this. */
  readonly token?: VoiceSessionDeps['token'];
  /** Answers the token request with this HTTP status (through the real token client). */
  readonly tokenStatus?: number;
}

export function makeSessionDeps(o: HarnessOptions = {}) {
  const transport = new ScriptedLiveTransport();
  const connect = vi.spyOn(transport, 'connect');
  const audios: TestAudio[] = [];
  const executor = stubExecutor();
  const bus = new ActionBus();
  const drafts = new MarkingDraftService({ attendance: { saveDraft: async () => undefined } as unknown as AttendanceRepository, now: () => new Date(0) });
  const verification = new VerificationService({} as never, {} as never, {} as never, {} as never);
  const usage = new VoiceUsage({
    repo: { get: async () => o.usedSeconds ?? 0, add: async () => undefined },
    staffId: 'TR-1',
    today: () => '2026-10-03',
    limits: { sessionMinutes: 20, idleSeconds: 120, dailyMinutes: 60, ...o.limits },
  });
  let online = true;
  const onlineListeners = new Set<(online: boolean) => void>();
  const status = o.tokenStatus;
  const token = o.token ?? (status ? () => fetchLiveToken(async () => new Response('{}', { status })) : undefined);
  const live: LiveTransport = token ? { needsToken: true, connect: (t, s, cb) => transport.connect(t, s, cb) } : transport;
  const deps: VoiceSessionDeps = {
    executor,
    setup: async (resumeHandle) => ({ model: 'gemini-3.8-live', systemInstruction: 'test', tools: [], voiceName: 'Kore', resumeHandle }),
    transport: async () => live,
    audio: () => {
      const a = new TestAudio(transport);
      audios.push(a);
      return a;
    },
    token: token ?? (async () => { throw new Error('the scripted transport needs no token'); }),
    usage,
    drafts,
    verification,
    bus,
    isOnline: () => online,
    onOnlineChange: (fn) => {
      onlineListeners.add(fn);
      return () => {
        onlineListeners.delete(fn);
      };
    },
    languageName: 'English',
    log: () => undefined,
    // Read now, after vi.useFakeTimers(): the session calls the fakes.
    timers: { setTimeout, clearTimeout, setInterval, clearInterval, now: () => Date.now() },
  };
  return {
    deps,
    transport,
    executor,
    drafts,
    verification,
    bus,
    audios,
    get audio(): TestAudio {
      const a = audios.at(-1);
      if (!a) throw new Error('no audio was created');
      return a;
    },
    connects: () => connect.mock.calls.length,
    setOnline(next: boolean) {
      online = next;
      for (const fn of [...onlineListeners]) fn(next);
    },
    /** Opens the shared draft of KEY (three students, nothing marked). */
    openDraft() {
      const roster = { card: card(batch(2)), students: STUDENTS, marks: {}, packStale: false } as RosterData;
      return drafts.open({ config: {} } as unknown as SessionContext, roster);
    },
  };
}

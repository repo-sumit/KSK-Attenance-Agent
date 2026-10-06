/**
 * Voice transport and audio for demos and tests — SIMULATION ONLY: no network, no microphone, no speaker.
 * `ScriptedLiveTransport` stands in for the Gemini Live socket; `SilentAudio` for the browser audio devices.
 */
import type { Earcon } from '../voice/audio/earcons';
import type { AudioIO, MicError } from '../voice/audio/types';
import type { ToolResult } from '../voice/tools';
import type {
  LiveCallbacks,
  LiveConnection,
  LiveEvent,
  LiveSetup,
  LiveToken,
  LiveToolResponse,
  LiveTransport,
} from '../voice/live/transport';

/** The newest cues the transport keeps: a long scripted demo does not grow the record without a limit. */
const EARCONS_KEPT = 100;

export class ScriptedLiveTransport implements LiveTransport {
  readonly needsToken = false as const;
  /** Every sendText, in order. */
  readonly texts: string[] = [];
  readonly toolResponses: LiveToolResponse[] = [];
  /** The newest cues SilentAudio played (D-156, at most EARCONS_KEPT), oldest first: scripted audio has no speaker. */
  readonly earcons: Earcon[] = [];
  private streamEndCount = 0;
  private audioCount = 0;
  private readonly connectFailures: number[] = [];
  private cb: LiveCallbacks | null = null;
  private live = false;
  private setup: LiveSetup | null = null;
  private nextCallId = 0;
  private micDenial: MicError | null = null;
  /** Whether SilentAudio reports the agent's audio as playing (scripted audio has no duration of its own). */
  private agentPlaying = false;
  private readonly waiting = new Map<string, (result: ToolResult) => void>();

  get streamEnds(): number { return this.streamEndCount; }
  /** Mic chunks sent while connected (counted, never kept). */
  get audioChunks(): number { return this.audioCount; }
  get lastSetup(): LiveSetup | null { return this.setup; }
  get playing(): boolean { return this.agentPlaying; }
  connected(): boolean { return this.live; }

  async connect(_token: LiveToken | null, setup: LiveSetup, cb: LiveCallbacks): Promise<LiveConnection> {
    const failure = this.connectFailures.shift();
    if (failure !== undefined) throw new Error(`Live socket closed before setup completed (code ${failure})`);
    this.setup = setup;
    this.cb = cb;
    this.live = true;
    const open = (): boolean => this.live && this.cb === cb;
    const connection: LiveConnection = {
      sendAudio: () => { if (open()) this.audioCount += 1; },
      sendText: (text) => { if (open()) this.texts.push(text); },
      sendAudioStreamEnd: () => { if (open()) this.streamEndCount += 1; },
      sendToolResponses: (responses) => {
        if (!open()) return;
        for (const r of responses) {
          this.toolResponses.push(r);
          const resolve = r.id === undefined ? undefined : this.waiting.get(r.id);
          if (resolve && r.id !== undefined) {
            this.waiting.delete(r.id);
            resolve(r.result);
          }
        }
      },
      close: () => { if (this.cb === cb) this.live = false; },
    };
    return connection;
  }

  /** Delivers one server event (`audio` defaults to none). Ignored while not connected. */
  emit(event: Partial<LiveEvent>): void {
    if (!this.live) return;
    this.cb?.onEvent({ audio: [], ...event });
  }

  /** Emits one toolCall and resolves with the response the app sends for it. Rejects when nothing is connected (it would never be answered). */
  toolCall(name: string, args: Record<string, unknown> = {}, id?: string): Promise<ToolResult> {
    if (!this.live) return Promise.reject(new Error('not connected'));
    const callId = id ?? `scripted-${++this.nextCallId}`;
    const answer = new Promise<ToolResult>((resolve) => this.waiting.set(callId, resolve));
    this.emit({ toolCalls: [{ id: callId, name, args }] });
    return answer;
  }

  /** Simulates the trainer finishing an utterance (input transcription, finished). */
  speak(text: string): void {
    this.emit({ inputText: text, inputFinished: true });
  }

  /** Simulates the connection dropping (default: abnormal close). */
  drop(code = 1006): void {
    if (!this.live) return;
    this.live = false;
    this.cb?.onClose(code, 'scripted drop');
  }

  goAway(ms: number): void {
    this.emit({ goAwayMs: ms });
  }

  /** The agent's line is playing (true) or has finished (false), until changed or the session's audio closes: the screen and the check texts wait for it (D-148). */
  setPlaying(on: boolean): void {
    this.agentPlaying = on;
  }

  /** Records a cue SilentAudio played, keeping the newest EARCONS_KEPT. */
  recordEarcon(kind: Earcon): void {
    this.earcons.push(kind);
    if (this.earcons.length > EARCONS_KEPT) this.earcons.splice(0, this.earcons.length - EARCONS_KEPT);
  }

  /** The next connect() fails as a socket that closed before setup completed; each call queues one more failure (tests). */
  failNextConnect(code = 1006): void {
    this.connectFailures.push(code);
  }

  /** The next SilentAudio.startMic() on this transport fails with `error` (demo and E2E). */
  denyNextMic(error: MicError): void {
    this.micDenial = error;
  }

  takeMicDenial(): MicError | null {
    const denial = this.micDenial;
    this.micDenial = null;
    return denial;
  }
}

/** AudioIO without devices: startMic succeeds (or fails once with the transport's queued denial), play counts chunks, level 0. */
export class SilentAudio implements AudioIO {
  private played = 0;
  constructor(private readonly transport: ScriptedLiveTransport) {}

  get playedChunks(): number { return this.played; }

  async startMic(_onChunk: (pcm: Int16Array) => void, _onEnded: () => void): Promise<{ readonly ok: true } | { readonly ok: false; readonly error: MicError }> {
    const denial = this.transport.takeMicDenial();
    return denial ? { ok: false, error: denial } : { ok: true };
  }
  setMicEnabled(_on: boolean): void {}
  play(_pcm: Int16Array): void { this.played += 1; }
  flush(): void {}
  /** Playing only while the script says so (setPlaying): scripted audio has no duration, so it never plays by itself. */
  isPlaying(): boolean { return this.transport.playing; }
  /** Recorded on the transport, never over the agent's (scripted) speech, as the browser's cues. */
  earcon(kind: Earcon): boolean {
    if (this.isPlaying()) return false;
    this.transport.recordEarcon(kind);
    return true;
  }
  level(): number { return 0; }
  /** The session's teardown (stop or a lost connection): nothing plays any more, so a playing(true) never outlives it. */
  close(): void { this.transport.setPlaying(false); }
}

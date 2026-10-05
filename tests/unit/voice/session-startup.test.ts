import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveTransport } from '@/services/voice/live/transport';
import { VoiceSession } from '@/services/voice/session';
import { deferred, flush, makeSessionDeps, TestAudio } from './session-harness';

// D-138: the transport module loads while the microphone starts; the token still waits for the microphone.
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type MicResult = Awaited<ReturnType<TestAudio['startMic']>>;

/** TestAudio whose microphone start waits for `mic` (a slow permission prompt). */
function slowMic(h: ReturnType<typeof makeSessionDeps>, mic: Promise<MicResult>) {
  return () => {
    const a = new (class extends TestAudio {
      override async startMic(onChunk: (pcm: Int16Array) => void, onEnded: () => void) {
        await mic;
        return super.startMic(onChunk, onEnded);
      }
    })(h.transport);
    h.audios.push(a);
    return a;
  };
}

describe('VoiceSession start-up (D-138)', () => {
  it('starts the transport load before the microphone resolves, and fetches the token only after it', async () => {
    const tokens = vi.fn(async () => ({ ok: true as const, value: { token: 't', apiVersion: 'v1alpha', model: 'gemini-3.8-live', expiresAt: '2026-10-03T05:00:00.000Z' } }));
    const h = makeSessionDeps({ token: tokens });
    const mic = deferred<MicResult>();
    const transport = vi.fn(h.deps.transport);
    const s = new VoiceSession({ ...h.deps, transport, audio: slowMic(h, mic.promise) });
    s.start();
    await flush();
    expect(transport).toHaveBeenCalled(); // the module download overlaps the microphone start
    expect(tokens).not.toHaveBeenCalled(); // a token must start a session within 60 s: fetched after the mic
    mic.resolve({ ok: true });
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    expect(tokens).toHaveBeenCalledTimes(1);
    expect(h.connects()).toBe(1);
  });

  it('a failed early load is swallowed: the connection loads the transport again and goes live', async () => {
    const h = makeSessionDeps();
    const live = await h.deps.transport();
    const transport = vi.fn<() => Promise<LiveTransport>>().mockRejectedValueOnce(new Error('chunk load failed')).mockResolvedValue(live);
    const s = new VoiceSession({ ...h.deps, transport });
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it('a loader that throws synchronously at the early load is retried by the connection', async () => {
    const h = makeSessionDeps();
    const live = await h.deps.transport();
    let calls = 0;
    const transport = () => {
      calls += 1;
      if (calls === 1) throw new Error('no import()');
      return Promise.resolve(live);
    };
    const s = new VoiceSession({ ...h.deps, transport });
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    expect(calls).toBe(2);
  });

  it('a connection lost before any audio logs no time for the Reconnect that follows', async () => {
    const h = makeSessionDeps();
    const lines: string[] = [];
    const s = new VoiceSession({ ...h.deps, log: (line) => lines.push(line) });
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    h.transport.drop();
    await vi.waitFor(() => expect(s.getState().status).toBe('error'));
    s.reconnect();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    h.transport.emit({ audio: [new Int16Array(480)] });
    expect(lines.filter((l) => l.startsWith('first audio'))).toEqual([]);
  });

  it('does not time audio flushed because its message was interrupted: the first audio played is timed', async () => {
    const h = makeSessionDeps();
    const lines: string[] = [];
    const s = new VoiceSession({ ...h.deps, log: (line) => lines.push(line) });
    const startedAt = Date.now();
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    vi.advanceTimersByTime(800);
    h.transport.emit({ audio: [new Int16Array(480)], interrupted: true }); // the trainer barged in: nothing of it plays
    expect(lines.filter((l) => l.startsWith('first audio'))).toEqual([]);
    vi.advanceTimersByTime(700);
    h.transport.emit({ audio: [new Int16Array(480)] });
    expect(lines.filter((l) => l.startsWith('first audio'))).toEqual([`first audio ${Date.now() - startedAt} ms after start`]);
  });

  it('logs the time to the first model audio once per start, numbers only', async () => {
    const h = makeSessionDeps();
    const lines: string[] = [];
    const s = new VoiceSession({ ...h.deps, log: (line) => lines.push(line) });
    const startedAt = Date.now();
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    vi.advanceTimersByTime(1500);
    h.transport.emit({ audio: [new Int16Array(480)] });
    h.transport.emit({ audio: [new Int16Array(480)] });
    const first = lines.filter((l) => l.startsWith('first audio'));
    expect(first).toHaveLength(1);
    const ms = Number(/^first audio (\d+) ms after start$/.exec(first[0])?.[1]);
    expect(ms).toBeGreaterThanOrEqual(1500);
    expect(ms).toBe(Date.now() - startedAt);

    s.stop();
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    h.transport.emit({ audio: [new Int16Array(480)] });
    expect(lines.filter((l) => l.startsWith('first audio'))).toHaveLength(2);
  });
});

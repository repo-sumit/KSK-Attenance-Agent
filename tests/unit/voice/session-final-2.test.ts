/**
 * VoiceSession, final follow-ups (task-final-executor-2): a returning trainer gets the full idle window (S1), the
 * Reconnect kickoff waits for the screen hooks queued before it (S2), no agent captions while paused (S3), and screen
 * hooks run quiet while the session would drop their text (E1).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolResult } from '@/services/voice/executor';
import { VoiceSession } from '@/services/voice/session';
import { deferred, flush, KEY, makeSessionDeps, OK } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const status = (s: VoiceSession) => s.getState().status;

async function live() {
  const h = makeSessionDeps();
  const s = new VoiceSession(h.deps);
  s.start();
  await vi.waitFor(() => expect(status(s)).toBe('listening'));
  return { h, s };
}

describe('a trainer returning to a session the hidden page paused (S1)', () => {
  it('coming back counts as activity: voice is not cut off seconds later, and still ends after a full idle window', async () => {
    const { s } = await live();
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(s)).toBe('paused');
    await vi.advanceTimersByTimeAsync(95_000); // 115 s idle in all: 5 s before the cap
    s.setHidden(false);
    await vi.advanceTimersByTimeAsync(100_000);
    expect(s.getState()).toMatchObject({ status: 'paused', error: null }); // not ended at the old 120 s mark
    await vi.advanceTimersByTimeAsync(30_000); // a full 120 s after coming back, then the 4 s goodbye
    expect(s.getState()).toMatchObject({ status: 'error', error: 'idle' });
  });
});

describe('the Reconnect kickoff after queued screen hooks (S2)', () => {
  it('a screen hook queued while Reconnect showed, waiting behind a slow call, runs before the kickoff that reads it', async () => {
    const { h, s } = await live();
    h.executor.kickoff = async (kind): Promise<string> => (kind === 'start' ? '[APP] Session started.' : `[APP] Reconnected after ${h.executor.screens.length} screen(s).`);
    const gate = deferred<ToolResult>();
    h.executor.respond(() => gate.promise);
    h.transport.emit({ toolCalls: [{ id: 'slow', name: 'get_status', args: {} }] });
    await flush();
    h.transport.drop();
    s.onScreen({ kind: 'mark', sessionKey: KEY }); // waits behind the running call
    s.reconnect();
    await vi.advanceTimersByTimeAsync(100); // the new connection is open; the kickoff waits on the queue
    expect(status(s)).toBe('reconnecting');
    expect(h.executor.screens).toEqual([]);
    gate.resolve(OK);
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.executor.screens).toEqual([{ kind: 'mark', sessionKey: KEY }]);
    expect(h.transport.texts.at(-1)).toBe('[APP] Reconnected after 1 screen(s).');
  });
});

describe('Pause shows none of the agent words it does not play (S3)', () => {
  it('agent captions are dropped while paused and shown again after Resume', async () => {
    const { h, s } = await live();
    h.transport.emit({ outputText: 'Aarav?', turnComplete: true });
    s.pause();
    h.transport.emit({ audio: [new Int16Array(4)], outputText: 'Okay, I will wait.' });
    h.transport.emit({ turnComplete: true });
    expect(s.getState().captions).toEqual([{ who: 'agent', text: 'Aarav?', final: true }]);
    s.resume();
    h.transport.emit({ outputText: 'Welcome back.' });
    expect(s.getState().captions.at(-1)).toEqual({ who: 'agent', text: 'Welcome back.', final: false });
  });
});

describe('screen hooks run quiet while their text would be dropped (E1)', () => {
  it('paused: the executor is told quiet; live again: not quiet', async () => {
    const { h, s } = await live();
    s.pause();
    s.onScreen({ kind: 'mark', sessionKey: KEY });
    await flush();
    s.resume();
    s.onScreen({ kind: 'review', sessionKey: KEY });
    await flush();
    expect(h.executor.quiets).toEqual([true, false]);
  });
});

describe('debug lines for pauses and barge-ins (D-158): ids and codes only', () => {
  it('logs interrupted, pause (user), resume (tap) and pause (hidden)', async () => {
    const h = makeSessionDeps();
    const lines: string[] = [];
    const s = new VoiceSession({ ...h.deps, log: (line) => lines.push(line) });
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    lines.length = 0;
    h.transport.emit({ interrupted: true });
    s.pause();
    s.resume();
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(lines).toEqual(['interrupted', 'pause (user)', 'resume (tap)', 'pause (hidden)']);
  });
});

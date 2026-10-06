/**
 * VoiceSession, final fix wave (task-final-session): the spoke-after-the-question counters (F4), the idle clock
 * with Pause, a hidden page, taps, screens and verification (F5), hooks while Reconnect shows (F6), quiet
 * audio while paused (m8), the consecutive connect-failure stop (m9), and the PAUSE_EVENT a swap held (C2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkConfirm, issueConfirm, type ConfirmNow, type ConfirmTicket } from '@/domain/voice/confirm';
import type { Result } from '@/lib/result';
import { limitEvent, PAUSE_EVENT, RECONNECT_EVENT } from '@/services/voice/app-events';
import type { ToolResult } from '@/services/voice/executor';
import type { TokenError } from '@/services/voice/live/token-client';
import type { LiveToken } from '@/services/voice/live/transport';
import { VoiceSession } from '@/services/voice/session';
import { deferred, flush, KEY, makeSessionDeps, OK, type HarnessOptions } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const status = (s: VoiceSession) => s.getState().status;
const CAMERA = { kind: 'session' as const, key: KEY };

async function live(o?: HarnessOptions) {
  const h = makeSessionDeps(o);
  const s = new VoiceSession(h.deps);
  s.start();
  await vi.waitFor(() => expect(status(s)).toBe('listening'));
  return { h, s };
}

/**
 * The executor's confirmation rule with the real issueConfirm/checkConfirm and the session's live counters:
 * mark_attendance issues the submit code (as the last mark does since Task 23), submit_attendance checks it.
 */
function confirmingExecutor(h: ReturnType<typeof makeSessionDeps>, s: VoiceSession) {
  let ticket: ConfirmTicket | null = null;
  const now = (): ConfirmNow => ({
    action: 'submit_attendance', argsKey: KEY, revision: 1, now: 0, generation: s.generation(),
    speechSeq: s.speechSeq(), turnSeq: s.turnSeq(), spokeAtTurn: s.spokeAtTurn(),
  });
  h.executor.respond((call): ToolResult => {
    if (call.name === 'mark_attendance') {
      ticket = issueConfirm(now(), [0.1, 0.2, 0.3, 0.4]);
      return { ok: true, confirm_token: ticket.token, instruction: `Ask whether to submit with confirm_token "${ticket.token}".` };
    }
    const check = checkConfirm(ticket, call.args?.confirm_token, now());
    return check.ok ? { ok: true, instruction: 'Submitted.' } : { ok: false, error: 'NEEDS_CONFIRMATION', reason: check.reason, instruction: 'Ask again.' };
  });
  return { token: () => ticket?.token };
}

describe('the trainer spoke after the question (F4, D-082)', () => {
  it('late fragments of the words that led to the code do not count; a new trainer turn after the asking turn does', async () => {
    const { h, s } = await live();
    const ex = confirmingExecutor(h, s);
    h.transport.emit({ inputText: 'Rahul' });
    h.transport.emit({ toolCalls: [{ id: 'm', name: 'mark_attendance', args: { student_id: 'S1', status: 'ABSENT' } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    h.transport.emit({ inputText: ' absent', inputFinished: true }); // late: the Live API does not order it against the toolCall
    h.transport.emit({ toolCalls: [{ id: 'x', name: 'submit_attendance', args: { confirm_token: ex.token() } }] }); // same turn
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(2));
    expect(h.transport.toolResponses[1].result).toMatchObject({ ok: false, reason: 'not_heard' });

    h.transport.emit({ outputText: 'Submit now?', turnComplete: true }); // the asking turn ends
    h.transport.speak('haan');
    h.transport.emit({ toolCalls: [{ id: 'y', name: 'submit_attendance', args: { confirm_token: ex.token() } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(3));
    expect(h.transport.toolResponses[2].result).toMatchObject({ ok: true });
  });

  it('a whole late transcript of those words counts as a trainer turn, but not as one after the question', async () => {
    const { h, s } = await live();
    const ex = confirmingExecutor(h, s);
    h.transport.emit({ outputText: 'Next?', turnComplete: true });
    h.transport.emit({ toolCalls: [{ id: 'm', name: 'mark_attendance', args: {} }] }); // the trainer's words, heard before transcribed
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    h.transport.speak('Rahul absent'); // their transcript, after the code
    h.transport.emit({ outputText: 'Submit now?', turnComplete: true });
    // a model turn without trainer speech since the question (an [APP] text, say) cannot confirm
    h.transport.emit({ toolCalls: [{ id: 'x', name: 'submit_attendance', args: { confirm_token: ex.token() } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(2));
    expect(h.transport.toolResponses[1].result).toMatchObject({ ok: false, reason: 'not_heard' });
    h.transport.emit({ turnComplete: true });
    h.transport.speak('haan');
    h.transport.emit({ toolCalls: [{ id: 'y', name: 'submit_attendance', args: { confirm_token: ex.token() } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(3));
    expect(h.transport.toolResponses[2].result).toMatchObject({ ok: true });
  });

  it('counts one trainer turn per utterance, and an interruption ends the model turn', async () => {
    const { h, s } = await live();
    h.transport.emit({ inputText: 'Rahul' });
    h.transport.emit({ inputText: ' absent' });
    h.transport.emit({ inputFinished: true });
    expect({ speech: s.speechSeq(), turns: s.turnSeq() }).toEqual({ speech: 1, turns: 0 });
    h.transport.emit({ audio: [new Int16Array(4)], turnComplete: true });
    h.transport.emit({ inputFinished: true }); // a bare finished flag is no words
    expect(s.speechSeq()).toBe(1);
    h.transport.emit({ audio: [new Int16Array(4)] });
    h.transport.emit({ interrupted: true, inputText: 'ruko' }); // the trainer barged in: the model's turn is over first
    expect({ speech: s.speechSeq(), turns: s.turnSeq(), at: s.spokeAtTurn() }).toEqual({ speech: 2, turns: 2, at: 2 });
  });
});

describe('the idle clock (F5)', () => {
  it('Pause on a visible page holds it: 125 s paused stays paused, and the clock runs again after Resume', async () => {
    const { h, s } = await live();
    s.pause();
    await vi.advanceTimersByTimeAsync(125_000);
    expect(s.getState()).toMatchObject({ status: 'paused', error: null });
    s.resume();
    await vi.advanceTimersByTimeAsync(115_000);
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(7000);
    expect(h.transport.texts.at(-1)).toBe(limitEvent('idle'));
  });

  it('a pause caused by a hidden page keeps it running: a backgrounded app ends voice after the idle time', async () => {
    const { s } = await live();
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(s)).toBe('paused');
    await vi.advanceTimersByTimeAsync(104_000); // 120 s idle, then the 4 s goodbye
    expect(s.getState()).toMatchObject({ status: 'error', error: 'idle', canReconnect: false });
  });

  it('Pause while the page is hidden is not held either', async () => {
    const { s } = await live();
    s.pause();
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(124_000);
    expect(s.getState()).toMatchObject({ status: 'error', error: 'idle' });
  });

  it('taps, screens and verification events are activity; a quiet session still stops', async () => {
    const { h, s } = await live();
    h.openDraft();
    const ids = ['S1', 'S2', 'S3'];
    for (let n = 0; n < 13; n++) {
      await vi.advanceTimersByTimeAsync(10_000);
      h.drafts.setMark(KEY, ids[n % 3], { status: n % 2 ? 'present' : 'absent' }, { via: 'tap' });
    }
    expect(s.getState()).toMatchObject({ status: 'listening', error: null }); // 130 s of taps
    await vi.advanceTimersByTimeAsync(100_000);
    s.onScreen({ kind: 'other' });
    await vi.advanceTimersByTimeAsync(100_000);
    h.verification.notify(CAMERA, 'confirm_location');
    await vi.advanceTimersByTimeAsync(100_000);
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(22_000);
    expect(h.transport.texts.at(-1)).toBe(limitEvent('idle'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(s.getState().error).toBe('idle');
  });
});

describe('while Reconnect shows (F6)', () => {
  it('screen and verification signals reach the executor; nothing is said until the reconnect kickoff', async () => {
    const { h, s } = await live();
    h.transport.drop();
    expect(s.getState()).toMatchObject({ status: 'error', error: 'dropped', canReconnect: true });
    const texts = h.transport.texts.length;
    s.onScreen({ kind: 'mark', sessionKey: 'other' });
    s.onScreen({ kind: 'home' });
    h.verification.faceCheckFailed(CAMERA);
    await flush();
    expect(h.executor.screens).toEqual([{ kind: 'mark', sessionKey: 'other' }, { kind: 'home' }]);
    expect(h.executor.verifications.map((e) => e.type)).toEqual(['face']);
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    await flush();
    expect(h.transport.texts.slice(texts)).toEqual([RECONNECT_EVENT]); // neither '[APP] Home.' nor '[APP] Face.'
  });

  it('a signal queued in the error state still runs when Reconnect is tapped before it starts', async () => {
    const { h, s } = await live();
    const gate = deferred<ToolResult>();
    h.executor.respond(() => gate.promise);
    h.transport.emit({ toolCalls: [{ id: 'slow', name: 'get_status', args: {} }] });
    await flush();
    h.transport.drop();
    s.onScreen({ kind: 'mark', sessionKey: 'other' }); // waits behind the running call
    s.reconnect();
    gate.resolve(OK);
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    await vi.waitFor(() => expect(h.executor.screens).toEqual([{ kind: 'mark', sessionKey: 'other' }]));
  });

  it('after a stop, signals no longer reach the executor', async () => {
    const { h, s } = await live({ limits: { idleSeconds: 5 } });
    await vi.advanceTimersByTimeAsync(9000);
    expect(s.getState().error).toBe('idle');
    s.onScreen({ kind: 'home' });
    await flush();
    expect(h.executor.screens).toEqual([]);
  });
});

describe('Pause keeps the agent quiet (m8)', () => {
  it('plays no audio that arrives while paused, and plays again after Resume', async () => {
    const { h, s } = await live();
    h.transport.emit({ audio: [new Int16Array(4)] });
    expect(h.audio.playedChunks).toBe(1);
    s.pause();
    h.transport.emit({ audio: [new Int16Array(4), new Int16Array(4)], outputText: 'Okay' });
    expect(h.audio.playedChunks).toBe(1);
    expect(status(s)).toBe('paused');
    s.resume();
    h.transport.emit({ audio: [new Int16Array(4)] });
    expect(h.audio.playedChunks).toBe(2);
  });
});

describe('failed connects in a row (m9)', () => {
  it('the third failed connect in a row stops voice with failures instead of offering Reconnect again', async () => {
    const h = makeSessionDeps();
    const s = new VoiceSession(h.deps);
    for (let n = 0; n < 3; n++) h.transport.failNextConnect();
    s.start();
    await vi.waitFor(() => expect(s.getState()).toMatchObject({ error: 'connect_failed', canReconnect: true }));
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('error'));
    expect(s.getState()).toMatchObject({ error: 'connect_failed', canReconnect: true });
    s.reconnect();
    await vi.waitFor(() => expect(s.getState()).toMatchObject({ status: 'error', error: 'failures', canReconnect: false }));
    expect(h.connects()).toBe(3);
  });

  it('a connection in between starts the count again, and so does a new start', async () => {
    const h = makeSessionDeps();
    const s = new VoiceSession(h.deps);
    h.transport.failNextConnect();
    h.transport.failNextConnect();
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('error'));
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('error'));
    s.reconnect(); // the third try connects
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    h.transport.drop();
    h.transport.failNextConnect();
    h.transport.failNextConnect();
    s.reconnect();
    await vi.waitFor(() => expect(s.getState().error).toBe('connect_failed'));
    s.reconnect();
    await vi.waitFor(() => expect(s.getState()).toMatchObject({ error: 'connect_failed', canReconnect: true }));
    s.stop();
    h.transport.failNextConnect();
    s.start();
    await vi.waitFor(() => expect(s.getState()).toMatchObject({ error: 'connect_failed', canReconnect: true }));
  });
});

describe('a PAUSE_EVENT a goAway swap held (C2)', () => {
  it('a pause while the refresh is built: the new connection gets PAUSE_EVENT, not the refresh', async () => {
    const { h, s } = await live();
    const built = deferred<string>();
    h.executor.refreshWith(() => built.promise);
    h.transport.goAway(10_000);
    await vi.waitFor(() => expect(h.executor.refreshes).toHaveLength(1));
    s.pause();
    const texts = h.transport.texts.length;
    built.resolve('[APP] Refreshed.');
    await flush();
    expect(h.transport.texts.slice(texts)).toEqual([PAUSE_EVENT]);
    expect(status(s)).toBe('paused');
  });

  it('a pause while the swap waits for its token: the new connection gets PAUSE_EVENT', async () => {
    const gate = deferred<Result<LiveToken, TokenError>>();
    let calls = 0;
    const good = { ok: true as const, value: { token: 't', apiVersion: 'v1alpha', model: 'gemini-3.8-live', expiresAt: '' } };
    const { h, s } = await live({ token: () => (calls++ === 0 ? Promise.resolve(good) : gate.promise) });
    h.transport.goAway(10_000); // quiet: the swap starts at once and waits for the token
    await flush();
    s.pause(); // held by the swap: it reaches no connection
    const texts = h.transport.texts.length;
    gate.resolve(good);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await flush();
    expect(h.transport.texts.slice(texts)).toEqual([PAUSE_EVENT]);
    expect(h.executor.refreshes).toEqual([]);
    expect(status(s)).toBe('paused');
  });
});

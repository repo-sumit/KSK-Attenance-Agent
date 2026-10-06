import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Result } from '@/lib/result';
import { RECONNECT_EVENT, RESUME_EVENT, limitEvent } from '@/services/voice/app-events';
import { INTERNAL_RESULT, type ToolResult } from '@/services/voice/executor';
import type { TokenError } from '@/services/voice/live/token-client';
import type { LiveToken } from '@/services/voice/live/transport';
import { VoiceSession } from '@/services/voice/session';
import { deferred, flush, KEY, makeSessionDeps, OK, type HarnessOptions } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function live(o?: HarnessOptions) {
  const h = makeSessionDeps(o);
  const s = new VoiceSession(h.deps);
  s.start();
  await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
  return { h, s };
}
const status = (s: VoiceSession) => s.getState().status;

describe('VoiceSession', () => {
  it('connects, sends the kickoff and listens; a second start is a no-op', async () => {
    const h = makeSessionDeps();
    const s = new VoiceSession(h.deps);
    s.start();
    s.start();
    expect(s.getState().status).toBe('connecting');
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    expect(h.transport.texts).toEqual(['[APP] Session started.']);
    expect(h.connects()).toBe(1);
  });

  it('answers one toolCall in the model order with one response, after running in toolCallOrder', async () => {
    const h = makeSessionDeps();
    const s = new VoiceSession(h.deps);
    s.start();
    await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
    h.transport.emit({ toolCalls: [ { id: 'a', name: 'mark_remaining', args: { status: 'PRESENT' } }, { id: 'b', name: 'set_student_status', args: { student: 'x', status: 'ABSENT' } } ] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(2));
    expect(h.executor.calls.map((c) => c.name)).toEqual(['set_student_status', 'mark_remaining']);
    expect(h.transport.toolResponses.map((r) => r.id)).toEqual(['a', 'b']);
  });

  it('starts the calls of a second toolCall message only after the first message was answered', async () => {
    const { h } = await live();
    const gate = deferred<ToolResult>();
    const seen: string[] = [];
    h.executor.respond((call) => {
      seen.push(`${call.id} after [${h.transport.toolResponses.map((r) => r.id).join()}]`);
      return call.id === 'a' ? gate.promise : OK;
    });
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'get_status', args: {} }] });
    h.transport.emit({ toolCalls: [{ id: 'c', name: 'get_status', args: {} }] });
    await flush();
    expect(seen).toEqual(['a after []']);
    gate.resolve(OK);
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(2));
    expect(seen).toEqual(['a after []', 'c after [a]']);
  });

  it('skips a call cancelled before it starts and keeps, but does not answer, one cancelled while running', async () => {
    const { h } = await live();
    const gate = deferred<ToolResult>();
    h.executor.respond((call) => (call.id === 'a' ? gate.promise : OK));
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'submit_attendance', args: {} }, { id: 'b', name: 'get_status', args: {} }] });
    h.transport.emit({ toolCalls: [{ id: 'c', name: 'get_status', args: {} }] });
    await flush();
    h.transport.emit({ cancelledIds: ['a', 'b'] });
    gate.resolve(OK);
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    expect(h.executor.calls.map((c) => c.id)).toEqual(['a', 'c']);
    expect(h.transport.toolResponses.map((r) => r.id)).toEqual(['c']);
  });

  it('maps start failures: mic denied (no connect), token 503 and 429, offline, the daily cap, a token that never comes', async () => {
    const fail = async (o: HarnessOptions, before?: (h: ReturnType<typeof makeSessionDeps>) => void) => {
      const h = makeSessionDeps(o);
      before?.(h);
      const s = new VoiceSession(h.deps);
      s.start();
      await vi.waitFor(() => expect(status(s)).toBe('error'));
      return { error: s.getState().error, canReconnect: s.getState().canReconnect, connects: h.connects(), closed: h.audio.closed };
    };
    expect(await fail({}, (h) => h.transport.denyNextMic('permission_denied'))).toEqual({ error: 'mic_denied', canReconnect: false, connects: 0, closed: 1 });
    expect((await fail({}, (h) => h.transport.denyNextMic('not_found'))).error).toBe('mic_unavailable');
    expect((await fail({ tokenStatus: 503 })).error).toBe('unavailable');
    expect((await fail({ tokenStatus: 429 })).error).toBe('rate_limited');
    expect((await fail({}, (h) => h.setOnline(false))).error).toBe('offline');
    expect((await fail({ usedSeconds: 3600 })).error).toBe('daily_limit');
    const h = makeSessionDeps({ token: () => new Promise(() => undefined) });
    const s = new VoiceSession(h.deps);
    s.start();
    await vi.advanceTimersByTimeAsync(7_900);
    expect(status(s)).toBe('connecting');
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(s.getState().error).toBe('unavailable'));
  });

  it('stops as unsupported, without throwing or connecting, when no AudioContext can be made', () => {
    const h = makeSessionDeps();
    const s = new VoiceSession({ ...h.deps, audio: () => { throw new Error('NotSupportedError'); } });
    expect(() => s.start()).not.toThrow();
    expect(s.getState()).toMatchObject({ status: 'error', error: 'unsupported', canReconnect: false });
    expect(h.connects()).toBe(0);
  });

  it('drops mic chunks until live, then streams them', async () => {
    const token = deferred<Result<LiveToken, TokenError>>();
    const h = makeSessionDeps({ token: () => token.promise });
    const s = new VoiceSession(h.deps);
    s.start();
    await flush();
    h.audio.chunk();
    token.resolve({ ok: true, value: { token: 't', apiVersion: 'v1alpha', model: 'gemini-3.8-live', expiresAt: '' } });
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.transport.audioChunks).toBe(0);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(1);
  });

  it('a connect failure offers Reconnect; reconnect falls back to no handle when resuming fails', async () => {
    const h = makeSessionDeps();
    h.transport.failNextConnect();
    const s = new VoiceSession(h.deps);
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('error'));
    expect(s.getState()).toMatchObject({ error: 'connect_failed', canReconnect: true });
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    h.transport.drop();
    h.transport.failNextConnect(1011);
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.connects()).toBe(4);
    expect(h.transport.lastSetup?.resumeHandle).toBeUndefined();
    expect(h.transport.texts.at(-1)).toBe(RECONNECT_EVENT);
  });

  it('flushes on interrupted and plays none of that message', async () => {
    const { h } = await live();
    h.transport.emit({ interrupted: true, audio: [new Int16Array(4)], outputText: 'Ra' });
    expect(h.audio.flushed).toBe(1);
    expect(h.audio.playedChunks).toBe(0);
    h.transport.emit({ audio: [new Int16Array(4), new Int16Array(4)] });
    expect(h.audio.playedChunks).toBe(2);
  });

  it('routes captions, counts trainer speech and keeps focus from focus_student', async () => {
    const { h, s } = await live();
    h.transport.emit({ inputText: 'Rahul', outputText: 'Okay' });
    h.transport.speak(' absent');
    expect(s.getState().captions).toEqual([
      { who: 'trainer', text: 'Rahul absent', final: true },
      { who: 'agent', text: 'Okay', final: false },
    ]);
    expect(s.speechSeq()).toBe(1); // one trainer turn, however many fragments (final fix F4)
    h.bus.emit({ type: 'focus_student', sessionKey: KEY, studentId: 'S2' });
    expect(s.getState().focus).toEqual({ sessionKey: KEY, studentId: 'S2', seq: expect.any(Number) });
  });

  it('is speaking only while audio plays', async () => {
    const { h, s } = await live();
    h.audio.playing = true;
    h.transport.emit({ audio: [new Int16Array(4)], outputText: 'Rahul?' });
    expect(status(s)).toBe('speaking');
    h.audio.playing = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('listening');
  });

  it('sends the text of a tap on the shared draft', async () => {
    const { h } = await live();
    h.openDraft();
    h.drafts.setMark(KEY, 'S1', { status: 'absent' }, { via: 'tap' });
    expect(h.transport.texts.at(-1)).toBe('[APP] Tapped S1');
  });

  it('turns the mic off while the face camera is on; sends verification and screen texts through the queue', async () => {
    const { h, s } = await live();
    h.verification.cameraActive({ kind: 'session', key: KEY }, true);
    expect(h.audio.micEnabled.at(-1)).toBe(false);
    h.verification.cameraActive({ kind: 'session', key: KEY }, false);
    expect(h.audio.micEnabled.at(-1)).toBe(true);
    s.onScreen({ kind: 'home' });
    await vi.waitFor(() => expect(h.transport.texts.at(-1)).toBe('[APP] Home.'));
    expect(h.executor.verifications.map((e) => e.type)).toEqual(['camera', 'camera']);
  });

  it('a drop offers Reconnect; reconnect resumes with the handle, says Reconnected and voids confirmations', async () => {
    const { h, s } = await live();
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    const first = h.audio;
    h.transport.drop();
    expect(s.getState()).toMatchObject({ status: 'error', error: 'dropped', canReconnect: true });
    expect(first.closed).toBe(1);
    s.reconnect();
    expect(status(s)).toBe('reconnecting');
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.audios).toHaveLength(2);
    expect(h.transport.lastSetup?.resumeHandle).toBe('h-1');
    expect(h.transport.texts.at(-1)).toBe(RECONNECT_EVENT);
    expect(h.executor.voids).toBe(2);
    expect(s.generation()).toBe(2);
  });

  it('a question pending when the connection drops reaches the Reconnect kickoff (asked again with a new code there)', async () => {
    const { h, s } = await live();
    h.executor.respond(() => ({ ok: false, error: 'NEEDS_CONFIRMATION', confirm_token: 'AB23', instruction: 'Ask: mark Pradeep absent? confirm_token "AB23"' }));
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'mark_staff', args: { staff: 'Pradeep', status: 'ABSENT' } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    h.transport.drop();
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.executor.kickoffs).toEqual([null, 'Ask: mark Pradeep absent? confirm_token "AB23"']);
  });

  it('goAway at a quiet moment swaps connections: two connects, the refresh text, generation 2', async () => {
    const { h, s } = await live();
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    h.transport.goAway(5000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await vi.waitFor(() => expect(h.transport.texts.at(-1)).toBe('[APP] Refreshed.'));
    expect(h.connects()).toBe(2);
    expect(h.transport.lastSetup?.resumeHandle).toBe('h-1');
    expect(h.executor.voids).toBe(2);
    expect(h.audios).toHaveLength(1);
    expect(status(s)).toBe('listening');
  });

  it('goAway while the trainer is mid-turn swaps at the deadline and asks the pending question again', async () => {
    const { h, s } = await live();
    h.executor.respond(() => ({ ok: false, error: 'NEEDS_CONFIRMATION', instruction: 'Ask: mark 20 present?' }));
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'mark_remaining', args: { status: 'PRESENT' } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    h.transport.emit({ turnComplete: true });
    h.transport.emit({ inputText: 'haan' });
    h.transport.goAway(5000);
    await vi.advanceTimersByTimeAsync(2400);
    expect(h.connects()).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await vi.waitFor(() => expect(h.executor.refreshes).toEqual(['Ask: mark 20 present?']));
  });

  it('stops after 5 failures in a row, and after more than 40 calls in a minute', async () => {
    const a = await live();
    a.h.executor.respond(() => ({ ...INTERNAL_RESULT }));
    a.h.transport.emit({ toolCalls: [1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, name: 'get_status', args: {} })) });
    await vi.waitFor(() => expect(a.s.getState().error).toBe('failures'));
    const b = await live();
    for (let n = 0; n < 41; n++) b.h.transport.emit({ toolCalls: [{ id: `r${n}`, name: 'get_status', args: {} }] });
    await vi.waitFor(() => expect(b.s.getState().error).toBe('failures'));
    expect(b.h.transport.toolResponses).toHaveLength(40);
  });

  it('at the idle cap says the limit line, then stops 4 s later', async () => {
    const { h, s } = await live({ limits: { idleSeconds: 30 } });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(h.transport.texts.at(-1)).toBe(limitEvent('idle'));
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.getState()).toMatchObject({ status: 'error', error: 'idle', canReconnect: false });
  });

  it('end_voice_session ends after the turn completes; stop() sends audioStreamEnd and closes the audio', async () => {
    const a = await live();
    a.h.transport.emit({ toolCalls: [{ id: 'e', name: 'end_voice_session', args: {} }] });
    await vi.waitFor(() => expect(a.h.transport.toolResponses).toHaveLength(1));
    expect(status(a.s)).toBe('listening');
    a.h.transport.emit({ outputText: 'Bye', turnComplete: true });
    expect(status(a.s)).toBe('ended');
    const b = await live();
    b.s.stop();
    expect(b.s.getState()).toMatchObject({ status: 'ended', error: null });
    expect(b.h.transport.streamEnds).toBe(1);
    expect(b.h.audio.closed).toBe(1);
    expect(b.h.transport.connected()).toBe(false);
  });

  it('push-to-talk: chunks only while talk(true); talk(false) sends audioStreamEnd', async () => {
    const { h, s } = await live();
    s.setPushToTalk(true);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(0);
    s.talk(true);
    h.audio.chunk();
    h.audio.chunk();
    const ends = h.transport.streamEnds;
    s.talk(false);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(2);
    expect(h.transport.streamEnds).toBe(ends + 1);
  });

  it('Resume sends the executor\'s own resume text (the principal has no student to continue from)', async () => {
    const { h, s } = await live();
    h.executor.resumeText = () => '[APP] The trainer is back from the screen.';
    s.pause();
    s.resume();
    expect(h.transport.texts.at(-1)).toBe('[APP] The trainer is back from the screen.');
  });

  it('Pause (mic off, stream end, quiet line); Resume continues; 20 s hidden pauses', async () => {
    const { h, s } = await live();
    s.pause();
    expect(s.getState().status).toBe('paused');
    expect(h.audio.micEnabled.at(-1)).toBe(false);
    expect(h.transport.streamEnds).toBe(1);
    expect(h.transport.texts.at(-1)).toBe('[APP] The trainer is using the screen. Say nothing until the next [APP] message.');
    s.resume();
    expect(status(s)).toBe('listening');
    expect(h.audio.micEnabled.at(-1)).toBe(true);
    expect(h.transport.texts.at(-1)).toBe(RESUME_EVENT); // the executor's resume text (the stub's: the marking executor's)
    s.setHidden(true);
    expect(h.transport.streamEnds).toBe(2);
    await vi.advanceTimersByTimeAsync(19_000);
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('paused');
  });

  it('stops when the network goes', async () => {
    const { h, s } = await live();
    h.setOnline(false);
    expect(s.getState()).toMatchObject({ status: 'error', error: 'offline' });
  });
});

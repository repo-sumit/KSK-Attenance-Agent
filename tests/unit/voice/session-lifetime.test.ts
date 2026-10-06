/**
 * VoiceSession lifetime: what must not outlive a stop (the camera flag, tool-runner state, timers, queued calls),
 * what a goAway swap does in detail (order, chunk cap and pre-roll, token failure, close after goAway, paused),
 * and the caps and mic gates the main session tests do not reach.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { err, ok, type Result } from '@/lib/result';
import { limitEvent, PAUSE_EVENT } from '@/services/voice/app-events';
import { INTERNAL_RESULT, type ToolResult } from '@/services/voice/executor';
import type { TokenError } from '@/services/voice/live/token-client';
import type { LiveToken } from '@/services/voice/live/transport';
import { VoiceSession } from '@/services/voice/session';
import { deferred, flush, KEY, makeSessionDeps, OK, type HarnessOptions } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

type Token = Result<LiveToken, TokenError>;
const GOOD: Token = ok({ token: 't', apiVersion: 'v1alpha', model: 'gemini-3.8-live', expiresAt: '' });
const CAMERA = { kind: 'session' as const, key: KEY };
const status = (s: VoiceSession) => s.getState().status;

/** A token function that answers with each step in turn (the last one repeats). */
function tokens(...steps: (Token | Promise<Token>)[]): () => Promise<Token> {
  let i = 0;
  return () => Promise.resolve(steps[Math.min(i++, steps.length - 1)]);
}

async function live(o?: HarnessOptions) {
  const h = makeSessionDeps(o);
  const s = new VoiceSession(h.deps);
  s.start();
  await vi.waitFor(() => expect(status(s)).toBe('listening'));
  return { h, s };
}

async function restart(s: VoiceSession) {
  s.start();
  await vi.waitFor(() => expect(status(s)).toBe('listening'));
}

describe('what does not outlive a stop', () => {
  it('a camera that went off while stopped does not keep the mic muted after a restart', async () => {
    const { h, s } = await live();
    h.verification.cameraActive(CAMERA, true);
    expect(h.audio.micEnabled.at(-1)).toBe(false);
    s.stop();
    h.verification.cameraActive(CAMERA, false);
    await restart(s);
    expect(h.audio.micEnabled).not.toContain(false);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(1);
  });

  it('a session that starts while the face camera is already on keeps the mic off until it closes', async () => {
    const h = makeSessionDeps();
    const s = new VoiceSession(h.deps);
    h.verification.cameraActive(CAMERA, true);
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.audio.micEnabled).toEqual([false]);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(0);
    h.verification.cameraActive(CAMERA, false);
    expect(h.audio.micEnabled).toEqual([false, true]);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(1);
  });

  it('two cameras: the mic returns only when both are off', async () => {
    const { h } = await live();
    h.verification.cameraActive(CAMERA, true);
    h.verification.cameraActive({ kind: 'self' }, true);
    h.verification.cameraActive(CAMERA, false);
    expect(h.audio.micEnabled).toEqual([false]);
    h.verification.cameraActive({ kind: 'self' }, false);
    expect(h.audio.micEnabled).toEqual([false, true]);
  });

  it('a camera closing does not unmute a paused session or a released push-to-talk', async () => {
    const a = await live();
    a.h.verification.cameraActive(CAMERA, true);
    a.s.pause();
    a.h.verification.cameraActive(CAMERA, false);
    expect(a.h.audio.micEnabled).toEqual([false]);
    a.s.resume();
    expect(a.h.audio.micEnabled).toEqual([false, true]);

    const b = await live();
    b.s.setPushToTalk(true);
    b.h.verification.cameraActive(CAMERA, true);
    b.h.verification.cameraActive(CAMERA, false);
    expect(b.h.audio.micEnabled).toEqual([false]);
    b.s.talk(true);
    expect(b.h.audio.micEnabled).toEqual([false, true]);
  });

  it('a restart starts the tool runner afresh: the rate window, failures in a row and the pending question', async () => {
    const a = await live();
    for (let n = 0; n < 41; n++) a.h.transport.emit({ toolCalls: [{ id: `r${n}`, name: 'get_status', args: {} }] });
    await vi.waitFor(() => expect(a.s.getState().error).toBe('failures'));
    await restart(a.s);
    const before = a.h.transport.toolResponses.length;
    a.h.transport.emit({ toolCalls: [{ id: 'again', name: 'get_status', args: {} }] });
    await vi.waitFor(() => expect(a.h.transport.toolResponses).toHaveLength(before + 1));
    expect(status(a.s)).toBe('listening');

    const b = await live();
    b.h.executor.respond(() => ({ ...INTERNAL_RESULT }));
    b.h.transport.emit({ toolCalls: [1, 2, 3, 4, 5].map((n) => ({ id: `f${n}`, name: 'get_status', args: {} })) });
    await vi.waitFor(() => expect(b.s.getState().error).toBe('failures'));
    await restart(b.s);
    const sent = b.h.transport.toolResponses.length;
    b.h.transport.emit({ toolCalls: [{ id: 'one', name: 'get_status', args: {} }] });
    await vi.waitFor(() => expect(b.h.transport.toolResponses).toHaveLength(sent + 1));
    expect(status(b.s)).toBe('listening');

    const c = await live();
    c.h.executor.respond(() => ({ ok: false, error: 'NEEDS_CONFIRMATION', instruction: 'Ask: mark 20 present?' }));
    c.h.transport.emit({ toolCalls: [{ id: 'q', name: 'mark_remaining', args: { status: 'PRESENT' } }] });
    await vi.waitFor(() => expect(c.h.transport.toolResponses).toHaveLength(1));
    c.s.stop();
    await restart(c.s);
    c.h.transport.goAway(5000);
    await vi.waitFor(() => expect(c.s.generation()).toBe(3));
    expect(c.h.executor.refreshes).toEqual([null]);
  });

  it('the hidden timer of a stopped session cannot pause the next one', async () => {
    const { h, s } = await live();
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(15_000);
    s.stop();
    await restart(s);
    await vi.advanceTimersByTimeAsync(6000); // the old timer would have fired 5 s into this session
    expect(status(s)).toBe('listening');
    expect(h.transport.texts.some((t) => t.includes('using the screen'))).toBe(false);
  });

  it('stop during the token fetch clears the 8 s timer, and the late token connects nothing', async () => {
    const gate = deferred<Token>();
    const h = makeSessionDeps({ token: () => gate.promise });
    const s = new VoiceSession(h.deps);
    s.start();
    await flush();
    expect(vi.getTimerCount()).toBe(1);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
    gate.resolve(GOOD);
    await flush();
    expect(h.connects()).toBe(0);
    expect(status(s)).toBe('ended');
  });

  it('calls queued before a stop do not run after an immediate restart', async () => {
    const { h, s } = await live();
    const gate = deferred<ToolResult>();
    h.executor.respond((call) => (call.id === 'a' ? gate.promise : OK));
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'get_status', args: {} }] });
    h.transport.emit({ toolCalls: [{ id: 'b', name: 'get_status', args: {} }] });
    await flush();
    s.stop();
    await restart(s);
    gate.resolve(OK);
    await flush();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.executor.calls.map((c) => c.id)).toEqual(['a']);
    expect(h.transport.toolResponses).toHaveLength(0);
  });

  it('a tap while paused (Pause) reaches the executor as quiet: it asks nothing; live again, taps are told', async () => {
    const { h, s } = await live();
    const onDraft = vi.spyOn(h.executor, 'onDraftChange');
    h.openDraft();
    s.pause();
    h.drafts.setMark(KEY, 'S1', { status: 'absent' }, { via: 'tap' });
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ via: 'tap', studentIds: ['S1'] }), true);
    s.resume();
    const texts = h.transport.texts.length;
    h.drafts.setMark(KEY, 'S2', { status: 'absent' }, { via: 'tap' });
    expect(onDraft).toHaveBeenLastCalledWith(expect.objectContaining({ via: 'tap', studentIds: ['S2'] }), false);
    expect(h.transport.texts.slice(texts)).toEqual(['[APP] Tapped S2']);
  });

  it('stop() unsubscribes from the draft, verification, the bus and connectivity', async () => {
    const { h, s } = await live();
    const onDraft = vi.spyOn(h.executor, 'onDraftChange');
    s.stop();
    const texts = h.transport.texts.length;
    const seen = h.executor.verifications.length;
    h.verification.cameraActive(CAMERA, true);
    h.openDraft();
    h.drafts.setMark(KEY, 'S1', { status: 'absent' }, { via: 'tap' });
    h.bus.emit({ type: 'focus_student', sessionKey: KEY, studentId: 'S2' });
    h.setOnline(false);
    expect(onDraft).not.toHaveBeenCalled();
    expect(h.executor.verifications).toHaveLength(seen);
    expect(h.transport.texts).toHaveLength(texts);
    expect(s.getState()).toMatchObject({ status: 'ended', error: null, focus: null });
  });
});

describe('the goAway swap in detail', () => {
  it('closes the old connection before it connects the new one', async () => {
    const h = makeSessionDeps();
    const seen: boolean[] = [];
    const s = new VoiceSession({ ...h.deps, setup: async (handle) => { seen.push(h.transport.connected()); return h.deps.setup(handle); } });
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    h.transport.goAway(5000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    expect(seen).toEqual([false, false]); // not connected at either setup: the old socket was closed first
    expect(h.connects()).toBe(2);
  });

  it('holds the newest 75 chunks while the token loads and replays them with the 16-chunk pre-roll', async () => {
    const gate = deferred<Token>();
    const { h, s } = await live({ token: tokens(GOOD, gate.promise) });
    for (let n = 0; n < 20; n++) h.audio.chunk();
    expect(h.transport.audioChunks).toBe(20);
    h.transport.goAway(10_000); // quiet: the swap starts at once and waits for the token
    await flush();
    for (let n = 0; n < 100; n++) h.audio.chunk();
    expect(h.transport.audioChunks).toBe(20);
    gate.resolve(GOOD);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await vi.waitFor(() => expect(h.transport.audioChunks).toBe(20 + 16 + 75));
  });

  it('a token failure keeps the old connection, replays what was held to it, and retries from 3 s on', async () => {
    const gate = deferred<Token>();
    const { h, s } = await live({ token: tokens(GOOD, gate.promise, GOOD) });
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    h.transport.goAway(20_000);
    await flush();
    for (let n = 0; n < 3; n++) h.audio.chunk();
    gate.resolve(err('unavailable'));
    await flush();
    expect(h.connects()).toBe(1);
    expect(h.transport.connected()).toBe(true);
    expect(h.transport.audioChunks).toBe(3);
    expect(s.generation()).toBe(1);
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(4000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    expect(h.connects()).toBe(2);
    expect(h.transport.lastSetup?.resumeHandle).toBe('h-1');
  });

  it('a close after goAway becomes a resume, not a drop', async () => {
    const { h, s } = await live();
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    h.audio.playing = true; // not quiet: the swap is still waiting for its moment
    h.transport.goAway(10_000);
    h.transport.drop(1000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    h.audio.playing = false;
    expect(h.connects()).toBe(2);
    expect(h.transport.lastSetup?.resumeHandle).toBe('h-1');
    expect(s.getState().error).toBeNull();
    expect(status(s)).not.toBe('error');
  });

  it('a swap during Pause sends no refresh and no pause text, and stays paused', async () => {
    const { h, s } = await live();
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    s.pause();
    const texts = h.transport.texts.length;
    h.transport.goAway(5000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await flush();
    expect(h.executor.refreshes).toEqual([]);
    expect(h.transport.texts).toHaveLength(texts);
    expect(status(s)).toBe('paused');
  });
});

describe('paused and swaps (Task 23 Part B4)', () => {
  it('Resume during a swap that began while paused: the new connection gets the refresh, decided at swap completion', async () => {
    const gate = deferred<Token>();
    const { h, s } = await live({ token: tokens(GOOD, gate.promise) });
    s.pause();
    h.transport.goAway(10_000); // quiet: the swap starts at once, while paused, and waits for the token
    await flush();
    s.resume(); // RESUME_EVENT is held by the swap
    gate.resolve(GOOD);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await vi.waitFor(() => expect(h.transport.texts.at(-1)).toBe('[APP] Refreshed.'));
    expect(status(s)).toBe('listening');
  });

  it('a pause while the refresh is being built: the held PAUSE_EVENT goes instead of the refresh, and the session stays paused', async () => {
    const { h, s } = await live();
    const built = deferred<string>();
    h.executor.refreshWith(() => built.promise);
    h.transport.goAway(10_000);
    await vi.waitFor(() => expect(h.executor.refreshes).toHaveLength(1));
    s.pause(); // the PAUSE_EVENT is held by the swap
    const texts = h.transport.texts.length;
    built.resolve('[APP] Refreshed.');
    await flush();
    expect(h.transport.texts.slice(texts)).toEqual([PAUSE_EVENT]); // final fix C2: the new connection knows it is paused
    expect(status(s)).toBe('paused');
  });

  it('a swap while paused replays no pre-roll: chunks recorded before the pause are stale', async () => {
    const { h, s } = await live();
    for (let n = 0; n < 20; n++) h.audio.chunk();
    expect(h.transport.audioChunks).toBe(20);
    s.pause();
    h.transport.goAway(10_000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await flush();
    expect(h.transport.audioChunks).toBe(20);
    expect(h.executor.refreshes).toEqual([]); // paused: no refresh either
  });
});

describe('a refresh asks a pending question again (Task 23 Part B2, B3)', () => {
  it('an ok result that carries a confirm_token is the pending question; a later ok without one clears it', async () => {
    const { h, s } = await live();
    h.executor.respond((call) => (call.id === 'a' ? { ok: true, confirm_token: 'K7QX', instruction: 'Ask whether to submit with confirm_token "K7QX".' } : OK));
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'mark_attendance', args: {} }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    h.transport.emit({ turnComplete: true });
    h.transport.goAway(10_000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await vi.waitFor(() => expect(h.executor.refreshes).toEqual(['Ask whether to submit with confirm_token "K7QX".']));

    h.transport.emit({ toolCalls: [{ id: 'b', name: 'get_status', args: {} }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(2));
    h.transport.emit({ turnComplete: true });
    h.transport.goAway(10_000);
    await vi.waitFor(() => expect(s.generation()).toBe(3));
    await vi.waitFor(() => expect(h.executor.refreshes.at(-1)).toBeNull());
  });

  it('passes what the trainer last said only with a pending question, and never logs it', async () => {
    const lines: string[] = [];
    const h = makeSessionDeps();
    const s = new VoiceSession({ ...h.deps, log: (line) => lines.push(line) });
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    h.transport.speak('sab present sirf Akash absent');
    h.transport.emit({ turnComplete: true });
    h.transport.goAway(10_000); // no question pending: nothing heard is passed
    await vi.waitFor(() => expect(h.executor.refreshes).toEqual([null]));
    expect(h.executor.heards).toEqual(['']);

    h.executor.respond(() => ({ ok: false, error: 'NEEDS_CONFIRMATION', confirm_token: 'K7QX', instruction: 'Ask: mark the remaining 20 present?' }));
    h.transport.speak('baaki sab present');
    h.transport.emit({ toolCalls: [{ id: 'q', name: 'mark_remaining', args: { status: 'PRESENT' } }] });
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    h.transport.emit({ turnComplete: true });
    h.transport.goAway(10_000);
    await vi.waitFor(() => expect(h.executor.heards).toEqual(['', 'baaki sab present']));
    expect(h.executor.refreshes.at(-1)).toBe('Ask: mark the remaining 20 present?');
    expect(lines.join('\n')).not.toMatch(/Akash|baaki|sab present/);
  });
});

describe('session lifetime leftovers (Task 23 Part B5)', () => {
  it('each conversation gets a fresh tool queue: a call that never settled cannot block the next one, nor keep a swap waiting', async () => {
    const { h, s } = await live();
    h.executor.respond((call) => (call.id === 'stuck' ? new Promise<ToolResult>(() => undefined) : OK));
    h.transport.emit({ toolCalls: [{ id: 'stuck', name: 'get_status', args: {} }] });
    await flush();
    s.stop();
    await restart(s);
    h.transport.emit({ toolCalls: [{ id: 'next', name: 'get_status', args: {} }] });
    await vi.waitFor(() => expect(h.transport.toolResponses.map((r) => r.id)).toEqual(['next']));
    h.transport.emit({ turnComplete: true });
    h.transport.goAway(10_000); // a quiet moment now, not the deadline 7.5 s away
    await vi.waitFor(() => expect(s.generation()).toBe(3));
  });

  it('start and reconnect come from a click, so the page is visible: the hidden flag is reset', async () => {
    const { h, s } = await live();
    s.setHidden(true);
    s.stop();
    await restart(s);
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(1);

    s.setHidden(true);
    h.transport.drop();
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    h.audio.chunk();
    expect(h.transport.audioChunks).toBe(2);
  });
});

describe('the other caps', () => {
  it('the session cap says its limit line, then stops 4 s later', async () => {
    const { h, s } = await live({ limits: { sessionMinutes: 1 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.transport.texts.at(-1)).toBe(limitEvent('session_limit'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.getState()).toMatchObject({ status: 'error', error: 'session_limit', canReconnect: false });
  });

  it('the daily cap says its limit line, then stops 4 s later', async () => {
    const { h, s } = await live({ limits: { dailyMinutes: 1 } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(h.transport.texts.at(-1)).toBe(limitEvent('daily_limit'));
    await vi.advanceTimersByTimeAsync(4000);
    expect(s.getState()).toMatchObject({ status: 'error', error: 'daily_limit' });
  });
});

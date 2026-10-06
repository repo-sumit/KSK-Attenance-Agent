import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SilentAudio } from '@/services/simulated/voice';
import type { ToolResult } from '@/services/voice/executor';
import { VoiceSession } from '@/services/voice/session';
import { WORKING_AFTER_MS } from '@/services/voice/session-cues';
import { deferred, KEY, makeSessionDeps, OK } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function live() {
  const h = makeSessionDeps();
  const s = new VoiceSession(h.deps);
  s.start();
  await vi.waitFor(() => expect(s.getState().status).toBe('listening'));
  return { h, s };
}
const status = (s: VoiceSession) => s.getState().status;

describe('earcons in a session (D-156)', () => {
  it('"ready" plays once, at the first listening after the connect; not again later, nor on a goAway swap', async () => {
    const { h, s } = await live();
    expect(h.transport.earcons).toEqual(['ready']);
    await vi.advanceTimersByTimeAsync(2000);
    h.transport.emit({ resumption: { handle: 'h-1', resumable: true } });
    h.transport.goAway(5000);
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    expect(status(s)).toBe('listening');
    expect(h.transport.earcons).toEqual(['ready']);
  });

  it('Reconnect (a tap after a drop) plays "ready" again once it listens', async () => {
    const { h, s } = await live();
    h.transport.drop();
    await vi.waitFor(() => expect(status(s)).toBe('error'));
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.transport.earcons).toEqual(['ready', 'ready']);
  });

  it('"saved" plays when voice saved a record, only while live and never over the agent\'s speech; it is not agent speech', async () => {
    const { h, s } = await live();
    h.bus.emit({ type: 'saved', what: 'staff' });
    expect(h.transport.earcons).toEqual(['ready', 'saved']);
    expect(status(s)).toBe('listening'); // a cue never makes the session "speaking" (the card is not woken by it)
    h.audio.playing = true;
    h.bus.emit({ type: 'saved', what: 'submit' });
    expect(h.transport.earcons).toEqual(['ready', 'saved']);
    h.audio.playing = false;
    s.pause();
    h.bus.emit({ type: 'saved', what: 'self' });
    expect(h.transport.earcons).toEqual(['ready', 'saved']);
  });

  it('"ended" plays when a live session stops, after the agent\'s audio is cut and before the audio closes', async () => {
    const { h, s } = await live();
    const audio = h.audio;
    const seen: string[] = [];
    const earcon = audio.earcon.bind(audio);
    vi.spyOn(audio, 'earcon').mockImplementation((kind) => {
      seen.push(`${kind} flushed=${audio.flushed} closed=${audio.closed}`);
      return earcon(kind);
    });
    s.stop();
    expect(status(s)).toBe('ended');
    expect(seen).toEqual(['ended flushed=1 closed=0']);
    expect(audio.closed).toBe(1);
    expect(h.transport.earcons).toEqual(['ready', 'ended']);
  });

  it('a cue that cannot play never stops or breaks the session (it is only feedback)', async () => {
    const broken = vi.spyOn(SilentAudio.prototype, 'earcon').mockImplementation(() => {
      throw new Error('no output');
    });
    const { h, s } = await live();
    expect(broken).toHaveBeenCalledWith('ready');
    h.bus.emit({ type: 'saved', what: 'staff' });
    expect(status(s)).toBe('listening');
    s.stop();
    expect(status(s)).toBe('ended');
    broken.mockRestore();
  });

  it('a start that never got live plays no cue', async () => {
    const h = makeSessionDeps();
    h.transport.denyNextMic('permission_denied');
    const s = new VoiceSession(h.deps);
    s.start();
    await vi.waitFor(() => expect(status(s)).toBe('error'));
    expect(h.transport.earcons).toEqual([]);
  });
});

describe('the working status (D-156)', () => {
  it('a tool call that has run more than 400 ms with no audio playing shows "working", then listening again', async () => {
    const { h, s } = await live();
    const gate = deferred<ToolResult>();
    h.executor.respond(() => gate.promise);
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'select_batch', args: {} }] });
    await vi.advanceTimersByTimeAsync(WORKING_AFTER_MS - 50);
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(100);
    expect(status(s)).toBe('working');
    gate.resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(h.transport.toolResponses).toHaveLength(1);
    expect(status(s)).toBe('listening');
  });

  it('a quick call never shows it; while the agent\'s audio plays it is "speaking", and "working" once the audio stops', async () => {
    const { h, s } = await live();
    h.transport.emit({ toolCalls: [{ id: 'q', name: 'get_status', args: {} }] });
    await vi.advanceTimersByTimeAsync(WORKING_AFTER_MS + 100);
    expect(h.transport.toolResponses).toHaveLength(1);
    expect(status(s)).toBe('listening');
    const gate = deferred<ToolResult>();
    h.executor.respond(() => gate.promise);
    h.audio.playing = true;
    h.transport.emit({ toolCalls: [{ id: 'b', name: 'submit_attendance', args: {} }] });
    await vi.advanceTimersByTimeAsync(WORKING_AFTER_MS + 100);
    expect(status(s)).toBe('speaking');
    h.audio.playing = false;
    await vi.advanceTimersByTimeAsync(250); // the next poll
    expect(status(s)).toBe('working');
    gate.resolve(OK);
    await vi.advanceTimersByTimeAsync(0);
    expect(status(s)).toBe('listening');
  });

  it('"working" is live: texts still reach the model, Pause and Resume work from it, and a stop ends it', async () => {
    const { h, s } = await live();
    const gate = deferred<ToolResult>();
    h.executor.respond(() => gate.promise);
    h.transport.emit({ toolCalls: [{ id: 'a', name: 'select_batch', args: {} }] });
    await vi.advanceTimersByTimeAsync(WORKING_AFTER_MS + 50);
    expect(status(s)).toBe('working');
    // a tap meanwhile still reaches the model (texts are dropped only while paused or not live)
    h.openDraft();
    h.drafts.setMark(KEY, 'S1', { status: 'absent' }, { via: 'tap' });
    expect(h.transport.texts.at(-1)).toBe('[APP] Tapped S1');
    s.pause();
    expect(status(s)).toBe('paused');
    s.resume();
    expect(status(s)).toBe('working');
    s.stop();
    expect(status(s)).toBe('ended');
    gate.resolve(OK);
    await vi.advanceTimersByTimeAsync(WORKING_AFTER_MS + 50);
    expect(status(s)).toBe('ended');
  });
});

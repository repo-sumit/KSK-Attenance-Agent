/**
 * The checks pace themselves to the agent (D-148): a check's [APP] text never interrupts the agent (the polite
 * outbox), the screen can wait until the agent is quiet (whenQuiet), the state says when the camera holds the mic,
 * and a pause made during a check ends with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { VerificationEvent } from '@/services/verification';
import { PAUSE_EVENT, RESUME_EVENT } from '@/services/voice/app-events';
import { VoiceSession } from '@/services/voice/session';
import { MicGate } from '@/services/voice/session-mic';
import { deferred, flush, KEY, makeSessionDeps, OK } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const CAMERA = { kind: 'session' as const, key: KEY };
const PURPOSE = `session:${KEY}`;
const status = (s: VoiceSession) => s.getState().status;

/** A live session whose executor answers each check event with a recognisable text. */
async function live() {
  const h = makeSessionDeps();
  const logs: string[] = [];
  h.deps = { ...h.deps, log: (line: string) => void logs.push(line) };
  h.executor.onVerification = async (e: VerificationEvent) => {
    h.executor.verifications.push(e);
    if (e.type === 'camera') return e.on ? '[APP] Camera on.' : null;
    if (e.type === 'granted') return `[APP] Granted ${e.purpose}.`;
    if (e.type === 'face') return '[APP] Face failed.';
    return null;
  };
  const s = new VoiceSession(h.deps);
  s.start();
  await vi.waitFor(() => expect(status(s)).toBe('listening'));
  // the kickoff owes a reply: the agent's first line ends it
  h.transport.emit({ turnComplete: true });
  return { h, s, logs };
}

/** The agent is mid-line: audio is playing and its turn has not completed. */
function speaking(h: ReturnType<typeof makeSessionDeps>) {
  h.audio.playing = true;
  h.transport.emit({ audio: [new Int16Array(4)], outputText: 'Checking your location' });
}

/** The agent finished its line: the player drained and the turn completed. */
function finished(h: ReturnType<typeof makeSessionDeps>) {
  h.audio.playing = false;
  h.transport.emit({ turnComplete: true });
}

const granted = (h: ReturnType<typeof makeSessionDeps>, purpose: string) =>
  (h.verification as unknown as { emit(e: VerificationEvent): void }).emit({ type: 'granted', purpose });

describe('the polite outbox (D-148)', () => {
  it('the camera-on text waits for the agent to finish its line; the mic goes off at once and the player is never flushed', async () => {
    const { h } = await live();
    speaking(h);
    h.verification.cameraActive(CAMERA, true);
    expect(h.audio.micEnabled.at(-1)).toBe(false); // D-086: at once
    await flush();
    expect(h.audio.flushed).toBe(0);
    expect(h.transport.texts).not.toContain('[APP] Camera on.');
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.transport.texts).not.toContain('[APP] Camera on.');
    finished(h);
    await vi.advanceTimersByTimeAsync(200);
    expect(h.transport.texts).not.toContain('[APP] Camera on.'); // the player has been idle for less than 300 ms
    await vi.advanceTimersByTimeAsync(200);
    expect(h.transport.texts.at(-1)).toBe('[APP] Camera on.');
  });

  it('debug lines (ids only): the camera, a held text, and how it went (quiet, cap, dropped)', async () => {
    const { h, logs } = await live();
    speaking(h);
    h.verification.cameraActive(CAMERA, true);
    await flush();
    finished(h);
    await vi.advanceTimersByTimeAsync(600);
    speaking(h);
    h.verification.cameraActive(CAMERA, false);
    h.verification.faceCheckFailed(CAMERA);
    await vi.advanceTimersByTimeAsync(3200);
    h.verification.cameraActive(CAMERA, true);
    await vi.advanceTimersByTimeAsync(4200);
    expect(logs.filter((l) => /^(camera|check text)/.test(l))).toEqual([
      'camera on', 'check text held', 'check text sent (quiet)',
      'camera off', 'check text held', 'check text sent (cap)',
      'camera on', 'check text held', 'check text dropped (cap)',
    ]);
  });

  it('the camera-on text is dropped when the agent still speaks after 4 s', async () => {
    const { h } = await live();
    speaking(h);
    h.verification.cameraActive(CAMERA, true);
    await vi.advanceTimersByTimeAsync(4400);
    finished(h);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.transport.texts).not.toContain('[APP] Camera on.');
  });

  it('is sent at once when the agent is quiet', async () => {
    const { h } = await live();
    await vi.advanceTimersByTimeAsync(400);
    h.verification.cameraActive(CAMERA, true);
    await flush();
    expect(h.transport.texts.at(-1)).toBe('[APP] Camera on.');
  });

  it('the pass and failure texts wait for the agent, then go anyway after 3 s', async () => {
    const { h } = await live();
    speaking(h);
    granted(h, PURPOSE);
    h.verification.faceCheckFailed(CAMERA);
    await vi.advanceTimersByTimeAsync(2600);
    expect(h.transport.texts).not.toContain(`[APP] Granted ${PURPOSE}.`);
    await vi.advanceTimersByTimeAsync(800);
    expect(h.transport.texts.slice(-2)).toEqual([`[APP] Granted ${PURPOSE}.`, '[APP] Face failed.']); // in order
  });

  it('a reply owed after a tool response holds the text until the agent has spoken', async () => {
    const { h } = await live();
    const answer = deferred<typeof OK>();
    h.executor.respond(() => answer.promise);
    h.transport.emit({ toolCalls: [{ id: 'sb', name: 'select_batch', args: { batch: 'x' } }] });
    h.transport.emit({ turnComplete: true }); // the tool-call turn ended; its result is not answered yet
    answer.resolve(OK);
    await vi.waitFor(() => expect(h.transport.toolResponses).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(400);
    h.verification.cameraActive(CAMERA, true);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.transport.texts).not.toContain('[APP] Camera on.'); // the agent has not said its check line yet
    speaking(h);
    finished(h);
    await vi.advanceTimersByTimeAsync(600); // 300 ms idle, seen by the 200 ms poll
    expect(h.transport.texts.at(-1)).toBe('[APP] Camera on.');
  });

  it('the refresh text a goAway swap sends owes a reply: a check text waits for the agent to answer it', async () => {
    const { h, s } = await live();
    h.transport.goAway(10_000); // quiet: the swap starts at once
    await vi.waitFor(() => expect(s.generation()).toBe(2));
    await vi.waitFor(() => expect(h.transport.texts.at(-1)).toBe('[APP] Refreshed.'));
    await vi.advanceTimersByTimeAsync(400);
    granted(h, PURPOSE);
    await vi.advanceTimersByTimeAsync(400);
    expect(h.transport.texts).not.toContain(`[APP] Granted ${PURPOSE}.`); // the agent has not answered the refresh yet
    speaking(h);
    finished(h);
    await vi.advanceTimersByTimeAsync(600); // 300 ms idle, seen by the 200 ms poll
    expect(h.transport.texts.at(-1)).toBe(`[APP] Granted ${PURPOSE}.`);
  });

  it('a pause drops held texts, and nothing is sent while paused', async () => {
    const { h, s } = await live();
    speaking(h);
    h.verification.cameraActive(CAMERA, true);
    await flush();
    s.pause();
    h.verification.faceCheckFailed(CAMERA);
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.transport.texts.at(-1)).toBe(PAUSE_EVENT);
    expect(h.transport.texts).not.toContain('[APP] Camera on.');
    expect(h.transport.texts).not.toContain('[APP] Face failed.');
  });

  it('a lost connection drops held texts: the Reconnect kickoff re-reads the state', async () => {
    const { h, s } = await live();
    speaking(h);
    h.verification.faceCheckFailed(CAMERA);
    await flush();
    h.transport.drop();
    s.reconnect();
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(h.transport.texts).not.toContain('[APP] Face failed.');
  });
});

describe('whenQuiet: the screen waits for the agent (D-148)', () => {
  it('resolves at once when the agent is quiet, and when voice is not streaming', async () => {
    const { h, s } = await live();
    await vi.advanceTimersByTimeAsync(400);
    let done = false;
    void s.whenQuiet(4000).then(() => (done = true));
    await flush();
    expect(done).toBe(true);
    s.pause();
    speaking(h);
    done = false;
    void s.whenQuiet(4000).then(() => (done = true));
    await flush();
    expect(done).toBe(true);
    const idle = new VoiceSession(makeSessionDeps().deps);
    await expect(idle.whenQuiet(4000)).resolves.toBeUndefined();
  });

  it('waits while the agent speaks, until it has been quiet for 300 ms', async () => {
    const { h, s } = await live();
    speaking(h);
    let done = false;
    void s.whenQuiet(4000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(1000);
    expect(done).toBe(false);
    finished(h);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
  });

  it('a line that ended just now still counts: the 300 ms idle is measured from the last poll that saw audio playing', async () => {
    const { h, s } = await live();
    speaking(h);
    await vi.advanceTimersByTimeAsync(1000); // nothing waits meanwhile: only the poll sees the player
    finished(h);
    await vi.advanceTimersByTimeAsync(50);
    let done = false;
    void s.whenQuiet(4000).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(done).toBe(true);
  });

  it('a spoken turn that never completes (the live model, after "say nothing") stops counting 1 s after its last output', async () => {
    const { h, s } = await live();
    speaking(h);
    h.audio.playing = false; // a short sound, then nothing: no turnComplete ever comes
    let done = false;
    void s.whenQuiet(4000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(800);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(400);
    expect(done).toBe(true);
    h.verification.cameraActive(CAMERA, true);
    await flush();
    expect(h.transport.texts.at(-1)).toBe('[APP] Camera on.');
  });

  it('a turn with a tool call stays in progress until its turnComplete (up to the cap)', async () => {
    const { h, s } = await live();
    const answer = deferred<typeof OK>();
    h.executor.respond(() => answer.promise);
    h.transport.emit({ toolCalls: [{ id: 'gs', name: 'get_status', args: {} }] });
    let done = false;
    void s.whenQuiet(3000).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1100);
    expect(done).toBe(true);
    answer.resolve(OK);
  });

  it('is capped, ends on abort, and ends when voice stops', async () => {
    const { h, s } = await live();
    speaking(h);
    let capped = false;
    void s.whenQuiet(3000).then(() => (capped = true));
    await vi.advanceTimersByTimeAsync(2900);
    expect(capped).toBe(false);
    await vi.advanceTimersByTimeAsync(150);
    expect(capped).toBe(true);

    const controller = new AbortController();
    let aborted = false;
    void s.whenQuiet(4000, controller.signal).then(() => (aborted = true));
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await flush();
    expect(aborted).toBe(true);

    let stopped = false;
    void s.whenQuiet(4000).then(() => (stopped = true));
    s.stop();
    await flush();
    expect(stopped).toBe(true);
  });

  it('a zero cap (simulation speed 0) resolves at once', async () => {
    const { h, s } = await live();
    speaking(h);
    let done = false;
    void s.whenQuiet(0).then(() => (done = true));
    await flush();
    expect(done).toBe(true);
  });
});

describe('micHeld: the camera holds the mic (D-148)', () => {
  it("is 'camera' while a face camera is on and null after; a stop resets it", async () => {
    const { h, s } = await live();
    expect(s.getState().micHeld).toBeNull();
    h.verification.cameraActive(CAMERA, true);
    expect(s.getState().micHeld).toBe('camera');
    h.verification.cameraActive(CAMERA, false);
    expect(s.getState().micHeld).toBeNull();
    h.verification.cameraActive(CAMERA, true);
    s.stop();
    expect(s.getState().micHeld).toBeNull();
  });

  it('a restart reads the cameras again: on when one is still on, null when it went off meanwhile', async () => {
    const { h, s } = await live();
    h.verification.cameraActive(CAMERA, true);
    s.stop();
    s.start();
    expect(s.getState().micHeld).toBe('camera');
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    s.stop();
    h.verification.cameraActive(CAMERA, false);
    s.start();
    expect(s.getState().micHeld).toBeNull();
  });
});

describe('automatic resume after a check (D-148)', () => {
  it('a pause made while the camera is on resumes on that check\'s pass, with the pass\'s own text', async () => {
    const { h, s, logs } = await live();
    h.verification.cameraActive(CAMERA, true);
    s.pause();
    h.verification.cameraActive(CAMERA, false);
    expect(status(s)).toBe('paused');
    granted(h, PURPOSE);
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(logs).toContain('resume (auto)');
    expect(h.transport.texts.at(-1)).toBe(`[APP] Granted ${PURPOSE}.`);
    expect(h.audio.micEnabled.at(-1)).toBe(true);
  });

  it('a pause made while voice follows a check (the flow in VERIFY) resumes on its pass; with no pass text, the resume text', async () => {
    const { h, s } = await live();
    h.executor.checks = [PURPOSE];
    s.pause();
    h.executor.checks = [];
    const hook = h.executor.onVerification;
    h.executor.onVerification = async (e) => (e.type === 'granted' ? null : hook(e));
    granted(h, PURPOSE);
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    expect(h.transport.texts.at(-1)).toBe(RESUME_EVENT);
  });

  it('a pause outside a check, or the pass of another check, keeps "until Resume"', async () => {
    const { h, s } = await live();
    s.pause();
    granted(h, PURPOSE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('paused');
    s.resume();
    h.executor.checks = ['self'];
    s.pause();
    granted(h, PURPOSE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('paused');
  });

  it('a hidden-page pause that began during a check resumes when the page shows again; one outside a check does not', async () => {
    const a = await live();
    a.h.verification.cameraActive(CAMERA, true);
    a.s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(a.s)).toBe('paused');
    a.s.setHidden(false);
    expect(status(a.s)).toBe('listening');
    expect(a.logs).toContain('resume (auto)');
    expect(a.h.audio.micEnabled.at(-1)).toBe(false); // D-086: the face camera is still on, so the mic stays off
    expect(a.s.getState().micHeld).toBe('camera');
    a.h.verification.cameraActive(CAMERA, false);
    expect(a.h.audio.micEnabled.at(-1)).toBe(true); // the camera closed: the mic comes back on
    expect(a.s.getState().micHeld).toBeNull();

    const b = await live();
    b.s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    b.s.setHidden(false);
    expect(status(b.s)).toBe('paused');
  });

  it('a hidden pause that began during a check stays paused when the check passes on the still-hidden page, and resumes on visible', async () => {
    const { h, s, logs } = await live();
    h.executor.checks = [PURPOSE]; // a location-only check, or the simulated camera: no camera holds the mic
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(s)).toBe('paused');
    const sent = h.transport.texts.length;
    granted(h, PURPOSE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('paused');
    expect(logs).not.toContain('resume (auto)');
    expect(h.transport.texts.length).toBe(sent); // nothing spoken into the hidden page
    expect(h.audio.micEnabled.at(-1)).toBe(false);
    s.setHidden(false);
    expect(status(s)).toBe('listening');
    expect(logs).toContain('resume (auto)');
    expect(h.transport.texts.at(-1)).toBe(RESUME_EVENT);
  });

  it('a Pause whose check passes while the page is hidden resumes when the page shows again, not before', async () => {
    const { h, s, logs } = await live();
    h.executor.checks = [PURPOSE];
    s.pause();
    h.executor.checks = [];
    s.setHidden(true);
    granted(h, PURPOSE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('paused');
    expect(logs).not.toContain('resume (auto)');
    s.setHidden(false);
    expect(status(s)).toBe('listening');
    expect(logs).toContain('resume (auto)');
    expect(h.transport.texts.at(-1)).toBe(RESUME_EVENT);
  });

  it('the executor hears a pass as quiet when its text would be dropped: never while live or when the pass resumes voice', async () => {
    const { h, s } = await live();
    const quiets: boolean[] = [];
    h.executor.onVerification = async (e, quiet) => {
      if (e.type === 'granted') quiets.push(quiet?.() ?? false);
      return null;
    };
    granted(h, PURPOSE); // live
    await vi.waitFor(() => expect(quiets).toHaveLength(1));
    h.executor.checks = [PURPOSE];
    s.pause(); // during the check: the pass resumes voice with its text
    h.executor.checks = [];
    granted(h, PURPOSE);
    await vi.waitFor(() => expect(quiets).toHaveLength(2));
    await vi.waitFor(() => expect(status(s)).toBe('listening'));
    s.pause(); // outside a check: the pass is dropped
    granted(h, PURPOSE);
    await vi.waitFor(() => expect(quiets).toHaveLength(3));
    s.resume();
    h.executor.checks = [PURPOSE];
    s.pause();
    h.executor.checks = [];
    s.setHidden(true); // a pass on a hidden page resumes only when it shows again
    granted(h, PURPOSE);
    await vi.waitFor(() => expect(quiets).toHaveLength(4));
    expect(quiets).toEqual([false, false, true, true]);
  });

  it('no 20 s hidden timer while the camera permission is being asked: the primer, then the device dialog the camera opens with', async () => {
    const { h, s } = await live();
    h.verification.notify(CAMERA, 'camera_permission');
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(status(s)).toBe('listening');
    h.verification.cameraActive(CAMERA, true); // the tap opens the camera, and the device asks
    await vi.advanceTimersByTimeAsync(25_000);
    expect(status(s)).toBe('listening');
    h.verification.cameraActive(CAMERA, false); // answered and done: the timer runs again
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(s)).toBe('paused');
  });

  it('the permission wait is bounded: a page hidden for 60 s while asking (a face check stalled on the hidden page) still pauses', async () => {
    const { h, s } = await live();
    h.verification.notify(CAMERA, 'camera_permission');
    h.verification.cameraActive(CAMERA, true); // granted; the face check runs, then the trainer leaves the WebView
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(status(s)).toBe('listening');
    await vi.advanceTimersByTimeAsync(1000);
    expect(status(s)).toBe('paused');
  });

  it('a camera opened with no permission asked (already granted) leaves the hidden timer running', async () => {
    const { h, s } = await live();
    h.verification.cameraActive(CAMERA, true);
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(s)).toBe('paused');
  });

  it('a permission screen left behind (another screen) waits for nothing: the hidden timer runs again', async () => {
    const { h, s } = await live();
    h.verification.notify(CAMERA, 'camera_permission');
    s.onScreen({ kind: 'home' });
    s.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(status(s)).toBe('paused');
  });
});

describe('MicGate: the 20 s hidden timer', () => {
  it('can run again after it fired: a fired timer is not taken for a running one', async () => {
    const fired = vi.fn();
    const gate = new MicGate({
      timers: { setTimeout, clearTimeout, setInterval, clearInterval, now: () => Date.now() },
      audio: () => null,
      live: () => true,
      streamEnd: () => undefined,
      hiddenTooLong: fired,
    });
    gate.setHidden(true);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toHaveBeenCalledTimes(1);
    gate.apply({ type: 'camera', purpose: PURPOSE, on: true }); // re-arms (no permission asked)
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fired).toHaveBeenCalledTimes(2);
  });
});

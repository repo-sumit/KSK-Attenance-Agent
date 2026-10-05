// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BasicClientLivenessService } from '@/services/camera/client-liveness';
import type { FaceDetectorPort } from '@/services/camera/face-detector';
import { SwitchableFaceCapture } from '@/services/camera/routing';
import type { CameraSession, CapturedFrame, FaceCaptureService, LivenessCallbacks, LivenessMode } from '@/services/face';
import { MockFaceMatchService, SimulatedFaceCaptureService } from '@/services/simulated/face';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import type { FaceEnrolment } from '@/domain/device';
import { FixedClock, instantAt } from '@/lib/time';

const clock = new FixedClock(instantAt('2026-09-25', '10:15'));

/** A video element as far as the liveness loop cares: ready, with a size. */
const video = { readyState: 4, videoWidth: 480, videoHeight: 640 } as unknown as HTMLVideoElement;

function session(): CameraSession & { captured: number } {
  const s = {
    kind: 'device' as const,
    stream: null,
    captured: 0,
    async capture(): Promise<CapturedFrame> {
      s.captured++;
      return { source: 'device', image: new Blob(['jpeg']), width: 480, height: 360, capturedAt: clock.now().toISOString() };
    },
    close() {},
  };
  return s;
}

/** A scripted detector: each call returns the next frame's yaw (frontal face otherwise). */
function detector(yaws: number[]): FaceDetectorPort & { closed: boolean } {
  let i = 0;
  const d = {
    closed: false,
    detect() {
      const yaw = yaws[Math.min(i++, yaws.length - 1)];
      const eye = 0.15;
      return [
        {
          score: 0.93,
          box: { originX: 156, originY: 236, width: 168, height: 168 },
          keypoints: [
            { x: 0.425, y: 0.47 },
            { x: 0.575, y: 0.47 },
            { x: 0.5 + yaw * eye, y: 0.51 },
            { x: 0.5, y: 0.56 },
            { x: 0.34, y: 0.5 },
            { x: 0.66, y: 0.5 },
          ],
        },
      ];
    },
    close() {
      d.closed = true;
    },
  };
  return d;
}

function callbacks() {
  const modes: LivenessMode[] = [];
  const guidance: string[] = [];
  const captures: number[] = [];
  const cb: LivenessCallbacks = { onMode: (m) => modes.push(m), onGuidance: (_s, g) => guidance.push(g), onCapture: (s) => captures.push(s) };
  return { cb, modes, guidance, captures };
}

const repeat = (yaw: number, n: number) => Array.from({ length: n }, () => yaw);

beforeEach(() => {
  // jsdom has no canvas: brightness is then "unknown", which the rules accept.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe('BasicClientLivenessService', () => {
  it('with detection: straight, left, right — three photos from the session, detector closed afterwards', async () => {
    const d = detector([...repeat(0, 8), ...repeat(0.3, 3), ...repeat(0, 2), ...repeat(-0.3, 4)]);
    const s = session();
    const { cb, modes, captures } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'auto', loadDetector: async () => d, wait: async () => undefined });
    const result = await service.run(s, video, 'enrol', cb, new AbortController().signal);
    expect(result.ok && result.value).toHaveLength(3);
    expect(modes).toEqual(['detection']);
    expect(captures).toEqual([1, 2, 3]);
    expect(s.captured).toBe(3);
    expect(d.closed).toBe(true);
  });

  it('falls back to guided captures (countdown) when detection cannot start', async () => {
    const s = session();
    const { cb, modes, guidance } = callbacks();
    const service = new BasicClientLivenessService({
      mode: () => 'auto',
      loadDetector: async () => {
        throw new Error('WebGL unavailable');
      },
      wait: async () => undefined,
    });
    const result = await service.run(s, video, 'enrol', cb, new AbortController().signal);
    expect(result.ok && result.value).toHaveLength(3);
    expect(modes).toEqual(['guided']);
    expect(guidance).toContain('countdown');
    expect(guidance).toEqual(expect.arrayContaining(['look_straight', 'turn_left', 'turn_right']));
  });

  it('"Guided only" never loads the detector; the daily check takes one photo', async () => {
    const load = vi.fn();
    const { cb } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'guided', loadDetector: load, wait: async () => undefined });
    const result = await service.run(session(), video, 'verify', cb, new AbortController().signal);
    expect(result.ok && result.value).toHaveLength(1);
    expect(load).not.toHaveBeenCalled();
  });

  it('a preview that never shows a frame is a camera failure, not a face problem', async () => {
    const { cb } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'auto', loadDetector: async () => detector([0]), wait: async () => undefined });
    const stalled = { readyState: 0, videoWidth: 0, videoHeight: 0 } as unknown as HTMLVideoElement;
    vi.useFakeTimers();
    const pending = service.run(session(), stalled, 'verify', cb, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(9_000);
    vi.useRealTimers();
    expect(await pending).toEqual({ ok: false, error: 'camera_failed' });
  });

  it('forced guided mode (after repeated failed checks) skips detection', async () => {
    const load = vi.fn(async () => detector([0]));
    const { cb, modes } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'auto', loadDetector: load, wait: async () => undefined });
    const result = await service.run(session(), video, 'verify', cb, new AbortController().signal, { guided: true });
    expect(result.ok).toBe(true);
    expect(load).not.toHaveBeenCalled();
    expect(modes).toEqual(['guided']);
  });

  it('a detector that arrives after the start-up limit is closed, and the check goes guided', async () => {
    const late = detector([0]);
    let resolve: (d: FaceDetectorPort) => void = () => undefined;
    const { cb, modes } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'auto', loadDetector: () => new Promise((r) => (resolve = r)), wait: async () => undefined });
    vi.useFakeTimers();
    const pending = service.run(session(), video, 'verify', cb, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(13_000);
    vi.useRealTimers();
    const result = await pending;
    expect(result.ok).toBe(true);
    expect(modes).toEqual(['guided']);
    resolve(late);
    await new Promise((r) => setTimeout(r, 0));
    expect(late.closed).toBe(true);
  });

  it('a photo finishing after the screen closed is dropped, not handed on', async () => {
    const controller = new AbortController();
    const s = session();
    const capture = s.capture.bind(s);
    s.capture = async () => {
      const f = await capture(null);
      controller.abort();
      return f;
    };
    const { cb, captures } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'guided', loadDetector: vi.fn(), wait: async () => undefined });
    const result = await service.run(s, video, 'verify', cb, controller.signal);
    expect(result).toEqual({ ok: false, error: 'cancelled' });
    expect(captures).toEqual([]);
  });

  it('leaving the screen cancels the check', async () => {
    const controller = new AbortController();
    controller.abort();
    const { cb } = callbacks();
    const service = new BasicClientLivenessService({ mode: () => 'auto', loadDetector: async () => detector([0]), wait: async () => undefined });
    const result = await service.run(session(), video, 'enrol', cb, controller.signal);
    expect(result).toEqual({ ok: false, error: 'cancelled' });
  });
});

describe('MockFaceMatchService (matching is simulated)', () => {
  const setup = (patch = {}) => {
    const saved: FaceEnrolment[] = [];
    const sim = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0, ...patch });
    const repo = { get: async (id: string) => saved.find((e) => e.staffId === id), save: async (e: FaceEnrolment) => void saved.push(e), remove: async () => {}, count: async () => saved.length };
    return { saved, sim, match: new MockFaceMatchService(sim, repo, clock) };
  };
  const frames = (n: number): CapturedFrame[] => Array.from({ length: n }, () => ({ source: 'device', image: new Blob(['x']), width: 1, height: 1, capturedAt: '' }));

  it('registration keeps only the fact of it: no photo is stored', async () => {
    const { saved, match } = setup();
    expect(await match.enrol('st-rajesh', frames(3))).toEqual({ ok: true, value: true });
    expect(saved).toEqual([{ staffId: 'st-rajesh', enrolledAt: clock.now().toISOString(), sampleCount: 3, simulated: true }]);
    expect(match.simulated).toBe(true);
  });
  it('a failed save is reported', async () => {
    expect(await setup({ enrolmentIssue: 'save_failed' }).match.enrol('st-rajesh', frames(3))).toEqual({ ok: false, error: 'save_failed' });
  });
  it('verification: not enrolled, then the demo outcome (match / no match)', async () => {
    const { match, sim } = setup();
    expect(await match.verify('st-rajesh', frames(1)[0])).toEqual({ ok: false, error: 'not_enrolled' });
    await match.enrol('st-rajesh', frames(3));
    expect((await match.verify('st-rajesh', frames(1)[0])).ok).toBe(true);
    sim.update({ face: 'no_match' });
    expect(await match.verify('st-rajesh', frames(1)[0])).toEqual({ ok: false, error: 'no_match' });
  });
});

describe('camera selection', () => {
  it('the simulated camera behaves like a prompt: a demo refusal blocks it and is remembered', async () => {
    const sim = new StaticSimulationSource({ ...DEFAULT_SIMULATION, face: 'camera_denied' });
    const camera = new SimulatedFaceCaptureService(sim, clock);
    expect(await camera.open()).toEqual({ ok: false, error: 'permission_denied' });
    expect(await camera.permission()).toBe('denied');
  });
  it('routes to the device or the simulated camera per the simulation source', async () => {
    const sim = new StaticSimulationSource({ ...DEFAULT_SIMULATION });
    const device: FaceCaptureService = { source: () => 'device', permission: async () => 'granted', open: async () => ({ ok: false, error: 'not_found' }) };
    const camera = new SwitchableFaceCapture(sim, device, new SimulatedFaceCaptureService(sim, clock));
    expect(camera.source()).toBe('device');
    expect(await camera.open()).toEqual({ ok: false, error: 'not_found' });
    sim.update({ camera: 'simulated' });
    expect(camera.source()).toBe('simulated');
    const opened = await camera.open();
    expect(opened.ok && opened.value.kind).toBe('simulated');
  });
});

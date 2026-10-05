/**
 * Simulation seam. Location, face matching, network and sync outcomes are not
 * real in this build; the simulated implementations read their outcomes from a
 * SimulationSource. The demo panel is one source; without the demo, a static
 * source returns the defaults: the REAL camera with on-device detection, and
 * "everything works" for the simulated parts.
 *
 * Nothing here is biometric or security-relevant — see docs/DECISIONS.md.
 */
export type PermissionState = 'prompt' | 'granted' | 'denied';

export type LocationOutcome = 'inside' | 'outside' | 'permission_denied' | 'unavailable' | 'device_gps';
export type FaceOutcome = 'match' | 'no_match' | 'camera_denied';
export type EnrolmentIssue = 'none' | 'poor_light' | 'multiple_faces' | 'save_failed';
/** device: the phone's real front camera · simulated: no camera (demo on a machine without one, automated tests). */
export type CameraSource = 'device' | 'simulated';
/** auto: on-device face detection, guided captures if it can't start · guided: skip detection. */
export type LivenessSetting = 'auto' | 'guided';

/** live: the real Gemini Live session · scripted: the demo/E2E driver (no network, no microphone). */
export type VoiceSource = 'live' | 'scripted';

export interface SimulationState {
  readonly location: LocationOutcome;
  /** Distance reported when the outcome is "outside". */
  readonly outsideDistanceM: number;
  /** Outcome of the simulated face MATCH (the camera and movement check can be real). */
  readonly face: FaceOutcome;
  /** Simulated camera only: the registration problem to play (save_failed applies to both). */
  readonly enrolmentIssue: EnrolmentIssue;
  readonly camera: CameraSource;
  readonly liveness: LivenessSetting;
  readonly permissions: { readonly location: PermissionState; readonly camera: PermissionState };
  readonly online: boolean;
  /** Voice Agent: the real Gemini Live session or the scripted driver. Read when a session starts. */
  readonly voice: VoiceSource;
  readonly nextSyncFails: boolean;
  /** 1 = realistic pacing, 0 = instant (automated tests). */
  readonly speed: number;
}

export const DEFAULT_SIMULATION: SimulationState = {
  location: 'inside',
  outsideDistanceM: 1240,
  face: 'match',
  enrolmentIssue: 'none',
  camera: 'device',
  liveness: 'auto',
  permissions: { location: 'granted', camera: 'granted' },
  online: true,
  voice: 'live',
  nextSyncFails: false,
  speed: 1,
};

export interface SimulationSource {
  get(): SimulationState;
  update(patch: Partial<SimulationState>): void;
  subscribe(listener: () => void): () => void;
}

/** In-memory source used when the demo layer is absent, and in tests. */
export class StaticSimulationSource implements SimulationSource {
  private listeners = new Set<() => void>();
  constructor(private state: SimulationState = DEFAULT_SIMULATION) {}
  get() {
    return this.state;
  }
  update(patch: Partial<SimulationState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l());
  }
  subscribe(listener: () => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

/** Waits `ms` scaled by the simulation speed (0 in tests). */
export function simulatedDelay(source: SimulationSource) {
  return (ms: number) => {
    const scaled = ms * source.get().speed;
    return scaled <= 0 ? Promise.resolve() : new Promise<void>((resolve) => setTimeout(resolve, scaled));
  };
}

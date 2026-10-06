/**
 * What reaches a voice session from outside the conversation (voice design §5.3, D-085, D-086): taps on the
 * shared draft, verification events, the agent's focus_student and saved events and connectivity. Every listener is
 * synchronous: the draft and verification services catch a throwing listener but not a rejected promise, so
 * async work goes to the session's tool queue, which owns its rejections.
 */
import type { VerificationEvent } from '../verification';
import type { VoiceSessionDeps, VoiceState } from './session-types';

export interface TapHandlers {
  /** An [APP] text for the model (null: nothing to say). */
  text(text: string | null): void;
  /** Whether a text sent now reaches the model (false while paused or not live: it would be dropped). */
  live(): boolean;
  /** The trainer did something by hand (a tap): resets the idle clock. */
  activity(): void;
  verification(e: VerificationEvent): void;
  focus(focus: VoiceState['focus']): void;
  /** Voice saved a record: the "saved" cue (D-156). */
  saved(): void;
  offline(): void;
}

/** Subscribes everything; the returned functions unsubscribe. */
export function attachTaps(deps: VoiceSessionDeps, on: TapHandlers): (() => void)[] {
  return [
    // Called for every change, synchronously: the executor voids an open confirmation on any of them (D-082).
    // While the text would be dropped (paused, not live), the executor only follows the tap: it asks nothing.
    // A tap is activity (voice's own marks count through their tool call).
    deps.drafts.subscribe('*', (change) => {
      if (change.via === 'tap') on.activity();
      on.text(deps.executor.onDraftChange(change, !on.live()));
    }),
    deps.verification.subscribe((e) => on.verification(e)),
    deps.bus.subscribe((e) => {
      if (e.type === 'focus_student') on.focus({ sessionKey: e.sessionKey, studentId: e.studentId, seq: e.seq });
      if (e.type === 'saved') on.saved();
    }),
    deps.onOnlineChange((online) => {
      if (!online) on.offline();
    }),
  ];
}

/**
 * The purposes whose face camera is on: the mic pauses while any is (D-086). Seeded from the service when the taps
 * attach. Also the purposes whose camera permission is being asked (the primer, then the device's dialog as the camera
 * opens): the hidden-page pause waits longer then (D-148; MicGate bounds it).
 */
export class CameraWatch {
  private readonly on = new Set<string>();
  private readonly asking = new Set<string>();

  /** Starts from the cameras that are already on (a session can start mid-check). */
  reset(seed: readonly string[] = []): void {
    this.on.clear();
    this.asking.clear();
    for (const purpose of seed) this.on.add(purpose);
  }

  apply(e: VerificationEvent): void {
    // The device's own permission dialog opens with the camera, after the primer's tap: still asking until a face
    // result, the camera closing, or another step comes.
    if (e.type === 'prompt' && e.need === 'camera_permission') this.asking.add(e.purpose);
    else if (!(e.type === 'camera' && e.on)) this.asking.delete(e.purpose);
    if (e.type !== 'camera') return;
    if (e.on) this.on.add(e.purpose);
    else this.on.delete(e.purpose);
  }

  /** The trainer moved to another screen: a permission screen left behind waits for nothing. */
  leave(): void {
    this.asking.clear();
  }

  get isOn(): boolean {
    return this.on.size > 0;
  }

  /** The purposes whose camera is on now. */
  get purposes(): readonly string[] {
    return [...this.on];
  }

  get askingPermission(): boolean {
    return this.asking.size > 0;
  }
}

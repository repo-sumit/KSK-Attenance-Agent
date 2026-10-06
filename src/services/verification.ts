/**
 * VerificationService — the full-screen module between batch selection and the
 * student list (PRD §8), reused unchanged for instructor self-attendance
 * (PRD §18.4). It checks location and face per configuration and records a
 * pass; the roster and submit both require that pass (INV-16).
 *
 * It also announces what happens as it happens (D-086), so Voice Agent can speak
 * the outcome the screen shows: subscribe() delivers VerificationEvents. A call
 * that passes no purpose announces nothing, so existing callers are unchanged.
 */
import type { LocationStep } from '@/config/journey';
import type { SessionKey } from '@/domain/attendance';
import { canReuseSelfPass } from '@/domain/rules';
import { err, ok, type Result } from '@/lib/result';
import { toLocalDate } from '@/lib/time';
import type { VerificationPass, VerificationRepository } from '@/repositories/interfaces';
import type { SessionContext } from './context';
import type { CapturedFrame, FaceCaptureService, FaceMatchError, FaceMatchService } from './face';
import { checkLocation, type LocationCheck, type LocationCheckError, type LocationProvider } from './location';
import type { PermissionState } from './simulation';

export type VerificationPurpose = { readonly kind: 'session'; readonly key: SessionKey } | { readonly kind: 'self' };

export const purposeKey = (p: VerificationPurpose) => (p.kind === 'self' ? 'self' : `session:${p.key}`);

/** A tap the screen is waiting for, which Voice Agent asks the person to make. */
export type VerificationNeed = 'location_permission' | 'camera_permission' | 'confirm_location' | 'face_enrolment';

/** `purpose` is the purposeKey of the session being verified ("session:<key>"), or "self". */
export type VerificationEvent =
  | { readonly type: 'location'; readonly purpose: string; readonly result: 'inside' | 'tagged' | 'outside' | 'permission_denied' | 'unavailable' | 'timeout'; readonly distanceM?: number }
  /** `check_failed`: the face check could not see one clear face (the screen counts it as a failed try, like a mismatch). */
  | { readonly type: 'face'; readonly purpose: string; readonly result: 'match' | 'no_match' | 'check_failed' }
  | { readonly type: 'camera'; readonly purpose: string; readonly on: boolean }
  | { readonly type: 'prompt'; readonly purpose: string; readonly need: VerificationNeed }
  | { readonly type: 'granted'; readonly purpose: string };

/** `tagged` for a silent geo-tag, `inside` for a fence pass, `outside` with the distance, or the position error. */
function locationEvent(purpose: string, step: Exclude<LocationStep, 'none'>, result: Result<LocationCheck, LocationCheckError>): VerificationEvent {
  if (result.ok) {
    return step === 'fence' ? { type: 'location', purpose, result: 'inside', distanceM: result.value.location.distanceM } : { type: 'location', purpose, result: 'tagged' };
  }
  if (result.error === 'outside_fence') {
    const distanceM = result.detail?.distanceM;
    return typeof distanceM === 'number' ? { type: 'location', purpose, result: 'outside', distanceM } : { type: 'location', purpose, result: 'outside' };
  }
  return { type: 'location', purpose, result: result.error };
}

export class VerificationService {
  /** One entry per subscription, so each unsubscribe removes exactly its own listener. */
  private readonly listeners = new Set<{ readonly fn: (e: VerificationEvent) => void }>();
  /** Purposes whose face camera is on right now: cameraActive announces changes only. */
  private readonly cameraOn = new Set<string>();

  constructor(
    private readonly passes: VerificationRepository,
    private readonly location: LocationProvider,
    private readonly camera: FaceCaptureService,
    private readonly faces: FaceMatchService,
  ) {}

  /** Outcome events (D-086). Returns the function that stops delivery. */
  subscribe(listener: (e: VerificationEvent) => void): () => void {
    const entry = { fn: listener };
    this.listeners.add(entry);
    return () => {
      this.listeners.delete(entry);
    };
  }

  private emit(event: VerificationEvent): void {
    for (const { fn } of [...this.listeners]) {
      try {
        fn(event);
      } catch {
        // A listener only observes (Voice Agent): its failure must never break verification.
      }
    }
  }

  /** The face screen reports its camera: Voice Agent pauses the microphone while it is on. */
  cameraActive(purpose: VerificationPurpose, on: boolean): void {
    const key = purposeKey(purpose);
    if (this.cameraOn.has(key) === on) return;
    if (on) this.cameraOn.add(key);
    else this.cameraOn.delete(key);
    this.emit({ type: 'camera', purpose: key, on });
  }

  /** Whether any face camera is on right now: a voice session that starts mid-check reads this (D-086). */
  cameraIsOn(): boolean {
    return this.cameraOn.size > 0;
  }

  /** The purposeKeys whose face camera is on right now. */
  camerasOn(): readonly string[] {
    return [...this.cameraOn];
  }

  /** The screen is waiting for a tap the voice agent should ask for. */
  notify(purpose: VerificationPurpose, need: VerificationNeed): void {
    this.emit({ type: 'prompt', purpose: purposeKey(purpose), need });
  }

  async hasPass(ctx: SessionContext, purpose: VerificationPurpose): Promise<boolean> {
    if (!ctx.journey.verification.required) return true;
    return Boolean(await this.passes.find(ctx.user.id, purposeKey(purpose), toLocalDate(ctx.clock.now())));
  }

  locationPermission(): Promise<PermissionState> {
    return this.location.permission();
  }
  /** With a purpose, a refusal is announced as a location "permission_denied" (the primer's Allow was turned down). */
  async requestLocationPermission(purpose?: VerificationPurpose): Promise<PermissionState> {
    const state = await this.location.requestPermission();
    if (purpose && state !== 'granted') this.emit({ type: 'location', purpose: purposeKey(purpose), result: 'permission_denied' });
    return state;
  }
  /** The camera itself is opened by the face screen (it needs the live preview); this only reads the permission. */
  cameraPermission(): Promise<PermissionState> {
    return this.camera.permission();
  }

  /** Geo-tagging captures silently; geo-fencing also enforces the radius. With a purpose, the outcome is announced once. */
  async checkLocation(ctx: SessionContext, purpose?: VerificationPurpose): Promise<Result<LocationCheck, LocationCheckError | 'not_required'>> {
    const step = ctx.journey.verification.location;
    if (step === 'none') return err('not_required');
    const result = await checkLocation(this.location, step === 'fence' ? 'fencing' : 'tagging', ctx.institute.location, ctx.config.verification.fenceRadiusM);
    if (purpose) this.emit(locationEvent(purposeKey(purpose), step, result));
    return result;
  }

  /** Matches the photo from the face check. Simulated in this build (MockFaceMatchService): no comparison happens. */
  async matchFace(ctx: SessionContext, frame: CapturedFrame, purpose?: VerificationPurpose): Promise<Result<true, FaceMatchError | 'not_required'>> {
    if (!ctx.journey.verification.face) return err('not_required');
    const result = await this.faces.verify(ctx.user.id, frame);
    // A person with no stored reference fails the check on screen exactly like a mismatch, so it is announced as one.
    if (purpose) this.emit({ type: 'face', purpose: purposeKey(purpose), result: result.ok ? 'match' : 'no_match' });
    return result;
  }

  /**
   * The face screen's check could not see one clear face (no face, poor light, movement not seen…). The screen counts
   * it toward faceRetryLimit as it counts a mismatch, so it is announced as a failed try with the same count.
   */
  faceCheckFailed(purpose: VerificationPurpose): void {
    this.emit({ type: 'face', purpose: purposeKey(purpose), result: 'check_failed' });
  }

  async grant(ctx: SessionContext, purpose: VerificationPurpose, location?: LocationCheck): Promise<Result<VerificationPass, never>> {
    const { location: step, face } = ctx.journey.verification;
    const pass: VerificationPass = {
      staffId: ctx.user.id,
      purpose: purposeKey(purpose),
      date: toLocalDate(ctx.clock.now()),
      grantedAt: ctx.clock.now().toISOString(),
      checks: { location: step, face },
      ...(location ? { location: location.location } : {}),
    };
    await this.passes.grant(pass);
    this.emit({ type: 'granted', purpose: purposeKey(purpose) });
    return ok(pass);
  }

  /**
   * One check, not two (D-152, amends D-028): a batch's check is passed by the trainer's own (self) check from today
   * when it is no older than verification.selfPassReuseMinutes and covered every check this batch needs now. The
   * session pass is then stored (with the self check's location, so the submission carries it) and announced like any
   * other. False when it does not apply: the batch runs its own check. Only for a user whose journey has own
   * attendance (the principal's checks stay as they were). A pass is never authority on its own: openRoster and
   * submit still check own attendance first, the window and access.
   */
  async reuseSelfPass(ctx: SessionContext, purpose: VerificationPurpose): Promise<boolean> {
    if (purpose.kind !== 'session' || !ctx.journey.verification.required || !ctx.journey.staff.selfCard) return false;
    const now = ctx.clock.now();
    const today = toLocalDate(now);
    const self = await this.passes.find(ctx.user.id, purposeKey({ kind: 'self' }), today);
    const { location: step, face } = ctx.journey.verification;
    const minutes = ctx.config.verification.selfPassReuseMinutes;
    if (!self || !canReuseSelfPass({ pass: self, needs: { location: step, face }, now, today, minutes })) return false;
    await this.passes.grant({
      staffId: ctx.user.id,
      purpose: purposeKey(purpose),
      date: today,
      grantedAt: now.toISOString(),
      ...(self.checks ? { checks: self.checks } : {}),
      ...(self.location ? { location: self.location } : {}),
    });
    this.emit({ type: 'granted', purpose: purposeKey(purpose) });
    return true;
  }
}

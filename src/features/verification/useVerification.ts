'use client';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useServices } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { useSimDelay } from '@/hooks/useSimDelay';
import type { CapturedFrame } from '@/services/face';
import type { LocationCheck } from '@/services/location';
import type { VerificationNeed, VerificationPurpose } from '@/services/verification';
import { faceProblem, isCheckFailure } from '../face/guidance';
import type { FaceRunFailure } from '../face/useFaceCapture';
import type { ProblemKind } from '../feedback/problems';

export type VerifyPhase =
  | { readonly kind: 'starting' }
  | { readonly kind: 'primer'; readonly permission: 'location' | 'camera' }
  | { readonly kind: 'locating'; readonly visible: boolean }
  | { readonly kind: 'located' }
  | { readonly kind: 'confirm'; readonly distanceM: number }
  /** The screen shows the live camera (FaceCheck) and reports back through faceCaptured / faceFailed. */
  | { readonly kind: 'facing' }
  | { readonly kind: 'matching' }
  | { readonly kind: 'faced' }
  | { readonly kind: 'problem'; readonly problem: ProblemKind; readonly distanceM?: number; readonly retry: 'all' | 'face' | 'none' }
  | { readonly kind: 'passed' };

/** Prototype hold times: long enough to read "Location verified", short enough not to slow marking. */
const HOLD_MS = 900;

/**
 * The verification module (PRD §8) as a state machine the screen renders.
 * Location runs before face. Location failures are not retryable from the same
 * place ("go to the institute"); face failures retry up to the configured limit.
 * The face step opens the real camera (or the demo's simulated one); matching
 * the photo is simulated in this build.
 */
export function useVerification(purpose: VerificationPurpose, onPassed: () => void) {
  const ctx = useSession();
  const { verification } = useServices();
  const hold = useSimDelay();
  const j = ctx.journey.verification;
  const [phase, setPhase] = useState<VerifyPhase>({ kind: 'starting' });
  const [attempt, setAttempt] = useState(0);
  /** No-match results and failed movement checks both count towards the configured retry limit. */
  const [faceFailures, setFaceFailures] = useState(0);
  /** Failed movement checks only: after two, the camera takes the photo on a countdown instead (D-048). */
  const [checkFailures, setCheckFailures] = useState(0);
  const [location, setLocation] = useState<LocationCheck | undefined>(undefined);
  /** The primer was just accepted: open the camera (which asks) instead of asking again. */
  const [primed, setPrimed] = useState(false);
  const run = useRef<AbortController | null>(null);

  const finish = async (signal: AbortSignal, loc: LocationCheck | undefined) => {
    await verification.grant(ctx, purpose, loc);
    if (!signal.aborted) {
      setPhase({ kind: 'passed' });
      onPassed();
    }
  };

  const runFace = async (signal: AbortSignal, loc: LocationCheck | undefined) => {
    if (!j.face) return finish(signal, loc);
    // Only "prompt" shows the primer first. A "denied" answer is only a hint (WebViews differ): opening
    // the camera reports a real block itself, as "Camera access is blocked".
    if (!primed) {
      const permission = await verification.cameraPermission();
      if (signal.aborted) return;
      if (permission === 'prompt') return setPhase({ kind: 'primer', permission: 'camera' });
    }
    setPhase({ kind: 'facing' });
  };

  const runAll = useEffectEvent(async (signal: AbortSignal, from: 'all' | 'face') => {
    if (from === 'face') return runFace(signal, location);
    if (j.location !== 'none') {
      const permission = await verification.locationPermission();
      if (signal.aborted) return;
      // "denied" is only a hint (WebViews answer differently): asking for a fix reports a real denial itself.
      if (permission === 'prompt') return setPhase({ kind: 'primer', permission: 'location' });
      setPhase({ kind: 'locating', visible: j.location === 'fence' || j.face });
      const result = await verification.checkLocation(ctx, purpose);
      if (signal.aborted) return;
      if (!result.ok) {
        if (result.error === 'outside_fence') {
          const distanceM = Number(result.detail?.distanceM ?? 0);
          return setPhase({ kind: 'problem', problem: 'outside', distanceM, retry: 'all' });
        }
        if (result.error === 'permission_denied') return setPhase({ kind: 'problem', problem: 'locationDenied', retry: 'all' });
        // A timeout means GPS is on but found no fix (common indoors); "unavailable" means location is off.
        if (result.error === 'timeout') return setPhase({ kind: 'problem', problem: 'noFix', retry: 'all' });
        if (result.error !== 'not_required') return setPhase({ kind: 'problem', problem: 'gps', retry: 'all' });
      }
      const loc = result.ok ? result.value : undefined;
      setLocation(loc);
      if (j.location === 'fence') {
        if (j.fencePassPrompt === 'confirm' && loc) return setPhase({ kind: 'confirm', distanceM: loc.location.distanceM ?? 0 });
        setPhase({ kind: 'located' });
        if (!(await hold(HOLD_MS, signal))) return;
      }
      return runFace(signal, loc);
    }
    return runFace(signal, undefined);
  });

  const [from, setFrom] = useState<'all' | 'face'>('all');
  useEffect(() => {
    const controller = new AbortController();
    run.current = controller;
    // Started from a task, not synchronously in the effect body; aborted on unmount.
    const timer = setTimeout(() => void runAll(controller.signal, from), 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [attempt, from]);

  // Voice Agent listens (D-086): which tap the screen is waiting for, and whether the face camera is on.
  const waitingFor: VerificationNeed | null =
    phase.kind === 'primer' ? (phase.permission === 'location' ? 'location_permission' : 'camera_permission') : phase.kind === 'confirm' ? 'confirm_location' : null;
  const cameraOn = phase.kind === 'facing' || phase.kind === 'matching';
  const announce = useEffectEvent((need: VerificationNeed) => verification.notify(purpose, need));
  const reportCamera = useEffectEvent((on: boolean) => verification.cameraActive(purpose, on));
  useEffect(() => {
    if (waitingFor) announce(waitingFor);
  }, [waitingFor]);
  useEffect(() => {
    reportCamera(cameraOn);
    return () => reportCamera(false);
  }, [cameraOn]);

  const restart = (next: 'all' | 'face') => {
    setFrom(next);
    setAttempt((a) => a + 1);
  };

  const limitReached = (failures: number) => j.faceRetryLimit !== null && failures >= j.faceRetryLimit;

  return {
    phase,
    location,
    /** Take the daily photo on a countdown (detection repeatedly couldn't finish). */
    guidedCapture: checkFailures >= 2,
    retry: () => restart(phase.kind === 'problem' && phase.retry === 'face' ? 'face' : 'all'),
    allowLocation: async () => {
      const state = await verification.requestLocationPermission(purpose);
      if (state === 'granted') restart('all');
      else setPhase({ kind: 'problem', problem: 'locationDenied', retry: 'all' });
    },
    /** From the camera primer (or "Try again" after a block): open the camera, which asks for permission. */
    allowCamera: () => {
      setPrimed(true);
      restart('face');
    },
    confirmLocation: () => restart('face'),
    /** FaceCheck took the photo: match it (simulated), then pass. */
    faceCaptured: async (frame: CapturedFrame) => {
      const signal = run.current?.signal;
      if (!signal || signal.aborted) return;
      setPhase({ kind: 'matching' });
      const result = await verification.matchFace(ctx, frame, purpose);
      if (signal.aborted) return;
      if (!result.ok && result.error !== 'not_required') {
        const failures = faceFailures + 1;
        setFaceFailures(failures);
        const limited = limitReached(failures);
        return setPhase({ kind: 'problem', problem: limited ? 'faceLimit' : 'face', retry: limited ? 'none' : 'face' });
      }
      setPhase({ kind: 'faced' });
      if (!(await hold(HOLD_MS, signal))) return;
      await finish(signal, location);
    },
    /** The camera couldn't open, or the check couldn't see one clear face. */
    faceFailed: (error: FaceRunFailure) => {
      if (error === 'permission_denied') setPrimed(false);
      if (isCheckFailure(error)) {
        verification.faceCheckFailed(purpose); // voice counts the same tries as this screen
        const failures = faceFailures + 1;
        setFaceFailures(failures);
        setCheckFailures((n) => n + 1);
        if (limitReached(failures)) return setPhase({ kind: 'problem', problem: 'faceLimit', retry: 'none' });
      }
      setPhase({ kind: 'problem', problem: faceProblem(error, 'verify'), retry: 'face' });
    },
  };
}

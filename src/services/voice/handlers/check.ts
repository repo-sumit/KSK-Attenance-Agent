/**
 * A verification outcome other than the pass (D-086), for the check it belongs to: a batch's gateway, or the check
 * before the trainer's own attendance (D-141). Prompts are said once until the screen moves on; a camera that closes
 * with no face result means the check did not finish; failed face tries are counted as the screen counts them (a
 * mismatch, or a check that saw no clear face). The pass is the caller's: it opens the batch or saves the mark.
 */
import type { VerificationEvent } from '@/services/verification';
import { faceCheckUnfinishedEvent, verificationEvent } from '../app-events';
import type { VoiceView } from '../instructions';
import type { CheckMemory } from './base';

export function followCheck(v: CheckMemory, e: Exclude<VerificationEvent, { type: 'granted' }>, view: Pick<VoiceView, 'faceRetryLimit'>): string | null {
  if (e.type === 'prompt') {
    v.need = e.need; // the screen waits for this tap: "check again" cannot run before it
    const seen = `${e.purpose}|${e.need}`;
    if (v.prompts.has(seen)) return null;
    v.prompts.add(seen);
  } else {
    v.prompts.clear();
    v.need = null;
  }
  if (e.type === 'camera') {
    const unfinished = !e.on && v.cameraPending;
    v.cameraPending = e.on;
    if (unfinished) return faceCheckUnfinishedEvent(view);
  }
  if (e.type === 'face') {
    v.cameraPending = false;
    if (e.result !== 'match') v.faceFailures += 1; // a mismatch or a check that saw no clear face: one try, as the screen counts
  }
  return verificationEvent(e, view, v.faceFailures);
}

/**
 * `[APP]` events (voice design §5.3, D-085, D-086): what the app tells the model when something happens
 * outside a tool call: a session start or refresh, a tap, tap navigation, a verification outcome, a usage
 * limit. Ported verbatim from the MVP (MVP-07 L585-L702, MVP-08 §6, MVP-02 L762-L770, MVP-11 §4.4),
 * changing only names and protocol: KSK sessions and the shared draft, no "marks were discarded" (D-083),
 * confirm_token codes for confirmed=true (D-082). The verification texts follow PRD 8.4 and are built from
 * the plan. Every text starts with "[APP] " and goes out with sendRealtimeInput({ text }).
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import type { VoiceFlowState } from '@/domain/voice/flow';
import { safeText, toModelStatus } from '@/domain/voice/types';
import type { SessionCard } from '../attendance';
import type { VerificationEvent, VerificationNeed } from '../verification';
import type { ToolResult } from './tools';
import {
  byException, countsText, currentView, exceptionsText, markableNow, nothingOpen, openBatchInstruction, openDraft, openSessionIds, readSessions, readTrades,
  selectedLabel, stepHint, studentOf, viewCounts, type VoiceView,
} from './instructions';
import { distanceText, first, nameText, sessionLabel, statusWords, word } from './labels';

const CHANGED = '[APP] The trainer changed something on screen. Call get_status and continue from there.';

/** Voice starts fresh (not on a batch, nor on a trade's list it was opened on): the start says what can be marked now. */
export function freshStart(view: VoiceView): boolean {
  const { step } = view.flow;
  return step === 'IDLE' || step === 'SELECT_TRADE' || (step === 'SELECT_BATCH' && !view.plan.tradeStep);
}

/** Nothing can be marked: say so and ask what the trainer needs; voice stays open (D-142). */
const WHAT_NEXT = 'say that in one line, then ask "What do you need?". Then wait.';

export const hello = (languageName: string, greeting: string) =>
  `Greet the trainer by first name in one short line in ${nameText(languageName)} ("${greeting}, <first name>.")`;

/**
 * First message of a fresh connection, chosen by where the flow is (D-134): the trades to choose from, what can be marked
 * now with the ids to open it, or why nothing can be (then what the trainer needs: voice stays open, D-142); mid-flow it
 * re-reads the state. `greeting` comes from the clock
 * (greetingFor). With exactly one markable session the executor opens it itself and sends autoOpenEvent instead.
 * `board`: the trainer's sessions in every trade (with a trade step), so the trades read are those with one markable now.
 */
export function sessionStartEvent(view: VoiceView, languageName: string, greeting: string, board?: readonly SessionCard[]): string {
  if (!freshStart(view)) return '[APP] Session started again. Call get_status and continue from where we were.';
  const greet = hello(languageName, greeting);
  if (view.plan.tradeStep) {
    // only the trades with something markable now (the whole board, when it loaded); with none, why nothing can be marked
    const trades = board ? view.trades.filter((t) => board.some((c) => c.trade.id === t.id && markableNow(c))) : view.trades;
    const none = board && !trades.length ? nothingOpen({ ...view, cards: board }) : null;
    if (none) return `[APP] Session started. ${none} ${greet}, ${WHAT_NEXT}`;
    return `[APP] Session started. ${greet}, then ask which trade, reading the trade names: ${trades.map((t) => nameText(t.name)).join(', ')}. No tool call is needed before the trainer answers. When the trainer names one, call select_trade.`;
  }
  const nothing = nothingOpen(view);
  if (nothing) return `[APP] Session started. ${nothing} ${greet}, ${WHAT_NEXT}`;
  // one open session: readSessions already gives its id
  const ids = openSessionIds(view);
  const idText = ids.length > 1 ? ` Their ids for select_batch: ${ids.join('; ')}.` : '';
  return `[APP] Session started. ${greet}, then: ${readSessions(view)}${idText}`;
}

/** First message after the executor opened the only markable session itself (select_batch's own result follows the greeting). */
export function autoOpenEvent(result: ToolResult, label: string, languageName: string, greeting: string): string {
  // "do not call select_batch": live rehearsal, the model otherwise opened it a second time (one more round trip)
  const how = result.ok ? 'so the app opened it: do not call select_batch for it' : 'but it cannot be opened';
  return `[APP] Session started. Only ${label} can be marked now, ${how}. ${hello(languageName, greeting)}, then: ${result.instruction}`;
}

/** After Reconnect: the conversation re-reads the state. */
export const RECONNECT_EVENT = '[APP] Reconnected. Call get_status and continue from the current student.';

const askAgain = (question: string) => ` Your last question to the trainer was lost in the refresh: ask it again now, then wait. Its instruction was: ${question}`;
/** A question for the new connection when none was pending (the submit question at the review): nothing was lost. */
const askNow = (question: string) => ` The trainer is at the review. Ask this now, then wait: ${question}`;

/**
 * After Reconnect with a question for the new connection (the submit question at the review, with a code issued
 * for it): asked at once, so one clear yes submits. Otherwise the MVP contract, RECONNECT_EVENT.
 */
export function reconnectEvent(question: string | null): string {
  return question ? `[APP] Reconnected.${askNow(question)}` : RECONNECT_EVENT;
}

/**
 * After a goAway switch to a new connection: the resumed conversation can be a turn behind, so give the
 * facts and let the model repeat the current question. (Telling it to stay silent made it skip its next
 * reply too.) `pendingQuestion` is the instruction of a question still waiting for the trainer's answer (a
 * confirmation, or which of two students): it is asked again instead, so a "haan" is not taken for the
 * current student. `heard` is what the trainer last said (the words that led to that question), when there
 * is a caption: inert text, said only with a pending question (MVP-07). `lost` false: no question was pending, and
 * `pendingQuestion` is a new one for the new connection (the submit question at the review), asked without
 * saying anything was lost.
 */
export function refreshEvent(view: VoiceView, pendingQuestion: string | null, heard = '', lost = true): string {
  const head = '[APP] The connection was refreshed; trust these facts over your memory.';
  const { flow } = view;
  const lm = flow.lastMarked;
  const lmStudent = lm ? studentOf(view, lm.id) : null;
  // "Pichla galat tha" resolves through last_marked, and the resumed memory of it can be stale.
  const last =
    lm && lmStudent && (flow.step === 'ROLL_CALL' || flow.step === 'REVIEW')
      ? ` Last marked (for "the last one was wrong"): ${lmStudent.call_as} (id ${lm.id}), ${word(lm.status)}.`
      : '';
  const words = safeText(heard, 160);
  const said = pendingQuestion && words ? ` The trainer last said: "${words}" (already handled: do not act on it again).` : '';
  const ask = pendingQuestion ? `${said}${lost ? askAgain(pendingQuestion) : askNow(pendingQuestion)}` : '';
  const cur = currentView(view);
  if (flow.step === 'ROLL_CALL' && cur) {
    return `${head} Current student: ${cur.call_as} (id ${cur.id}). Counts: ${countsText(viewCounts(view), true)}.${last}${ask || ` Say only: ${cur.call_as}? Then stop and wait.`}`;
  }
  return `${head}${last}${ask || ` ${stepHint(view)}`}`;
}

/**
 * A status tap on any student: the current one, an earlier one (a correction), or the last one left.
 * `prev` and `next` are the flow before and after the tap; `view.draft` already holds the tap. `token` is the
 * code of the submit ticket the executor issued when the tap left everyone marked (the review), as reviewEvent.
 * `missing`: what still keeps the batch from being complete (a half or leave type still to choose on screen, or
 * someone without a status): then the submit question is not asked (it is, with its code, once nothing is missing).
 */
export function tapMarkEvent(
  prev: VoiceFlowState, next: VoiceFlowState, view: VoiceView, studentId: string, token?: string, missing: 'detail' | 'unmarked' | null = null,
): string {
  const v: VoiceView = { ...view, flow: next };
  const st = studentOf(v, studentId);
  const mark = openDraft(v)?.marks[studentId];
  if (!st || !mark?.status) return CHANGED;
  const said = `"${first(st.name)} ${statusWords(mark)}"`;
  const head = `[APP] Trainer tapped ${toModelStatus(mark.status)} for ${st.call_as} (id ${st.id}) on screen. Already saved, do not mark again. This is now last_marked.`;
  if (byException(v)) {
    // marking by exception on screen: the trainer is tapping through the list, do not talk over it
    return `${head} Counts: ${countsText(viewCounts(v))}. Say nothing now; wait for the trainer.`;
  }
  const cur = currentView(v);
  if (!cur && missing) {
    const why = missing === 'unmarked'
      ? 'Some students still have no status. Call get_status and continue from there.'
      : 'The trainer is still choosing a detail on screen (the half or the leave type). Say nothing more; wait for the trainer.';
    return `${head} Counts: ${countsText(viewCounts(v), true)}. Confirm ${said} in 2 to 4 words. ${why}`;
  }
  if (!cur) {
    const code = token ? ` Call submit_attendance with confirm_token "${nameText(token)}" only after a clear yes.` : '';
    return `${head} Everyone is marked: ${countsText(viewCounts(v))}. Confirm ${said} in 2 to 4 words, then read the counts, say submit is final and ask whether to submit.${code}`;
  }
  const counts = `Counts: ${countsText(viewCounts(v), true)}.`;
  // The pointer moved (the current student was tapped): call the next one. Otherwise a correction of someone else.
  if (prev.currentId !== next.currentId) {
    return `${head} Next student is ${cur.call_as} (id ${cur.id}). ${counts} Confirm ${said} in 2 to 4 words, then call out: ${cur.call_as}. Then stop and wait.`;
  }
  return `${head} Current student is still ${cur.call_as} (id ${cur.id}). ${counts} Confirm ${said} in a few words, then repeat: ${cur.call_as}. Then stop and wait.`;
}

/** A tap on a trade in the trade list. */
export function tradeEvent(view: VoiceView): string {
  const trade = view.trades.find((t) => t.id === view.flow.tradeId);
  if (!trade) return CHANGED;
  return `[APP] Trainer chose ${nameText(trade.name)} on screen. ${readSessions(view)}`;
}

/**
 * A batch opened on screen (a tap, or the pass after verification): marking starts. `submitToken`: everyone already
 * had a status, so the batch opened at the review and the submit question carries this code.
 */
export function batchEvent(view: VoiceView, submitToken?: string): string {
  const label = selectedLabel(view);
  const draft = openDraft(view);
  if (!label || !draft) return CHANGED;
  const cur = currentView(view);
  const reopened = Object.keys(draft.sources).length > 0;
  const firstOne = cur ? ` The ${reopened ? 'current' : 'first'} student is ${cur.call_as} (id ${cur.id}).` : '';
  return `[APP] Trainer opened ${label} on screen.${firstOne} ${openBatchInstruction(view, submitToken)}`;
}

/** A batch opened on screen that is already submitted and locked: as select_batch's ALREADY_SUBMITTED, never an open-batch instruction. */
export function lockedBatchEvent(view: VoiceView): string {
  const label = view.card ? sessionLabel(view.card, view.plan.slotWords) : 'a batch';
  return `[APP] Trainer opened ${label} on screen. It was already submitted today and is locked; the screen shows what was saved. Say so in one short line and ask for another batch.`;
}

/** Back to the batches of a trade, the trainer's batch list, or the trade list (marks stay in the draft, D-083). */
export function backEvent(view: VoiceView): string {
  const { flow, plan } = view;
  if (!plan.tradeStep) return `[APP] Trainer went back to the batch list on screen. ${readSessions(view)}`;
  const trade = flow.step === 'SELECT_BATCH' ? view.trades.find((t) => t.id === flow.tradeId) : undefined;
  if (trade) return `[APP] Trainer went back to the batches of ${nameText(trade.name)} on screen. ${readSessions(view)}`;
  return `[APP] Trainer went back to the trade list on screen. ${readTrades(view.trades)}`;
}

/**
 * The trainer opened the review on screen (before submit). With the code of a confirmation ticket the
 * executor issued for it, a clear yes submits at once; without one, submit_attendance asks for its code first.
 * `opened`: the review was the first the executor heard of this batch, so it names the batch.
 */
export function reviewEvent(view: VoiceView, token?: string, opened = false): string {
  const named = exceptionsText(view);
  const code = token ? ` with confirm_token "${nameText(token)}"` : '';
  const label = opened ? selectedLabel(view) : undefined;
  return `[APP] Trainer opened the review${label ? ` of ${label}` : ''} on screen: ${countsText(viewCounts(view))}${named ? ` (${named})` : ''}. Read the counts in one line, say submit is final and ask whether to submit. Call submit_attendance${code} only after a clear yes.`;
}

/** From the review back to the list. */
export function listEvent(view: VoiceView): string {
  const cur = currentView(view);
  return `[APP] Trainer went back to the student list on screen to change something.${cur ? ` The current student is ${cur.call_as} (id ${cur.id}).` : ''} Say nothing now; wait for the trainer.`;
}

/** The on-screen Submit: pass on the submit result's own instruction. */
export function submitEvent(instruction: string): string {
  return `[APP] Trainer pressed Submit on screen. ${instruction}`;
}

const REMEDY = ' Say so in one short line, in the trainer\'s language. Then wait; the trainer can say "check again" or go back.';

const NEEDS: Readonly<Record<VerificationNeed, string>> = {
  location_permission: 'allow location on the screen',
  camera_permission: 'allow the camera on the screen',
  confirm_location: 'tap Continue on the screen',
  face_enrolment: 'register their face on the screen first',
};

function locationText(e: Extract<VerificationEvent, { type: 'location' }>): string | null {
  switch (e.result) {
    case 'inside':
    case 'tagged':
      return null; // PRD 8.4: no message when the location matches; tagging has no voice line (PRD 8.1)
    case 'outside':
      return typeof e.distanceM === 'number'
        ? `[APP] Location check failed: the trainer is ${distanceText(e.distanceM)} from the institute; attendance can only be marked at the institute. Say this in one short sentence with the exact distance. Checking again will not help until they are there.`
        : '[APP] Location check failed: the trainer is outside the institute; attendance can only be marked at the institute. Say this in one short sentence. Checking again will not help until they are there.';
    case 'permission_denied':
      return `[APP] The phone does not allow the location: the trainer must allow it to mark attendance.${REMEDY}`;
    case 'unavailable':
      return `[APP] The phone could not get a location: location (GPS) may be turned off.${REMEDY}`;
    case 'timeout':
      return `[APP] The phone could not find the location in time: the trainer should step outside or near a door or window.${REMEDY}`;
  }
}

/**
 * A failed face try: retry (PRD 8.4), until a configured limit is reached. `failures` counts the tries as the screen
 * does: a face that did not match, or a check that could not see one clear face (`checkFailed`).
 */
function faceText(limit: number | null, failures: number, checkFailed: boolean): string {
  const what = checkFailed ? 'the camera could not see one clear face' : 'the face did not match';
  if (limit !== null && failures >= limit) {
    return `[APP] Face check failed: ${what}, and no tries are left. Say in one short line, in the trainer's language: please ask your principal to mark your attendance today. Then wait.`;
  }
  const left = limit === null ? 'retry is unlimited' : `${limit - failures} ${limit - failures === 1 ? 'try' : 'tries'} left`;
  if (checkFailed) return `[APP] Face check failed: ${what}. Ask the trainer in one short line to follow the screen and try again (${left}). Then wait for the next [APP] message.`;
  return `[APP] Face check failed: ${what}. Ask the trainer to face the light and try again (${left}).`;
}

/** The tap a screen prompt waits for, as the model asks for it. */
export const needText = (need: VerificationNeed): string => NEEDS[need];

/**
 * A verification outcome as the model hears it, or null when there is nothing to say. `faceFailures`
 * counts the failed face tries of this session so far (as the screen counts them), this one included. A pass is null: the
 * executor opens the batch and sends batchEvent.
 */
export function verificationEvent(e: VerificationEvent, view: Pick<VoiceView, 'faceRetryLimit'>, faceFailures: number): string | null {
  switch (e.type) {
    case 'location':
      return locationText(e);
    case 'face':
      return e.result === 'match' ? null : faceText(view.faceRetryLimit ?? null, faceFailures, e.result === 'check_failed');
    case 'camera':
      return e.on ? '[APP] The face camera is open. Say nothing until the next [APP] message.' : null;
    case 'prompt':
      return `[APP] The screen is waiting for the trainer. In one short line, in the trainer's language, ask them to ${NEEDS[e.need]}. Then wait for the next [APP] message.`;
    case 'granted':
      return null;
  }
}

/** The camera went off with no face result: the check did not finish (the executor decides when to send it). */
export function faceCheckUnfinishedEvent(_view: Pick<VoiceView, 'faceRetryLimit'>): string {
  return '[APP] The face check did not finish. Ask the trainer in one short line to follow the screen and try again. Then wait for the next [APP] message.';
}

const LIMITS = {
  session_limit: '[APP] Voice time for this session is up. Say in one short line that Voice Agent stops now and the marks on screen are kept. Do not call any tool.',
  daily_limit: "[APP] Today's voice time is used up. Say in one short line that Voice Agent stops now and the trainer can go on with the screen. Do not call any tool.",
  idle: '[APP] Nobody has spoken for a while, so Voice Agent stops now. Say goodbye in a few words; the attendance on screen is kept. Do not call any tool.',
} as const;

/** A usage cap stops Voice Agent: one goodbye line (the session stops a few seconds later). */
export function limitEvent(reason: 'session_limit' | 'daily_limit' | 'idle'): string {
  return LIMITS[reason];
}

/** Use screen (voice design §9): the mic is off and the agent stays quiet until Resume. */
export const PAUSE_EVENT = '[APP] The trainer is using the screen. Say nothing until the next [APP] message.';

/** Resume after Use screen: taps made meanwhile were not told, so the model re-reads the state. */
export const RESUME_EVENT = '[APP] The trainer is back. Call get_status and continue from the current student.';

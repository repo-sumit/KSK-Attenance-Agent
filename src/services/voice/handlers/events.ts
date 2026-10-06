/**
 * The executor's hooks for what happens outside a tool call (voice design §5.3, D-085, D-086): a tap on the
 * shared draft, tap navigation, and the verification gateway's outcomes. Each one updates the flow and
 * returns the `[APP]` text the model hears (MVP-07 tap events, MVP-11 §4.4), or null when there is nothing
 * to say. Voice's own changes and the screens' draft rebuilds are silent.
 */
import { completenessIssues } from '@/domain/marking';
import { advance, uncalledIds, withBatchList, withList, withMarked, withOpening, withReview, withSubmitted, withTrade, withTradeList } from '@/domain/voice/flow';
import { routes } from '@/lib/routes';
import { toLocalDate } from '@/lib/time';
import type { SessionCard } from '@/services/attendance';
import type { DraftChange } from '@/services/marking-draft';
import { purposeKey, type VerificationEvent } from '@/services/verification';
import type { ScreenSignal } from '../executor';
import { backEvent, batchEvent, listEvent, lockedBatchEvent, reviewEvent, submitEvent, tapMarkEvent, tradeEvent } from '../app-events';
import { openDraft, selectedLabel, verifyingInstruction, type VoiceView } from '../instructions';
import { followCheck } from './check';
import { markingStep as marking, type HandlerContext } from './context';
import { listDone, reviewTicket, toReview } from './review';
import { nextSessions, submittedInstruction } from './submit';

/**
 * A change to the shared draft. Any change voids the open confirmation (D-082). Only a tap on the session
 * being marked moves the flow and is told to the model; 'opened' and 'closed' are rebuilds and discards.
 * (No tap reaches here while a submit saves the draft: MarkingDraftService holds it until the submit ends.)
 * A tap that leaves everyone marked moves to the review and asks the submit question with a new code. While the
 * session is quiet (paused by Pause, or not live) the flow follows the tap and nothing is said: no code is
 * issued and the screen is not moved to the review; on Resume, get_status asks with the review as usual.
 */
export function draftChangeEvent(h: HandlerContext, change: DraftChange, quiet = false): string | null {
  h.state.ticket = null;
  const flow = h.state.flow;
  if (change.via !== 'tap' || change.key !== flow.sessionKey || !change.after || !marking(flow.step)) return null;
  if (change.kind === 'submitted') {
    h.state.submitted = { key: change.key, snapshot: change.after };
    h.state.flow = withSubmitted(flow);
    // a listener is synchronous: what can be marked next comes from the trainer's whole board as last loaded (every
    // trade: the kickoff loads it all; this session is left out of the offer)
    const view = h.viewOf();
    return submitEvent(submittedInstruction(h.deps.plan, view.card, nextSessions(h.state.board)));
  }
  const id = change.studentIds.at(-1);
  if ((change.kind !== 'mark' && change.kind !== 'bulk') || !id) return null;
  const draft = h.draftView(change.after);
  const status = change.after.marks[id]?.status;
  const marked = change.kind === 'mark' && status ? withMarked(flow, draft, id, status) : flow;
  h.state.flow = marked === flow ? advance(flow, draft) : marked;
  if (listDone(h.viewOf({ draft: change.after }))) toReview(h); // the list the trainer went back to is done again
  const view = h.viewOf({ draft: change.after });
  if (h.state.flow.currentId && h.state.flow.currentId !== flow.currentId) h.focus(view);
  if (quiet) return null; // nobody would hear the question: no ticket, no review pushed over the trainer's screen
  // the ticket of this revision: the old one was voided above
  const token = reviewTicket(h, view);
  // a half or a leave type still to choose on screen, or someone without a status: not everyone is marked yet
  const issues = completenessIssues(change.after.marks, h.deps.ctx.config.marking);
  const missing = issues.length ? (issues.some((i) => i.kind === 'unmarked') ? 'unmarked' : 'detail') : null;
  return tapMarkEvent(flow, h.state.flow, view, id, token ?? undefined, missing);
}

/** The href a screen signal stands for, built with routes.* (compared with what voice navigated to). */
function hrefOf(signal: ScreenSignal): string | null {
  switch (signal.kind) {
    case 'home':
      return routes.home;
    case 'trade':
      return routes.trade(signal.tradeId);
    case 'self':
      return routes.selfAttendance;
    case 'other':
      return null;
    default:
      return routes[signal.kind](signal.sessionKey);
  }
}

/**
 * A submitted batch of today on screen (a tap on its card, or its list or review reached another way): it is locked,
 * said as select_batch says it, never an open-batch instruction. The screen left any open batch (its marks stay,
 * D-083), and a live draft of the submitted batch is closed. Another day's record (a typed URL) is only browsing:
 * nothing is said and the flow stays.
 */
function lockedOnScreen(h: HandlerContext, card: SessionCard): string | null {
  if (card.address.date !== toLocalDate(h.deps.ctx.clock.now())) return null;
  h.deps.drafts.close(card.key, { kind: 'closed', via: 'system' });
  if (h.state.flow.sessionKey) h.state.flow = withBatchList(h.state.flow);
  return lockedBatchEvent(h.viewOf({ card, draft: undefined }));
}

/** Everyone in the open batch already has a status and no detail is missing: nobody to call, the review is next. */
function allSet(h: HandlerContext, view: VoiceView): boolean {
  const draft = openDraft(view);
  return !!draft && !uncalledIds(h.draftView(draft)).length && !completenessIssues(draft.marks, h.deps.ctx.config.marking).length;
}

/**
 * The batch just opened (or shown again) with everyone set: the review, and the submit question with its code, as
 * select_batch does. While the session is quiet the flow moves to the review only: no code, the review is not pushed
 * over the trainer's screen and nothing is said (as for a quiet tap); on Resume, get_status asks with the review.
 */
function openedAtReview(h: HandlerContext, quiet: () => boolean): string | null {
  const done = toReview(h);
  if (quiet()) return null;
  return batchEvent(done, reviewTicket(h, done) ?? undefined);
}

/** A batch opened on screen (a tap on a card with a pass, or the gateway after the check); null when nothing opened. */
async function openedOnScreen(h: HandlerContext, key: string, quiet: () => boolean): Promise<{ readonly text: string | null; readonly opened: boolean } | null> {
  const card = await h.deps.attendance.findCard(h.deps.ctx, key);
  if (!card) return null;
  if (card.status === 'submitted') return { text: lockedOnScreen(h, card), opened: false };
  const opened = await h.openBatch(card);
  if (!opened.ok) return null;
  if (allSet(h, opened.view)) return { text: openedAtReview(h, quiet), opened: true };
  h.focus(opened.view); // the first student the agent calls is marked current on the list (m13)
  return { text: batchEvent(opened.view), opened: true };
}

/**
 * Tap navigation (MVP tapTrade, tapBatch, tapBack*, tapReview, tapBackToList). A screen that voice just
 * navigated to, or that already matches the flow, says nothing. A trade or session id from the route only
 * selects among the cards and trades the services return. `quiet` (read when the question would be asked): the
 * session would drop the text (paused by Pause, or not live), so, as for a quiet tap, the flow follows the
 * screen but no code is issued and no screen is pushed; Resume's get_status asks with the review.
 * A trade-switcher tap (Home's local trade, no route of its own) leaves what voice knows of the screen alone.
 */
export async function screenEvent(h: HandlerContext, signal: ScreenSignal, quiet: () => boolean = () => false): Promise<string | null> {
  const { ctx, plan, verification, drafts } = h.deps;
  if (signal.kind !== 'trade' || plan.selection !== 'trade_switcher') {
    const href = hrefOf(signal);
    const voiceDidIt = href !== null && href === h.state.lastNav;
    h.state.lastNav = null;
    h.state.screen = href;
    const away = signal.kind === 'self' ? 'my_attendance' : signal.kind === 'other' ? (signal.screen ?? 'other') : null;
    // the real screen is always kept, a tap to Reports or My attendance during a batch's check included; while the batch
    // waits for its check, awayNow (executor.ts) hides it, so a detour on the way (face enrolment) is not read as away
    h.state.away = away;
    // My attendance moves no batch flow (its check is followed by ./self)
    if (voiceDidIt || signal.kind === 'other' || signal.kind === 'self') return null;
  }
  const flow = h.state.flow;
  switch (signal.kind) {
    case 'home': {
      const tradeList = plan.selection === 'trade_picker' || plan.selection === 'trade_switcher';
      if (flow.step === (tradeList ? 'SELECT_TRADE' : 'SELECT_BATCH')) return null;
      h.state.flow = tradeList ? withTradeList(flow) : withBatchList(flow);
      return backEvent(await h.view());
    }
    case 'trade': {
      const known = plan.tradeStep && h.viewOf().trades.some((t) => t.id === signal.tradeId);
      if (!known || (flow.step === 'SELECT_BATCH' && flow.tradeId === signal.tradeId)) return null;
      const chose = flow.step === 'SELECT_TRADE' || flow.tradeId !== signal.tradeId;
      h.state.flow = withTrade(flow, signal.tradeId);
      const view = await h.view();
      return chose ? tradeEvent(view) : backEvent(view);
    }
    case 'open': {
      if (flow.step === 'VERIFY' && flow.sessionKey === signal.sessionKey) return null;
      const card = await h.deps.attendance.findCard(ctx, signal.sessionKey);
      if (!card || card.status !== 'open' || !card.canMark) return null; // the gateway shows the reason itself
      // with a pass (or no check) the gateway goes straight to the list, and that screen opens the batch
      if (!plan.verification.required || (await verification.hasPass(ctx, { kind: 'session', key: card.key }))) return null;
      const from = h.state.flow;
      h.state.flow = withOpening(plan.tradeStep && from.tradeId !== card.trade.id ? withTrade(from, card.trade.id) : from, card.key);
      h.startVerify(card.key); // the gateway screen starts its own count again
      const view = h.viewOf({ card, draft: undefined });
      return `[APP] Trainer chose ${selectedLabel(view) ?? 'a batch'} on screen. ${verifyingInstruction(view)}`;
    }
    case 'mark': {
      if (flow.sessionKey === signal.sessionKey && flow.step === 'ROLL_CALL') {
        // the gateway's list after a pass that found everyone set: the question waited for this screen (see verificationHook)
        if (h.state.askOnList !== signal.sessionKey) return null;
        h.state.askOnList = null;
        return allSet(h, h.viewOf()) ? openedAtReview(h, quiet) : null;
      }
      if (flow.sessionKey === signal.sessionKey && flow.step === 'SUBMITTED') return null;
      if (flow.sessionKey === signal.sessionKey && flow.step === 'REVIEW') {
        const draft = drafts.get(signal.sessionKey);
        if (!draft) return null;
        h.state.ticket = null; // the trainer left the review: a later yes is asked again, never taken for the old question
        h.state.flow = withList(flow, h.draftView(draft));
        return listEvent(h.viewOf());
      }
      return (await openedOnScreen(h, signal.sessionKey, quiet))?.text ?? null;
    }
    case 'review': {
      if (flow.sessionKey === signal.sessionKey && flow.step === 'REVIEW') return null;
      const onIt = flow.sessionKey === signal.sessionKey && flow.step === 'ROLL_CALL';
      const opened = onIt ? null : await openedOnScreen(h, signal.sessionKey, quiet);
      if (!onIt && !opened?.opened) return opened?.text ?? null;
      const draft = drafts.get(signal.sessionKey);
      // the batch facts are kept: a batch just opened whose review cannot submit yet is told as opened
      if (!draft || h.state.flow.sessionKey !== signal.sessionKey || completenessIssues(draft.marks, ctx.config.marking).length) return opened?.text ?? null;
      h.state.flow = withReview(h.state.flow);
      // quiet, or the screen's Submit already saving it: no code (its submit event tells the model the outcome)
      if (quiet() || drafts.isSubmitting(signal.sessionKey)) return null;
      // a ticket with the review, so one clear yes submits (Task 9 handoff)
      const token = h.issue('submit_attendance', signal.sessionKey, signal.sessionKey);
      return reviewEvent(await h.view(), token, !!opened);
    }
    default: {
      // submitted / record of the session being marked: it is locked now (the tap's submit event told the model)
      if (flow.sessionKey === signal.sessionKey) {
        if (marking(flow.step)) h.state.flow = withSubmitted(flow);
        return null;
      }
      // another batch's record or result while a batch is open by voice: only browsing, nothing is said and the
      // open batch stays: a report, or another day's record (a typed URL)
      if (marking(flow.step)) return null;
      // another batch's record or result: a submitted batch opened on screen
      const card = await h.deps.attendance.findCard(ctx, signal.sessionKey);
      return card?.status === 'submitted' ? lockedOnScreen(h, card) : null;
    }
  }
}

/**
 * A verification outcome (D-086) for the session being verified only: events of an earlier check or
 * another purpose are dropped. Prompts are said once until the screen moves on; a camera that closes with
 * no face result means the check did not finish; failed face tries are counted as the screen counts them
 * (a mismatch, or a check that saw no clear face); the pass opens the batch.
 */
export async function verificationHook(h: HandlerContext, e: VerificationEvent): Promise<string | null> {
  const flow = h.state.flow;
  const key = flow.sessionKey;
  if (flow.step !== 'VERIFY' || !key || e.purpose !== purposeKey({ kind: 'session', key })) return null;
  const v = h.verifyFor(key);
  if (e.type !== 'granted') return followCheck(v, e, h.viewOf());
  v.prompts.clear();
  v.need = null;
  const card = await h.deps.attendance.findCard(h.deps.ctx, key);
  const opened = card && h.state.flow.step === 'VERIFY' && h.state.flow.sessionKey === key ? await h.openBatch(card) : null;
  if (!opened?.ok) return null;
  // Everyone already set: the gateway now replaces itself with the list, and that screen signal asks the submit
  // question with its code. Pushing the review from here would race that signal (it would take the review back).
  if (allSet(h, opened.view)) {
    h.state.askOnList = key;
    return null;
  }
  h.focus(opened.view); // the first student the agent calls is marked current on the list (m13)
  return batchEvent(opened.view);
}

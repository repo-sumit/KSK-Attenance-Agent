/**
 * submit_attendance (MVP-05 §10, MVP-04 §4.18) with confirmation tokens (D-082) and AttendanceService in
 * place of the POST: the precondition chain (step, open draft, completeness, window), then the review and
 * NEEDS_CONFIRMATION, then one in-flight submit per session key shared by any concurrent call. The draft
 * and the flow are read again after every await: a tap may have changed them meanwhile (Review Focus 3).
 * While the service saves, the draft is held (no tap or voice mark is taken), so the snapshot that was sent is the record;
 * while the screen's Submit holds it, submit_attendance issues no code and says it is being submitted (SUBMITTING).
 * Any other result that leaves the flow in REVIEW asks the same question with its code (./review).
 */
import { routes } from '@/lib/routes';
import { completenessIssues } from '@/domain/marking';
import type { SessionKey } from '@/domain/attendance';
import { withReview, withSubmitted } from '@/domain/voice/flow';
import type { FlowPlan } from '@/domain/voice/plan';
import type { SessionCard } from '@/services/attendance';
import type { DraftSnapshot } from '@/services/marking-draft';
import { confirmSubmitInstruction, currentView, markableNow, nextOpening, openDraft, stepHint, viewCounts, type VoiceView } from '../instructions';
import { countsOf, sessionLabel, spokenTime, studentView, type StudentView } from '../labels';
import { SELF_FIRST_INSTRUCTION } from '../staff-texts';
import type { ToolResult } from '../tools';
import { fail, markingStep as marking, wrongStep, type Handler, type HandlerContext } from './context';
import { askReview } from './review';

const labelFor = (plan: FlowPlan, card: SessionCard | undefined) => (card ? sessionLabel(card, plan.slotWords) : 'this batch');

/** What can be marked after a submit (D-134): the trainer's markable sessions in every trade, and when the next window opens. */
export interface NextSessions {
  readonly open: readonly SessionCard[];
  readonly nextOpensAt?: string;
}

/** NextSessions from the trainer's whole board (every trade), as loaded after the lock. */
export function nextSessions(cards: readonly SessionCard[]): NextSessions {
  const nextOpensAt = nextOpening(cards);
  return { open: cards.filter(markableNow), ...(nextOpensAt ? { nextOpensAt } : {}) };
}

/**
 * What to say after a submit, by voice or by the on-screen button (MVP C11, D-134): offer the next markable session by its
 * id, or, with none, say when the next one opens and wait: voice stays open for everything else (D-142).
 */
export function submittedInstruction(plan: FlowPlan, card: SessionCard | undefined, next?: NextSessions): string {
  const slot = card?.address.slot;
  const later = slot?.kind === 'half' && slot.part === 1 ? ` The ${plan.slotWords === 'signin_signout' ? 'sign out' : 'second half'} attendance of this batch is marked later today.` : '';
  const again = ' If the trainer asks to submit again, call submit_attendance again: the app refuses it and says why.';
  const head = `Attendance for ${labelFor(plan, card)} is submitted and locked.${later}`;
  // the same trade first (the board covers every trade: never leave a trade that still has one open)
  const others = next?.open.filter((c) => c.key !== card?.key) ?? [];
  const other = others.find((c) => c.trade.id === card?.trade.id) ?? others[0];
  if (other) {
    return `${head} Say "submitted" in a few words, then ask whether to open ${sessionLabel(other, plan.slotWords)} next, in one short question. On yes, call select_batch with id ${other.key}.${again}`;
  }
  const when = next?.nextOpensAt ? ` (the next ${plan.slotWords === 'period' ? 'period' : 'batch'} opens at ${next.nextOpensAt})` : '';
  return `${head} Say in one short line that it is submitted and nothing else can be marked right now${when}, then stop and wait for the trainer.${again}`;
}

/** Nobody may be left without a status, and no tapped half day or leave without its detail (MVP-05 §10.2). */
function incomplete(h: HandlerContext, view: VoiceView, draft: DraftSnapshot): ToolResult | null {
  const issues = completenessIssues(draft.marks, h.deps.ctx.config.marking);
  if (!issues.length) return null;
  const counts = countsOf(draft, h.deps.plan.statuses);
  const who = (id: string): StudentView[] => {
    const st = draft.students.find((s) => s.id === id);
    return st ? [studentView(st, draft.students)] : [];
  };
  const unmarked = issues.find((i) => i.kind === 'unmarked');
  if (unmarked) {
    const people = unmarked.studentIds.flatMap(who);
    const cur = currentView(view);
    const next = cur ? `then call out: ${cur.call_as}` : `then ask about ${people.slice(0, 5).map((p) => p.call_as).join('; ')}`;
    return fail('INCOMPLETE', `${people.length} students are not marked yet, so attendance cannot be submitted. Say so briefly, ${next}.`, {
      unmarked: people.map((p) => ({ id: p.id, name: p.name, call_as: p.call_as })),
      counts,
    });
  }
  const pending = issues.flatMap((i) => i.studentIds.flatMap(who).map((sv) => ({ sv, half: i.kind === 'half' })));
  const need = pending.map((p) => `${p.sv.call_as} (${p.half ? 'first or second half' : 'which leave'})`).join('; ');
  return fail('INCOMPLETE', `These students were tapped on screen but still need a detail: ${need}. Ask the trainer, then call set_student_status for each with it. Then ask about submitting again.`, {
    pending: pending.map((p) => ({ id: p.sv.id, name: p.sv.name })),
    counts,
  });
}

function windowClosed(plan: FlowPlan, card: SessionCard | undefined, before: boolean): ToolResult {
  const closes = card?.scheduled.window ? spokenTime(card.address.date, card.scheduled.window.end) : undefined;
  const when = before ? 'closed before this submit' : `closed${closes ? ` at ${closes}` : ''}`;
  return fail('WINDOW_CLOSED', `The attendance window for ${labelFor(plan, card)} ${when}, so nothing was saved; only the principal can correct it now. Say so in one short line.`, closes ? { closes } : {});
}

function alreadySubmitted(plan: FlowPlan, view: VoiceView): ToolResult {
  const id = view.card?.submission?.id;
  return fail('ALREADY_SUBMITTED', `Attendance for ${labelFor(plan, view.card)} was already submitted today and is locked. Say so in one short line.`, { ...(id ? { submission_id: id } : {}), counts: viewCounts(view) });
}

/**
 * Locked now: close the live draft and keep the snapshot that was sent (the draft was held while it saved, so
 * it is the record), then move the flow and the screen only if they are still on it (MVP `same`). When the
 * screen's own Submit won the race, its submit event already recorded what it sent and its screen moves
 * itself: both are left as they are.
 */
function lockSession(h: HandlerContext, key: SessionKey, sent: DraftSnapshot, how: 'submitted' | 'closed', href: string): void {
  h.deps.drafts.close(key, how === 'submitted' ? { kind: 'submitted', via: 'voice', sent } : { kind: 'closed', via: 'system' });
  if (how === 'submitted' || h.state.submitted?.key !== key) h.state.submitted = { key, snapshot: { ...sent, locked: true } };
  if (h.state.flow.sessionKey !== key || !marking(h.state.flow.step)) return;
  h.state.flow = withSubmitted(h.state.flow);
  h.navigate(href, true);
}

/** The draft closed while the submit flushed it: submitted on screen meanwhile (as the precheck would say then), or discarded. */
async function closedMeanwhile(h: HandlerContext, key: SessionKey): Promise<ToolResult> {
  const card = await h.deps.attendance.findCard(h.deps.ctx, key);
  if (card?.status !== 'submitted') return wrongStep(await h.view());
  const flow = h.state.flow;
  const onIt = flow.sessionKey === key;
  if (onIt && marking(flow.step)) h.state.flow = withSubmitted(flow); // the screen moves itself
  return alreadySubmitted(h.deps.plan, onIt ? h.viewOf({ card }) : h.viewOf({ card, draft: undefined }));
}

/**
 * The confirmed submit: flush, then hold the draft (MarkingDraftService.beginSubmit, the guard the screen's Submit
 * shares) while its marks are saved and the answer is mapped (MVP-05 §10.6). A tap or a voice mark meanwhile is
 * refused by the draft, so what was sent is exactly what is stored and kept.
 */
async function send(h: HandlerContext, key: SessionKey, card: SessionCard | undefined): Promise<ToolResult> {
  const { drafts } = h.deps;
  await drafts.flush(key);
  const sent = drafts.beginSubmit(key);
  if (!sent) return closedMeanwhile(h, key);
  try {
    return await saveHeld(h, key, card, sent);
  } finally {
    drafts.endSubmit(key);
  }
}

async function saveHeld(h: HandlerContext, key: SessionKey, card: SessionCard | undefined, sent: DraftSnapshot): Promise<ToolResult> {
  const { ctx, attendance, plan } = h.deps;
  const counts = countsOf(sent, plan.statuses);
  const result = await attendance.submit(ctx, key, sent.marks);
  if (result.ok) {
    h.deps.bus.emit({ type: 'saved', what: 'submit' }); // the "saved" cue (D-156)
    lockSession(h, key, sent, 'submitted', routes.submitted(key));
    // what can be marked now across all the trainer's trades, loaded after the lock (in one go with the view on offer;
    // the board as last loaded if loading fails: the submit is saved)
    const cards = await Promise.all([h.view(), h.wholeBoard()]).then(([, board]) => board, () => h.state.board);
    return { ok: true, step: 'SUBMITTED', submission_id: result.value.id, counts, instruction: submittedInstruction(plan, card, nextSessions(cards)) };
  }
  const label = labelFor(plan, card);
  switch (result.error) {
    case 'already_submitted': {
      lockSession(h, key, sent, 'closed', routes.record(key));
      const id = (await attendance.findCard(ctx, key))?.submission?.id;
      return fail('ALREADY_SUBMITTED', `${label} was already submitted today (it was saved before this submit). Nothing new was saved. Say so in one short line.`, id ? { submission_id: id } : {});
    }
    case 'window_closed':
      return windowClosed(plan, card, true);
    case 'not_verified':
      return fail('NOT_VERIFIED', `The location and face check for ${label} is missing, so nothing was saved. Say so in one short line; the trainer opens the batch again to be checked.`);
    case 'self_first': // own attendance first (D-152), its record gone meanwhile (a shared reset): a retry would fail the same way
      return fail('SELF_FIRST', SELF_FIRST_INSTRUCTION);
    case 'incomplete':
      return incomplete(h, h.viewOf({ draft: sent }), sent) ?? fail('INCOMPLETE', 'Some students are not marked yet, so nothing was saved. Call get_status and continue from there.', { counts });
    default:
      return fail('SUBMIT_FAILED', `Saving failed (${result.error}). Nothing was submitted. Say so briefly and offer to try again.`, { counts, reason: result.error });
  }
}

export const submitAttendance: Handler = async (h, args) => {
  const view = await h.view();
  const { flow, plan } = view;
  const key = flow.sessionKey;
  if (flow.step === 'SUBMITTED' && key) return alreadySubmitted(plan, view);
  if (!key || (flow.step !== 'ROLL_CALL' && flow.step !== 'REVIEW')) return wrongStep(view);
  const running = h.state.inFlight.get(key);
  if (running) return running; // a second call while the submit runs shares its result
  // the screen's Submit is saving the draft: no code (a yes would start a second save), it is said to wait
  if (view.submitting) return fail('SUBMITTING', stepHint(view), { step: flow.step });
  const draft = openDraft(view);
  if (!draft || draft.locked) return wrongStep(view);
  const missing = incomplete(h, view, draft);
  if (missing) return missing;
  if (view.card?.status === 'closed') return windowClosed(plan, view.card, false);
  if (!h.confirm('submit_attendance', key, key, args.confirm_token)) {
    // The review (PRD 12.1: the counts before a final submit), by voice and on screen.
    h.state.flow = withReview(h.state.flow);
    const token = askReview(h, key);
    const next = h.viewOf({ flow: h.state.flow });
    return fail('NEEDS_CONFIRMATION', confirmSubmitInstruction(next, token), { counts: viewCounts(next), confirm_token: token });
  }
  const run = send(h, key, view.card).finally(() => h.state.inFlight.delete(key));
  h.state.inFlight.set(key, run);
  return run;
};

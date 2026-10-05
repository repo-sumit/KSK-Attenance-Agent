/**
 * get_status of the marking flow (MVP-04 §4.10; voice design §7; end_voice_session is in ./capabilities). It never changes a mark.
 * Before a batch is open (choosing, or the check is running) it answers with the step, the trade, the
 * batch label and its size only: no student field exists until the draft is open (INV-16). In the review it
 * asks the submit question with its code and shows the review, as submit_attendance would, so one clear yes submits;
 * while a submit saves the draft, the step hint says it is being submitted (no question, no code).
 */
import { uncalledIds } from '@/domain/voice/flow';
import { confirmSubmitInstruction, countsText, currentView, markableNow, openDraft, stepHint, viewCounts } from '../instructions';
import { nameText, studentView } from '../labels';
import { batchEntries, batchInfo, snapshot, tradeList, type Handler } from './context';
import { reviewTicket } from './review';

export const getStatus: Handler = async (h) => {
  const view = await h.view();
  const { flow, plan } = view;
  if (flow.step === 'IDLE' || flow.step === 'SELECT_TRADE') return { ok: true, step: flow.step, trades: tradeList(view), instruction: stepHint(view) };
  const trade = plan.tradeStep ? view.trades.find((t) => t.id === flow.tradeId) : undefined;
  const tradeField = trade ? { trade: { id: trade.id, name: nameText(trade.name) } } : {};
  // the batch list: only what can be marked now (D-134)
  if (flow.step === 'SELECT_BATCH') return { ok: true, step: flow.step, ...tradeField, batches: batchEntries(view.cards.filter(markableNow), plan), instruction: stepHint(view) };

  const card = view.card;
  const batch = card ? { batch: batchInfo(card, plan) } : {};
  const draft = openDraft(view);
  if (!draft) return { ok: true, step: flow.step, ...tradeField, ...batch, ...(card ? { total: card.studentCount } : {}), instruction: stepHint(view) };

  const cur = currentView(view);
  const left = uncalledIds(h.draftView(draft)).length;
  const unmarked = draft.students
    .filter((st) => !draft.marks[st.id]?.status)
    .map((st) => {
      const sv = studentView(st, draft.students);
      return { id: sv.id, roll: sv.roll, name: sv.name, call_as: sv.call_as };
    });
  const token = reviewTicket(h, view);
  const instruction =
    flow.step === 'ROLL_CALL' && cur && !view.submitting
      ? `${left} of ${draft.students.length} students are left (${countsText(viewCounts(view))}). Answer the trainer in one short line, then call out: ${cur.call_as}.`
      : token
        ? `Everyone is marked. ${confirmSubmitInstruction(view, token)}`
        : stepHint(view);
  const submissionId = flow.step === 'SUBMITTED' ? card?.submission?.id : undefined;
  return {
    ok: true, ...tradeField, ...batch, ...snapshot(view), unmarked, skipped: flow.skipped,
    ...(submissionId ? { submission_id: submissionId } : {}), ...(token ? { confirm_token: token } : {}), instruction,
  };
};

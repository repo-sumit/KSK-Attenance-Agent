// tests/unit/voice/kickoff.test.ts
import { describe, expect, it } from 'vitest';
import type { Trade } from '@/domain/entities';
import { autoOpenEvent, leadOn, leadOnOpened, selfFirstEvent, sessionStartEvent, startOffer } from '@/services/voice/kickoff';
import { openingFor } from '@/services/voice/greeting';
import { FITTER, KEY, PLAN, batch, card, flow, view } from '../../helpers/voice-view';

const EN = openingFor('en', 'morning', { kind: 'instructor', firstName: 'Rajesh' }, 'Indian English');
const MR = openingFor('mr', 'evening', { kind: 'instructor', firstName: 'Rajesh' }, 'Marathi');
const SAY_EN = 'Say exactly: "Hi Rajesh, good morning."';

const WELDER: Trade = { id: 'wel', instituteId: 'pune', name: 'Welder', durationYears: 1 };
const COPA: Trade = { id: 'copa', instituteId: 'pune', name: 'COPA', durationYears: 1 };
const of = (trade: Trade, unit: number, o: Parameters<typeof card>[1] = {}) => ({ ...card({ ...batch(unit), id: `${trade.id}-s1u${unit}`, tradeId: trade.id }, o), trade });
const LATER = { status: 'future' as const, window: { start: '14:00', end: '18:00' } };
const picking = flow({ step: 'SELECT_TRADE', tradeId: null, sessionKey: null });
const batchPlan = { ...PLAN, selection: 'batch_list' as const, tradeStep: false };
const choosing = flow({ step: 'SELECT_BATCH', tradeId: null, sessionKey: null });

describe('the kickoff (D-134 amended, D-151, D-156)', () => {
  it('the trades with a batch open and not yet marked, and the reason for each other trade', () => {
    const trades = [view().trades[0], FITTER, WELDER, COPA];
    // Electrician and Fitter open; Welder: one submitted, the next at 2 pm; COPA: every batch submitted
    const board = [card(batch(2)), of(FITTER, 2), of(WELDER, 1, { status: 'submitted' }), of(WELDER, 2, LATER), of(COPA, 1, { status: 'submitted' })];
    const text = sessionStartEvent(view({ flow: picking, trades }), EN, board);
    expect(text).toBe(
      '[APP] Session started. The trainer sees 4 trades on screen; right now only Electrician and Fitter have a batch open and not yet marked. ' +
        'The others: Welder: every batch open so far is submitted, and the next opens at 2:00 pm; COPA: every batch today is already submitted. ' +
        `${SAY_EN} Then: Say in one short line, in Indian English: "Right now only Electrician and Fitter have batches open and not yet marked. Which one?" ` +
        'No tool call is needed before the trainer answers. When the trainer names one, call select_trade. ' +
        'Do not name the other trades unless the trainer asks about them; then give their reason from these facts in one short line and ask again.',
    );
    expect(text).not.toMatch(/only help|can only/i);
  });

  it('one trade open: it is offered, not asked "which"; other trades grouped by one reason', () => {
    const trades = [view().trades[0], FITTER, WELDER];
    const board = [card(batch(1), { status: 'submitted' }), of(FITTER, 2), of(WELDER, 1, { status: 'submitted' })];
    const text = sessionStartEvent(view({ flow: picking, trades }), EN, board);
    expect(text).toContain('right now only Fitter has a batch open and not yet marked. The others: Electrician and Welder: every batch today is already submitted.');
    expect(text).toContain('"Right now only Fitter has a batch open to mark. Open it?" On yes, call select_trade with Fitter.');
  });

  it('every trade open: no "only", no reasons', () => {
    const text = sessionStartEvent(view({ flow: picking }), EN, [card(batch(2)), of(FITTER, 2)]);
    expect(text).toContain('"Electrician and Fitter have batches open and not yet marked. Which one?"');
    expect(text).not.toMatch(/The others|Right now only/);
  });

  it('the other reasons: a later window, closed windows, batches the trainer may not mark, no batch today', () => {
    const trades = [view().trades[0], FITTER, WELDER, COPA, { ...COPA, id: 'md', name: 'Mechanic Diesel' }];
    const closed = { status: 'closed' as const, window: { start: '08:00', end: '09:00' } };
    const board = [card(batch(2)), of(FITTER, 1, LATER), of(WELDER, 1, closed), { ...of(COPA, 1), canMark: false }];
    const text = sessionStartEvent(view({ flow: picking, trades }), EN, board);
    expect(text).toContain("The others: Fitter: the next batch opens at 2:00 pm; Welder: today's attendance windows are closed; COPA: its open batches are not the trainer's to mark; Mechanic Diesel: no batch today.");
  });

  it('a trade with a batch that closed without attendance never hears "every batch open so far is submitted" (Task 9 review M2)', () => {
    const trades = [view().trades[0], FITTER, WELDER, COPA];
    const closed = { status: 'closed' as const, window: { start: '08:00', end: '09:00' } };
    // Fitter: one closed unmarked, one later; Welder: one submitted, one closed unmarked, one later; COPA: submitted and later
    const board = [
      card(batch(2)),
      of(FITTER, 1, closed), of(FITTER, 2, LATER),
      of(WELDER, 1, { status: 'submitted' }), of(WELDER, 2, closed), of(WELDER, 3, LATER),
      of(COPA, 1, { status: 'submitted' }), of(COPA, 2, LATER),
    ];
    const text = sessionStartEvent(view({ flow: picking, trades }), EN, board);
    expect(text).toContain(
      "The others: Fitter and Welder: an earlier batch's window closed without attendance, and the next opens at 2:00 pm; COPA: every batch open so far is submitted, and the next opens at 2:00 pm.",
    );
    // an open batch that is not the trainer's to mark, with a later one: that reason, not "submitted"
    const notMine = sessionStartEvent(view({ flow: picking, trades: [view().trades[0], FITTER] }), EN, [card(batch(2)), { ...of(FITTER, 1), canMark: false }, of(FITTER, 2, LATER)]);
    expect(notMine).toContain("The others: Fitter: its open batches are not the trainer's to mark, and the next opens at 2:00 pm.");
  });

  it('nothing can be marked: why, then "How can I help?" in the opening language', () => {
    const text = sessionStartEvent(view({ plan: batchPlan, flow: choosing, cards: [card(batch(1), LATER)] }), MR);
    expect(text).toBe('[APP] Session started. Nothing can be marked right now: the next batch opens at 2:00 pm. Say exactly: "नमस्कार Rajesh, शुभ संध्याकाळ." Then: Say that in one line and ask "मी काय मदत करू?". Then wait.');
  });

  it('several batches without a trade step: the greeting, then the batches with their ids', () => {
    const text = sessionStartEvent(view({ plan: batchPlan, flow: choosing, cards: [card(batch(1)), card(batch(2))] }), EN);
    expect(text).toMatch(/^\[APP\] Session started\. Say exactly: "Hi Rajesh, good morning\." Then: Read only the batches open now, /);
    expect(text).toContain(`Their ids for select_batch: Shift 1, Unit 1, Electrician: ${card(batch(1)).key}; Shift 1, Unit 2, Electrician: ${KEY}.`);
  });

  it('mid-flow it re-reads the state', () => {
    expect(sessionStartEvent(view(), EN)).toBe('[APP] Session started again. Call get_status and continue from where we were.');
  });

  it('the only open batch opened by the app: the greeting, then the result instruction', () => {
    expect(autoOpenEvent({ ok: true, instruction: 'Say X.' }, 'Shift 1, Unit 2, Electrician', EN)).toBe(
      `[APP] Session started. Only Shift 1, Unit 2, Electrician can be marked now, so the app opened it: do not call select_batch for it. ${SAY_EN} Then: Say X.`,
    );
    expect(autoOpenEvent({ ok: false, error: 'NEEDS_CONNECTION', instruction: 'Say Y.' }, 'Shift 1, Unit 2, Electrician', EN)).toContain('but it cannot be opened.');
  });

  it('own attendance first, required: the greeting and the ask; no student offer', () => {
    const offer = startOffer(view({ flow: picking }), [card(batch(2))], 'Indian English', 'How can I help?');
    const text = selfFirstEvent(EN, true, offer);
    expect(text).toBe(
      "[APP] Session started. The trainer's own attendance is not marked today; it must be marked before any student attendance. " +
        `${SAY_EN} Then say in one short line, in Indian English: "Please mark your attendance first. Shall I start?" Then wait. On yes, call mark_my_attendance. ` +
        'Until it is marked, no trade or batch can be opened. If the trainer asks for one instead, call no tool: say in one short line that their own attendance comes first and ask whether to start it. Then stop and wait: call mark_my_attendance only after the trainer says yes.',
    );
  });

  it('own attendance first as a suggestion: "later" continues to the normal start; Marathi lines are exact', () => {
    const offer = startOffer(view({ flow: picking }), [card(batch(2)), of(FITTER, 2)], 'Marathi', 'मी काय मदत करू?');
    const text = selfFirstEvent(MR, false, offer);
    expect(text).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today\. Say exactly: "नमस्कार Rajesh, शुभ संध्याकाळ\." Then say in one short line, in Marathi: "कृपया आधी तुमची हजेरी नोंदवा\. सुरू करू का\?" Then wait\. On yes, call mark_my_attendance\. /);
    expect(text).toContain('If the trainer says later, or names a trade or batch instead, continue without it: ');
    expect(text).toContain('Say in one short line, in Marathi: "Electrician and Fitter have batches open and not yet marked. Which one?"');
  });

  it('after the own mark, the same turn leads on to the students', () => {
    const offer = startOffer(view({ flow: picking }), [card(batch(2)), of(FITTER, 2)], "the trainer's language", 'How can I help?');
    expect(leadOn(offer)).toMatch(/^Then, in the same turn: Electrician and Fitter have a batch open and not yet marked\. Say in one short line, in the trainer's language: "Electrician and Fitter have batches open and not yet marked\. Which one\?"/);
    expect(leadOnOpened({ ok: true, instruction: 'Say X.' }, 'Shift 2, Unit 1, Electrician')).toBe(
      'Then, in the same turn: Only Shift 2, Unit 1, Electrician can be marked now, so the app opened it: do not call select_batch for it. Say X.',
    );
  });
});

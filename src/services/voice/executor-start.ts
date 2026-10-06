/**
 * The marking executor's fresh start and its lead-on after the trainer's own mark (D-134, D-151, D-152, D-156): which
 * first turn to send (own attendance first, the only open session opened, or the offer) and what the turn after the
 * self mark goes on to. The texts are in ./kickoff; opening a session goes through the executor's own `run`, the same
 * path as the model's select_batch. No browser globals.
 */
import type { SessionCard } from '@/services/attendance';
import { freshStart } from './app-events';
import { voiceDebug } from './debug';
import { helpQuestion, sessionOpening } from './greeting';
import type { HandlerContext } from './handlers/context';
import { markableNow, type VoiceView } from './instructions';
import { autoOpenEvent, leadOn, leadOnOpened, selfAgainEvent, selfFirstEvent, sessionStartEvent, startOffer } from './kickoff';
import { sessionLabel } from './labels';
import { SPEECH_LANGUAGE } from './prompt';
import type { ToolResult } from './tools';

type Run = (name: string, args: Readonly<Record<string, unknown>>) => Promise<ToolResult>;

export interface ExecutorStart {
  /** The view, with the trainer's whole board when there is a trade step (one Promise.all; a board that fails to load is left out). */
  viewAndBoard(): Promise<readonly [VoiceView, readonly SessionCard[] | undefined]>;
  /** The first message of a fresh connection (kind 'start'), from the view and board just loaded. */
  start(languageName: string, view: VoiceView, board: readonly SessionCard[] | undefined): Promise<string>;
  /** After the trainer's own mark: what the same turn goes on to (the students), or '' mid-flow. */
  afterSelf(): Promise<string>;
  /**
   * A refresh or Reconnect at a fresh start with the trainer's own attendance still to mark and no check running: the
   * ask again (D-152, M5); null otherwise, and null once the trainer answered the ask (a trainer turn or a tool call
   * after it) unless the rule requires own attendance first. `languageName`: the session's (a refresh passes none: the
   * opening language's).
   */
  selfAgain(kind: 'reconnect' | 'refresh', languageName?: string): Promise<string | null>;
  /** The model called a tool: an own-attendance ask before it was answered ("later" leads somewhere else). */
  toolCalled(): void;
}

export function createExecutorStart(h: HandlerContext, run: Run): ExecutorStart {
  const { deps } = h;
  /** The trainer's own attendance is still to mark today (D-152); a read that fails counts as not known, so nothing is asked. */
  const selfPending = async () =>
    deps.voice.capabilities.selfAttendance && (await deps.staffAttendance.myRecord(deps.ctx).then((r) => r === undefined, () => false));
  const viewAndBoard = () => Promise.all([h.view(), deps.plan.tradeStep ? h.wholeBoard().catch(() => undefined) : undefined] as const);
  /** The only session that can be marked now, without a trade step (D-134). A card own attendance first blocks never counts. */
  const onlyOpen = (view: VoiceView): SessionCard | undefined => {
    const open = view.cards.filter((c) => markableNow(c) && !c.selfFirst);
    return open.length === 1 && !deps.plan.tradeStep ? open[0] : undefined;
  };
  /** Opens a session through the same path as the model's select_batch; a throwing service gives null (the offer stands). */
  const autoOpen = (card: SessionCard) =>
    run('select_batch', { batch: card.key }).catch((e: unknown) => {
      voiceDebug(`auto-open failed for ${card.key}: ${e instanceof Error ? e.name : 'error'}`);
      return null;
    });
  const label = (card: SessionCard) => sessionLabel(card, deps.plan.slotWords);
  /** The trainer turn count when own attendance was last asked for (null: not asked, or answered since by a tool call). */
  let askedAt: number | null = null;
  const asked = <T>(text: T): T => {
    askedAt = deps.speechSeq();
    return text;
  };
  /** The ask was answered or put off: a trainer turn or a tool call since. With the rule, it is asked again whatever. */
  const answered = () => !deps.ctx.journey.staff.selfFirst && (askedAt === null || deps.speechSeq() > askedAt);

  return {
    viewAndBoard,
    // With the trainer's own attendance unmarked, every fresh start, on any screen, greets and asks for it first, and
    // nothing opens (D-152). Otherwise a fresh start with exactly one markable session opens it at once (D-134), never
    // when voice started away from the batch screens (the screen the trainer chose stays); else the offer.
    async start(languageName, view, board) {
      const opening = sessionOpening(deps.ctx, deps.voice, languageName);
      const fresh = freshStart(view);
      if (fresh && (await selfPending())) {
        return asked(selfFirstEvent(opening, deps.ctx.journey.staff.selfFirst, startOffer(view, board, opening.languageName, opening.help)));
      }
      const only = fresh && !h.state.away ? onlyOpen(view) : undefined;
      if (!only) return sessionStartEvent(view, opening, board);
      // a throwing service falls back to the question that offers it (as an INTERNAL answer would to the model)
      const result = await autoOpen(only);
      return result ? autoOpenEvent(result, label(only), opening) : sessionStartEvent(await h.view(), opening);
    },
    // The same turn as "marked" goes on to the students: the only open session opened (a recent self pass opens it
    // without a second check), else the trades with their reasons or the batches. Mid-flow (a batch already open) nothing.
    async afterSelf() {
      const [view, board] = await viewAndBoard();
      if (!freshStart(view)) return '';
      const only = onlyOpen(view);
      const result = only ? await autoOpen(only) : null;
      if (only && result) return leadOnOpened(result, label(only));
      // the help question in the session's opening language (Task 9 review M1), as every first turn asks it
      return leadOn(startOffer(only ? await h.view() : view, board, "the trainer's language", helpQuestion(deps.voice.openingLanguage)));
    },
    async selfAgain(kind, languageName = SPEECH_LANGUAGE[deps.voice.openingLanguage]) {
      // the check mark_my_attendance opened is running (the question was answered), or nothing is pending: no loads
      if (h.state.self || answered() || !(await selfPending())) return null;
      const [view, board] = await viewAndBoard();
      if (!freshStart(view)) return null;
      const opening = sessionOpening(deps.ctx, deps.voice, languageName);
      return asked(selfAgainEvent(kind, opening, deps.ctx.journey.staff.selfFirst, startOffer(view, board, opening.languageName, opening.help)));
    },
    toolCalled() {
      askedAt = null;
    },
  };
}

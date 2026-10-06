/**
 * The first turn of a fresh voice session and the lead-on after the trainer's own mark (D-134 amended, D-151, D-152,
 * D-156). The app writes the greeting line (./greeting) and the exact sentence that offers the work; the model says
 * them. The trade offer names the trades with a batch open and not yet marked and gives, for the model only, why each
 * other trade is not offered, so "why only two?" gets the reason, never "I can only help with". With the trainer's own
 * attendance unmarked the first turn asks for it first. Tuned against the live model: change wording only with a
 * rehearsal (`npm run test:voice-live`). Pure TypeScript: no I/O, no clock, no framework.
 */
import type { Trade } from '@/domain/entities';
import type { SessionCard } from '../attendance';
import { freshStart } from './app-events';
import type { Opening } from './greeting';
import { markableNow, nextOpening, nothingOpen, openSessionIds, readSessions, type VoiceView } from './instructions';
import { nameText } from './labels';
import type { ToolResult } from './tools';

/** What can be marked now, without the greeting: `facts` for the model (may be ''), `then` the instruction to follow. */
export interface StartOffer {
  readonly facts: string;
  readonly then: string;
}

/** "a, b and c". */
const listed = (parts: readonly string[]): string => (parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : (parts[0] ?? ''));

/**
 * Why a trade has nothing to mark now, from its sessions today (a phrase for the model). "Every batch open so far is
 * submitted" only when that is so: each one is submitted or still to come (Task 9 review M2).
 */
function tradeReason(cards: readonly SessionCard[]): string {
  if (!cards.length) return 'no batch today';
  if (cards.every((c) => c.status === 'submitted')) return 'every batch today is already submitted';
  const submitted = cards.some((c) => c.status === 'submitted');
  const time = nextOpening(cards);
  if (time) {
    if (cards.some((c) => c.status === 'closed')) return `an earlier batch's window closed without attendance, and the next opens at ${time}`;
    if (cards.some((c) => c.status === 'open')) return `its open batches are not the trainer's to mark, and the next opens at ${time}`;
    return submitted ? `every batch open so far is submitted, and the next opens at ${time}` : `the next batch opens at ${time}`;
  }
  if (cards.some((c) => c.status === 'open')) return "its open batches are not the trainer's to mark";
  return submitted ? 'every batch is submitted or its window has closed' : "today's attendance windows are closed";
}

/** The other trades grouped by their reason: "Welder and COPA: every batch today is already submitted; ...". */
function othersText(others: readonly Trade[], board: readonly SessionCard[]): string {
  const groups = new Map<string, string[]>();
  for (const t of others) {
    const reason = tradeReason(board.filter((c) => c.trade.id === t.id));
    groups.set(reason, [...(groups.get(reason) ?? []), nameText(t.name)]);
  }
  return [...groups].map(([reason, names]) => `${listed(names)}: ${reason}`).join('; ');
}

const PICK = 'No tool call is needed before the trainer answers. When the trainer names one, call select_trade.';

/** The trades with a batch open and not yet marked now (the whole board), with the reason for the others. */
function tradeOffer(view: VoiceView, board: readonly SessionCard[], lang: string): StartOffer {
  const open = view.trades.filter((t) => board.some((c) => c.trade.id === t.id && markableNow(c)));
  const others = view.trades.filter((t) => !open.includes(t));
  const names = listed(open.map((t) => nameText(t.name)));
  const one = open.length === 1;
  const has = one ? 'has a batch' : 'have a batch';
  const facts = others.length
    ? `The trainer sees ${view.trades.length} trades on screen; right now only ${names} ${has} open and not yet marked. The others: ${othersText(others, board)}.`
    : `${names} ${has} open and not yet marked.`;
  const line = one
    ? `Right now only ${names} has a batch open to mark. Open it?`
    : `${others.length ? `Right now only ${names}` : names} have batches open and not yet marked. Which one?`;
  const why = others.length ? ' Do not name the other trades unless the trainer asks about them; then give their reason from these facts in one short line and ask again.' : '';
  const next = one ? ` On yes, call select_trade with ${names}.` : ` ${PICK}`;
  return { facts, then: `Say in one short line, in ${lang}: "${line}"${next}${why}` };
}

/**
 * What can be offered now (D-134): the trades with a reason, the batches with their ids, or why nothing can be marked
 * (then the help question; voice stays open, D-142). `lang`: the language to say it in; `help`: the question to ask.
 */
export function startOffer(view: VoiceView, board: readonly SessionCard[] | undefined, lang: string, help: string): StartOffer {
  const why = (facts: string): StartOffer => ({ facts, then: `Say that in one line and ask "${help}". Then wait.` });
  if (view.plan.tradeStep) {
    if (!board) return { facts: '', then: `Ask which trade in one short line, reading the trade names: ${view.trades.map((t) => nameText(t.name)).join(', ')}. ${PICK}` };
    if (!board.some(markableNow)) return why(nothingOpen({ ...view, cards: board }) ?? '');
    return tradeOffer(view, board, lang);
  }
  const nothing = nothingOpen(view);
  if (nothing) return why(nothing);
  const ids = openSessionIds(view);
  return { facts: '', then: `${readSessions(view)}${ids.length > 1 ? ` Their ids for select_batch: ${ids.join('; ')}.` : ''}` };
}

const greet = (o: Opening) => `Say exactly: "${o.greeting}"`;
const withFacts = (facts: string) => (facts ? `${facts} ` : '');

/**
 * First message of a fresh connection, chosen by where the flow is: the greeting, then the offer; mid-flow it re-reads
 * the state. `board`: the trainer's sessions in every trade (with a trade step). With exactly one markable session
 * the executor opens it itself and sends autoOpenEvent instead.
 */
export function sessionStartEvent(view: VoiceView, opening: Opening, board?: readonly SessionCard[]): string {
  if (!freshStart(view)) return '[APP] Session started again. Call get_status and continue from where we were.';
  const offer = startOffer(view, board, opening.languageName, opening.help);
  return `[APP] Session started. ${withFacts(offer.facts)}${greet(opening)} Then: ${offer.then}`;
}

/** How the only markable session was opened by the app (select_batch's own result instruction follows). */
const opened = (result: ToolResult, label: string) =>
  `Only ${label} can be marked now, ${result.ok ? 'so the app opened it: do not call select_batch for it' : 'but it cannot be opened'}.`;

/** First message after the executor opened the only markable session itself. */
export function autoOpenEvent(result: ToolResult, label: string, opening: Opening): string {
  // "do not call select_batch": live rehearsal, the model otherwise opened it a second time (one more round trip)
  return `[APP] Session started. ${opened(result, label)} ${greet(opening)} Then: ${result.instruction}`;
}

const selfFacts = (required: boolean): string =>
  `The trainer's own attendance is not marked today${required ? '; it must be marked before any student attendance' : ''}.`;
const selfAsk = (opening: Opening): string => `in one short line, in ${opening.languageName}: "${opening.selfAsk}" Then wait. On yes, call mark_my_attendance.`;
function selfRest(required: boolean, later: StartOffer): string {
  return required
    ? 'Until it is marked, no trade or batch can be opened. If the trainer asks for one instead, call no tool: say in one short line that their own attendance comes first and ask whether to start it. Then stop and wait: call mark_my_attendance only after the trainer says yes.'
    : `If the trainer says later, or names a trade or batch instead, continue without it: ${withFacts(later.facts)}${later.then}`;
}

/**
 * The trainer's own attendance is not marked today (D-152): the greeting, then the ask; on yes mark_my_attendance.
 * `required` (journey.staff.selfFirst): no trade or batch opens before it. Otherwise it is a suggestion, and "later"
 * continues with `later`, the normal start.
 */
export function selfFirstEvent(opening: Opening, required: boolean, later: StartOffer): string {
  return `[APP] Session started. ${selfFacts(required)} ${greet(opening)} Then say ${selfAsk(opening)} ${selfRest(required, later)}`;
}

/**
 * A refresh or a Reconnect at a fresh start while the trainer's own attendance is still to mark and no check runs
 * (D-152, Task 9 review M5): the ask again, so the new connection never moves on to choosing the trade.
 */
export function selfAgainEvent(kind: 'reconnect' | 'refresh', opening: Opening, required: boolean, later: StartOffer): string {
  const head = kind === 'reconnect' ? '[APP] Reconnected.' : '[APP] The connection was refreshed; trust these facts over your memory.';
  return `${head} ${selfFacts(required)} Your question about it may have been lost: say ${selfAsk(opening)} ${selfRest(required, later)}`;
}

/** After the trainer's own mark: the same turn goes on to the students (the trades, the batches, or why nothing can be marked). */
export const leadOn = (offer: StartOffer): string => `Then, in the same turn: ${withFacts(offer.facts)}${offer.then}`;

/** After the trainer's own mark, with the only markable session opened by the app. */
export const leadOnOpened = (result: ToolResult, label: string): string => `Then, in the same turn: ${opened(result, label)} ${result.instruction}`;

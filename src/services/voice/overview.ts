/**
 * Texts for the capabilities beside marking (D-139, D-142): today's state at the institute (the principal's kickoff,
 * get_status, a refresh, a reconnect), an instructor away from the batch screens (Resume, Reconnect and a refresh on
 * Reports or the staff screen) and today's notices. Every number and date is put in by the
 * app; the model only says it. Tuned against the live model: change wording only with a rehearsal (`npm run test:voice-live`).
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import type { NavTarget } from '@/domain/voice/plan';
import { safeText } from '@/domain/voice/types';
import type { LocalDate } from '@/lib/time';
import { instantAt } from '@/lib/time';
import type { Opening } from './greeting';
import { dayWords, nameText } from './labels';
import { SCREENS } from './screens';

/**
 * Today at the institute, as the principal's Home counts it. `staffNotMarked` is null without the staff view;
 * `selfNotMarked`: the principal's own row is among them (said as "you", D-156).
 */
export interface TodayFacts {
  readonly batchesSubmitted: number;
  readonly batchesTotal: number;
  readonly staffNotMarked: number | null;
  readonly selfNotMarked?: boolean;
}

/** "Today: 4 of 17 batches submitted, 3 staff not marked yet, the principal included." */
export function todayLine(t: TodayFacts): string {
  const self = t.selfNotMarked ? ', the principal included' : '';
  const staff = t.staffNotMarked === null ? '' : t.staffNotMarked ? `, ${t.staffNotMarked} staff not marked yet${self}` : ', every staff member marked';
  return `Today: ${t.batchesSubmitted} of ${t.batchesTotal} batches submitted${staff}.`;
}

/** Today's state as the agent says it, for the kickoff's example line: "4 of 17 batches are in; 5 staff haven't marked yet, including you." */
function todaySaid(t: TodayFacts): string {
  const batches = `${t.batchesSubmitted} of ${t.batchesTotal} batches are in`;
  if (t.staffNotMarked === null) return `${batches}.`;
  if (!t.staffNotMarked) return `${batches}; every staff member is marked.`;
  return `${batches}; ${t.staffNotMarked} staff haven't marked yet${t.selfNotMarked ? ', including you' : ''}.`;
}

/** "the Reports screen", or "another screen" for one voice cannot name. */
const screenWords = (where: NavTarget | 'other'): string => (where === 'other' ? 'another screen' : `the ${SCREENS[where].name} screen`);

/**
 * Away from the batch screens (My attendance, Reports, the staff screen) with no batch being marked, Resume, Reconnect
 * and a refresh say where the trainer is instead of the step hint (which would re-read the batch list), then wait for
 * their request (D-142). Resume and Reconnect ask for a few words, never "say nothing": a text that asked for no reply
 * left the live model without a turn (rehearsal, Task 16). A refresh (nobody spoke) only says to wait, as the
 * principal's does.
 */
const awayFacts = (where: NavTarget | 'other'): string => `${screenWords(where)}; no batch is being marked.`;
const LISTENING = 'Say in a few words that you are listening, then wait for their request.';

export const awayResumeEvent = (where: NavTarget | 'other'): string => `[APP] The trainer is back from the screen. They are on ${awayFacts(where)} ${LISTENING}`;
export const awayReconnectEvent = (where: NavTarget | 'other'): string => `[APP] Reconnected. The trainer is on ${awayFacts(where)} ${LISTENING}`;
export const awayRefreshEvent = (where: NavTarget | 'other'): string =>
  `[APP] The connection was refreshed; trust these facts over your memory. The trainer is on ${awayFacts(where)} Wait for the trainer's request.`;

/**
 * The first message without a batch flow: the app's greeting line, today's state in one line (staff not marked yet
 * named, "including you" for the principal's own row, D-156), then the help question (D-142, D-151).
 */
export function overviewStartEvent(t: TodayFacts, opening: Opening): string {
  return `[APP] Session started. ${todayLine(t)} Say exactly: "${opening.greeting}" Then say today's state in one line, in ${opening.languageName} (for example "${todaySaid(t)}"), then ask "${opening.help}". Then wait.`;
}

/**
 * After Reconnect: spoken facts (get_status), never "say nothing": telling the model to stay silent made it skip its next
 * reply too (refreshEvent in ./app-events).
 */
export const OVERVIEW_RECONNECT_EVENT = "[APP] Reconnected. Call get_status and say today's state in one short line, then wait for the trainer.";

/** After Reconnect with a mark_staff question still waiting: asked again at once, with a code issued for the new connection (D-082). */
export const overviewReconnectAskEvent = (question: string): string =>
  `[APP] Reconnected. Your last question to the trainer was lost in the reconnect: ask it again now, then wait. Its instruction was: ${question}`;

/**
 * Resume after Pause: no student to continue from; today's numbers only when asked. A few spoken words, not
 * silence: a text that asks for no reply left the live model without a turn (rehearsal, Task 16).
 */
export const OVERVIEW_RESUME_EVENT = "[APP] The trainer is back from the screen. Say in a few words that you are listening, then wait for their request. Do not read out today's numbers unless they ask.";

/** After a goAway switch without a batch flow: today's facts, and the question still waiting for an answer, if any. */
export function overviewRefreshEvent(t: TodayFacts, pendingQuestion: string | null, heard = ''): string {
  const head = `[APP] The connection was refreshed; trust these facts over your memory. ${todayLine(t)}`;
  if (!pendingQuestion) return `${head} Wait for the trainer.`;
  const words = safeText(heard, 160);
  const said = words ? ` The trainer last said: "${words}" (already handled: do not act on it again).` : '';
  return `${head}${said} Your last question to the trainer was lost in the refresh: ask it again now, then wait. Its instruction was: ${pendingQuestion}`;
}

const DAY_MONTH = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' });
const dayMonth = (date: LocalDate): string => DAY_MONTH.format(instantAt(date, '12:00'));

/** The day(s) a notice is about, as the agent says them: "today", "Saturday, 26 September", "from 30 September to 5 October". */
export function noticeDates(from: LocalDate | undefined, to: LocalDate | undefined, today: LocalDate): string | undefined {
  if (!from) return undefined;
  const last = to ?? from;
  if (last === from) return from === today ? 'today' : dayWords(from);
  return `from ${dayMonth(from)} to ${dayMonth(last)}`;
}

export interface NoticeView {
  readonly title: string;
  readonly dates?: string;
}

/** No notice for this reader today: get_announcements, and navigate to=announcements (which then opens nothing). */
export const NO_NOTICES = 'There are no notices today. Say so in one short line.';

/** get_announcements: read at most three, one short line each, then offer to open them (when the screen exists). */
export function announcementsInstruction(notices: readonly NoticeView[], more: number, canOpen: boolean): string {
  if (!notices.length) return NO_NOTICES;
  const list = notices.map((n) => `"${nameText(n.title)}"${n.dates ? ` (${n.dates})` : ''}`).join('; ');
  const rest = more ? ` ${more} more ${more === 1 ? 'is' : 'are'} on Home.` : '';
  const open = canOpen ? ' Then ask whether to open them on the screen; on yes, call navigate with to=announcements.' : '';
  return `Read these notices in the trainer's language, one short line each, with their dates: ${list}.${rest}${open}`;
}

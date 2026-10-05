/**
 * Instruction texts (voice design §8): what to say when a batch opens, after a mark, and before submit or
 * bulk marking. Ported verbatim from the MVP executor (MVP-05 §4.6, §5.2, §5.4, §5.6; MVP-04 C6 to C9;
 * MVP-08 blocks F and G), changing only names and protocol: KSK sessions and the shared draft, and
 * confirm_token codes for confirmed=true (D-082). The view, the counts, the selection questions and the
 * step hint live in instructions-core.ts and are re-exported here, so callers import every text from
 * this module. Tuned against the live model: change wording only with a rehearsal (`npm run test:voice-live`).
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import type { StatusCode } from '@/domain/status';
import { uncalledIds } from '@/domain/voice/flow';
import type { DraftSnapshot } from '../marking-draft';
import { askExceptions, byException, countsText, currentView, defaultOf, openDraft, stepHint, viewCounts, type VoiceView } from './instructions-core';
import { batchLabel, first, nameText, slotLabel, statusWords, studentView, word, type StudentView } from './labels';

export * from './instructions-core';

/** The draft as the flow reads it (ids only). */
const asView = (draft: DraftSnapshot) => ({ order: draft.students.map((s) => s.id), marks: draft.marks, sources: draft.sources, presets: draft.presets });

const callAs = (draft: DraftSnapshot, id: string) => {
  const st = draft.students.find((s) => s.id === id);
  return st ? studentView(st, draft.students).call_as : id;
};

/** Who the system already set (OJT, a leave carried from an earlier day), named when few: said when the batch opens. */
function presetText(draft: DraftSnapshot): string {
  const set = draft.students.filter((st) => draft.presets.has(st.id));
  if (!set.length) return '';
  const ojt = set.filter((st) => draft.marks[st.id]?.status === 'ojt').length;
  const leave = set.length - ojt;
  if (set.length > 4) return `${ojt ? `${ojt} on OJT` : ''}${ojt && leave ? ', ' : ''}${leave ? `${leave} on leave from an earlier day` : ''}`;
  return set
    .map((st) => {
      const mark = draft.marks[st.id];
      return `${callAs(draft, st.id)} ${mark?.status === 'ojt' ? 'on OJT' : `on leave (${statusWords(mark ?? { status: 'leave' }).replace(/^leave, /, '')})`}`;
    })
    .join('; ');
}

/** Who is not the default (or not present, where the state starts blank), named for the submit question: "absent: Rahul Kumar; leave: Neha". */
export function exceptionsText(view: VoiceView): string {
  const draft = openDraft(view);
  if (!draft) return '';
  const base = defaultOf(view.plan) ?? 'present';
  const by: Record<string, string[]> = {};
  for (const st of draft.students) {
    const status = draft.marks[st.id]?.status;
    if (status && status !== base) (by[status] ??= []).push(callAs(draft, st.id));
  }
  const groups = [...view.plan.statuses.filter((c) => c !== 'ojt'), 'ojt'].filter((c) => by[c]?.length);
  if (!groups.length) return `everyone ${word(base)}`;
  if (groups.reduce((n, c) => n + by[c].length, 0) > 5) return '';
  return groups.map((c) => `${word(c)}: ${by[c].join(', ')}`).join('; ');
}

/**
 * Students among `named` whose status is not `status`, as a question names them: "Rahul Kumar (absent);
 * Shivam Kumar (absent)", or counts ("6 absent, 1 leave") for more than 5 (MVP `othersText`).
 */
export function othersText(view: VoiceView, status: StatusCode, named: readonly StudentView[]): string {
  const draft = openDraft(view);
  if (!draft) return '';
  const ids = new Set(named.map((s) => s.id));
  const others = draft.students.filter((st) => ids.has(st.id) && draft.marks[st.id]?.status && draft.marks[st.id].status !== status);
  if (!others.length) return '';
  if (others.length > 5) {
    const counts: Record<string, number> = {};
    for (const st of others) counts[draft.marks[st.id].status!] = (counts[draft.marks[st.id].status!] ?? 0) + 1;
    return view.plan.statuses
      .filter((c) => counts[c])
      .map((c) => `${counts[c]} ${word(c)}`)
      .join(', ');
  }
  return others.map((st) => `${callAs(draft, st.id)} (${word(draft.marks[st.id].status!)})`).join('; ');
}

export interface AfterMarkOptions {
  /** Which tool made the mark: mark_attendance confirms in 2 to 6 words; anything else in a few words (default). */
  readonly via?: 'mark_attendance' | 'set_student_status';
  /** `flow.currentId` before the mark: when the pointer did not move (a correction), the current name is repeated. */
  readonly prevCurrentId?: string | null;
  /** set_student_status marked a student the trainer had not marked yet: during a roll call it may be one exception of "sab present, sirf ...". */
  readonly fresh?: boolean;
  /**
   * The code of the submit ticket issued with this result, when the mark left everyone marked (flow REVIEW):
   * the submit question carries it, so one clear yes submits instead of a second question from submit_attendance.
   */
  readonly submitToken?: string;
}

/** After a voice mark: confirm, then the next step (MVP `afterMark` with the confirm sentence and the exception prefix of each tool). */
export function afterMark(view: VoiceView, marked: StudentView, status: StatusCode, opts: AfterMarkOptions = {}): string {
  const mark = openDraft(view)?.marks[marked.id];
  const said = `"${first(marked.name)} ${statusWords(mark?.status === status ? mark : { status })}"`;
  const roll = opts.via === 'mark_attendance';
  const confirm = roll ? `Confirm ${said} in 2 to 6 words in the trainer's language` : `Confirm ${said} in a few words`;
  // A student not marked yet may be one exception of "sab present, sirf ...": the model follows the latest
  // instruction, so it has to say here that mark_remaining comes next (MVP live runs stopped here).
  // By exception (live rehearsal, D-135): "sab present, sirf Aditi absent" already says that is all, so the submit
  // question comes next instead of "anyone else?".
  const exception =
    !roll && opts.fresh && view.flow.rollCall && view.flow.step === 'ROLL_CALL'
      ? 'If the trainer named this student as an exception to one status for everyone else ("sab present, sirf ..."), say nothing yet: set any other named students, then call mark_remaining. Otherwise: '
      : !roll && opts.fresh && byException(view)
        ? 'If the trainer said these are the only ones ("sirf ...", "only ...", "baaki sab present"), say nothing yet: set any other named students, then call submit_attendance. Otherwise: '
        : '';
  const cur = currentView(view);
  if (byException(view)) return `${exception}Confirm ${said} in two or three words, then ${askExceptions(view)}, in the trainer's language. Then stop and wait.`;
  if (!cur) {
    const ask = opts.submitToken
      ? `Then say everyone is marked. ${confirmSubmitInstruction(view, opts.submitToken)}`
      : `Then say everyone is marked: ${countsText(viewCounts(view))}. Say submit is final and ask whether to submit.`;
    return `${exception}${confirm}. ${ask}`;
  }
  return cur.id === opts.prevCurrentId
    ? `${exception}${confirm}, then repeat the current student's name: ${cur.call_as}. Then stop and wait.`
    : `${exception}${confirm}, then call out: ${cur.call_as}. Then stop and wait.`;
}

/**
 * What to say when a batch opens (select_batch, a tap on a batch, or the pass after verification). `submitToken`:
 * everyone already had a status, so the batch opened at the review with this submit code.
 */
export function openBatchInstruction(view: VoiceView, submitToken?: string): string {
  const draft = openDraft(view);
  const card = view.card;
  if (!draft || !card || card.key !== draft.key) return stepHint(view);
  const preset = presetText(draft);
  const sheet = slotLabel(card, view.plan.slotWords);
  const head = `In the trainer's language, with numbers said the way that language says them, say ${batchLabel(card.batch, card.trade)}${sheet ? `, ${sheet} attendance,` : ''} and that there are ${draft.students.length} students.${preset ? ` Say in one line who is already set and will not be called: ${preset}.` : ''}`;
  const def = defaultOf(view.plan);
  // A batch reopened (the app was killed, or the trainer left it): its trainer marks are still in the draft.
  const saved = draft.students.filter((st) => Object.prototype.hasOwnProperty.call(draft.sources, st.id)).length;
  if (!uncalledIds(asView(draft)).length) {
    // everyone is already set (OJT, carried leave, earlier marks): nobody to call or to ask about
    const counts = `${head} Every student already has a status: ${countsText(viewCounts(view))}.`;
    if (submitToken) return `${counts} Say that in one line. ${confirmSubmitInstruction(view, submitToken)}`;
    return view.submitting ? `${counts} ${stepHint(view)}` : `${counts} Say that in one line, say submit is final and ask whether to submit.`;
  }
  const switchHint = view.plan.rollCallSwitch ? ' If the trainer wants every name called ("naam se bulao", "call the names"), call start_roll_call.' : '';
  if (byException(view)) {
    // D-135: one short line, then only the absentees are asked for (everyone starts present)
    const presetLine = preset ? ` Then say in a few words who is already set and will not be asked about: ${preset}.` : '';
    const ask = saved
      ? `In the trainer's language, in one short line, say ${saved} ${saved === 1 ? 'student is' : 'students are'} already marked and everyone else is present, and ask who else is absent.`
      : `In the trainer's language, with numbers said the way that language says them, in one short line, say ${batchLabel(card.batch, card.trade)}${sheet ? `, ${sheet} attendance` : ''}, ${draft.students.length} students, everyone present, and ask who is absent (for example "Electrician Shift 1 Unit 1: 28 students, all present. Who is absent?").`;
    return `${ask}${presetLine} Then stop and wait. Mark each student the trainer names with set_student_status.${switchHint}`;
  }
  const lead = def ? ` Say every student counts as ${word(def)} until marked.` : '';
  const cur = currentView(view);
  const call = cur?.call_as ?? '';
  if (saved) return `${head}${lead} ${saved} of ${draft.students.length} are already marked; continue from ${call}: say that in a few words, then call out: ${call}. Then stop and wait.`;
  return `${head}${lead} Then call out: ${call}. Then stop and wait.`;
}

/** submit_attendance without a valid code: the review question (MVP C9). */
export function confirmSubmitInstruction(view: VoiceView, token: string): string {
  const named = exceptionsText(view);
  return `In one line, read the counts: ${countsText(viewCounts(view))}${named ? ` (${named})` : ''}, then ask whether to submit, saying it is final (for example "26 present, 2 absent: Rahul Patil, Priya Shinde. Submit? It is final."). Call submit_attendance with confirm_token "${nameText(token)}" only after a clear yes. If the trainer changes someone instead, use set_student_status.`;
}

/** A name the trainer gave that could not be marked yet (the open-names guard, MVP-05 §4.5). */
export interface OpenName {
  readonly text: string;
  readonly status: StatusCode | null;
}

/**
 * mark_remaining without a valid code (MVP C8). The question names the exceptions just set, from the draft
 * rather than the model's memory, so a misheard name is read out before the yes; and any named student who
 * could not be marked, who would be swept in too.
 */
export function confirmRemainingInstruction(
  view: VoiceView, count: number, status: StatusCode, token: string, justMarked: readonly StudentView[], open: readonly OpenName[] = [],
): string {
  const just = othersText(view, status, justMarked);
  const stillOpen = open.map((o) => `"${nameText(o.text)}"${o.status ? ` (${word(o.status)})` : ''}`).join(' and ');
  const still = stillOpen
    ? `Not marked although the trainer named them: ${stillOpen}. They are among the remaining ${count} and would become ${word(status)} too: say so in the question. `
    : '';
  const cur = currentView(view);
  return (
    `${just ? `Just marked: ${just}. ` : ''}${still}In the trainer's language, ask once, in one line, ${just ? 'saying that first, ' : ''}whether to mark the remaining ${count} students ${word(status)}. ` +
    `Call mark_remaining again with confirm_token "${nameText(token)}" only after a clear yes. If the trainer corrects a name instead, mark the right student with set_student_status and put the wrongly named one back (to their old status, or ${word(status)} if they were not marked before), then call mark_remaining again. ` +
    `On a plain no, ${just ? 'say in a few words that those students stay marked, then ' : ''}${cur ? `call out ${cur.call_as} again` : askExceptions(view)}.`
  );
}

/**
 * The voice executor (voice design §5, D-079): every tool call runs through the same services and rules as
 * a tap (AttendanceService, VerificationService, MarkingDraftService, src/domain/rules.ts), and the
 * executor keeps the voice flow state, the open-names memory and the confirmation ticket. Ported from the
 * MVP's createExecutor (MVP-05 §3–4, §10; MVP-04) with KSK services in place of the zustand store; the
 * handlers live in ./handlers (context, select, marking, submit, status, capabilities, reports, self, staff), the tap,
 * screen and verification hooks in ./handlers/events (the trainer's own check in ./handlers/self, D-141). A voice plan without a marking flow (the principal, D-139) gets the
 * overview executor instead (./executor-overview): today's state, the screens and the notices. No browser globals:
 * it can move behind a relay unchanged.
 */
import type { VoiceFlowState } from '@/domain/voice/flow';
import type { FlowPlan, NavTarget, VoicePlan } from '@/domain/voice/plan';
import { parseModelStatus, safeText } from '@/domain/voice/types';
import type { DraftChange, DraftSnapshot } from '@/services/marking-draft';
import { purposeKey, type VerificationEvent } from '@/services/verification';
import { minutesOfDay } from '@/lib/time';
import { autoOpenEvent, freshStart, reconnectEvent, refreshEvent, RESUME_EVENT, sessionStartEvent } from './app-events';
import { awayReconnectEvent, awayRefreshEvent, awayResumeEvent, selfStartEvent } from './overview';
import { confirmSubmitInstruction, greetingFor, markableNow } from './instructions';
import { countsOf, sessionLabel, word } from './labels';
import { buildTools, type ToolCall, type ToolName, type ToolResult } from './tools';
import { voiceDebug } from './debug';
import {
  createHandlerContext, dropStaleSubmit, fail, has, INTERNAL_RESULT, markingStep, sameId, str, verifyingBatch, type Args, type Handler, type HandlerContext, type MarkingDeps,
} from './handlers/context';
import { endVoiceSession, getAnnouncements, navigateTool } from './handlers/capabilities';
import { downloadRegister, getAtRisk, getBatchReport, getReportsOverview, getStudentReport, showReport } from './handlers/reports';
import { unknownTool } from './handlers/base';
import { getMyAttendance, leftMine, markMyAttendance, selfCheckHook } from './handlers/self';
import { getStaffToday, markStaff, staffRefreshQuestion } from './handlers/staff';
import { draftChangeEvent, screenEvent, verificationHook } from './handlers/events';
import { markAttendance, markRemaining, setStudentStatus, skipStudent, startRollCall } from './handlers/marking';
import { getTrades, goBack, selectBatch, selectTrade, verifyAgain } from './handlers/select';
import { getStatus } from './handlers/status';
import { reviewTicket } from './handlers/review';
import { submitAttendance } from './handlers/submit';
import { createOverviewExecutor } from './executor-overview';

export type { ToolCall, ToolResult } from './tools';
export { INTERNAL_RESULT } from './handlers/context';

/** What createExecutor takes: the whole voice plan, and the services and session counters its handlers use. */
export type ExecutorDeps = Omit<MarkingDeps, 'plan' | 'voice'> & { readonly plan: VoicePlan };

/** Where the screen is, from the route (Task 18's screenSignal): the executor compares it with the flow. */
export type ScreenSignal =
  | { readonly kind: 'home' }
  /** My attendance (the trainer's own attendance, D-141). */
  | { readonly kind: 'self' }
  | { readonly kind: 'trade'; readonly tradeId: string }
  | { readonly kind: 'open' | 'mark' | 'review' | 'submitted' | 'record'; readonly sessionKey: string }
  /** Any other screen; `screen` when it is one voice can name (Reports, Offline data, Staff attendance, Attendance). */
  | { readonly kind: 'other'; readonly screen?: NavTarget };

export interface VoiceExecutor {
  execute(call: ToolCall): Promise<ToolResult>;
  /** The marking flow; always IDLE without one. */
  flow(): VoiceFlowState;
  /** `pendingQuestion` (Reconnect): the question still waiting for the trainer's answer, asked again with a new code where it had one. */
  kickoff(kind: 'start' | 'reconnect', languageName: string, pendingQuestion?: string | null): Promise<string>;
  /** `heard`: what the trainer last said, passed only with a pending question (never logged). */
  refresh(pendingQuestion: string | null, heard?: string): Promise<string>;
  /** The text Resume (after Use screen) sends: taps made meanwhile were not told, so the model re-reads what it needs. */
  resumeText(): string;
  /**
   * `quiet`: the session would drop the text (paused for Use screen, or not live). The flow follows the tap, but
   * nothing is asked: no submit code and no navigation; Resume's get_status asks with the review.
   */
  onDraftChange(change: DraftChange, quiet?: boolean): string | null;
  /**
   * `quiet` (read when the hook would ask): as for onDraftChange, the session would drop the text; the flow follows the
   * screen, but no submit code is issued and no screen is pushed (Resume's get_status asks with the review).
   */
  onScreen(signal: ScreenSignal, quiet?: () => boolean): Promise<string | null>;
  onVerification(event: VerificationEvent): Promise<string | null>;
  voidConfirmations(): void;
  readonly endRequested: boolean;
}

const HANDLERS: Readonly<Record<ToolName, Handler>> = {
  get_trades: getTrades,
  select_trade: selectTrade,
  select_batch: selectBatch,
  start_roll_call: startRollCall,
  mark_attendance: markAttendance,
  set_student_status: setStudentStatus,
  skip_student: skipStudent,
  mark_remaining: markRemaining,
  go_back: goBack,
  get_status: getStatus,
  verify_again: verifyAgain,
  navigate: navigateTool,
  get_announcements: getAnnouncements,
  get_reports_overview: getReportsOverview,
  get_batch_report: getBatchReport,
  get_student_report: getStudentReport,
  get_at_risk: getAtRisk,
  show_report: showReport,
  download_register: downloadRegister,
  get_my_attendance: getMyAttendance,
  mark_my_attendance: markMyAttendance,
  get_staff_today: getStaffToday,
  mark_staff: markStaff,
  submit_attendance: submitAttendance,
  end_voice_session: endVoiceSession,
};

/**
 * Run order for the calls of one toolCall message: a mark_remaining sent before set_student_status or
 * mark_attendance calls runs right after the last of them, so for "sab present, sirf Rahul aur Shivam
 * absent" its count already leaves out the named students. Everything else keeps its order (MVP-05 L474).
 */
export function toolCallOrder<T extends { name?: string }>(calls: readonly T[]): T[] {
  const last = calls.map((c) => c.name === 'set_student_status' || c.name === 'mark_attendance').lastIndexOf(true);
  const early = calls.filter((c, i) => c.name === 'mark_remaining' && i < last);
  if (!early.length) return [...calls];
  const rest = calls.filter((c) => !early.includes(c));
  const at = rest.indexOf(calls[last]) + 1;
  return [...rest.slice(0, at), ...early, ...rest.slice(at)];
}

const quoted = (o: { text: string; status: string | null }) => `"${o.text}"${o.status ? ` (${word(o.status)})` : ''}`;

const SELF_PURPOSE = purposeKey({ kind: 'self' });

/** A question that carried a confirmation code: every code is void on a new connection, so it is asked again with a new one. */
const CODED = /confirm_token "/;

/**
 * Before each call (MVP-05 §4.4): forget names of another batch, of a batch that started over (fewer
 * trainer marks than when the name was noted), and names whose students all have a trainer mark now.
 */
function prune(h: HandlerContext, draft: DraftSnapshot | undefined): void {
  const key = h.state.flow.sessionKey;
  const sourced = draft ? Object.keys(draft.sources).length : 0;
  const marked = (id: string) => !!draft && has(draft.sources, id);
  h.state.open = h.state.open.filter((o) => o.key === key && sourced >= o.marked && !(o.ids.length && o.ids.every(marked)));
  if (h.state.named.key !== key) h.state.named = { key, ids: [] };
}

/** The open-names guard (MVP-05 §4.5): while a named student could not be marked, mark_remaining is refused once. */
function openNamesFirst(h: HandlerContext, args: Args, draft: DraftSnapshot | undefined): ToolResult | null {
  const status = parseModelStatus(args.status, h.deps.plan.statuses);
  if (h.state.flow.step !== 'ROLL_CALL' || !status || !draft) return null;
  const pending = h.state.open.filter((o) => o.status !== status);
  if (!pending.some((o) => !o.asked)) return null;
  for (const o of pending) o.asked = true;
  return fail(
    'WRONG_STEP',
    `Nobody else was marked: ${pending.map(quoted).join(' and ')} could not be marked yet. Ask the trainer about that first (by father's name when two students share the name) and mark them with set_student_status, then call mark_remaining again.`,
    { unresolved: pending.map((o) => o.text), counts: countsOf(draft, h.deps.plan.statuses) },
  );
}

/** After each call (MVP-05 §4.3), with the draft as it was before the call. */
function remember(h: HandlerContext, name: ToolName, args: Args, result: ToolResult, draft: DraftSnapshot | undefined): void {
  const key = draft?.key;
  if (!key) return;
  const status = parseModelStatus(args.status, h.deps.plan.statuses);
  const marked = Object.keys(draft.sources).length;
  if (name === 'set_student_status' && (result.error === 'NOT_FOUND' || result.error === 'AMBIGUOUS')) {
    const ids = ((result.candidates as { id: string }[] | undefined) ?? []).map((c) => c.id);
    h.state.open.push({ key, text: safeText(str(args.student), 60), status, ids, marked, asked: false });
  } else if (name === 'set_student_status' && result.ok) {
    const id = (result.student as { id: string }).id;
    const fresh = result.fresh === true;
    h.state.open = h.state.open.filter((o) => !o.ids.includes(id) && !(fresh && !o.ids.length)); // that name is sorted out
    if (fresh) h.state.named.ids.push(id);
  } else if (name === 'mark_attendance' && result.error === 'NOT_CURRENT') {
    const st = draft.students.find((x) => sameId(x.id, str(args.student_id)));
    if (st && !has(draft.sources, st.id)) h.state.open.push({ key, text: safeText(st.name, 60), status, ids: [st.id], marked, asked: false });
  } else if (result.ok && (name === 'mark_attendance' || name === 'skip_student' || name === 'mark_remaining')) {
    h.state.named.ids = []; // the roll call moved on
    if (name === 'mark_remaining') h.state.open = [];
  }
}

/** The executor for this voice plan: the marking executor where it has a marking flow, else the overview executor. */
export function createExecutor(deps: ExecutorDeps): VoiceExecutor {
  const voice = deps.plan;
  return voice.marking ? createMarkingExecutor({ ...deps, plan: voice.marking, voice }) : createOverviewExecutor({ ...deps, voice });
}

function createMarkingExecutor(deps: MarkingDeps & { readonly plan: FlowPlan }): VoiceExecutor {
  const h = createHandlerContext(deps);
  const declared = new Set<string>(buildTools(deps.voice).map((t) => t.name));
  const draftNow = () => (h.state.flow.sessionKey ? deps.drafts.get(h.state.flow.sessionKey) : undefined);
  /**
   * The screen the trainer is on away from the batch screens while no batch is being marked or checked (its facts
   * replace the step hint). A batch waiting for its check keeps the check texts, wherever the screen went on the way.
   */
  const awayNow = () => (markingStep(h.state.flow.step) || verifyingBatch(h.state.flow) ? null : h.state.away);
  /** Voice started on My attendance with the trainer's own attendance still to mark: the start offers it. */
  const offerOwn = async () => h.state.away === 'my_attendance' && deps.voice.capabilities.selfAttendance && !(await deps.staffAttendance.myRecord(deps.ctx));

  async function run(name: string, args: Args): Promise<ToolResult> {
    if (!declared.has(name)) return unknownTool(name);
    const tool = name as ToolName;
    const before = draftNow();
    prune(h, before);
    dropStaleSubmit(h.state); // a code from a review the trainer has left
    if (tool === 'mark_remaining') {
      const refused = openNamesFirst(h, args, before);
      if (refused) return refused;
    }
    const result = await HANDLERS[tool](h, args);
    remember(h, tool, args, result, before);
    dropStaleSubmit(h.state);
    return result;
  }

  return {
    async execute(call) {
      const args: Args = call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {};
      try {
        return await run(typeof call.name === 'string' ? call.name : '', args);
      } catch {
        return { ...INTERNAL_RESULT };
      }
    },
    flow: () => h.state.flow,
    // Called after the new connection voided every code (D-082): a code issued here is bound to that connection.
    // At the review, while a submit could go ahead, the text asks the submit question with it, so one yes submits.
    // A fresh start with exactly one markable session (no trade step) opens it at once, through the same path as the
    // model's select_batch (D-134): the session runs the kickoff on the tool queue once the connection is live.
    // Never when voice started away from the batch screens (My attendance, Reports, the staff screen): the screen the
    // trainer chose stays, and the start offers own attendance (on My attendance, when unmarked) or reads the batches.
    // With a trade step the trainer's whole board is loaded with the view (one Promise.all): the start reads only the
    // trades with something markable now, and a later offer after a submit can name any trade (D-134).
    async kickoff(kind, languageName) {
      const [view, board] = await Promise.all([h.view(), deps.plan.tradeStep ? h.wholeBoard().catch(() => undefined) : undefined]);
      if (kind === 'start') {
        const greeting = greetingFor(Math.floor(minutesOfDay(deps.ctx.clock.now()) / 60));
        if (freshStart(view) && (await offerOwn())) return selfStartEvent(languageName, greeting);
        const open = view.cards.filter(markableNow);
        if (open.length === 1 && !deps.plan.tradeStep && !h.state.away && freshStart(view)) {
          // a throwing service falls back to the question that offers it (as an INTERNAL answer would to the model)
          const result = await run('select_batch', { batch: open[0].key }).catch((e: unknown) => {
            voiceDebug(`kickoff auto-open failed for ${open[0].key}: ${e instanceof Error ? e.name : 'error'}`);
            return null;
          });
          if (result) return autoOpenEvent(result, sessionLabel(open[0], deps.plan.slotWords), languageName, greeting);
          return sessionStartEvent(await h.view(), languageName, greeting);
        }
        return sessionStartEvent(view, languageName, greeting, board);
      }
      const token = reviewTicket(h, view);
      const away = awayNow();
      if (!token && away) return awayReconnectEvent(away);
      return reconnectEvent(token ? confirmSubmitInstruction(view, token) : null);
    },
    async refresh(pendingQuestion, heard = '') {
      const view = await h.view();
      // a mark_staff question (with staff marking in the plan) is asked again with its own new code, never the submit's
      const staff = await staffRefreshQuestion(h, pendingQuestion);
      if (staff !== undefined) return refreshEvent(view, staff, staff ? heard : '');
      const coded = !!pendingQuestion && CODED.test(pendingQuestion);
      // a pending question without a code (which of two students) is asked again as it was; one with a code is asked
      // with a code issued now, or, when none can be (submitted meanwhile, back on the list), the step hint stands
      const token = !pendingQuestion || coded ? reviewTicket(h, view) : null;
      const question = token ? confirmSubmitInstruction(view, token) : coded ? null : pendingQuestion;
      const away = awayNow();
      if (!question && away) return awayRefreshEvent(away);
      return refreshEvent(view, question, question && pendingQuestion ? heard : '', !!pendingQuestion);
    },
    resumeText() {
      const away = awayNow();
      return away ? awayResumeEvent(away) : RESUME_EVENT;
    },
    onDraftChange: (change, quiet = false) => draftChangeEvent(h, change, quiet),
    onScreen: (signal, quiet) => {
      leftMine(h, signal.kind === 'self');
      return screenEvent(h, signal, quiet).finally(() => dropStaleSubmit(h.state));
    },
    // the trainer's own check (mark_my_attendance) or a batch's gateway: each follows only its own events
    onVerification: (event) => (event.purpose === SELF_PURPOSE ? selfCheckHook(h, event) : verificationHook(h, event).finally(() => dropStaleSubmit(h.state))),
    voidConfirmations() {
      h.state.ticket = null;
      h.state.staffTicket = null;
    },
    get endRequested() {
      return h.state.endRequested;
    },
  };
}

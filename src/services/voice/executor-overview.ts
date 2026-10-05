/**
 * The executor for a voice plan without a marking flow (the principal, D-139): today's state at the institute, the
 * screens of the plan, today's notices, the reports (D-140) and staff attendance (D-141). The one write is mark_staff,
 * after its own confirmation code (./handlers/staff); corrections are never made by voice. There is no batch flow and no
 * draft, so taps and screens have nothing to tell the model; verification events matter only to a check that
 * mark_my_attendance opened (with own attendance in the plan). No browser globals.
 */
import type { VoiceFlowState } from '@/domain/voice/flow';
import { minutesOfDay } from '@/lib/time';
import type { VoiceExecutor } from './executor';
import { freshBaseState, unknownTool, type BaseContext, type BaseDeps, type BaseHandler } from './handlers/base';
import { endVoiceSession, getAnnouncements, getToday, loadToday, navigateTool } from './handlers/capabilities';
import { downloadRegister, getAtRisk, getBatchReport, getReportsOverview, getStudentReport, showReport } from './handlers/reports';
import { getMyAttendance, leftMine, markMyAttendance, selfCheckHook } from './handlers/self';
import { getStaffToday, markStaff, staffRefreshQuestion } from './handlers/staff';
import { INTERNAL_RESULT } from './handlers/context';
import { greetingFor } from './instructions';
import { OVERVIEW_RECONNECT_EVENT, OVERVIEW_RESUME_EVENT, overviewReconnectAskEvent, overviewRefreshEvent, overviewStartEvent } from './overview';
import { buildTools, type ToolName } from './tools';

const HANDLERS: Partial<Readonly<Record<ToolName, BaseHandler>>> = {
  get_status: getToday,
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
  end_voice_session: endVoiceSession,
};

/** No batch flow: the state the marking executor starts from before anything is loaded, and never leaves here. */
const NO_FLOW: VoiceFlowState = { step: 'IDLE', tradeId: null, sessionKey: null, currentId: null, skipped: [], rollCall: false, lastMarked: null, lastSkippedId: null };

export function createOverviewExecutor(deps: BaseDeps): VoiceExecutor {
  const state = freshBaseState();
  const h: BaseContext = {
    deps,
    state,
    navigate(href, replace) {
      state.lastNav = href;
      state.screen = href;
      deps.bus.emit({ type: 'navigate', href, replace });
    },
    afterNavigate: async () => '',
  };
  const declared = new Set<string>(buildTools(deps.voice).map((t) => t.name));

  return {
    async execute(call) {
      const name = typeof call.name === 'string' ? call.name : '';
      const handler = declared.has(name) ? HANDLERS[name as ToolName] : undefined;
      if (!handler) return unknownTool(name);
      const args = call.args && typeof call.args === 'object' && !Array.isArray(call.args) ? call.args : {};
      try {
        return await handler(h, args);
      } catch {
        return { ...INTERNAL_RESULT };
      }
    },
    flow: () => NO_FLOW,
    // Reconnect: a pending mark_staff question is asked again with a code for the new connection, as a refresh does
    async kickoff(kind, languageName, pendingQuestion = null) {
      if (kind === 'reconnect') {
        const staff = await staffRefreshQuestion(h, pendingQuestion);
        return staff ? overviewReconnectAskEvent(staff) : OVERVIEW_RECONNECT_EVENT;
      }
      const greeting = greetingFor(Math.floor(minutesOfDay(deps.ctx.clock.now()) / 60));
      return overviewStartEvent(await loadToday(deps), languageName, greeting);
    },
    // a pending mark_staff question is asked again with a code for the new connection (the old one is void, D-082)
    async refresh(pendingQuestion, heard = '') {
      const staff = await staffRefreshQuestion(h, pendingQuestion);
      const question = staff === undefined ? pendingQuestion : staff;
      return overviewRefreshEvent(await loadToday(deps), question, question ? heard : '');
    },
    resumeText: () => OVERVIEW_RESUME_EVENT,
    onDraftChange: () => null,
    async onScreen(signal) {
      state.lastNav = null;
      leftMine(h, signal.kind === 'self');
      return null;
    },
    onVerification: (event) => selfCheckHook(h, event),
    voidConfirmations() {
      state.staffTicket = null;
    },
    get endRequested() {
      return state.endRequested;
    },
  };
}

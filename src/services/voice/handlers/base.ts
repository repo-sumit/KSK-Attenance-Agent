/**
 * What every voice plan's handlers share, with or without a marking flow (D-139): the services the capability tools
 * read, the screen memory (what voice last opened, the report it last answered from), the end of voice and the result
 * helpers (`fail`, `str`). The marking handlers' context (`HandlerContext`, ./context) extends this one, so a
 * capability handler runs unchanged beside the marking tools.
 */
import type { StatusCode } from '@/domain/status';
import type { ConfirmTicket } from '@/domain/voice/confirm';
import type { NavTarget, VoicePlan } from '@/domain/voice/plan';
import { safeText } from '@/domain/voice/types';
import type { AnnouncementService } from '@/services/announcements';
import type { AttendanceService } from '@/services/attendance';
import type { SessionContext } from '@/services/context';
import type { ReportService } from '@/services/reports';
import type { StaffAttendanceService } from '@/services/staff-attendance';
import type { VerificationNeed, VerificationService } from '@/services/verification';
import type { ActionBus } from '../action-bus';
import type { ToolResult } from '../tools';

export interface BaseDeps {
  readonly ctx: SessionContext;
  /** The whole voice plan: its capabilities say which tools exist (D-081). */
  readonly voice: VoicePlan;
  readonly bus: ActionBus;
  readonly attendance: AttendanceService;
  readonly announcements: AnnouncementService;
  readonly staffAttendance: StaffAttendanceService;
  /** Read-only figures for the report tools (D-140). */
  readonly reports: ReportService;
  /** The checks before a batch's list and before the trainer's own attendance (D-086, D-141). */
  readonly verification: VerificationService;
  /** Real elapsed time for the confirmation TTL (never the demo's frozen business clock). */
  readonly nowMs: () => number;
  /** The confirmation counters (D-082, ../trainer-turns): trainer turns, ended model turns, and turnSeq when the trainer's latest turn began. */
  readonly speechSeq: () => number;
  readonly turnSeq: () => number;
  readonly spokeAtTurn: () => number;
  readonly generation: () => number;
  /** A number in [0, 1). */
  readonly entropy: () => number;
}

/** What voice knows of a check on screen, as the gateway screen counts it (it starts again with the screen). */
export interface CheckMemory {
  readonly prompts: Set<string>;
  cameraPending: boolean;
  /** Failed face tries, counted as the screen counts them toward faceRetryLimit: no match, or a check that could not see one clear face. */
  faceFailures: number;
  /** The tap the screen is waiting for (its latest prompt), until anything else happens. */
  need: VerificationNeed | null;
}

export const freshCheck = (): CheckMemory => ({ prompts: new Set(), cameraPending: false, faceFailures: 0, need: null });

/** What the last report answer was about: show_report shows exactly that (a failed lookup leaves it as it was). */
export type ReportFocus = { readonly kind: 'overview' } | { readonly kind: 'batch'; readonly batchId: string } | { readonly kind: 'at_risk' } | { readonly kind: 'staff' };

export interface BaseState {
  /** The last href voice navigated to, consumed by the next screen signal. */
  lastNav: string | null;
  /** Where the screen is: the href of the latest screen signal, or of voice's own latest navigation (null: unknown). */
  screen: string | null;
  /**
   * The screen the trainer is on away from the batch screens, from the latest screen signal: My attendance, a screen
   * voice can name (Reports, the staff screen), or 'other'. Null on Home, a trade or a batch screen, and before any
   * signal (voice started on Home).
   */
  away: NavTarget | 'other' | null;
  endRequested: boolean;
  /** The report voice last answered from (null: none yet). */
  report: ReportFocus | null;
  /** The check for the trainer's own attendance that mark_my_attendance opened, until it passes or the trainer leaves (D-141). */
  self: CheckMemory | null;
  /** The open mark_staff question's code (D-082, D-141). */
  staffTicket: ConfirmTicket | null;
  /** Who and what the last mark_staff question asked about, until it is saved: a refresh asks it again with a new code. */
  staffQuestion: { readonly staffId: string; readonly status: StatusCode } | null;
  /**
   * The open mark_remaining_staff question's code and status (D-156): its own ticket, so a mark_staff question asked in
   * the same breath does not void it (each would void the other in turn); a save of either voids the other by its records.
   */
  staffRestTicket: ConfirmTicket | null;
  staffRestQuestion: { readonly status: StatusCode } | null;
}

export interface BaseContext {
  readonly deps: BaseDeps;
  readonly state: BaseState;
  /** Every href is built with `routes.*` (or the SCREENS map), never from a model string. */
  navigate(href: string, replace: boolean): void;
  /** What a navigation result adds for the flow in progress (a roll call still open), or ''. */
  afterNavigate(): Promise<string>;
  /** After the trainer's own mark (D-152): what the same turn goes on to (the students), or ''. */
  afterSelfMarked(): Promise<string>;
}

export type BaseHandler = (h: BaseContext, args: Readonly<Record<string, unknown>>) => Promise<ToolResult>;

export const freshBaseState = (): BaseState => ({
  lastNav: null, screen: null, away: null, endRequested: false, report: null, self: null, staffTicket: null, staffQuestion: null, staffRestTicket: null, staffRestQuestion: null,
});

/** `instruction` last, so an extra field can never replace it (MVP-05 L430-L435). */
export function fail(error: string, instruction: string, extra: Record<string, unknown> = {}): ToolResult {
  return { ok: false, error, ...extra, instruction };
}

/** Loose model input (MVP-04 §2.4): a trimmed string, a finite number as text, anything else empty. */
export const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');

/** A feature that is switched off has no tool (D-081): an undeclared name is unknown, whatever the model sends. */
export function unknownTool(name: string): ToolResult {
  return { ok: false, error: 'UNKNOWN_TOOL', instruction: `The app has no tool called ${safeText(name, 60) || 'that'}. Use only the tools you were given.` };
}

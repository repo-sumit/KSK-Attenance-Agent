/**
 * Voice plan compiler (voice design §5.2, D-081, D-139): turns the resolved configuration, the journey and the
 * access scope into the facts voice needs: the marking flow (`FlowPlan`, null where there is no batch marking) and
 * the capabilities beside it (own attendance, reports, staff marking, announcements, downloads, the screens voice
 * can open). Later layers declare tools and prompt lines only from this plan, so a feature that is switched off
 * (no trade step, no verification, no Leave, no announcements) is absent here.
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import type { Journey } from '@/config/journey';
import type { AppConfiguration, Language, ReportBlock } from '@/config/types';
import type { AccessScope } from '@/domain/access';
import type { StatusCode } from '@/domain/status';

export interface FlowPlan {
  readonly selection: 'trade_picker' | 'trade_switcher' | 'batch_list' | 'timetable';
  readonly tradeStep: boolean;
  readonly slotWords: 'once' | 'halves' | 'signin_signout' | 'period';
  readonly verification: { readonly location: 'none' | 'background' | 'fence'; readonly face: boolean; readonly required: boolean };
  readonly defaultStatus: 'present' | 'absent' | 'blank';
  readonly startStyle: 'roll_call' | 'exceptions';
  readonly rollCallSwitch: boolean;
  readonly statuses: readonly StatusCode[];
  readonly ojtVisible: boolean;
  readonly details: { readonly half: boolean; readonly leaveType: boolean; readonly leaveDays: boolean };
  readonly languages: readonly Language[];
  readonly openingLanguage: Language;
  readonly timeFencing: boolean;
}

export interface PlanInput {
  readonly config: AppConfiguration;
  readonly journey: Journey;
  readonly access: AccessScope;
}

function slotWords(marking: Journey['marking']): FlowPlan['slotWords'] {
  if (marking.frequency === 'twice') return marking.twiceShape;
  return marking.frequency;
}

/** The marking flow: null when voice does not exist for this session or there is no batch marking (the institute view). */
export function compileFlowPlan(input: PlanInput, screenLanguage: Language): FlowPlan | null {
  const { journey, access } = input;
  if (!journey.voice.enabled) return null;
  const selection = access.selection;
  if (selection === 'institute') return null;

  const { marking, verification, voice } = journey;
  const statuses = marking.selectable;
  const defaultStatus = marking.defaultStatus;

  return {
    selection,
    tradeStep: selection === 'trade_picker' || selection === 'trade_switcher',
    slotWords: slotWords(marking),
    verification: { location: verification.location, face: verification.face, required: verification.required },
    defaultStatus,
    // Exceptions mean "everyone present unless said": only over a Present default. Any other default is a roll call.
    startStyle: defaultStatus !== 'present' ? 'roll_call' : voice.markingStyle === 'roll_call' ? 'roll_call' : 'exceptions',
    rollCallSwitch: defaultStatus !== 'blank',
    statuses,
    ojtVisible: marking.ojtVisible,
    details: { half: marking.halfDayHalves, leaveType: statuses.includes('leave'), leaveDays: marking.leaveDateRange },
    languages: voice.languages,
    openingLanguage: voice.languages.includes(screenLanguage) ? screenLanguage : voice.defaultLanguage,
    timeFencing: journey.timeFencing,
  };
}

/** A screen voice can open (navigate): every screen the journey has, by name. */
export type NavTarget = 'home' | 'attendance' | 'reports' | 'my_attendance' | 'offline' | 'staff_attendance' | 'announcements';

/** What voice can do besides marking a batch (D-139). A capability that is off has no tool and no prompt line. */
export interface VoiceCapabilities {
  /** The instructor marks their own attendance (journey.staff.selfCanMark). */
  readonly selfAttendance: boolean;
  /** Report questions: the instructor's own batches or the whole institute; null without a report section voice answers from. */
  readonly reports: 'instructor' | 'institute' | null;
  /**
   * The report sections the Reports screen has (journey.reports.blocks), so voice answers and shows only what the screen
   * shows: the batches (my_batches or trade_batch: batch reports and the register download), the at-risk students
   * (student_percentage), the institute headline (institute_summary) and staff attendance (staff_summary with the
   * principal's staff view: the staff report and the staff register, D-154, D-156).
   */
  readonly reportSections: ReportSections;
  /** The principal marks staff who have no record yet (journey.staff.principalCanMark). */
  readonly staffMarking: boolean;
  /** The statuses a staff member can be marked with by voice (journey.staff.statusSet); empty without staff marking. */
  readonly staffStatuses: readonly StatusCode[];
  readonly announcements: boolean;
  /** The register download (reports.pdfDownload), from the batches section or the staff section, where its sheet opens. */
  readonly downloads: boolean;
  readonly navTargets: readonly NavTarget[];
}

export interface ReportSections {
  readonly batches: boolean;
  readonly atRisk: boolean;
  readonly institute: boolean;
  readonly staff: boolean;
}

export interface VoicePlan {
  /** Whose home this is: an instructor's classes or the institute overview (journey.homeVariant). */
  readonly scope: 'instructor' | 'institute';
  /** The batch-marking flow; null where nobody marks batches by voice (the principal, D-139). */
  readonly marking: FlowPlan | null;
  readonly capabilities: VoiceCapabilities;
  readonly languages: readonly Language[];
  readonly openingLanguage: Language;
}

/** Every screen of the journey voice may open, in a fixed order. */
function navTargets(journey: Journey): NavTarget[] {
  const has: Readonly<Record<NavTarget, boolean>> = {
    home: true,
    attendance: journey.navTabs.includes('attendance'),
    reports: journey.navTabs.includes('reports'),
    my_attendance: journey.staff.selfCanMark,
    offline: journey.offline.enabled,
    staff_attendance: journey.staff.principalStaffView,
    announcements: journey.announcements.enabled,
  };
  return (Object.keys(has) as NavTarget[]).filter((t) => has[t]);
}

/** The report sections of the journey's Reports screen (none without reports), as ReportsScreen renders them. */
function reportSections(journey: Journey): ReportSections {
  const { reports } = journey;
  const has = (block: ReportBlock) => reports.enabled && reports.blocks.includes(block);
  return {
    batches: has('my_batches') || has('trade_batch'),
    atRisk: has('student_percentage'),
    institute: has('institute_summary'),
    staff: has('staff_summary') && journey.staff.principalStaffView,
  };
}

/** Null only when voice does not exist for this session (journey.voice.enabled false). */
export function compileVoicePlan(input: PlanInput, screenLanguage: Language): VoicePlan | null {
  const { journey } = input;
  if (!journey.voice.enabled) return null;
  const { voice, reports } = journey;
  const scope = journey.homeVariant;
  const sections = reportSections(journey);
  return {
    scope,
    marking: compileFlowPlan(input, screenLanguage),
    capabilities: {
      selfAttendance: journey.staff.selfCanMark,
      reports: sections.batches || sections.atRisk || sections.institute || sections.staff ? scope : null,
      reportSections: sections,
      staffMarking: journey.staff.principalCanMark,
      staffStatuses: journey.staff.principalCanMark ? journey.staff.statusSet : [],
      announcements: journey.announcements.enabled,
      downloads: (sections.batches || sections.staff) && reports.pdfDownload,
      navTargets: navTargets(journey),
    },
    languages: voice.languages,
    openingLanguage: voice.languages.includes(screenLanguage) ? screenLanguage : voice.defaultLanguage,
  };
}

/**
 * Typed configuration model. Every state variation is a value here (PRD §5, §14),
 * never a branch on a state or person's name in components. Each field notes the
 * PRD registry key it implements; docs/CONFIGURATION.md describes the resulting
 * user-visible behaviour of every option.
 */
import type { ShiftNo, TimeWindow } from '@/domain/entities';
import type { StatusCode } from '@/domain/status';
import type { LocalTime } from '@/lib/time';

export type Language = 'en' | 'mr';

export type MappingModel = 'open' | 'trade' | 'batch' | 'timetable';
export type GeoMode = 'off' | 'tagging' | 'fencing';
export type MarkingFrequency = 'once' | 'twice' | 'period';
export type DefaultStatus = 'present' | 'absent' | 'blank';
export type ReportBlock =
  | 'my_attendance'
  | 'my_batches'
  | 'student_percentage'
  | 'institute_summary'
  | 'trade_batch'
  | 'staff_summary'
  | 'correction_log';
export type DateRangeKind = 'day' | 'week' | 'month' | 'custom';

export interface IdentityConfig {
  /** login.institute_confirm_step */
  readonly instituteConfirmStep: boolean;
  /** login.instructor_confirm_step */
  readonly instructorConfirmStep: boolean;
  /** login.second_factor — only 'none' is implemented (PRD open question 1). */
  readonly secondFactor: 'none';
  /** role.principal_can_correct */
  readonly principalCanCorrect: boolean;
  /** PRD §3 "principal marks any batch" — decided: only while the batch's window is open (DECISIONS D-011). */
  readonly principalCanMarkStudents: boolean;
}

export interface MappingConfig {
  /** mapping.model — 'batch' extends the PRD: an explicit per-instructor batch allow-list (PRD §7.3 hard mapping without periods). */
  readonly model: MappingModel;
  /** mapping.trade_autoselect */
  readonly tradeAutoselect: boolean;
  /** mapping.multi_trade */
  readonly multiTrade: 'none' | 'named' | 'all';
  /** mapping.all_batch_instructors — special instructors (e.g. Employability Skills) may reach batches across trades. */
  readonly allBatchInstructors: boolean;
}

export interface VerificationConfig {
  /** verify.geo_mode */
  readonly geoMode: GeoMode;
  /** verify.fence_radius_m */
  readonly fenceRadiusM: number;
  /** verify.fence_pass_prompt */
  readonly fencePassPrompt: 'silent' | 'confirm';
  /** verify.face */
  readonly face: boolean;
  /** verify.face_retry_limit — null = unlimited */
  readonly faceRetryLimit: number | null;
}

export interface MarkingConfig {
  /** mark.frequency */
  readonly frequency: MarkingFrequency;
  /** mark.twice_shape */
  readonly twiceShape: 'halves' | 'signin_signout';
  /** mark.default_status */
  readonly defaultStatus: DefaultStatus;
  /** mark.status_set — present and absent are always included. */
  readonly statusSet: readonly StatusCode[];
  /** mark.half_day_halves */
  readonly halfDayHalves: boolean;
  /** mark.leave_date_range */
  readonly leaveDateRange: boolean;
}

export interface TimeConfig {
  /** time.fencing */
  readonly fencing: boolean;
  /** time.shift_windows */
  readonly shiftWindows: Readonly<Record<ShiftNo, TimeWindow>>;
  /** When the second mark opens in twice-daily mode, per shift (derived "after lunch" split). */
  readonly twiceSplit: Readonly<Record<ShiftNo, LocalTime>>;
  /** time.institute_override */
  readonly instituteOverride: boolean;
}

export interface StaffConfig {
  /** staff.attendance */
  readonly enabled: boolean;
  /** staff.self_marking */
  readonly selfMarking: boolean;
  /** staff.capture_trigger — only explicit_tap is implemented (PRD §18.2 recommended default). */
  readonly captureTrigger: 'explicit_tap';
  /** staff.principal_marking */
  readonly principalMarking: boolean;
  /** staff.status_set */
  readonly statusSet: readonly StatusCode[];
}

export interface ReportsConfig {
  /** report.enabled */
  readonly enabled: boolean;
  /** report.instructor_scope */
  readonly instructorScope: 'marked_only' | 'mapped' | 'both';
  /** report.blocks */
  readonly blocks: readonly ReportBlock[];
  /** report.date_ranges */
  readonly dateRanges: readonly DateRangeKind[];
  /** report.pdf_download */
  readonly pdfDownload: boolean;
  /** Attendance % below which a student is flagged "at risk" (exam eligibility; PRD gives no value — extension, D-022). */
  readonly eligibilityThresholdPct: number;
  /** Order of a batch's student list in Reports: best attendance first, or lowest first (extension, D-053). */
  readonly leaderboardSort: 'high_first' | 'low_first';
  /** Months in the "My attendance" trend, this month included; 0 hides it (extension, D-053). */
  readonly trendMonths: number;
  /** Batch averages, leaderboards and at-risk cover the last N days (rolling, so early in a month is not thin; D-053). */
  readonly windowDays: number;
  /** A student is flagged at risk only once this many days are marked in the window (one absence is not a pattern). */
  readonly atRiskMinDays: number;
}

/** Institute / state announcements on Home (extension: the PRD has no notices, D-054). */
export interface AnnouncementsConfig {
  readonly enabled: boolean;
}

export interface OfflineConfig {
  /** offline.enabled */
  readonly enabled: boolean;
  /** offline.refresh_days */
  readonly refreshDays: number;
  /** offline.manual_refresh */
  readonly manualRefresh: boolean;
  /** offline.multi_select */
  readonly multiSelect: boolean;
  /** offline.max_batches — null = unlimited */
  readonly maxBatches: number | null;
  /** offline.auto_sync */
  readonly autoSync: boolean;
  /** offline.sync_on_open */
  readonly syncOnOpen: boolean;
  /** offline.eod_trigger_time (server-side job; shown for information only) */
  readonly eodTriggerTime: LocalTime;
}

export interface I18nConfig {
  /** i18n.languages */
  readonly languages: readonly Language[];
  /** i18n.default_language */
  readonly defaultLanguage: Language;
  /** i18n.user_switch */
  readonly userSwitch: boolean;
  /** i18n.fallback */
  readonly fallback: Language;
  /** Digits for counts, dates and times: the language's locale digits, or always 0–9 (extension). */
  readonly numerals: 'locale' | 'latin';
}

export type VoiceMarkingStyle = 'auto' | 'roll_call' | 'exceptions';

/** Voice Agent (extension of the PRD registry, docs/voice design §6). */
export interface VoiceConfig {
  /** voice.enabled */
  readonly enabled: boolean;
  /** voice.languages — a non-empty subset of i18n.languages (D-080). */
  readonly languages: readonly Language[];
  /** voice.default_language — opening language when the screen language is not a voice language. */
  readonly defaultLanguage: Language;
  /** voice.marking_style — auto: by exception when the default status is Present, else roll call. */
  readonly markingStyle: VoiceMarkingStyle;
  /** voice.voice_name — Gemini prebuilt voice. */
  readonly voiceName: string;
  /** voice.max_minutes_per_session — cumulative across reconnects. */
  readonly maxMinutesPerSession: number;
  /** voice.idle_timeout_seconds */
  readonly idleTimeoutSeconds: number;
  /** voice.daily_minutes_per_trainer */
  readonly dailyMinutesPerTrainer: number;
  /** voice.transcript_retention_days — 0: captions stay in memory and are never stored. */
  readonly transcriptRetentionDays: number;
}

export interface AppConfiguration {
  readonly identity: IdentityConfig;
  readonly mapping: MappingConfig;
  readonly verification: VerificationConfig;
  readonly marking: MarkingConfig;
  readonly time: TimeConfig;
  readonly staff: StaffConfig;
  readonly reports: ReportsConfig;
  readonly offline: OfflineConfig;
  readonly announcements: AnnouncementsConfig;
  readonly i18n: I18nConfig;
  readonly voice: VoiceConfig;
}

type DeepPartial<T> = { -readonly [K in keyof T]?: T[K] extends readonly unknown[] ? T[K] : T[K] extends object ? DeepPartial<T[K]> : T[K] };

/** A partial configuration contributed by one scope (PRD §5.1). */
export type ConfigLayer = DeepPartial<AppConfiguration>;

export type ConfigScope = 'state' | 'district' | 'institute' | 'role';

/** Dotted key path such as "verification.fenceRadiusM". */
export type ConfigKeyPath = string;

export interface ScopedLayer {
  readonly scope: ConfigScope;
  readonly layer: ConfigLayer;
}

export interface StateConfiguration {
  readonly stateId: string;
  readonly stateName: string;
  /** State instance is the floor: every key has a state-level value. */
  readonly base: AppConfiguration;
  /** Keys the state has opened for narrower scopes to override (PRD §5.1). */
  readonly overridableKeys: readonly ConfigKeyPath[];
  readonly districtLayers?: Readonly<Record<string, ConfigLayer>>;
  readonly instituteLayers?: Readonly<Record<string, ConfigLayer>>;
}

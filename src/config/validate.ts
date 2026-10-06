/**
 * Configuration-set validation (PRD §14.6). Invalid combinations are rejected,
 * never silently resolved. Warnings flag combinations the PRD calls risky.
 */
import type { MasterData } from '@/domain/entities';
import { isPrebuiltVoice } from '@/domain/voice/voices';
import type { AppConfiguration } from './types';

export interface ValidationIssue {
  readonly severity: 'error' | 'warning';
  readonly code: string;
  readonly message: string;
}

export interface ValidationContext {
  readonly data: MasterData;
  readonly enrolledFaceCount: number;
}

export function validateConfiguration(config: AppConfiguration, ctx: ValidationContext): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (severity: ValidationIssue['severity'], code: string, message: string) => issues.push({ severity, code, message });
  const { marking, time, verification, mapping, i18n, staff } = config;

  if (!marking.statusSet.includes('present') || !marking.statusSet.includes('absent'))
    add('error', 'status_set_core', 'Present and absent must always be in mark.status_set.');
  if (marking.halfDayHalves && !marking.statusSet.includes('half_day'))
    add('error', 'half_day_halves_without_half_day', 'mark.half_day_halves is on but half day is not in the status set.');
  if (time.fencing && (!time.shiftWindows[1] || !time.shiftWindows[2]))
    add('error', 'fencing_without_windows', 'time.fencing is on but a shift has no window.');
  if (verification.face && ctx.enrolledFaceCount === 0)
    add('error', 'face_without_enrolment', 'verify.face is on but no instructor has an enrolled face.');
  if (mapping.model === 'timetable' && ctx.data.timetable.length === 0)
    add('error', 'timetable_without_data', 'mapping.model is timetable but no timetable is loaded.');
  if (marking.frequency === 'period' && ctx.data.timetable.length === 0)
    add('error', 'period_without_data', 'mark.frequency is period but no timetable periods are loaded.');
  if (mapping.model === 'batch' && !ctx.data.staff.some((s) => s.batchIds.length > 0))
    add('error', 'batch_without_assignments', 'mapping.model is batch but no instructor has assigned batches.');
  if (verification.geoMode === 'fencing' && verification.fenceRadiusM <= 0)
    add('error', 'fence_radius', 'verify.fence_radius_m must be a positive number of metres.');
  if (!i18n.languages.includes(i18n.defaultLanguage))
    add('error', 'default_language', 'i18n.default_language must be one of i18n.languages.');
  if (i18n.languages.length < 1 || i18n.languages.length > 3)
    add('error', 'language_count', 'A state ships between one and three languages.');
  if (staff.enabled && !staff.selfMarking && !staff.principalMarking)
    add('error', 'staff_no_path', 'staff.attendance is on but neither capture path is enabled.');
  if (staff.selfBeforeStudents && !(staff.enabled && staff.selfMarking))
    add('error', 'self_before_students_needs_self_marking', 'staff.self_before_students needs staff.attendance with staff.self_marking.');
  const reuse = verification.selfPassReuseMinutes;
  if (!Number.isInteger(reuse) || reuse < 0 || reuse > 60)
    add('error', 'self_pass_reuse_minutes', 'verify.self_pass_reuse_minutes is a whole number of minutes from 0 (off) to 60.');
  if (config.reports.eligibilityThresholdPct < 1 || config.reports.eligibilityThresholdPct > 100)
    add('error', 'threshold_range', 'The at-risk threshold must be a percentage from 1 to 100.');
  if (!(config.reports.staffThresholdPct >= 1 && config.reports.staffThresholdPct <= 100))
    add('error', 'staff_threshold_range', 'The staff attendance threshold must be a percentage from 1 to 100.');
  if (!Number.isInteger(config.reports.trendMonths) || config.reports.trendMonths < 0 || config.reports.trendMonths > 12)
    add('error', 'trend_months', 'The attendance trend covers 0 (hidden) to 12 months.');
  const { windowDays, atRiskMinDays } = config.reports;
  if (!Number.isInteger(windowDays) || windowDays < 7 || windowDays > 120)
    add('error', 'report_window', 'The report window is 7 to 120 days.');
  if (!Number.isInteger(atRiskMinDays) || atRiskMinDays < 1 || atRiskMinDays > windowDays)
    add('error', 'at_risk_min_days', 'The at-risk minimum is 1 day up to the report window.');
  const { voice } = config;
  if (voice.languages.length === 0 || voice.languages.some((l) => !i18n.languages.includes(l)))
    add('error', 'voice_languages', 'voice.languages must be a non-empty subset of i18n.languages.');
  if (!voice.languages.includes(voice.defaultLanguage))
    add('error', 'voice_default_language', 'voice.default_language must be one of voice.languages.');
  if (voice.markingStyle === 'exceptions' && marking.defaultStatus !== 'present')
    add('error', 'voice_marking_style', 'Marking by exception needs mark.default_status = present.');
  if (![voice.voiceName, ...Object.values(voice.voiceNames)].every((n) => typeof n === 'string' && isPrebuiltVoice(n)))
    add('error', 'voice_name', 'voice.voice_name and every voice.voice_names entry must be one of the 30 prebuilt Gemini voices.');
  if (Object.keys(voice.voiceNames).some((l) => !(voice.languages as readonly string[]).includes(l)))
    add('error', 'voice_names_language', 'voice.voice_names may name a voice only for a language in voice.languages.');
  const whole = (n: number) => Number.isInteger(n) && n > 0;
  const limitsOk =
    whole(voice.maxMinutesPerSession) &&
    whole(voice.dailyMinutesPerTrainer) &&
    whole(voice.idleTimeoutSeconds) &&
    voice.idleTimeoutSeconds >= 30 &&
    Number.isInteger(voice.transcriptRetentionDays) &&
    voice.transcriptRetentionDays >= 0;
  if (!limitsOk)
    add(
      'error',
      'voice_limits',
      'Voice limits: the session minutes, the daily minutes and the idle timeout are positive whole numbers (idle at least 30 seconds); the transcript retention is a whole number of days, 0 or more.',
    );

  if (marking.frequency === 'twice' && marking.statusSet.includes('half_day'))
    add('warning', 'twice_with_half_day', 'Twice-daily marking and half day answer the same question (PRD §10.2).');
  if (verification.face && config.offline.enabled)
    add('warning', 'face_with_offline', 'Face matching may need a server call while offline (PRD open question 12).');
  return issues;
}

export const hasErrors = (issues: readonly ValidationIssue[]) => issues.some((i) => i.severity === 'error');

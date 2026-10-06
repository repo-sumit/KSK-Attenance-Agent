import { describe, expect, it } from 'vitest';
import { deriveJourney } from '@/config/journey';
import { resolveConfiguration, restrictLayer } from '@/config/resolve';
import { MAHARASHTRA } from '@/config/states/maharashtra';
import { validateConfiguration } from '@/config/validate';
import { resolveAccess } from '@/domain/access';
import { TODAY, configWith, data, staff } from '../../helpers/fixtures';

describe('configuration resolution (PRD §5.1)', () => {
  it('institute layers may only override keys the state opened', () => {
    const layer = restrictLayer({ verification: { fenceRadiusM: 800, face: false } }, MAHARASHTRA.overridableKeys);
    expect(layer).toEqual({ verification: { fenceRadiusM: 800 } });
  });
  it('applies an allowed institute override and ignores the rest', () => {
    const state = { ...MAHARASHTRA, instituteLayers: { 'inst-27410': { verification: { fenceRadiusM: 800, face: false } } } };
    const cfg = resolveConfiguration({ state, instituteId: 'inst-27410' });
    expect(cfg.verification.fenceRadiusM).toBe(800);
    expect(cfg.verification.face).toBe(true);
  });
  it('always keeps present and absent in the status set', () => {
    expect(configWith({ marking: { statusSet: ['leave'] } }).marking.statusSet).toEqual(expect.arrayContaining(['present', 'absent', 'leave']));
  });
});

describe('validation (PRD §14.6)', () => {
  const ctx = { data, enrolledFaceCount: 10 };
  it('the Maharashtra configuration is valid', () => {
    expect(validateConfiguration(configWith(), ctx).filter((i) => i.severity === 'error')).toEqual([]);
  });
  it('rejects half-day halves without half day', () => {
    const issues = validateConfiguration(configWith({ marking: { halfDayHalves: true } }), ctx);
    expect(issues.map((i) => i.code)).toContain('half_day_halves_without_half_day');
  });
  it('rejects an at-risk threshold outside 1–100 and a trend longer than a year', () => {
    expect(validateConfiguration(configWith({ reports: { eligibilityThresholdPct: 0 } }), ctx).map((i) => i.code)).toContain('threshold_range');
    expect(validateConfiguration(configWith({ reports: { trendMonths: 13 } }), ctx).map((i) => i.code)).toContain('trend_months');
    expect(validateConfiguration(configWith({ reports: { trendMonths: 2.5 } }), ctx).map((i) => i.code)).toContain('trend_months');
    expect(validateConfiguration(configWith({ reports: { windowDays: 3 } }), ctx).map((i) => i.code)).toContain('report_window');
    expect(validateConfiguration(configWith({ reports: { windowDays: 30, atRiskMinDays: 31 } }), ctx).map((i) => i.code)).toContain('at_risk_min_days');
  });
  it('rejects a staff threshold outside 1–100 (report.staff_threshold_pct, D-154)', () => {
    const codes = (pct: number) => validateConfiguration(configWith({ reports: { staffThresholdPct: pct } }), ctx).map((i) => i.code);
    expect(codes(0)).toContain('staff_threshold_range');
    expect(codes(101)).toContain('staff_threshold_range');
    expect(codes(1)).not.toContain('staff_threshold_range');
    expect(codes(100)).not.toContain('staff_threshold_range');
  });
  it('rejects face verification with nobody enrolled', () => {
    expect(validateConfiguration(configWith(), { data, enrolledFaceCount: 0 }).map((i) => i.code)).toContain('face_without_enrolment');
  });
});

describe('journey derivation — disabled means absent (PRD §1.2)', () => {
  const journeyFor = (id: string, overrides = {}, enrolled = true) => {
    const cfg = configWith(overrides);
    return deriveJourney(cfg, staff(id), resolveAccess(staff(id), cfg, data, TODAY), enrolled);
  };
  it('geo off + face off removes the verification screen entirely', () => {
    const j = journeyFor('st-rajesh', { verification: { geoMode: 'off', face: false } });
    expect(j.verification.required).toBe(false);
    expect(j.faceEnrolmentRequired).toBe(false);
  });
  it('geo tagging is a background step', () => expect(journeyFor('st-rajesh', { verification: { geoMode: 'tagging' } }).verification.location).toBe('background'));
  it('face on and not enrolled requires enrolment first', () => expect(journeyFor('st-rajesh', {}, false).faceEnrolmentRequired).toBe(true));
  it('extra statuses appear only when configured', () => {
    expect(journeyFor('st-rajesh').marking.selectable).toEqual(['present', 'absent']);
    expect(journeyFor('st-rajesh', { marking: { statusSet: ['present', 'absent', 'half_day', 'leave', 'ojt'] } }).marking.selectable).toEqual(['present', 'absent', 'half_day', 'leave']);
  });
  it('staff attendance off removes the self card and the staff view', () => {
    const j = journeyFor('st-anil', { staff: { enabled: false } });
    expect(j.staff.principalStaffView).toBe(false);
    expect(j.reports.blocks).not.toContain('staff_summary');
  });
  it('reports off keeps the Reports tab only for Offline data; with offline off too it is gone', () => {
    expect(journeyFor('st-rajesh', { reports: { enabled: false } }).navTabs).toEqual(['home', 'reports']);
    expect(journeyFor('st-rajesh', { reports: { enabled: false }, offline: { enabled: false } }).navTabs).toEqual(['home']);
  });
  it('Home owns today: instructors get Home · Reports; only the institute board adds Attendance (D-052)', () => {
    expect(journeyFor('st-rajesh').navTabs).toEqual(['home', 'reports']);
    expect(journeyFor('st-sunita', { mapping: { model: 'batch' } }).navTabs).toEqual(['home', 'reports']);
    expect(journeyFor('st-anil').navTabs).toEqual(['home', 'attendance', 'reports']);
  });
  it('offline is for every user, the principal included; packs only where the user can mark students (D-153)', () => {
    expect(journeyFor('st-anil').offline).toMatchObject({ enabled: true, packs: true });
    expect(journeyFor('st-rajesh').offline).toMatchObject({ enabled: true, packs: true });
    expect(journeyFor('st-anil', { identity: { principalCanMarkStudents: false } }).offline).toMatchObject({ enabled: true, packs: false });
    // An instructor's packs never depend on the principal's switch.
    expect(journeyFor('st-rajesh', { identity: { principalCanMarkStudents: false } }).offline.packs).toBe(true);
    for (const staff of ['st-rajesh', 'st-anil']) expect(journeyFor(staff, { offline: { enabled: false } }).offline).toMatchObject({ enabled: false, packs: false });
    // The principal already has Reports: the tabs do not change.
    expect(journeyFor('st-anil', { reports: { enabled: false } }).navTabs).toEqual(['home', 'attendance', 'reports']);
  });
  it('Profile is never a navigation tab (it lives in the header avatar menu)', () => {
    for (const staff of ['st-rajesh', 'st-anil']) expect(journeyFor(staff).navTabs).not.toContain('profile');
  });
  it('report sections follow report.blocks: at-risk for both roles, no daily register (D-053)', () => {
    expect(journeyFor('st-rajesh').reports.blocks).toEqual(['my_attendance', 'my_batches', 'student_percentage']);
    expect(journeyFor('st-anil').reports.blocks).toEqual(['institute_summary', 'trade_batch', 'student_percentage', 'staff_summary', 'correction_log']);
    expect(journeyFor('st-rajesh', { reports: { blocks: ['my_batches'] } }).reports.blocks).toEqual(['my_batches']);
  });
  it('the at-risk threshold, leaderboard order and trend are configuration (D-053)', () => {
    const j = journeyFor('st-rajesh', { reports: { eligibilityThresholdPct: 80, leaderboardSort: 'low_first', trendMonths: 0 } });
    expect(j.reports).toMatchObject({ eligibilityThresholdPct: 80, leaderboardSort: 'low_first', trendMonths: 0 });
    expect(journeyFor('st-rajesh').reports).toMatchObject({ eligibilityThresholdPct: 75, leaderboardSort: 'high_first', trendMonths: 3 });
    // The staff threshold (D-154): 90 by default, configurable.
    expect(journeyFor('st-anil').reports.staffThresholdPct).toBe(90);
    expect(journeyFor('st-anil', { reports: { staffThresholdPct: 80 } }).reports.staffThresholdPct).toBe(80);
  });
  it('announcements are on in Maharashtra and can be switched off (D-054)', () => {
    expect(journeyFor('st-rajesh').announcements.enabled).toBe(true);
    expect(journeyFor('st-rajesh', { announcements: { enabled: false } }).announcements.enabled).toBe(false);
  });
});

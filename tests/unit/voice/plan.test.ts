import { describe, expect, it } from 'vitest';
import { deriveJourney } from '@/config/journey';
import type { ConfigLayer } from '@/config/types';
import { resolveAccess } from '@/domain/access';
import { compileFlowPlan, compileVoicePlan } from '@/domain/voice/plan';
import { configWith, data, staff, TODAY } from '../../helpers/fixtures';

const ON: ConfigLayer = { voice: { enabled: true } };
function voiceOffPlan() {
  const config = configWith();
  const user = staff('st-rajesh');
  const access = resolveAccess(user, config, data, TODAY);
  return compileFlowPlan({ config, journey: deriveJourney(config, user, access, true), access }, 'en');
}
function plan(staffId: string, layer: ConfigLayer = {}, screen: 'en' | 'mr' = 'en') {
  const config = configWith({ ...ON, ...layer, voice: { enabled: true, ...layer.voice } });
  const user = staff(staffId);
  const access = resolveAccess(user, config, data, TODAY);
  return compileFlowPlan({ config, journey: deriveJourney(config, user, access, true), access }, screen);
}

describe('compileFlowPlan', () => {
  it('is null when voice is off or for the principal', () => {
    expect(voiceOffPlan()).toBeNull();
    expect(plan('st-anil')).toBeNull();
  });
  it('open mapping, Maharashtra: trade step, fence + face, exceptions', () => {
    expect(plan('st-rajesh', { mapping: { model: 'open' } })).toMatchObject({ selection: 'trade_picker', tradeStep: true, verification: { location: 'fence', face: true, required: true }, startStyle: 'exceptions', rollCallSwitch: true, statuses: ['present', 'absent'], languages: ['en', 'mr'] });
  });
  it('trade mapped with several trades: switcher; batch mapped: no trade step', () => {
    expect(plan('st-sanjay', { mapping: { model: 'trade', multiTrade: 'named' } })).toMatchObject({ selection: 'trade_switcher', tradeStep: true });
    expect(plan('st-sunita', { mapping: { model: 'batch' } })).toMatchObject({ selection: 'batch_list', tradeStep: false });
  });
  it('timetable + period marking + time fence', () => {
    expect(plan('st-vikas', { mapping: { model: 'timetable' }, marking: { frequency: 'period' }, time: { fencing: true } })).toMatchObject({ selection: 'timetable', slotWords: 'period', timeFencing: true });
  });
  it('verification off / tagging / face only', () => {
    expect(plan('st-rajesh', { verification: { geoMode: 'off', face: false } })!.verification).toEqual({ location: 'none', face: false, required: false });
    expect(plan('st-rajesh', { verification: { geoMode: 'tagging', face: false } })!.verification).toEqual({ location: 'background', face: false, required: true });
    expect(plan('st-rajesh', { verification: { geoMode: 'off', face: true } })!.verification).toEqual({ location: 'none', face: true, required: true });
  });
  it('blank default: roll call, no style switch; half day and leave details', () => {
    expect(plan('st-rajesh', { marking: { defaultStatus: 'blank', statusSet: ['present', 'absent', 'half_day', 'leave'], halfDayHalves: true } })).toMatchObject({ startStyle: 'roll_call', rollCallSwitch: false, statuses: ['present', 'absent', 'half_day', 'leave'], details: { half: true, leaveType: true, leaveDays: true } });
  });
  it('opens in the screen language when it is a voice language, else the default', () => {
    expect(plan('st-rajesh', {}, 'mr')!.openingLanguage).toBe('mr');
    expect(plan('st-rajesh', { voice: { enabled: true, languages: ['en'] } }, 'mr')!.openingLanguage).toBe('en');
  });
  it('slot words follow the marking frequency: once, and twice as halves or sign-in/sign-out', () => {
    expect(plan('st-rajesh', { marking: { frequency: 'once' } })!.slotWords).toBe('once');
    expect(plan('st-rajesh', { marking: { frequency: 'twice', twiceShape: 'halves' } })!.slotWords).toBe('halves');
    expect(plan('st-rajesh', { marking: { frequency: 'twice', twiceShape: 'signin_signout' } })!.slotWords).toBe('signin_signout');
  });
  it('a voice marking style overrides what the default status would pick', () => {
    expect(plan('st-rajesh', { marking: { defaultStatus: 'present' }, voice: { enabled: true, markingStyle: 'roll_call' } })!.startStyle).toBe('roll_call');
    expect(plan('st-rajesh', { marking: { defaultStatus: 'blank' }, voice: { enabled: true, markingStyle: 'exceptions' } })).toMatchObject({ startStyle: 'roll_call', rollCallSwitch: false });
    expect(plan('st-rajesh', { marking: { defaultStatus: 'absent' }, voice: { enabled: true, markingStyle: 'exceptions' } })!.startStyle).toBe('roll_call');
    expect(plan('st-rajesh', { marking: { defaultStatus: 'present' }, voice: { enabled: true, markingStyle: 'exceptions' } })!.startStyle).toBe('exceptions');
    expect(plan('st-rajesh', { marking: { defaultStatus: 'present' }, voice: { enabled: true, markingStyle: 'auto' } })!.startStyle).toBe('exceptions');
  });
  it('an absent default starts as a roll call and still offers the style switch', () => {
    expect(plan('st-rajesh', { marking: { defaultStatus: 'absent' } })).toMatchObject({ defaultStatus: 'absent', startStyle: 'roll_call', rollCallSwitch: true });
  });
  it('ojtVisible follows the configured status set', () => {
    expect(plan('st-rajesh', { marking: { statusSet: ['present', 'absent'] } })!.ojtVisible).toBe(false);
    expect(plan('st-rajesh', { marking: { statusSet: ['present', 'absent', 'ojt'] } })!.ojtVisible).toBe(true);
  });
});

function voicePlan(staffId: string, layer: ConfigLayer = {}, screen: 'en' | 'mr' = 'en') {
  const config = configWith({ ...ON, ...layer, voice: { enabled: true, ...layer.voice } });
  const user = staff(staffId);
  const access = resolveAccess(user, config, data, TODAY);
  return compileVoicePlan({ config, journey: deriveJourney(config, user, access, true), access }, screen);
}

describe('compileVoicePlan (D-139): the marking plan beside the capabilities', () => {
  it('is null only when voice is off', () => {
    const config = configWith();
    const user = staff('st-anil');
    const access = resolveAccess(user, config, data, TODAY);
    expect(compileVoicePlan({ config, journey: deriveJourney(config, user, access, true), access }, 'en')).toBeNull();
    expect(voicePlan('st-anil')).not.toBeNull();
  });
  it('an instructor: the marking plan, own attendance, instructor reports, announcements, downloads and every screen they have', () => {
    const p = voicePlan('st-rajesh')!;
    expect(p.scope).toBe('instructor');
    expect(p.marking).toEqual(plan('st-rajesh'));
    expect(p.capabilities).toEqual({
      selfAttendance: true, reports: 'instructor', reportSections: { batches: true, atRisk: true, institute: false }, staffMarking: false, staffStatuses: [],
      announcements: true, downloads: true, navTargets: ['home', 'reports', 'my_attendance', 'offline', 'announcements'],
    });
    expect(p).toMatchObject({ languages: ['en', 'mr'], openingLanguage: 'en' });
  });
  it('the principal: no marking flow, institute reports, staff marking and the institute screens', () => {
    const p = voicePlan('st-anil', {}, 'mr')!;
    expect(p.scope).toBe('institute');
    expect(p.marking).toBeNull();
    expect(p.capabilities).toEqual({
      selfAttendance: false, reports: 'institute', reportSections: { batches: true, atRisk: true, institute: true }, staffMarking: true,
      staffStatuses: ['present', 'absent'], announcements: true, downloads: true, navTargets: ['home', 'attendance', 'reports', 'staff_attendance', 'announcements'],
    });
    expect(p.openingLanguage).toBe('mr');
  });
  it('a disabled feature is absent: no capability and no screen', () => {
    const bare = voicePlan('st-rajesh', { staff: { enabled: false }, announcements: { enabled: false }, offline: { enabled: false }, reports: { pdfDownload: false } })!;
    expect(bare.capabilities).toMatchObject({ selfAttendance: false, announcements: false, downloads: false });
    expect(bare.capabilities.navTargets).toEqual(['home', 'reports']);
    const noReports = voicePlan('st-rajesh', { reports: { enabled: false }, offline: { enabled: false } })!;
    expect(noReports.capabilities).toMatchObject({ reports: null, downloads: false });
    expect(noReports.capabilities.navTargets).not.toContain('reports');
    const noStaffMarking = voicePlan('st-anil', { staff: { principalMarking: false } })!;
    expect(noStaffMarking.capabilities.staffMarking).toBe(false);
    expect(noStaffMarking.capabilities.staffStatuses).toEqual([]);
    expect(noStaffMarking.capabilities.navTargets).toContain('staff_attendance'); // the screen still shows the day
  });
  it('report capabilities follow the report sections the screen has (journey.reports.blocks)', () => {
    const blocks = (staffId: string, list: string[], pdfDownload = true) =>
      voicePlan(staffId, { reports: { blocks: list as never, pdfDownload } })!.capabilities;
    // no student_percentage: no at-risk answers
    expect(blocks('st-rajesh', ['my_attendance', 'my_batches'])).toMatchObject({ reports: 'instructor', reportSections: { batches: true, atRisk: false, institute: false }, downloads: true });
    // no batches section: no batch answers and no register download (its sheet opens from the batches section)
    expect(blocks('st-rajesh', ['my_attendance', 'student_percentage'])).toMatchObject({ reports: 'instructor', reportSections: { batches: false, atRisk: true, institute: false }, downloads: false });
    // only own attendance: nothing for the report tools to answer from
    expect(blocks('st-rajesh', ['my_attendance'])).toMatchObject({ reports: null, reportSections: { batches: false, atRisk: false, institute: false }, downloads: false });
    // the principal: trade_batch counts as the batches section; no institute_summary, no institute headline
    expect(blocks('st-anil', ['trade_batch', 'student_percentage', 'staff_summary'])).toMatchObject({ reports: 'institute', reportSections: { batches: true, atRisk: true, institute: false }, downloads: true });
    expect(blocks('st-anil', ['institute_summary', 'staff_summary'])).toMatchObject({ reports: 'institute', reportSections: { batches: false, atRisk: false, institute: true }, downloads: false });
    expect(blocks('st-anil', ['staff_summary', 'correction_log'])).toMatchObject({ reports: null, downloads: false });
    expect(blocks('st-rajesh', ['my_batches', 'student_percentage'], false).downloads).toBe(false);
  });
});

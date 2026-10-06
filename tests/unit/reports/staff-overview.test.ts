import { describe, expect, it } from 'vitest';
import type { StaffAttendanceRecord } from '@/domain/attendance';
import type { StaffMember, StaffRole } from '@/domain/entities';
import type { StatusCode } from '@/domain/status';
import { buildStaffOverview, staffStandings } from '@/services/report-staff';

const TODAY = '2026-09-25';
const person = (id: string, name: string, role: StaffRole = 'instructor'): StaffMember => ({
  id, instituteId: 'i1', trainerId: id.toUpperCase(), name, role, employmentType: 'regular', designation: role, secondaryTradeIds: [], batchIds: [], multiTradeAllowed: false,
});
const rec = (staffId: string, date: string, status: StatusCode): StaffAttendanceRecord => ({
  id: `${staffId}-${date}`, staffId, date, status, source: 'self', markedBy: staffId, deviceTimestamp: `${date}T03:30:00.000Z`, syncState: 'synced',
});

const ASHA = person('asha', 'Asha Naik');
const BHARAT = person('bharat', 'Bharat Sonawane');
const PRINCIPAL = person('anil', 'Dr. Anil Deshmukh', 'principal');
const OFFICE = person('clerk', 'Office Clerk', 'office_staff');

/** Four institute days this month (21–24 Sep) and today (25 Sep). */
const RECORDS: StaffAttendanceRecord[] = [
  rec('asha', '2026-09-21', 'present'),
  rec('asha', '2026-09-22', 'half_day'),
  rec('asha', '2026-09-23', 'absent'),
  rec('asha', '2026-09-24', 'ojt'),
  rec('asha', TODAY, 'present'),
  rec('bharat', '2026-09-21', 'present'),
  rec('bharat', '2026-09-23', 'leave'),
  rec('anil', '2026-09-21', 'present'),
  rec('anil', '2026-09-22', 'present'),
  rec('anil', '2026-09-23', 'present'),
  rec('anil', '2026-09-24', 'present'),
  rec('clerk', '2026-09-21', 'absent'),
];

const overview = (over: Partial<Parameters<typeof buildStaffOverview>[0]> = {}) =>
  buildStaffOverview({ people: [ASHA, BHARAT, PRINCIPAL, OFFICE], records: RECORDS, today: TODAY, threshold: 90, trendMonths: 3, ...over });
const standing = (o: ReturnType<typeof overview>, id: string) => o.staff.find((s) => s.member.id === id)!;

describe('staff overview (D-154): this month to date, by presence weight', () => {
  it('weights: present and OJT count 1, half day ½; % is present weight over marked days', () => {
    const asha = standing(overview(), 'asha');
    expect(asha.present).toBe(3.5);
    expect(asha.marked).toBe(5);
    expect(asha.pct).toBe(70);
    expect(asha.low).toBe(true);
  });

  it('counts come from the shared marking counts, one per status', () => {
    const asha = standing(overview(), 'asha');
    expect(asha.counts).toMatchObject({ present: 2, half_day: 1, absent: 1, ojt: 1, leave: 0, unmarked: 0 });
    const bharat = standing(overview(), 'bharat');
    expect(bharat.counts).toMatchObject({ present: 1, leave: 1, unmarked: 2, total: 4 });
  });

  it('unmarked days are institute staff-days before today with no record of theirs, never counted as absent', () => {
    const o = overview();
    expect(o.staffDays).toBe(5);
    const bharat = standing(o, 'bharat');
    expect(bharat.unmarked).toBe(2);
    expect(bharat.marked).toBe(2);
    // 1 present of 2 marked: the two unmarked days are not in the denominator.
    expect(bharat.pct).toBe(50);
  });

  it('today is reported separately: not marked today is not an unmarked day', () => {
    const o = overview();
    const principal = standing(o, 'anil');
    expect(principal.today).toBeNull();
    expect(principal.unmarked).toBe(0);
    expect(principal.pct).toBe(100);
    expect(standing(o, 'asha').today?.status).toBe('present');
    expect(o.today).toMatchObject({ total: 3, present: 1, unmarked: 2 });
  });

  it("carries the institute's staff-days present by weight (one decimal), so the screen does no arithmetic", () => {
    // Asha 3.5 (present 2 + half day ½ + OJT 1), Bharat 1, the principal 4; office staff are out.
    expect(overview().present).toBe(8.5);
  });

  it('the principal is included and office staff are excluded', () => {
    const o = overview();
    expect(o.staff.map((s) => s.member.id).sort()).toEqual(['anil', 'asha', 'bharat']);
    expect(o.month.absent).toBe(1);
  });

  it('the institute figure and the month counts are staff-days across the institute', () => {
    const o = overview();
    // Present weight 3.5 + 1 + 4 = 8.5 over 5 + 2 + 4 = 11 marked days.
    expect(o.pct).toBe(77);
    expect(o.month).toMatchObject({ present: 7, half_day: 1, ojt: 1, absent: 1, leave: 1, unmarked: 2 });
    expect(o.range).toEqual({ kind: 'month', from: '2026-09-01', to: TODAY });
  });

  it('orders lowest % first, then more unmarked days, then name; a person with no marks comes first', () => {
    const nobody = person('zed', 'Zed Unmarked');
    const o = overview({ people: [PRINCIPAL, ASHA, BHARAT, nobody] });
    expect(o.staff.map((s) => s.member.id)).toEqual(['zed', 'bharat', 'asha', 'anil']);
    expect(standing(o, 'zed')).toMatchObject({ pct: null, low: false, marked: 0, unmarked: 4 });
  });

  it('an empty month: no staff-days, no figure, everyone not marked today', () => {
    const o = overview({ records: [] });
    expect(o.staffDays).toBe(0);
    expect(o.pct).toBeNull();
    expect(o.staff.every((s) => s.pct === null && s.unmarked === 0 && !s.low)).toBe(true);
    expect(o.today.unmarked).toBe(3);
    expect(o.trend.map((m) => m.pct)).toEqual([null, null, null]);
  });

  it('threshold-safe rounding: 89.6% never shows as the 90% threshold, and is flagged', () => {
    const days = Array.from({ length: 48 }, (_, i) => `2026-0${i < 24 ? 8 : 9}-${String((i % 24) + 1).padStart(2, '0')}`);
    const records = days.map((d, i) => rec('asha', d, i < 43 ? 'present' : 'absent'));
    const o = buildStaffOverview({ people: [ASHA], records: records.filter((r) => r.date >= '2026-09-01'), today: TODAY, threshold: 90, trendMonths: 0 });
    // 24 days in September: 19 present, 5 absent = 79.2% → 79 (below 90).
    expect(standing(o, 'asha')).toMatchObject({ pct: 79, low: true });
    const wide = staffStandings({ people: [ASHA], records, from: '2026-08-01', to: TODAY, today: TODAY, threshold: 90 });
    // 43 of 48 = 89.58%: rounds to 90, shown as 89 because it is below the threshold.
    expect(wide.standings[0]).toMatchObject({ pct: 89, low: true, marked: 48 });
    expect(o.trend).toEqual([]);
  });

  it('a trend over report.trendMonths months, this month last and equal to the headline', () => {
    const o = overview({ records: [...RECORDS, rec('asha', '2026-08-10', 'present'), rec('bharat', '2026-08-10', 'absent')] });
    expect(o.trend.map((m) => m.month)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(o.trend.map((m) => m.pct)).toEqual([null, 50, o.pct]);
  });
});

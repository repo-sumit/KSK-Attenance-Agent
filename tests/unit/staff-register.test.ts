import { describe, expect, it } from 'vitest';
import type { StaffAttendanceRecord } from '@/domain/attendance';
import type { Institute, StaffMember, StaffRole } from '@/domain/entities';
import type { StatusCode } from '@/domain/status';
import { PRINT_SCRIPT, PRINT_SCRIPT_HASH } from '@/features/reports/register/registerDocument';
import { staffRegisterDocument, staffRegisterFileName } from '@/features/reports/register/staffRegisterDocument';
import { createI18n } from '@/i18n';
import { instantAt } from '@/lib/time';
import { buildStaffRegister, type StaffRegister } from '@/services/report-staff-register';

const EVIL = '<img src=x onerror=alert(1)>';
const INSTITUTE: Institute = { id: 'i1', code: '27410', name: 'Govt ITI Pune & Annexe', shortName: 'ITI', district: 'Pune', locality: 'Aundh', location: { lat: 0, lng: 0 } };
const person = (id: string, name: string, role: StaffRole = 'instructor', primaryTradeId?: string): StaffMember => ({
  id, instituteId: 'i1', trainerId: id.toUpperCase(), name, role, employmentType: 'regular', designation: role, primaryTradeId, secondaryTradeIds: [], batchIds: [], multiTradeAllowed: false,
});
const rec = (staffId: string, date: string, status: StatusCode): StaffAttendanceRecord => ({
  id: `${staffId}-${date}`, staffId, date, status, source: 'self', markedBy: staffId, deviceTimestamp: `${date}T03:30:00.000Z`, syncState: 'synced',
});
const PEOPLE = [person('asha', 'Asha Naik', 'instructor', 'copa'), person('evil', EVIL, 'instructor', 'ele'), person('anil', 'Dr. Anil Deshmukh', 'principal'), person('clerk', 'Office Clerk', 'office_staff')];
const RECORDS = [
  rec('asha', '2026-09-21', 'present'),
  rec('asha', '2026-09-22', 'half_day'),
  rec('asha', '2026-09-23', 'leave'),
  rec('evil', '2026-09-21', 'absent'),
  rec('anil', '2026-09-21', 'present'),
  rec('anil', '2026-09-22', 'present'),
  rec('anil', '2026-09-23', 'present'),
  rec('clerk', '2026-09-23', 'present'),
];
const TRADES: Record<string, string> = { copa: 'COPA', ele: 'Electrician' };

const register = (over: Partial<Parameters<typeof buildStaffRegister>[0]> = {}): StaffRegister =>
  buildStaffRegister({
    institute: INSTITUTE,
    month: '2026-09-01',
    to: '2026-09-25',
    today: '2026-09-25',
    threshold: 90,
    generatedAt: instantAt('2026-09-25', '10:15').toISOString(),
    preparedBy: { name: 'Dr. Anil Deshmukh', role: 'principal' },
    people: PEOPLE,
    records: RECORDS,
    tradeOf: (m) => (m.primaryTradeId ? TRADES[m.primaryTradeId] : null),
    ...over,
  });

const en = createI18n('en', 'en-IN');
const mr = createI18n('mr', 'mr-IN-u-nu-latn');
const doc = (r: StaffRegister, over: Partial<Parameters<typeof staffRegisterDocument>[1]> = {}) =>
  staffRegisterDocument(r, { t: en.t, format: en.format, lang: 'en', sampleData: false, ...over });
const rows = (html: string) => [...html.matchAll(/<tr class="st[^"]*" data-staff="([^"]+)">([\s\S]*?)<\/tr>/g)];
const fig = (row: string, cls: string) => row.match(new RegExp(`<td class="fig ${cls}[^"]*">([^<]*)<`))?.[1];

describe('staff register (D-154): a status letter per day, one row per person', () => {
  it('lays out every day of the month and one row per person, office staff left out, the principal in', () => {
    const r = register();
    expect(r.days).toHaveLength(30);
    expect(r.rows.map((x) => x.member.id)).toEqual(['asha', 'evil', 'anil']);
    expect(r.days.find((d) => d.date === '2026-09-21')?.kind).toBe('class');
    expect(r.days.find((d) => d.date === '2026-09-24')?.kind).toBe('none');
    expect(r.days.find((d) => d.date === '2026-09-25')?.kind).toBe('pending');
    expect(r.days.find((d) => d.date === '2026-09-26')?.kind).toBe('upcoming');
    expect(r.staffDays).toBe(3);
  });

  it('totals by the staff card\'s rules: weights, P/A/L, %, unmarked days', () => {
    const [asha, evil, anil] = register().rows;
    expect(asha).toMatchObject({ present: 1.5, absent: 0, leave: 1, marked: 3, unmarked: 0, pct: 50, low: true, trade: 'COPA' });
    expect(evil).toMatchObject({ present: 0, absent: 1, marked: 1, unmarked: 2, pct: 0 });
    expect(anil).toMatchObject({ present: 3, pct: 100, low: false, trade: null });
    expect(asha.cells[20]?.statuses).toEqual(['present']);
    expect(asha.cells[23]).toBeNull();
  });

  it('a past month runs to its end, and every working day before today counts', () => {
    const r = register({ month: '2026-08-01', to: '2026-08-31', records: [rec('asha', '2026-08-10', 'present')] });
    expect(r.days).toHaveLength(31);
    expect(r.days.some((d) => d.kind === 'pending' || d.kind === 'upcoming')).toBe(false);
    expect(r.rows.find((x) => x.member.id === 'anil')).toMatchObject({ unmarked: 1, marked: 0, pct: null });
  });
});

describe('staff register document', () => {
  const html = doc(register());

  it('is a complete document with the staff register title and the same CSP as the student register', () => {
    expect(html.startsWith('<!doctype html><html lang="en">')).toBe(true);
    expect(html).toContain('<title>Monthly Staff Attendance Register · September 2026</title>');
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
    expect(csp).toBe(`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${PRINT_SCRIPT_HASH}'`);
    expect([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1])).toEqual([PRINT_SCRIPT]);
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).toContain('@page{size:A4 landscape');
  });

  it('escapes every dynamic string', () => {
    expect(html).not.toContain(EVIL);
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('Govt ITI Pune &amp; Annexe');
  });

  it('embeds the emblem once, only when given as an inline image', () => {
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const withLogo = doc(register(), { logo });
    expect(withLogo.split(logo)).toHaveLength(2);
    expect(withLogo).toContain('<span class="emblem" aria-hidden="true"></span>');
    expect(html).not.toContain('class="emblem"');
    expect(doc(register(), { logo: 'https://evil.example/x.png' })).not.toContain('class="emblem"');
  });

  it('one row per person with a letter per day, the figures, and the header row in thead (repeated on print)', () => {
    const found = rows(html);
    expect(found.map((m) => m[1])).toEqual(['asha', 'evil', 'anil']);
    const asha = found[0][2];
    expect(asha).toContain('Instructor · COPA');
    expect(fig(asha, 'f-present')).toBe('1.5');
    expect(fig(asha, 'f-leave')).toBe('1');
    expect(fig(asha, 'f-pct')).toBe('50');
    expect(fig(found[1][2], 'f-unmarked')).toBe('2');
    expect(asha).toContain('<td class="c s-p">P</td>');
    expect(asha).toContain('<td class="c s-l">L</td>');
    expect(html).toMatch(/<thead><tr class="h1">[\s\S]*Not marked[\s\S]*<\/thead>/);
    expect(html).toContain('thead{display:table-header-group}');
  });

  it('says how it counts: unmarked days are not absences', () => {
    expect(html).toContain('Days not marked');
    expect(html).toContain('Not counted as absent');
  });

  it('renders Marathi labels with lang="mr"', () => {
    const marathi = doc(register(), { t: mr.t, format: mr.format, lang: 'mr' });
    expect(marathi).toContain('<html lang="mr">');
    expect(marathi).not.toContain('Monthly Staff Attendance Register');
  });

  it('names the file by month', () => {
    expect(staffRegisterFileName(register())).toBe('KSK-staff-register_2026-09.html');
  });
});

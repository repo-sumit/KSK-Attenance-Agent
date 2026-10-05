import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { effectiveMarks, toSessionKey, type AttendanceSubmission, type Correction } from '@/domain/attendance';
import type { Batch, Institute, Student, Trade } from '@/domain/entities';
import type { StatusCode } from '@/domain/status';
import { registerDocument, registerFileName, PRINT_SCRIPT, PRINT_SCRIPT_HASH, type RegisterDocumentOptions } from '@/features/reports/register/registerDocument';
import { escapeHtml } from '@/features/reports/register/escape';
import { REGISTER_STYLES } from '@/features/reports/register/registerStyles';
import { createI18n } from '@/i18n';
import { instantAt, type LocalDate } from '@/lib/time';
import { buildRegister, type AttendanceRegister, type BatchSource } from '@/services/report-register';

const EVIL = '<img src=x onerror=alert(1)>';
const REASON = 'Came "late" & said \'sorry\'';
const INSTITUTE: Institute = { id: 'i1', code: '27410', name: 'Govt ITI Pune & Annexe', shortName: 'ITI', district: 'Pune', locality: 'Aundh', location: { lat: 0, lng: 0 } };
const TRADE: Trade = { id: 'ele', instituteId: 'i1', name: 'Electrician', durationYears: 2 };
const B1: Batch = { id: 'ele-s1u1', tradeId: 'ele', shift: 1, unit: 1, year: 1 };
const B2: Batch = { id: 'ele-s1u2', tradeId: 'ele', shift: 1, unit: 2, year: 2 };
const st = (batchId: string, rollNo: number, name: string): Student => ({ id: `${batchId}-r${rollNo}`, batchId, rollNo, name, fatherName: `Father ${rollNo}` });
const S1 = [st('ele-s1u1', 1, 'Aarav Patil'), st('ele-s1u1', 2, EVIL), st('ele-s1u1', 3, 'Kiran Wagh')];
const S2 = [st('ele-s1u2', 1, 'Rohan Pawar'), st('ele-s1u2', 2, 'Sneha More')];

function record(batchId: string, date: LocalDate, statuses: readonly StatusCode[], students: readonly Student[]): AttendanceSubmission {
  const address = { batchId, date, slot: { kind: 'daily' as const } };
  const marks = Object.fromEntries(students.map((s, i) => [s.id, { status: statuses[i] }]));
  return { id: `r-${toSessionKey(address)}`, sessionKey: toSessionKey(address), address, marks, markedBy: 'st-rajesh', deviceTimestamp: instantAt(date, '09:30').toISOString(), syncState: 'synced' };
}

const DATES = ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24'];
const SUBS1 = DATES.map((d, i) => record('ele-s1u1', d, ['present', 'absent', i === 2 ? 'half_day' : i === 3 ? 'leave' : 'present'], S1));
const SUBS2 = DATES.map((d) => record('ele-s1u2', d, ['present', 'ojt'], S2));
const CORRECTION: Correction = {
  correctionId: 'c1', attendanceId: SUBS1[1].id, studentId: S1[0].id, oldMark: { status: 'absent' }, newMark: { status: 'present' },
  reason: REASON, actorId: 'p1', timestamp: instantAt('2026-09-22', '11:20').toISOString(),
};
const fold = (subs: readonly AttendanceSubmission[], corrections: readonly Correction[]) => subs.map((sub) => ({ sub, marks: effectiveMarks(sub, corrections) }));
const SOURCES: BatchSource[] = [
  { batch: B1, trade: TRADE, students: S1, rows: fold(SUBS1, [CORRECTION]), corrections: [CORRECTION], sessionsPerDay: 'once' },
  { batch: B2, trade: TRADE, students: S2, rows: fold(SUBS2, []), corrections: [], sessionsPerDay: 'once' },
];

const REGISTER: AttendanceRegister = buildRegister({
  institute: INSTITUTE,
  month: '2026-09-01',
  to: '2026-09-25',
  today: '2026-09-25',
  threshold: 75,
  atRiskMinDays: 3,
  generatedAt: instantAt('2026-09-25', '10:15').toISOString(),
  preparedBy: { name: 'Rajesh Patil', role: 'instructor' },
  staffNames: new Map([['st-rajesh', 'Rajesh Patil'], ['p1', 'Dr. Anil Deshmukh']]),
  sources: SOURCES,
});
const ONE: AttendanceRegister = { ...REGISTER, batches: [REGISTER.batches[0]] };

const en = createI18n('en', 'en-IN');
const mr = createI18n('mr', 'mr-IN-u-nu-latn');
const options = (over: Partial<RegisterDocumentOptions> = {}): RegisterDocumentOptions => ({ t: en.t, format: en.format, lang: 'en', scope: { kind: 'batch' }, sampleData: false, ...over });

const sections = (html: string) => html.split('<section class="sheet batch"').slice(1);
const studentRows = (section: string) => [...section.matchAll(/<tr class="st[^"]*" data-roll="(\d+)">([\s\S]*?)<\/tr>/g)];
const cell = (row: string, cls: string) => row.match(new RegExp(`<td class="fig ${cls}[^"]*">([^<]*)<`))?.[1];
const dayHeaders = (section: string) => [...(section.match(/<tr class="h1">([\s\S]*?)<\/tr>/)?.[1] ?? '').matchAll(/<th class="d([^"]*)"[^>]*>(\d+)<\/th>/g)];

describe('register document (D-137)', () => {
  const html = registerDocument(ONE, options());

  it('escapes every dynamic string: names, institute and reasons never become markup', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
    expect(html).not.toContain(EVIL);
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(html).not.toContain(REASON);
    expect(html).toContain('Came &quot;late&quot; &amp; said &#39;sorry&#39;');
    expect(html).toContain('Govt ITI Pune &amp; Annexe');
  });

  it('is a complete English document with the register title', () => {
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toMatch(/<title>Monthly Attendance Register · Electrician · Shift 1 · Unit 1 · September 2026<\/title>/);
    expect(html).toContain('Government of Maharashtra');
    expect(html).toContain('Institute code 27410 · Pune');
    expect(html).toContain('1–25 Sep (to date)');
  });

  it('one row per student and one day column per day of the month; Sundays carry the Sunday class', () => {
    const [section] = sections(html);
    expect(studentRows(section).map((m) => m[1])).toEqual(['1', '2', '3']);
    const days = dayHeaders(section);
    expect(days.map((d) => d[2])).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
    expect(days.filter((d) => d[1].split(' ').includes('sun')).map((d) => d[2])).toEqual(['6', '13', '20', '27']);
    // Each student row has a cell per day.
    for (const [, , row] of studentRows(section)) expect(row.match(/<td class="c[ "]/g)).toHaveLength(30);
  });

  it('totals and percentages match the register data', () => {
    const [section] = sections(html);
    const batch = ONE.batches[0];
    for (const [, roll, row] of studentRows(section)) {
      const r = batch.rows.find((x) => x.student.rollNo === Number(roll))!;
      expect([cell(row, 'f-present'), cell(row, 'f-absent'), cell(row, 'f-leave'), cell(row, 'f-pct')]).toEqual([
        en.format.number(r.present),
        en.format.number(r.absent),
        en.format.number(r.leave),
        r.pct === null ? '—' : en.format.number(r.pct),
      ]);
    }
    const evil = batch.rows.find((x) => x.student.rollNo === 2)!;
    expect(evil.atRisk).toBe(true);
    expect(studentRows(section).find((m) => m[1] === '2')![0]).toContain('class="st risk"');
    expect(section).toContain('⚠ At risk');
    expect(section).toContain('Meets 75%');
    // The corrected day carries a superscript star.
    expect(section).toMatch(/<sup class="star">\*<\/sup>/);
    // Present (by day) footer and the half day.
    expect(section).toContain('Present (by day)');
    expect(section).toContain('>½<');
  });

  it('lists corrections with the reason and the actor, and the signature blocks', () => {
    const [section] = sections(html);
    expect(section).toContain('Dr. Anil Deshmukh');
    expect(section).toContain('Craft Instructor');
    expect(section).toContain('Group Instructor');
    expect(section).toContain('Principal');
    expect(section).toContain('Computer-generated from KSK Attendance on 25 Sep 2026');
    expect(section).toContain('by Rajesh Patil (Instructor).');
  });

  it('Task 17: a quick reason is written in the document\'s language from its code; free text stays as typed', () => {
    const quick: Correction = { ...CORRECTION, correctionId: 'c2', reason: 'Student arrived late', reasonCode: 'late' };
    const reg = buildRegister({ ...REGISTER, staffNames: new Map([['p1', 'Dr. Anil Deshmukh']]), sources: [{ ...SOURCES[0], corrections: [CORRECTION, quick] }] });
    const one = { ...reg, batches: [reg.batches[0]] };
    const marathi = registerDocument(one, options({ t: mr.t, format: mr.format, lang: 'mr' }));
    expect(marathi).toContain(`<td>${mr.t('correction.reasonLate')}</td>`);
    expect(marathi).not.toContain('Student arrived late');
    expect(marathi).toContain('Came &quot;late&quot; &amp; said &#39;sorry&#39;');
    expect(registerDocument(one, options())).toContain('<td>Student arrived late</td>');
  });

  it('Task 17: names the month with the app\'s own month formatter', () => {
    const doc = registerDocument(ONE, options({ format: { ...en.format, monthYear: (date: LocalDate) => `Month of ${date}` } }));
    expect(doc).toMatch(/<title>Monthly Attendance Register · Electrician · Shift 1 · Unit 1 · Month of 2026-09-01<\/title>/);
  });

  it('a trade scope renders the summary table and one section per batch', () => {
    const doc = registerDocument(REGISTER, options({ scope: { kind: 'trade', tradeName: 'Electrician' } }));
    expect(doc).toContain('Trade summary — Electrician');
    const summary = doc.match(/<table class="plain summary-table">([\s\S]*?)<\/table>/)?.[1] ?? '';
    expect(summary.match(/<tr class="sum-row">/g)).toHaveLength(2);
    expect(sections(doc)).toHaveLength(2);
    expect(doc).toMatch(/<title>Monthly Attendance Register · Electrician · September 2026<\/title>/);
    expect(html).not.toContain('Trade summary');
  });

  it('renders Marathi labels with lang="mr"', () => {
    const doc = registerDocument(ONE, options({ t: mr.t, format: mr.format, lang: 'mr' }));
    expect(doc).toContain('<html lang="mr">');
    expect(doc).toContain('महाराष्ट्र शासन');
    expect(doc).toContain('मासिक हजेरी नोंदवही');
    expect(doc).toContain('सप्टेंबर 2026');
    expect(doc).not.toContain('Monthly Attendance Register');
  });

  it('has a CSP whose script hash matches the only script', () => {
    const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/)?.[1];
    expect(csp).toBe(`default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${PRINT_SCRIPT_HASH}'`);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toEqual([PRINT_SCRIPT]);
    expect(createHash('sha256').update(scripts[0], 'utf8').digest('base64')).toBe(PRINT_SCRIPT_HASH);
    expect(html).toContain('id="print"');
  });

  it('loads nothing from the network; the logo is embedded only when given', () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
    expect(html).not.toContain('<img');
    const logo = 'data:image/png;base64,iVBORw0KGgo=';
    const withLogo = registerDocument(ONE, options({ logo }));
    expect(withLogo.split(logo)).toHaveLength(2); // embedded once, in the stylesheet
    expect(withLogo).toContain(`.emblem{background:url("${logo}")`);
    expect(withLogo).toContain('<span class="emblem" aria-hidden="true"></span>');
    expect(html).not.toContain('class="emblem"');
    for (const bad of ['https://evil.example/x.png', 'data:image/png;base64,AAA")}body{color:red', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      const doc = registerDocument(ONE, options({ logo: bad }));
      expect(doc).not.toContain('class="emblem"');
      expect(doc).not.toContain(bad);
    }
  });

  it('sampleData toggles the sample line', () => {
    expect(html).not.toContain('Sample data for demonstration');
    expect(registerDocument(ONE, options({ sampleData: true }))).toContain('Sample data for demonstration — not an official record.');
  });

  it('a day of several sessions shows one letter when they agree, else "present sessions/sessions"', () => {
    const half = (part: 1 | 2, statuses: readonly StatusCode[]): AttendanceSubmission => {
      const address = { batchId: 'ele-s1u1', date: '2026-09-21', slot: { kind: 'half' as const, part } };
      const marks = Object.fromEntries(S1.map((s, i) => [s.id, { status: statuses[i] }]));
      return { id: `r-${toSessionKey(address)}`, sessionKey: toSessionKey(address), address, marks, markedBy: 'st-rajesh', deviceTimestamp: instantAt('2026-09-21', '09:30').toISOString(), syncState: 'synced' };
    };
    const subs = [half(1, ['present', 'present', 'half_day']), half(2, ['present', 'absent', 'absent'])];
    const reg = buildRegister({ ...REGISTER, staffNames: new Map(), sources: [{ ...SOURCES[0], rows: fold(subs, []), corrections: [], sessionsPerDay: 'twice' }] });
    const [section] = sections(registerDocument(reg, options()));
    const day21 = (roll: string) => studentRows(section).find((m) => m[1] === roll)![2].match(/<td class="c[^"]*">[^<]*<\/td>/g)![20];
    expect(day21('1')).toBe('<td class="c s-p">P</td>');
    expect(day21('2')).toBe('<td class="c s-m">1/2</td>');
    expect(day21('3')).toBe('<td class="c s-m">½/2</td>');
    expect(section).toContain('Present in 1 of 2 sessions');
  });

  it('names the file with an ASCII slug', () => {
    expect(registerFileName(ONE, { kind: 'batch' })).toBe('KSK-register_electrician_S1-U1_2026-09.html');
    expect(registerFileName(REGISTER, { kind: 'trade', tradeName: 'Electrician' })).toBe('KSK-register_electrician_2026-09.html');
    expect(registerFileName(REGISTER, { kind: 'trade', tradeName: 'Mechanic (Motor Vehicle)' })).toBe('KSK-register_mechanic-motor-vehicle_2026-09.html');
    expect(registerFileName(REGISTER, { kind: 'trade', tradeName: 'वीजतंत्री' })).toBe('KSK-register_trade_2026-09.html');
  });
  it('Task 15: the footer row totals each class day and every figure column', () => {
    const [section] = sections(html);
    const batch = ONE.batches[0];
    const foot = section.match(/<tr class="tot">([\s\S]*?)<\/tr>/)?.[1] ?? '';
    expect(foot).toContain('<th class="sticky k1" colspan="3" scope="row">Present (by day)</th>');
    const days = [...foot.matchAll(/<td class="c[^"]*">([^<]*)<\/td>/g)].map((m) => m[1]);
    expect(days).toEqual(batch.days.map((d) => (d.kind === 'class' ? en.format.number(d.present) : '')));
    expect(days.filter(Boolean)).toEqual(['2', '2', '1.5', '1']);
    const figs = [...foot.matchAll(/<td class="fig">([^<]*)<\/td>/g)].map((m) => m[1]);
    const sum = (pick: (r: (typeof batch.rows)[number]) => number) => batch.rows.reduce((a, r) => a + pick(r), 0);
    expect(figs).toEqual([en.format.number(sum((r) => r.present)), en.format.number(sum((r) => r.absent)), en.format.number(sum((r) => r.leave)), en.format.number(batch.pct!)]);
  });

  it('Task 15: today without a record is the pending day and later days are upcoming, in the header and in every row', () => {
    const [section] = sections(html);
    const classesOf = (day: number) => dayHeaders(section).find((d) => d[2] === String(day))![1].trim().split(' ').filter(Boolean);
    expect(classesOf(25)).toEqual(['pend']);
    for (const day of [26, 28, 29, 30]) expect(classesOf(day)).toEqual(['up']);
    expect(classesOf(27)).toEqual(['sun', 'up']);
    expect(classesOf(24)).toEqual([]);
    const [, , row] = studentRows(section)[0];
    const cells = row.match(/<td class="c[^"]*">/g)!;
    expect(cells[24]).toBe('<td class="c pend">');
    expect(cells[25]).toBe('<td class="c up">');
    expect(section).toContain('<span class="chip pend"></span>');
    expect(section).toContain('<span class="chip up"></span>');
  });

  it('Task 15: a low batch average warns in the KPI strip; a student below the threshold with too few days gets "—"', () => {
    // Two days only: Kiran is absent both days (0%) but 2 days are fewer than atRiskMinDays (3).
    const two = buildRegister({ ...REGISTER, staffNames: new Map(), sources: [{ ...SOURCES[0], rows: fold(SUBS1.slice(0, 2), [CORRECTION]) }] });
    const [section] = sections(registerDocument(two, options()));
    const b = two.batches[0];
    expect(b.low).toBe(true);
    expect(b.atRisk).toBe(0);
    const warned = [...section.matchAll(/<div class="kpi warn"><div class="kpi-label">([^<]*)<\/div><div class="kpi-value">([^<]*)<\/div><div class="kpi-sub">([^<]*)<\/div>/g)];
    expect(warned.map((m) => [m[1], m[3]])).toEqual([['Average attendance', 'Below 75%']]);
    expect(section).not.toContain('Threshold 75%');
    const evil = studentRows(section).find((m) => m[1] === '2')![2];
    expect(evil).toContain('<td class="rmk">—</td>');
    expect(evil).not.toContain('risk');
  });

  it('Task 15: a mixed day fits its 22px column (smaller text, like OJT), and the footer label keeps the grey row background', () => {
    const rule = (selector: string) => REGISTER_STYLES.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`))?.[1] ?? '';
    expect(REGISTER_STYLES).toContain('--day:22px');
    expect(rule('.reg tr>td.s-o,.reg tr>td.s-m')).toMatch(/font-size:8\.5px/);
    expect(rule('.reg tfoot .sticky')).toContain('background:#f4f6fa');
    // Print keeps both small.
    expect(REGISTER_STYLES).toMatch(/\.reg tr>td\.s-o,\.reg tr>td\.s-m\{font-size:7px\}/);
  });

  it('Task 15: the file-name slug spells its combining-mark range as escapes', () => {
    const source = readFileSync(path.resolve(__dirname, '../../src/features/reports/register/registerDocument.ts'), 'utf8');
    expect(source).not.toMatch(/[\u0300-\u036f]/);
    expect(source).toContain('\\u0300-\\u036f');
    expect(registerFileName(REGISTER, { kind: 'trade', tradeName: 'Électricien Café' })).toBe('KSK-register_electricien-cafe_2026-09.html');
  });

  it('Task 15: Marathi "of 1 student" is singular', () => {
    expect(mr.t('register.kpi.ofStudents', { count: 1 })).toBe('1 विद्यार्थ्यापैकी');
    expect(mr.t('register.kpi.ofStudents', { count: 3 })).toBe('3 विद्यार्थ्यांपैकी');
  });
});

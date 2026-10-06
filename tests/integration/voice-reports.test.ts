import { describe, expect, it } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { compileVoicePlan } from '@/domain/voice/plan';
import { rankStandings } from '@/services/reports';
import { ActionBus, type UiEvent } from '@/services/voice/action-bus';
import { createExecutor } from '@/services/voice/executor';
import { buildTools } from '@/services/voice/tools';
import { setup, signIn } from '../helpers/app';

/** Reports and insights by voice (D-140): read-only figures the app works out, and the screen that shows them. */
async function voiceFor(trainerId: string, layer: ConfigLayer = {}) {
  const env = setup({ voice: { enabled: true }, ...layer });
  const ctx = await signIn(env.app, trainerId);
  const plan = compileVoicePlan(ctx, 'en')!;
  const bus = new ActionBus();
  const events: UiEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { services } = env.app;
  const ex = createExecutor({
    ctx, plan, bus,
    attendance: services.attendance, verification: services.verification, drafts: services.drafts,
    announcements: services.announcements, staffAttendance: services.staffAttendance, reports: services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => 0, turnSeq: () => 0, spokeAtTurn: () => 0, generation: () => 1, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  const shown = () => events.filter((e) => e.type !== 'navigate');
  const nav = () => events.filter((e) => e.type === 'navigate').map((e) => (e as Extract<UiEvent, { type: 'navigate' }>).href);
  return { env, ctx, plan, ex, call, events, shown, nav, reports: services.reports };
}

/** A batch's month figure as the downloaded register prints it. */
async function monthPct(s: Awaited<ReturnType<typeof voiceFor>>, batchId: string, month: string) {
  const register = await s.reports.register(s.ctx, { batchIds: [batchId], month });
  return register!.batches[0].pct;
}

const SHOW = 'Then ask whether to show it on the screen; on yes, call show_report.';

describe('report tools exist only with their capability (D-081)', () => {
  it('an instructor with reports and downloads has every report tool; the principal too', async () => {
    const sunita = await voiceFor('TR-10518');
    const names = buildTools(sunita.plan).map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register']));
    const principal = await voiceFor('PR-2741');
    expect(buildTools(principal.plan).map((t) => t.name)).toEqual(expect.arrayContaining(['get_reports_overview', 'get_batch_report', 'get_at_risk', 'download_register']));
  });

  it('reports off: no report tool answers; downloads off: no download_register', async () => {
    const off = await voiceFor('TR-10518', { reports: { enabled: false } });
    for (const name of ['get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'show_report', 'download_register']) {
      expect(await off.call(name, { batch: 'shift 1 unit 2' })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    }
    const noPdf = await voiceFor('TR-10518', { reports: { pdfDownload: false } });
    expect(await noPdf.call('download_register', { target: 'shift 1 unit 2', month: 'THIS_MONTH' })).toMatchObject({ error: 'UNKNOWN_TOOL' });
    expect(await noPdf.call('get_at_risk')).toMatchObject({ ok: true });
  });
});

describe('report tools follow the report sections the screen has', () => {
  it('no at-risk section: no get_at_risk; no batches section: no batch report and no register download', async () => {
    const noRisk = await voiceFor('TR-10518', { reports: { blocks: ['my_attendance', 'my_batches'] } });
    expect(await noRisk.call('get_at_risk')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(await noRisk.call('get_batch_report', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: true });
    const riskOnly = await voiceFor('TR-10518', { reports: { blocks: ['my_attendance', 'student_percentage'] } });
    expect(await riskOnly.call('get_batch_report', { batch: 'shift 1 unit 2' })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(await riskOnly.call('download_register', { target: 'shift 1 unit 2' })).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    expect(await riskOnly.call('get_at_risk')).toMatchObject({ ok: true });
  });

  it('a student report without the batches section shows the at-risk list, never a batch row the screen does not have', async () => {
    const s = await voiceFor('TR-10518', { reports: { blocks: ['my_attendance', 'student_percentage'] } });
    expect(await s.call('get_student_report', { student: '5', batch: 'shift 2 unit 2' })).toMatchObject({ ok: true });
    await s.call('show_report');
    await s.call('get_at_risk', { batch: 'shift 1 unit 2' });
    await s.call('show_report');
    expect(s.nav()).toEqual(['/reports', '/reports']);
    expect(s.shown().some((e) => e.type === 'show_batch_report'), 'no batch row: the screen has no batches section').toBe(false);
    expect(s.shown().at(-1)).toMatchObject({ type: 'show_at_risk' });
  });

  it('the principal without the institute summary hears no institute headline', async () => {
    const s = await voiceFor('PR-2741', { reports: { blocks: ['trade_batch', 'student_percentage', 'staff_summary'] } });
    const r = await s.call('get_reports_overview');
    expect(r.ok).toBe(true);
    expect(r.institute).toBeUndefined();
    expect(r.instruction).not.toMatch(/^The institute/);
  });
});

describe('get_reports_overview says only what the Reports screen shows (Task 19)', () => {
  it('no at-risk section: no at-risk total in the result or the instruction', async () => {
    const s = await voiceFor('TR-10518', { reports: { blocks: ['my_attendance', 'my_batches'] } });
    const r = await s.call('get_reports_overview');
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('at_risk_total');
    expect(r.instruction).not.toMatch(/at risk/); // neither the total nor a batch's count (fix round 1)
    expect((r.batches as Record<string, unknown>[]).every((b) => !('at_risk' in b))).toBe(true);
    expect(r.instruction).toMatch(/^The trainer's 2 batches over the last 30 days: Shift 1, Unit 2, Electrician 87% \(\d+ students\); /);
  });

  it('no batches section (the institute summary only): no batches and no lowest or highest batch', async () => {
    const s = await voiceFor('PR-2741', { reports: { blocks: ['institute_summary', 'staff_summary'] } });
    const r = await s.call('get_reports_overview');
    expect(r.ok).toBe(true);
    expect(r).not.toHaveProperty('batches');
    expect(r).not.toHaveProperty('at_risk_total');
    expect(r.institute).toMatchObject({ students: 417, batches: 17 });
    expect(r.instruction).toMatch(/^The institute over the last 30 days: \d+% average, 417 students in 17 batches/);
    expect(r.instruction).not.toMatch(/Lowest batch|highest|at risk/);
  });
});

describe('get_reports_overview', () => {
  it('the instructor: each batch with its average, students, at-risk count and this month against last month', async () => {
    const s = await voiceFor('TR-10518');
    const overview = await s.reports.batchOverview(s.ctx);
    const r = await s.call('get_reports_overview');
    expect(r.ok).toBe(true);
    const batches = r.batches as { id: string; label: string; students: number; avg_pct: number; at_risk: number; this_month_pct: number; last_month_pct: number }[];
    expect(batches.map((b) => b.id)).toEqual(overview.batches.map((b) => b.batch.id));
    for (const [i, b] of overview.batches.entries()) {
      expect(batches[i]).toMatchObject({ students: b.students, avg_pct: b.pct, at_risk: b.atRisk });
      expect(batches[i].this_month_pct).toBe(await monthPct(s, b.batch.id, '2026-09-01'));
      expect(batches[i].last_month_pct).toBe(await monthPct(s, b.batch.id, '2026-08-01'));
    }
    expect(batches[0].label).toBe('Shift 1, Unit 2, Electrician');
    expect(r).toMatchObject({ window_days: 30, threshold: 75, at_risk_total: 10 });
    expect(r.instruction).toMatch(/^The trainer's 2 batches over the last 30 days: Shift 1, Unit 2, Electrician 87% \(31 students, 5 at risk\); Shift 2, Unit 2, Electrician 87% \(27 students, 5 at risk\)\. In all: this month \d+%, last month \d+% \((up|down) \d+ points?|the same\); 10 students at risk \(below 75%\)\. /);
    expect(r.instruction).toMatch(new RegExp(`${SHOW.replace(/[.;]/g, '\\$&')}$`));
    expect(s.events).toEqual([]); // answering opens nothing
  });

  it('the principal also hears the institute summary and this month\'s staff attendance, as the Staff attendance section shows it (D-156)', async () => {
    const s = await voiceFor('PR-2741');
    const [summary, staff] = await Promise.all([s.reports.instituteSummary(s.ctx), s.reports.staffOverview(s.ctx)]);
    const r = await s.call('get_reports_overview');
    expect(r.institute).toEqual({ avg_pct: summary.pct, students: 417, batches: 17, staff_pct: staff!.pct, staff_range: 'this_month' });
    expect((r.batches as unknown[]).length).toBe(17);
    expect(r.instruction).toMatch(new RegExp(`^The institute over the last 30 days: ${summary.pct}% average, 417 students in 17 batches; staff attendance this month ${staff!.pct}%\\. Lowest batch: .+ \\d+%; highest: .+ \\d+%\\. This month \\d+%, last month \\d+%`));
  });
});

describe('get_batch_report', () => {
  it('average, the lowest five and highest three with % and days, at-risk students, the trend', async () => {
    const s = await voiceFor('TR-10518');
    const standings = (await s.reports.batchStudents(s.ctx, 'ele-s1u2'))!;
    const low = rankStandings(standings, 'low_first').filter((x) => x.standing.pct !== null).slice(0, 5).map((x) => x.standing);
    const high = rankStandings(standings, 'high_first').slice(0, 3).map((x) => x.standing);
    const r = await s.call('get_batch_report', { batch: 'shift 1 unit 2' });
    expect(r).toMatchObject({ ok: true, batch: { id: 'ele-s1u2', label: 'Shift 1, Unit 2, Electrician' }, students: 31, avg_pct: 87, at_risk_count: 5 });
    expect(r.lowest).toEqual(low.map((x) => ({ name: x.student.name, roll: x.student.rollNo, pct: x.pct, days_present: x.daysPresent, days_marked: x.daysMarked })));
    expect(r.highest).toEqual(high.map((x) => ({ name: x.student.name, roll: x.student.rollNo, pct: x.pct, days_present: x.daysPresent, days_marked: x.daysMarked })));
    expect((r.lowest as { name: string }[])[0]).toMatchObject({ name: 'Aniket Bhosale', pct: 46, days_present: 12, days_marked: 26 });
    expect((r.at_risk as { name: string }[]).map((x) => x.name)).toEqual(['Aniket Bhosale', 'Tushar Yadav', 'Siddharth Waghmare', 'Amit Kumar', 'Vaishnavi Pingale']);
    expect(r).toMatchObject({ this_month_pct: await monthPct(s, 'ele-s1u2', '2026-09-01'), last_month_pct: await monthPct(s, 'ele-s1u2', '2026-08-01') });
    expect(r.instruction).toContain('Report of Shift 1, Unit 2, Electrician over the last 30 days: average 87% (31 students); this month ');
    expect(r.instruction).toContain(' Lowest: Aniket Bhosale 46% (12 of 26 days), Tushar Yadav 50% (13 of 26 days), ');
    expect(r.instruction).toContain(' 5 students at risk (below 75%): Aniket Bhosale, Tushar Yadav, Siddharth Waghmare, Amit Kumar, Vaishnavi Pingale.');
    expect(r.instruction.endsWith(SHOW)).toBe(true);
    expect(s.events).toEqual([]);
  });

  it('ambiguous words ask which batch; another trade or an unknown batch is not in the reports', async () => {
    const p = await voiceFor('PR-2741');
    const amb = await p.call('get_batch_report', { batch: 'shift 1 unit 2' });
    expect(amb).toMatchObject({ ok: false, error: 'AMBIGUOUS' });
    expect((amb.candidates as { label: string }[]).map((c) => c.label)).toEqual(['Shift 1, Unit 2, Electrician', 'Shift 1, Unit 2, Fitter']);
    expect(amb.instruction).toBe('"shift 1 unit 2" matches several batches: Shift 1, Unit 2, Electrician; Shift 1, Unit 2, Fitter. Ask which one.');
    expect(await p.call('get_batch_report', { batch: 'Electrician Shift 1 Unit 2' })).toMatchObject({ ok: true, batch: { id: 'ele-s1u2' } });

    const s = await voiceFor('TR-10518');
    const none = await s.call('get_batch_report', { batch: 'Fitter shift 1 unit 1' });
    expect(none).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(none.instruction).toBe('No batch "Fitter shift 1 unit 1" in the trainer\'s reports. Their batches: Shift 1, Unit 2, Electrician; Shift 2, Unit 2, Electrician. Ask which one.');
    expect(await s.call('get_batch_report', { batch: '' })).toMatchObject({ ok: false, error: 'AMBIGUOUS' });
  });

  it('one batch in the reports: no words needed', async () => {
    const vikas = await voiceFor('TR-10377'); // Vikas Shinde: Electrician Shift 1 Unit 2 only
    expect(await vikas.call('get_batch_report', { batch: '' })).toMatchObject({ ok: true, batch: { id: 'ele-s1u2' } });
  });
});

describe('get_student_report', () => {
  it('%, days present of marked, at risk, and the last five absences from this and last month\'s register', async () => {
    const s = await voiceFor('TR-10518');
    const r = await s.call('get_student_report', { student: 'Aniket Bhosale' });
    expect(r).toMatchObject({ ok: true, student: { name: 'Aniket Bhosale', batch: 'Shift 1, Unit 2, Electrician' }, pct: 46, days_present: 12, days_marked: 26, at_risk: true });
    // the register's own cells: days whose sessions were all absent, newest first
    const absentDays: string[] = [];
    for (const month of ['2026-09-01', '2026-08-01']) {
      const reg = (await s.reports.register(s.ctx, { batchIds: ['ele-s1u2'], month }))!.batches[0];
      const row = reg.rows.find((x) => x.student.name === 'Aniket Bhosale')!;
      reg.days.forEach((d, i) => {
        const cell = row.cells[i];
        if (cell && cell.statuses.length && cell.statuses.every((st) => st === 'absent')) absentDays.push(d.date);
      });
    }
    const expected = absentDays.sort().reverse().slice(0, 5);
    expect(expected).toHaveLength(5);
    expect(r.last_absences).toEqual(expected);
    expect(r.instruction).toMatch(/^Aniket Bhosale \(roll \d+, Shift 1, Unit 2, Electrician\) over the last 30 days: 46% \(12 of 26 days present\), at risk \(below 75%\)\. Last absences: \w+, \d+ \w+; /);
    expect(r.instruction.endsWith(SHOW)).toBe(true);
  });

  it('a roll number repeats across batches: ask which batch; with the batch it is found', async () => {
    const s = await voiceFor('TR-10518');
    const amb = await s.call('get_student_report', { student: 'roll 5' });
    expect(amb).toMatchObject({ ok: false, error: 'AMBIGUOUS' });
    expect(amb.instruction).toMatch(/^"roll 5" matches several students: .+ \(roll 5, Shift 1, Unit 2, Electrician\); .+ \(roll 5, Shift 2, Unit 2, Electrician\)\. Ask which one \(by batch or father's name\)\.$/);
    const found = await s.call('get_student_report', { student: '5', batch: 'shift 2 unit 2' });
    expect(found).toMatchObject({ ok: true, student: { roll: 5, batch: 'Shift 2, Unit 2, Electrician' } });
    expect(await s.call('get_student_report', { student: 'Zzyzx Qwerty' })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
  });
});

describe('get_at_risk', () => {
  it('every batch: the total and the lowest first; one batch: only its students', async () => {
    const s = await voiceFor('TR-10518');
    const r = await s.call('get_at_risk');
    expect(r).toMatchObject({ ok: true, threshold: 75, window_days: 30, total: 10, batches_with_risk: 2, batches_checked: 2 });
    const names = (r.students as { name: string; pct: number }[]).map((x) => `${x.name} ${x.pct}`);
    expect(names.slice(0, 3)).toEqual(['Aniket Bhosale 46', 'Tushar Yadav 50', 'Mahesh Vaidya 52']);
    expect(r.instruction).toMatch(/^10 students at risk \(below 75% over the last 30 days\) in 2 batches; lowest first: Aniket Bhosale 46% \(Shift 1, Unit 2, Electrician\), Tushar Yadav 50% \(Shift 1, Unit 2, Electrician\), Mahesh Vaidya 52% \(Shift 2, Unit 2, Electrician\), .+ and 5 more\. /);
    const one = await s.call('get_at_risk', { batch: 'shift 2 unit 2' });
    expect(one).toMatchObject({ ok: true, total: 5, batches_checked: 1 });
    expect((one.students as { name: string }[])[0].name).toBe('Mahesh Vaidya');
  });

  it('nobody at risk is said in one line, with nothing to show', async () => {
    const s = await voiceFor('TR-10518', { reports: { eligibilityThresholdPct: 10 } });
    const r = await s.call('get_at_risk');
    expect(r).toMatchObject({ ok: true, total: 0, students: [] });
    expect(r.instruction).toBe('No student is below 10% over the last 30 days. Say so in one short line.');
  });
});

describe('show_report: the screen follows the last answer (typed bus events)', () => {
  it('a batch report: Reports opens, then the batch row', async () => {
    const s = await voiceFor('TR-10518');
    await s.call('get_batch_report', { batch: 'shift 1 unit 2' });
    const r = await s.call('show_report');
    expect(r).toMatchObject({ ok: true });
    expect(r.instruction).toBe('The report is on the screen. Say so in a few words.');
    expect(s.nav()).toEqual(['/reports']);
    expect(s.shown()).toMatchObject([{ type: 'show_batch_report', batchId: 'ele-s1u2' }]);
  });

  it('a student report shows their batch; at risk in every batch shows the at-risk list; the overview shows Reports', async () => {
    const s = await voiceFor('TR-10518');
    await s.call('get_student_report', { student: '5', batch: 'shift 2 unit 2' });
    await s.call('show_report');
    await s.call('get_at_risk');
    await s.call('show_report');
    await s.call('get_at_risk', { batch: 'shift 1 unit 2' });
    await s.call('show_report');
    await s.call('get_reports_overview');
    await s.call('show_report');
    expect(s.nav()).toEqual(['/reports', '/reports', '/reports', '/reports']);
    expect(s.shown()).toMatchObject([
      { type: 'show_batch_report', batchId: 'ele-s2u2' },
      { type: 'show_at_risk' },
      { type: 'show_batch_report', batchId: 'ele-s1u2' },
    ]);
  });

  it('a failed lookup forgets nothing; nothing asked yet: Reports opens', async () => {
    const s = await voiceFor('TR-10518');
    expect(await s.call('show_report')).toMatchObject({ ok: true, instruction: 'The Reports screen is open. Say so in a few words.' });
    await s.call('get_batch_report', { batch: 'shift 2 unit 2' });
    await s.call('get_batch_report', { batch: 'Fitter shift 1 unit 1' });
    await s.call('show_report');
    expect(s.shown()).toMatchObject([{ type: 'show_batch_report', batchId: 'ele-s2u2' }]);
  });

  it('the principal (overview executor) shows reports the same way', async () => {
    const p = await voiceFor('PR-2741');
    await p.call('get_batch_report', { batch: 'Electrician Shift 1 Unit 2' });
    await p.call('show_report');
    expect(p.nav()).toEqual(['/reports']);
    expect(p.shown()).toMatchObject([{ type: 'show_batch_report', batchId: 'ele-s1u2' }]);
  });
});

describe('download_register: the sheet opens with the target and month; the trainer taps Download', () => {
  it('a batch, last month', async () => {
    const s = await voiceFor('TR-10518');
    const r = await s.call('download_register', { target: 'shift 1 unit 2', month: 'LAST_MONTH' });
    expect(r).toMatchObject({ ok: true, target: 'Shift 1, Unit 2, Electrician', scope: 'batch', month: 'August 2026' });
    expect(r.instruction).toBe('The register of Shift 1, Unit 2, Electrician for August 2026 is open on the screen. Tell the trainer to tap Download to save it, in one short line.');
    expect(s.nav()).toEqual(['/reports']);
    expect(s.shown()).toMatchObject([{ type: 'open_register', batchIds: ['ele-s1u2'], tradeId: null, month: '2026-08-01' }]);
  });

  it('a trade: every batch of it in the reports; this month by default', async () => {
    const s = await voiceFor('TR-10518');
    const r = await s.call('download_register', { target: 'Electrician' });
    expect(r).toMatchObject({ ok: true, target: 'Electrician', scope: 'trade', month: 'September 2026 (so far)' });
    expect(r.instruction).toBe('The register of the whole Electrician trade for September 2026 (so far) is open on the screen. Tell the trainer to tap Download to save it, in one short line.');
    expect(s.shown()).toMatchObject([{ type: 'open_register', batchIds: ['ele-s1u2', 'ele-s2u2'], tradeId: 'ele', month: '2026-09-01' }]);
  });

  it('a batch the words do not settle is asked, and nothing opens', async () => {
    const p = await voiceFor('PR-2741');
    expect(await p.call('download_register', { target: 'shift 1 unit 2', month: 'THIS_MONTH' })).toMatchObject({ ok: false, error: 'AMBIGUOUS' });
    expect(await p.call('download_register', { target: 'Plumber', month: 'THIS_MONTH' })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(await p.call('download_register', { target: 'Fitter', month: 'NEXT_YEAR' })).toMatchObject({ ok: false, error: 'INVALID' });
    expect(p.events).toEqual([]);
  });
});

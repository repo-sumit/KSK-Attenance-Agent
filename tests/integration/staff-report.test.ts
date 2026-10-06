import { describe, expect, it } from 'vitest';
import { setup, signIn, TODAY } from '../helpers/app';

const NOT_MARKED_TODAY = ['st-anil', 'st-asha', 'st-pradeep', 'st-rajesh', 'st-sanjay'];

describe('staff attendance report card (D-154)', () => {
  it('the principal: 18 Pune staff this month, 5 not marked today, a figure and a trend', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const overview = await env.app.services.reports.staffOverview(ctx);
    if (!overview) throw new Error('overview');
    expect(overview.range).toEqual({ kind: 'month', from: '2026-09-01', to: TODAY });
    expect(overview.threshold).toBe(90);
    expect(overview.staff).toHaveLength(18);
    expect(overview.staff.some((s) => s.member.role === 'principal')).toBe(true);
    expect(overview.today.unmarked).toBe(5);
    expect(overview.staff.filter((s) => s.today === null).map((s) => s.member.id).sort()).toEqual(NOT_MARKED_TODAY);
    expect(overview.pct).not.toBeNull();
    expect(overview.staffDays).toBeGreaterThan(15);
    expect(overview.trend.map((m) => m.month)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(overview.trend.at(-1)?.pct).toBe(overview.pct);
    // Lowest first.
    const pcts = overview.staff.map((s) => s.pct ?? -1);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });

  it('follows reports.staffThresholdPct', async () => {
    const env = setup({ reports: { staffThresholdPct: 100 } });
    const ctx = await signIn(env.app, 'PR-2741');
    const overview = await env.app.services.reports.staffOverview(ctx);
    expect(overview?.threshold).toBe(100);
    expect(overview?.staff.filter((s) => s.low).length).toBeGreaterThan(0);
    expect(overview?.staff.every((s) => s.low === (s.pct !== null && s.pct < 100))).toBe(true);
  });

  it('is null for an instructor, and without the staff block (the guard is the service, not the screen)', async () => {
    const env = setup();
    expect(await env.app.services.reports.staffOverview(await signIn(env.app, 'TR-10432'))).toBeNull();
    const noBlock = setup({ reports: { blocks: ['institute_summary', 'trade_batch'] } });
    expect(await noBlock.app.services.reports.staffOverview(await signIn(noBlock.app, 'PR-2741'))).toBeNull();
    const staffOff = setup({ staff: { enabled: false } });
    expect(await staffOff.app.services.reports.staffOverview(await signIn(staffOff.app, 'PR-2741'))).toBeNull();
  });

  it('the staff detail report (build staff_summary) is empty outside that scope: no staff figures for an instructor', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const report = await env.app.services.reports.build(ctx, 'staff_summary', env.app.services.reports.rangeFor(ctx, 'month'));
    expect(report).toEqual({ block: 'staff_summary', staff: [], pct: null });
    const noBlock = setup({ reports: { blocks: ['institute_summary', 'trade_batch'] } });
    const pr = await signIn(noBlock.app, 'PR-2741');
    expect(await noBlock.app.services.reports.build(pr, 'staff_summary', noBlock.app.services.reports.rangeFor(pr, 'month'))).toEqual({ block: 'staff_summary', staff: [], pct: null });
  });

  it('the staff detail report rows carry counts, marked and unmarked days, and the staff threshold', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const report = await env.app.services.reports.build(ctx, 'staff_summary', env.app.services.reports.rangeFor(ctx, 'month'));
    if (report.block !== 'staff_summary') throw new Error('block');
    expect(report.staff).toHaveLength(18);
    const overview = await env.app.services.reports.staffOverview(ctx);
    for (const row of report.staff) {
      const same = overview?.staff.find((s) => s.member.id === row.member.id);
      expect(row).toMatchObject({ counts: same?.counts, present: same?.present, marked: same?.marked, unmarked: same?.unmarked, pct: same?.pct, low: same?.low });
    }
    expect(report.pct).toBe(overview?.pct);
    // The section's order (lowest % first, then more unmarked days, then name), so the detail report continues it.
    expect(report.staff.map((s) => s.member.id)).toEqual(overview?.staff.map((s) => s.member.id));
  });
});

describe('staff register (D-154)', () => {
  it('this month for the principal: every day, one row per staff member', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const register = await env.app.services.reports.staffRegister(ctx, '2026-09-01');
    if (!register) throw new Error('register');
    expect(register).toMatchObject({ month: '2026-09-01', to: TODAY, today: TODAY, threshold: 90, preparedBy: { name: 'Dr. Anil Deshmukh', role: 'principal' } });
    expect(register.generatedAt).toBe(env.clock.now().toISOString());
    expect(register.days).toHaveLength(30);
    expect(register.rows).toHaveLength(18);
    const overview = await env.app.services.reports.staffOverview(ctx);
    // The register and the card agree person by person.
    for (const row of register.rows) expect(row.pct).toBe(overview?.staff.find((s) => s.member.id === row.member.id)?.pct);
    expect(register.rows.find((r) => r.member.id === 'st-rajesh')?.trade).toBe('Electrician');
  });

  it('last month runs to its end; other months, instructors and staff-off configurations get null', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const august = await env.app.services.reports.staffRegister(ctx, '2026-08-01');
    expect(august).toMatchObject({ to: '2026-08-31' });
    expect(august?.days).toHaveLength(31);
    expect(await env.app.services.reports.staffRegister(ctx, '2026-07-01')).toBeNull();
    expect(await env.app.services.reports.staffRegister(await signIn(env.app, 'TR-10432'), '2026-09-01')).toBeNull();
  });
});

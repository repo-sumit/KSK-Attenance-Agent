import { describe, expect, it, vi } from 'vitest';
import { setup, signIn, TODAY } from '../helpers/app';

/** The Institute attendance card's trend (U3, ruling R10): the same anatomy as My attendance and Staff attendance. */
describe('ReportService.instituteTrend', () => {
  it('report.trendMonths months, oldest first, each with a figure', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const trend = await env.app.services.reports.instituteTrend(ctx);
    expect(TODAY).toBe('2026-09-25');
    expect(trend.map((m) => m.month)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    for (const m of trend) expect(m.pct).toEqual(expect.any(Number));
  });

  it('a month without records is null, not 0', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const repo = env.app.repositories.attendance;
    const list = repo.listSubmissions.bind(repo);
    // Nothing recorded before August.
    vi.spyOn(repo, 'listSubmissions').mockImplementation(async (q) => (await list(q)).filter((s) => s.address.date >= '2026-08-01'));
    const trend = await env.app.services.reports.instituteTrend(ctx);
    expect(trend[0]).toEqual({ month: '2026-07-01', pct: null });
    expect(trend[1].pct).toEqual(expect.any(Number));
  });

  it("this month runs from the 1st to today by the headline's method (every batch's standings, threshold-safe)", async () => {
    // A 25-day window is 1–25 September: the headline over the same days must give the same figure.
    const env = setup({ reports: { windowDays: 25 } });
    const ctx = await signIn(env.app, 'PR-2741');
    const [trend, summary] = await Promise.all([env.app.services.reports.instituteTrend(ctx), env.app.services.reports.instituteSummary(ctx)]);
    expect(summary.range).toMatchObject({ from: '2026-09-01', to: TODAY });
    expect(trend.at(-1)).toEqual({ month: '2026-09-01', pct: summary.pct });
  });

  it('is empty when report.trendMonths is 0', async () => {
    const env = setup({ reports: { trendMonths: 0 } });
    expect(await env.app.services.reports.instituteTrend(await signIn(env.app, 'PR-2741'))).toEqual([]);
  });

  it('is empty outside the Institute report (an instructor, or without the institute_summary block): the guard is the service', async () => {
    const env = setup();
    expect(await env.app.services.reports.instituteTrend(await signIn(env.app, 'TR-10432'))).toEqual([]);
    const noBlock = setup({ reports: { blocks: ['trade_batch', 'staff_summary'] } });
    expect(await noBlock.app.services.reports.instituteTrend(await signIn(noBlock.app, 'PR-2741'))).toEqual([]);
  });
});

// tests/e2e/voice-reports.spec.ts
import { expect, preset, test } from './fixtures';

/** Reports and insights by voice (D-140) on the scripted model: the answer opens nothing; show_report and download_register move the screen. */
type Page = import('@playwright/test').Page;
const voice = (page: Page, script: string) => page.evaluate(`window.__kskDemo.voice.${script}`);
const start = async (page: Page) => {
  await page.getByRole('button', { name: 'Voice Agent' }).click();
  await expect(page.getByText('Listening')).toBeVisible();
};
const batches = (page: Page) => page.getByRole('region', { name: 'Batch attendance' });

test.describe('voice reports (scripted model)', () => {
  test('"how is Electrician Shift 1 Unit 2 doing?" is answered with the figures, and on yes Reports shows that batch', async ({ page }) => {
    await preset(page, 'principal');
    await start(page);
    await voice(page, `speak('how is Electrician Shift 1 Unit 2 doing?')`);
    const report = (await voice(page, `toolCall('get_batch_report', { batch: 'Electrician Shift 1 Unit 2' })`)) as {
      ok: boolean; avg_pct: number; lowest: { name: string; pct: number }[]; at_risk_count: number; instruction: string;
    };
    expect(report.ok).toBe(true);
    const lowest = report.lowest[0].name;
    expect(report.instruction).toMatch(/^Report of Shift 1, Unit 2, Electrician over the last 30 days: average \d+% \(31 students\)/);
    expect(report.instruction).toContain(`Lowest: ${lowest} ${report.lowest[0].pct}%`);
    await expect(page).toHaveURL(/\/home$/); // answering opens nothing

    await voice(page, `emit({ turnComplete: true })`);
    await voice(page, `speak('haan, dikhao')`);
    expect(await voice(page, `toolCall('show_report')`)).toMatchObject({ ok: true });
    await page.waitForURL(/\/reports$/);
    const row = batches(page).getByRole('button', { name: /Electrician · Shift 1 · Unit 2/, expanded: true });
    await expect(row).toBeVisible();
    await expect(row).toBeInViewport();
    await expect(batches(page).getByText(lowest).first()).toBeVisible(); // the batch's own leaderboard
    await expect(batches(page).getByRole('button', { expanded: true })).toHaveCount(1); // only that batch
    await expect(page.getByText('Listening')).toBeVisible(); // voice keeps running across the navigation
  });

  test('"who is at risk?" on yes brings the at-risk list into view', async ({ page }) => {
    await preset(page, 'principal');
    await start(page);
    const risk = (await voice(page, `toolCall('get_at_risk')`)) as { ok: boolean; total: number };
    expect(risk.ok).toBe(true);
    expect(risk.total).toBeGreaterThan(0);
    expect(await voice(page, `toolCall('show_report')`)).toMatchObject({ ok: true });
    await page.waitForURL(/\/reports$/);
    await expect(page.getByRole('heading', { name: 'At-risk students' })).toBeInViewport();
  });

  test('download_register opens the register sheet on the batch and month; the download waits for the trainer\'s tap', async ({ page }) => {
    await preset(page, 'open'); // Rajesh Patil: Electrician Shift 1 Unit 1 and Shift 2 Unit 1
    await start(page);
    const opened = (await voice(page, `toolCall('download_register', { target: 'shift 2 unit 1', month: 'LAST_MONTH' })`)) as { ok: boolean; target: string; month: string };
    expect(opened).toMatchObject({ ok: true, target: 'Shift 2, Unit 1, Electrician' });
    expect(opened.month).toMatch(/^[A-Z][a-z]+ \d{4}$/); // last month, as the sheet names it
    await page.waitForURL(/\/reports$/);
    const sheet = page.getByRole('dialog', { name: 'Download attendance register' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('Electrician · Shift 2 · Unit 1');
    await expect(sheet.getByRole('radio', { name: opened.month })).toBeChecked();
    await expect(sheet.getByRole('button', { name: 'Download' })).toBeEnabled();
  });
});

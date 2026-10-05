import { readFile } from 'node:fs/promises';
import type { Download, Page } from '@playwright/test';
import { expect, nav, preset, test } from './fixtures';

const pcts = async (page: Page, rows: ReturnType<Page['locator']>) =>
  (await rows.allInnerTexts()).map((text) => Number(/(\d+)%/.exec(text)?.[1] ?? NaN)).filter((n) => !Number.isNaN(n));

test('reports: my attendance, my batches as a sortable leaderboard, at-risk students', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await nav(page, 'Reports').click();
  await page.waitForURL(/\/reports$/);
  // No more generic report list.
  for (const gone of ['Daily register', 'Student attendance %']) await expect(page.getByText(gone)).toHaveCount(0);

  const me = page.getByRole('region', { name: 'My attendance' });
  // "This month" is said once (the section), not again under the figure.
  await expect(me.getByText('This month')).toHaveCount(1);
  await expect(me.getByText(/^Present: [\d.]+ days?$/)).toBeVisible();
  await expect(me.getByText(/^Absent: \d+ days?$/)).toBeVisible();
  await expect(me.getByText('Last 3 months')).toBeVisible();

  const batches = page.getByRole('region', { name: 'My batches' });
  // The row's toggle (its name goes on to the student count), not the row's "Download register for …" button.
  const row = batches.getByRole('button', { name: /Electrician · Shift 1 · Unit 2.*students/ });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await row.click();
  await expect(row).toHaveAttribute('aria-expanded', 'true');
  const students = batches.locator('ol > li');
  await expect(students).toHaveCount(31);
  await expect(students.first()).toContainText('1');
  const high = await pcts(page, students);
  expect(high).toEqual([...high].sort((a, b) => b - a));
  await batches.getByRole('radio', { name: 'Lowest first' }).click();
  const low = await pcts(page, students);
  expect(low).toEqual([...low].sort((a, b) => a - b));
  // Anyone below 75% carries the at-risk flag.
  for (const text of await students.allInnerTexts()) {
    const pct = Number(/(\d+)%/.exec(text)?.[1]);
    expect(text.includes('At risk'), text).toBe(pct < 75);
  }
  await row.click();
  await expect(students).toHaveCount(0);

  const risk = page.getByRole('region', { name: 'At-risk students' });
  await expect(risk.getByText('Students below 75% attendance in the last 30 days')).toBeVisible();
  const groups = risk.getByRole('button', { expanded: false });
  if ((await groups.count()) > 0) {
    await groups.first().click();
    for (const pct of await pcts(page, risk.locator('ul > li'))) expect(pct).toBeLessThan(75);
    // Each at-risk student keeps their rank in the batch, as in the leaderboard (RPT-1).
    for (const text of await risk.locator('ul > li').allInnerTexts()) expect(text).toMatch(/Rank \d+/);
  }
  // Already grouped by batch: there is no batch filter (D-063).
  await expect(risk.getByRole('combobox')).toHaveCount(0);

  // Offline data is part of Reports.
  await page.locator('main').getByRole('link', { name: /on this phone/ }).click();
  await page.waitForURL(/\/reports\/offline$/);
});

test('offline data: refresh one batch, then everything', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await page.goto('/reports/offline');
  const stale = page.locator('main li').filter({ hasText: 'Fitter · Shift 1 · Unit 2' });
  await expect(stale).toContainText('Refresh needed');
  // Updated on an earlier day: the date, not a time.
  await expect(stale).toContainText(/Updated \d{1,2} [A-Z][a-z]{2}/);
  await stale.getByRole('button', { name: 'Refresh data for Fitter · Shift 1 · Unit 2' }).click();
  await expect(stale).toContainText('Updated just now');
  await expect(stale).toContainText('Ready offline');
  const fresh = page.locator('main li').filter({ hasText: 'COPA · Shift 1 · Unit 1' });
  // Two lines: the state beside the time it was updated (the date only on an earlier day).
  await expect(fresh).toContainText('Ready offline');
  await expect(fresh).toContainText('Updated 7:45 AM');
  await page.getByRole('button', { name: 'Refresh all data' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Downloaded data refreshed' })).toBeVisible();
  await expect(fresh).toContainText('Updated just now');
  await page.getByRole('link', { name: 'Download more batches' }).click();
  await page.waitForURL(/\/reports\/offline\/download$/);
  // A batch already on the phone is a plain row that says so, not a ticked box; the rest can be chosen.
  const held = page.locator('main li').filter({ hasText: 'Ready offline' });
  await expect(held.first()).toBeVisible();
  await expect(held.getByRole('checkbox')).toHaveCount(0);
  await expect(page.getByRole('checkbox').first()).toHaveAttribute('aria-checked', 'false');
});

test('offline data: calm when synced, and no download action once every batch is on the phone', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await page.goto('/reports/offline');
  // A quiet confirmation that carries the end-of-day rule (RPT-4).
  await expect(page.getByRole('status').filter({ hasText: 'All attendance synced' })).toContainText('flagged to the principal');
  await expect(page.getByRole('button', { name: 'Refresh all data' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Download more batches' })).toHaveCount(0);
  await page.goto('/reports/offline/download');
  await expect(page.getByText('All your batches are on this phone')).toBeVisible();
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await page.getByRole('link', { name: 'Back to Offline data' }).click();
  await page.waitForURL(/\/reports\/offline$/);
});

test('principal reports: the institute, every batch by trade, at-risk across the institute, the detail reports', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  await nav(page, 'Reports').click();
  await page.waitForURL(/\/reports$/);
  const institute = page.getByRole('region', { name: 'Institute attendance' });
  await expect(institute).toContainText('417 students');
  await expect(institute).toContainText('17 batches');
  await expect(institute).toContainText('Staff attendance');
  const batches = page.getByRole('region', { name: 'Batch attendance' });
  await expect(batches.getByRole('button', { name: /Shift \d+ · Unit \d+.*students/ })).toHaveCount(17);
  // Every batch row also downloads its own register (owner follow-up to D-137).
  await expect(batches.getByRole('button', { name: /^Download register for .+ · Shift \d+ · Unit \d+$/ })).toHaveCount(17);
  // One register download per trade on its label line (D-137).
  await expect(batches.getByRole('button', { name: /^Trade register: / })).toHaveCount(5);
  await expect(batches.getByRole('heading', { name: 'Welder' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Offline data' })).toHaveCount(0);
  await page.getByRole('link', { name: /Correction log/ }).click();
  await page.waitForURL(/\/reports\/view\?r=correction_log/);
  await expect(page.getByText(/Kiran Wagh/)).toBeVisible();
});

const saved = async (download: Download) => {
  expect(download.suggestedFilename()).toMatch(/^KSK-register_.*\.html$/);
  return readFile(await download.path(), 'utf8');
};

test('register download: a batch for last month, then a whole trade (D-137)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await nav(page, 'Reports').click();
  await page.waitForURL(/\/reports$/);
  const batches = page.getByRole('region', { name: 'My batches' });
  await batches.getByRole('button', { name: /Electrician · Shift 1 · Unit 2.*students/ }).click();
  const students = batches.locator('ol > li');
  await expect(students).toHaveCount(31);
  const lines = (await students.first().innerText()).split('\n').map((l) => l.trim());
  const student = lines.find((l) => /^[A-Z][a-z]+( [A-Z][a-z]+)+$/.test(l));
  expect(student, lines.join(' | ')).toBeTruthy();

  const open = batches.getByRole('button', { name: 'Download register', exact: true });
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Download attendance register' });
  await expect(sheet).toContainText('Electrician · Shift 1 · Unit 2');
  const months = sheet.getByRole('radio');
  await expect(months).toHaveCount(2);
  await expect(months.first()).toBeChecked();
  await expect(sheet.locator('label').first()).toContainText(/so far$/);
  await months.nth(1).check();
  const [batchFile] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Download', exact: true }).click()]);
  const html = await saved(batchFile);
  expect(html).toContain('Monthly Attendance Register');
  expect(html).toContain(student!);
  // The emblem was fetched from the app and embedded; the file loads nothing from the network.
  expect(html).toContain('.emblem{background:url("data:image/png;base64,');
  await expect(page.getByRole('status').filter({ hasText: 'Register downloaded' })).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(open).toBeFocused();

  await batches.getByRole('button', { name: /^Trade register: / }).first().click();
  await expect(sheet).toBeVisible();
  const [tradeFile] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Download', exact: true }).click()]);
  const trade = await saved(tradeFile);
  expect(trade).toContain('Trade summary');
  expect(trade).toContain('Monthly Attendance Register');
});

test('register download from a collapsed batch row: one tap, that batch only, the row stays closed', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await nav(page, 'Reports').click();
  await page.waitForURL(/\/reports$/);
  const batches = page.getByRole('region', { name: 'My batches' });
  const row = batches.getByRole('button', { name: /Electrician · Shift 1 · Unit 2.*students/ });
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  const open = batches.getByRole('button', { name: 'Download register for Electrician · Shift 1 · Unit 2' });
  await expect(open).toHaveAttribute('title', 'Download register for Electrician · Shift 1 · Unit 2');
  const box = await open.boundingBox();
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(box!.height).toBeGreaterThanOrEqual(44);
  await open.click();
  const sheet = page.getByRole('dialog', { name: 'Download attendance register' });
  await expect(sheet).toContainText('Electrician · Shift 1 · Unit 2');
  const [file] = await Promise.all([page.waitForEvent('download'), sheet.getByRole('button', { name: 'Download', exact: true }).click()]);
  expect(file.suggestedFilename()).toMatch(/^KSK-register_.*_S\d-U\d_\d{4}-\d{2}\.html$/);
  const html = await saved(file);
  expect(html).toContain('Electrician · Shift 1 · Unit 2');
  expect(html).not.toContain('Trade summary');
  await expect(sheet).toHaveCount(0);
  await expect(open).toBeFocused();
  await expect(row).toHaveAttribute('aria-expanded', 'false');
  await expect(batches.locator('ol > li')).toHaveCount(0);
});

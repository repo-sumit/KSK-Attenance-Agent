import { expect, preset, test } from './fixtures';

test('batch-mapped: only the assigned classes, future class explains when it opens', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await expect(page.getByRole('heading', { name: 'Your batches' })).toBeVisible();
  const cards = page.locator('main').getByRole('link', { name: /Shift \d · Unit \d/ });
  await expect(cards).toHaveCount(2);
  await expect(page.getByText('Opens at 2:00 PM')).toBeVisible();
  await page.getByRole('link', { name: /Shift 2 · Unit 2/ }).click();
  await expect(page.getByRole('heading', { name: 'Attendance isn’t open yet' })).toBeVisible();
});

test('timetable: today’s periods, the current one is actionable, closed ones are not', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'timetable');
  await expect(page.getByRole('heading', { name: 'Today’s timetable' })).toBeVisible();
  await expect(page.getByText('Now', { exact: true })).toBeVisible();
  await expect(page.getByText('Not marked · closed at 8:00 AM')).toBeVisible();
  await expect(page.getByText('Opens at 11:00 AM')).toBeVisible();
  await page.getByRole('link', { name: /Period 3/ }).click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  await expect(page.getByText(/Period 3 · Theory/)).toBeVisible();
});

test('Employability Skills: several trades, only selected batches, a separate ES record', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'es');
  await expect(page.getByText('Employability Skills · 5 batches in 4 trades')).toBeVisible();
  for (const trade of ['Electrician', 'Fitter', 'Welder', 'COPA']) await expect(page.locator('main').getByRole('heading', { name: trade })).toBeVisible();
  // Electrician S1U1's trade class was submitted today (by Kalpana, a self-marked colleague, U2); the ES class for the same batch is still open.
  const s1u1 = page.locator('main').getByRole('link', { name: /Shift 1 · Unit 1/ }).first();
  await expect(s1u1).toContainText('Mark attendance');
  await s1u1.click();
  await page.waitForURL(/\/attendance\/mark\?s=ele-s1u1\.\d{4}-\d{2}-\d{2}\.daily\.es/, { timeout: 20_000 });
});

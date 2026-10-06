import { demo, expect, nav, preset, test } from './fixtures';

test('principal corrects today’s attendance with a reason; the audit log records it', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  await expect(page.getByRole('link', { name: /Student attendance/ }).first()).toBeVisible();
  await nav(page, 'Attendance').click();
  await page.getByRole('link', { name: /Electrician/ }).click();
  // Shift 1 · Unit 1 has two marks today (the trade and Employability Skills): open the trade's.
  await page.getByRole('link', { name: /Shift 1 · Unit 1 · Electrician/ }).click();
  await page.waitForURL(/\/attendance\/record/);
  await expect(page.getByText(/Tap a student to correct/)).toBeVisible();
  await page.getByRole('link', { name: /Rahul Kumar/ }).click();
  await page.waitForURL(/\/attendance\/correct/);
  await expect(page.locator('main').getByText('This correction will be recorded in the audit log.').first()).toBeVisible();
  await page.getByRole('radio', { name: /^Present/ }).click();
  await page.getByRole('button', { name: 'Student arrived late' }).click();
  await page.getByRole('button', { name: 'Save correction' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save correction' }).click();
  await expect(page.getByRole('heading', { name: 'Attendance corrected' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForURL(/\/attendance\/record/);
  await expect(page.getByText('Corrected by principal')).toBeVisible();

  // The record shows only the session it was opened for (D-150): no Today/Yesterday switch.
  await expect(page.getByRole('radio', { name: 'Yesterday' })).toHaveCount(0);
  // A typed URL for yesterday is read-only either way: its record (or, on a Monday, Sunday's empty day) can't be corrected.
  const today = new URL(page.url()).searchParams.get('s')?.split('.')[1] ?? '';
  expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await page.goto(page.url().replace(today, yesterday));
  await expect(page.getByText(/Attendance from previous days can’t be corrected\.|Nothing was submitted for Electrician · Shift 1 · Unit 1/)).toBeVisible();
  await expect(page.getByRole('link', { name: /Rahul Kumar/ })).toHaveCount(0);

  await page.goto('/reports/view?r=correction_log&range=month');
  await expect(page.getByText(/Rahul Kumar · Absent → Present/)).toBeVisible();
  await expect(page.getByText(/Kiran Wagh/)).toBeVisible();
});

test('principal marks staff who have not self-verified; self-verified rows are locked', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  await page.getByRole('link', { name: 'Mark staff attendance' }).click();
  await page.waitForURL(/\/attendance\/staff/);
  const sunita = page.locator('li', { hasText: 'Sunita Jadhav' });
  await expect(sunita.getByText(/Self verified/)).toBeVisible();
  // Locked: a saved mark is a status value, not a control.
  await expect(sunita.getByRole('button')).toHaveCount(0);
  await expect(sunita.getByRole('combobox')).toHaveCount(0);
  const sanjay = page.locator('li', { hasText: 'Sanjay More' });
  await sanjay.getByRole('combobox', { name: 'Attendance for Sanjay More' }).selectOption('present');
  await page.getByRole('button', { name: 'Save 1 change' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save 1 change' }).click();
  await expect(page.getByText('Staff attendance saved')).toBeVisible();
  await expect(sanjay.getByText('Marked by principal')).toBeVisible();
});

test('principal Home and the Attendance tab count batches one way; both attention rows name two, then "and N more"', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  const card = page.getByRole('link', { name: /Student attendance/ }).first();
  await expect(card).toContainText(/\d+ of \d+/);
  const [, done, total] = (await card.textContent())!.match(/(\d+) of (\d+)/)!.map(Number);
  // One truncation rule for both rows (no ellipsis, no full staff list).
  for (const name of [/batches not submitted/, /staff not marked/]) {
    const row = page.getByRole('link', { name });
    if (await row.count()) await expect(row).not.toContainText('…');
  }
  await expect(page.getByRole('link', { name: /staff not marked/ })).toContainText(/, .+ and \d+ more/);

  await nav(page, 'Attendance').click();
  await page.waitForURL(/\/attendance$/);
  const rows = page.getByRole('list', { name: 'Trades' }).getByRole('link');
  await expect(rows.first()).toContainText(/of \d+ batch/);
  // The trade rows add up to Home's "done of total": the same denominator (every batch today, opened or not).
  const counts = (await rows.allTextContents()).map((s) => s.match(/(\d+) of (\d+)/)!.slice(1).map(Number));
  expect(counts.reduce((a, [d]) => a + d, 0)).toBe(done);
  expect(counts.reduce((a, [, n]) => a + n, 0)).toBe(total);
});

test('principal offline (D-153): staff marks saved on this phone, named in Offline data, synced on reconnect', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  await demo(page, "setNetwork('offline')");
  await page.getByRole('link', { name: 'Mark staff attendance' }).click();
  await page.waitForURL(/\/attendance\/staff/);
  const sanjay = page.locator('li', { hasText: 'Sanjay More' });
  await sanjay.getByRole('combobox', { name: 'Attendance for Sanjay More' }).selectOption('present');
  await page.getByRole('button', { name: 'Save 1 change' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Save 1 change' }).click();
  // D-032: the save says where the marks are.
  await expect(page.getByText('Saved on this phone · will sync automatically')).toBeVisible();

  // Home's Sync pending card counts it and links to the list.
  await nav(page, 'Home').click();
  await page.waitForURL(/\/home$/);
  const card = page.getByRole('region', { name: 'Sync pending' });
  await expect(card).toContainText('1 attendance record waiting');
  await card.getByRole('link', { name: 'See what’s waiting' }).click();
  await page.waitForURL(/\/reports\/offline$/);
  const full = page.getByRole('region', { name: 'Sync pending' });
  await expect(full.getByRole('listitem')).toHaveCount(1);
  await expect(full.getByRole('listitem')).toContainText('Staff attendance · Sanjay More');
  await expect(full).toContainText('reported as missing for the day');
  // The principal can mark students, so the downloaded batches are there too.
  await expect(page.getByRole('heading', { name: 'Downloaded batches' })).toBeVisible();

  await demo(page, "setNetwork('online')");
  await expect(page.getByText('All attendance synced').first()).toBeVisible();
  await expect(page.getByRole('region', { name: 'Sync pending' }).getByRole('listitem')).toHaveCount(0);
});

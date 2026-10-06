import { demo, expect, nav, preset, realGreeting, test } from './fixtures';

test('Home is today’s work: notices, classes, my attendance; no Attendance tab and no “View reports”', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Home', 'Reports']);
  await expect(page.getByRole('link', { name: 'View reports' })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ })).toBeVisible();
  // An old link to the Attendance tab lands on Home.
  await page.goto('/attendance');
  await page.waitForURL(/\/home$/);

  // The compact notice: the most important one, and how many more.
  const notices = page.getByRole('region', { name: 'Announcements' });
  const banner = notices.getByRole('button');
  await expect(banner).toContainText('Holiday');
  await expect(banner).toContainText('Special holiday: institute closed');
  await expect(banner).toContainText('4 more announcements');
  await banner.click();
  const sheet = page.getByRole('dialog', { name: 'Announcements' });
  await expect(sheet.getByRole('listitem')).toHaveCount(5);
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Batch on OJT' })).toContainText('For Electrician · Shift 1 · Unit 1');
  await expect(sheet.getByRole('listitem').filter({ hasText: 'Instructor meeting' })).toContainText('For you');
  // Other trades' notices are not shown to this instructor.
  await expect(sheet.getByText('Welding workshop closed for maintenance')).toHaveCount(0);
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await expect(banner).toBeFocused();
});

test('Home is today’s work only: no data refresh on the batch cards, which stay one compact row', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  const main = page.locator('main');
  const open = main.getByRole('link', { name: /Shift 1 · Unit 2/ });
  await expect(open).toContainText('Mark attendance');
  // Offline data is managed from Reports, never from Home (round 3).
  await expect(main.getByRole('button', { name: /Refresh data/ })).toHaveCount(0);
  await expect(main.getByText(/^Updated /)).toHaveCount(0);
  for (const width of [320, 360, 412, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    for (const card of await main.getByRole('link', { name: /Shift \d · Unit \d/ }).all()) {
      const box = (await card.boundingBox())!;
      const title = (await card.getByText(/^Shift \d · Unit \d$/).boundingBox())!;
      const state = (await card.locator('span').filter({ hasText: /Mark attendance|Opens at|Submitted/ }).last().boundingBox())!;
      // The state sits beside the title or wraps under it, never over it; the card has no empty band.
      expect(state.x >= title.x + title.width || state.y >= title.y + title.height).toBe(true);
      expect(box.height).toBeLessThanOrEqual(width >= 360 ? 80 : 120);
    }
  }
});

test('the principal keeps the Attendance tab and sees every notice for the institute', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link')).toHaveText(['Home', 'Attendance', 'Reports']);
  await expect(page.getByRole('region', { name: 'Announcements' }).getByRole('button')).toContainText('5 more announcements');
  await nav(page, 'Attendance').click();
  await page.waitForURL(/\/attendance$/);
  await expect(page.getByRole('radiogroup', { name: 'Attendance view' })).toBeVisible();
});

test('Sync pending on Home: only while records wait; Sync now shows syncing, then success (or failure)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  const card = page.getByRole('region', { name: /Sync pending|Syncing attendance…|Couldn’t sync|All attendance synced/ });
  // Everything synced: no card at all.
  await expect(card).toHaveCount(0);

  // A record is waiting because an automatic attempt failed (the demo's "Pending sync" network).
  await demo(page, "setNetwork('pending')");
  await expect(card).toContainText('Sync pending');
  await expect(card).toContainText('1 attendance record waiting');
  await expect(card).toContainText('Auto-sync failed at 10:15 AM');
  // One sync message per screen: the bar under the header leaves sync to the card.
  await expect(page.getByText(/couldn’t sync\. Saved safely/)).toHaveCount(0);

  // Sync now fails: the card says so and offers Try again.
  await demo(page, 'setSimulation({ nextSyncFails: true })');
  await card.getByRole('button', { name: 'Sync now' }).click();
  await expect(card).toContainText('Couldn’t sync');
  await expect(card).toContainText('Tried at 10:15 AM');
  await demo(page, 'setSimulation({ nextSyncFails: false, speed: 0.4 })');
  await card.getByRole('button', { name: 'Try again' }).click();
  await expect(card.getByRole('button', { name: 'Syncing…' })).toBeVisible();
  await expect(card).toContainText('All attendance synced');
  // Then it goes away: nothing is waiting any more.
  await expect(card).toHaveCount(0, { timeout: 5_000 });
});

test('Sync now offline explains instead of doing nothing', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await demo(page, "setNetwork('pending')");
  await demo(page, 'setSimulation({ online: false })');
  const card = page.getByRole('region', { name: 'Sync pending' });
  await expect(card).toContainText('It will sync when you’re back online');
  // Inactive (aria-disabled) offline: a press explains instead of doing nothing.
  await card.getByRole('button', { name: 'Sync now' }).click({ force: true });
  await expect(page.getByRole('status').filter({ hasText: 'Connect to the internet to sync' })).toBeVisible();
  await expect(card).toContainText('1 attendance record waiting');
});

test('the greeting follows the real time of day while the classes keep the demo clock (D-151)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  // The demo clock stays at 10:15 (Shift 1 · Unit 2 is open for marking), whatever the machine's time is.
  await expect(page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ })).toContainText('Mark attendance');
  await expect(page.getByRole('heading', { level: 2, name: realGreeting('Sunita') })).toBeVisible();
});

test('the trade groups under "Your batches" are h3 headings under its h2, as on Reports (U19)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  const batches = page.getByRole('region', { name: 'Your batches' });
  await expect(batches.getByRole('heading', { level: 2, name: 'Your batches' })).toBeVisible();
  await expect(batches.getByRole('heading', { level: 3, name: 'Electrician' })).toBeVisible();
  await expect(batches.getByRole('heading', { level: 2, name: 'Electrician' })).toHaveCount(0);
});

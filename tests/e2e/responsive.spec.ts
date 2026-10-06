import AxeBuilder from '@axe-core/playwright';
import { demo, expect, expectGroupsFit, expectNoOverflow, openProfileMenu, preset, test } from './fixtures';

const WIDTHS = [320, 360, 375, 390, 412, 768, 1024, 1280, 1440, 1920];

test('no horizontal overflow on key screens, phone to desktop', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  for (const path of ['/home', '/attendance', '/attendance/staff', '/reports', '/reports/offline', '/reports/view?r=staff_summary&range=month']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 800 });
      await expectNoOverflow(page);
    }
  }
});

test('roster rows stay compact with five statuses, 320px to 412px: one status control per row', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await demo(page, "setConfig({ marking: { statusSet: ['present', 'absent', 'half_day', 'leave', 'ojt'], halfDayHalves: true } })");
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  await page.goto(`/attendance/open?s=fit-s1u2.${today}.daily`);
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  await page.getByRole('combobox', { name: /^Attendance for / }).nth(1).selectOption('leave');
  for (const width of WIDTHS.filter((w) => w <= 412)) {
    await page.setViewportSize({ width, height: 800 });
    await expectNoOverflow(page);
    await expectGroupsFit(page);
    // Every row's control lines up in one right-hand column (the same width, the same right edge).
    const boxes = await page.getByRole('combobox', { name: /^Attendance for / }).evaluateAll((els) => els.slice(0, 6).map((e) => e.getBoundingClientRect()).map((r) => [Math.round(r.width), Math.round(r.right)]));
    expect(new Set(boxes.map((b) => b.join('/'))).size, `one column at ${width}`).toBe(1);
  }
});

test('key screens pass automated accessibility checks', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  for (const path of ['/home', '/reports', '/reports/offline']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.length}`)).toEqual([]);
  }
  // The profile menu and the demo panel, open.
  await page.goto('/home');
  await openProfileMenu(page);
  const menu = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(menu.violations.map((v) => `menu ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Open demo controls' }).click();
  const panel = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(panel.violations.map((v) => `demo ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
});

test('principal and report screens (grey surfaces) pass automated accessibility checks', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  for (const path of ['/home', '/attendance/staff', '/reports', '/reports/offline', '/reports/view?r=staff_summary&range=month', `/attendance/correct?s=ele-s1u1.${today}.daily&student=ele-s1u1-r21`]) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
    expect(results.violations.map((v) => `${path} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  }
});

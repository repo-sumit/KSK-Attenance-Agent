import type { Locator, Page } from '@playwright/test';
import { expect, expectNoOverflow, nav, openProfileMenu, preset, test } from './fixtures';

const WIDE = [
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];

/**
 * A box measured once the element has stopped moving: its (and its subtree's) animations and transitions have ended
 * and two measurements a frame apart agree. A sheet that opens with a transition is never measured mid-way.
 */
async function settledBox(locator: Locator) {
  await expect(locator).toBeVisible();
  await locator.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((a) => a.finished.catch(() => undefined))));
  let previous = await locator.boundingBox();
  await expect
    .poll(async () => {
      await locator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
      const next = await locator.boundingBox();
      const same = JSON.stringify(next) === JSON.stringify(previous);
      previous = next;
      return same;
    })
    .toBe(true);
  return previous!;
}

/** The avatar is the right-most control of the header (tooling such as the demo trigger sits left of it). */
async function expectAvatarRightMost(page: Page, where: string) {
  const buttons = await page
    .locator('header')
    .getByRole('button')
    .evaluateAll((els) => els.map((e) => ({ name: e.getAttribute('aria-label') ?? e.textContent ?? '', right: e.getBoundingClientRect().right })));
  const avatar = buttons.find((b) => b.name === 'Profile');
  expect(avatar, where).toBeDefined();
  for (const b of buttons) expect(avatar!.right, `${where}: "${b.name}" is right of the avatar`).toBeGreaterThanOrEqual(b.right);
}

test('wider screens use the viewport: full-width chrome, a readable column, navigation in the header, no Profile tab', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  for (const size of WIDE) {
    await page.setViewportSize(size);
    const header = (await page.locator('header').boundingBox())!;
    expect(header.width, `header at ${size.width}`).toBeGreaterThanOrEqual(size.width - 1);
    const today = (await page.locator('main section').first().boundingBox())!;
    // Not stuck at phone width, not stretched edge to edge either.
    expect(today.width, `content at ${size.width}`).toBeGreaterThan(420);
    expect(today.width, `content at ${size.width}`).toBeLessThanOrEqual(1008);
    // One primary navigation, in the header; Profile is never a destination.
    const navs = page.getByRole('navigation', { name: 'Main' });
    await expect(navs).toHaveCount(1);
    await expect(navs.getByRole('link')).toHaveText(['Home', 'Reports']);
    expect((await navs.boundingBox())!.y).toBeLessThan(header.y + header.height);
    await expect(page.getByRole('link', { name: 'Profile' })).toHaveCount(0);
    // Avatar at the top right of the header.
    const avatar = (await page.locator('header').getByRole('button', { name: 'Profile' }).boundingBox())!;
    expect(avatar.x).toBeGreaterThan(size.width / 2);
    expect(avatar.y).toBeLessThan(header.y + header.height);
  }
});

/** The demo trigger sits immediately left of the avatar: nothing between them, and it never floats while a header exists (D-066). */
async function expectTriggerBesideAvatar(page: Page, where: string) {
  const header = page.locator('header');
  const t = (await header.getByRole('button', { name: 'Open demo controls' }).boundingBox())!;
  const a = (await header.getByRole('button', { name: 'Profile' }).boundingBox())!;
  expect(t.x + t.width, `${where}: trigger left of the avatar`).toBeLessThanOrEqual(a.x);
  expect(a.x - (t.x + t.width), `${where}: trigger right next to the avatar`).toBeLessThanOrEqual(12);
  // Same row as the avatar.
  expect(Math.abs(t.y + t.height / 2 - (a.y + a.height / 2)), `${where}: same row`).toBeLessThanOrEqual(2);
}

test('the avatar is the right-most header control; the demo trigger sits immediately left of it on every screen and width', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  const header = page.locator('header');
  const trigger = header.getByRole('button', { name: 'Open demo controls' });
  for (const width of [320, 360, 390, 412, ...WIDE.map((s) => s.width)]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(trigger).toBeVisible();
    await expectTriggerBesideAvatar(page, `home at ${width}`);
    await expectAvatarRightMost(page, `home at ${width}`);
    // Right of the brand (and of the navigation from 600px): never at the far left any more.
    const brand = (await header.locator('img').first().boundingBox())!;
    expect((await trigger.boundingBox())!.x, `trigger right of the brand at ${width}`).toBeGreaterThan(brand.x + brand.width);
    await expectNoOverflow(page);
  }
  // In the header nothing floats, so no screen reserves room for it.
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-demo-float'))).toBe(false);

  await page.goto('/reports/offline');
  await page.waitForURL(/\/reports\/offline$/);
  await expect(header.getByRole('button', { name: 'Back' })).toBeVisible();
  for (const width of [320, 360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectAvatarRightMost(page, `task screen at ${width}`);
    await expectTriggerBesideAvatar(page, `task screen at ${width}`);
    if (width < 600) {
      // [← title] … [Demo] [avatar]: icon only, after the back arrow and the title.
      const t = (await trigger.boundingBox())!;
      const title = (await header.getByRole('heading', { name: 'Offline data' }).boundingBox())!;
      expect(t.width).toBeLessThanOrEqual(40);
      expect(t.x).toBeGreaterThanOrEqual(title.x + title.width);
    }
    await expectNoOverflow(page);
  }
});

test('the demo trigger keeps its "Demo" label beside two destinations; 600–899px beside three it is icon only', async ({ page, consoleErrors }) => {
  void consoleErrors;
  const trigger = page.locator('header').getByRole('button', { name: 'Open demo controls' });
  const label = trigger.getByText('Demo', { exact: true });
  // Instructors (Home · Reports): the labelled pill fits beside the navigation at every width.
  await preset(page, 'batch');
  for (const width of [600, 768, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(label, `instructor at ${width}`).toBeVisible();
    expect((await trigger.boundingBox())!.width, `instructor at ${width}`).toBeGreaterThan(44);
    await expectTriggerBesideAvatar(page, `instructor at ${width}`);
    await expectNoOverflow(page);
  }
  // The principal (Home · Attendance · Reports): icon only until 900px, where the room is needed.
  await preset(page, 'principal');
  for (const width of [600, 768]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(label, `principal at ${width}`).toBeHidden();
    expect((await trigger.boundingBox())!.width, `principal at ${width}`).toBeLessThanOrEqual(40);
    await expectTriggerBesideAvatar(page, `principal at ${width}`);
    await expectNoOverflow(page);
  }
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(label, 'principal at 900').toBeVisible();
});

test('screens without the app header: the demo trigger floats (top right on phones, bottom right from 600px)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 360, height: 800 });
  await preset(page, 'first_time', /\/login$/);
  const trigger = page.getByRole('button', { name: 'Open demo controls' });
  let t = (await trigger.boundingBox())!;
  expect(t.x + t.width).toBeGreaterThan(360 - 24);
  expect(t.y).toBeLessThan(24);
  // The layout keeps room for it while it floats: the login content starts below it.
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-demo-float'))).toBe(true);
  expect((await page.locator('main img').first().boundingBox())!.y).toBeGreaterThanOrEqual(t.y + t.height);
  await page.setViewportSize({ width: 1280, height: 720 });
  t = (await trigger.boundingBox())!;
  expect(t.x + t.width).toBeGreaterThan(1280 - 40);
  expect(t.y + t.height).toBeGreaterThan(720 - 40);
});

test('demo controls start collapsed on every size and overlay the app without reflowing it (a drawer on the right from 600px)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  for (const size of [{ width: 360, height: 800 }, ...WIDE]) {
    await page.setViewportSize(size);
    // Collapsed: only the trigger; no panel content anywhere in the page.
    await expect(page.getByRole('button', { name: 'Open demo controls' })).toBeVisible();
    await expect(page.getByText('Quick presets')).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    const before = (await page.locator('main').boundingBox())!;
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    const panel = page.getByRole('dialog', { name: 'Demo controls' });
    await expect(panel.getByText('Quick presets')).toBeVisible();
    const box = (await panel.boundingBox())!;
    if (size.width >= 600) {
      // On the trigger's side (right), below the header.
      expect(box.width).toBeLessThanOrEqual(420);
      expect(box.x + box.width).toBeGreaterThan(size.width - 40);
      const header = (await page.locator('header').boundingBox())!;
      expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
    } else {
      expect(box.height).toBeGreaterThan(size.height * 0.5);
    }
    expect(await page.locator('main').boundingBox()).toEqual(before);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open demo controls' })).toBeFocused();
  }
  // Tablets and desktops: the app stays usable while the panel is open.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Open demo controls' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click();
  await page.waitForURL(/\/reports$/);
});

test('profile menu: a bottom sheet on phones, anchored under the avatar on desktops; Escape closes it', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await page.setViewportSize({ width: 1280, height: 720 });
  const avatar = page.locator('header').getByRole('button', { name: 'Profile' });
  const a = (await avatar.boundingBox())!;
  const menu = await openProfileMenu(page);
  const m = (await menu.boundingBox())!;
  // Below the whole header (never over its bottom edge), right edge on the avatar's.
  const header = (await page.locator('header').boundingBox())!;
  expect(m.y).toBeGreaterThanOrEqual(header.y + header.height);
  expect(Math.abs(m.x + m.width - (a.x + a.width))).toBeLessThanOrEqual(2);
  await expect(menu.getByText('Rajesh Patil')).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Logout' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(avatar).toBeFocused();

  // The logout confirmation: its two actions side by side at the DS button width, never stretched across the sheet.
  await (await openProfileMenu(page)).getByRole('button', { name: 'Logout' }).click();
  const confirm = page.getByRole('dialog', { name: 'Log out?' });
  // Measured once the confirmation's opening transition has ended (it was measured mid-transition once).
  await settledBox(confirm);
  const logout = await settledBox(confirm.getByRole('button', { name: 'Logout' }));
  const cancel = await settledBox(confirm.getByRole('button', { name: 'Cancel' }));
  expect(logout.width).toBeLessThanOrEqual(281);
  expect(cancel.width).toBeLessThanOrEqual(281);
  expect(Math.abs(logout.y - cancel.y)).toBeLessThanOrEqual(1);
  expect(logout.x + logout.width).toBeLessThanOrEqual(cancel.x);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();

  await page.setViewportSize({ width: 360, height: 800 });
  const sheet = await openProfileMenu(page);
  const s = (await sheet.boundingBox())!;
  expect(s.y + s.height).toBeGreaterThanOrEqual(799);
  expect(s.width).toBeGreaterThanOrEqual(359);
  // Offline data is no longer in the menu: it lives on the Reports page.
  await expect(sheet.getByRole('button', { name: /Offline data/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await nav(page, 'Reports').click();
  await page.waitForURL(/\/reports$/);
  await page.locator('main').getByRole('link', { name: /on this phone/ }).click();
  await page.waitForURL(/\/reports\/offline$/);
});

test('attendance stays a row list in a readable column on a monitor, with a centred primary action', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  // 800px reading column (rows add their own 16px padding either side).
  const list = (await page.getByRole('list', { name: /Electrician/ }).boundingBox())!;
  expect(list.width).toBeLessThanOrEqual(832);
  expect(list.x).toBeGreaterThan(400);
  const cta = (await page.getByRole('button', { name: 'Review & Submit' }).boundingBox())!;
  expect(cta.width).toBeLessThanOrEqual(281);
  expect(Math.abs(cta.x + cta.width / 2 - 960)).toBeLessThanOrEqual(2);
  await expect(page.getByRole('table')).toHaveCount(0);
});

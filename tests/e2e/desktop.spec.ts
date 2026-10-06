import type { Locator, Page } from '@playwright/test';
import { demo, expect, expectNoOverflow, nav, openProfileMenu, preset, test } from './fixtures';

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

const drawerMarked = (page: Page) => page.evaluate(() => document.documentElement.hasAttribute('data-demo-drawer'));

test('the demo trigger: the presenter mark, the signed-in first name from 600px, and wifi-off while offline', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  const trigger = page.locator('header').getByRole('button', { name: 'Open demo controls' });
  const name = trigger.getByText('· Sunita', { exact: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(trigger.getByText('Demo', { exact: true })).toBeVisible();
  await expect(name).toBeHidden(); // phones keep "Demo": header widths are unchanged
  for (const width of [600, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(name, `first name at ${width}`).toBeVisible();
    await expectTriggerBesideAvatar(page, `named trigger at ${width}`);
    await expectNoOverflow(page);
  }
  await expect(trigger).not.toHaveAttribute('data-offline');
  await demo(page, "setNetwork('offline')");
  await expect(trigger).toHaveAttribute('data-offline', 'true');
  await expect(trigger).toHaveAccessibleName('Open demo controls, offline');
  await demo(page, "setNetwork('online')");
  await expect(trigger).toHaveAccessibleName('Open demo controls');
});

test('demo controls start collapsed on every size and overlay the app without reflowing it (a drawer on the right from 600px)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  for (const size of [{ width: 360, height: 800 }, ...WIDE]) {
    await page.setViewportSize(size);
    // Collapsed: only the trigger; no panel content anywhere in the page.
    await expect(page.getByRole('button', { name: 'Open demo controls' })).toBeVisible();
    await expect(page.getByText('Sign in as')).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    const before = (await page.locator('main').boundingBox())!;
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    const panel = page.getByRole('dialog', { name: 'Demo controls' });
    // The first section: who to show.
    await expect(panel.locator('h3').first()).toHaveText('Sign in as');
    const box = (await panel.boundingBox())!;
    // The drawer contract: <html data-demo-drawer> exactly while the non-modal drawer is open (never for the phone sheet).
    await expect.poll(() => drawerMarked(page), `drawer marker at ${size.width}`).toBe(size.width >= 600);
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
    await expect.poll(() => drawerMarked(page), `drawer marker removed at ${size.width}`).toBe(false);
  }
  // Tablets and desktops: the app stays usable while the panel is open.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByRole('button', { name: 'Open demo controls' }).click();
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Reports' }).click();
  await page.waitForURL(/\/reports$/);
});

test('Voice Agent is an overlay: main keeps its box when the button grows into the card and when it is minimized (D-147)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 1280, height: 800 });
  await preset(page, 'open');
  for (const where of ['Home', 'roster']) {
    if (where === 'roster') {
      await page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ }).click();
      await page.getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
      await page.waitForURL(/\/attendance\/mark/);
    }
    const main = page.locator('main');
    const voiceButton = page.getByRole('button', { name: where === 'Home' ? 'Voice Agent' : /^(Listening|Paused|Speaking)$/ });
    await expect(voiceButton).toBeVisible();
    const before = await settledBox(main);
    await voiceButton.click();
    const card = page.locator('section[data-voice-status]');
    await settledBox(card);
    expect(await settledBox(main), `${where}: card`).toEqual(before);
    await card.getByRole('button', { name: 'Minimize voice controls' }).click();
    await expect(card).toHaveCount(0);
    expect(await settledBox(main), `${where}: minimized`).toEqual(before);
  }
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

/** The right-most edge of a row's controls (its status control, a record's chip or pencil); full-width wrappers are not controls. */
const rowEnd = (row: Locator) =>
  row.evaluate((el) => {
    const width = el.getBoundingClientRect().width;
    return Math.max(...[...el.querySelectorAll('*')].map((c) => c.getBoundingClientRect()).filter((r) => r.width > 0 && r.width < width / 2).map((r) => r.right));
  });
const lastTileEnd = async (page: Page) => (await page.locator('[data-summary-item]').last().boundingBox())!;

test('the Students | Staff switch spans the column on both views and keeps its y, width and band (D-159)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'principal');
  const view = page.getByRole('radiogroup', { name: 'Attendance view' });
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/attendance');
    const list = page.getByRole('list', { name: 'Trades' });
    await expect(list).toBeVisible();
    const students = await settledBox(view);
    const column = (await list.boundingBox())!;
    expect(Math.abs(students.x - column.x), `x at ${width}`).toBeLessThanOrEqual(1);
    expect(Math.abs(students.width - column.width), `width at ${width}`).toBeLessThanOrEqual(1);
    const band = await view.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor);
    await page.getByRole('radio', { name: 'Staff' }).click();
    await page.waitForURL(/\/attendance\/staff$/);
    await expect(page.locator('main li').first()).toBeVisible();
    expect(await settledBox(view), `the switch does not move at ${width}`).toEqual(students);
    expect(await view.evaluate((el) => getComputedStyle(el.parentElement!).backgroundColor), `the same band at ${width}`).toBe(band);
    // Staff: the day's totals end where the switch ends (the column), in line with the rows' status column (U4).
    const tile = await lastTileEnd(page);
    expect(Math.abs(tile.x + tile.width - (students.x + students.width)), `tiles at ${width}`).toBeLessThanOrEqual(1);
    expect(Math.abs(tile.x + tile.width - (await rowEnd(page.locator('main li').first()))), `rows at ${width}`).toBeLessThanOrEqual(1);
  }
});

test('every summary in a fixed band ends in the rows\' status column from 600px; the roster date stays one line (U4, U7)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  const rows = page.locator('[data-student]');
  await expect(rows.first()).toBeVisible();
  // The date and closing time: one line at tablet width, and a wrapped line never starts with "·".
  const meta = page.locator('[data-summary-item]').first().locator('xpath=ancestor::div[2]').locator('p').first();
  const { height, line } = await meta.evaluate((p) => ({ height: p.getBoundingClientRect().height, line: parseFloat(getComputedStyle(p).lineHeight) }));
  expect(height, 'roster meta is one line at 768').toBeLessThanOrEqual(line * 1.5);
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const tile = await lastTileEnd(page);
    expect(Math.abs(tile.x + tile.width - (await rowEnd(rows.first()))), `roster at ${width}`).toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Review & Submit' }).click();
  await page.waitForURL(/\/attendance\/review/);
  await page.getByRole('button', { name: 'Submit attendance' }).click();
  await page.waitForURL(/\/attendance\/submitted/);
  await page.goto(page.url().replace('/submitted', '/record'));
  const record = page.locator('main ol > li');
  await expect(record.first()).toBeVisible();
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const tile = await lastTileEnd(page);
    expect(Math.abs(tile.x + tile.width - (await rowEnd(record.first()))), `instructor record at ${width}`).toBeLessThanOrEqual(1);
  }
  // Phones: the record's status strip is the lead, above the tiles (the prototype's order).
  await page.setViewportSize({ width: 360, height: 800 });
  const strip = (await page.getByText(/^Submitted ·/).boundingBox())!;
  expect(strip.y + strip.height).toBeLessThanOrEqual((await page.locator('[data-summary-item]').first().boundingBox())!.y);

  await preset(page, 'principal');
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  await page.goto(`/attendance/record?s=ele-s1u1.${today}.daily`);
  await expect(record.first()).toBeVisible();
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    const tile = await lastTileEnd(page);
    expect(Math.abs(tile.x + tile.width - (await rowEnd(record.first()))), `principal record at ${width}`).toBeLessThanOrEqual(1);
  }
});

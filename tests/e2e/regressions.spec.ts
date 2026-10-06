import { demo, expect, preset, test } from './fixtures';

/** Every direct child of the scroller shows all of its content (none is squeezed and clipped). */
async function expectNothingClipped(page: import('@playwright/test').Page) {
  const clipped = await page.locator('main').evaluate((main) =>
    [...main.children].filter((c) => c.scrollHeight > c.clientHeight + 1 && getComputedStyle(c).overflowY !== 'visible').map((c) => c.className),
  );
  expect(clipped).toEqual([]);
}

test('long lists scroll to their last row: review absentees and report tables (main never clips its children)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await page.setViewportSize({ width: 320, height: 568 });
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  const status = page.getByRole('combobox', { name: /^Attendance for / });
  for (let i = 0; i < 8; i++) await status.nth(i).selectOption('absent');
  await page.getByRole('button', { name: 'Review & Submit' }).click();
  await page.waitForURL(/\/attendance\/review/);
  await expect(page.getByText(/Absent students \(8\)|8 absent/i).first()).toBeVisible();
  await expectNothingClipped(page);

  for (const size of [{ width: 360, height: 800 }, { width: 1280, height: 720 }]) {
    await page.setViewportSize(size);
    await page.goto('/?preset=principal');
    await page.waitForURL(/\/home$/);
    await page.goto('/reports');
    await page.waitForLoadState('networkidle');
    await expectNothingClipped(page);
    // Every batch of the institute (17) is a row; the last one scrolls into view and opens its students.
    const rows = page.getByRole('region', { name: 'Batch attendance' }).getByRole('button', { expanded: false });
    await expect(rows).toHaveCount(17);
    const last = rows.last();
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
    await last.click();
    const lastStudent = page.getByRole('region', { name: 'Batch attendance' }).locator('ol > li').last();
    // The list is still opening (a short height animation) when it first exists: scroll again until it has settled.
    await expect(async () => {
      await lastStudent.scrollIntoViewIfNeeded();
      await expect(lastStudent).toBeInViewport({ timeout: 1_000 });
    }).toPass({ timeout: 10_000 });
  }
});

test('the demo panel never scrolls sideways, with Advanced open, on narrow phones', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  for (const width of [320, 360, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    const panel = page.getByRole('dialog', { name: 'Demo controls' });
    await panel.getByText('Advanced').click();
    await expect(panel.getByRole('radiogroup', { name: 'Location source' })).toBeVisible();
    const overflow = await panel.evaluate((d) => d.scrollWidth - d.clientWidth);
    expect(overflow, `panel at ${width}`).toBeLessThanOrEqual(0);
    const clipped = await panel.evaluate((d) => [...d.querySelectorAll('[role=radiogroup]')].filter((g) => g.scrollWidth > g.clientWidth + 1).map((g) => g.getAttribute('aria-label')));
    expect(clipped, `groups at ${width}`).toEqual([]);
    await page.getByRole('button', { name: 'Close demo controls' }).click();
  }
});

test('on a 320×568 phone the first demo account is above the Continue bar, and the last scrolls into view', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 320, height: 568 });
  await preset(page, 'first_time', /\/login$/);
  const rows = page.getByRole('list', { name: 'Demo accounts' }).getByRole('button');
  await expect(rows).toHaveCount(7);
  const cta = (await page.getByRole('button', { name: 'Continue' }).boundingBox())!;
  // The list scrolls under the Continue bar: the bar has the divider every scrolling screen's footer has (U17).
  const footerBorder = await page.getByRole('button', { name: 'Continue' }).evaluate((b) => getComputedStyle(b.parentElement!).borderTopWidth);
  expect(footerBorder).toBe('1px');
  await expect(rows.first()).toBeInViewport({ ratio: 1 });
  const first = (await rows.first().boundingBox())!;
  expect(first.y + first.height).toBeLessThanOrEqual(cta.y);
  // main is the scroller, above the Continue bar: the last row scrolls fully clear of it.
  const last = rows.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toBeInViewport({ ratio: 1 });
  const box = (await last.boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(cta.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  // The floating Demo trigger sits above the scroller, so a scrolled row (and its chevron) never slides under it.
  const trigger = (await page.getByRole('button', { name: 'Open demo controls' }).boundingBox())!;
  const main = (await page.locator('main').boundingBox())!;
  expect(main.y, 'main starts below the floating trigger').toBeGreaterThanOrEqual(trigger.y + trigger.height);
});

test('every problem inside verification keeps the app header (avatar and close)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  await demo(page, "setSimulation({ location: 'permission_denied' })");
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await expect(page.getByRole('heading', { name: 'Location access is off' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('header').getByRole('button', { name: 'Profile' })).toBeVisible();
  await expect(page.locator('header').getByRole('button', { name: 'Close' })).toBeVisible();
});

test('motion really runs: CSS Modules keyframes resolve (refresh spin, skeleton shimmer, a row opening)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'batch');
  // Real speed, so the refresh lasts long enough to look at.
  await demo(page, 'setSimulation({ speed: 1 })');
  // Refreshing a downloaded list lives on Offline data under Reports (D-071).
  await page.goto('/reports/offline');
  await page.getByRole('button', { name: 'Refresh data for Electrician · Shift 1 · Unit 2' }).click();
  await expect(page.getByText('Refreshing student data…')).toBeVisible();
  expect(await page.evaluate(() => document.getAnimations().length)).toBeGreaterThan(0);
  await expect(page.getByText('Updated just now')).toBeVisible();
  await page.goto('/reports');
  const row = page.getByRole('region', { name: 'My batches' }).getByRole('button', { name: /Shift 1 · Unit 2.*students/ });
  await row.click();
  // The opened panel's animation names a keyframes rule that exists in the page (not a scoped name with no rule).
  const panelId = await row.getAttribute('aria-controls');
  const resolved = await page.evaluate((id) => {
    const names = new Set<string>();
    for (const sheet of [...document.styleSheets]) {
      try {
        const walk = (rules: CSSRuleList) => {
          for (const r of [...rules]) {
            if (r instanceof CSSKeyframesRule) names.add(r.name);
            else if ('cssRules' in r) walk((r as CSSGroupingRule).cssRules);
          }
        };
        walk(sheet.cssRules);
      } catch {
        // cross-origin sheet: not ours
      }
    }
    const name = getComputedStyle(document.getElementById(id ?? '')!).animationName;
    return { name, ok: names.has(name) };
  }, panelId);
  expect(resolved.name).not.toBe('none');
  expect(resolved.ok, `keyframes ${resolved.name}`).toBe(true);
});

/** The shell (the frame around header, scroller and dock) is never scrolled: only main is (D-045, U1). */
async function expectShellInPlace(page: import('@playwright/test').Page, where: string) {
  expect(await page.evaluate(() => document.getElementById('main')!.parentElement!.scrollTop), `${where}: frame scrollTop`).toBe(0);
  expect((await page.locator('header').boundingBox())!.y, `${where}: header top`).toBe(0);
  const viewport = page.viewportSize()!;
  const nav = page.getByRole('navigation', { name: 'Main' });
  if (await nav.count()) {
    const box = (await nav.boundingBox())!;
    expect(box.y + box.height, `${where}: bottom nav bottom`).toBeCloseTo(viewport.height, 0);
  }
}

test('scrolling a section or a row into view moves only main: the header stays on screen and the nav at the bottom (U1)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 360, height: 640 });
  await preset(page, 'principal');
  await page.goto('/reports');
  await expect(page.getByRole('region', { name: 'Staff attendance' }).getByRole('button', { expanded: false })).toHaveCount(18);
  for (const id of ['staff-title', 'more-reports-title']) {
    await page.evaluate((i) => document.getElementById(i)!.scrollIntoView({ block: 'start' }), id);
    await expectShellInPlace(page, `#${id}`);
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }

  // Voice's focus_student scrolls a roster row to the centre: every row has visually hidden text.
  await preset(page, 'batch');
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  const last = page.locator('[data-student]').last();
  await last.evaluate((row) => row.scrollIntoView({ block: 'center' }));
  await expectShellInPlace(page, 'roster');
  await expect(last).toBeInViewport();
});

test('320×568 with the Demo trigger in the header: a task title keeps its two lines, never cut to one word (U6)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 320, height: 568 });
  const notClamped = async (where: string) => {
    const title = page.locator('header h1');
    await expect(title).toBeVisible();
    const { scroll, client } = await title.evaluate((h) => ({ scroll: h.scrollHeight, client: h.clientHeight }));
    expect(scroll, `${where}: the title is not clamped`).toBeLessThanOrEqual(client + 1);
  };
  await preset(page, 'batch');
  await demo(page, "setSimulation({ permissions: { location: 'prompt', camera: 'prompt' } })");
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await expect(page.getByRole('button', { name: 'Allow location' })).toBeVisible({ timeout: 20_000 });
  await notClamped('verification primer');
  await demo(page, "setSimulation({ permissions: { location: 'granted', camera: 'granted' } })");
  await page.goto('/home');
  await page.locator('main').getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  await page.getByRole('combobox', { name: /^Attendance for / }).first().selectOption('absent');
  await page.getByRole('button', { name: 'Review & Submit' }).click();
  await page.waitForURL(/\/attendance\/review/);
  await notClamped('review');
  await preset(page, 'principal');
  const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
  await page.goto(`/attendance/record?s=ele-s1u1.${today}.daily`);
  await page.getByRole('link', { name: /Rahul Kumar/ }).first().click();
  await page.waitForURL(/\/attendance\/correct/);
  await expect(page.locator('header h1')).toHaveText('Correct attendance');
  await notClamped('correction');
});

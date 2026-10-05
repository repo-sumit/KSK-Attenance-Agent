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

test('on a 320×568 phone "Use demo account" is fully above the Continue bar, and its list scrolls into view', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 320, height: 568 });
  await preset(page, 'first_time', /\/login$/);
  const toggle = page.getByRole('button', { name: 'Use demo account' });
  const assist = (await toggle.boundingBox())!;
  const cta = (await page.getByRole('button', { name: 'Continue' }).boundingBox())!;
  expect(assist.y + assist.height).toBeLessThanOrEqual(cta.y - 8);
  // Opening grows the list below the fold: it is brought into view (main is the scroller, above the Continue bar).
  await toggle.click();
  const last = page.getByRole('list', { name: 'Use demo account' }).getByRole('button').last();
  await expect(last).toBeInViewport({ ratio: 1 });
  expect((await last.boundingBox())!.y + (await last.boundingBox())!.height).toBeLessThanOrEqual(cta.y);
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

import { demo, expect, expectNoOverflow, preset, test } from './fixtures';

/** The hidden voice check screen (Task 20) on Chromium's fake audio device. */
test.describe('voice diagnostics', () => {
  test('checks the device, tests the microphone and the speaker, and copies a plain-text report', async ({ page, context }) => {
    await context.grantPermissions(['microphone', 'clipboard-read', 'clipboard-write']);
    await preset(page, 'open');
    await page.goto('/voice/diagnostics');
    await expect(page.getByRole('heading', { name: 'Voice check' })).toBeVisible();
    await expect(page.getByText('This phone can run Voice Agent.', { exact: true })).toBeVisible();
    const checks = page.getByRole('list', { name: 'Checks' });
    await expect(checks.getByText('Pass', { exact: true })).toHaveCount(5);
    await expect(checks.getByText('16000 Hz', { exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Test microphone' }).click();
    const mic = page.getByRole('list', { name: 'Microphone' });
    await expect(mic.getByText('Microphone permission')).toBeVisible();
    await expect(mic.getByText('Microphone processor')).toBeVisible(); // the worklet loaded from /voice/mic-worklet.js
    await expect(mic.getByText('Microphone level')).toBeVisible({ timeout: 15_000 });
    await expect(mic.getByText('Fail', { exact: true })).toHaveCount(0);

    await page.getByRole('button', { name: 'Test speaker' }).click();
    await expect(page.getByRole('list', { name: 'Speaker' }).getByText('Speaker tone')).toBeVisible();

    const report = page.locator('pre');
    await expect(report).toContainText('KSK voice diagnostics');
    await expect(report).toContainText('Android WebView: no');
    await expect(report).toContainText('[PASS] Microphone permission');
    await expect(report).toContainText('[INFO] Speaker tone'); // played, not proven heard (C12)

    await page.getByRole('button', { name: 'Copy report' }).click();
    await expect(page.getByText('Report copied')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('KSK voice diagnostics');
  });

  for (const width of [320, 360]) {
    test(`fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 640 });
      await preset(page, 'open');
      await page.goto('/voice/diagnostics');
      await expect(page.getByRole('heading', { name: 'Voice check' })).toBeVisible();
      await expectNoOverflow(page);
    });
  }

  test('is absent where voice is off: the user is sent home', async ({ page }) => {
    await preset(page, 'principal');
    await demo(page, `setConfig({ voice: { enabled: false } })`);
    await page.goto('/voice/diagnostics');
    await page.waitForURL(/\/(home|attendance)$/);
    await expect(page.getByRole('heading', { name: 'Voice check' })).toHaveCount(0);
  });
});

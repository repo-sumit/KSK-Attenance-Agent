// tests/e2e/voice-pacing.spec.ts
import { demo, expect, preset, test } from './fixtures';

/**
 * The checks pace themselves to the agent (D-148), on the scripted model with its "playing" knob and the demo at real
 * speed: the screen waits for the agent's line before the camera opens and before the list (each wait capped), and a
 * check's [APP] text never goes out while the agent is speaking.
 */
type Page = import('@playwright/test').Page;
const voice = (page: Page, script: string) => page.evaluate(`window.__kskDemo.voice.${script}`);
const appTexts = async (page: Page) => ((await voice(page, 'texts()')) as string[]).filter((t) => t.startsWith('[APP]'));
const opened = (t: string) => /^\[APP\] Trainer opened .+ on screen\./.test(t);

test('the camera opens after the agent\'s line, and the list\'s text waits until the agent is quiet', async ({ page }) => {
  test.slow(); // real speed: about 15 s of checks
  await preset(page, 'open');
  await demo(page, 'setSimulation({ speed: 1 })');
  await page.getByRole('button', { name: 'Voice Agent' }).click();
  await expect(page.getByText('Listening')).toBeVisible();
  await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
  await page.waitForURL(/\/attendance\/trade\?trade=ele/);
  await voice(page, `emit({ turnComplete: true })`);

  // The agent starts its check line as the gateway opens, and is still speaking after the 1.5 s "Location verified" hold.
  await voice(page, 'playing(true)');
  await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
  await expect(page.getByText('Location verified')).toBeVisible();
  await page.waitForTimeout(2000);
  await expect(page.getByText('Location verified')).toBeVisible();
  await expect(page.getByText('Look at the camera')).toHaveCount(0);

  // The line ends: the camera opens within moments, long before the waits' caps (3 s + 4 s).
  await voice(page, 'playing(false)');
  await voice(page, `emit({ turnComplete: true })`);
  await expect(page.getByText('Look at the camera')).toBeVisible({ timeout: 2000 });
  // While the camera holds the mic the card says so, with no Pause and no level bar; Stop voice stays (D-148).
  const card = page.getByRole('region', { name: 'Voice Agent' });
  await expect(card.getByText('Mic off for face check')).toBeVisible();
  await expect(card.getByText('Listening')).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Pause voice' })).toHaveCount(0);
  await expect(card.getByRole('button', { name: 'Stop voice' })).toBeVisible();
  await expect.poll(async () => (await appTexts(page)).some((t) => t.startsWith('[APP] The face camera is open.'))).toBe(true);

  // At "Identity verified" the agent speaks again: the screen still moves on at its cap, but the list's text waits for the agent.
  await expect(page.getByText('Identity verified')).toBeVisible();
  await voice(page, 'playing(true)');
  await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2/, { timeout: 10_000 });
  await page.waitForTimeout(1000);
  expect((await appTexts(page)).some(opened)).toBe(false);
  await voice(page, 'playing(false)');
  await expect.poll(async () => (await appTexts(page)).some(opened), { timeout: 2000 }).toBe(true);
});

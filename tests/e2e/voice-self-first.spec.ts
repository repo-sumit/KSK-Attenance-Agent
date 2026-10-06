// tests/e2e/voice-self-first.spec.ts
import { expect, preset, test } from './fixtures';

/**
 * Voice Agent with Maharashtra's default (D-152) on the scripted model: own attendance first, then the self-pass
 * reuse. Every other voice spec runs with the rule off (the fixture's default), so this is the one E2E that drives the
 * kickoff's ask, the refused batch, mark_my_attendance on My attendance and the next batch without a second check.
 */
test.use({ selfFirst: true });

type Page = import('@playwright/test').Page;
const voice = (page: Page, script: string) => page.evaluate(`window.__kskDemo.voice.${script}`);
const appTexts = async (page: Page) => ((await voice(page, 'texts()')) as string[]).filter((t) => t.startsWith('[APP]'));
const cameraOpened = (texts: string[]) => texts.filter((t) => t.startsWith('[APP] The face camera is open.')).length;

test('own attendance first by voice: the ask, a refused batch, the self mark, then the next batch with no second check', async ({ page }) => {
  await preset(page, 'open'); // Rajesh Patil: not self-marked in the seed
  await page.getByRole('button', { name: 'Voice Agent' }).click();
  await expect(page.getByText('Listening')).toBeVisible();
  // The kickoff greets and asks for own attendance first, as the rule requires.
  await expect.poll(async () => ((await voice(page, 'texts()')) as string[]).length).toBeGreaterThan(0);
  const kickoff = ((await voice(page, 'texts()')) as string[])[0];
  expect(kickoff).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today; it must be marked before any student attendance\./);
  expect(kickoff).toContain('Please mark your attendance first. Shall I start?');

  // A batch before the self mark is refused and nothing opens: no class check runs.
  expect(await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`)).toMatchObject({ ok: false, error: 'SELF_FIRST' });
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'Verify your presence' })).toHaveCount(0);

  // On yes: My attendance runs its own check (its camera step reaches the model once), and the pass marks it.
  const asked = (await voice(page, `toolCall('mark_my_attendance')`)) as { ok: boolean; step: string };
  expect(asked).toMatchObject({ ok: true, step: 'VERIFY' });
  await voice(page, `emit({ turnComplete: true })`);
  await page.waitForURL(/\/me\/attendance$/);
  await expect(page.getByRole('heading', { name: 'Attendance marked' })).toBeVisible();
  await expect.poll(async () => (await appTexts(page)).some((t) => t.startsWith("[APP] The check passed and the trainer's own attendance is marked present at"))).toBe(true);
  expect(cameraOpened(await appTexts(page))).toBe(1);

  // The next batch, within the reuse window: Rajesh picks the trade first (his account has a trade step), then the
  // batch opens straight on the list, with no second camera check.
  await voice(page, `emit({ turnComplete: true })`);
  expect(await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`)).toMatchObject({ ok: true });
  expect(await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`)).toMatchObject({ ok: true });
  await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2/);
  await expect(page.locator('[data-student] select').first()).toBeVisible();
  expect(cameraOpened(await appTexts(page))).toBe(1);
  await expect(page.getByText('Listening')).toBeVisible(); // voice keeps running
});

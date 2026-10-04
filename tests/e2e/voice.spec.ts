// tests/e2e/voice.spec.ts
import { demo, expect, expectNoOverflow, nav, openProfileMenu, preset, test } from './fixtures';

const voice = (page: import('@playwright/test').Page, script: string) => page.evaluate(`window.__kskDemo.voice.${script}`);

/** Every [APP] text the scripted model has received so far. */
const appTexts = async (page: import('@playwright/test').Page) => ((await voice(page, 'texts()')) as string[]).filter((t) => t.startsWith('[APP]'));

test.describe('voice mode (scripted model)', () => {
  test('voice chooses, verifies, marks by exception and submits; a tap reaches the model', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await preset(page, 'open');
    await page.getByRole('button', { name: 'Voice mode' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    expect(((await voice(page, 'texts()')) as string[])[0]).toMatch(/^\[APP\] Session started/);

    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2/); // simulated location + simulated camera pass
    await expect.poll(async () => ((await voice(page, 'texts()')) as string[]).some((t) => t.startsWith('[APP]') && /present/i.test(t))).toBe(true);

    // The verification screen reported to the model (useVerification → VerificationService events → session):
    // the face camera opened, then the pass opened the batch. Location inside says nothing (PRD 8.4).
    await expect
      .poll(async () => {
        const texts = await appTexts(page);
        const camera = texts.findIndex((t) => t.startsWith('[APP] The face camera is open.'));
        const opened = texts.findIndex((t) => /^\[APP\] Trainer opened .+ on screen\./.test(t));
        return camera >= 0 && opened > camera;
      })
      .toBe(true);
    expect((await appTexts(page)).some((t) => t.startsWith('[APP] Location check failed'))).toBe(false);

    await voice(page, `toolCall('set_student_status', { student: 'Aditi', status: 'ABSENT', heard: 'Aditi absent' })`);
    await expect(page.locator('[data-student] select').first()).toBeVisible();
    // the Aditi row shows Absent
    const aditi = page.locator('[data-student]').filter({ hasText: 'Aditi' }).locator('select');
    await expect(aditi).toHaveValue('absent');

    // a tap during voice is reported to the model
    const aarav = page.locator('[data-student]').filter({ hasText: 'Aarav' }).locator('select');
    await aarav.selectOption('absent');
    await expect.poll(async () => ((await voice(page, 'texts()')) as string[]).at(-1)).toMatch(/Trainer tapped ABSENT/);

    const ask = (await voice(page, `toolCall('submit_attendance')`)) as { error: string; confirm_token: string };
    expect(ask.error).toBe('NEEDS_CONFIRMATION');
    await page.waitForURL(/\/attendance\/review\?s=/);
    // the model's asking turn ends, then the trainer answers: a code counts only after that (D-082)
    await voice(page, `emit({ turnComplete: true })`);
    await voice(page, `speak('haan')`);
    const done = (await voice(page, `toolCall('submit_attendance', { confirm_token: '${ask.confirm_token}' })`)) as { ok: boolean };
    expect(done.ok).toBe(true);
    await page.waitForURL(/\/attendance\/submitted\?s=/);
    // What was submitted, not only that a submit happened: the voice mark and the tap made during voice are both in it.
    await expect(page.getByRole('heading', { name: 'Attendance submitted' })).toBeVisible();
    await expect(page.getByText('29 Present · 2 Absent')).toBeVisible();
    await page.goto(page.url().replace('/submitted', '/record'));
    await page.waitForURL(/\/attendance\/record\?s=ele-s1u2/);
    const recorded = (name: string) => page.locator('main ol > li').filter({ hasText: name });
    await expect(recorded('Aditi')).toContainText('Absent');
    await expect(recorded('Aarav')).toContainText('Absent');
    await expect(page.locator('main ol > li').filter({ hasText: 'Absent' })).toHaveCount(2);
  });

  test('a face that does not match is told to the model, and the screen offers the retry', async ({ page }) => {
    await preset(page, 'open');
    await demo(page, `setSimulation({ face: 'no_match' })`);
    await page.getByRole('button', { name: 'Voice mode' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await expect.poll(async () => (await appTexts(page)).some((t) => t.startsWith('[APP] Face check failed: the face did not match.'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(page.url()).not.toMatch(/\/attendance\/mark\?/);
  });

  test('Use screen pauses and Resume continues; Stop voice keeps the marks', async ({ page }) => {
    await preset(page, 'open');
    await page.getByRole('button', { name: 'Voice mode' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2/);
    const row = (name: string) => page.locator('[data-student]').filter({ hasText: name }).locator('select');
    await voice(page, `toolCall('set_student_status', { student: 'Aditi', status: 'ABSENT', heard: 'Aditi absent' })`);
    await expect(row('Aditi')).toHaveValue('absent');
    await row('Aarav').selectOption('absent'); // a tap, the other way a mark gets in

    await page.getByRole('button', { name: 'Use screen' }).click();
    await expect(page.getByText('Paused')).toBeVisible();
    await page.getByRole('button', { name: 'Resume voice' }).click();
    await expect(page.getByText('Listening')).toBeVisible();

    await page.getByRole('button', { name: 'Stop voice' }).click();
    await expect(page.getByRole('button', { name: 'Stop voice' })).toHaveCount(0);
    // Focus is not dropped to the page, and the end is announced (m14).
    await expect(page.locator('main#main')).toBeFocused();
    await expect(page.locator('[data-voice-announce="status"]')).toHaveText('Voice ended');
    // The marks are the trainer's, not voice's: they are still on the rows, and the draft on the device still holds them.
    await expect(page).toHaveURL(/\/attendance\/mark\?s=ele-s1u2/);
    await expect(row('Aditi')).toHaveValue('absent');
    await expect(row('Aarav')).toHaveValue('absent');
    await page.reload();
    await expect(row('Aditi')).toHaveValue('absent');
    await expect(row('Aarav')).toHaveValue('absent');
  });

  test('a blocked microphone explains itself and leaves the screen usable', async ({ page }) => {
    await preset(page, 'open');
    await voice(page, `denyMic('permission_denied')`);
    await page.getByRole('button', { name: 'Voice mode' }).click();
    // Shown in the dock, and read once from the provider's alert (C8), which is not part of the dock.
    await expect(page.locator('[data-error="mic_denied"]')).toHaveText('Microphone is blocked. Allow it in settings, or use the screen.');
    await expect(page.locator('[data-voice-announce="error"]')).toHaveText('Microphone is blocked. Allow it in settings, or use the screen.');
    await expect(page.getByRole('heading', { name: /today/i }).first()).toBeVisible();
  });

  test('a configuration change stops voice (Review Focus 2)', async ({ page }) => {
    await preset(page, 'open');
    await page.getByRole('button', { name: 'Voice mode' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await page.evaluate(`window.__kskDemo.setConfig({ voice: { enabled: false } })`);
    await expect(page.getByRole('button', { name: 'Stop voice' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Voice mode' })).toHaveCount(0);
  });

  test('the demo panel picks the voice model (presets keep it) and switches Voice mode off', async ({ page }) => {
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ksk-demo:v1:state') ?? '{}') as { presetId?: string | null; simulation?: { voice?: string } });
    const voiceModel = async () => (await stored()).simulation?.voice;
    const presetId = async () => (await stored()).presetId;
    await preset(page, 'open');
    const panel = page.getByRole('dialog', { name: 'Demo controls' });
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    await panel.getByText('Advanced').click();
    const model = panel.getByLabel('Voice model');
    await expect(model).toHaveValue('scripted'); // not the default ('live'): only a choice that survives the preset can still read 'scripted'
    expect(await voiceModel()).toBe('scripted');
    await panel.getByRole('button', { name: /Batch mapped/ }).click();
    // Wait on what the preset really changes (its story is stored first), not on /home, where the page already is.
    await expect.poll(presetId).toBe('batch');
    await page.waitForURL(/\/home$/);
    expect(await voiceModel()).toBe('scripted');

    // Choosing the other model also holds across the next preset.
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    await panel.getByText('Advanced').click();
    await model.selectOption('live');
    expect(await voiceModel()).toBe('live');
    await panel.getByRole('button', { name: /Open instructor Any trade/ }).click();
    await expect.poll(presetId).toBe('open');
    expect(await voiceModel()).toBe('live');

    await page.getByRole('button', { name: 'Open demo controls' }).click();
    await panel.getByText('Advanced').click();
    await panel.getByLabel('Voice model').selectOption('scripted');
    await panel.getByRole('radiogroup', { name: 'Voice mode' }).getByRole('radio', { name: 'Off' }).click();
    await expect(panel.getByLabel('Voice model')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close demo controls' }).click();
    await expect(page.getByRole('button', { name: 'Voice mode' })).toHaveCount(0);
  });

  test.describe('a demo state stored before voice mode', () => {
    /** What a browser kept from before Task 19: a preset's configuration without `voice`, and no presets version. */
    async function storePreVoiceState(page: import('@playwright/test').Page, presetId: string | null) {
      await page.evaluate((id) => {
        const key = 'ksk-demo:v1:state';
        const state = JSON.parse(localStorage.getItem(key) ?? '{}') as Record<string, unknown>;
        delete state.presetsVersion;
        state.presetId = id;
        state.config = { verification: { geoMode: 'fencing', face: true }, marking: { defaultStatus: 'present' } };
        localStorage.setItem(key, JSON.stringify(state));
      }, presetId);
    }

    test('the stored preset is refreshed on the next load, so Voice mode appears (the persona stays signed in)', async ({ page }) => {
      await preset(page, 'open');
      await storePreVoiceState(page, 'open');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Voice mode' })).toBeVisible();
      await page.getByRole('button', { name: 'Voice mode' }).click();
      await expect(page.getByText('Listening')).toBeVisible();
    });

    test('the presenter\'s own panel changes (no preset) are left alone', async ({ page }) => {
      await preset(page, 'open');
      await storePreVoiceState(page, null);
      await page.reload();
      await expect(page.getByRole('heading', { name: /today/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Voice mode' })).toHaveCount(0);
    });
  });

  test('Marathi at 320×568: the compact voice card stays one row and one line (≤ 88 px) with push-to-talk on and with minutes left', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await preset(page, 'open');
    await openProfileMenu(page).then((menu) => menu.getByRole('radio', { name: 'मराठी' }).click());
    await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
    await page.keyboard.press('Escape');
    // Under three minutes left: the warning takes the caption line (set before voice starts; a config change stops voice).
    await demo(page, `setConfig({ voice: { enabled: true, maxMinutesPerSession: 2 } })`);
    await page.getByRole('button', { name: 'व्हॉइस मोड' }).click();
    const dock = page.locator('section[data-voice-status="listening"]');
    await expect(dock).toBeVisible();
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2/);
    const height = async () => (await dock.boundingBox())!.height;
    await expect(dock.getByText('2 मिनिटे व्हॉइस वेळ बाकी')).toBeVisible();
    expect(await height()).toBeLessThanOrEqual(88);

    await dock.locator('button[aria-expanded]').click();
    await dock.getByRole('button', { name: 'दाबून बोला' }).click();
    await dock.locator('button[aria-expanded]').click();
    await expect(dock.getByRole('button', { name: 'बोलताना दाबून ठेवा' })).toBeVisible(); // Hold to talk, in the closed row
    // The push-to-talk status is one line beside it, not two (C7).
    const status = dock.locator('[data-icon] > span').first();
    const lines = await status.evaluate((el) => el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight));
    expect(lines).toBeLessThan(1.5);
    expect(await height()).toBeLessThanOrEqual(88);
    await expectNoOverflow(page);
  });

  for (const width of [320, 1280]) {
    test(`the voice card fits at ${width}px`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await preset(page, 'open');
      await page.getByRole('button', { name: 'Voice mode' }).click();
      await expect(page.getByText('Listening')).toBeVisible();
      await expectNoOverflow(page);
    });
  }
});

test.describe('the floating voice button (D-133)', () => {
  const fab = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Voice mode' });
  const toRoster = async (page: import('@playwright/test').Page) => {
    await page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ }).click();
    await page.getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
    await page.waitForURL(/\/attendance\/mark/);
  };

  test('sits at the bottom-right on Home, Reports and the roster for an instructor', async ({ page }) => {
    await preset(page, 'open');
    const corner = async (where: string) => {
      await expect(fab(page), where).toBeVisible();
      const viewport = page.viewportSize()!;
      const box = (await fab(page).boundingBox())!;
      expect(viewport.width - (box.x + box.width), `${where}: right margin`).toBeLessThanOrEqual(24);
      expect(box.y, `${where}: bottom half`).toBeGreaterThan(viewport.height / 2);
    };
    await corner('Home');
    await nav(page, 'Reports').click();
    await page.waitForURL(/\/reports/);
    await corner('Reports');
    await nav(page, 'Home').click();
    await page.waitForURL(/\/home$/);
    await toRoster(page);
    await corner('roster');
  });

  test('is not there for the principal, nor on the login screen', async ({ page }) => {
    await preset(page, 'principal');
    await expect(page.locator('main#main')).toBeVisible();
    await expect(fab(page)).toHaveCount(0);
    await page.goto('/login');
    await expect(page.locator('main#main')).toBeVisible();
    await expect(fab(page)).toHaveCount(0);
  });

  test('at 320×568 on the roster: the last row scrolls clear of the button, and the open card covers no row and not Review & Submit', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await preset(page, 'open');
    await toRoster(page);
    const main = page.locator('main#main');
    // The button overlays the list's bottom-right corner: the list keeps room to scroll its last row above it.
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    await expect
      .poll(async () => {
        const row = (await page.locator('[data-student]').last().boundingBox())!;
        const button = (await fab(page).boundingBox())!;
        return row.y + row.height <= button.y + 1;
      })
      .toBe(true);
    // The card sits in the band above the footer: below the list, above Review & Submit, one row and one line.
    await fab(page).click();
    const card = page.locator('section[data-voice-status]');
    await expect(card).toBeVisible();
    await expect
      .poll(async () => {
        const c = (await card.boundingBox())!;
        const m = (await main.boundingBox())!;
        const cta = (await page.getByRole('button', { name: 'Review & Submit' }).boundingBox())!;
        return c.y >= m.y + m.height - 1 && c.y + c.height <= cta.y + 1 && c.height <= 88;
      })
      .toBe(true);
    await expectNoOverflow(page);
  });

  test('minimize keeps voice running behind a round status button, and a tap opens the card again', async ({ page }) => {
    await preset(page, 'open');
    await fab(page).click();
    const card = page.locator('section[data-voice-status="listening"]');
    await expect(card).toBeVisible();
    await page.getByRole('button', { name: 'Minimize voice controls' }).click();
    await expect(card).toHaveCount(0);
    const mini = page.getByRole('button', { name: 'Listening' });
    await expect(mini).toBeVisible();
    // Voice is still on: the agent can still act.
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await expect(page.getByRole('button', { name: 'Listening' })).toBeVisible(); // still minimized after navigating
    await page.getByRole('button', { name: 'Listening' }).click();
    await expect(card).toBeVisible();
  });
});

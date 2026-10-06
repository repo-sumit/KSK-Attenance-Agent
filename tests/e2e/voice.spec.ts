// tests/e2e/voice.spec.ts
import { demo, expect, expectNoOverflow, nav, openProfileMenu, preset, test } from './fixtures';

const voice = (page: import('@playwright/test').Page, script: string) => page.evaluate(`window.__kskDemo.voice.${script}`);

/** Every [APP] text the scripted model has received so far. */
const appTexts = async (page: import('@playwright/test').Page) => ((await voice(page, 'texts()')) as string[]).filter((t) => t.startsWith('[APP]'));

test.describe('Voice Agent (scripted model)', () => {
  test('voice chooses, verifies, marks by exception and submits; a tap reaches the model', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await preset(page, 'open');
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    // Rajesh's own attendance is not marked in the seed: the first turn greets him and asks for it first (D-152)
    expect(((await voice(page, 'texts()')) as string[])[0]).toMatch(/^\[APP\] Session started\. The trainer's own attendance is not marked today\. Say exactly: "Hi Rajesh, good (morning|afternoon|evening|night)\." Then say in one short line, in Indian English: "Please mark your attendance first\. Shall I start\?"/);

    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await voice(page, `emit({ turnComplete: true })`); // the agent said its check line: the camera text waits for that (D-148)
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

  test('Employability Skills at the demo clock: the kickoff names only the batches open now, never a later one (D-134)', async ({ page }) => {
    // Meera Kulkarni at 10:15: three Shift 1 batches are open; Electrician Shift 2 Unit 3 and Welder Shift 2 Unit 2 open at 2:00 pm
    await preset(page, 'es');
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    await expect.poll(async () => ((await voice(page, 'texts()')) as string[]).length).toBeGreaterThan(0);
    const kickoff = ((await voice(page, 'texts()')) as string[])[0];
    // the greeting follows the presenter's real time of day (D-151)
    expect(kickoff).toMatch(/^\[APP\] Session started\. Say exactly: "Hi Meera, good (morning|afternoon|evening|night)\." Then: Read only the batches open now, /);
    expect(kickoff).toContain(': Shift 1, Unit 1, Electrician; Shift 1, Unit 2, Fitter; Shift 1, Unit 1, COPA. Do not mention any other batch.');
    expect(kickoff).toContain('Their ids for select_batch: ');
    expect(kickoff).not.toMatch(/Shift 2|Welder|2:00|opens at|submitted/);
    await expect(page).toHaveURL(/\/home$/); // several open: nothing is opened before the trainer picks one
  });

  test('Batch mapped at the demo clock: the only open batch is opened at once, then checked and listed (D-134)', async ({ page }) => {
    // Sunita Jadhav at 10:15: Electrician Shift 1 Unit 2 is open; Shift 2 Unit 2 opens at 2:00 pm
    await preset(page, 'batch');
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2\./); // the gateway's simulated location and camera pass
    const texts = (await voice(page, 'texts()')) as string[];
    expect(texts[0]).toMatch(/^\[APP\] Session started\. Only Shift 1, Unit 2, Electrician can be marked now, so the app opened it: do not call select_batch for it\. Say exactly: "Hi Sunita, good (morning|afternoon|evening|night)\." Then: Before the student list/);
    expect(texts[0]).not.toMatch(/Shift 2|2:00/);
    await expect.poll(async () => (await appTexts(page)).some((t) => /^\[APP\] Trainer opened Shift 1, Unit 2, Electrician on screen\./.test(t))).toBe(true);
  });

  test('a face that does not match is told to the model, and the screen offers the retry', async ({ page }) => {
    await preset(page, 'open');
    await demo(page, `setSimulation({ face: 'no_match' })`);
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await expect.poll(async () => (await appTexts(page)).some((t) => t.startsWith('[APP] Face check failed: the face did not match.'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(page.url()).not.toMatch(/\/attendance\/mark\?/);
  });

  test('Pause pauses and Resume continues; Stop voice keeps the marks', async ({ page }) => {
    await preset(page, 'open');
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await voice(page, `toolCall('select_batch', { batch: 'shift 1 unit 2' })`);
    await page.waitForURL(/\/attendance\/mark\?s=ele-s1u2/);
    const row = (name: string) => page.locator('[data-student]').filter({ hasText: name }).locator('select');
    await voice(page, `toolCall('set_student_status', { student: 'Aditi', status: 'ABSENT', heard: 'Aditi absent' })`);
    await expect(row('Aditi')).toHaveValue('absent');
    await row('Aarav').selectOption('absent'); // a tap, the other way a mark gets in

    await page.getByRole('button', { name: 'Pause voice' }).click();
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
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    // Shown in the dock, and read once from the provider's alert (C8), which is not part of the dock.
    await expect(page.locator('[data-error="mic_denied"]')).toHaveText('Microphone is blocked. Allow it in settings, or use the screen.');
    await expect(page.locator('[data-voice-announce="error"]')).toHaveText('Microphone is blocked. Allow it in settings, or use the screen.');
    await expect(page.getByRole('heading', { name: /today/i }).first()).toBeVisible();
  });

  test('a configuration change stops voice (Review Focus 2)', async ({ page }) => {
    await preset(page, 'open');
    await page.getByRole('button', { name: 'Voice Agent' }).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await page.evaluate(`window.__kskDemo.setConfig({ voice: { enabled: false } })`);
    await expect(page.getByRole('button', { name: 'Stop voice' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Voice Agent' })).toHaveCount(0);
  });

  test('the demo panel picks the voice model in Quick settings (presets keep it) and switches Voice Agent off', async ({ page }) => {
    const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('ksk-demo:v1:state') ?? '{}') as { presetId?: string | null; simulation?: { voice?: string } });
    const voiceModel = async () => (await stored()).simulation?.voice;
    const presetId = async () => (await stored()).presetId;
    await preset(page, 'open');
    const panel = page.getByRole('dialog', { name: 'Demo controls' });
    const quick = panel.getByRole('region', { name: 'Quick settings' });
    const model = quick.getByRole('radiogroup', { name: 'Voice model' });
    const people = panel.getByRole('list', { name: 'Sign in as' });
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    // Quick settings are open: no Advanced to expand.
    await expect(model.getByRole('radio', { name: 'Scripted' })).toHaveAttribute('aria-checked', 'true'); // not the default ('live'): only a choice that survives the preset can still read 'scripted'
    await expect(quick.getByText('Scripted (no mic, no network)')).toBeVisible();
    expect(await voiceModel()).toBe('scripted');
    await people.getByRole('button', { name: /^Batch-mapped instructor/ }).click();
    // Wait on what the preset really changes (its story is stored first), not on /home, where the page already is.
    await expect.poll(presetId).toBe('batch');
    await page.waitForURL(/\/home$/);
    expect(await voiceModel()).toBe('scripted');

    // Choosing the other model also holds across the next preset.
    await page.getByRole('button', { name: 'Open demo controls' }).click();
    await model.getByRole('radio', { name: 'Live' }).click();
    await expect(quick.getByText('Scripted (no mic, no network)')).toHaveCount(0);
    expect(await voiceModel()).toBe('live');
    await people.getByRole('button', { name: /^Open instructor/ }).click();
    await expect.poll(presetId).toBe('open');
    expect(await voiceModel()).toBe('live');

    await page.getByRole('button', { name: 'Open demo controls' }).click();
    await model.getByRole('radio', { name: 'Scripted' }).click();
    await quick.getByRole('radiogroup', { name: 'Voice Agent' }).getByRole('radio', { name: 'Off' }).click();
    await expect(model).toHaveCount(0);
    await page.getByRole('button', { name: 'Close demo controls' }).click();
    await expect(page.getByRole('button', { name: 'Voice Agent' })).toHaveCount(0);
  });

  test.describe('a demo state stored before Voice Agent', () => {
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

    test('the stored preset is refreshed on the next load, so Voice Agent appears (the persona stays signed in)', async ({ page }) => {
      await preset(page, 'open');
      await storePreVoiceState(page, 'open');
      await page.reload();
      await expect(page.getByRole('button', { name: 'Voice Agent' })).toBeVisible();
      await page.getByRole('button', { name: 'Voice Agent' }).click();
      await expect(page.getByText('Listening')).toBeVisible();
    });

    test('the presenter\'s own panel changes (no preset) are left alone', async ({ page }) => {
      await preset(page, 'open');
      await storePreVoiceState(page, null);
      await page.reload();
      await expect(page.getByRole('heading', { name: /today/i }).first()).toBeVisible();
      await expect(page.getByRole('button', { name: 'Voice Agent' })).toHaveCount(0);
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
    await page.getByRole('button', { name: 'व्हॉइस एजंट' }).click();
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
      await page.getByRole('button', { name: 'Voice Agent' }).click();
      await expect(page.getByText('Listening')).toBeVisible();
      await expectNoOverflow(page);
    });
  }
});

type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

/** A box measured once it has stopped moving (the widget's bottom glides over --motion-base when a footer comes or goes). */
async function settled(locator: import('@playwright/test').Locator): Promise<Box> {
  await expect(locator).toBeVisible();
  let previous = await locator.boundingBox();
  await expect
    .poll(async () => {
      await locator.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(undefined)))));
      const next = await locator.boundingBox();
      const same = JSON.stringify(next) === JSON.stringify(previous);
      previous = next;
      return same;
    })
    .toBe(true);
  return previous!;
}

test.describe('the floating voice button (D-133, D-147)', () => {
  const fab = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'Voice Agent' });
  /** The one floating element (button, mini button or card), portaled to <body>. */
  const widget = (page: import('@playwright/test').Page) => page.locator('body > div[data-voice-float]');
  /** Opens Electrician Shift 1 · Unit 2 from Home (its check starts). */
  const toRosterStart = async (page: import('@playwright/test').Page) => {
    await page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ }).click();
    await page.getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  };
  const toRoster = async (page: import('@playwright/test').Page) => {
    await toRosterStart(page);
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

  test('the principal has the voice button; the scripted kickoff greets "Principal", says today\'s state with the staff not marked and asks "How can I help?" (D-139, D-156)', async ({ page }) => {
    await preset(page, 'principal');
    await expect(fab(page)).toBeVisible();
    await fab(page).click();
    await expect(page.getByText('Listening')).toBeVisible();
    const kickoff = ((await voice(page, 'texts()')) as string[])[0];
    // the kickoff suggests staff, the principal included as "you" (D-156)
    expect(kickoff).toMatch(/^\[APP\] Session started\. Today: \d+ of \d+ batches submitted, \d+ staff not marked yet, the principal included\. Say exactly: "Good (morning|afternoon|evening|night), Principal\." Then say today's state in one line, in Indian English \(for example "\d+ of \d+ batches are in; \d+ staff haven't marked yet, including you\."\), then ask "How can I help\?"\. Then wait\.$/);
    expect(kickoff).not.toMatch(/end_voice_session|select_batch/);
    // "open staff attendance": the screen follows the bus
    expect(await voice(page, `toolCall('navigate', { to: 'staff_attendance' })`)).toMatchObject({ ok: true });
    await page.waitForURL(/\/attendance\/staff$/);
    await expect(page.getByText('Listening')).toBeVisible(); // voice keeps running across the navigation
  });

  test('voice opens today\'s notices: Home, then the sheet', async ({ page }) => {
    await preset(page, 'principal');
    await fab(page).click();
    await expect(page.getByText('Listening')).toBeVisible();
    await voice(page, `toolCall('navigate', { to: 'reports' })`);
    await page.waitForURL(/\/reports$/);
    const notices = (await voice(page, `toolCall('get_announcements')`)) as { ok: boolean; notices: { title: string }[] };
    expect(notices.ok).toBe(true);
    expect(notices.notices[0].title).toBe('Special holiday: institute closed');
    await voice(page, `toolCall('navigate', { to: 'announcements' })`);
    await page.waitForURL(/\/home$/);
    await expect(page.getByRole('dialog', { name: 'Announcements' })).toBeVisible();
  });

  test('is not there on the login screen', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('main#main')).toBeVisible();
    await expect(fab(page)).toHaveCount(0);
  });

  test('at 320×568 on the roster: one row of at most 88px above Review & Submit, no band (main keeps its height), and the last row scrolls clear of it', async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await preset(page, 'open');
    await toRoster(page);
    const main = page.locator('main#main');
    const lastRowClears = async (float: Box) => {
      await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
      const row = (await page.locator('[data-student]').last().boundingBox())!;
      return row.y + row.height <= float.y + 1;
    };
    // The button overlays the list's bottom-right corner: the list keeps room to scroll its last row above it.
    await expect.poll(async () => lastRowClears(await settled(fab(page)))).toBe(true);
    const before = (await main.boundingBox())!;
    // The card is an overlay at the same corner: one row, above Review & Submit, and main keeps its box.
    await fab(page).click();
    const card = page.locator('section[data-voice-status]');
    await expect(card).toBeVisible();
    const c = await settled(card);
    const cta = (await page.getByRole('button', { name: 'Review & Submit' }).boundingBox())!;
    expect(c.height).toBeLessThanOrEqual(88);
    expect(intersects(c, cta)).toBe(false);
    expect(c.y + c.height).toBeLessThanOrEqual(cta.y);
    expect(await main.boundingBox()).toEqual(before);
    await expect.poll(async () => lastRowClears(await settled(card))).toBe(true);
    await expectNoOverflow(page);
  });

  test('at 1280×800 the widget sits at the same viewport x on every screen, and at the corner on the camera primer (D-147)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await preset(page, 'open');
    const edges: Record<string, number> = {};
    const measure = async (where: string) => {
      const b = await settled(widget(page));
      edges[where] = b.x + b.width;
      return b;
    };
    await measure('Home (wide)');
    await nav(page, 'Reports').click();
    await page.waitForURL(/\/reports$/);
    await measure('Reports (reading)');
    await page.goto('/me/attendance');
    await expect(page.getByRole('heading', { name: 'My attendance' }).first()).toBeVisible();
    await measure('My attendance (form)');
    // The verification camera primer: an inline-footer screen (its dock follows the content mid-page).
    await demo(page, `setSimulation({ permissions: { location: 'granted', camera: 'prompt' } })`);
    await page.goto('/home');
    await toRosterStart(page);
    await expect(page.getByRole('button', { name: 'Allow camera' })).toBeVisible();
    await fab(page).click();
    const card = page.locator('section[data-voice-status]');
    await expect(card).toBeVisible();
    const c = await measure('camera primer (card)');
    expect(c.y, 'the card sits at the corner, not mid-page').toBeGreaterThan(400);
    const gap = 800 - (c.y + c.height);
    expect(gap >= 23 && gap <= 25, `the card is 24px above the bottom edge (${gap})`).toBe(true);
    for (const name of ['Allow camera', 'Not now']) {
      const control = page.getByRole('button', { name });
      if (await control.count()) expect(intersects(c, (await control.boundingBox())!), name).toBe(false);
    }
    expect(intersects(c, (await page.getByRole('heading', { name: 'Camera required' }).boundingBox())!)).toBe(false);
    // A short laptop window: the inline footer ends near the bottom edge, and the card still keeps the corner.
    await page.setViewportSize({ width: 1280, height: 688 });
    const short = await settled(card);
    expect(Math.abs(688 - (short.y + short.height) - 24), 'at 1280×688 the card is 24px above the bottom edge').toBeLessThanOrEqual(1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await settled(card);
    // The check passes and the roster opens: the card stays at the same corner, above the footer band.
    await page.getByRole('button', { name: 'Allow camera' }).click();
    await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
    const r = await measure('roster (reading, footer; card)');
    const cta = (await page.getByRole('button', { name: 'Review & Submit' }).boundingBox())!;
    expect(intersects(r, cta)).toBe(false);
    // The open demo drawer (the demo panel sets html[data-demo-drawer] from 600px): the widget moves left of it.
    await page.evaluate(() => document.documentElement.setAttribute('data-demo-drawer', ''));
    const shifted = await settled(widget(page));
    expect(Math.abs(1280 - (shifted.x + shifted.width) - (380 + 24)), 'left of the 380px drawer').toBeLessThanOrEqual(1);
    await page.evaluate(() => document.documentElement.removeAttribute('data-demo-drawer'));
    const [first, ...rest] = Object.values(edges);
    for (const [where, edge] of Object.entries(edges)) expect(Math.abs(edge - first), `${where}: right edge ${edge} vs ${first}`).toBeLessThanOrEqual(1);
    expect(rest.length).toBe(4);
    expect(Math.abs(first - (1280 - 24)), 'the corner: 24px from the right edge').toBeLessThanOrEqual(1);
  });

  test('at 768 wide on the camera primer, a window just taller than the content: the card never covers Allow camera, main keeps its box, and the content scrolls clear of the card (D-147)', async ({ page }) => {
    await page.setViewportSize({ width: 768, height: 1024 });
    await preset(page, 'open');
    await demo(page, `setSimulation({ permissions: { location: 'granted', camera: 'prompt' } })`);
    await toRosterStart(page);
    const allow = page.getByRole('button', { name: 'Allow camera' });
    await expect(allow).toBeVisible();
    // The inline footer follows the content: size the window so the footer ends 120px above the bottom edge (inside
    // the band where a fixed resting zone took it for "not pinned" while the open card still reached it).
    const dockBottom = await allow.evaluate((el) => el.closest('main ~ div')!.getBoundingClientRect().bottom);
    await page.setViewportSize({ width: 768, height: Math.ceil(dockBottom) + 120 });
    const main = page.locator('main#main');
    const controls = async () => {
      const boxes: Box[] = [];
      for (const name of ['Allow camera', 'Not now']) {
        const control = page.getByRole('button', { name });
        if (await control.count()) boxes.push((await control.boundingBox())!);
      }
      return boxes;
    };
    const b = await settled(fab(page));
    for (const control of await controls()) expect(intersects(b, control), 'the button covers no footer action').toBe(false);
    const before = (await main.boundingBox())!;
    await fab(page).click();
    const card = page.locator('section[data-voice-status]');
    const c = await settled(card);
    for (const control of await controls()) expect(intersects(c, control), 'the card covers no footer action').toBe(false);
    expect(await main.boundingBox(), 'main keeps its box when the button grows into the card').toEqual(before);
    // Scrolled to its end, the content clears the card (or main never reaches under it).
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const end = await main.evaluate((el) => Math.max(0, ...Array.from(el.querySelectorAll('*'), (child) => child.getBoundingClientRect().bottom)));
    if (intersects(c, (await main.boundingBox())!)) expect(end, 'the content scrolls clear of the card').toBeLessThanOrEqual(c.y + 1);
    await expectNoOverflow(page);
    // The shortest window the layout serves (568px high, shorter than the content and its resting room): main scrolls,
    // and the card still covers no action and lets the content clear it.
    await page.setViewportSize({ width: 768, height: 568 });
    const s = await settled(card);
    for (const control of await controls()) expect(intersects(s, control), 'short window: the card covers no footer action').toBe(false);
    await main.evaluate((el) => el.scrollTo(0, el.scrollHeight));
    const shortEnd = await main.evaluate((el) => Math.max(0, ...Array.from(el.querySelectorAll('*'), (child) => child.getBoundingClientRect().bottom)));
    if (intersects(s, (await main.boundingBox())!)) expect(shortEnd, 'short window: the content scrolls clear of the card').toBeLessThanOrEqual(s.y + 1);
    await expectNoOverflow(page);
  });

  test('at 1280×688 (a short laptop window) on Home: the status never sits under a button, Minimize shows, and the card sits 24px from the corner (D-147)', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 688 });
    await preset(page, 'open');
    await fab(page).click();
    const card = page.locator('section[data-voice-status="listening"]');
    await expect(card).toBeVisible();
    await expect(card.getByRole('button', { name: 'Minimize voice controls' })).toBeVisible();
    await expect
      .poll(async () => {
        const status = (await card.locator('[data-icon] > span').first().boundingBox())!;
        const pause = (await card.getByRole('button', { name: 'Pause voice' }).boundingBox())!;
        const stop = (await card.getByRole('button', { name: 'Stop voice' }).boundingBox())!;
        const c = (await card.boundingBox())!;
        const right = 1280 - (c.x + c.width);
        return { overlapsPause: intersects(status, pause), overlapsStop: intersects(status, stop), gapBelow: 688 - (c.y + c.height) >= 23, corner: right >= 23 && right <= 25 };
      })
      .toEqual({ overlapsPause: false, overlapsStop: false, gapBelow: true, corner: true });
    await expectNoOverflow(page);
  });

  test('minimize keeps voice running behind a round status button, and a tap opens the card again', async ({ page }) => {
    await preset(page, 'open');
    await fab(page).click();
    const card = page.locator('section[data-voice-status="listening"]');
    await expect(card).toBeVisible();
    const c = await settled(card);
    await page.getByRole('button', { name: 'Minimize voice controls' }).click();
    await expect(card).toHaveCount(0);
    const mini = page.getByRole('button', { name: 'Listening' });
    await expect(mini).toBeVisible();
    // The mini button sits at the card's own corner.
    const m = await settled(mini);
    expect(Math.abs(m.x + m.width - (c.x + c.width))).toBeLessThanOrEqual(1);
    expect(Math.abs(m.y + m.height - (c.y + c.height))).toBeLessThanOrEqual(1);
    // Voice is still on: the agent can still act.
    await voice(page, `toolCall('select_trade', { trade: 'Electrician' })`);
    await page.waitForURL(/\/attendance\/trade\?trade=ele/);
    await expect(page.getByRole('button', { name: 'Listening' })).toBeVisible(); // still minimized after navigating
    await page.getByRole('button', { name: 'Listening' }).click();
    await expect(card).toBeVisible();
  });

  test('the open card yields the screen when idle: it rests as the mini button, opens again when the agent speaks, and a manual Minimize stays (R7)', async ({ page }) => {
    await preset(page, 'open');
    await fab(page).click();
    await page.mouse.move(8, 8); // the pointer leaves the card (a pointer over it holds it open)
    const card = page.getByRole('region', { name: 'Voice Agent' });
    await expect(card).toBeVisible();
    const say = async (line: string) => {
      await voice(page, 'playing(true)');
      await voice(page, `emit({ outputText: ${JSON.stringify(line)} })`);
    };
    const done = async () => {
      await voice(page, 'playing(false)');
      await voice(page, `emit({ turnComplete: true })`);
    };
    // The kickoff line, then 6 s with no audio, no caption and no pointer or focus in the card: it rests.
    await say('Good morning. Which trade?');
    await expect(card).toContainText('Which trade?');
    await done();
    await expect(card).toBeVisible();
    await expect(card).toHaveCount(0, { timeout: 9000 });
    const mini = page.getByRole('button', { name: 'Listening' });
    await expect(mini).toBeVisible();
    await expect(mini).not.toBeFocused(); // a rest the trainer did not ask for never moves focus
    // The agent's next spoken turn opens it again.
    await say('Electrician has two batches open.');
    await expect(card).toBeVisible();
    await expect(card).toContainText('two batches open');
    await done();
    // A manual Minimize stays minimized through the next speech, until the mini button is tapped.
    await card.getByRole('button', { name: 'Minimize voice controls' }).click();
    await expect(card).toHaveCount(0);
    await say('Shift 1 or Shift 2?');
    await expect(page.getByRole('button', { name: 'Speaking' })).toBeVisible();
    await page.waitForTimeout(600);
    await expect(card).toHaveCount(0);
    await done();
    await page.getByRole('button', { name: 'Listening' }).click();
    await expect(card).toBeVisible();
  });
});

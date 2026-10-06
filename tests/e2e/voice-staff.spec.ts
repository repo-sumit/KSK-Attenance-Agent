// tests/e2e/voice-staff.spec.ts
import { demo, expect, preset, test } from './fixtures';

/** Own attendance and staff attendance by voice (D-141) on the scripted model: the screens' own check and rules. */
type Page = import('@playwright/test').Page;
const voice = (page: Page, script: string) => page.evaluate(`window.__kskDemo.voice.${script}`);
const appTexts = async (page: Page) => ((await voice(page, 'texts()')) as string[]).filter((t) => t.startsWith('[APP]'));
const start = async (page: Page) => {
  await page.getByRole('button', { name: 'Voice Agent' }).click();
  await expect(page.getByText('Listening')).toBeVisible();
};

test.describe('voice own and staff attendance (scripted model)', () => {
  test('"mark my attendance": My attendance runs its check, the pass marks it, and the screen shows the result', async ({ page }) => {
    await preset(page, 'open'); // Rajesh Patil, not marked yet today; location and face check
    await start(page);
    const asked = (await voice(page, `toolCall('mark_my_attendance')`)) as { ok: boolean; step: string; instruction: string };
    expect(asked).toMatchObject({ ok: true, step: 'VERIFY' });
    expect(asked.instruction).toMatch(/^The location and face check for the trainer's own attendance is on the screen now\./);
    await voice(page, `emit({ turnComplete: true })`); // the agent said its check line: the camera text waits for that (D-148)
    await page.waitForURL(/\/me\/attendance$/);
    // the screen's own check (simulated location and camera) passes; voice saves it and the screen shows the result
    await expect(page.getByRole('heading', { name: 'Attendance marked' })).toBeVisible();
    await expect.poll(async () => (await appTexts(page)).some((t) => t.startsWith("[APP] The check passed and the trainer's own attendance is marked present at"))).toBe(true);
    expect((await appTexts(page)).some((t) => t.startsWith('[APP] The face camera is open.'))).toBe(true); // followed as a batch's check is
    const mine = (await voice(page, `toolCall('get_my_attendance')`)) as { today: { marked: boolean; status: string; by: string } };
    expect(mine.today).toMatchObject({ marked: true, status: 'PRESENT', by: 'SELF' });
    expect(await voice(page, `toolCall('mark_my_attendance')`)).toMatchObject({ ok: false, error: 'ALREADY_MARKED' });
    await expect(page.getByText('Listening')).toBeVisible(); // voice keeps running
  });

  test('a failed location check is read out and nothing is marked (no override)', async ({ page }) => {
    await preset(page, 'open');
    await demo(page, `setSimulation({ location: 'outside' })`);
    await start(page);
    await voice(page, `toolCall('mark_my_attendance')`);
    await page.waitForURL(/\/me\/attendance$/);
    await expect.poll(async () => (await appTexts(page)).some((t) => t.startsWith('[APP] Location check failed: the trainer is'))).toBe(true);
    await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
    expect((await voice(page, `toolCall('get_my_attendance')`)) as { today: { marked: boolean } }).toMatchObject({ today: { marked: false } });
  });

  test('the principal marks one staff member after a yes; the staff screen shows the saved mark', async ({ page }) => {
    await preset(page, 'principal');
    await start(page);
    const today = (await voice(page, `toolCall('get_staff_today')`)) as { ok: boolean; not_marked: number; not_marked_names: { name: string }[] };
    expect(today.ok).toBe(true);
    expect(today.not_marked_names.map((n) => n.name)).toContain('Pradeep Gawde');
    await expect(page).toHaveURL(/\/home$/); // reading opens nothing

    await voice(page, `speak('Pradeep ko absent lagao')`);
    const ask = (await voice(page, `toolCall('mark_staff', { staff: 'Pradeep', status: 'ABSENT' })`)) as { error: string; confirm_token: string };
    expect(ask.error).toBe('NEEDS_CONFIRMATION');
    await page.waitForURL(/\/attendance\/staff$/);
    const pradeep = page.locator('li', { hasText: 'Pradeep Gawde' });
    await expect(pradeep.getByRole('combobox')).toBeVisible(); // nothing saved before the yes

    // the model's asking turn ends, then the principal answers: the code counts only after that (D-082)
    await voice(page, `emit({ turnComplete: true })`);
    await voice(page, `speak('haan')`);
    const done = (await voice(page, `toolCall('mark_staff', { staff: 'Pradeep', status: 'ABSENT', confirm_token: '${ask.confirm_token}' })`)) as { ok: boolean; not_marked: number };
    expect(done).toMatchObject({ ok: true, not_marked: today.not_marked - 1 });
    await expect(pradeep.getByText('Marked by principal')).toBeVisible();
    await expect(pradeep.getByRole('combobox')).toHaveCount(0);
    await expect(pradeep.getByText('Absent')).toBeVisible();
  });

  test('"mark me present": the staff screen outlines the principal\'s own row, one yes saves it, and the next person is outlined (D-156)', async ({ page }) => {
    await preset(page, 'principal');
    await start(page);
    const today = (await voice(page, `toolCall('get_staff_today')`)) as { not_marked_names: { name: string; self?: boolean }[]; instruction: string };
    expect(today.not_marked_names[0]).toMatchObject({ name: 'you', self: true }); // "you" first, never the principal's name
    expect(today.instruction).not.toContain('Deshmukh');

    await voice(page, `speak('mark me present')`);
    const ask = (await voice(page, `toolCall('mark_staff', { staff: 'me', status: 'PRESENT' })`)) as { error: string; confirm_token: string; instruction: string };
    expect(ask.error).toBe('NEEDS_CONFIRMATION');
    expect(ask.instruction).toContain('"Mark yourself present for today? It is final."');
    await page.waitForURL(/\/attendance\/staff$/);
    const mine = page.locator('li[data-staff="st-anil"]');
    await expect(mine).toHaveAttribute('data-current', 'true'); // the row voice asks about is outlined
    await expect(mine).toContainText('(you)');

    await voice(page, `emit({ turnComplete: true })`);
    await voice(page, `speak('haan')`);
    const done = (await voice(page, `toolCall('mark_staff', { staff: 'me', status: 'PRESENT', confirm_token: '${ask.confirm_token}' })`)) as { ok: boolean; next: { name: string }; instruction: string };
    expect(done).toMatchObject({ ok: true, next: { name: 'Rajesh Patil' } });
    expect(done.instruction).toContain('next is Rajesh Patil');
    await expect(mine.getByText('Marked by principal')).toBeVisible();
    await expect(page.locator('li[data-staff="st-rajesh"]')).toHaveAttribute('data-current', 'true'); // the outline moves to the person offered next
    await expect(mine).not.toHaveAttribute('data-current', 'true');
    expect(await voice(page, 'earcons()')).toEqual(['ready', 'saved']); // the cues: ready at the start, saved for the mark
  });

  test('"mark everyone else present": one question with the count, one yes, every staff row saved (D-156)', async ({ page }) => {
    await preset(page, 'principal');
    await start(page);
    await voice(page, `speak('mark everyone else present')`);
    const ask = (await voice(page, `toolCall('mark_remaining_staff', { status: 'PRESENT' })`)) as { error: string; count: number; includes_you: boolean; confirm_token: string; instruction: string };
    expect(ask).toMatchObject({ error: 'NEEDS_CONFIRMATION', includes_you: true });
    expect(ask.instruction).toContain(`"Mark the other ${ask.count} staff present, you included? It is final."`);
    await page.waitForURL(/\/attendance\/staff$/);
    await expect(page.getByRole('combobox')).toHaveCount(ask.count); // nothing saved before the yes

    await voice(page, `emit({ turnComplete: true })`);
    await voice(page, `speak('haan')`);
    const done = (await voice(page, `toolCall('mark_remaining_staff', { status: 'PRESENT', confirm_token: '${ask.confirm_token}' })`)) as { ok: boolean; saved: number; not_marked: number };
    expect(done).toMatchObject({ ok: true, saved: ask.count, not_marked: 0 });
    await expect(page.getByRole('combobox')).toHaveCount(0);
    await expect(page.locator('li[data-staff="st-pradeep"]').getByText('Marked by principal')).toBeVisible();
    // asking again finds nobody left (that a code is used once is proved in tests/integration/voice-staff-flow.test.ts)
    expect(await voice(page, `toolCall('mark_remaining_staff', { status: 'PRESENT', confirm_token: '${ask.confirm_token}' })`)).toMatchObject({ ok: false, error: 'NOTHING_LEFT' });
  });

  test('the staff report by voice: this month\'s figure, the section on yes, and the staff register sheet (D-154, D-156)', async ({ page }) => {
    await preset(page, 'principal');
    await start(page);
    const report = (await voice(page, `toolCall('get_staff_report')`)) as { ok: boolean; month_pct: number; instruction: string };
    expect(report.ok).toBe(true);
    expect(report.instruction).toMatch(new RegExp(`^Staff attendance this month: ${report.month_pct}% `));
    await expect(page).toHaveURL(/\/home$/); // an answer opens nothing
    expect(await voice(page, `toolCall('show_report')`)).toMatchObject({ ok: true });
    await page.waitForURL(/\/reports$/);
    const staff = page.getByRole('region', { name: 'Staff attendance' });
    await expect(staff).toBeInViewport();
    expect(await voice(page, `toolCall('download_register', { target: 'staff', month: 'LAST_MONTH' })`)).toMatchObject({ ok: true, scope: 'staff' });
    const sheet = page.getByRole('dialog', { name: 'Download attendance register' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('All staff');
    await expect(sheet.getByRole('radio', { checked: true })).not.toHaveAccessibleName(/so far/); // last month, as asked
  });
});

import { demo, expect, preset, test } from './fixtures';

test('open instructor: trade → batch → verify → mark → review → submit → locked', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  // Slow enough that the verification step is on screen long enough to assert (≈300 ms at the fixture's speed).
  await demo(page, 'setSimulation({ speed: 0.3 })');
  // Home owns today's work: the trades are right on Home (D-052).
  await page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ }).click();
  await page.getByRole('link', { name: /Shift 1 · Unit 2/ }).click();
  await expect(page.getByRole('heading', { name: 'Verify your presence' })).toBeVisible();
  await page.waitForURL(/\/attendance\/mark/);

  await expect(page.getByText('Everyone starts as Present')).toBeVisible();
  // One status control per student (D-062): the phone's own picker, Present to start with.
  const status = page.getByRole('combobox', { name: /^Attendance for / });
  await expect(status.first()).toHaveValue('present');
  await status.nth(0).selectOption('absent');
  await status.nth(3).selectOption('absent');
  await expect(status.nth(0)).toHaveValue('absent');
  // Only what configuration enables: Present and Absent in Maharashtra.
  await expect(status.first().locator('option')).toHaveText(['Present', 'Absent']);

  await page.getByRole('button', { name: 'Review & Submit' }).click();
  await page.waitForURL(/\/attendance\/review/);
  await expect(page.getByText('Absent students (2)')).toBeVisible();
  // The Review screen is the one confirmation (D-149): the counts, the names and "it is final", then one tap.
  await expect(page.locator('main').getByText('29', { exact: true })).toBeVisible();
  await expect(page.getByText('After you submit, this attendance can’t be edited.')).toBeVisible();
  await page.getByRole('button', { name: 'Submit attendance' }).click();
  await page.waitForURL(/\/attendance\/submitted/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Attendance submitted' })).toBeVisible();
  await expect(page.getByText('29 Present · 2 Absent')).toBeVisible();

  // Locked: the roster URL now always resolves to the read-only record.
  const recordUrl = page.url().replace('/submitted', '/mark');
  await page.goto(recordUrl);
  await page.waitForURL(/\/attendance\/record/);
  await expect(page.getByText(/can only be corrected by the principal/)).toBeVisible();
  await expect(page.getByRole('combobox', { name: /^Attendance for / })).toHaveCount(0);

  await page.goto('/home');
  await expect(page.getByText('Submitted today')).toBeVisible();
  await expect(page.locator('main').getByText(/Electrician · Shift 1 · Unit 2/)).toBeVisible();
});

test('outside the geo-fence is blocked with the real distance', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await page.evaluate(() => (window as unknown as { __kskDemo: { setSimulation(p: object): void } }).__kskDemo.setSimulation({ location: 'outside' }));
  await page.goto('/attendance/open?s=' + (await page.evaluate(() => `ele-s1u3.${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())}.daily`)));
  await expect(page.getByRole('heading', { name: 'You’re outside your institute' })).toBeVisible();
  await expect(page.getByText('You are 1.24 km away')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check again' })).toBeVisible();
});

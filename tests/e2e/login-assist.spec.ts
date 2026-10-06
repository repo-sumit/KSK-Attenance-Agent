import type { Page } from '@playwright/test';
import { demo, expect, preset, realGreeting, test } from './fixtures';

/** Each row: the role, then "name · what it shows". */
const ACCOUNTS = [
  /^Open instructor\s*Rajesh Patil · Any trade/,
  /^Trade-mapped instructor\s*Sanjay More · Only Fitter \+ Welder$/,
  /^Batch-mapped instructor\s*Sunita Jadhav · Only assigned batches$/,
  /^Timetable instructor\s*Vikas Shinde · Periods · time fenced$/,
  /^Employability Skills instructor\s*Meera Kulkarni · Batches across trades$/,
  /^Group instructor\s*Yogesh Dalvi · 2 classes \+ Electrician overview$/,
  /^Principal\s*Dr\. Anil Deshmukh · Institute · corrections · staff$/,
];

const accounts = (page: Page) => page.getByRole('list', { name: 'Demo accounts' });
const account = (page: Page, role: string) => accounts(page).getByRole('button', { name: new RegExp(`^${role}`) });

test('"Demo accounts": seven people always shown; one tap, then both confirmations, lands on Home in 3 taps', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'first_time', /\/login$/);
  const code = page.getByLabel('Institute code');
  // No toggle: the list and its hint are on the screen, and nothing is filled or focused (no keyboard on a phone).
  await expect(page.getByRole('button', { name: 'Use demo account' })).toHaveCount(0);
  await expect(page.getByText('Tap a person: you still confirm the institute and the person.')).toBeVisible();
  const rows = accounts(page).getByRole('button');
  await expect(rows).toHaveCount(7);
  for (const [i, name] of ACCOUNTS.entries()) await expect(rows.nth(i)).toHaveAccessibleName(name);
  await expect(code).toHaveValue('');
  await expect(code).not.toBeFocused();

  await account(page, 'Principal').click();
  await page.waitForURL(/\/login\/institute$/);
  await expect(page.getByText('Is this your institute?')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  // The Trainer ID input is skipped for a picked account; "Is this you?" is not.
  await page.waitForURL(/\/login\/identity$/);
  await expect(page.getByText('Is this you?')).toBeVisible();
  await expect(page.locator('main').getByText('Dr. Anil Deshmukh')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await page.waitForURL(/\/home$/);
  await expect(page.getByRole('heading', { level: 2, name: realGreeting('Principal') })).toBeVisible();
});

test('"Not you?" forgets the picked account: the next "Yes" asks for a Trainer ID', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'first_time', /\/login$/);
  await account(page, 'Batch-mapped instructor').click();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await expect(page.locator('main').getByText('Sunita Jadhav')).toBeVisible();
  await page.getByRole('button', { name: 'Not you? Change Trainer ID' }).click();
  await page.waitForURL(/\/login\/institute$/);
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await page.waitForURL(/\/login\/trainer$/);
  const trainerId = page.getByLabel('Trainer ID');
  await expect(trainerId).toHaveValue('');
  await trainerId.fill('TR-10377');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('main').getByText('Vikas Shinde')).toBeVisible();
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await page.waitForURL(/\/home$/);
  await expect(page.getByRole('heading', { name: 'Today’s timetable' })).toBeVisible();
});

test('while the lookups run the tapped row shows progress and the others are disabled', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'first_time', /\/login$/);
  // Real speed, so the simulated lookup lasts long enough to look at.
  await demo(page, 'setSimulation({ speed: 1 })');
  const group = account(page, 'Group instructor');
  await group.click();
  await expect(account(page, 'Principal')).toBeDisabled();
  await expect(group).toHaveAttribute('aria-busy', 'true');
  await page.waitForURL(/\/login\/institute$/);
  await page.getByRole('button', { name: 'Yes, continue' }).click();
  await expect(page.locator('main').getByText('Yogesh Dalvi')).toBeVisible();
});

test.describe('First-time story', () => {
  // The fixture's self-first switch keeps the preset remembered, so the story's own account is still recognised by it.
  test('First-time user: its own account keeps the story, so signing in leads to face registration', async ({ page, consoleErrors }) => {
    void consoleErrors;
    await preset(page, 'first_time', /\/login$/);
    await account(page, 'Open instructor').click();
    await page.getByRole('button', { name: 'Yes, continue' }).click();
    await expect(page.locator('main').getByText('Rajesh Patil')).toBeVisible();
    await page.getByRole('button', { name: 'Yes, continue' }).click();
    await page.waitForURL(/\/face/);
    await expect(page.getByText('Set up face verification')).toBeVisible();
  });
});

test('the two new presets open their own Home: ?preset=trade and ?preset=group', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'trade');
  await expect(page.getByText(/Good \w+, Sanjay/)).toBeVisible();
  // Trade mapped: only Sanjay's two trades, as a switcher.
  await expect(page.locator('main').getByRole('radiogroup', { name: 'Trades' }).getByRole('radio')).toHaveText(['Fitter', 'Welder']);
  await preset(page, 'group');
  await expect(page.getByText(/Good \w+, Yogesh/)).toBeVisible();
  // Group instructor: the trade-wide overview card beside the classes.
  await expect(page.locator('main').getByText('Electrician overview')).toBeVisible();
});

test('the demo panel: "Sign in as" signs straight in (2 taps); "Show the login screens" opens login with that person highlighted', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await preset(page, 'open');
  await page.getByRole('button', { name: 'Open demo controls' }).click();
  let panel = page.getByRole('dialog', { name: 'Demo controls' });
  const people = panel.getByRole('list', { name: 'Sign in as' });
  await expect(people.getByRole('button')).toHaveCount(7);
  await expect(people.getByRole('button', { name: /^Open instructor/ })).toHaveAttribute('aria-current', 'true');
  await people.getByRole('button', { name: /^Batch-mapped instructor/ }).click();
  await page.waitForURL(/\/home$/);
  await expect(page.getByText(/Good \w+, Sunita/)).toBeVisible();

  await page.getByRole('button', { name: 'Open demo controls' }).click();
  panel = page.getByRole('dialog', { name: 'Demo controls' });
  await expect(panel.getByRole('list', { name: 'Sign in as' }).getByRole('button', { name: /^Batch-mapped instructor/ })).toHaveAttribute('aria-current', 'true');
  await panel.getByRole('button', { name: 'Show the login screens' }).click();
  await page.waitForURL(/\/login$/);
  // Highlighted only: nothing is filled and nothing moves until a tap.
  await expect(account(page, 'Batch-mapped instructor')).toHaveAttribute('aria-current', 'true');
  await expect(page.getByLabel('Institute code')).toHaveValue('');
});

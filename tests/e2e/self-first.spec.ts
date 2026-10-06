import type { Page } from '@playwright/test';
import { demo, expect, nav, preset, test } from './fixtures';

/**
 * Own attendance before students (D-152), Maharashtra's default: Rajesh Patil (preset "open") is not self-marked in
 * the seed, so no class opens until he marks his own attendance; a self check from the last 10 minutes also opens the
 * next class (one check, not two). The principal has no own attendance and is unaffected.
 */
test.use({ selfFirst: true });

const today = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));
const batchRow = (page: Page, name: RegExp) => page.locator('main').getByRole('link', { name });

/** My attendance from Home's first step: location and face (simulated), then "Mark present", then back Home. */
async function markSelf(page: Page) {
  await page.getByRole('link', { name: 'Mark my attendance' }).click();
  await page.waitForURL(/\/me\/attendance$/);
  await page.getByRole('button', { name: 'Mark present' }).click();
  await expect(page.getByRole('heading', { name: 'Attendance marked' })).toBeVisible();
  await page.getByRole('link', { name: 'Done' }).click();
  await page.waitForURL(/\/home$/);
}

test('Home shows the step first, class rows wait for it, and a typed class URL explains it', async ({ page }) => {
  await preset(page, 'open');
  const step = page.getByText('Mark your own attendance before your classes.');
  await expect(step).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mark my attendance' })).toBeVisible();
  // the first thing under the greeting: above today's classes
  const stepTop = (await step.boundingBox())!.y;
  const classesTop = (await page.getByRole('region', { name: 'Today’s attendance' }).boundingBox())!.y;
  expect(stepTop).toBeLessThan(classesTop);

  await page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ }).click();
  const row = batchRow(page, /Shift 1 · Unit 2/);
  await expect(row).toContainText('Mark your attendance first');
  await expect(row).not.toContainText('Mark attendance');

  await page.goto(`/attendance/open?s=ele-s1u2.${await today(page)}.daily`);
  await expect(page.getByRole('heading', { name: 'Mark your attendance first' })).toBeVisible();
  await expect(page.getByText('Your own attendance for today isn’t marked yet. Mark it, then open Electrician · Shift 1 · Unit 2.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Mark my attendance' })).toHaveAttribute('href', '/me/attendance');
  await expect(page.getByRole('button', { name: 'Go back' })).toBeVisible();
  // no check ran for the class
  await expect(page.getByRole('heading', { name: 'Verify your presence' })).toHaveCount(0);
});

test('marking self frees the classes, the next class within 10 minutes opens without a second check, and it submits', async ({ page }) => {
  await preset(page, 'open');
  await markSelf(page);
  await expect(page.getByText('Mark your own attendance before your classes.')).toHaveCount(0);

  await page.getByRole('region', { name: 'Today’s attendance' }).getByRole('link', { name: /Electrician/ }).click();
  const row = batchRow(page, /Shift 1 · Unit 2/);
  await expect(row).toContainText('Mark attendance');
  await expect(row).not.toContainText('Mark your attendance first');
  // real pace for this step, so the short "verified" hold can be seen
  await demo(page, 'setSimulation({ speed: 1 })');
  await row.click();
  await expect(page.getByText('Verified a moment ago')).toBeVisible();
  await page.waitForURL(/\/attendance\/mark/);
  await expect(page.getByText('Everyone starts as Present')).toBeVisible();
  // Maharashtra's default path through to the record: review and submit re-check own attendance and the reused pass.
  await demo(page, 'setSimulation({ speed: 0.05 })');
  await page.getByRole('combobox', { name: /^Attendance for / }).first().selectOption('absent');
  await page.getByRole('button', { name: 'Review & Submit' }).click();
  await page.waitForURL(/\/attendance\/review/);
  await expect(page.getByText('Absent student (1)')).toBeVisible();
  await page.getByRole('button', { name: 'Submit attendance' }).click();
  await page.waitForURL(/\/attendance\/submitted/);
  await expect(page.getByRole('heading', { name: 'Attendance submitted' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mark your attendance first' })).toHaveCount(0);
});

test('after the demo clock moves 11 minutes, the next class runs its full check', async ({ page }) => {
  await preset(page, 'open');
  await markSelf(page);
  await demo(page, "setClock('10:26')");
  await demo(page, 'setSimulation({ speed: 0.3 })');
  await page.goto(`/attendance/open?s=ele-s1u3.${await today(page)}.daily`);
  // Checked while the gateway is on screen (after it navigates the text could not be there anyway).
  await expect(page.getByRole('heading', { name: 'Verify your presence' })).toBeVisible();
  await expect(page.getByText('Verified a moment ago')).toHaveCount(0);
  await expect(page.getByText('Look at the camera')).toBeVisible(); // the face check runs again
  await expect(page.getByText('Verified a moment ago')).toHaveCount(0);
  await page.waitForURL(/\/attendance\/mark/);
});

test('the principal is unaffected: no step on Home, classes open to the usual check', async ({ page }) => {
  await preset(page, 'principal');
  await expect(page.getByText('Mark your own attendance before your classes.')).toHaveCount(0);
  await nav(page, 'Attendance').click();
  await page.getByRole('link', { name: /Electrician/ }).click();
  await expect(page.locator('main')).not.toContainText('Mark your attendance first');
  await page.goto(`/attendance/open?s=ele-s1u2.${await today(page)}.daily`);
  await expect(page.getByRole('heading', { name: 'Verify your presence' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Mark your attendance first' })).toHaveCount(0);
  await page.waitForURL(/\/attendance\/mark/);
});

test('My attendance keeps one action layout: beside the text on a wide card, across the card on a phone (U5)', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await preset(page, 'open');
  const title = page.locator('main').getByText('My attendance', { exact: true });
  const action = page.getByRole('link', { name: 'Mark my attendance' });
  // The card's row: the tile, the title and its lines (the action is the row's sibling in the card's body).
  const row = title.locator('xpath=../..');
  let t = (await title.boundingBox())!;
  let a = (await action.boundingBox())!;
  const r = (await row.boundingBox())!;
  expect(a.x, 'the action is right of the text').toBeGreaterThan(t.x + t.width);
  const middle = a.y + a.height / 2;
  expect(middle).toBeGreaterThanOrEqual(r.y);
  expect(middle).toBeLessThanOrEqual(r.y + r.height);
  expect(a.height, 'an in-card action is md (44px), not the 56px CTA').toBeLessThanOrEqual(45);

  await page.setViewportSize({ width: 360, height: 800 });
  t = (await title.boundingBox())!;
  a = (await action.boundingBox())!;
  const rowBox = (await row.boundingBox())!;
  expect(a.y, 'under the text on a phone').toBeGreaterThan(t.y + t.height);
  expect(Math.abs(a.width - rowBox.width), 'across the card').toBeLessThanOrEqual(1);
});

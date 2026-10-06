import type { Page } from '@playwright/test';
import { expect, openProfileMenu, preset, test } from './fixtures';

/**
 * Marathi screens set master data (names, trades, IDs) in Latin and translated words in Mukta (DESIGN_SYSTEM.md Fonts,
 * U14): no visible Latin word is drawn in Mukta, and no visible lang="en" island holds Devanagari. Demo tooling
 * (English only, D-047) and the Voice Agent widget are out of scope; a few Latin acronyms are part of the translation.
 */
const TRANSLATED_ACRONYMS = ['PDF', 'OJT'];

/** The screen has settled: its fonts are loaded and no loading placeholder (aria-busy) is left in the page. */
async function settled(page: Page) {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
}

async function scriptProblems(page: Page) {
  await settled(page);
  return page.evaluate((allowed) => {
    // (<html> itself carries data-voice-float while the widget shows: only the widget's own root is skipped.)
    const skip = (el: Element) => el.closest('script, style, .visually-hidden, [aria-hidden="true"], [data-tool-slot], body > div[data-voice-float], [role="dialog"][aria-label="Demo controls"]');
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
    };
    const latinInMukta: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || skip(el) || !visible(el)) continue;
      const words = (n.textContent ?? '').match(/[A-Za-z]{3,}/g)?.filter((w) => !allowed.includes(w)) ?? [];
      if (words.length && /mukta/i.test(getComputedStyle(el).fontFamily.split(',')[0])) latinInMukta.push(`${words.join(' ')} <${el.tagName.toLowerCase()}>`);
    }
    const marathiInEnglish = [...document.querySelectorAll('[lang="en"]')]
      .filter((el) => !skip(el) && visible(el) && /[ऀ-ॿ]/.test(el.textContent ?? ''))
      .map((el) => (el.textContent ?? '').trim().slice(0, 60));
    return { latinInMukta: [...new Set(latinInMukta)], marathiInEnglish: [...new Set(marathiInEnglish)] };
  }, TRANSLATED_ACRONYMS);
}

async function expectRightScripts(page: Page, where: string) {
  const problems = await scriptProblems(page);
  expect(problems, where).toEqual({ latinInMukta: [], marathiInEnglish: [] });
}

async function marathi(page: Page) {
  const menu = await openProfileMenu(page);
  await menu.getByRole('radio', { name: 'मराठी' }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

const today = (page: Page) => page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date()));

test('Marathi: master data in Latin, translated words never in a Latin island (instructor screens)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 360, height: 800 });
  await preset(page, 'batch');
  await marathi(page);
  await expectRightScripts(page, 'Home');
  await page.getByRole('link', { name: /शिफ्ट 1 · युनिट 2/ }).first().click();
  await page.waitForURL(/\/attendance\/mark/, { timeout: 20_000 });
  const status = page.getByRole('combobox', { name: /ची हजेरी$/ });
  await status.first().selectOption('absent');
  await expectRightScripts(page, 'roster');
  await page.getByRole('button', { name: 'तपासा आणि सबमिट करा' }).click();
  await page.waitForURL(/\/attendance\/review/);
  await expectRightScripts(page, 'review');
  await page.getByRole('button', { name: 'हजेरी सबमिट करा' }).click();
  await page.waitForURL(/\/attendance\/submitted/);
  await page.goto(page.url().replace('/submitted', '/record'));
  await expect(page.locator('main ol > li').first()).toBeVisible();
  await expectRightScripts(page, 'record');
  // The profile menu: the role line and the Trainer ID.
  await page.locator('header').getByRole('button', { name: 'प्रोफाइल' }).click();
  await expect(page.getByRole('dialog', { name: 'प्रोफाइल' })).toBeVisible();
  await expectRightScripts(page, 'profile menu');
  await page.keyboard.press('Escape');
  // My attendance (Rajesh, not marked yet): the role line under the name.
  await preset(page, 'open');
  await expect(page.locator('html')).toHaveAttribute('lang', 'mr');
  await page.goto('/me/attendance');
  await expect(page.locator('main')).toContainText('Rajesh Patil');
  await expectRightScripts(page, 'my attendance');
});

test('Marathi: master data in Latin, translated words never in a Latin island (principal screens)', async ({ page, consoleErrors }) => {
  void consoleErrors;
  await page.setViewportSize({ width: 360, height: 800 });
  await preset(page, 'principal');
  await marathi(page);
  await expectRightScripts(page, 'Home');
  await page.goto('/attendance/staff');
  await expect(page.locator('main li').first()).toBeVisible();
  await expectRightScripts(page, 'Staff roster');
  await page.goto(`/attendance/record?s=ele-s1u1.${await today(page)}.daily`);
  await expect(page.locator('main ol > li').first()).toBeVisible();
  await expectRightScripts(page, 'record');
  await page.getByRole('link', { name: /Rahul Kumar/ }).first().click();
  await page.waitForURL(/\/attendance\/correct/);
  await expectRightScripts(page, 'correction');
  await page.goto('/reports');
  const staff = page.getByRole('region', { name: 'कर्मचारी हजेरी' });
  await expect(staff.getByRole('button', { expanded: false })).toHaveCount(18);
  for (const section of ['institute', 'staff']) {
    await page.locator(`#${section}-title`).evaluate((h) => h.scrollIntoView({ block: 'start' }));
    await expectRightScripts(page, `Reports #${section}`);
  }
  await page.goto('/reports/view?r=staff_summary&range=month');
  await expect(page.locator('main li').first()).toBeVisible();
  await expectRightScripts(page, 'staff detail report');
});

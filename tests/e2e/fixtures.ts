import { test as base, expect, type Page } from '@playwright/test';

/**
 * Every E2E test: demo simulations at 5% speed (fast but still observable),
 * the demo's simulated camera (camera.spec.ts switches to Chromium's fake
 * device), the scripted voice model (no microphone, no network; driven by
 * window.__kskDemo.voice), and the test fails on any console error, page error
 * or React warning. The fixture is automatic: a test gets it whether or not it
 * names `consoleErrors`.
 *
 * Own attendance first and the self-pass reuse (D-152) are on in Maharashtra, and the default persona (Rajesh) is not
 * self-marked in the seed. A spec that is not about them runs with both off (`preset()` patches the demo config after
 * the preset, keeping the preset itself), so it keeps testing what it tests and a class check never rides on a reused
 * self pass. A spec about them opts in with `test.use({ selfFirst: true })`.
 */
const selfFirstOn = new WeakSet<Page>();

interface DemoStateLike {
  readonly config: { readonly staff?: object; readonly verification?: object } & Record<string, unknown>;
}

/**
 * Own attendance first and the self-pass reuse off, merged into the stored demo configuration while the preset stays
 * remembered. `setConfig` would also set `presetId` to null (a presenter's own change detaches the story, D-108) and
 * clear the passes, so a story recognised by its preset (First-time's own account) would no longer be the one tested.
 * Test-only reach into the controller's demo state repository.
 */
async function selfFirstOff(page: Page) {
  await page.waitForFunction(() => '__kskDemo' in window);
  await page.evaluate(() => {
    type Repo = { update(fn: (s: DemoStateLike) => DemoStateLike): void };
    const repo = (window as unknown as { __kskDemo: { demo: { repo: Repo } } }).__kskDemo.demo.repo;
    repo.update((s) => ({
      ...s,
      config: { ...s.config, staff: { ...s.config.staff, selfBeforeStudents: false }, verification: { ...s.config.verification, selfPassReuseMinutes: 0 } },
    }));
  });
}

export const test = base.extend<{ consoleErrors: string[]; selfFirst: boolean }>({
  selfFirst: [false, { option: true }],
  consoleErrors: [async ({ page, selfFirst }, provide) => {
    if (selfFirst) selfFirstOn.add(page);
    const errors: string[] = [];
    page.on('console', (m) => {
      // Errors always fail; warnings fail when they come from React/Next (not the browser's own preload notices).
      if (m.type() === 'error' || (m.type() === 'warning' && /^Warning:|hydrat|\[i18n\]/i.test(m.text()))) errors.push(`${m.type()}: ${m.text()}`);
    });
    page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
    await page.addInitScript(() => {
      const key = 'ksk-demo:v1:state';
      if (!localStorage.getItem(key)) {
        localStorage.setItem(
          key,
          JSON.stringify({
            version: 1,
            presetId: 'open',
            // The current PRESETS_VERSION (src/demo/presets.ts; tests/unit/services/demo-state.test.ts keeps them equal),
            // so this default story is not refreshed from the presets when the app starts.
            presetsVersion: 2,
            persona: 'open',
            config: {},
            simulation: {
              location: 'inside',
              outsideDistanceM: 1240,
              face: 'match',
              enrolmentIssue: 'none',
              camera: 'simulated',
              liveness: 'auto',
              permissions: { location: 'granted', camera: 'granted' },
              online: true,
              voice: 'scripted',
              nextSyncFails: false,
              speed: 0.05,
            },
            clock: { mode: 'fixed', time: '10:15' },
          }),
        );
      }
    });
    await provide(errors);
    expect(errors, 'console must stay clean').toEqual([]);
  }, { auto: true }],
});

export { expect };

/** Applies a demo preset and waits for its start screen (with own attendance first off unless the spec opts in). */
export async function preset(page: Page, id: string, landing: RegExp = /\/home$/) {
  await page.goto(`/?preset=${id}`);
  await page.waitForURL(landing);
  if (!selfFirstOn.has(page)) await selfFirstOff(page);
}

export async function demo(page: Page, script: string) {
  // The demo controller mounts after boot (a dynamic chunk): after a full load (goto, goBack) it can arrive after "load".
  await page.waitForFunction(() => '__kskDemo' in window);
  await page.evaluate(`window.__kskDemo.${script}`);
}

const GREETINGS = {
  en: { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening', night: 'Good night' },
  mr: { morning: 'सुप्रभात', afternoon: 'शुभ दुपार', evening: 'शुभ संध्याकाळ', night: 'शुभ रात्री' },
} as const;

/**
 * The Home greeting for the machine's real time of day (D-151), computed here from the IST clock, never by the app:
 * morning 05:00, afternoon 12:00, evening 17:00, night 21:00. Matches either side of a boundary up to two minutes
 * away: the page may have rendered just before it (its minute tick has not fired yet), or the test may cross it.
 */
export function realGreeting(name: string, language: keyof typeof GREETINGS = 'en'): RegExp {
  const phrase = (ms: number) => {
    const ist = (Math.floor(ms / 60_000) + 330) % 1440;
    const part = ist < 300 ? 'night' : ist < 720 ? 'morning' : ist < 1020 ? 'afternoon' : ist < 1260 ? 'evening' : 'night';
    return GREETINGS[language][part];
  };
  const now = Date.now();
  const phrases = [...new Set([phrase(now - 120_000), phrase(now), phrase(now + 120_000)])];
  return new RegExp(`^(${phrases.join('|')}), ${name}$`);
}

/** Primary navigation link: the bottom nav on phones, the header nav on wider screens (only the visible one is in the accessibility tree). */
export const nav = (page: Page, name: string) => page.locator('nav').getByRole('link', { name, exact: true });

/** Opens the profile menu from the header avatar (the single profile entry point). */
export async function openProfileMenu(page: Page, name = 'Profile') {
  await page.locator('header').getByRole('button', { name, exact: true }).click();
  const menu = page.getByRole('dialog', { name });
  await expect(menu).toBeVisible();
  return menu;
}

/** No horizontal scrolling at the current viewport. */
export async function expectNoOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
}

/** No control group (status pills, segmented options) is wider than its row. */
export async function expectGroupsFit(page: Page) {
  const clipped = await page.evaluate(() =>
    [...document.querySelectorAll('[role=group], [role=radiogroup]')].filter((g) => g.scrollWidth > g.clientWidth + 1).map((g) => g.getAttribute('aria-label')),
  );
  expect(clipped).toEqual([]);
}

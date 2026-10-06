// @vitest-environment jsdom
/**
 * Task 12: the presenter-first demo panel. Sign in as (seven people, one tap signs straight in) → Stories → Quick
 * settings (always open: Voice Agent and its model, Time of day, Network, Language) → Advanced (collapsed) → Data →
 * Reset demo. Quick login and "Skip login screens" are gone.
 */
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAdapters, type DemoAdapters } from '@/demo/adapters';
import { DemoController, prepareScenario } from '@/demo/controller';
import { DemoPanel } from '@/demo/ui/DemoPanel';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { SessionProvider } from '@/hooks/session';
import { MemoryStore } from '@/lib/kv-store';
import { createMockContainer, type AppContainer } from '@/services/container';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  cleanup();
  expect(errors).not.toHaveBeenCalled();
});

/** The demo branch of boot.ts on the device source, with instant simulated delays. */
function demoApp(): { demo: DemoAdapters; app: AppContainer; controller: DemoController; visits: string[] } {
  const demo = createDemoAdapters();
  demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, speed: 0 } }));
  const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation, configOverrides: demo.configOverrides, loginAssist: demo.loginAssist });
  demo.loginAssist.connect((id) => prepareScenario(app, demo, id));
  demo.repo.subscribe(() => app.bus.emit('demo'));
  app.mockDatabase.ensureSeeded();
  const visits: string[] = [];
  const controller = new DemoController(app, demo, (href) => visits.push(href), { reload: () => undefined, sharedAvailable: false });
  return { demo, app, controller, visits };
}

async function renderPanel(signedInAs: 'batch' | null = 'batch') {
  const env = demoApp();
  if (signedInAs) await env.controller.applyPreset(signedInAs);
  env.visits.length = 0;
  const done = vi.fn();
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <SessionProvider>
          <DemoPanel demo={env.demo} controller={env.controller} onDone={done} />
        </SessionProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  // The session loads asynchronously: the signed-in person's row carries the check once it has.
  if (signedInAs) await waitFor(() => expect(screen.getByRole('list', { name: 'Sign in as' }).querySelector('[aria-current="true"]')).not.toBeNull());
  return { ...env, done };
}

const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('the demo panel, presenter first', () => {
  it('is ordered Sign in as → Stories → Quick settings → Advanced (collapsed) → Data → Reset demo', async () => {
    await renderPanel();
    const titles = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(titles.slice(0, 3)).toEqual(['Sign in as', 'Stories', 'Quick settings']);
    const quick = screen.getByRole('heading', { name: 'Quick settings' });
    const advanced = screen.getByText('Advanced').closest('details')!;
    expect(advanced.open).toBe(false);
    const data = screen.getByRole('region', { name: 'Data' });
    const reset = screen.getByRole('button', { name: 'Reset demo' });
    expect(precedes(quick, advanced)).toBe(true);
    expect(precedes(advanced, data)).toBe(true);
    expect(precedes(data, reset)).toBe(true);
    // Gone: the old two lists of the same people, and the buried direct path.
    for (const gone of ['Quick presets', 'Quick login', 'Skip login screens']) expect(screen.queryByText(gone)).toBeNull();
  });

  it('Sign in as: the seven people in one list, a check on the one signed in; a tap signs straight in and goes Home', async () => {
    const { app, visits, done } = await renderPanel('batch');
    const list = screen.getByRole('list', { name: 'Sign in as' });
    const rows = within(list).getAllByRole('button');
    expect(rows.map((r) => r.textContent)).toEqual([
      'Open instructorRajesh Patil · Any trade · geo‑fence · face',
      'Trade-mapped instructorSanjay More · Only Fitter + Welder',
      'Batch-mapped instructorSunita Jadhav · Only assigned batches',
      'Timetable instructorVikas Shinde · Periods · time fenced',
      'Employability Skills instructorMeera Kulkarni · Batches across trades',
      'Group instructorYogesh Dalvi · 2 classes + Electrician overview',
      'PrincipalDr. Anil Deshmukh · Institute · corrections · staff',
    ]);
    expect(rows.filter((r) => r.getAttribute('aria-current') === 'true').map((r) => r.textContent)).toEqual(['Batch-mapped instructorSunita Jadhav · Only assigned batches']);
    await act(async () => fireEvent.click(rows[6]));
    await waitFor(() => expect(visits).toEqual(['/home']));
    expect((await app.repositories.session.get())?.staffId).toBe('st-anil');
    expect(done).toHaveBeenCalled();
  });

  it('"Show the login screens" signs out and opens the first login screen', async () => {
    const { app, visits } = await renderPanel('batch');
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Show the login screens' })));
    await waitFor(() => expect(visits).toEqual(['/login']));
    expect(await app.repositories.session.get()).toBeUndefined();
  });

  it('Stories holds only First-time user and Offline', async () => {
    await renderPanel();
    const stories = screen.getByRole('region', { name: 'Stories' });
    expect(within(stories).getAllByRole('button').map((b) => b.querySelector('span')?.textContent)).toEqual(['First-time user', 'Offline']);
  });

  it('Quick settings are always open: Voice Agent and its model (with the Scripted hint), Time of day, Network, Language', async () => {
    const { demo } = await renderPanel();
    const quick = screen.getByRole('region', { name: 'Quick settings' });
    expect(quick.closest('details')).toBeNull();
    const radios = (name: string) => within(within(quick).getByRole('radiogroup', { name })).getAllByRole('radio');
    const labels = (name: string) => radios(name).map((r) => r.textContent);
    expect(labels('Voice Agent')).toEqual(['Off', 'On']);
    expect(radios('Voice Agent')[1]).toHaveAttribute('aria-checked', 'true'); // a fresh demo has voice on
    expect(labels('Voice model')).toEqual(['Live', 'Scripted']);
    expect(labels('Time of day')).toEqual(['7:30', '10:15', '11:30', '2:30 PM', 'Real']);
    expect(labels('Network')).toEqual(['Online', 'Offline', 'Pending sync']);
    expect(labels('Language')).toEqual(['English', 'मराठी']);

    // Live by default (the presenting machine's choice): no hint. Scripted says what it means.
    expect(within(quick).queryByText('Scripted (no mic, no network)')).toBeNull();
    fireEvent.click(radios('Voice model')[1]);
    expect(demo.repo.get().simulation.voice).toBe('scripted');
    expect(within(quick).getByText('Scripted (no mic, no network)')).toBeInTheDocument();

    // Voice off: its model has nothing to choose.
    fireEvent.click(radios('Voice Agent')[0]);
    await waitFor(() => expect(within(quick).queryByRole('radiogroup', { name: 'Voice model' })).toBeNull());
    expect(within(quick).queryByText('Scripted (no mic, no network)')).toBeNull();

    // Time of day is the demo clock.
    fireEvent.click(radios('Time of day')[3]);
    expect(demo.repo.get().clock).toEqual({ mode: 'fixed', time: '14:30' });
  });

  it('Advanced keeps the rest (verification, marking, time fencing, staff, next sync) and none of the quick settings', async () => {
    await renderPanel();
    const advanced = screen.getByText('Advanced').closest('details')!;
    for (const name of ['Location', 'Frequency', 'Time fencing', 'Staff attendance', 'Next sync']) expect(within(advanced).getByRole('radiogroup', { name })).toBeInTheDocument();
    for (const name of ['Voice Agent', 'Voice model', 'Time of day', 'Demo clock', 'Network', 'Language']) expect(within(advanced).queryByRole('radiogroup', { name })).toBeNull();
  });
});

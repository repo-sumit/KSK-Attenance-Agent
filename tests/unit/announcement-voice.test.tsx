// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AnnouncementBanner } from '@/features/announcements/AnnouncementBanner';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { setup, signIn } from '../helpers/app';

const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({
  useSession: () => signed.ctx,
  useJourney: () => (signed.ctx as { journey: unknown }).journey,
}));
afterEach(cleanup);
beforeAll(() => {
  // jsdom has no modal dialogs: open/close the element the way the browser would.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    if (!this.hasAttribute('open')) return;
    this.removeAttribute('open');
    this.dispatchEvent(new Event('close'));
  };
});
/** The notices sheet is open (the native dialog, by its title). */
const sheetOpen = () => document.querySelector('dialog[open]') !== null;
const loaded = () => screen.findAllByText('Special holiday: institute closed');

async function mount() {
  const env = setup({ voice: { enabled: true } });
  signed.ctx = await signIn(env.app, 'PR-2741');
  const view = () => (
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <AnnouncementBanner />
      </I18nProvider>
    </ServicesProvider>
  );
  return { env, view };
}

describe('AnnouncementBanner and voice (D-139)', () => {
  it('opens the notices sheet on show_announcements', async () => {
    const { env, view } = await mount();
    render(view());
    await loaded();
    expect(sheetOpen()).toBe(false);
    act(() => void env.app.services.voiceBus.emit({ type: 'show_announcements' }));
    await waitFor(() => expect(sheetOpen()).toBe(true));
  });

  it('a banner that mounts after voice asked (Home opened by the same navigation) still opens the sheet', async () => {
    const { env, view } = await mount();
    env.app.services.voiceBus.emit({ type: 'navigate', href: '/home', replace: false });
    env.app.services.voiceBus.emit({ type: 'show_announcements' });
    render(view());
    await loaded();
    await waitFor(() => expect(sheetOpen()).toBe(true));
  });

  it('an older request is not replayed after voice navigated elsewhere', async () => {
    const { env, view } = await mount();
    env.app.services.voiceBus.emit({ type: 'show_announcements' });
    env.app.services.voiceBus.emit({ type: 'navigate', href: '/reports', replace: false });
    render(view());
    await loaded();
    expect(sheetOpen()).toBe(false);
  });
});

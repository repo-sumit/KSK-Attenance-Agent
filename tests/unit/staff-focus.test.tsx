// @vitest-environment jsdom
/**
 * The staff screen follows Voice Agent (D-156): the person voice asks about (`focus_staff`) scrolls into view and is
 * outlined, as a roster row is for `focus_student`; a screen that mounts after voice's navigation still shows it, and
 * a request older than voice's latest navigation is not replayed.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { StaffScreen } from '@/features/staff/StaffScreen';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import type { SessionContext } from '@/services/context';
import { setup, signIn } from '../helpers/app';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/attendance/staff',
  useSearchParams: () => new URLSearchParams(),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({
  useSession: () => signed.ctx,
  useJourney: () => (signed.ctx as SessionContext).journey,
}));
vi.mock('@/components/shell/ScreenLayout', () => ({
  ScreenLayout: ({ top, children, footer }: { top?: ReactNode; children?: ReactNode; footer?: ReactNode }) => (
    <main>
      {top}
      {children}
      {footer}
    </main>
  ),
}));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));

const scrolled: Element[] = [];
beforeAll(() => {
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolled.push(this);
  };
});
beforeEach(() => {
  scrolled.length = 0;
});
afterEach(cleanup);

type Bus = ReturnType<typeof setup>['app']['services']['voiceBus'];

async function mount(before?: (bus: Bus) => void) {
  const env = setup({});
  signed.ctx = await signIn(env.app, 'PR-2741');
  const bus = env.app.services.voiceBus;
  before?.(bus);
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          <StaffScreen />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  await waitFor(() => expect(document.querySelectorAll('[data-staff]').length).toBe(18));
  return { env, bus };
}

const row = (id: string) => document.querySelector<HTMLElement>(`[data-staff="${id}"]`)!;
const outlined = () => [...document.querySelectorAll<HTMLElement>('[data-current]')].map((el) => el.dataset.staff);

describe('the staff screen follows voice (focus_staff, D-156)', () => {
  it('the person voice asks about scrolls into view and is outlined; the next request moves the outline', async () => {
    const { bus } = await mount();
    expect(outlined()).toEqual([]);
    act(() => void bus.emit({ type: 'focus_staff', staffId: 'st-pradeep' }));
    await waitFor(() => expect(scrolled).toContain(row('st-pradeep')));
    expect(outlined()).toEqual(['st-pradeep']);
    expect(row('st-pradeep')).toHaveAttribute('aria-current', 'true');
    act(() => void bus.emit({ type: 'focus_staff', staffId: 'st-anil' }));
    await waitFor(() => expect(outlined()).toEqual(['st-anil']));
    expect(scrolled.at(-1)).toBe(row('st-anil'));
    // the same person asked again scrolls back into view
    scrolled.length = 0;
    act(() => void bus.emit({ type: 'focus_staff', staffId: 'st-anil' }));
    await waitFor(() => expect(scrolled).toContain(row('st-anil')));
    // the name is master data in Latin and "(you)" is translated text, so they sit in separate elements (U14)
    expect(row('st-anil')).toHaveTextContent(/Dr\. Anil Deshmukh\s*\(you\)/);
  });

  it('a screen that mounts after voice\'s navigation still shows the person; an older request is not replayed', async () => {
    await mount((bus) => {
      bus.emit({ type: 'navigate', href: '/attendance/staff', replace: false });
      bus.emit({ type: 'focus_staff', staffId: 'st-asha' });
    });
    await waitFor(() => expect(outlined()).toEqual(['st-asha']));
    expect(scrolled).toContain(row('st-asha'));
    cleanup();
    scrolled.length = 0;
    await mount((bus) => {
      bus.emit({ type: 'focus_staff', staffId: 'st-asha' });
      bus.emit({ type: 'navigate', href: '/home', replace: false });
    });
    expect(outlined()).toEqual([]);
    expect(scrolled).toEqual([]);
  });
});

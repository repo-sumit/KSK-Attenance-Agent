// @vitest-environment jsdom
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { SelfAttendanceScreen } from '@/features/staff/SelfAttendanceScreen';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import type { SessionContext } from '@/services/context';
import { setup, signIn } from '../helpers/app';

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn(), prefetch: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/me/attendance', useSearchParams: () => new URLSearchParams() }));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx, useJourney: () => (signed.ctx as SessionContext).journey }));
vi.mock('@/components/shell/ScreenLayout', () => ({
  ScreenLayout: ({ children, footer }: { children: ReactNode; footer?: ReactNode }) => (
    <main>
      {children}
      {footer}
    </main>
  ),
}));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Rajesh Patil on My attendance, with no check configured (the check itself is VerificationFlow's). */
async function mount(before?: (env: ReturnType<typeof setup>, ctx: SessionContext) => Promise<void>) {
  const env = setup({ voice: { enabled: true }, verification: { geoMode: 'off', face: false } });
  const ctx = await signIn(env.app, 'TR-10432');
  signed.ctx = ctx;
  await before?.(env, ctx);
  // the screen's query ends with hasPass (nothing else calls it here): each call is one load of the screen's data
  const reads = vi.spyOn(env.app.services.verification, 'hasPass');
  render(
    <ServicesProvider container={env.app}>
      <I18nProvider>
        <ToastProvider>
          <SelfAttendanceScreen />
        </ToastProvider>
      </I18nProvider>
    </ServicesProvider>,
  );
  /**
   * The screen has loaded its data `loads` times and rendered every load: act's async flush ends with a macrotask,
   * after each fetch and its state update, so a redirect the screen would make on that data has been made by then.
   */
  const settled = async (loads: number) => {
    await waitFor(() => expect(reads.mock.calls.length).toBeGreaterThanOrEqual(loads));
    await act(async () => void (await Promise.allSettled(reads.mock.results.map((r) => r.value as Promise<boolean>))));
  };
  return { env, ctx, bus: env.app.services.voiceBus, reads: reads as MockInstance, settled };
}

describe('My attendance follows voice (D-141): the saved mark shows as the screen\'s own result', () => {
  it('self_marked while the screen is open: the result, never Home', async () => {
    const { env, ctx, bus, settled } = await mount();
    await screen.findByRole('button', { name: 'Mark present' });
    const saved = await env.app.services.staffAttendance.markSelf(ctx);
    expect(saved.ok).toBe(true);
    act(() => void bus.emit({ type: 'self_marked', record: saved.ok ? saved.value : (undefined as never) }));
    expect(await screen.findByRole('heading', { name: 'Attendance marked' })).toBeInTheDocument();
    await settled(2); // the first load, then the reload the save announced (the record is in the data now)
    expect(router.replace).not.toHaveBeenCalledWith('/home');
    expect(screen.getByRole('heading', { name: 'Attendance marked' })).toBeInTheDocument();
  });

  it('a screen that mounts after voice saved it (the same navigation) replays the event and shows the result', async () => {
    const { settled } = await mount(async (env, ctx) => {
      const saved = await env.app.services.staffAttendance.markSelf(ctx);
      env.app.services.voiceBus.emit({ type: 'navigate', href: '/me/attendance', replace: false });
      env.app.services.voiceBus.emit({ type: 'self_marked', record: saved.ok ? saved.value : (undefined as never) });
    });
    expect(await screen.findByRole('heading', { name: 'Attendance marked' })).toBeInTheDocument();
    await settled(1); // its one load already holds the record: without the replayed event this would go Home
    expect(router.replace).not.toHaveBeenCalledWith('/home');
    expect(screen.getByRole('heading', { name: 'Attendance marked' })).toBeInTheDocument();
  });

  it('a self mark saved while the screen is open, with no event (a tap racing voice): the result, not Home', async () => {
    const { env, ctx, settled } = await mount();
    await screen.findByRole('button', { name: 'Mark present' });
    expect((await env.app.services.staffAttendance.markSelf(ctx)).ok).toBe(true);
    expect(await screen.findByRole('heading', { name: 'Attendance marked' })).toBeInTheDocument();
    await settled(2);
    expect(router.replace).not.toHaveBeenCalledWith('/home');
  });

  it('the principal marks the trainer while the screen is open: Home (the result screen is only for their own mark)', async () => {
    const { env } = await mount();
    await screen.findByRole('button', { name: 'Mark present' });
    const principal = await signIn(env.app, 'PR-2741');
    expect((await env.app.services.staffAttendance.markByPrincipal(principal, [{ staffId: 'st-rajesh', status: 'absent' }])).ok).toBe(true);
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
    expect(screen.queryByRole('heading', { name: 'Attendance marked' })).toBeNull();
  });

  it('opened when already marked (no voice): Home, as before', async () => {
    await mount(async (env, ctx) => void (await env.app.services.staffAttendance.markSelf(ctx)));
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/home'));
  });
});

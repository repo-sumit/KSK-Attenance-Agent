// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useActionBus } from '@/features/voice/useActionBus';
import { useScreenSync } from '@/features/voice/useScreenSync';
import { VoiceProvider } from '@/features/voice/VoiceProvider';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { useVoice, type VoiceApi } from '@/hooks/voice';
import type { SessionContext } from '@/services/context';
import type { AppContainer } from '@/services/container';
import { ActionBus } from '@/services/voice/action-bus';
import type { VoiceSession } from '@/services/voice/session';
import { setup, signIn } from '../../helpers/app';

// A fake router and URL stand in for Next's navigation hooks; the bus is the real (tiny) ActionBus.
const nav = vi.hoisted(() => ({ pathname: '/home', search: '', push: vi.fn(), replace: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: nav.push, replace: nav.replace }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
// The provider reads the signed-in context from here; a test swaps it to rebuild or change the session.
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx }));

beforeEach(() => {
  nav.pathname = '/home';
  nav.search = '';
  nav.push.mockReset();
  nav.replace.mockReset();
  window.history.replaceState(null, '', '/home');
});
afterEach(cleanup);

describe('useActionBus', () => {
  function mountBus(running: boolean) {
    const bus = new ActionBus();
    const stop = vi.fn();
    const container = { services: { voiceBus: bus } } as unknown as AppContainer;
    const wrapper = ({ children }: { children: ReactNode }) => <ServicesProvider container={container}>{children}</ServicesProvider>;
    renderHook(() => useActionBus({ running, stop }), { wrapper });
    return { bus, stop };
  }

  it('pushes a forward step and replaces for a gateway or result transition', () => {
    const { bus } = mountBus(true);
    bus.emit({ type: 'navigate', href: '/attendance/open?s=k', replace: false });
    expect(nav.push).toHaveBeenCalledWith('/attendance/open?s=k');
    expect(nav.replace).not.toHaveBeenCalled();
    bus.emit({ type: 'navigate', href: '/attendance/submitted?s=k', replace: true });
    expect(nav.replace).toHaveBeenCalledWith('/attendance/submitted?s=k');
    expect(nav.push).toHaveBeenCalledTimes(1);
  });

  it('skips a navigation to the URL the browser is already on (path and query), not one that differs', () => {
    const { bus } = mountBus(true);
    window.history.replaceState(null, '', '/attendance/review?s=k');
    bus.emit({ type: 'navigate', href: '/attendance/review?s=k', replace: false });
    bus.emit({ type: 'navigate', href: '/attendance/review?s=k', replace: true });
    expect(nav.push).not.toHaveBeenCalled();
    expect(nav.replace).not.toHaveBeenCalled();
    bus.emit({ type: 'navigate', href: '/attendance/review?s=other', replace: false });
    expect(nav.push).toHaveBeenCalledWith('/attendance/review?s=other');
  });

  it('end_voice does not stop a running session (it ends itself after its goodbye) but stops one that is not running', () => {
    const running = mountBus(true);
    running.bus.emit({ type: 'end_voice' });
    expect(running.stop).not.toHaveBeenCalled();
    const idle = mountBus(false);
    idle.bus.emit({ type: 'end_voice' });
    expect(idle.stop).toHaveBeenCalledTimes(1);
  });
});

describe('useScreenSync', () => {
  const fakeSession = () => ({ onScreen: vi.fn() }) as unknown as VoiceSession & { onScreen: ReturnType<typeof vi.fn> };

  it('reports a URL change once, with the screen signal of the new URL, and not the screen voice started on', () => {
    const session = fakeSession();
    const view = renderHook(() => useScreenSync(session));
    expect(session.onScreen).not.toHaveBeenCalled(); // the starting screen is described by the kickoff

    nav.pathname = '/attendance/mark';
    nav.search = 's=ele-s1u2.2026-09-25.daily';
    view.rerender();
    expect(session.onScreen).toHaveBeenCalledTimes(1);
    expect(session.onScreen).toHaveBeenCalledWith({ kind: 'mark', sessionKey: 'ele-s1u2.2026-09-25.daily' });

    view.rerender(); // a re-render on the same URL is not a screen change
    expect(session.onScreen).toHaveBeenCalledTimes(1);

    nav.pathname = '/home';
    nav.search = '';
    view.rerender();
    expect(session.onScreen).toHaveBeenCalledTimes(2);
    expect(session.onScreen).toHaveBeenLastCalledWith({ kind: 'home' });
  });

  it('reports nothing without a session, and not the first URL of a session that appears later', () => {
    const session = fakeSession();
    const view = renderHook(({ s }: { s: VoiceSession | null }) => useScreenSync(s), { initialProps: { s: null as VoiceSession | null } });
    nav.pathname = '/reports';
    view.rerender({ s: null });
    view.rerender({ s: session });
    expect(session.onScreen).not.toHaveBeenCalled();
    nav.pathname = '/home';
    view.rerender({ s: session });
    expect(session.onScreen).toHaveBeenCalledTimes(1);
  });
});

describe('VoiceProvider: the fingerprint stop', () => {
  let api: VoiceApi;
  function Probe() {
    api = useVoice();
    return <span data-testid="status">{api.state?.status ?? 'off'}</span>;
  }
  const tree = (app: AppContainer) => (
    <ServicesProvider container={app}>
      <I18nProvider>
        <VoiceProvider>
          <Probe />
        </VoiceProvider>
      </I18nProvider>
    </ServicesProvider>
  );

  async function running() {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    const ctx = await signIn(env.app, 'TR-10432');
    signed.ctx = ctx;
    const view = render(tree(env.app));
    act(() => api.start());
    await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('listening'));
    const session = env.app.services.voice.current()!;
    return { env, ctx, view, session };
  }

  it('keeps the session when the context is rebuilt with an equal configuration (the demo does this on every panel change)', async () => {
    const { env, ctx, view, session } = await running();
    const rebuilt: SessionContext = (await env.app.services.session.load())!;
    expect(rebuilt).not.toBe(ctx);
    signed.ctx = rebuilt;
    view.rerender(tree(env.app));
    expect(screen.getByTestId('status')).toHaveTextContent('listening');
    expect(session.getState().status).toBe('listening');
  });

  it('stops the session when the configuration changes', async () => {
    const { env, view, session } = await running();
    env.setConfig({ voice: { enabled: true }, marking: { defaultStatus: 'blank' } });
    signed.ctx = (await env.app.services.session.load())!;
    view.rerender(tree(env.app));
    await waitFor(() => expect(session.getState().status).toBe('ended'));
    expect(screen.getByTestId('status')).toHaveTextContent('off');
  });

  it('stops the session when another user signs in', async () => {
    const { env, ctx, view, session } = await running();
    signed.ctx = { ...ctx, user: { ...ctx.user, id: 'st-someone-else' } };
    view.rerender(tree(env.app));
    await waitFor(() => expect(session.getState().status).toBe('ended'));
    expect(screen.getByTestId('status')).toHaveTextContent('off');
  });

  it('settle (D-148): the cap scales with the simulation speed; at once while voice is off', async () => {
    const { env, session, view } = await running();
    const quiet = vi.spyOn(session, 'whenQuiet');
    env.simulation.update({ speed: 0.5 });
    const controller = new AbortController();
    const waiting = api.settle(4000, controller.signal);
    expect(quiet).toHaveBeenCalledWith(2000, controller.signal);
    controller.abort();
    await waiting;
    act(() => api.stop());
    view.unmount();
    render(tree(env.app));
    await expect(api.settle(4000)).resolves.toBeUndefined(); // no session: nothing to wait for
  });

  it('stops the session when the provider unmounts (sign-out)', async () => {
    const { view, session } = await running();
    view.unmount();
    expect(session.getState().status).toBe('ended');
  });
});

describe('VoiceProvider: announcements and focus when voice ends (m14, C8)', () => {
  let api: VoiceApi;
  /** A stand-in screen: its main region and a row. Stop voice is the provider's own voice card (VoiceFloat, D-133). */
  function Screen() {
    api = useVoice();
    return (
      <main id="main" tabIndex={-1}>
        <button type="button">Row</button>
      </main>
    );
  }
  const tree = (app: AppContainer) => (
    <ServicesProvider container={app}>
      <I18nProvider>
        <VoiceProvider>
          <Screen />
        </VoiceProvider>
      </I18nProvider>
    </ServicesProvider>
  );
  const region = (kind: 'error' | 'status') => document.querySelector(`[data-voice-announce="${kind}"]`)!;

  async function mount(deny = false) {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    if (deny) env.app.services.voice.scripted.denyNextMic('permission_denied');
    signed.ctx = await signIn(env.app, 'TR-10432');
    const view = render(tree(env.app));
    return { env, view };
  }

  it('Stop voice moves focus to the screen’s main region and says “Voice ended” from a region that was already there', async () => {
    await mount();
    const status = region('status');
    expect(status).toHaveAttribute('role', 'status');
    expect(status).toHaveTextContent('');
    act(() => api.start());
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    const stop = screen.getByRole('button', { name: 'Stop voice' });
    stop.focus();
    expect(document.activeElement).toBe(stop);
    fireEvent.click(stop);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Stop voice' })).toBeNull());
    expect(document.activeElement).toBe(document.getElementById('main'));
    expect(region('status')).toBe(status); // the same node: it never re-mounted
    expect(status).toHaveTextContent('Voice ended');
    // Voice on again: the old line is cleared, so the next end is a new announcement.
    act(() => api.start());
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    expect(status).toHaveTextContent('');
  });

  it('a session that ends itself leaves focus where the trainer put it (a row), and still says it ended', async () => {
    const { env } = await mount();
    act(() => api.start());
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    const row = screen.getByRole('button', { name: 'Row' });
    row.focus();
    act(() => env.app.services.voice.current()!.stop());
    await waitFor(() => expect(api.state).toBeNull());
    expect(document.activeElement).toBe(row);
    expect(region('status')).toHaveTextContent('Voice ended');
  });

  it('a new error is read from a persistent alert that is empty until the error arrives', async () => {
    await mount(true);
    const alert = region('error');
    expect(alert).toHaveAttribute('role', 'alert');
    expect(alert).toHaveTextContent('');
    act(() => api.start());
    await waitFor(() => expect(alert).toHaveTextContent('Microphone is blocked. Allow it in settings, or use the screen.'));
    expect(region('error')).toBe(alert);
    act(() => api.stop());
    await waitFor(() => expect(alert).toHaveTextContent(''));
  });
});

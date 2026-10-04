// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VoiceFloat } from '@/features/voice/VoiceFloat';
import { VoiceProvider } from '@/features/voice/VoiceProvider';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { useVoice, VoiceContext, type VoiceApi } from '@/hooks/voice';
import type { AppContainer } from '@/services/container';
import { VoiceSession, type VoiceState } from '@/services/voice/session';
import { setup, signIn } from '../../helpers/app';

const nav = vi.hoisted(() => ({ pathname: '/home', search: '' }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx }));

beforeEach(() => {
  nav.pathname = '/home';
  nav.search = '';
  window.history.replaceState(null, '', '/home');
});
afterEach(cleanup);

const RUNNING: VoiceState = { status: 'listening', error: null, captions: [], level: 0.4, pushToTalk: false, talking: false, canReconnect: false, minutesLeft: 10, focus: null };
const spies = () => ({ start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), reconnect: vi.fn(), setPushToTalk: vi.fn(), talk: vi.fn() });

/** A fake provider around the one floating element; `set` swaps the voice state as a session would. */
function fake(initial: Partial<VoiceApi> = {}) {
  const spy = spies();
  let set!: (patch: Partial<VoiceApi>) => void;
  function Harness({ children }: { readonly children?: ReactNode }) {
    const [api, setApi] = useState<VoiceApi>({ available: true, online: true, state: null, ...spy, ...initial });
    set = (patch) => setApi((a) => ({ ...a, ...patch }));
    return (
      <VoiceContext.Provider value={api}>
        {children}
        <VoiceFloat />
      </VoiceContext.Provider>
    );
  }
  const { app } = setup();
  const view = render(
    <ServicesProvider container={app}>
      <I18nProvider>
        <Harness />
      </I18nProvider>
    </ServicesProvider>,
  );
  return { spy, view, set: (patch: Partial<VoiceApi>) => act(() => set(patch)) };
}

const html = () => document.documentElement;

describe('VoiceFloat: the idle button', () => {
  it('renders nothing without a provider (voice is not available there)', () => {
    const { app } = setup();
    const { container } = render(
      <ServicesProvider container={app}>
        <I18nProvider>
          <VoiceFloat />
        </I18nProvider>
      </ServicesProvider>,
    );
    expect(container).toBeEmptyDOMElement();
    expect(html()).not.toHaveAttribute('data-voice-float');
  });

  it('is shown only while voice is available and off, named "Voice mode" with the hint as its description', () => {
    const { set } = fake({ available: false });
    expect(screen.queryByRole('button', { name: 'Voice mode' })).toBeNull();
    set({ available: true });
    const button = screen.getByRole('button', { name: 'Voice mode' });
    expect(button).toHaveAccessibleDescription('Speak to choose a batch and mark attendance.');
    expect(button).not.toHaveAttribute('aria-disabled');
    set({ state: RUNNING });
    expect(screen.queryByRole('button', { name: 'Voice mode' })).toBeNull();
  });

  it('starts voice synchronously inside the click, once for a double tap', () => {
    const { spy } = fake();
    const button = screen.getByRole('button', { name: 'Voice mode' });
    fireEvent.click(button, { detail: 1 });
    expect(spy.start).toHaveBeenCalledTimes(1); // no await between the tap and start(): the AudioContexts are made in it
    fireEvent.click(button, { detail: 2 });
    expect(spy.start).toHaveBeenCalledTimes(1);
  });

  it('is inactive offline, with the offline reason as its description, and does not start', () => {
    const { spy } = fake({ online: false });
    const button = screen.getByRole('button', { name: 'Voice mode' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Voice mode needs the internet.');
    fireEvent.click(button);
    expect(spy.start).not.toHaveBeenCalled();
  });

  it('is a round mic button on phones and an extended pill with the text from 600px (the label is visually hidden below 600px, never removed)', () => {
    fake();
    const label = screen.getByText('Voice mode');
    expect(screen.getByRole('button', { name: 'Voice mode' })).toContainElement(label);
    expect(label.className).toMatch(/fabLabel/);
    const css = readFileSync(path.resolve(__dirname, '../../../src/features/voice/VoiceFloat.module.css'), 'utf8');
    const wide = css.slice(css.indexOf('@media (min-width: 600px)'));
    expect(css.indexOf('@media (min-width: 600px)')).toBeGreaterThan(-1);
    expect(css).toMatch(/\.fabLabel\s*\{[^}]*clip-path:\s*inset\(50%\)/); // phones: hidden visually, kept for screen readers
    expect(wide).toMatch(/\.fabLabel\s*\{[^}]*position:\s*static/); // 600px and up: the text shows
  });

  it('marks <html> so screens reserve room for it, and clears the mark when it goes', () => {
    const { set } = fake();
    expect(html()).toHaveAttribute('data-voice-float', 'button');
    set({ state: RUNNING });
    expect(html()).toHaveAttribute('data-voice-float', 'card');
    set({ state: null, available: false });
    expect(html()).not.toHaveAttribute('data-voice-float');
  });
});

describe('VoiceFloat: the card while voice runs', () => {
  it('shows the dock parts: status as icon + text, the caption, Use screen and Stop voice', () => {
    const { spy } = fake({ state: { ...RUNNING, captions: [{ who: 'agent', text: 'Which batch?', final: false }] } });
    const card = screen.getByRole('region', { name: 'Voice mode' });
    expect(card).toHaveAttribute('data-voice-status', 'listening');
    expect(screen.getByText('Listening').closest('[data-icon]')).toHaveAttribute('data-icon', 'mic');
    expect(card).toHaveTextContent('Sahayak: Which batch?');
    fireEvent.click(screen.getByRole('button', { name: 'Use screen' }));
    expect(spy.pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(spy.stop).toHaveBeenCalledTimes(1);
  });

  it('minimizes to a round status button (the status text is its name) while voice keeps running, and expands again', () => {
    const { spy } = fake({ state: RUNNING });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    expect(screen.queryByRole('region', { name: 'Voice mode' })).toBeNull();
    const mini = screen.getByRole('button', { name: 'Listening' });
    expect(mini).toHaveAttribute('aria-expanded', 'false');
    expect(mini).toHaveAccessibleDescription('Show voice controls');
    expect(mini.querySelector('[data-icon="mic"]')).not.toBeNull();
    expect(mini).toHaveAttribute('data-tone', 'success');
    expect(document.activeElement).toBe(mini);
    expect(spy.stop).not.toHaveBeenCalled();
    expect(html()).toHaveAttribute('data-voice-float', 'button');
    fireEvent.click(mini);
    expect(screen.getByRole('region', { name: 'Voice mode' })).toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Minimize voice controls' }));
  });

  it('the minimized button follows the status (push-to-talk shut reads Hold to talk)', () => {
    const { set } = fake({ state: RUNNING });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    set({ state: { ...RUNNING, status: 'speaking' } });
    expect(screen.getByRole('button', { name: 'Speaking' })).toHaveAttribute('data-tone', 'info');
    set({ state: { ...RUNNING, pushToTalk: true } });
    expect(screen.getByRole('button', { name: 'Hold to talk' }).querySelector('[data-icon="mic-off"]')).not.toBeNull();
  });

  it('an error opens the card again and has no minimize (voice has stopped: Reconnect or Stop)', () => {
    const { set, spy } = fake({ state: RUNNING });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    set({ state: { ...RUNNING, status: 'error', error: 'dropped', canReconnect: true } });
    expect(screen.getByRole('region', { name: 'Voice mode' })).toHaveAttribute('data-voice-status', 'error');
    expect(screen.queryByRole('button', { name: 'Minimize voice controls' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(spy.reconnect).toHaveBeenCalledTimes(1);
  });

  it('voice ending brings the idle button back, and the next start opens the card (not minimized)', () => {
    const { set } = fake({ state: RUNNING });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    set({ state: null });
    expect(screen.getByRole('button', { name: 'Voice mode' })).toBeInTheDocument();
    set({ state: RUNNING });
    expect(screen.getByRole('region', { name: 'Voice mode' })).toBeInTheDocument();
  });
});

describe('VoiceFloat inside VoiceProvider', () => {
  let api: VoiceApi;
  function Screen({ name }: { readonly name: string }) {
    api = useVoice();
    return <main id="main" tabIndex={-1}>{name}</main>;
  }
  const tree = (app: AppContainer, name: string) => (
    <ServicesProvider container={app}>
      <I18nProvider>
        <VoiceProvider>
          <Screen key={name} name={name} />
        </VoiceProvider>
      </I18nProvider>
    </ServicesProvider>
  );

  async function mount() {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    signed.ctx = await signIn(env.app, 'TR-10432');
    const view = render(tree(env.app, 'Home'));
    return { env, view };
  }

  it('renders one floating element for the whole session, outside the screens, that keeps its state across a route change', async () => {
    const { env, view } = await mount();
    expect(document.querySelectorAll('[data-voice-float]:not(html)')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Voice mode' }));
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    const mini = screen.getByRole('button', { name: 'Listening' });
    // Another screen (a route change re-renders the screen under the provider; the float is not part of it).
    view.rerender(tree(env.app, 'Reports'));
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listening' })).toBe(mini); // the same node: no re-mount
    expect(document.querySelectorAll('[data-voice-float]:not(html)')).toHaveLength(1);
  });

  it('tells the session which screen voice started on (not Home), before the kickoff reads the flow', async () => {
    const onScreen = vi.spyOn(VoiceSession.prototype, 'onScreen');
    await mount();
    window.history.replaceState(null, '', '/attendance/mark?s=ele-s1u2.2026-09-25.daily');
    act(() => api.start());
    expect(onScreen).toHaveBeenCalledWith({ kind: 'mark', sessionKey: 'ele-s1u2.2026-09-25.daily' });
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    act(() => api.stop());
    onScreen.mockClear();
    window.history.replaceState(null, '', '/home');
    act(() => api.start());
    expect(onScreen).not.toHaveBeenCalled(); // Home is where the kickoff starts anyway
  });
});

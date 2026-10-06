// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ScreenLayout } from '@/components/shell/ScreenLayout';
import { VoiceFloat } from '@/features/voice/VoiceFloat';
import { VoiceProvider } from '@/features/voice/VoiceProvider';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { useVoice, VoiceContext, type VoiceApi } from '@/hooks/voice';
import type { AppContainer } from '@/services/container';
import { GEMINI_LIVE_ORIGIN } from '@/services/voice/live/origin';
import { VoiceService } from '@/services/voice/service';
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
const dom = vi.hoisted(() => ({ preconnect: vi.fn() }));
vi.mock('react-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-dom')>()), preconnect: dom.preconnect }));

beforeEach(() => {
  nav.pathname = '/home';
  nav.search = '';
  window.history.replaceState(null, '', '/home');
});
afterEach(cleanup);

const RUNNING: VoiceState = { status: 'listening', error: null, captions: [], level: 0.4, pushToTalk: false, talking: false, canReconnect: false, minutesLeft: 10, focus: null, micHeld: null };
const spies = () => ({ start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), reconnect: vi.fn(), setPushToTalk: vi.fn(), talk: vi.fn(), settle: vi.fn(async () => undefined) });

/** A fake provider around the one floating element; `set` swaps the voice state as a session would. */
function fake(initial: Partial<VoiceApi> = {}, voiceMode: 'live' | 'scripted' = 'live', page?: ReactNode) {
  const spy = spies();
  let set!: (patch: Partial<VoiceApi>) => void;
  function Harness({ children }: { readonly children?: ReactNode }) {
    const [api, setApi] = useState<VoiceApi>({ available: true, marks: true, online: true, state: null, ...spy, ...initial });
    set = (patch) => setApi((a) => ({ ...a, ...patch }));
    return (
      <VoiceContext.Provider value={api}>
        {children}
        <VoiceFloat />
      </VoiceContext.Provider>
    );
  }
  const { app, simulation } = setup();
  simulation.update({ voice: voiceMode });
  const view = render(
    <ServicesProvider container={app}>
      <I18nProvider>
        <Harness>{page}</Harness>
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

  it('is shown only while voice is available and off, named "Voice Agent" with the hint as its description', () => {
    const { set } = fake({ available: false });
    expect(screen.queryByRole('button', { name: 'Voice Agent' })).toBeNull();
    set({ available: true });
    const button = screen.getByRole('button', { name: 'Voice Agent' });
    expect(button).toHaveAccessibleDescription('Speak to choose a batch and mark attendance.');
    expect(button).not.toHaveAttribute('aria-disabled');
    set({ state: RUNNING });
    expect(screen.queryByRole('button', { name: 'Voice Agent' })).toBeNull();
  });

  it('the hint follows the voice plan: marking batches, or asking about attendance, reports and staff', () => {
    fake({ marks: false });
    expect(screen.getByRole('button', { name: 'Voice Agent' })).toHaveAccessibleDescription('Speak to ask about attendance, reports and staff.');
  });

  it('starts voice synchronously inside the click, once for a double tap', () => {
    const { spy } = fake();
    const button = screen.getByRole('button', { name: 'Voice Agent' });
    fireEvent.click(button, { detail: 1 });
    expect(spy.start).toHaveBeenCalledTimes(1); // no await between the tap and start(): the AudioContexts are made in it
    fireEvent.click(button, { detail: 2 });
    expect(spy.start).toHaveBeenCalledTimes(1);
  });

  it('is inactive offline, with the offline reason as its description, and does not start', () => {
    const { spy } = fake({ online: false });
    const button = screen.getByRole('button', { name: 'Voice Agent' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).toHaveAccessibleDescription('Voice Agent needs the internet.');
    fireEvent.click(button);
    expect(spy.start).not.toHaveBeenCalled();
  });

  it('is a round mic button below 1136px and an extended pill with the text from 1136px (the label is visually hidden below, never removed)', () => {
    fake();
    const label = screen.getByText('Voice Agent');
    expect(screen.getByRole('button', { name: 'Voice Agent' })).toContainElement(label);
    expect(label.className).toMatch(/fabLabel/);
    const css = readFileSync(path.resolve(__dirname, '../../../src/features/voice/VoiceFloat.module.css'), 'utf8');
    const pill = css.indexOf('@media (min-width: 1136px)');
    expect(pill).toBeGreaterThan(-1);
    expect(css).toMatch(/\.fabLabel\s*\{[^}]*clip-path:\s*inset\(50%\)/); // below 1136px: hidden visually, kept for screen readers
    expect(css.slice(0, pill)).not.toMatch(/\.fabLabel\s*\{[^}]*position:\s*static/);
    expect(css.slice(pill)).toMatch(/\.fabLabel\s*\{[^}]*position:\s*static/); // 1136px and up: the text shows
  });

  it('is one viewport overlay (D-147): one corner from --float-inset, lifted by the pinned dock and the floating demo pill, never a band', () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../src', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const float = read('features/voice/VoiceFloat.module.css');
    // Whitespace-tolerant: a formatter may wrap calc(...) over lines.
    expect(float).toMatch(/\.float\s*\{[^}]*--float-inset:\s*var\(--space-16\);/);
    expect(float).toMatch(/\.float\s*\{[^}]*position:\s*fixed;/);
    expect(float).toMatch(/\.float\s*\{[^}]*z-index:\s*var\(--z-voice\);/);
    expect(float).toMatch(/\.float\s*\{[^}]*right:\s*calc\(\s*env\(safe-area-inset-right\)\s*\+\s*var\(--float-inset\)\s*\);/);
    expect(float).toMatch(/\.float\s*\{[^}]*bottom:\s*calc\(\s*var\(--float-dock,\s*0px\)\s*\+\s*var\(--float-inset\)\s*\+\s*var\(--demo-reserve-block-end\)\s*\);/);
    expect(float).toMatch(/\.float\s*\{[^}]*transition:\s*bottom\s+var\(--motion-base\)/);
    expect(float).toMatch(/@media\s*\(min-width:\s*600px\)\s*\{\s*\.float\s*\{\s*--float-inset:\s*var\(--space-24\);/);
    // The open demo drawer (600px and up): the widget moves left of it.
    expect(float).toMatch(/:global\(html\[data-demo-drawer\]\)\s*\.float\s*\{[^}]*right:\s*calc\(\s*env\(safe-area-inset-right\)\s*\+\s*var\(--overlay-width-drawer\)\s*\+\s*var\(--float-inset\)\s*\);/);
    // The card never squeezes beside the drawer: where the room left of it is narrower than the card (600 to ~790px)
    // it keeps its own width and overlaps the drawer's left edge, its right edge clamped to stay on screen.
    const drawerCard = float.match(/:global\(html\[data-demo-drawer\]\)\s*\.asCard\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(drawerCard).toMatch(/right:\s*min\(\s*calc\(\s*env\(safe-area-inset-right\)\s*\+\s*var\(--overlay-width-drawer\)\s*\+\s*var\(--float-inset\)\s*\),\s*calc\(\s*100vw\s*-\s*var\(--overlay-width-voice\)\s*-\s*var\(--float-inset\)\s*\)\s*\);/);
    expect(drawerCard).not.toMatch(/max-width:[^;]*--overlay-width-drawer/);
    // The button, the mini button and the card share the corner: no per-mode offsets, nothing from a screen's column.
    expect(float).not.toMatch(/--float-(left|right|width|bottom)\b/);
    expect(float).not.toMatch(/\.asButton\s*\{[^}]*(bottom|right):/);
    // One scroll spacer for the button and the card; no band.
    expect(float).toMatch(/:global\(html\[data-voice-float\]\)\s*\{\s*--voice-reserve-block-end:\s*calc\(\s*var\(--voice-float-height\)\s*\+\s*var\(--space-24\)\s*\+\s*var\(--space-8\)\s*\);/);
    expect(float).not.toMatch(/data-voice-float=/);
    for (const file of ['features/voice/VoiceFloat.module.css', 'components/shell/ScreenLayout.module.css', 'styles/tokens.css']) {
      expect(read(file), file).not.toMatch(/--voice-space|floatAnchor/);
    }
    // Card screens keep no spacer (the widget is outside the card). Inline-footer screens from 600px keep no spacer that
    // follows the widget's size (their dock follows the content, so it would move it, and the widget with it, when the
    // button grows into the card): the frame keeps the resting card's room under the dock instead, the same in every
    // mode, so main never changes and the content never sits under the widget.
    const layout = read('components/shell/ScreenLayout.module.css');
    expect(layout).toMatch(/\.card\s*\{[^}]*--voice-reserve-block-end:\s*0px;/);
    expect(layout).toMatch(/\.inlineFooter\s*\{\s*--voice-reserve-block-end:\s*0px;\s*\}/);
    // The resting room is for inline-footer screens outside a card only (a card's widget sits outside it).
    expect(layout).toMatch(/\.inlineFooter:not\(\.card\)\s*\{\s*padding-bottom:\s*calc\(\s*var\(--voice-reserve-resting\)\s*\+\s*var\(--demo-reserve-block-end\)\s*\);\s*\}/);
    expect(layout).not.toMatch(/\.inlineFooter\s*\{[^}]*padding-bottom/);
    expect(float).toMatch(/:global\(html\[data-voice-float\]\)\s*\{[^}]*--voice-reserve-resting:\s*calc\(\s*var\(--overlay-height-voice\)\s*\+\s*var\(--space-24\)\s*\+\s*var\(--space-8\)\s*\);/);
    expect(read('styles/tokens.css')).toMatch(/--overlay-height-voice:\s*128px;[\s\S]*--voice-reserve-resting:\s*0px;/);
    // A toast sits above the widget, which the floating demo pill lifts as well.
    expect(read('components/ui/Toast.module.css')).toMatch(/\.region\s*\{[^}]*bottom:\s*calc\(\s*var\(--space-16\)\s*\+\s*var\(--voice-reserve-block-end\)\s*\+\s*var\(--demo-reserve-block-end\)\s*\);/);
  });

  it('marks <html> so screens keep scroll room for it (button and card alike), and clears the mark when it goes', () => {
    const { set } = fake();
    expect(html()).toHaveAttribute('data-voice-float', 'button');
    set({ state: RUNNING });
    expect(html()).toHaveAttribute('data-voice-float', 'card'); // the one html[data-voice-float] rule applies to both
    set({ state: null, available: false });
    expect(html()).not.toHaveAttribute('data-voice-float');
  });
});

describe('VoiceFloat: one viewport overlay (D-147)', () => {
  // stubDock sets the viewport height; restoreMocks does not put a plain property back, so every test here does.
  const viewportHeight = window.innerHeight;
  afterEach(() => {
    window.innerHeight = viewportHeight;
  });
  /**
   * Every element's box is empty, except the screen's dock: `top`..`bottom` (800px viewport), and with `action`, the
   * footer inside it (x `action`) and the float (56px round button or 360×126px card, right edge 744: a 768px window).
   */
  function stubDock(top: number, bottom: number, action?: { left: number; right: number }) {
    window.innerHeight = 800;
    const empty = { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    const box = (t: number, b: number, l: number, r: number) => ({ top: t, bottom: b, left: l, right: r, width: r - l, height: b - t, x: l, y: t, toJSON: () => ({}) });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (/dock/.test(this.className)) return { ...empty, top, bottom, right: 360, width: 360, height: bottom - top, y: top };
      if (!action) return empty;
      if (/footer/.test(this.className)) return box(top, bottom, action.left, action.right);
      if (this.hasAttribute('data-voice-float')) return this.querySelector('section') ? box(0, 126, 384, 744) : box(0, 56, 688, 744);
      return empty;
    });
  }
  const page = (width: 'form' | 'wide', footer = true) => (
    <ScreenLayout banner={false} width={width} footer={footer ? <button type="button">Save</button> : undefined}>
      <p>Rows</p>
    </ScreenLayout>
  );
  const float = () => document.querySelector<HTMLElement>('div[data-voice-float]')!;

  it('is portaled to document.body: outside every screen, so it never takes layout space', () => {
    stubDock(712, 800);
    fake({}, 'live', page('wide'));
    expect(float().parentElement).toBe(document.body);
    expect(document.querySelector('main')!.parentElement!.contains(float())).toBe(false);
  });

  it('lifts itself over the screen\'s pinned dock (--float-dock), with no column variables', () => {
    stubDock(712, 800);
    fake({ state: RUNNING }, 'live', page('wide'));
    expect(float().style.getPropertyValue('--float-dock')).toBe('88px');
    for (const name of ['--float-left', '--float-right', '--float-width', '--float-bottom']) expect(float().style.getPropertyValue(name)).toBe('');
  });

  it('takes the corner (--float-dock 0px) when the dock follows the content mid-page', () => {
    stubDock(400, 480);
    fake({ state: RUNNING }, 'live', page('form'));
    expect(float().style.getPropertyValue('--float-dock')).toBe('0px');
  });

  it('on a dock that follows the content, keeps the corner beside the action and lifts the card over the action it would cover', () => {
    // A 768px window: the footer's action (x 244–524) ends 120px above the edge.
    stubDock(596, 680, { left: 244, right: 524 });
    // The browser's ResizeObserver tells the hook the float grew into the card (jsdom has none).
    const resized: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          resized.push(callback);
        }
        observe() {}
        disconnect() {}
      },
    );
    try {
      const { set } = fake({}, 'live', page('form'));
      expect(float().style.getPropertyValue('--float-dock')).toBe('0px'); // the round button (x 688–744) sits beside it
      set({ state: RUNNING });
      act(() => resized.forEach((callback) => callback()));
      expect(float().style.getPropertyValue('--float-dock')).toBe('204px'); // the card (x 384–744) would reach it
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('sits at the same place on a form screen and a wide screen (nothing follows the content column)', () => {
    stubDock(712, 800);
    fake({}, 'live', page('form'));
    const onForm = { style: float().getAttribute('style'), className: float().className };
    cleanup();
    fake({}, 'live', page('wide'));
    expect({ style: float().getAttribute('style'), className: float().className }).toEqual(onForm);
  });
});

describe('VoiceFloat: start-up prefetch (D-138)', () => {
  it('starts from the default viewport height (the overlay tests put theirs back)', () => {
    expect(window.innerHeight).toBe(768);
  });

  let idle: (() => void)[];
  beforeEach(() => {
    dom.preconnect.mockClear();
    idle = [];
    window.requestIdleCallback = ((cb: IdleRequestCallback) => idle.push(() => cb({ didTimeout: false, timeRemaining: () => 50 })) as number) as typeof window.requestIdleCallback;
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(window, 'requestIdleCallback');
  });
  const runIdle = () => act(() => idle.splice(0).forEach((cb) => cb()));

  it('once the idle button shows online: preconnects to the Gemini origin and prefetches in an idle moment, once per page load', () => {
    const prefetch = vi.spyOn(VoiceService.prototype, 'prefetch').mockImplementation(() => undefined);
    const { set } = fake();
    expect(dom.preconnect).toHaveBeenCalledWith(GEMINI_LIVE_ORIGIN, { crossOrigin: 'anonymous' });
    expect(prefetch).not.toHaveBeenCalled(); // waits for an idle moment
    runIdle();
    expect(prefetch).toHaveBeenCalledTimes(1);
    set({ state: RUNNING });
    set({ state: null });
    runIdle();
    expect(prefetch).toHaveBeenCalledTimes(1);
    expect(dom.preconnect).toHaveBeenCalledTimes(1);
  });

  it('does nothing offline or while voice is unavailable, and starts once voice comes online', () => {
    const prefetch = vi.spyOn(VoiceService.prototype, 'prefetch').mockImplementation(() => undefined);
    const { set } = fake({ online: false });
    runIdle();
    set({ online: true, available: false });
    runIdle();
    expect(prefetch).not.toHaveBeenCalled();
    expect(dom.preconnect).not.toHaveBeenCalled();
    set({ available: true });
    runIdle();
    expect(prefetch).toHaveBeenCalledTimes(1);
  });

  it('scripted voice (demo and E2E): no preconnect and no prefetch, since no live connection will follow', () => {
    const prefetch = vi.spyOn(VoiceService.prototype, 'prefetch');
    fake({}, 'scripted');
    runIdle();
    expect(dom.preconnect).not.toHaveBeenCalled();
    expect(prefetch).not.toHaveBeenCalled();
  });

  it('without requestIdleCallback it waits 2 s', () => {
    Reflect.deleteProperty(window, 'requestIdleCallback');
    vi.useFakeTimers();
    try {
      const prefetch = vi.spyOn(VoiceService.prototype, 'prefetch').mockImplementation(() => undefined);
      fake();
      act(() => vi.advanceTimersByTime(1999));
      expect(prefetch).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1));
      expect(prefetch).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('VoiceFloat: the card while voice runs', () => {
  it('shows the dock parts: status as icon + text, the caption, Pause and Stop voice', () => {
    const { spy } = fake({ state: { ...RUNNING, captions: [{ who: 'agent', text: 'Which batch?', final: false }] } });
    const card = screen.getByRole('region', { name: 'Voice Agent' });
    expect(card).toHaveAttribute('data-voice-status', 'listening');
    expect(screen.getByText('Listening').closest('[data-icon]')).toHaveAttribute('data-icon', 'mic');
    expect(card).toHaveTextContent('Voice Agent: Which batch?');
    fireEvent.click(screen.getByRole('button', { name: 'Pause voice' }));
    expect(spy.pause).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(spy.stop).toHaveBeenCalledTimes(1);
  });

  it('minimizes to a round status button (the status text is its name) while voice keeps running, and expands again', () => {
    const { spy } = fake({ state: RUNNING });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    expect(screen.queryByRole('region', { name: 'Voice Agent' })).toBeNull();
    const mini = screen.getByRole('button', { name: 'Listening' });
    expect(mini).toHaveAttribute('aria-expanded', 'false');
    expect(mini).toHaveAccessibleDescription('Show voice controls');
    expect(mini.querySelector('[data-icon="mic"]')).not.toBeNull();
    expect(mini).toHaveAttribute('data-tone', 'success');
    expect(document.activeElement).toBe(mini);
    expect(spy.stop).not.toHaveBeenCalled();
    expect(html()).toHaveAttribute('data-voice-float', 'button');
    fireEvent.click(mini);
    expect(screen.getByRole('region', { name: 'Voice Agent' })).toBeInTheDocument();
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
    expect(screen.getByRole('region', { name: 'Voice Agent' })).toHaveAttribute('data-voice-status', 'error');
    expect(screen.queryByRole('button', { name: 'Minimize voice controls' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(spy.reconnect).toHaveBeenCalledTimes(1);
  });

  it('voice ending brings the idle button back, and the next start opens the card (not minimized)', () => {
    const { set } = fake({ state: RUNNING });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    set({ state: null });
    expect(screen.getByRole('button', { name: 'Voice Agent' })).toBeInTheDocument();
    set({ state: RUNNING });
    expect(screen.getByRole('region', { name: 'Voice Agent' })).toBeInTheDocument();
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
    expect(document.querySelector('[data-voice-float]:not(html)')!.parentElement).toBe(document.body); // a portal
    fireEvent.click(screen.getByRole('button', { name: 'Voice Agent' }));
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    const mini = screen.getByRole('button', { name: 'Listening' });
    // Another screen (a route change re-renders the screen under the provider; the float is not part of it).
    view.rerender(tree(env.app, 'Reports'));
    expect(screen.getByText('Reports')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listening' })).toBe(mini); // the same node: no re-mount
    expect(document.querySelectorAll('[data-voice-float]:not(html)')).toHaveLength(1);
  });

  it('says whether the voice plan marks batches (the button\'s hint): an instructor does, the principal does not', async () => {
    await mount();
    expect(api.marks).toBe(true);
    cleanup();
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    signed.ctx = await signIn(env.app, 'PR-2741');
    render(tree(env.app, 'Home'));
    expect(api.available).toBe(true);
    expect(api.marks).toBe(false);
    expect(screen.getByRole('button', { name: 'Voice Agent' })).toHaveAccessibleDescription('Speak to ask about attendance, reports and staff.');
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

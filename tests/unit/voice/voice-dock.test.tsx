// @vitest-environment jsdom
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { useState } from 'react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useCardLayout } from '@/features/voice/VoiceDockParts';
import { VoiceFloat } from '@/features/voice/VoiceFloat';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { VoiceContext, type VoiceApi } from '@/hooks/voice';
import type { VoiceState } from '@/services/voice/session';
import { setup } from '../../helpers/app';

afterEach(cleanup);

const MORE = /More voice controls/;
const BASE: VoiceState = { status: 'listening', error: null, captions: [], level: 0.4, pushToTalk: false, talking: false, canReconnect: false, minutesLeft: 10, focus: null, micHeld: null };

function spies() {
  return { start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), reconnect: vi.fn(), setPushToTalk: vi.fn(), talk: vi.fn(), settle: vi.fn(async () => undefined) };
}

/** A fake provider: pause/resume move the status, as the real session does. */
function Harness({ initial, spy }: { readonly initial: VoiceState; readonly spy: ReturnType<typeof spies> }) {
  const [state, setState] = useState(initial);
  const api: VoiceApi = {
    available: true,
    marks: true,
    online: true,
    state,
    ...spy,
    pause: () => {
      spy.pause();
      setState((s) => ({ ...s, status: 'paused' }));
    },
    resume: () => {
      spy.resume();
      setState((s) => ({ ...s, status: 'listening' }));
    },
  };
  return (
    <VoiceContext.Provider value={api}>
      <VoiceFloat />
    </VoiceContext.Provider>
  );
}

function renderDock(patch: Partial<VoiceState> = {}) {
  const spy = spies();
  const { app } = setup();
  const view = render(
    <ServicesProvider container={app}>
      <I18nProvider>
        <Harness initial={{ ...BASE, ...patch }} spy={spy} />
      </I18nProvider>
    </ServicesProvider>,
  );
  return { spy, ...view };
}

describe('the voice card (VoiceFloat while voice runs)', () => {
  afterEach(() => vi.unstubAllGlobals()); // viewport() stubs matchMedia; restoreMocks does not undo a stubbed global
  it.each([
    ['connecting', 'Connecting…', 'refresh'],
    ['listening', 'Listening', 'mic'],
    ['speaking', 'Speaking', 'audio-lines'],
    ['working', 'Working…', 'clock'],
    ['paused', 'Paused', 'pause'],
    ['reconnecting', 'Reconnecting…', 'refresh'],
    ['error', 'Voice stopped', 'mic-off'],
  ] as const)('shows %s as icon + text', (status, text, icon) => {
    renderDock({ status });
    expect(screen.getByText(text).closest('[data-icon]')).toHaveAttribute('data-icon', icon);
  });

  it('labels the last caption of each side', () => {
    renderDock({
      captions: [
        { who: 'trainer', text: 'Electrician', final: true },
        { who: 'agent', text: 'Which batch?', final: false },
      ],
    });
    // From 600px (jsdom without matchMedia reads as wide), the second caption opens from the status.
    fireEvent.click(screen.getByRole('button', { name: MORE }));
    const card = screen.getByRole('region', { name: 'Voice Agent' }); // portaled to <body>, outside the render container
    expect(card).toHaveTextContent('You: Electrician');
    expect(card).toHaveTextContent('Voice Agent: Which batch?');
  });

  it('working (D-156): icon + text + colour (clock, info); live, so Pause and Stop stay and the level bar shows', () => {
    viewport({ wide: true });
    renderDock({ status: 'working' });
    const look = screen.getByText('Working…').closest('[data-icon]')!;
    expect(look).toHaveAttribute('data-icon', 'clock');
    expect(look.className).toMatch(/tone-info/);
    expect(screen.getByRole('button', { name: 'Pause voice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });

  it('working with the face camera on reads as the camera status, as listening does', () => {
    viewport({ wide: true });
    renderDock({ status: 'working', micHeld: 'camera' });
    expect(screen.getByText('Mic off for face check')).toBeInTheDocument();
    expect(screen.queryByText('Working…')).toBeNull();
  });

  it('Stop voice calls stop', () => {
    const { spy } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(spy.stop).toHaveBeenCalledTimes(1);
  });

  it('Pause (named Pause voice) pauses and turns into Resume voice', () => {
    const { spy } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Pause voice' }));
    expect(spy.pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Pause voice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resume voice' }));
    expect(spy.resume).toHaveBeenCalledTimes(1);
  });

  it('offers Reconnect only when the session can reconnect', () => {
    renderDock({ status: 'error', error: 'connect_failed', canReconnect: false });
    expect(screen.queryByRole('button', { name: 'Reconnect' })).toBeNull();
    cleanup();
    const { spy } = renderDock({ status: 'error', error: 'connect_failed', canReconnect: true });
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(spy.reconnect).toHaveBeenCalledTimes(1);
  });

  it('explains an error in one line', () => {
    renderDock({ status: 'error', error: 'mic_denied' });
    expect(screen.getByText('Microphone is blocked. Allow it in settings, or use the screen.')).toBeInTheDocument();
  });

  it('shows the error without a live region of its own, so a dock re-mounted by navigation never re-reads it (C8: VoiceAnnouncer reads it)', () => {
    renderDock({ status: 'error', error: 'mic_denied' });
    const line = screen.getByText('Microphone is blocked. Allow it in settings, or use the screen.').closest('[data-error]');
    expect(line).not.toHaveAttribute('role');
    expect(line).not.toHaveAttribute('aria-live');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('shows the push-to-talk status instead of Listening while the mic is shut, and Listening while Hold to talk is held', () => {
    renderDock({ pushToTalk: true, talking: false });
    const idle = screen.getByText('Hold to talk', { selector: '[data-icon] span' }).closest('[data-icon]');
    expect(idle).toHaveAttribute('data-icon', 'mic-off');
    expect(screen.queryByText('Listening')).toBeNull();
    cleanup();
    renderDock({ pushToTalk: true, talking: true });
    expect(screen.getByText('Listening').closest('[data-icon]')).toHaveAttribute('data-icon', 'mic');
    cleanup();
    renderDock({ pushToTalk: false });
    expect(screen.getByText('Listening')).toBeInTheDocument();
  });

  it('keeps Speaking and Paused as they are while push-to-talk is on', () => {
    renderDock({ pushToTalk: true, status: 'speaking' });
    expect(screen.getByText('Speaking')).toBeInTheDocument();
    cleanup();
    renderDock({ pushToTalk: true, status: 'paused' });
    expect(screen.getByText('Paused')).toBeInTheDocument();
  });

  it('push-to-talk: Hold to talk sends talk(true) on press and talk(false) on release', () => {
    const { spy } = renderDock({ pushToTalk: true });
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold);
    expect(spy.talk).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(hold);
    expect(spy.talk).toHaveBeenLastCalledWith(false);
    fireEvent.click(screen.getByRole('button', { name: MORE })); // push-to-talk itself is one of the extras
    fireEvent.click(screen.getByRole('button', { name: 'Push to talk' }));
    expect(spy.setPushToTalk).toHaveBeenCalledWith(false);
  });

  it('push-to-talk: leaving the screen during a hold releases the mic', () => {
    const { spy, unmount } = renderDock({ pushToTalk: true });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Hold to talk' }));
    spy.talk.mockClear();
    unmount();
    expect(spy.talk).toHaveBeenCalledWith(false);
  });
});

/**
 * A viewport for the card's one query (D-147): WIDE is `(min-width: 600px)`, the two-line card; below it, the one-row
 * compact card at every phone size. jsdom has no matchMedia, so without a stub it reads true.
 */
function viewport({ wide }: { readonly wide: boolean }) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 600px)' ? wide : false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

/** A phone (320×568 to 599px wide, any height): the card is one row, its extras opened on demand. */
function compactViewport() {
  viewport({ wide: false });
}

const precedes = (a: Node, b: Node) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

describe('useCardLayout (D-147)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads wide without matchMedia (and on the server), and the one 600px query otherwise; there is no tall form', () => {
    expect(window.matchMedia).toBeUndefined(); // no stub left over from an earlier test: this is the no-matchMedia path
    expect(renderHook(() => useCardLayout()).result.current).toEqual({ wide: true });
    viewport({ wide: false });
    expect(renderHook(() => useCardLayout()).result.current).toEqual({ wide: false });
    viewport({ wide: true });
    expect(renderHook(() => useCardLayout()).result.current).toEqual({ wide: true });
  });
});

describe('the two-line voice card (from 600px, D-147)', () => {
  afterEach(() => vi.unstubAllGlobals());
  const captions = [{ who: 'agent' as const, text: 'Which batch?', final: true }];

  it('the head holds the status toggle and Minimize; the caption, then the actions; push-to-talk opens from the toggle', () => {
    viewport({ wide: true });
    renderDock({ captions });
    const toggle = screen.getByRole('button', { name: MORE });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toContainElement(screen.getByText('Listening'));
    const head = toggle.parentElement!;
    expect(head.className).toMatch(/head/);
    expect(head).toContainElement(screen.getByRole('button', { name: 'Minimize voice controls' }));
    // The actions have their own line under the caption: the status never shares a line with them.
    const stop = screen.getByRole('button', { name: 'Stop voice' });
    const pause = screen.getByRole('button', { name: 'Pause voice' });
    expect(head).not.toContainElement(stop);
    expect(head).not.toContainElement(pause);
    expect(precedes(screen.getByText(/Which batch\?/), pause)).toBe(true);
    expect(screen.getByText('Stop voice')).not.toHaveClass('visually-hidden'); // Stop voice keeps its label
    expect(screen.queryByRole('button', { name: 'Push to talk' })).toBeNull();
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Push to talk' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Minimize voice controls' })).toHaveLength(1);
  });

  it('with push-to-talk on: Hold to talk takes Pause\'s place in the closed card, as on a phone', () => {
    viewport({ wide: true });
    renderDock({ pushToTalk: true });
    expect(screen.getAllByRole('button', { name: 'Hold to talk' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Pause voice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: MORE }));
    expect(screen.getByRole('button', { name: 'Pause voice' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Hold to talk' })).toHaveLength(1);
  });

  it('rests closed on every screen height (no tall auto-expansion): the second caption, the hints and push-to-talk open from the status', () => {
    viewport({ wide: true });
    renderDock({
      captions: [
        { who: 'trainer', text: 'Electrician', final: true },
        { who: 'agent', text: 'Which batch?', final: false },
      ],
    });
    const toggle = screen.getByRole('button', { name: MORE });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText(/Electrician/)).toBeNull(); // one caption line at rest
    expect(screen.queryByRole('button', { name: 'Push to talk' })).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText(/Electrician/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push to talk' })).toBeInTheDocument();
  });

  it('keeps the first-connect hints behind the status (the privacy line alone shows at rest)', () => {
    viewport({ wide: true });
    renderDock();
    expect(screen.getByText(/Nothing is recorded/)).toBeInTheDocument();
    expect(screen.queryByText(/earphones/i)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: MORE }));
    expect(screen.getByText(/earphones/i)).toBeInTheDocument();
  });

  it('has no Minimize while voice has stopped (Reconnect and Stop voice on the actions line)', () => {
    viewport({ wide: true });
    renderDock({ status: 'error', error: 'dropped', canReconnect: true });
    expect(screen.queryByRole('button', { name: 'Minimize voice controls' })).toBeNull();
    const head = screen.getByText('Voice stopped').closest('[class*="head"]')!;
    expect(head).not.toBeNull();
    expect(head).not.toContainElement(screen.getByRole('button', { name: 'Reconnect' }));
  });

  it('wide and short with an error: the status is plain text, never a toggle that opens nothing', () => {
    viewport({ wide: true });
    renderDock({ status: 'error', error: 'dropped', canReconnect: true });
    expect(screen.queryByRole('button', { name: MORE })).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.getByText('Voice stopped')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });
});

describe('the one-row compact card (every phone, below 600px)', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps the status toggle, the primary action, Stop voice (its icon) and Minimize (a 44px icon) in one row at rest', () => {
    compactViewport();
    renderDock();
    const toggle = screen.getByRole('button', { name: MORE });
    const row = toggle.parentElement!;
    expect(row.className).toMatch(/rowCompact/);
    const pause = screen.getByRole('button', { name: 'Pause voice' });
    const stop = screen.getByRole('button', { name: 'Stop voice' });
    const minimize = screen.getByRole('button', { name: 'Minimize voice controls' });
    for (const control of [pause, stop, minimize]) expect(row).toContainElement(control);
    expect(precedes(pause, stop) && precedes(stop, minimize)).toBe(true);
    expect(screen.getByText('Stop voice')).toHaveClass('visually-hidden'); // the name stays for screen readers
    fireEvent.click(toggle);
    expect(screen.getAllByRole('button', { name: 'Minimize voice controls' })).toHaveLength(1); // not repeated in the opened panel
    expect(screen.getByRole('button', { name: 'Push to talk' })).toBeInTheDocument();
  });

  it('shows the primary action as its icon alone below 480px (the whole status fits beside it), its label kept as the accessible name', () => {
    const css = readFileSync(path.resolve(__dirname, '../../../src/features/voice/VoiceCard.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const narrow = css.slice(css.indexOf('@media (max-width: 479px)'));
    expect(css.indexOf('@media (max-width: 479px)')).toBeGreaterThan(-1);
    expect(narrow).toMatch(/\.rowCompact\s+\.rowAction\s*>\s*span\s*\{[^}]*clip-path:\s*inset\(50%\)/);
    compactViewport();
    renderDock();
    expect(screen.getByRole('button', { name: 'Pause voice' }).className).toMatch(/rowAction/);
    cleanup();
    renderDock({ pushToTalk: true });
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    expect(hold.className).toMatch(/rowAction/);
    expect(hold.querySelector('svg')).not.toBeNull(); // the mic icon carries it below 480px
  });
});

describe('the compact card with an error', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('shows the status as plain text beside Reconnect and Stop voice: nothing is left to open', () => {
    compactViewport();
    renderDock({ status: 'error', error: 'connect_failed', canReconnect: true });
    expect(screen.queryByRole('button', { name: MORE })).toBeNull();
    expect(document.querySelector('[aria-expanded]')).toBeNull();
    const status = screen.getByText('Voice stopped');
    const row = status.closest('[class*="rowCompact"]')!;
    expect(row).toContainElement(screen.getByRole('button', { name: 'Reconnect' }));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Stop voice' }));
  });
});

describe('the voice card on a compact screen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps Hold to talk in the closed row after every re-mount while push-to-talk is on', () => {
    compactViewport();
    const first = renderDock({ pushToTalk: true });
    expect(screen.getByRole('button', { name: /More voice controls/ })).toHaveAttribute('aria-expanded', 'false');
    // Voice ending and starting again re-mounts the card closed.
    first.unmount();
    const { spy } = renderDock({ pushToTalk: true });
    expect(screen.getByRole('button', { name: /More voice controls/ })).toHaveAttribute('aria-expanded', 'false');
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold);
    expect(spy.talk).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(hold);
    expect(spy.talk).toHaveBeenLastCalledWith(false);
    // Hold to talk takes Pause's place; opening the dock brings Pause and the toggle back.
    expect(screen.queryByRole('button', { name: 'Pause voice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More voice controls/ }));
    expect(screen.getByRole('button', { name: 'Pause voice' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Push to talk' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('button', { name: 'Hold to talk' })).toHaveLength(1);
  });

  it('shows the push-to-talk status in the closed row too, from the same state', () => {
    compactViewport();
    renderDock({ pushToTalk: true });
    expect(screen.getByRole('button', { name: /Hold to talk.*More voice controls/ }).querySelector('[data-icon="mic-off"]')).not.toBeNull();
  });

  it('shows the minutes-left warning in the closed row, in place of the caption line, under 3 minutes', () => {
    compactViewport();
    const captions = [{ who: 'agent' as const, text: 'Which batch?', final: true }];
    renderDock({ minutesLeft: 2, captions });
    expect(screen.getByText('2 minutes of voice left')).toBeInTheDocument();
    expect(screen.queryByText(/Which batch\?/)).toBeNull();
    expect(screen.getByRole('button', { name: /More voice controls/ })).toHaveAttribute('aria-expanded', 'false');
    // Opened, the warning shows once, in the panel, and the captions come back.
    fireEvent.click(screen.getByRole('button', { name: /More voice controls/ }));
    expect(screen.getAllByText('2 minutes of voice left')).toHaveLength(1);
    expect(screen.getByText(/Which batch\?/)).toBeInTheDocument();
  });

  it('shows the singular, replaces the privacy line, and stays quiet at 3 minutes or more, at 0, and with an error', () => {
    compactViewport();
    renderDock({ minutesLeft: 1 });
    expect(screen.getByText('1 minute of voice left')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing is recorded/)).toBeNull();
    cleanup();
    renderDock({ minutesLeft: 3 });
    expect(screen.queryByText(/of voice left/)).toBeNull();
    expect(screen.getByText(/Nothing is recorded/)).toBeInTheDocument();
    cleanup();
    renderDock({ minutesLeft: 0 });
    expect(screen.queryByText(/of voice left/)).toBeNull();
    cleanup();
    renderDock({ minutesLeft: 2, status: 'error', error: 'connect_failed' });
    expect(screen.queryByText(/of voice left/)).toBeNull();
  });

  it('shows Pause in the closed row while push-to-talk is off', () => {
    compactViewport();
    renderDock();
    expect(screen.getByRole('button', { name: 'Pause voice' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });
});

/** The card in Marathi: the saved language and <html lang> (the provider reads both). */
async function renderDockMr(patch: Partial<VoiceState> = {}) {
  const spy = spies();
  const { app } = setup();
  await app.repositories.preferences.setLanguage('mr');
  document.documentElement.lang = 'mr';
  const view = render(
    <ServicesProvider container={app}>
      <I18nProvider>
        <Harness initial={{ ...BASE, ...patch }} spy={spy} />
      </I18nProvider>
    </ServicesProvider>,
  );
  await screen.findByRole('region', { name: 'व्हॉइस एजंट' });
  return { spy, ...view };
}

describe('the Pause action (was "Use screen")', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('reads "Pause" and is named "Pause voice"; Resume stays "Resume voice"', () => {
    viewport({ wide: true });
    renderDock();
    const pause = screen.getByRole('button', { name: 'Pause voice' });
    expect(pause).toHaveTextContent(/^Pause$/);
    expect(screen.queryByText('Use screen')).toBeNull();
    fireEvent.click(pause);
    expect(screen.getByRole('button', { name: 'Resume voice' })).toHaveTextContent('Resume voice');
  });

  it('keeps the name in the compact row, where the label is visually hidden below 480px', () => {
    compactViewport();
    renderDock();
    const pause = screen.getByRole('button', { name: 'Pause voice' });
    expect(pause.className).toMatch(/rowAction/);
    expect(pause).toHaveTextContent('Pause');
  });
});

describe('the camera holds the mic (D-148): "Mic off for face check"', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.lang = 'en';
  });
  const level = () => document.querySelector('[class*="level"]');

  it.each(['listening', 'speaking'] as const)('while %s: the camera status (mic-off, neutral), no level bar and no Pause; Stop stays (two-line card)', (status) => {
    viewport({ wide: true });
    renderDock({ status, micHeld: 'camera' });
    const look = screen.getByText('Mic off for face check').closest('[data-icon]')!;
    expect(look).toHaveAttribute('data-icon', 'mic-off');
    expect(look.className).toMatch(/tone-neutral/);
    expect(screen.queryByText('Listening')).toBeNull();
    expect(level()).toBeNull();
    expect(screen.queryByRole('button', { name: 'Pause voice' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Stop voice' })).toBeInTheDocument();
  });

  it('wins over the push-to-talk status, and Hold to talk leaves the row (the mic cannot open)', () => {
    compactViewport();
    renderDock({ micHeld: 'camera', pushToTalk: true });
    expect(screen.getByText('Mic off for face check')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it('the opened extras keep the Push to talk setting but no Hold to talk while the camera holds the mic', () => {
    viewport({ wide: true });
    renderDock({ micHeld: 'camera', pushToTalk: true });
    fireEvent.click(screen.getByRole('button', { name: MORE }));
    expect(screen.getByRole('button', { name: 'Push to talk' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });

  it('is not shown while paused or after voice stopped (the plain status shows)', () => {
    renderDock({ status: 'paused', micHeld: 'camera' });
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.queryByText('Mic off for face check')).toBeNull();
  });

  it('the compact row at 320 (English): the status toggle, Stop voice (its icon) and Minimize, nothing else', () => {
    compactViewport();
    renderDock({ micHeld: 'camera' });
    const toggle = screen.getByRole('button', { name: /Mic off for face check.*More voice controls/ });
    const row = toggle.parentElement!;
    expect(row.className).toMatch(/rowCompact/);
    expect(row).toContainElement(screen.getByRole('button', { name: 'Stop voice' }));
    expect(row).toContainElement(screen.getByRole('button', { name: 'Minimize voice controls' }));
    expect(row.querySelectorAll('button')).toHaveLength(3);
    expect(level()).toBeNull();
  });

  it('the compact row at 320 (Marathi): the same three controls, the Marathi status', async () => {
    compactViewport();
    await renderDockMr({ micHeld: 'camera' });
    const look = screen.getByText('चेहरा तपासणीसाठी माइक बंद').closest('[data-icon]')!;
    expect(look).toHaveAttribute('data-icon', 'mic-off');
    const row = look.closest('[class*="rowCompact"]')!;
    expect(row.querySelectorAll('button')).toHaveLength(3);
    expect(row).toContainElement(screen.getByRole('button', { name: 'व्हॉइस थांबवा' }));
    expect(screen.queryByRole('button', { name: 'व्हॉइसला विराम द्या' })).toBeNull();
  });

  it('Marathi: Pause is "विराम", named "व्हॉइसला विराम द्या"', async () => {
    compactViewport();
    await renderDockMr();
    expect(screen.getByRole('button', { name: 'व्हॉइसला विराम द्या' })).toHaveTextContent('विराम');
  });
});

describe('filler captions are never shown (D-148: the agent\'s reply to the camera-on text)', () => {
  it.each(['<no speech detected>', '...', '---', ' … ', '।', '<no speech>{pause}', '{pause}', '<noise>'])('hides an agent line %j, and the line before it shows instead', (filler) => {
    renderDock({
      captions: [
        { who: 'agent', text: 'Please look at the camera.', final: true },
        { who: 'agent', text: filler, final: false },
      ],
    });
    const card = screen.getByRole('region', { name: 'Voice Agent' });
    expect(card).toHaveTextContent('Voice Agent: Please look at the camera.');
    expect(card.textContent).not.toContain(filler.trim());
  });

  it('shows a real line without the transcriber\'s markers around it', () => {
    renderDock({ captions: [{ who: 'agent', text: '<noise> Please look at the camera. {pause}', final: true }] });
    const card = screen.getByRole('region', { name: 'Voice Agent' });
    expect(card).toHaveTextContent('Voice Agent: Please look at the camera.');
    expect(card.textContent).not.toMatch(/<noise>|\{pause\}/);
  });

  it('keeps a real line in any script, and the privacy line shows while only fillers have come', () => {
    renderDock({ captions: [{ who: 'agent', text: 'चेहरा तपासा', final: true }] });
    expect(screen.getByRole('region', { name: 'Voice Agent' })).toHaveTextContent('Voice Agent: चेहरा तपासा');
    cleanup();
    renderDock({ captions: [{ who: 'agent', text: '<no speech detected>', final: true }] });
    expect(screen.getByText(/Nothing is recorded/)).toBeInTheDocument();
  });
});

// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceFloat } from '@/features/voice/VoiceFloat';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { VoiceContext, type VoiceApi } from '@/hooks/voice';
import type { VoiceState } from '@/services/voice/session';
import { setup } from '../../helpers/app';

afterEach(cleanup);

const BASE: VoiceState = { status: 'listening', error: null, captions: [], level: 0.4, pushToTalk: false, talking: false, canReconnect: false, minutesLeft: 10, focus: null };

function spies() {
  return { start: vi.fn(), stop: vi.fn(), pause: vi.fn(), resume: vi.fn(), reconnect: vi.fn(), setPushToTalk: vi.fn(), talk: vi.fn() };
}

/** A fake provider: pause/resume move the status, as the real session does. */
function Harness({ initial, spy }: { readonly initial: VoiceState; readonly spy: ReturnType<typeof spies> }) {
  const [state, setState] = useState(initial);
  const api: VoiceApi = {
    available: true,
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
  it.each([
    ['connecting', 'Connecting…', 'refresh'],
    ['listening', 'Listening', 'mic'],
    ['speaking', 'Speaking', 'audio-lines'],
    ['paused', 'Paused', 'pause'],
    ['reconnecting', 'Reconnecting…', 'refresh'],
    ['error', 'Voice stopped', 'mic-off'],
  ] as const)('shows %s as icon + text', (status, text, icon) => {
    renderDock({ status });
    expect(screen.getByText(text).closest('[data-icon]')).toHaveAttribute('data-icon', icon);
  });

  it('labels the last caption of each side', () => {
    const { container } = renderDock({
      captions: [
        { who: 'trainer', text: 'Electrician', final: true },
        { who: 'agent', text: 'Which batch?', final: false },
      ],
    });
    expect(container).toHaveTextContent('You: Electrician');
    expect(container).toHaveTextContent('Sahayak: Which batch?');
  });

  it('Stop voice calls stop', () => {
    const { spy } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Stop voice' }));
    expect(spy.stop).toHaveBeenCalledTimes(1);
  });

  it('Use screen pauses and turns into Resume', () => {
    const { spy } = renderDock();
    fireEvent.click(screen.getByRole('button', { name: 'Use screen' }));
    expect(spy.pause).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Use screen' })).toBeNull();
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

/** A compact phone (320×568, 360×640): the roomy query does not match, so the dock opens closed. */
function compactViewport() {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

describe('the voice card on a compact screen', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps Hold to talk in the closed row after every re-mount while push-to-talk is on', () => {
    compactViewport();
    const first = renderDock({ pushToTalk: true });
    expect(screen.getByRole('button', { name: /More voice controls/ })).toHaveAttribute('aria-expanded', 'false');
    // A route change re-mounts the dock closed (each screen renders its own ScreenLayout).
    first.unmount();
    const { spy } = renderDock({ pushToTalk: true });
    expect(screen.getByRole('button', { name: /More voice controls/ })).toHaveAttribute('aria-expanded', 'false');
    const hold = screen.getByRole('button', { name: 'Hold to talk' });
    fireEvent.pointerDown(hold);
    expect(spy.talk).toHaveBeenLastCalledWith(true);
    fireEvent.pointerUp(hold);
    expect(spy.talk).toHaveBeenLastCalledWith(false);
    // Hold to talk takes Use screen's place; opening the dock brings Use screen and the toggle back.
    expect(screen.queryByRole('button', { name: 'Use screen' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /More voice controls/ }));
    expect(screen.getByRole('button', { name: 'Use screen' })).toBeInTheDocument();
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

  it('shows Use screen in the closed row while push-to-talk is off', () => {
    compactViewport();
    renderDock();
    expect(screen.getByRole('button', { name: 'Use screen' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Hold to talk' })).toBeNull();
  });
});

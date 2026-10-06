// @vitest-environment jsdom
/**
 * The open voice card yields the screen when idle (Ruling R7): while voice is live it collapses to the mini status
 * button after CARD_IDLE_COLLAPSE_MS with no agent audio, no new caption and no pointer or focus in the card; it opens
 * again by itself when the agent starts a new spoken turn and whenever the status needs the user; a manual Minimize
 * stays minimized until the mini button is tapped.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_IDLE_COLLAPSE_MS, newAgentTurn } from '@/features/voice/useCardRest';
import { VoiceFloat } from '@/features/voice/VoiceFloat';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { VoiceContext, type VoiceApi } from '@/hooks/voice';
import type { Caption, VoiceState } from '@/services/voice/session';
import { setup } from '../../helpers/app';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const LIVE: VoiceState = { status: 'listening', error: null, captions: [], level: 0, pushToTalk: false, talking: false, canReconnect: false, minutesLeft: 10, focus: null, micHeld: null };
const agent = (text: string, final = true): Caption => ({ who: 'agent', text, final });
const noop = () => undefined;

function mount(initial: Partial<VoiceState> = {}) {
  let set!: (patch: Partial<VoiceState>) => void;
  function Harness() {
    const [state, setState] = useState<VoiceState>({ ...LIVE, ...initial });
    set = (patch) => setState((s) => ({ ...s, ...patch }));
    const api: VoiceApi = {
      available: true, marks: true, online: true, state,
      start: noop, stop: noop, pause: noop, resume: noop, reconnect: noop, setPushToTalk: noop, talk: noop, settle: async () => undefined,
    };
    return (
      <VoiceContext.Provider value={api}>
        <VoiceFloat />
      </VoiceContext.Provider>
    );
  }
  const { app } = setup();
  render(
    <ServicesProvider container={app}>
      <I18nProvider>
        <Harness />
      </I18nProvider>
    </ServicesProvider>,
  );
  const update = (patch: Partial<VoiceState>) => act(() => set(patch));
  return { update };
}

const card = () => screen.queryByRole('region', { name: 'Voice Agent' });
const wait = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const float = () => document.querySelector<HTMLElement>('div[data-voice-float]')!;

describe('the card collapses when idle (R7)', () => {
  it('after 6 s of a live session with no audio, no new caption and no pointer or focus: the mini button, focus not moved', () => {
    expect(CARD_IDLE_COLLAPSE_MS).toBe(6000);
    mount();
    const before = document.activeElement;
    wait(5999);
    expect(card()).not.toBeNull();
    wait(1);
    expect(card()).toBeNull();
    const mini = screen.getByRole('button', { name: 'Listening' });
    expect(mini).toHaveAttribute('aria-expanded', 'false');
    expect(document.activeElement).toBe(before); // a collapse the trainer did not ask for never moves focus
    expect(document.documentElement).toHaveAttribute('data-voice-float', 'button');
  });

  it("never while the agent's audio plays; the 6 s count from when it stops", () => {
    const { update } = mount({ status: 'speaking' });
    wait(20_000);
    expect(card()).not.toBeNull();
    update({ status: 'listening' });
    wait(5999);
    expect(card()).not.toBeNull();
    wait(1);
    expect(card()).toBeNull();
  });

  it('a new caption (either speaker) starts the 6 s again; a mic level change does not', () => {
    const { update } = mount();
    wait(4000);
    update({ captions: [{ who: 'trainer', text: 'Electrician', final: true }] });
    wait(4000);
    expect(card()).not.toBeNull();
    update({ level: 0.6 });
    wait(2000);
    expect(card()).toBeNull();
  });

  it('a filler caption (never shown) does not start the 6 s again', () => {
    const { update } = mount({ captions: [agent('Please look at the camera.')] });
    wait(4000);
    update({ captions: [agent('Please look at the camera.'), agent('<no speech detected>', false)] });
    update({ captions: [agent('Please look at the camera.'), agent('<no speech detected>')] });
    wait(2000);
    expect(card()).toBeNull();
  });

  it('a pointer over the card holds it open; it counts again once the pointer leaves', () => {
    mount();
    fireEvent.pointerEnter(float());
    wait(30_000);
    expect(card()).not.toBeNull();
    fireEvent.pointerLeave(float());
    wait(6000);
    expect(card()).toBeNull();
  });

  it('focus inside the card holds it open; it counts again once focus leaves', () => {
    mount();
    const stop = screen.getByRole('button', { name: 'Stop voice' });
    act(() => stop.focus());
    wait(30_000);
    expect(card()).not.toBeNull();
    act(() => stop.blur());
    wait(6000);
    expect(card()).toBeNull();
  });

  it.each(['connecting', 'paused', 'reconnecting'] as const)('not while %s (only a live session collapses)', (status) => {
    mount({ status });
    wait(30_000);
    expect(card()).not.toBeNull();
  });

  it('the camera status may collapse: the mini button shows it as icon + colour + its accessible name', () => {
    mount({ micHeld: 'camera' });
    wait(6000);
    const mini = screen.getByRole('button', { name: 'Mic off for face check' });
    expect(mini).toHaveAttribute('data-tone', 'neutral');
    expect(mini.querySelector('[data-icon="mic-off"]')).not.toBeNull();
  });

  it('never with push-to-talk on (Hold to talk lives only in the card); it counts again once push-to-talk is off', () => {
    const { update } = mount({ pushToTalk: true });
    wait(CARD_IDLE_COLLAPSE_MS + 1);
    expect(card()).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Hold to talk' })).toBeInTheDocument();
    update({ pushToTalk: false });
    wait(CARD_IDLE_COLLAPSE_MS - 1);
    expect(card()).not.toBeNull();
    wait(1);
    expect(card()).toBeNull();
  });

  it('closes the extras it rested with: an automatic re-open shows the small card', () => {
    const { update } = mount();
    fireEvent.click(screen.getByRole('button', { name: /More voice controls/ }));
    fireEvent.pointerLeave(float());
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    wait(6000);
    expect(card()).toBeNull();
    update({ status: 'paused' });
    expect(screen.getByRole('button', { name: /More voice controls/ })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('the card opens again by itself (R7)', () => {
  it('when the agent starts a new spoken turn: its audio plays and its words arrive; focus stays where it was', () => {
    const { update } = mount({ captions: [agent('Which batch?')] });
    wait(6000);
    expect(card()).toBeNull();
    const before = document.activeElement;
    update({ status: 'speaking' });
    expect(card()).toBeNull(); // nothing to read yet
    update({ captions: [agent('Which batch?'), agent('Shift 1, Unit 2', false)] });
    expect(card()).not.toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it('no idle count runs while it rests: audio heard during the rest still counts when its words come later', () => {
    const line = agent('Which batch?');
    const { update } = mount({ captions: [line] });
    wait(6000);
    update({ status: 'speaking' });
    update({ status: 'listening' });
    wait(12_000);
    expect(card()).toBeNull();
    update({ captions: [line, agent('Shift 1, Unit 2')] });
    expect(card()).not.toBeNull();
  });

  it('also when the words come first and the audio after', () => {
    const { update } = mount();
    wait(6000);
    update({ captions: [agent('All present?', false)] });
    expect(card()).toBeNull();
    update({ status: 'speaking' });
    expect(card()).not.toBeNull();
  });

  it('not for a filler turn ("<no speech detected>", "...", "---"), nor for the trainer\'s speech', () => {
    // Lines keep their identity until they change (captions.ts): the line said before the rest is the same object.
    const line = agent('Please look at the camera.');
    const { update } = mount({ captions: [line] });
    wait(6000);
    update({ status: 'speaking', captions: [line, agent('<no speech detected>', false)] });
    update({ captions: [line, agent('<no speech detected>')] }); // its turnComplete
    update({ status: 'listening', captions: [line, agent('<no speech detected>'), agent('...')] });
    update({ captions: [line, agent('<no speech detected>'), agent('...'), agent('---')] });
    update({ captions: [line, agent('---'), { who: 'trainer', text: 'Aditi absent', final: true }] });
    update({ captions: [agent('---'), { who: 'trainer', text: 'Aditi absent', final: true }] }); // the line scrolled out
    expect(card()).toBeNull();
  });

  it.each([
    ['paused', { status: 'paused' }],
    ['reconnecting', { status: 'reconnecting' }],
    ['an error', { status: 'error', error: 'dropped', canReconnect: true }],
  ] as const)('when the status needs the trainer: %s', (_name, patch) => {
    const { update } = mount();
    wait(6000);
    expect(card()).toBeNull();
    update(patch);
    expect(card()).not.toBeNull();
  });

  it('when the under-3-minutes warning first shows, and again each time its minute count changes', () => {
    const { update } = mount({ minutesLeft: 5 });
    wait(6000);
    expect(card()).toBeNull();
    update({ minutesLeft: 3 });
    expect(card()).toBeNull(); // no warning at 3 minutes
    update({ minutesLeft: 2 });
    expect(card()).not.toBeNull();
    expect(screen.getByText('2 minutes of voice left')).toBeInTheDocument();
    wait(6000);
    expect(card()).toBeNull(); // the same warning does not hold it open
    update({ minutesLeft: 1 });
    expect(card()).not.toBeNull();
  });

  it('a tap on the mini button opens it (focus to Minimize), and it rests again after 6 s once focus has left', () => {
    mount();
    wait(6000);
    fireEvent.click(screen.getByRole('button', { name: 'Listening' }));
    expect(card()).not.toBeNull();
    const minimize = screen.getByRole('button', { name: 'Minimize voice controls' });
    expect(document.activeElement).toBe(minimize);
    act(() => minimize.blur());
    wait(6000);
    expect(card()).toBeNull();
  });
});

describe('a manual Minimize stays minimized (R7)', () => {
  it('through the agent\'s next spoken turn, a pause and reconnecting, until the mini button is tapped', () => {
    const { update } = mount({ captions: [agent('Which batch?')] });
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    update({ status: 'speaking', captions: [agent('Which batch?'), agent('Shift 1, Unit 2')] });
    update({ status: 'paused' });
    update({ status: 'reconnecting' });
    update({ status: 'listening' });
    wait(30_000);
    expect(card()).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Listening' }));
    expect(card()).not.toBeNull();
  });

  it('an error still opens it (voice has stopped: Reconnect or Stop voice)', () => {
    const { update } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Minimize voice controls' }));
    update({ status: 'error', error: 'dropped', canReconnect: true });
    expect(card()).not.toBeNull();
  });
});

describe('newAgentTurn: words the agent said since the card rested', () => {
  const since = agent('Which batch?');
  it('a new line, an identical new line, or more words on the line that was open', () => {
    expect(newAgentTurn(since, [since, agent('Shift 1')])).toBe(true);
    expect(newAgentTurn(since, [since, agent('Which batch?', false)])).toBe(true);
    const open = agent('Which', false);
    expect(newAgentTurn(open, [agent('Which batch?', false)])).toBe(true);
    expect(newAgentTurn(undefined, [agent('Hello')])).toBe(true);
    // A real line still counts when a filler line came after it.
    expect(newAgentTurn(since, [since, agent('Shift 1'), agent('...')])).toBe(true);
  });
  it('not the same line, the line that was open being closed, a filler, or the trainer', () => {
    expect(newAgentTurn(since, [since])).toBe(false);
    const open = agent('Which batch?', false);
    expect(newAgentTurn(open, [agent('Which batch?', true)])).toBe(false);
    expect(newAgentTurn(since, [since, agent('<no speech detected>')])).toBe(false);
    expect(newAgentTurn(since, [since, { who: 'trainer', text: 'Fitter', final: true }])).toBe(false);
    expect(newAgentTurn(undefined, [])).toBe(false);
  });
});

describe('the motion (R7)', () => {
  it('the card and the mini button grow from the bottom-right corner (scale and opacity), with no animation under reduced motion', () => {
    const read = (file: string) => readFileSync(path.resolve(__dirname, '../../../src/features/voice', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    for (const [file, selector] of [['VoiceCard.module.css', '.card'], ['VoiceFloat.module.css', '.mini']] as const) {
      const css = read(file);
      const rule = new RegExp(`\\${selector}\\s*\\{[^}]*animation:\\s*([a-z-]+)\\s+var\\(--motion-base\\)`);
      const name = css.match(rule)?.[1];
      expect(name, file).toBeTruthy();
      expect(css, file).toMatch(new RegExp(`\\${selector}\\s*\\{[^}]*transform-origin:\\s*bottom right`));
      expect(css, file).toMatch(new RegExp(`@keyframes\\s+${name}\\s*\\{\\s*from\\s*\\{[^}]*opacity:\\s*0;[^}]*transform:\\s*scale\\(`));
      expect(css, file).toMatch(new RegExp(`@media\\s*\\(prefers-reduced-motion:\\s*reduce\\)\\s*\\{[^@]*\\${selector}[^{]*\\{[^}]*animation:\\s*none`));
    }
  });
});

'use client';
import { useEffect, useEffectEvent, useState, type FocusEvent } from 'react';
import type { Caption, VoiceState, VoiceStatus } from '@/services/voice/session';
import { speakable, visibleCaptions } from './VoiceDockParts';

/** How long the open card waits, idle, before it yields the screen to the mini status button (Ruling R7). */
export const CARD_IDLE_COLLAPSE_MS = 6000;

/** The statuses that need the trainer (Resume, Reconnect, Stop): an automatic rest always ends on them. */
const NEEDS_USER: ReadonlySet<VoiceStatus> = new Set(['paused', 'reconnecting', 'error']);

/** The minute count of the card's under-3-minutes warning (VoiceCard), or null while it shows none. */
const lowTime = (state: VoiceState): number | null => (state.minutesLeft > 0 && state.minutesLeft < 3 ? state.minutesLeft : null);

/** The newest agent line that says something (a filler line is never shown, so it never counts). */
const lastSaid = (captions: readonly Caption[]): Caption | undefined => captions.findLast((c) => c.who === 'agent' && speakable(c.text));

/** What the card's caption lines show, as one value: a filler line, never shown, does not change it. */
const shownKey = (captions: readonly Caption[]): string => visibleCaptions(captions).map((c) => `${c.who}:${c.final ? 1 : 0}:${c.text}`).join('\n');

/**
 * Words the agent said since the card rested on `since` (its newest agent line that said something then): a new line
 * (an identical one included) or more words on the line that was open; never that line merely closing, a filler turn
 * or the trainer. Lines keep their identity until they change (captions.ts), so a different object is a change.
 */
export function newAgentTurn(since: Caption | undefined, captions: readonly Caption[]): boolean {
  const latest = lastSaid(captions);
  if (!latest || latest === since) return false;
  const closedOnly = since !== undefined && !since.final && latest.final && latest.text === since.text;
  return !closedOnly;
}

/** Rested by itself: the newest agent line then, whether the agent's audio has played since, and the time warning then. */
interface Rest {
  readonly since: Caption | undefined;
  readonly spoke: boolean;
  readonly low: number | null;
}

/**
 * The open card yields the screen when idle (Ruling R7). While the session is live and the card shows, it rests (the
 * mini status button) after CARD_IDLE_COLLAPSE_MS with no agent audio playing (status speaking), no new caption shown and no
 * pointer over or focus inside the float; a status change starts the count again. A rest ends by itself when the agent
 * starts a new spoken turn (its audio plays and it says something: a filler turn never counts) or when the status needs
 * the trainer (paused, reconnecting, an error) or the under-3-minutes warning shows a new minute count (the warning lives
 * only in the card). With push-to-talk on it never rests by itself: Hold to talk lives only in the card. Resting and
 * waking never move focus. `onRest` closes the card's extras.
 * `wake()` is the trainer's own tap on the mini button. The float's wrapper takes `handlers`.
 */
export function useCardRest(state: VoiceState | null, cardShown: boolean, float: HTMLElement | null, onRest: () => void) {
  const [rest, setRest] = useState<Rest | null>(null);
  const [pointer, setPointer] = useState(false);
  const [focus, setFocus] = useState(false);

  // Adjusted while rendering, from the state (React's pattern for state that follows a change).
  if (rest) {
    const spoke = rest.spoke || state?.status === 'speaking';
    const low = state ? lowTime(state) : null;
    if (!state || NEEDS_USER.has(state.status) || (low !== null && low !== rest.low) || (spoke && newAgentTurn(rest.since, state.captions))) setRest(null);
    else if (spoke !== rest.spoke) setRest({ ...rest, spoke });
  }

  // Speaking means the agent's audio plays: no count then. Push-to-talk keeps the card (and its Hold to talk) open.
  const listening = state?.status === 'listening' && !state.pushToTalk;
  const captions = state?.captions;
  const shown = captions ? shownKey(captions) : ''; // a new caption the card shows starts the count again
  const look = state ? `${state.micHeld}:${state.pushToTalk}:${state.talking}` : '';
  const settle = useEffectEvent(() => {
    // Focus can sit inside without a focus event having been seen (the start button it replaced had it).
    if (float?.contains(document.activeElement)) return;
    setRest({ since: captions ? lastSaid(captions) : undefined, spoke: false, low: state ? lowTime(state) : null });
    onRest();
  });
  const resting = rest !== null; // no count while it rests: a rest ends only as described above
  useEffect(() => {
    if (!cardShown || resting || !listening || pointer) return;
    if (focus && float?.contains(document.activeElement)) return;
    const id = window.setTimeout(settle, CARD_IDLE_COLLAPSE_MS);
    return () => window.clearTimeout(id);
  }, [cardShown, resting, listening, pointer, focus, shown, look, float]);

  const handlers = {
    onPointerEnter: () => setPointer(true),
    onPointerLeave: () => setPointer(false),
    onFocus: () => setFocus(true),
    onBlur: (e: FocusEvent<HTMLElement>) => {
      if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocus(false);
    },
  };
  return { rested: resting, wake: () => setRest(null), handlers };
}

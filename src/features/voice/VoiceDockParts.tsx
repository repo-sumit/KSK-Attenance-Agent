'use client';
import { useEffect, useRef, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon, type IconName } from '@/components/ui/icons/Icon';
import { cx } from '@/lib/cx';
import type { MessageKey } from '@/i18n';
import type { Caption, VoiceErrorCode, VoiceState, VoiceStatus } from '@/services/voice/session';
import styles from './VoiceCard.module.css';

type Tone = 'success' | 'info' | 'warning' | 'error' | 'neutral';

/** Status is icon + text + colour (DS status language). Idle only flashes before Connecting. */
export const STATUS: Readonly<Record<VoiceStatus, { readonly icon: IconName; readonly tone: Tone; readonly key: MessageKey }>> = {
  idle: { icon: 'refresh', tone: 'info', key: 'voice.status.connecting' },
  connecting: { icon: 'refresh', tone: 'info', key: 'voice.status.connecting' },
  listening: { icon: 'mic', tone: 'success', key: 'voice.status.listening' },
  speaking: { icon: 'audio-lines', tone: 'info', key: 'voice.status.speaking' },
  working: { icon: 'clock', tone: 'info', key: 'voice.status.working' },
  paused: { icon: 'pause', tone: 'neutral', key: 'voice.status.paused' },
  reconnecting: { icon: 'refresh', tone: 'warning', key: 'voice.status.reconnecting' },
  error: { icon: 'mic-off', tone: 'error', key: 'voice.status.error' },
  ended: { icon: 'mic-off', tone: 'neutral', key: 'voice.status.ended' },
};

/** The face camera holds the mic off while the session is live (D-086, D-148): voice comes back by itself. */
const CAMERA = { icon: 'mic-off', tone: 'neutral', key: 'voice.status.camera' } as const;

/**
 * What the dock shows for a session state. While a face camera holds the mic (`micHeld`), a live session reads "Mic
 * off for face check". With push-to-talk on, the microphone is shut until Hold to talk is held (session.ts opens it
 * only when `!pushToTalk || talking`), so a "listening" session reads "Hold to talk" (mic off) until the trainer holds
 * the button; while it is held, and in every other status, the plain status shows.
 */
export function dockStatus(state: Pick<VoiceState, 'status' | 'pushToTalk' | 'talking' | 'micHeld'>): { readonly icon: IconName; readonly tone: Tone; readonly key: MessageKey } {
  if (cameraHolds(state)) return CAMERA;
  if (state.status === 'listening' && state.pushToTalk && !state.talking) return { icon: 'mic-off', tone: 'neutral', key: 'voice.status.holdToTalk' };
  return STATUS[state.status];
}

/** A live session (listening, speaking or working) whose mic a face camera holds off. */
export const cameraHolds = (state: Pick<VoiceState, 'status' | 'micHeld'>): boolean =>
  state.micHeld === 'camera' && (state.status === 'listening' || state.status === 'speaking' || state.status === 'working');

/**
 * The card's layout (D-147). WIDE (600px and up): the two-line card, 360px wide at the corner, with the status on its
 * own line above the labelled actions. Below 600px, at every phone height: the one compact row (at most 88px). Either
 * way it rests closed; the extras open from the status. The server, and a browser without matchMedia, read wide.
 */
const WIDE = '(min-width: 600px)';
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
function subscribeWide(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => undefined;
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
const matchesWide = () => !hasMatchMedia() || window.matchMedia(WIDE).matches;
const onServer = () => true;
export function useCardLayout(): { readonly wide: boolean } {
  return { wide: useSyncExternalStore(subscribeWide, matchesWide, onServer) };
}

/**
 * The transcriber's markers, never real speech: "<no speech detected>", "<noise>", "{pause}". A turn with no words is
 * written as one ("<no speech>{pause}" too); a real line may carry one around it.
 */
const MARKERS = /<[^<>]*>|\{[^{}]*\}/g;
const words = (text: string) => text.replace(MARKERS, ' ').replace(/\s+/g, ' ').trim();

/**
 * An agent caption worth showing: it has a letter, in any script, once the transcriber's markers are gone. The live
 * model answers the camera-on text with a filler turn ("<no speech detected>", "<no speech>{pause}", "...", "---"); its
 * line is never shown and never opens the card (D-148).
 */
export const speakable = (text: string): boolean => /\p{L}/u.test(words(text));

/** The captions the card shows: every trainer line, and the agent lines that say something. */
export const visibleCaptions = (captions: readonly Caption[]): readonly Caption[] => captions.filter((c) => c.who !== 'agent' || speakable(c.text));

/** The newest caption, and the newest one of the other speaker (older, so it is read first). */
export function lastCaptions(captions: readonly Caption[]): { readonly latest?: Caption; readonly other?: Caption } {
  const latest = captions[captions.length - 1];
  if (!latest) return {};
  for (let i = captions.length - 2; i >= 0; i--) if (captions[i].who !== latest.who) return { latest, other: captions[i] };
  return { latest };
}

export function StatusText({ look, text }: { readonly look: { readonly icon: IconName; readonly tone: Tone }; readonly text: string }) {
  const { icon, tone } = look;
  return (
    <span className={cx(styles.status, styles[`tone-${tone}`])} data-icon={icon}>
      <Icon name={icon} size={16} />
      <span>{text}</span>
    </span>
  );
}

/** The mic level, a picture only (screen readers get the status text). */
export function LevelBar({ level }: { readonly level: number }) {
  return (
    <span className={styles.level} aria-hidden="true">
      <span className={styles.levelFill} style={{ transform: `scaleX(${Math.min(1, Math.max(0, level))})` }} />
    </span>
  );
}

/** One caption, one line: "You: …" / "Voice Agent: …", cut with an ellipsis (an agent line without the transcriber's markers). */
export function CaptionLine({ caption, who }: { readonly caption: Caption; readonly who: string }) {
  return (
    <p className={styles.caption}>
      <span className={styles.who}>{who}:</span> {caption.who === 'agent' ? words(caption.text) : caption.text}
    </p>
  );
}

/**
 * The error, shown (icon + text + colour) but not a live region: the dock re-mounts on every route, so a region here
 * would be read again on each navigation, or not at all when inserted already filled. VoiceAnnouncer's alert, which
 * outlives the dock, reads each new error once (C8).
 */
export function ErrorLine({ code, text }: { readonly code: VoiceErrorCode; readonly text: string }) {
  return (
    <p className={styles.errorLine} data-error={code}>
      <Icon name="alert" size={16} />
      <span>{text}</span>
    </p>
  );
}

export function Hint({ icon, children, compact = false }: { readonly icon: IconName; readonly children: string; readonly compact?: boolean }) {
  return (
    <p className={cx(styles.hint, compact && styles.hintCompact)}>
      <Icon name={icon} size={16} />
      <span>{children}</span>
    </p>
  );
}

/** A secondary action in the card's row (Pause, Resume voice): its icon, its label, and its name when the label is shorter. */
export function RowAction({ icon, label, name, onClick }: { readonly icon: IconName; readonly label: string; readonly name?: string; readonly onClick: () => void }) {
  return (
    <Button variant="secondary" size="md" leadingIcon={icon} className={styles.rowAction} aria-label={name} onClick={onClick}>
      {label}
    </Button>
  );
}

/**
 * Push-to-talk: the mic is on only while the button is held (pointer or Space/Enter). Unmounting during a hold (the card
 * closing or voice ending) releases it, so the mic never stays on behind the trainer's back.
 */
export function HoldToTalk({
  label,
  talking,
  talk,
  inRow = false,
}: {
  readonly label: string;
  readonly talking: boolean;
  readonly talk: (down: boolean) => void;
  /** In the compact card's closed row: the row's primary action (its icon alone below 480px, as Pause). */
  readonly inRow?: boolean;
}) {
  const down = useRef(false);
  const latest = useRef(talk);
  useEffect(() => {
    latest.current = talk;
  });
  useEffect(() => {
    const held = down;
    const release = latest;
    return () => {
      if (held.current) release.current(false);
    };
  }, []);
  const press = (on: boolean) => {
    if (down.current === on) return;
    down.current = on;
    talk(on);
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* no pointer to capture (synthetic events): the release still arrives on this button */
    }
    press(true);
  };
  const isKey = (e: KeyboardEvent) => e.key === ' ' || e.key === 'Enter';
  return (
    <Button
      size="md"
      leadingIcon="mic"
      variant={talking ? 'primary' : 'secondary'}
      className={cx(styles.hold, inRow && styles.rowAction)}
      onPointerDown={onPointerDown}
      onPointerUp={() => press(false)}
      onPointerCancel={() => press(false)}
      onLostPointerCapture={() => press(false)}
      onBlur={() => press(false)}
      onContextMenu={(e) => e.preventDefault()}
      onKeyDown={(e) => {
        if (!isKey(e)) return;
        e.preventDefault();
        if (!e.repeat) press(true);
      }}
      onKeyUp={(e) => {
        if (isKey(e)) press(false);
      }}
    >
      {label}
    </Button>
  );
}

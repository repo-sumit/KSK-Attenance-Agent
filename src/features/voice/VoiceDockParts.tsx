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
  paused: { icon: 'pause', tone: 'neutral', key: 'voice.status.paused' },
  reconnecting: { icon: 'refresh', tone: 'warning', key: 'voice.status.reconnecting' },
  error: { icon: 'mic-off', tone: 'error', key: 'voice.status.error' },
  ended: { icon: 'mic-off', tone: 'neutral', key: 'voice.status.ended' },
};

/**
 * What the dock shows for a session state. With push-to-talk on, the microphone is shut until Hold to talk is held
 * (session.ts opens it only when `!pushToTalk || talking`), so a "listening" session reads "Hold to talk" (mic off)
 * until the trainer holds the button; while it is held, and in every other status, the plain status shows.
 */
export function dockStatus(state: Pick<VoiceState, 'status' | 'pushToTalk' | 'talking'>): { readonly icon: IconName; readonly tone: Tone; readonly key: MessageKey } {
  if (state.status === 'listening' && state.pushToTalk && !state.talking) return { icon: 'mic-off', tone: 'neutral', key: 'voice.status.holdToTalk' };
  return STATUS[state.status];
}

/**
 * Room for the second caption line, push-to-talk and the hints without opening the dock. A 320×568 phone leaves
 * about 424px for the roster, so small screens get the one compact row and open the rest on demand.
 */
const ROOMY = '(min-width: 360px) and (min-height: 700px)';
const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function';
function subscribeRoomy(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => undefined;
  const query = window.matchMedia(ROOMY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
export function useRoomy(): boolean {
  return useSyncExternalStore(subscribeRoomy, () => !hasMatchMedia() || window.matchMedia(ROOMY).matches, () => true);
}

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

/** One caption, one line: "You: …" / "Sahayak: …", cut with an ellipsis. */
export function CaptionLine({ caption, who }: { readonly caption: Caption; readonly who: string }) {
  return (
    <p className={styles.caption}>
      <span className={styles.who}>{who}:</span> {caption.text}
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

/** A secondary action in the card's row (Use screen, Resume voice): its icon, and the label that names it. */
export function RowAction({ icon, label, onClick }: { readonly icon: IconName; readonly label: string; readonly onClick: () => void }) {
  return (
    <Button variant="secondary" size="md" leadingIcon={icon} onClick={onClick}>
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
  /** In the closed card's row on a small screen: no icon, so it fits where Use screen sits at 320px. */
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
      leadingIcon={inRow ? undefined : 'mic'}
      variant={talking ? 'primary' : 'secondary'}
      className={styles.hold}
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

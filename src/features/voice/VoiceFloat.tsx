'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal, preconnect } from 'react-dom';
import { useDockInset } from '@/components/shell/DockInset';
import { Icon } from '@/components/ui/icons/Icon';
import { useI18n } from '@/hooks/i18n';
import { useServices } from '@/hooks/services';
import { useVoice } from '@/hooks/voice';
import { cx } from '@/lib/cx';
import { GEMINI_LIVE_ORIGIN } from '@/services/voice/live/origin';
import { VoiceCard } from './VoiceCard';
import { useCardRest } from './useCardRest';
import { dockStatus } from './VoiceDockParts';
import styles from './VoiceFloat.module.css';

type Mode = 'button' | 'card';

/** The voice services whose start-up was already prefetched: once per page load (one container per page load). */
const prefetched = new WeakSet<object>();

/**
 * Voice Agent's one floating element (D-133, D-147), rendered once by VoiceProvider so it keeps its state across
 * routes, and portaled to <body>: one viewport overlay that never changes a screen's layout. Idle: a round mic button
 * at the bottom-right corner (an extended "Voice Agent" pill from 1136px), shown while voice is available; the tap
 * starts voice synchronously, inside the click, so the session creates its AudioContexts there. While voice runs it
 * grows into the voice card from the same corner; Minimize shrinks the card back to a round button there that shows
 * the live status (its name is the status text) while voice keeps running, and a tap opens the card again. An error
 * always opens the card (voice has stopped: Reconnect or Stop voice). Idle, the open card yields the screen: it rests as
 * the mini button by itself and opens again when the agent speaks or the status needs the trainer (useCardRest, R7);
 * a manual Minimize stays until the mini button is tapped. It sits just above the screen's pinned footer
 * and bottom navigation (DockInset), so it never covers a primary action; `<html data-voice-float>` gives the screens
 * scroll room, so every row can scroll clear of it.
 */
export function VoiceFloat() {
  const voice = useVoice();
  const voiceService = useServices().voice;
  const { t } = useI18n();
  const hintId = useId();
  const showId = useId();
  const [minimized, setMinimized] = useState(false);
  const [open, setOpen] = useState(false);
  const [float, setFloat] = useState<HTMLDivElement | null>(null);
  const dock = useDockInset(float);
  const miniRef = useRef<HTMLButtonElement>(null);
  const minimizeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const focusNext = useRef<'mini' | 'minimize' | null>(null);

  const state = voice.state;
  const error = state?.status === 'error';
  const rest = useCardRest(state, state !== null && !minimized && !error, float, () => setOpen(false));
  const showMini = state !== null && (minimized || rest.rested) && !error;
  const showCard = state !== null && !showMini;
  const showButton = state === null && voice.available;
  const mode: Mode | null = showCard ? 'card' : showMini || showButton ? 'button' : null;

  // Voice ending resets the float, so the next start opens the card with its extra controls closed; an error opens
  // the card again and keeps it open after a Reconnect (there is nothing to minimize while voice has stopped).
  // Adjusted while rendering, from the previous values (React's pattern for state that follows a change).
  const running = state !== null;
  const [seen, setSeen] = useState({ running, error });
  if (seen.running !== running || seen.error !== error) {
    setSeen({ running, error });
    if (!running) {
      setMinimized(false);
      setOpen(false);
    } else if (error) {
      setMinimized(false);
    }
  }

  // D-138: once the idle button shows (voice available, online), warm the start: the Gemini origin is preconnected
  // and the Live transport module is fetched in an idle moment, once per page load. Only when a live connection can
  // follow (the service says; scripted voice in demos and E2E never connects to Gemini).
  const warm = showButton && voice.online;
  useEffect(() => {
    if (!warm || prefetched.has(voiceService) || !voiceService.canWarm()) return;
    prefetched.add(voiceService);
    preconnect(GEMINI_LIVE_ORIGIN, { crossOrigin: 'anonymous' });
    const run = () => voiceService.prefetch();
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run);
    else window.setTimeout(run, 2000);
  }, [warm, voiceService]);

  // Focus follows minimize and expand: to the round button, then back to the card's Minimize.
  useEffect(() => {
    if (focusNext.current === 'mini' && miniRef.current) {
      miniRef.current.focus();
      focusNext.current = null;
    } else if (focusNext.current === 'minimize' && minimizeRef.current) {
      minimizeRef.current.focus();
      focusNext.current = null;
    }
  });

  // <html data-voice-float> gives every screen scroll room for the float (tokens.css, VoiceFloat.module.css).
  useLayoutEffect(() => {
    if (!mode) return;
    const root = document.documentElement;
    root.setAttribute('data-voice-float', mode);
    return () => root.removeAttribute('data-voice-float');
  }, [mode]);

  // Measure the float: its height is the scroll room screens keep (and the toast's lift).
  useLayoutEffect(() => {
    if (!float) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty('--voice-float-height', `${Math.ceil(float.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(float);
    return () => {
      observer?.disconnect();
      root.style.removeProperty('--voice-float-height');
    };
  }, [float]);

  if (!mode) return null;

  const minimize = () => {
    focusNext.current = 'mini';
    setMinimized(true);
  };
  const expand = () => {
    focusNext.current = 'minimize';
    setMinimized(false);
    rest.wake();
  };
  const startVoice = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return; // a double tap starts voice once
    if (!voice.online) return; // inactive offline: the description says why
    voice.start();
  };

  const vars = { '--float-dock': `${dock}px` } as CSSProperties;
  const look = state ? dockStatus(state) : null;

  return createPortal(
    <div ref={setFloat} className={cx(styles.float, mode === 'card' && styles.asCard)} style={vars} data-voice-float={mode} {...rest.handlers}>
      {showButton && (
        <>
          <button type="button" className={styles.fab} aria-describedby={hintId} aria-disabled={voice.online ? undefined : 'true'} onClick={startVoice}>
            <Icon name="mic" size={24} />
            <span className={styles.fabLabel}>{t('voice.mode')}</span>
          </button>
          <span id={hintId} className="visually-hidden">
            {voice.online ? t(voice.marks ? 'voice.modeHint' : 'voice.modeHintAsk') : t('voice.unavailableOffline')}
          </span>
        </>
      )}
      {showMini && look && (
        <>
          <button ref={miniRef} type="button" className={cx(styles.fab, styles.mini)} data-tone={look.tone} aria-expanded="false" aria-describedby={showId} onClick={expand}>
            <span className={styles.miniIcon} data-icon={look.icon}>
              <Icon name={look.icon} size={24} />
            </span>
            <span className="visually-hidden">{t(look.key)}</span>
          </button>
          <span id={showId} className="visually-hidden">
            {t('voice.showControls')}
          </span>
        </>
      )}
      {showCard && <VoiceCard open={open} onOpenChange={setOpen} onMinimize={minimize} minimizeRef={minimizeRef} cardRef={cardRef} />}
    </div>,
    document.body,
  );
}

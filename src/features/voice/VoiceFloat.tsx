'use client';
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { useDockAnchor } from '@/components/shell/DockAnchor';
import { Icon } from '@/components/ui/icons/Icon';
import { useI18n } from '@/hooks/i18n';
import { useVoice } from '@/hooks/voice';
import { cx } from '@/lib/cx';
import { VoiceCard } from './VoiceCard';
import { dockStatus } from './VoiceDockParts';
import styles from './VoiceFloat.module.css';

type Mode = 'button' | 'card';

/** Where the float sits, measured from the screen's dock anchor (DockAnchor): CSS variables read by the stylesheet. */
interface Place {
  readonly left: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
}

/**
 * Voice mode's one floating element (D-133), rendered once by VoiceProvider so it keeps its state across routes.
 * Idle: a round mic button at the bottom-right (an extended "Voice mode" pill from 600px), shown while voice is
 * available; the tap starts voice synchronously, inside the click, so the session creates its AudioContexts there.
 * While voice runs it grows into the voice card; Minimize shrinks the card back to a round button that shows the
 * live status (its name is the status text) while voice keeps running, and a tap opens the card again. An error
 * always opens the card (voice has stopped: Reconnect or Stop voice). `<html data-voice-float>` tells the screens to
 * reserve room for it, so it never covers a row, the Submit button or the bottom navigation.
 */
export function VoiceFloat() {
  const voice = useVoice();
  const { t } = useI18n();
  const anchor = useDockAnchor();
  const hintId = useId();
  const showId = useId();
  const [minimized, setMinimized] = useState(false);
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const floatRef = useRef<HTMLDivElement>(null);
  const miniRef = useRef<HTMLButtonElement>(null);
  const minimizeRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const focusNext = useRef<'mini' | 'minimize' | null>(null);

  const state = voice.state;
  const error = state?.status === 'error';
  const showMini = state !== null && minimized && !error;
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

  // <html data-voice-float> lets every screen reserve room for the float (tokens.css, VoiceFloat.module.css).
  useLayoutEffect(() => {
    if (!mode) return;
    const root = document.documentElement;
    root.setAttribute('data-voice-float', mode);
    return () => root.removeAttribute('data-voice-float');
  }, [mode]);

  // Measure the float (its height is the room screens reserve) and the dock anchor (where the float sits).
  useLayoutEffect(() => {
    if (!mode) return;
    const root = document.documentElement;
    const measure = () => {
      const el = floatRef.current;
      if (el) root.style.setProperty('--voice-float-height', `${Math.ceil(el.getBoundingClientRect().height)}px`);
      if (!anchor || !anchor.isConnected) return setPlace(null);
      const r = anchor.getBoundingClientRect();
      setPlace((prev) => {
        const next = { left: r.left, right: window.innerWidth - r.right, bottom: window.innerHeight - r.bottom, width: r.width };
        return prev && prev.left === next.left && prev.right === next.right && prev.bottom === next.bottom && prev.width === next.width ? prev : next;
      });
    };
    measure();
    // The anchor moves without resizing when its dock changes below it (a footer or the bottom navigation mounting
    // after the screen's data loads), so the dock itself is watched too.
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (observer && floatRef.current) observer.observe(floatRef.current);
    if (observer && anchor) observer.observe(anchor);
    if (observer && anchor?.parentElement) observer.observe(anchor.parentElement);
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      root.style.removeProperty('--voice-float-height');
    };
  }, [mode, anchor]);

  if (!mode) return null;

  const minimize = () => {
    focusNext.current = 'mini';
    setMinimized(true);
  };
  const expand = () => {
    focusNext.current = 'minimize';
    setMinimized(false);
  };
  const startVoice = (event: MouseEvent<HTMLButtonElement>) => {
    if (event.detail > 1) return; // a double tap starts voice once
    if (!voice.online) return; // inactive offline: the description says why
    voice.start();
  };

  const vars = (place
    ? { '--float-left': `${place.left}px`, '--float-right': `${place.right}px`, '--float-bottom': `${place.bottom}px`, '--float-width': `${place.width}px` }
    : {}) as CSSProperties;
  const look = state ? dockStatus(state) : null;

  return (
    <div ref={floatRef} className={cx(styles.float, mode === 'card' ? styles.asCard : styles.asButton)} style={vars} data-voice-float={mode}>
      {showButton && (
        <>
          <button type="button" className={styles.fab} aria-describedby={hintId} aria-disabled={voice.online ? undefined : 'true'} onClick={startVoice}>
            <Icon name="mic" size={24} />
            <span className={styles.fabLabel}>{t('voice.mode')}</span>
          </button>
          <span id={hintId} className="visually-hidden">
            {voice.online ? t('voice.modeHint') : t('voice.unavailableOffline')}
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
    </div>
  );
}

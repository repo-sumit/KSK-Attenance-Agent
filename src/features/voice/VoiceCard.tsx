'use client';
import type { Ref } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useVoice } from '@/hooks/voice';
import { cx } from '@/lib/cx';
import type { Caption } from '@/services/voice/session';
import { cameraHolds, CaptionLine, dockStatus, ErrorLine, Hint, HoldToTalk, LevelBar, lastCaptions, RowAction, StatusText, useCardLayout, visibleCaptions } from './VoiceDockParts';
import styles from './VoiceCard.module.css';

interface VoiceCardProps {
  /** The rest of the controls where they do not always show (the provider keeps it across routes). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onMinimize: () => void;
  readonly minimizeRef: Ref<HTMLButtonElement>;
  readonly cardRef: Ref<HTMLElement>;
}

/**
 * The voice card (D-133, D-136, D-147): what the floating voice button grows into while Voice Agent is on, an overlay
 * at the viewport's corner that rests small. Rendered once by VoiceFloat, so it keeps its state across routes. An
 * error stops voice, so the card then offers Reconnect or Stop voice, not Minimize. A modal sheet (showModal) makes it
 * inert while open; voice keeps running.
 *
 * - Two lines (from 600px, about 128px): the status toggle (icon + text + colour) and mic level with Minimize at the
 *   end; the error, warning or caption; the labelled actions on their own line, so the status never sits under a
 *   button.
 * - One compact row (every phone, at most 88px): the status toggle, the primary action (its icon alone below 480px),
 *   Stop voice (its icon) and Minimize, one line under it.
 * - Either way the extras (the second caption, the hints, push-to-talk and the minutes-left note) open from the
 *   status, at any screen height.
 * - An error has nothing more to show (no captions, hints, push-to-talk or Minimize): the status is plain text, never
 *   a toggle that opens nothing.
 *
 * With push-to-talk on and the extras closed, Hold to talk takes Pause's place (the mic opens only while it is held;
 * Pause is one tap away in the opened card). While a face camera holds the mic (D-148) the status reads "Mic off for
 * face check", with no level bar, no Pause and no Hold to talk (voice comes back by itself); Stop voice stays. Agent
 * captions that say nothing (a filler turn) are never shown.
 */
export function VoiceCard({ open, onOpenChange, onMinimize, minimizeRef, cardRef }: VoiceCardProps) {
  const voice = useVoice();
  const { t } = useI18n();
  const { wide } = useCardLayout();
  const state = voice.state;
  if (!state) return null;

  const { status, error } = state;
  const compact = !wide;
  const streaming = status === 'listening' || status === 'speaking' || status === 'working';
  const live = streaming || status === 'paused';
  const camera = cameraHolds(state); // the mic is off until the face check ends: nothing to pause or hold
  const more = open && status !== 'error'; // an error has no extras to open
  const holdInRow = !more && streaming && !camera && state.pushToTalk;
  const captions = visibleCaptions(state.captions);
  const { latest, other } = lastCaptions(captions);
  const lines = (more ? [other, latest] : [latest]).filter((c): c is Caption => c !== undefined);
  const fresh = !error && captions.length === 0;
  const who = (c: Caption) => t(c.who === 'trainer' ? 'voice.you' : 'voice.agent');
  const look = dockStatus(state);
  const statusText = t(look.key);
  // Under three minutes the warning must show even while the extras are closed: it takes the caption line's place.
  const lowTime = live && state.minutesLeft > 0 && state.minutesLeft < 3 ? t('voice.minutesLeft', { count: state.minutesLeft }) : null;
  const closedWarning = !more && !error && lowTime !== null;
  // The mic level means something only while the mic streams.
  const level = streaming && !camera ? <LevelBar level={state.level} /> : null;

  // Nothing to minimize while voice has stopped.
  const minimizeButton =
    status !== 'error' ? (
      <button ref={minimizeRef} type="button" className={styles.minimize} aria-label={t('voice.minimize')} onClick={onMinimize}>
        <Icon name="minus" size={20} />
      </button>
    ) : null;

  // The status opens and closes the extras; with an error nothing more can open, so it is plain text.
  const toggle = status === 'error' ? (
    <div className={styles.state}>
      <StatusText look={look} text={statusText} />
      {level}
    </div>
  ) : (
    <button type="button" className={cx(styles.state, styles.toggle)} aria-expanded={open} onClick={() => onOpenChange(!open)}>
      <span className={styles.toggleLine}>
        <StatusText look={look} text={statusText} />
        <Icon name={open ? 'chevron-down' : 'chevron-up'} size={16} className={styles.chevron} />
      </span>
      {level}
      <span className="visually-hidden">{t('voice.moreControls')}</span>
    </button>
  );

  const actions = (
    <div className={styles.actions}>
      {state.canReconnect && (
        <Button size="md" onClick={voice.reconnect}>
          {t('voice.reconnect')}
        </Button>
      )}
      {holdInRow && <HoldToTalk label={t('voice.holdToTalk')} talking={state.talking} talk={voice.talk} inRow={compact} />}
      {streaming && !camera && !holdInRow && <RowAction icon="pause" label={t('voice.pause')} name={t('voice.pauseVoice')} onClick={voice.pause} />}
      {status === 'paused' && <RowAction icon="mic" label={t('voice.resume')} onClick={voice.resume} />}
      {/* The compact row shows Stop voice as its square icon (its name stays for screen readers), as the header's demo trigger (D-066). */}
      <Button variant="secondary" size="md" leadingIcon="square" className={cx(styles.stop, compact && styles.stopIcon)} onClick={voice.stop}>
        <span className={compact ? 'visually-hidden' : undefined}>{t('voice.stop')}</span>
      </Button>
    </div>
  );

  // The error, the warning or the caption line (two caption lines while the extras show).
  const message = (
    <>
      {error && <ErrorLine code={error} text={t(`voice.error.${error}`)} />}
      {closedWarning && (
        <StatusLine tone="warning" icon="clock" nowrap>
          {lowTime}
        </StatusLine>
      )}
      {!error && !closedWarning && lines.map((c, i) => <CaptionLine key={`${i}-${c.who}`} caption={c} who={who(c)} />)}
      {fresh && !more && !closedWarning && (
        <Hint icon="info" compact>
          {t('voice.privacy')}
        </Hint>
      )}
    </>
  );

  // While the extras show: the warning (once), and the first-connect hints.
  const notes = more ? (
    <>
      {lowTime && (
        <StatusLine tone="warning" icon="clock">
          {lowTime}
        </StatusLine>
      )}
      {fresh && <Hint icon="headphones">{t('voice.earphones')}</Hint>}
      {fresh && <Hint icon="info">{t('voice.privacy')}</Hint>}
    </>
  ) : null;

  // Push-to-talk, while the extras show (the setting stays while the camera holds the mic; Hold to talk does not).
  const ptt = more ? (
    <div className={styles.ptt}>
      <Button variant="secondary" size="md" aria-pressed={state.pushToTalk} onClick={() => voice.setPushToTalk(!state.pushToTalk)}>
        {t('voice.pushToTalk')}
      </Button>
      {state.pushToTalk && !camera && <HoldToTalk label={t('voice.holdToTalk')} talking={state.talking} talk={voice.talk} />}
    </div>
  ) : null;

  return (
    <section ref={cardRef} tabIndex={-1} className={cx(styles.card, compact && error && styles.withError)} aria-label={t('voice.mode')} data-voice-status={status}>
      {compact ? (
        <>
          <div className={cx(styles.row, styles.rowCompact)}>
            {toggle}
            {actions}
            {minimizeButton}
          </div>
          {message}
          {more && (
            <div className={styles.more}>
              {notes}
              {ptt}
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.head}>
            {toggle}
            {minimizeButton}
          </div>
          {message}
          {notes}
          <div className={cx(styles.row, styles.rowWide)}>{actions}</div>
          {ptt && <div className={styles.more}>{ptt}</div>}
        </>
      )}
    </section>
  );
}

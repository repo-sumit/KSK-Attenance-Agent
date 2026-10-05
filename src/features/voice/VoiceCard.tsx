'use client';
import type { Ref } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useVoice } from '@/hooks/voice';
import { cx } from '@/lib/cx';
import type { Caption } from '@/services/voice/session';
import { CaptionLine, dockStatus, ErrorLine, Hint, HoldToTalk, LevelBar, lastCaptions, RowAction, StatusText, useCardLayout } from './VoiceDockParts';
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
 * The voice card (D-133, D-136): what the floating voice button grows into while Voice Agent is on. Rendered once by
 * VoiceFloat, so it keeps its state across routes. An error stops voice, so the card then offers Reconnect or Stop
 * voice, not Minimize. A modal sheet (showModal) makes it inert while open; voice keeps running.
 *
 * - Two lines (from 400px wide, or on a tall screen): the status (icon + text + colour) and mic level with Minimize
 *   at the end; the error, warning or caption; the labelled actions on their own line, so the status never sits under
 *   a button; then push-to-talk. On a tall screen everything shows; on a short wide one the status opens push-to-talk,
 *   the second caption and the hints.
 * - One compact row (narrow and short phones, at most 88px at 320×568): the status toggle beside Use screen and Stop
 *   voice (its icon), one line under it; Minimize and the rest open from the toggle.
 * - An error has nothing more to show (no captions, hints, push-to-talk or Minimize): the status is plain text, never
 *   a toggle that opens nothing.
 *
 * With push-to-talk on and the extras closed, Hold to talk takes Use screen's place (the mic opens only while it is
 * held; Use screen is one tap away in the opened card).
 */
export function VoiceCard({ open, onOpenChange, onMinimize, minimizeRef, cardRef }: VoiceCardProps) {
  const voice = useVoice();
  const { t } = useI18n();
  const { tall, wide } = useCardLayout();
  const state = voice.state;
  if (!state) return null;

  const { status, error } = state;
  const compact = !tall && !wide;
  const streaming = status === 'listening' || status === 'speaking';
  const live = streaming || status === 'paused';
  const more = tall || (open && status !== 'error'); // an error has no extras to open
  const holdInRow = !more && streaming && state.pushToTalk;
  const { latest, other } = lastCaptions(state.captions);
  const lines = (more ? [other, latest] : [latest]).filter((c): c is Caption => c !== undefined);
  const fresh = !error && state.captions.length === 0;
  const who = (c: Caption) => t(c.who === 'trainer' ? 'voice.you' : 'voice.agent');
  const look = dockStatus(state);
  const statusText = t(look.key);
  // Under three minutes the warning must show even while the extras are closed: it takes the caption line's place.
  const lowTime = live && state.minutesLeft > 0 && state.minutesLeft < 3 ? t('voice.minutesLeft', { count: state.minutesLeft }) : null;
  const closedWarning = !more && !error && lowTime !== null;
  // The mic level means something only while the mic streams.
  const level = streaming ? <LevelBar level={state.level} /> : null;

  // Nothing to minimize while voice has stopped.
  const minimizeButton =
    status !== 'error' ? (
      <button ref={minimizeRef} type="button" className={styles.minimize} aria-label={t('voice.minimize')} onClick={onMinimize}>
        <Icon name="minus" size={20} />
      </button>
    ) : null;

  // The status as plain text (and the mic level): on a tall screen, and with an error, where nothing more can open.
  const plain = (
    <div className={styles.state}>
      <StatusText look={look} text={statusText} />
      {level}
    </div>
  );

  // Where the extras do not always show, the status opens and closes them (while there is something to open).
  const toggle = status === 'error' ? plain : (
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
      {streaming && !holdInRow && <RowAction icon="pause" label={t('voice.useScreen')} onClick={voice.pause} />}
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

  // Push-to-talk (and, in the compact card, Minimize: its closed row is full).
  const ptt =
    more && status !== 'error' ? (
      <div className={styles.ptt}>
        <Button variant="secondary" size="md" aria-pressed={state.pushToTalk} onClick={() => voice.setPushToTalk(!state.pushToTalk)}>
          {t('voice.pushToTalk')}
        </Button>
        {state.pushToTalk && <HoldToTalk label={t('voice.holdToTalk')} talking={state.talking} talk={voice.talk} />}
        {compact && minimizeButton}
      </div>
    ) : null;

  return (
    <section ref={cardRef} tabIndex={-1} className={cx(styles.card, compact && error && styles.withError)} aria-label={t('voice.mode')} data-voice-status={status}>
      {compact ? (
        <>
          <div className={cx(styles.row, styles.rowCompact)}>
            {toggle}
            {actions}
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
            {tall ? plain : toggle}
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

'use client';
import type { Ref } from 'react';
import { Button } from '@/components/ui/Button';
import { Icon } from '@/components/ui/icons/Icon';
import { StatusLine } from '@/components/ui/StatusLine';
import { useI18n } from '@/hooks/i18n';
import { useVoice } from '@/hooks/voice';
import { cx } from '@/lib/cx';
import type { Caption } from '@/services/voice/session';
import { CaptionLine, dockStatus, ErrorLine, Hint, HoldToTalk, LevelBar, lastCaptions, RowAction, StatusText, useRoomy } from './VoiceDockParts';
import styles from './VoiceCard.module.css';

interface VoiceCardProps {
  /** The rest of the controls on a small screen (the provider keeps it across routes). */
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onMinimize: () => void;
  readonly minimizeRef: Ref<HTMLButtonElement>;
  readonly cardRef: Ref<HTMLElement>;
}

/**
 * The voice card (D-133): what the floating voice button grows into while Voice mode is on. One compact row
 * (status, mic level, Use screen or Resume, Stop voice, and Minimize where there is room) and one line (the error, the latest caption, or
 * the privacy line); the second caption, push-to-talk and the hints join it on taller screens or when the trainer
 * opens the card (with push-to-talk on, Hold to talk stays in the closed row instead of Use screen). Rendered once
 * by VoiceFloat, so it keeps its state across routes. An error stops voice, so the card then offers Reconnect or
 * Stop voice, not Minimize. A modal sheet (showModal) makes it inert while open; voice keeps running.
 */
export function VoiceCard({ open, onOpenChange, onMinimize, minimizeRef, cardRef }: VoiceCardProps) {
  const voice = useVoice();
  const { t } = useI18n();
  const roomy = useRoomy();
  const state = voice.state;
  if (!state) return null;

  const { status, error } = state;
  const streaming = status === 'listening' || status === 'speaking';
  const live = streaming || status === 'paused';
  const more = roomy || open;
  // With push-to-talk on, the mic opens only while Hold to talk is held, so the closed card on a small screen must
  // still offer it: it takes Use screen's place in the row (Use screen is one tap away in the opened card).
  const holdInRow = !more && streaming && state.pushToTalk;
  const { latest, other } = lastCaptions(state.captions);
  const lines = (more ? [other, latest] : [latest]).filter((c): c is Caption => c !== undefined);
  const fresh = !error && state.captions.length === 0;
  const who = (c: Caption) => t(c.who === 'trainer' ? 'voice.you' : 'voice.agent');
  const look = dockStatus(state);
  const statusText = t(look.key);
  // Under three minutes the warning must show even in the closed card: it takes the caption line's place.
  const lowTime = live && state.minutesLeft > 0 && state.minutesLeft < 3 ? t('voice.minutesLeft', { count: state.minutesLeft }) : null;
  const compactWarning = !more && !error && lowTime !== null;
  // The mic level means something only while the mic streams.
  const level = streaming ? <LevelBar level={state.level} /> : null;

  // Minimize sits in the row where there is room; on a compact phone the row is full (status, Use screen or Hold to
  // talk, Stop), so it joins the controls the status toggle opens. Nothing to minimize while voice has stopped.
  const minimizeButton =
    status !== 'error' ? (
      <button ref={minimizeRef} type="button" className={styles.minimize} aria-label={t('voice.minimize')} onClick={onMinimize}>
        <Icon name="minus" size={20} />
      </button>
    ) : null;

  return (
    <section ref={cardRef} tabIndex={-1} className={cx(styles.card, error && styles.withError)} aria-label={t('voice.mode')} data-voice-status={status}>
      {/* Where there is room, the status has its own line (status is icon + text + colour; the actions never squeeze
          it out), with Minimize at its end; the actions follow on the next line. */}
      {roomy && (
        <div className={styles.head}>
          <div className={styles.state}>
            <StatusText look={look} text={statusText} />
            {level}
          </div>
          {minimizeButton}
        </div>
      )}
      <div className={cx(styles.row, roomy && styles.rowWide)}>
        {!roomy && (
          <button type="button" className={cx(styles.state, styles.toggle)} aria-expanded={open} onClick={() => onOpenChange(!open)}>
            <span className={styles.toggleLine}>
              <StatusText look={look} text={statusText} />
              <Icon name={open ? 'chevron-down' : 'chevron-up'} size={16} className={styles.chevron} />
            </span>
            {level}
            <span className="visually-hidden">{t('voice.moreControls')}</span>
          </button>
        )}
        <div className={styles.actions}>
          {state.canReconnect && (
            <Button size="md" onClick={voice.reconnect}>
              {t('voice.reconnect')}
            </Button>
          )}
          {holdInRow && <HoldToTalk label={t('voice.holdToTalk')} talking={state.talking} talk={voice.talk} inRow />}
          {streaming && !holdInRow && <RowAction icon="pause" label={t('voice.useScreen')} onClick={voice.pause} />}
          {status === 'paused' && <RowAction icon="mic" label={t('voice.resume')} onClick={voice.resume} />}
          <Button variant="secondary" size="md" leadingIcon="square" className={styles.stop} onClick={voice.stop}>
            <span className={styles.stopLabel}>{t('voice.stop')}</span>
          </Button>
        </div>
      </div>

      {error && <ErrorLine code={error} text={t(`voice.error.${error}`)} />}
      {compactWarning && (
        <StatusLine tone="warning" icon="clock" nowrap>
          {lowTime}
        </StatusLine>
      )}
      {!error && !compactWarning && lines.map((c, i) => <CaptionLine key={`${i}-${c.who}`} caption={c} who={who(c)} />)}
      {fresh && !more && !compactWarning && (
        <Hint icon="info" compact>
          {t('voice.privacy')}
        </Hint>
      )}

      {more && (
        <div className={styles.more}>
          {lowTime && (
            <StatusLine tone="warning" icon="clock">
              {lowTime}
            </StatusLine>
          )}
          {fresh && <Hint icon="headphones">{t('voice.earphones')}</Hint>}
          {fresh && <Hint icon="info">{t('voice.privacy')}</Hint>}
          {status !== 'error' && (
            <div className={styles.ptt}>
              <Button variant="secondary" size="md" aria-pressed={state.pushToTalk} onClick={() => voice.setPushToTalk(!state.pushToTalk)}>
                {t('voice.pushToTalk')}
              </Button>
              {state.pushToTalk && <HoldToTalk label={t('voice.holdToTalk')} talking={state.talking} talk={voice.talk} />}
              {!roomy && minimizeButton}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

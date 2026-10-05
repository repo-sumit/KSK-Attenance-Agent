'use client';
import { useLayoutEffect, useState } from 'react';
import { useI18n } from '@/hooks/i18n';
import type { VoiceErrorCode } from '@/services/voice/session';

/**
 * Voice Agent's screen-reader announcements, in two regions the provider keeps mounted for the whole signed-in
 * session. The dock re-mounts on every route, so a live region inside it is read again on each navigation or, when
 * it is inserted already filled, not at all (C8); these regions exist before their text arrives and never re-mount.
 * - An alert holding the error while one is shown: a new error is read once; a dock re-mounted by navigation is not.
 * - A polite status that says "Voice ended" when Voice Agent turns off, since the dock and its status go with it (m14).
 * When Voice Agent turns off and focus went down with the dock (Stop voice, or the session ending itself), focus moves
 * to the screen's main region, so a keyboard or switch user keeps their place on the screen.
 */
export function VoiceAnnouncer({ on, error }: { readonly on: boolean; readonly error: VoiceErrorCode | null }) {
  const { t } = useI18n();
  const [wasOn, setWasOn] = useState(on);
  const [ended, setEnded] = useState(false);
  if (wasOn !== on) {
    setWasOn(on);
    setEnded(!on);
  }

  // Before paint, so focus never rests on <body> in between.
  useLayoutEffect(() => {
    if (!ended) return;
    const active = document.activeElement;
    if (active && active !== document.body) return; // focus is somewhere real (a row, a field): leave it there
    document.getElementById('main')?.focus({ preventScroll: true });
  }, [ended]);

  return (
    <>
      <div className="visually-hidden" role="alert" data-voice-announce="error">
        {error ? t(`voice.error.${error}`) : ''}
      </div>
      <div className="visually-hidden" role="status" aria-live="polite" data-voice-announce="status">
        {ended ? t('voice.status.ended') : ''}
      </div>
    </>
  );
}

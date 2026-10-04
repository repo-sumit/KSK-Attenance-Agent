'use client';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useI18n } from '@/hooks/i18n';
import { useContainer } from '@/hooks/services';
import { useSession } from '@/hooks/session';
import { VoiceContext, VoiceFocusContext, type VoiceApi } from '@/hooks/voice';
import { audioSupported } from '@/services/voice/audio/types';
import type { VoiceSession, VoiceState } from '@/services/voice/session';
import { screenSignal, voiceFingerprint } from './screen-signal';
import { useActionBus } from './useActionBus';
import { VoiceAnnouncer } from './VoiceAnnouncer';
import { ScreenSync } from './useScreenSync';
import { VoiceFloat } from './VoiceFloat';

/** Voice mode is on from start() until the trainer stops it or the session ends itself (an error stays on, to explain). */
const isOn = (state: VoiceState | null): state is VoiceState => state !== null && state.status !== 'idle' && state.status !== 'ended';

/**
 * Voice mode for the signed-in screens (D-085). Mounted inside SessionGate, so it exists only with a ready
 * session and lives across navigation. It owns the one VoiceSession, offers the voice API to the screens, renders
 * the dock into every ScreenLayout, follows the Action Bus, reports screen changes and the WebView's visibility, and
 * announces errors and the end of voice from regions that outlive the dock (VoiceAnnouncer).
 * A new session or a changed configuration stops voice (PRD §5.2); a rebuilt context with the same facts does not
 * (the demo rebuilds it on every panel change), and connectivity loss is the session's own concern.
 */
export function VoiceProvider({ children }: { readonly children: ReactNode }) {
  const ctx = useSession();
  const { services, simulation } = useContainer();
  const { language } = useI18n();
  const [entry, setEntry] = useState<{ readonly session: VoiceSession; readonly fingerprint: string } | null>(null);
  const fingerprint = voiceFingerprint(ctx);
  const session = entry && entry.fingerprint === fingerprint ? entry.session : null;

  useEffect(() => {
    if (entry && entry.fingerprint !== fingerprint) entry.session.stop();
  }, [entry, fingerprint]);

  // Signing out unmounts this provider: voice ends with the session.
  const current = useRef(entry);
  useEffect(() => {
    current.current = entry;
  });
  useEffect(() => {
    const latest = current;
    return () => latest.current?.session.stop();
  }, []);

  const subscribe = useCallback((onChange: () => void) => (session ? session.subscribe(onChange) : () => undefined), [session]);
  const raw = useSyncExternalStore(subscribe, () => session?.getState() ?? null, () => null);
  const state = isOn(raw) ? raw : null;

  const { connectivity } = services;
  const watchOnline = useCallback((onChange: () => void) => connectivity.subscribe(() => onChange()), [connectivity]);
  const online = useSyncExternalStore(watchOnline, () => connectivity.isOnline(), () => true);

  const planned = useMemo(() => services.voice.plan(ctx, language) !== null, [services, ctx, language]);
  // Scripted voice (demo, E2E) needs no microphone; live voice needs a secure context, getUserMedia and AudioWorklet.
  const available = planned && (simulation.get().voice === 'scripted' || audioSupported());

  // Synchronous from the click: the session creates and resumes its AudioContexts before anything is awaited.
  // Voice can start on any screen (D-133): the session hears which one before its kickoff reads the flow (the
  // executor's flow starts at Home, so Home itself needs no signal).
  const start = useCallback(() => {
    const started = services.voice.start(ctx, language);
    if (!started) return;
    setEntry({ session: started, fingerprint: voiceFingerprint(ctx) });
    const signal = screenSignal(window.location.pathname, new URLSearchParams(window.location.search));
    if (signal.kind !== 'home') started.onScreen(signal);
  }, [services, ctx, language]);

  const api = useMemo<VoiceApi>(
    () => ({
      available,
      online,
      state,
      start,
      stop: () => session?.stop(),
      pause: () => session?.pause(),
      resume: () => session?.resume(),
      reconnect: () => session?.reconnect(),
      setPushToTalk: (on) => session?.setPushToTalk(on),
      talk: (down) => session?.talk(down),
    }),
    [available, online, state, start, session],
  );

  useActionBus({ running: state !== null && state.status !== 'error', stop: api.stop });

  useEffect(() => {
    if (!session) return;
    const sync = () => session.setHidden(document.hidden);
    sync();
    document.addEventListener('visibilitychange', sync);
    return () => document.removeEventListener('visibilitychange', sync);
  }, [session]);

  const on = state !== null;

  return (
    <VoiceContext.Provider value={api}>
      <VoiceFocusContext.Provider value={state?.focus ?? null}>
        <Suspense fallback={null}>
          <ScreenSync session={session} />
        </Suspense>
        <VoiceAnnouncer on={on} error={state?.error ?? null} />
        {children}
        <VoiceFloat />
      </VoiceFocusContext.Provider>
    </VoiceContext.Provider>
  );
}

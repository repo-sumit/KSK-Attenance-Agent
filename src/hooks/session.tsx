'use client';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import type { SessionContext } from '@/services/context';
import { useContainer } from './services';

export type SessionState =
  | { readonly status: 'loading' }
  | { readonly status: 'signed_out' }
  | { readonly status: 'ready'; readonly ctx: SessionContext };

interface SessionApi {
  readonly state: SessionState;
  reload(): Promise<void>;
}

const SessionCtx = createContext<SessionApi | null>(null);

/**
 * Holds the SessionContext (user, institute, resolved config, access, journey).
 * Re-resolved on login/logout and — demo only — when the presenter changes the
 * configuration, which the app treats as a new session start (PRD §5.2).
 */
export function SessionProvider({ children }: { readonly children: ReactNode }) {
  const { services, bus } = useContainer();
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const reload = useCallback(async () => {
    const ctx = await services.session.load();
    setState(ctx ? { status: 'ready', ctx } : { status: 'signed_out' });
  }, [services]);

  useEffect(() => {
    let alive = true;
    // Only the latest load may set the state: with a network-backed source (D-143) an earlier, faster load
    // ("nobody signed in yet") can finish after a later one started.
    let latest = 0;
    const apply = () => {
      const run = ++latest;
      return services.session.load().then((ctx) => {
        if (alive && run === latest) setState(ctx ? { status: 'ready', ctx } : { status: 'signed_out' });
      });
    };
    void apply();
    const unsubscribe = bus.subscribe(['session', 'config', 'face', 'demo'], (topic) => {
      // A sign-in while signed out is loading, not signed out: guards wait instead of sending the user to login.
      if (topic === 'session') setState((s) => (s.status === 'signed_out' ? { status: 'loading' } : s));
      void apply();
    });
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [bus, services]);

  return <SessionCtx.Provider value={{ state, reload }}>{children}</SessionCtx.Provider>;
}

export function useSessionState(): SessionApi {
  const api = useContext(SessionCtx);
  if (!api) throw new Error('useSessionState outside SessionProvider');
  return api;
}

/** The signed-in context. Only valid inside the (app) route group, which guards it. */
export function useSession(): SessionContext {
  const { state } = useSessionState();
  if (state.status !== 'ready') throw new Error('useSession used without a signed-in session');
  return state.ctx;
}

export const useJourney = () => useSession().journey;

// @vitest-environment jsdom
/**
 * The verification run paces itself to Voice Agent (D-148): it waits for the agent before the camera opens, after
 * "Location verified" and after "Identity verified"; every wait is capped (the caps it asks for) and ends when the
 * screen closes; the pass is granted once, only after the face step (INV-16).
 */
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastProvider } from '@/components/ui/Toast';
import { VerificationFlow } from '@/features/verification/VerificationFlow';
import { useVerification } from '@/features/verification/useVerification';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { VoiceContext, VoicePaceContext, type VoiceApi } from '@/hooks/voice';
import type { SessionContext } from '@/services/context';
import type { CapturedFrame } from '@/services/face';
import type { VoiceState } from '@/services/voice/session';
import { setup, signIn } from '../helpers/app';

const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx, useJourney: () => (signed.ctx as SessionContext).journey }));
/** Each screen hold, with the time it asked for (instant here). */
const holds = vi.hoisted(() => [] as number[]);
/** With `manual` on, a hold waits until the test releases it (to see what runs beside it). */
const holdGate = vi.hoisted(() => ({ manual: false, pending: [] as Array<() => void> }));
vi.mock('@/hooks/useSimDelay', () => ({
  useSimDelay: () => async (ms: number, signal?: AbortSignal) => {
    holds.push(ms);
    if (holdGate.manual) await new Promise<void>((resolve) => holdGate.pending.push(resolve));
    return !signal?.aborted;
  },
}));

vi.mock('@/components/shell/ScreenLayout', () => ({ ScreenLayout: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/features/shell/AppHeader', () => ({ AppHeader: () => null }));
/** The live camera: a stand-in that takes the photo when pressed. */
vi.mock('@/features/face/FaceCheck', () => ({
  FaceCheck: ({ onDone }: { onDone: (frame: unknown) => void }) => (
    <button type="button" onClick={() => onDone({ width: 1, height: 1 })}>
      live camera
    </button>
  ),
}));

const LIVE: VoiceState = { status: 'listening', error: null, captions: [], level: 0, pushToTalk: false, talking: false, canReconnect: false, minutesLeft: 10, focus: null, micHeld: null };
const FRAME = { width: 1, height: 1 } as unknown as CapturedFrame;

interface Wait {
  readonly capMs: number;
  readonly signal?: AbortSignal;
  readonly resolve: () => void;
}

/** A fake Voice Agent: every settle() waits until the test resolves it. */
function fakeVoice(state: VoiceState | null = LIVE) {
  const waits: Wait[] = [];
  const noop = () => undefined;
  const api: VoiceApi = {
    available: true, marks: true, online: true, state,
    start: noop, stop: noop, pause: noop, resume: noop, reconnect: noop, setPushToTalk: noop, talk: noop,
    settle: (capMs, signal) => new Promise<void>((resolve) => waits.push({ capMs, signal, resolve })),
  };
  return { api, waits };
}

/** The fake voice, as VoiceProvider offers it: the whole API, and what paces a screen (live, settle). */
function WithVoice({ api, children }: { readonly api: VoiceApi; readonly children: ReactNode }) {
  const live = api.state?.status === 'listening' || api.state?.status === 'speaking';
  return (
    <VoiceContext.Provider value={api}>
      <VoicePaceContext.Provider value={{ live, settle: api.settle }}>{children}</VoicePaceContext.Provider>
    </VoiceContext.Provider>
  );
}

beforeEach(() => {
  holds.length = 0;
  holdGate.manual = false;
  holdGate.pending.length = 0;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mount(voice: VoiceApi | null) {
  const env = setup({ verification: { geoMode: 'fencing', face: true } });
  env.simulation.update({ camera: 'simulated' }); // no device camera here: the demo's simulated one, permission granted
  const ctx = await signIn(env.app, 'TR-10432');
  signed.ctx = ctx;
  const grant = vi.spyOn(env.app.services.verification, 'grant');
  const onPassed = vi.fn();
  const wrapper = ({ children }: { readonly children: ReactNode }) => (
    <ServicesProvider container={env.app}>{voice ? <WithVoice api={voice}>{children}</WithVoice> : children}</ServicesProvider>
  );
  const view = renderHook(() => useVerification({ kind: 'self' }, onPassed), { wrapper });
  return { ...view, grant, onPassed };
}

const phaseOf = (r: { current: ReturnType<typeof useVerification> }) => r.current.phase.kind;

describe('the verification run waits for Voice Agent (D-148)', () => {
  it('"Location verified" holds 1.5 s and until the agent is quiet; the camera opens only after its line', async () => {
    const { api, waits } = fakeVoice();
    const { result } = await mount(api);
    await waitFor(() => expect(waits).toHaveLength(1));
    expect(phaseOf(result)).toBe('located');
    expect(waits[0].capMs).toBe(3000);
    expect(holds).toEqual([1500]); // HOLD_MS_VOICE while voice is live
    act(() => waits[0].resolve());
    await waitFor(() => expect(waits).toHaveLength(2));
    expect(waits[1].capMs).toBe(4000); // before the camera
    expect(phaseOf(result)).toBe('located');
    act(() => waits[1].resolve());
    await waitFor(() => expect(phaseOf(result)).toBe('facing'));
  });

  it('the pass is granted once, only after "Identity verified" and the agent\'s wait (INV-16)', async () => {
    const { api, waits } = fakeVoice();
    const { result, grant, onPassed } = await mount(api);
    await waitFor(() => expect(waits).toHaveLength(1));
    act(() => waits[0].resolve());
    await waitFor(() => expect(waits).toHaveLength(2));
    act(() => waits[1].resolve());
    await waitFor(() => expect(phaseOf(result)).toBe('facing'));
    await act(async () => void result.current.faceCaptured(FRAME));
    await waitFor(() => expect(waits).toHaveLength(3));
    expect(phaseOf(result)).toBe('faced');
    expect(waits[2].capMs).toBe(3000);
    expect(holds).toEqual([1500, 1500]);
    expect(grant).not.toHaveBeenCalled();
    act(() => waits[2].resolve());
    await waitFor(() => expect(phaseOf(result)).toBe('passed'));
    expect(grant).toHaveBeenCalledTimes(1);
    expect(onPassed).toHaveBeenCalledTimes(1);
  });

  it('"Identity verified" waits for the hold and the agent at once, as "Location verified" does (never one after the other)', async () => {
    const { api, waits } = fakeVoice();
    const { result, grant } = await mount(api);
    await waitFor(() => expect(waits).toHaveLength(1));
    act(() => waits[0].resolve());
    await waitFor(() => expect(waits).toHaveLength(2));
    act(() => waits[1].resolve());
    await waitFor(() => expect(phaseOf(result)).toBe('facing'));
    holdGate.manual = true;
    await act(async () => void result.current.faceCaptured(FRAME));
    await waitFor(() => expect(holdGate.pending).toHaveLength(1));
    // The hold is still running, and the agent's wait has already begun beside it.
    await waitFor(() => expect(waits).toHaveLength(3));
    expect(waits[2].capMs).toBe(3000);
    act(() => waits[2].resolve());
    await act(async () => undefined);
    expect(grant).not.toHaveBeenCalled(); // the hold has not ended yet
    act(() => holdGate.pending[0]());
    await waitFor(() => expect(phaseOf(result)).toBe('passed'));
    expect(grant).toHaveBeenCalledTimes(1);
  });

  it('a reused self check (D-152) keeps the voice pace too: the 1.5 s hold and the agent\'s wait, then the roster', async () => {
    const { api, waits } = fakeVoice();
    const env = setup({ verification: { geoMode: 'fencing', face: true } });
    env.simulation.update({ camera: 'simulated' });
    signed.ctx = await signIn(env.app, 'TR-10432');
    vi.spyOn(env.app.services.verification, 'reuseSelfPass').mockResolvedValue(true);
    const onPassed = vi.fn();
    const wrapper = ({ children }: { readonly children: ReactNode }) => (
      <ServicesProvider container={env.app}>
        <WithVoice api={api}>{children}</WithVoice>
      </ServicesProvider>
    );
    const { result } = renderHook(() => useVerification({ kind: 'session', key: 'ele-s1u2.2026-09-25.daily' }, onPassed), { wrapper });
    await waitFor(() => expect(waits).toHaveLength(1));
    expect(phaseOf(result)).toBe('reused');
    expect(waits[0].capMs).toBe(3000);
    expect(holds).toEqual([1500]);
    expect(onPassed).not.toHaveBeenCalled();
    act(() => waits[0].resolve());
    await waitFor(() => expect(phaseOf(result)).toBe('passed'));
    expect(onPassed).toHaveBeenCalledTimes(1);
  });

  it('closing the screen aborts the wait in progress: nothing more runs and nothing is granted', async () => {
    const { api, waits } = fakeVoice();
    const { result, unmount, grant } = await mount(api);
    await waitFor(() => expect(waits).toHaveLength(1));
    act(() => waits[0].resolve());
    await waitFor(() => expect(waits).toHaveLength(2));
    const pending = waits[1];
    expect(pending.signal?.aborted).toBe(false);
    unmount();
    expect(pending.signal?.aborted).toBe(true);
    pending.resolve();
    await act(async () => undefined);
    expect(phaseOf(result)).toBe('located');
    expect(waits).toHaveLength(2);
    expect(grant).not.toHaveBeenCalled();
  });

  it('without Voice Agent nothing waits: the prototype hold of 0.9 s, then the camera', async () => {
    const { result } = await mount(null);
    await waitFor(() => expect(phaseOf(result)).toBe('facing'));
    expect(holds).toEqual([900]);
  });
});

describe('the live camera stream (D-148)', () => {
  it('is on only while the face step runs: at "Identity verified" the screen shows the still success visual', async () => {
    const { api, waits } = fakeVoice();
    const env = setup({ verification: { geoMode: 'fencing', face: true } });
    env.simulation.update({ camera: 'simulated' });
    signed.ctx = await signIn(env.app, 'TR-10432');
    render(
      <ServicesProvider container={env.app}>
        <I18nProvider>
          <ToastProvider>
            <WithVoice api={api}>
              <VerificationFlow purpose={{ kind: 'self' }} area="home" subtitle="My attendance" passedSubtitle="One more step" onPassed={() => undefined} onExit={() => undefined} />
            </WithVoice>
          </ToastProvider>
        </I18nProvider>
      </ServicesProvider>,
    );
    await waitFor(() => expect(waits).toHaveLength(1));
    act(() => waits[0].resolve());
    await waitFor(() => expect(waits).toHaveLength(2));
    expect(screen.queryByRole('button', { name: 'live camera' })).toBeNull();
    act(() => waits[1].resolve());
    fireEvent.click(await screen.findByRole('button', { name: 'live camera' }));
    await waitFor(() => expect(waits).toHaveLength(3)); // "Identity verified", waiting for the agent
    expect(screen.getByText('Identity verified')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'live camera' })).toBeNull();
  });
});

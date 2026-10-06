// @vitest-environment jsdom
/**
 * The verification screen reads only what paces it (D-148): whether voice is live and settle(). The voice state changes
 * several times a second (mic level, captions) while the camera runs MediaPipe; the screen must not re-render for it.
 */
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVerification } from '@/features/verification/useVerification';
import { VoiceProvider } from '@/features/voice/VoiceProvider';
import { I18nProvider } from '@/hooks/i18n';
import { ServicesProvider } from '@/hooks/services';
import { useVoice, useVoicePace, type VoiceApi, type VoicePace } from '@/hooks/voice';
import { setup, signIn } from '../../helpers/app';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => '/home',
  useSearchParams: () => new URLSearchParams(''),
}));
const signed = vi.hoisted(() => ({ ctx: null as unknown }));
vi.mock('@/hooks/session', () => ({ useSession: () => signed.ctx }));

afterEach(cleanup);

describe('useVerification re-renders only when what paces it changes', () => {
  it('captions and level changes during a check do not re-render the verification screen; voice going live does', async () => {
    const env = setup({ voice: { enabled: true }, verification: { geoMode: 'fencing', face: true } });
    env.simulation.update({ voice: 'scripted', camera: 'simulated' });
    signed.ctx = await signIn(env.app, 'TR-10432');
    let api!: VoiceApi;
    let pace!: VoicePace;
    let renders = 0;
    let phase = '';
    function Starter() {
      api = useVoice();
      return null;
    }
    function Check() {
      renders++;
      phase = useVerification({ kind: 'self' }, () => undefined).phase.kind;
      pace = useVoicePace();
      return null;
    }
    render(
      <ServicesProvider container={env.app}>
        <I18nProvider>
          <VoiceProvider>
            <Starter />
            <Check />
          </VoiceProvider>
        </I18nProvider>
      </ServicesProvider>,
    );
    await waitFor(() => expect(phase).toBe('facing')); // the run waits at the face step (no photo comes here)
    expect(pace.live).toBe(false);
    const idle = renders;
    act(() => api.start());
    await waitFor(() => expect(api.state?.status).toBe('listening'));
    await waitFor(() => expect(pace.live).toBe(true));
    const live = renders;
    expect(live - idle).toBeLessThanOrEqual(2); // voice going live (the longer hold) is a reason to render
    const settle = pace.settle;
    const { scripted } = env.app.services.voice;
    for (let i = 0; i < 10; i++) act(() => scripted.emit({ outputText: `word${i} ` }));
    act(() => scripted.emit({ turnComplete: true }));
    act(() => scripted.speak('Aditi absent'));
    await waitFor(() => expect(api.state?.captions.length).toBe(2));
    expect(renders).toBe(live); // fourteen state changes, no render
    expect(pace.settle).toBe(settle); // a stable function
    act(() => api.stop());
  });
});

import { describe, expect, it, vi } from 'vitest';
import { VoiceService } from '@/services/voice/service';
import type { LiveConnection, LiveTransport } from '@/services/voice/live/transport';
import { setup, signIn } from '../../helpers/app';

// D-138: the Live transport module is fetched ahead of the Voice Agent tap, through the same memoized loader the
// session uses, so the tap does not wait for the SDK download. The loader is injected: nothing reaches the network.
vi.mock('@/services/voice/live/token-client', () => ({
  fetchLiveToken: async () => ({ ok: true, value: { token: 'tok', apiVersion: 'v1alpha', model: 'gemini-3.8-live', expiresAt: '2026-09-25T05:00:00.000Z' } }),
}));
vi.mock('@/services/voice/audio/browser-audio', () => ({
  createBrowserAudio: () => ({ startMic: async () => ({ ok: true }), setMicEnabled: () => {}, play: () => {}, flush: () => {}, isPlaying: () => false, level: () => 0, close: () => {} }),
}));

function fakeTransport() {
  const conn: LiveConnection = { sendAudio: () => {}, sendText: () => {}, sendAudioStreamEnd: () => {}, sendToolResponses: () => {}, close: () => {} };
  const transport: LiveTransport = { needsToken: true, connect: vi.fn(async () => conn) };
  return transport;
}

function service(liveTransport: () => Promise<LiveTransport>, voice: 'live' | 'scripted' = 'live') {
  const env = setup({ voice: { enabled: true } });
  env.simulation.update({ voice });
  const { services, repositories } = env.app;
  const voiceService = new VoiceService({
    attendance: services.attendance,
    verification: services.verification,
    drafts: services.drafts,
    announcements: services.announcements,
    staffAttendance: services.staffAttendance,
    reports: services.reports,
    bus: services.voiceBus,
    usageRepo: repositories.voiceUsage,
    connectivity: services.connectivity,
    simulation: env.simulation,
    clock: env.clock,
    liveTransport,
  });
  return { env, voice: voiceService };
}

describe('VoiceService.prefetch (D-138)', () => {
  it('live mode: loads the transport once across two calls, and the session reuses that load', async () => {
    const transport = fakeTransport();
    const loader = vi.fn(async () => transport);
    const { env, voice } = service(loader);
    voice.prefetch();
    voice.prefetch();
    expect(loader).toHaveBeenCalledTimes(1);
    const session = voice.start(await signIn(env.app, 'TR-10432'), 'en')!;
    await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
    expect(loader).toHaveBeenCalledTimes(1);
    expect(transport.connect).toHaveBeenCalledTimes(1);
    session.stop();
  });

  it('drops a failed load, so the next call retries, and never throws', async () => {
    const transport = fakeTransport();
    const loader = vi.fn<() => Promise<LiveTransport>>().mockRejectedValueOnce(new Error('chunk load failed')).mockResolvedValue(transport);
    const { voice } = service(loader);
    expect(() => voice.prefetch()).not.toThrow();
    expect(loader).toHaveBeenCalledTimes(1);
    // the service's own rejection handler was attached first, so it has dropped the load once this await resumes
    await expect(loader.mock.results[0].value).rejects.toThrow('chunk load failed');
    voice.prefetch();
    expect(loader).toHaveBeenCalledTimes(2);
  });

  it('canWarm: only live voice while online (the idle button preconnects and prefetches only then)', () => {
    const { env, voice } = service(vi.fn(async () => fakeTransport()));
    expect(voice.canWarm()).toBe(true);
    env.simulation.update({ online: false });
    expect(voice.canWarm()).toBe(false);
    const scripted = service(vi.fn(async () => fakeTransport()), 'scripted');
    expect(scripted.voice.canWarm()).toBe(false);
  });

  it('a loader that throws synchronously does not throw out of prefetch', () => {
    const { voice } = service(() => {
      throw new Error('no import()');
    });
    expect(() => voice.prefetch()).not.toThrow();
  });

  it('scripted mode never loads the live transport, neither on prefetch nor on start', async () => {
    const loader = vi.fn(async () => fakeTransport());
    const { env, voice } = service(loader, 'scripted');
    voice.prefetch();
    const session = voice.start(await signIn(env.app, 'TR-10432'), 'en')!;
    await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
    expect(loader).not.toHaveBeenCalled();
    session.stop();
  });

  it('offline: prefetch does nothing', () => {
    const loader = vi.fn(async () => fakeTransport());
    const { env, voice } = service(loader);
    env.simulation.update({ online: false });
    voice.prefetch();
    expect(loader).not.toHaveBeenCalled();
  });
});

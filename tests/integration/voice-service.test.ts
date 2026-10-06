import { describe, expect, it, vi } from 'vitest';
import type { ExecutorDeps } from '@/services/voice/executor';
import { liveConfig, type LiveCallbacks, type LiveConnection, type LiveSetup, type LiveToken } from '@/services/voice/live/transport';
import { setup, signIn } from '../helpers/app';

// The service's seams are observed, not replaced: the executor deps are captured (the real executor still runs),
// and the live pieces that would reach the network or the microphone are fakes that record their use.
const seen = vi.hoisted(() => ({
  executorDeps: [] as unknown[],
  liveConnects: [] as unknown[],
  tokenFetches: 0,
  browserAudio: 0,
}));

vi.mock('@/services/voice/executor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/voice/executor')>();
  return {
    ...actual,
    createExecutor: (deps: ExecutorDeps) => {
      seen.executorDeps.push(deps);
      return actual.createExecutor(deps);
    },
  };
});

vi.mock('@/services/voice/live/gemini', () => ({
  geminiTransport: {
    needsToken: true,
    connect: async (token: LiveToken | null, setupArg: LiveSetup, _cb: LiveCallbacks): Promise<LiveConnection> => {
      seen.liveConnects.push({ token, model: setupArg.model });
      return { sendAudio: () => {}, sendText: () => {}, sendAudioStreamEnd: () => {}, sendToolResponses: () => {}, close: () => {} };
    },
  },
}));

vi.mock('@/services/voice/live/token-client', () => ({
  fetchLiveToken: async () => {
    seen.tokenFetches += 1;
    return { ok: true, value: { token: 'tok', apiVersion: 'v1alpha', model: 'gemini-3.8-live', expiresAt: '2026-09-25T05:00:00.000Z' } };
  },
}));

vi.mock('@/services/voice/audio/browser-audio', () => ({
  createBrowserAudio: () => {
    seen.browserAudio += 1;
    return { startMic: async () => ({ ok: true }), setMicEnabled: () => {}, play: () => {}, flush: () => {}, isPlaying: () => false, level: () => 0, close: () => {} };
  },
}));

const lastDeps = () => seen.executorDeps[seen.executorDeps.length - 1] as ExecutorDeps;

describe('VoiceService', () => {
  it('has no plan with voice off; the principal has one without a marking flow (D-139)', async () => {
    const off = setup();
    expect(off.app.services.voice.plan(await signIn(off.app, 'TR-10432'), 'en')).toBeNull();
    const on = setup({ voice: { enabled: true } });
    expect(on.app.services.voice.plan(await signIn(on.app, 'PR-2741'), 'en')).toMatchObject({ scope: 'institute', marking: null });
  });

  it('start() returns null when plan() is null, builds nothing and leaves current() empty', async () => {
    const before = seen.executorDeps.length;
    const off = setup();
    const ctx = await signIn(off.app, 'TR-10432');
    expect(off.app.services.voice.start(ctx, 'en')).toBeNull();
    expect(seen.executorDeps.length).toBe(before);
    expect(off.app.services.voice.current()).toBeNull();
  });

  it('runs a scripted session end to end through the real executor', async () => {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    const ctx = await signIn(env.app, 'TR-10432');
    const session = env.app.services.voice.start(ctx, 'en')!;
    await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
    const scripted = env.app.services.voice.scripted;
    expect(scripted.texts[0]).toMatch(/^\[APP\] Session started/);
    expect(scripted.lastSetup!.tools.map((t) => t.name)).toContain('get_trades');
    expect(scripted.lastSetup!.systemInstruction).toContain('FACTS COME ONLY FROM TOOLS');
    expect(await scripted.toolCall('get_trades')).toMatchObject({ ok: true });
    session.stop();
    expect(session.getState().status).toBe('ended');
  });

  it('one voice per opening language, kept for the whole session; never a languageCode (D-155)', async () => {
    const env = setup({ voice: { enabled: true, voiceName: 'Kore', voiceNames: { en: 'Achernar', mr: 'Sulafat' } } });
    env.simulation.update({ voice: 'scripted' });
    const ctx = await signIn(env.app, 'TR-10432');
    const scripted = env.app.services.voice.scripted;
    const voiceOf = async (screen: 'en' | 'mr') => {
      const session = env.app.services.voice.start(ctx, screen)!;
      await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
      const setupNow = scripted.lastSetup!;
      session.stop();
      return setupNow;
    };
    expect((await voiceOf('mr')).voiceName).toBe('Sulafat');
    const en = await voiceOf('en');
    expect(en.voiceName).toBe('Achernar');
    expect(liveConfig(en)).toMatchObject({ speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Achernar' } } } });
    expect(liveConfig(en).speechConfig).not.toHaveProperty('languageCode');
  });

  it('runs a scripted principal session: today\'s state, the institute tools, the first name without a title', async () => {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    const session = env.app.services.voice.start(await signIn(env.app, 'PR-2741'), 'en')!;
    await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
    const scripted = env.app.services.voice.scripted;
    expect(scripted.texts[0]).toMatch(/^\[APP\] Session started\. Today: \d+ of \d+ batches submitted, \d+ staff not marked yet, the principal included\. Say exactly: "Good morning, Principal\." Then say today's state in one line, in Indian English \(for example "\d+ of \d+ batches are in; \d+ staff haven't marked yet, including you\."\), then ask "How can I help\?"\. Then wait\.$/);
    expect(scripted.lastSetup!.tools.map((t) => t.name)).toEqual([
      'get_status', 'get_reports_overview', 'get_batch_report', 'get_student_report', 'get_at_risk', 'get_staff_report', 'show_report', 'download_register',
      'get_staff_today', 'mark_staff', 'mark_remaining_staff', 'navigate', 'get_announcements', 'end_voice_session',
    ]);
    expect(scripted.lastSetup!.systemInstruction).toContain('You are speaking with Anil, the principal of');
    expect(await scripted.toolCall('navigate', { to: 'staff_attendance' })).toMatchObject({ ok: true, screen: 'staff_attendance' });
    session.stop();
  });

  it('chooses the transport from the simulation at the moment of start: scripted, then live, then scripted again', async () => {
    const env = setup({ voice: { enabled: true } });
    const ctx = await signIn(env.app, 'TR-10432');
    const { voice } = env.app.services;
    const liveBefore = seen.liveConnects.length;
    const audioBefore = seen.browserAudio;

    env.simulation.update({ voice: 'scripted' });
    const first = voice.start(ctx, 'en')!;
    await vi.waitFor(() => expect(first.getState().status).toBe('listening'));
    expect(voice.scripted.connected()).toBe(true);
    expect(seen.liveConnects.length).toBe(liveBefore); // no Gemini socket, no real audio devices
    expect(seen.browserAudio).toBe(audioBefore);

    env.simulation.update({ voice: 'live' });
    const second = voice.start(ctx, 'en')!;
    await vi.waitFor(() => expect(second.getState().status).toBe('listening'));
    expect(seen.liveConnects).toHaveLength(liveBefore + 1);
    expect(seen.liveConnects[liveBefore]).toMatchObject({ token: { token: 'tok' }, model: 'gemini-3.8-live' });
    expect(seen.browserAudio).toBe(audioBefore + 1);
    expect(voice.scripted.connected()).toBe(false); // the first session was stopped by the second start

    env.simulation.update({ voice: 'scripted' });
    const third = voice.start(ctx, 'en')!;
    await vi.waitFor(() => expect(third.getState().status).toBe('listening'));
    expect(voice.scripted.connected()).toBe(true);
    expect(seen.liveConnects).toHaveLength(liveBefore + 1);
    third.stop();
  });

  it("gives the executor the session's live speechSeq, turnSeq, spokeAtTurn and generation, not values read when it was built", async () => {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    const session = env.app.services.voice.start(await signIn(env.app, 'TR-10432'), 'en')!;
    const deps = lastDeps();
    expect(deps.speechSeq()).toBe(session.speechSeq());
    expect(deps.generation()).toBe(session.generation());
    const generationAtStart = deps.generation();

    await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
    expect(deps.generation()).toBe(session.generation());
    expect(deps.generation()).toBeGreaterThan(generationAtStart); // the connection bumped it after the executor was built

    const seq = deps.speechSeq();
    env.app.services.voice.scripted.speak('shift one');
    expect(deps.speechSeq()).toBe(seq + 1);
    expect(deps.speechSeq()).toBe(session.speechSeq());
    // the turn counters of the confirmation rule (final fix F4) are read live too
    const turns = deps.turnSeq();
    env.app.services.voice.scripted.emit({ turnComplete: true });
    env.app.services.voice.scripted.speak('haan');
    expect(deps.turnSeq()).toBe(turns + 1);
    expect(deps.spokeAtTurn()).toBe(turns + 1);
    expect([deps.turnSeq(), deps.spokeAtTurn(), deps.speechSeq()]).toEqual([session.turnSeq(), session.spokeAtTurn(), session.speechSeq()]);
    session.stop();
  });

  it('current() is the running session, and null before a start and after a stop', async () => {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    const { voice } = env.app.services;
    expect(voice.current()).toBeNull();
    const session = voice.start(await signIn(env.app, 'TR-10432'), 'en')!;
    expect(voice.current()).toBe(session);
    await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
    expect(voice.current()).toBe(session);
    session.stop();
    expect(voice.current()).toBeNull();
  });

  it('a second start() stops the previous session and current() becomes the new one', async () => {
    const env = setup({ voice: { enabled: true } });
    env.simulation.update({ voice: 'scripted' });
    const ctx = await signIn(env.app, 'TR-10432');
    const { voice } = env.app.services;
    const first = voice.start(ctx, 'en')!;
    await vi.waitFor(() => expect(first.getState().status).toBe('listening'));
    const second = voice.start(ctx, 'en')!;
    expect(second).not.toBe(first);
    expect(first.getState().status).toBe('ended');
    expect(voice.current()).toBe(second);
    await vi.waitFor(() => expect(second.getState().status).toBe('listening'));
    second.stop();
  });
});

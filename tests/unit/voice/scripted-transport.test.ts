import { describe, expect, it, vi, type Mock } from 'vitest';
import { liveConfig, type LiveCallbacks, type LiveEvent, type LiveSetup } from '@/services/voice/live/transport';
import { ScriptedLiveTransport, SilentAudio } from '@/services/simulated/voice';
import type { FlowPlan } from '@/domain/voice/plan';
import { buildTools, type ToolDeclaration } from '@/services/voice/tools';
import { voicePlan } from '../../helpers/voice-view';

const TOOL: ToolDeclaration = { name: 'get_status', description: 'Where are we', behavior: 'BLOCKING' };
const SETUP: LiveSetup = { model: 'gemini-3.8-live', systemInstruction: 'You are a helper.', tools: [TOOL], voiceName: 'Kore' };

const PLAN: FlowPlan = {
  selection: 'trade_picker', tradeStep: true, slotWords: 'once',
  verification: { location: 'fence', face: true, required: true },
  defaultStatus: 'present', startStyle: 'exceptions', rollCallSwitch: true,
  statuses: ['present', 'absent'], ojtVisible: false,
  details: { half: false, leaveType: false, leaveDays: false },
  languages: ['en', 'mr'], openingLanguage: 'en', timeFencing: true,
};

function callbacks(): LiveCallbacks & { onEvent: Mock<(e: LiveEvent) => void>; onClose: Mock<(code: number, reason: string) => void> } {
  return { onEvent: vi.fn<(e: LiveEvent) => void>(), onClose: vi.fn<(code: number, reason: string) => void>() };
}

describe('ScriptedLiveTransport', () => {
  it('connects, records the setup and needs no token', async () => {
    const t = new ScriptedLiveTransport();
    expect(t.needsToken).toBe(false);
    expect(t.connected()).toBe(false);
    await t.connect(null, SETUP, callbacks());
    expect(t.connected()).toBe(true);
    expect(t.lastSetup).toBe(SETUP);
  });

  it('answers toolCall with the unwrapped result sent through sendToolResponses', async () => {
    const t = new ScriptedLiveTransport();
    const cb = callbacks();
    const conn = await t.connect(null, SETUP, cb);
    const answer = t.toolCall('get_status', { a: 1 });
    expect(cb.onEvent).toHaveBeenCalledWith(expect.objectContaining({ toolCalls: [{ id: 'scripted-1', name: 'get_status', args: { a: 1 } }] }));
    const result = { ok: true, instruction: 'go on' };
    conn.sendToolResponses([{ id: 'scripted-1', name: 'get_status', result }]);
    await expect(answer).resolves.toBe(result);
    expect(t.toolResponses).toEqual([{ id: 'scripted-1', name: 'get_status', result }]);
  });

  it('rejects toolCall with "not connected" before a connection, after a drop and after close, and emits nothing', async () => {
    const t = new ScriptedLiveTransport();
    await expect(t.toolCall('get_status')).rejects.toThrow(new Error('not connected'));
    const cb = callbacks();
    const conn = await t.connect(null, SETUP, cb);
    t.drop();
    await expect(t.toolCall('get_status')).rejects.toThrow('not connected');
    const again = await t.connect(null, SETUP, cb);
    again.close();
    await expect(t.toolCall('get_status')).rejects.toThrow('not connected');
    expect(conn).not.toBe(again);
    expect(cb.onEvent).not.toHaveBeenCalled(); // a refused call emits no event
  });

  it('keeps simultaneous tool calls apart by id', async () => {
    const t = new ScriptedLiveTransport();
    const conn = await t.connect(null, SETUP, callbacks());
    const first = t.toolCall('get_status', {}, 'a');
    const second = t.toolCall('get_trades', {}, 'b');
    conn.sendToolResponses([{ id: 'b', name: 'get_trades', result: { ok: true, instruction: 'two' } }, { id: 'a', name: 'get_status', result: { ok: true, instruction: 'one' } }]);
    expect((await first).instruction).toBe('one');
    expect((await second).instruction).toBe('two');
  });

  it('records texts and stream ends, and speak() finishes an utterance', async () => {
    const t = new ScriptedLiveTransport();
    const cb = callbacks();
    const conn = await t.connect(null, SETUP, cb);
    conn.sendText('[APP] hello');
    conn.sendText('typed');
    conn.sendAudioStreamEnd();
    expect(t.texts).toEqual(['[APP] hello', 'typed']);
    expect(t.streamEnds).toBe(1);
    t.speak('haan');
    expect(cb.onEvent).toHaveBeenLastCalledWith({ audio: [], inputText: 'haan', inputFinished: true });
  });

  it('drop() reports an abnormal close, goAway() a time left, and close() ends quietly', async () => {
    const t = new ScriptedLiveTransport();
    const cb = callbacks();
    const conn = await t.connect(null, SETUP, cb);
    t.goAway(8000);
    expect(cb.onEvent).toHaveBeenLastCalledWith(expect.objectContaining({ goAwayMs: 8000 }));
    t.drop();
    expect(cb.onClose).toHaveBeenCalledWith(1006, expect.any(String));
    expect(t.connected()).toBe(false);

    const t2 = new ScriptedLiveTransport();
    const cb2 = callbacks();
    const conn2 = await t2.connect(null, SETUP, cb2);
    conn2.close();
    expect(t2.connected()).toBe(false);
    expect(cb2.onClose).not.toHaveBeenCalled();
    void conn;
  });

  it('SilentAudio fails the next startMic once with the queued denial, then succeeds; play counts chunks', async () => {
    const t = new ScriptedLiveTransport();
    const audio = new SilentAudio(t);
    t.denyNextMic('permission_denied');
    expect(await audio.startMic(vi.fn(), vi.fn())).toEqual({ ok: false, error: 'permission_denied' });
    expect(await audio.startMic(vi.fn(), vi.fn())).toEqual({ ok: true });
    expect(t.takeMicDenial()).toBeNull();
    audio.play(new Int16Array(4));
    audio.play(new Int16Array(4));
    expect(audio.playedChunks).toBe(2);
    expect(audio.level()).toBe(0);
    audio.flush();
    audio.setMicEnabled(false);
    audio.close();
  });
});

describe('liveConfig', () => {
  it('builds the audio-only setup with transcriptions, VAD, compression and resumption', () => {
    const c = liveConfig(SETUP);
    expect(c).toMatchObject({
      responseModalities: ['AUDIO'],
      inputAudioTranscription: {},
      outputAudioTranscription: {},
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
      realtimeInputConfig: {
        automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 100, silenceDurationMs: 500 },
      },
      contextWindowCompression: { triggerTokens: '25000', slidingWindow: { targetTokens: '8000' } },
      systemInstruction: { parts: [{ text: 'You are a helper.' }] },
    });
  });
  it('resumes only with a handle and never asks for transparent resumption', () => {
    expect(liveConfig(SETUP).sessionResumption).toEqual({});
    expect(liveConfig({ ...SETUP, resumeHandle: 'h-1' }).sessionResumption).toEqual({ handle: 'h-1' });
    expect(JSON.stringify(liveConfig({ ...SETUP, resumeHandle: 'h-1' }))).not.toContain('transparent');
  });
  it('declares every function in liveConfig(setup) as BLOCKING, in one tool group (the real tool set)', () => {
    const setup: LiveSetup = { ...SETUP, tools: buildTools(voicePlan(PLAN)) };
    const tools = liveConfig(setup).tools as Array<{ functionDeclarations: ToolDeclaration[] }>;
    expect(tools).toHaveLength(1);
    const declared = tools[0]!.functionDeclarations;
    expect(declared.length).toBeGreaterThan(5);
    expect(declared.map((d) => d.name)).toEqual(setup.tools.map((t) => t.name));
    for (const d of declared) expect(d, d.name).toMatchObject({ behavior: 'BLOCKING' });
  });
  it('leaves out the fields the model or SDK rejects', () => {
    const c = liveConfig(SETUP);
    for (const key of ['thinkingConfig', 'proactivity', 'enableAffectiveDialog', 'generationConfig', 'httpOptions', 'languageCode']) {
      expect(c).not.toHaveProperty(key);
    }
    expect(c.speechConfig).not.toHaveProperty('languageCode');
  });
});

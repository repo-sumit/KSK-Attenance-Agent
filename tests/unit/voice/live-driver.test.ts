import { describe, expect, it, vi } from 'vitest';
import type { VoiceExecutor } from '@/services/voice/executor';

// A stub of the SDK: connect() resolves at once with a session whose text sends the test answers by hand.
const sdk = vi.hoisted(() => {
  const state = {
    emit: (_msg: unknown): void => undefined,
    onText: (_text: string): void => undefined,
  };
  class GoogleGenAI {
    live = {
      connect: async (args: { callbacks: { onmessage: (msg: unknown) => void } }) => {
        state.emit = (msg) => args.callbacks.onmessage(msg);
        return { sendRealtimeInput: ({ text }: { text: string }) => state.onText(text), sendToolResponse: () => undefined, close: () => undefined };
      },
    };
  }
  return { state, GoogleGenAI };
});
vi.mock('@google/genai', () => ({ GoogleGenAI: sdk.GoogleGenAI, Modality: { AUDIO: 'AUDIO' } }));

import { LiveDriver } from '../../voice-live/driver';

const executor = {} as VoiceExecutor; // no tool call in these turns
const SETUP = { model: 'm', systemInstruction: 's', tools: [], voiceName: 'Kore' };
/** Short waits instead of the live defaults (they add seconds per turn): grace 40 ms, quiet after 150 ms, cap 300 ms. */
const FAST = { graceMs: 40, transcriptWaitMs: 100, lateStartMs: 300, quietMs: 150, noTurnCapMs: 300 };
const said = (text: string) => sdk.state.emit({ serverContent: { outputTranscription: { text } } });
const complete = () => sdk.state.emit({ serverContent: { turnComplete: true } });
const reply = (text: string) => {
  said(text);
  complete();
};
const open = () => LiveDriver.open('test-key', SETUP, executor, FAST);

describe('the live driver (tests/voice-live)', () => {
  it('a reply that comes after the no-reply window is kept with its own turn, never counted in the next one (Task 19)', async () => {
    const driver = await open();
    sdk.state.onText = () => undefined; // the refresh gets no reply within its window
    const quiet = await driver.say('[APP] refresh', false, 100);
    expect(quiet.said).toBe('');
    expect(quiet.drained).toBeNull();
    setTimeout(() => reply('Late reply.'), 50); // ...then the model answers it after all
    sdk.state.onText = (text) => void setTimeout(() => reply(text === 'next' ? 'Next reply.' : '?'), 30);
    const next = await driver.say('next');
    expect(next.said).toBe('Next reply.');
    // the next turn hands back the drained reply, so a log written when the refresh returned can still show it
    expect(next.drained).toBe('Late reply.');
    expect(driver.turns.map((t) => t.said)).toEqual(['Late reply.', 'Next reply.']);
    driver.close();
  });

  it('a reply to a no-reply text that never sends turnComplete is over once its output is quiet, and its late end is not the next turn\'s (fix round 1)', async () => {
    const driver = await open();
    sdk.state.onText = () => void setTimeout(() => said('Okay, take your time.'), 20); // output, but no turnComplete
    const started = performance.now();
    const paused = await driver.say('[APP] paused', false, 100);
    expect(paused.said).toBe('Okay, take your time.');
    expect(performance.now() - started).toBeLessThan(2000); // not the 70 s turn timeout
    // the old turn's turnComplete arrives after the next send, before its reply: it does not end the next turn
    sdk.state.onText = () => {
      setTimeout(complete, 10);
      setTimeout(() => reply('Next reply.'), 120);
    };
    const next = await driver.say('next');
    expect(next.said).toBe('Next reply.');
    expect(next.drained).toBeNull();
    driver.close();
  });

  it('a reply to a no-reply text that keeps talking without turnComplete is over at most noTurnCapMs after the window (fix round 1)', async () => {
    const driver = await open();
    let timer: ReturnType<typeof setInterval> | undefined;
    sdk.state.onText = () => void (timer = setInterval(() => said('and '), 50)); // never quiet for 150 ms
    const started = performance.now();
    const turn = await driver.say('[APP] paused', false, 100);
    clearInterval(timer);
    expect(turn.said).toMatch(/^and/);
    expect(performance.now() - started).toBeGreaterThanOrEqual(400); // window 100 + cap 300
    expect(performance.now() - started).toBeLessThan(2500);
    driver.close();
  });

  it('a text without a no-reply window still waits for turnComplete: output that stops is not the end', async () => {
    const driver = await open();
    sdk.state.onText = () => {
      setTimeout(() => said('Rahul absent.'), 20);
      setTimeout(complete, 300); // well after quietMs
    };
    const turn = await driver.say('Rahul absent');
    expect(turn.said).toBe('Rahul absent.');
    expect(turn.totalMs).toBeGreaterThanOrEqual(300);
    driver.close();
  });
});

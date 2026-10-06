/**
 * The polite outbox on its own (D-148): a held 'send' text never waits past its own cap behind a 'drop' text with a
 * longer cap (texts that are sent keep their order), and a reply owed that never comes stops holding texts.
 */
import { describe, expect, it } from 'vitest';
import { QuietOutbox, REPLY_STALE_MS, type QuietHost } from '@/services/voice/session-outbox';
import type { Timers } from '@/services/voice/session-types';

/** A host on a hand-moved clock: streaming, the agent's audio playing while `playing` is true. */
function host() {
  let now = 0;
  const sent: string[] = [];
  const logs: string[] = [];
  const state = { playing: false, busy: false };
  const timers = { now: () => now, setTimeout: () => 0, clearTimeout: () => undefined, setInterval: () => 0, clearInterval: () => undefined } as unknown as Timers;
  const h: QuietHost = {
    streaming: () => true,
    playing: () => state.playing,
    busy: () => state.busy,
    stamp: () => 1,
    send: (text) => void sent.push(text),
    log: (line) => void logs.push(line),
    timers,
  };
  return { h, sent, logs, state, at: (ms: number) => void (now = ms) };
}

describe('QuietOutbox.release: each text keeps its own cap', () => {
  it('a 3 s send text behind a 4 s drop text goes out at its own cap, and the drop text it overtook is dropped (order kept among sent texts)', () => {
    const { h, sent, logs, state, at } = host();
    const box = new QuietOutbox(h);
    state.playing = true; // the agent is mid-line
    box.sendWhenQuiet('[APP] Camera on.', 4000, 'drop');
    at(500);
    box.sendWhenQuiet('[APP] Granted.', 3000, 'send'); // until 3500
    at(3400);
    box.release();
    expect(sent).toEqual([]);
    at(3500);
    box.release();
    expect(sent).toEqual(['[APP] Granted.']); // not at 4000, the head's cap
    at(6000);
    state.playing = false;
    box.release();
    box.release();
    expect(sent).toEqual(['[APP] Granted.']); // the camera text was overtaken: it never follows the pass
    expect(logs.filter((l) => l.startsWith('check text'))).toEqual(['check text held', 'check text held', 'check text dropped (cap)', 'check text sent (cap)']);
  });

  it('a send text whose cap ran out takes the earlier send texts with it, oldest first', () => {
    const { h, sent, state, at } = host();
    const box = new QuietOutbox(h);
    state.playing = true;
    box.sendWhenQuiet('first', 5000, 'send'); // until 5000
    at(100);
    box.sendWhenQuiet('second', 3000, 'send'); // until 3100
    at(3100);
    box.release();
    expect(sent).toEqual(['first', 'second']);
  });

  it('a drop text whose cap ran out leaves; a later text keeps waiting for its own cap or the quiet', () => {
    const { h, sent, state, at } = host();
    const box = new QuietOutbox(h);
    state.playing = true;
    box.sendWhenQuiet('camera', 1000, 'drop');
    box.sendWhenQuiet('pass', 3000, 'send');
    at(1000);
    box.release();
    expect(sent).toEqual([]);
    state.playing = false;
    at(1500);
    box.release(); // the poll that sees the player idle
    at(1800);
    box.release();
    expect(sent).toEqual(['pass']);
  });
});

describe('QuietOutbox: a reply owed goes stale', () => {
  it(`stops holding texts ${REPLY_STALE_MS} ms after it was owed when no audio, turnComplete or interruption came`, () => {
    const { h, sent, at } = host();
    const box = new QuietOutbox(h);
    box.expectReply();
    box.sendWhenQuiet('[APP] Camera on.', 4000, 'drop');
    at(REPLY_STALE_MS - 1);
    box.release();
    expect(sent).toEqual([]);
    at(REPLY_STALE_MS);
    box.release();
    expect(sent).toEqual(['[APP] Camera on.']);
  });

  it('the agent\'s audio still settles it at once, and a new reply owed starts its own window', () => {
    const { h, sent, at } = host();
    const box = new QuietOutbox(h);
    box.expectReply();
    at(600);
    box.expectReply(); // a second tool response: owed again from now
    box.sendWhenQuiet('text', 4000, 'drop');
    at(600 + REPLY_STALE_MS - 1);
    box.release();
    expect(sent).toEqual([]);
    box.observe({ audio: [new Int16Array(2)] });
    expect(box.isQuiet()).toBe(true); // no busy turn, nothing playing: the audio settled the reply
  });
});

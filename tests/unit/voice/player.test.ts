import { describe, expect, it, vi } from 'vitest';
import { PcmPlayer } from '@/services/voice/audio/player';

interface FakeSource {
  buffer: { duration: number } | null;
  connect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
}

function fakeContext() {
  const sources: FakeSource[] = [];
  const ctx = {
    currentTime: 10,
    destination: {},
    close: vi.fn(async () => undefined),
    createBuffer: vi.fn((_channels: number, length: number, rate: number) => ({
      duration: length / rate,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => {
      const source: FakeSource = { buffer: null, connect: vi.fn(), start: vi.fn(), stop: vi.fn(), onended: null };
      sources.push(source);
      return source;
    }),
  };
  return { ctx, sources };
}

const chunk = (samples: number) => new Int16Array(samples).fill(100);

describe('PcmPlayer', () => {
  it('starts the first chunk 50 ms ahead and chains the next one gaplessly', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.play(chunk(2400)); // 100 ms
    player.play(chunk(4800)); // 200 ms
    expect(sources[0].start).toHaveBeenCalledWith(10.05);
    const firstEnd = 10.05 + 2400 / 24000;
    expect(sources[1].start).toHaveBeenCalledWith(firstEnd);
    expect(player.isPlaying()).toBe(true);
  });

  it('leads by 50 ms again once the queue has run dry', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.play(chunk(2400));
    ctx.currentTime = 11; // well past the end at 10.15
    player.play(chunk(2400));
    expect(sources[1].start).toHaveBeenCalledWith(11.05);
  });

  it('flush stops every scheduled source and resets the queue', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.play(chunk(2400));
    player.play(chunk(2400));
    sources[1].stop.mockImplementation(() => {
      throw new Error('already stopped');
    });
    player.flush();
    expect(sources[0].stop).toHaveBeenCalledTimes(1);
    expect(sources[1].stop).toHaveBeenCalledTimes(1);
    expect(player.isPlaying()).toBe(false);
    player.play(chunk(2400));
    expect(sources[2].start).toHaveBeenCalledWith(10.05);
  });

  it('ignores empty chunks', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.play(new Int16Array(0));
    expect(ctx.createBuffer).not.toHaveBeenCalled();
    expect(sources).toHaveLength(0);
    expect(player.isPlaying()).toBe(false);
  });

  it('stops reporting playing when the last source ends', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.play(chunk(2400));
    sources[0].onended?.();
    expect(player.isPlaying()).toBe(false);
  });

  it('close flushes but leaves the context to its owner', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.play(chunk(2400));
    player.close();
    expect(sources[0].stop).toHaveBeenCalled();
    expect(ctx.close).not.toHaveBeenCalled();
  });
  it('speech that arrives while a cue sounds starts when the cue ends (holdUntil, D-156); the hold never delays later speech', () => {
    const { ctx, sources } = fakeContext();
    const player = new PcmPlayer(ctx as unknown as AudioContext);
    player.holdUntil(10.18);
    player.play(chunk(2400)); // 100 ms
    expect(sources[0].start).toHaveBeenCalledWith(10.18);
    player.play(chunk(2400));
    expect(sources[1].start).toHaveBeenCalledWith(10.18 + 0.1); // still gapless after it
    ctx.currentTime = 12; // the hold is long past
    player.play(chunk(2400));
    expect(sources[2].start).toHaveBeenCalledWith(12.05);
    // a hold earlier than the queue changes nothing
    player.holdUntil(11);
    player.play(chunk(2400));
    expect(sources[3].start).toHaveBeenCalledWith(12.05 + 0.1);
  });
});

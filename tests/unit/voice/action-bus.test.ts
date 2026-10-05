import { describe, expect, it, vi } from 'vitest';
import { ActionBus } from '@/services/voice/action-bus';

describe('ActionBus', () => {
  it('numbers events in order and replays from a seq', () => {
    const bus = new ActionBus();
    const seen = vi.fn();
    bus.subscribe(seen);
    bus.emit({ type: 'navigate', href: '/home', replace: false });
    bus.emit({ type: 'focus_student', sessionKey: 'k', studentId: 's1' });
    expect(seen.mock.calls.map((c) => c[0].seq)).toEqual([1, 2]);
    expect(bus.since(1).map((e) => e.type)).toEqual(['focus_student']);
    expect(bus.lastSeq).toBe(2);
  });
  it('keeps only the last 50', () => {
    const bus = new ActionBus();
    for (let i = 0; i < 60; i++) bus.emit({ type: 'end_voice' });
    expect(bus.since(0)).toHaveLength(50);
  });
  it('keeps delivering and returns the event when a listener throws', () => {
    const bus = new ActionBus();
    const good = vi.fn();
    bus.subscribe(() => {
      throw new Error('boom');
    });
    bus.subscribe(good);
    const stamped = bus.emit({ type: 'end_voice' });
    expect(stamped.seq).toBe(1);
    expect(good).toHaveBeenCalledWith(stamped);
    expect(bus.since(0)).toEqual([stamped]);
    expect(bus.emit({ type: 'end_voice' }).seq).toBe(2);
    expect(good).toHaveBeenCalledTimes(2);
  });
  it('delivers an event emitted from inside a listener after the current event has reached every listener (FIFO, no nesting)', () => {
    const bus = new ActionBus();
    const order: string[] = [];
    let reentered = false;
    bus.subscribe((e) => {
      order.push(`a:${e.type}#${e.seq}`);
      if (e.type === 'end_voice' && !reentered) {
        reentered = true;
        const inner = bus.emit({ type: 'verify_retry', purpose: 'session:k' });
        expect(inner.seq).toBe(2); // stamped and returned at once, delivered later
        expect(order).toEqual(['a:end_voice#1']);
      }
    });
    bus.subscribe((e) => order.push(`b:${e.type}#${e.seq}`));
    bus.emit({ type: 'end_voice' });
    expect(order).toEqual(['a:end_voice#1', 'b:end_voice#1', 'a:verify_retry#2', 'b:verify_retry#2']);
    expect(bus.since(0).map((e) => e.seq)).toEqual([1, 2]);
  });
  it('delivers several nested emits in the order they were made', () => {
    const bus = new ActionBus();
    const seen: number[] = [];
    bus.subscribe((e) => {
      seen.push(e.seq);
      if (e.seq === 1) {
        bus.emit({ type: 'end_voice' });
        bus.emit({ type: 'end_voice' });
      }
    });
    bus.emit({ type: 'end_voice' });
    expect(seen).toEqual([1, 2, 3]);
  });
  it('keeps working after a listener throws on a queued event', () => {
    const bus = new ActionBus();
    const seen: number[] = [];
    bus.subscribe((e) => {
      seen.push(e.seq);
      if (e.seq === 1) bus.emit({ type: 'end_voice' });
      if (e.seq === 2) throw new Error('boom');
    });
    bus.emit({ type: 'end_voice' });
    bus.emit({ type: 'end_voice' });
    expect(seen).toEqual([1, 2, 3]);
  });
  it('does not call a listener that was unsubscribed during the emit for the rest of that emit', () => {
    const bus = new ActionBus();
    const second = vi.fn();
    let unsubscribeSecond = () => {};
    bus.subscribe(() => unsubscribeSecond());
    unsubscribeSecond = bus.subscribe(second);
    bus.emit({ type: 'end_voice' });
    expect(second).not.toHaveBeenCalled();
    bus.emit({ type: 'end_voice' });
    expect(second).not.toHaveBeenCalled();
  });
  it('still delivers the current event to a listener subscribed during the emit only from the next event on', () => {
    const bus = new ActionBus();
    const late = vi.fn();
    bus.subscribe(() => {
      bus.subscribe(late);
    });
    bus.emit({ type: 'end_voice' });
    expect(late).not.toHaveBeenCalled();
    bus.emit({ type: 'end_voice' });
    expect(late).toHaveBeenCalledTimes(1);
  });
});

// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SETTLE_MS, scrollIntoViewSettled } from '@/lib/scroll';

type Callback = () => void;
const observers: { callback: Callback; targets: Element[]; disconnected: boolean }[] = [];

class FakeResizeObserver {
  private readonly entry: { callback: Callback; targets: Element[]; disconnected: boolean };
  constructor(callback: Callback) {
    this.entry = { callback, targets: [], disconnected: false };
    observers.push(this.entry);
  }
  observe(target: Element) {
    this.entry.targets.push(target);
  }
  disconnect() {
    this.entry.disconnected = true;
  }
}

/** main > stack > [institute, batches, staff]: the staff section is the one voice asks for. */
function page() {
  document.body.innerHTML = '<main><div id="stack"><section id="institute"></section><section id="batches"></section><section id="staff"></section></div></main>';
  const staff = document.getElementById('staff')!;
  const calls: ScrollIntoViewOptions[] = [];
  staff.scrollIntoView = (o?: boolean | ScrollIntoViewOptions) => void calls.push(o as ScrollIntoViewOptions);
  return { staff, calls };
}
let institute = 100;
/** The institute card finished loading and grew; every live observer hears about it. */
const grow = () => {
  institute += 120;
  const card = document.getElementById('institute');
  if (card) card.getBoundingClientRect = () => ({ height: institute }) as DOMRect;
  observers.filter((o) => !o.disconnected).forEach((o) => o.callback());
};
/** The first report a ResizeObserver makes when observation starts: nothing changed. */
const initialReport = () => observers.filter((o) => !o.disconnected).forEach((o) => o.callback());

beforeEach(() => {
  vi.useFakeTimers();
  observers.length = 0;
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('scrollIntoViewSettled: a section voice asks for stays in view while the page above it settles', () => {
  it('scrolls once, smoothly, and watches only what sits above the section', () => {
    const { staff, calls } = page();
    scrollIntoViewSettled(staff, false);
    expect(calls).toEqual([{ block: 'start', behavior: 'smooth' }]);
    const watched = observers[0]!.targets.map((t) => t.id);
    expect(watched).toEqual(['batches', 'institute']); // the earlier siblings, nearest first; never the section itself
  });

  it('keeps the smooth scroll on the observer\'s first report, and re-aligns (without animation) when a section above grows, until the page has settled', () => {
    const { staff, calls } = page();
    scrollIntoViewSettled(staff, false);
    initialReport();
    expect(calls).toHaveLength(1);
    grow(); // the institute card finished loading and grew
    expect(calls.at(-1)).toEqual({ block: 'start', behavior: 'auto' });
    vi.advanceTimersByTime(SETTLE_MS);
    const before = calls.length;
    grow();
    expect(calls.length).toBe(before); // settled: later changes are the trainer's page, not voice's
    expect(observers[0]!.disconnected).toBe(true);
  });

  it('lets the trainer take over: their own scroll, touch or key ends the hold', () => {
    for (const type of ['wheel', 'touchstart', 'keydown'] as const) {
      const { staff, calls } = page();
      scrollIntoViewSettled(staff, true);
      expect(calls).toEqual([{ block: 'start', behavior: 'auto' }]); // reduced motion: no smooth scroll
      window.dispatchEvent(new Event(type));
      grow();
      expect(calls).toHaveLength(1);
      observers.length = 0;
    }
  });

  it('can be cancelled (the screen unmounts), and works without ResizeObserver', () => {
    const { staff, calls } = page();
    const cancel = scrollIntoViewSettled(staff, false);
    cancel();
    grow();
    expect(calls).toHaveLength(1);
    vi.unstubAllGlobals();
    vi.stubGlobal('ResizeObserver', undefined);
    const second = page();
    expect(() => scrollIntoViewSettled(second.staff, false)()).not.toThrow();
    expect(second.calls).toHaveLength(1);
  });
});

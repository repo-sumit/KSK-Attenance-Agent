// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dockInset, registerDock, useDockInset, type Box } from '@/components/shell/DockInset';

const rect = (b: Box) => ({ ...b, width: b.right - b.left, height: b.bottom - b.top, x: b.left, y: b.top, toJSON: () => ({}) });

/**
 * A dock element whose box is `top`..`bottom` across a 768px viewport, holding a footer whose content box (inside 16px
 * of padding) is `action`, when given.
 */
function dockAt(top: number, bottom: number, action?: { left: number; right: number }): HTMLDivElement {
  const el = document.createElement('div');
  el.getBoundingClientRect = () => rect({ top, bottom, left: 0, right: 768 });
  if (action) {
    const footer = document.createElement('div');
    footer.style.padding = '16px';
    footer.getBoundingClientRect = () => rect({ top, bottom, left: action.left - 16, right: action.right + 16 });
    el.append(footer);
  }
  document.body.append(el);
  return el;
}

/** A float `width`×`height` px whose right edge is 744 (24px in from a 768px viewport) and whose corner inset is 24px. */
function floatOf(width: number, height: number, demoReserve = 0): HTMLDivElement {
  const el = document.createElement('div');
  el.style.setProperty('--float-inset', '24px');
  el.style.setProperty('--demo-reserve-block-end', `${demoReserve}px`);
  // Its live box is anywhere (its bottom glides): only its size and right edge count.
  el.getBoundingClientRect = () => rect({ top: 0, bottom: height, left: 744 - width, right: 744 });
  document.body.append(el);
  return el;
}

beforeEach(() => {
  window.innerHeight = 800;
});
afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
  document.documentElement.removeAttribute('data-demo-drawer');
  // DockInset keeps the registered dock at module level: register a stand-in and release it, so no test's dock (one a
  // test never released included) carries over into the next test, whatever the order.
  registerDock(document.createElement('div'))?.();
});

describe('dockInset: how far the voice widget lifts from its corner (D-147)', () => {
  // A 768px window: the centred 280px action is x 244–524; the round button at the corner x 688–744, the card x 384–744.
  const action = { left: 244, right: 524 };
  const corner = (left: number, height: number): Box => ({ left, right: 744, top: 776 - height, bottom: 776 });

  it('lifts over a dock pinned to the bottom edge (a footer band, the bottom navigation), whatever it holds', () => {
    expect(dockInset({ top: 720, bottom: 800, left: 0, right: 768 }, 800, null, [])).toBe(80);
    expect(dockInset({ top: 800, bottom: 800, left: 0, right: 768 }, 800, null, [])).toBe(0); // nothing in the dock (a desktop Home)
    expect(dockInset({ top: 721, bottom: 799.5, left: 0, right: 768 }, 800, corner(688, 56), [])).toBe(79); // sub-pixel rounding still counts as pinned
  });

  it('keeps the corner beside a dock that follows the content when the widget would not meet its action', () => {
    const dock = { top: 596, bottom: 680, left: 0, right: 768 }; // an inline footer ending 120px above the edge
    const obstacle = { ...action, top: 612, bottom: 668 };
    expect(dockInset(dock, 800, corner(688, 56), [obstacle])).toBe(0); // the round button sits beside the action
    expect(dockInset({ top: 300, bottom: 384, left: 0, right: 768 }, 800, corner(384, 126), [{ ...action, top: 316, bottom: 372 }])).toBe(0); // mid-page
    expect(dockInset(dock, 800, null, [obstacle])).toBe(0); // no widget measured yet
  });

  it('lifts the widget over a dock that follows the content when its corner box at its current size would meet the action (any window height)', () => {
    const dock = { top: 596, bottom: 680, left: 0, right: 768 };
    // The 126px card (x 384–744, 650–776) reaches the action (x 244–524, 612–668) ending 120px above the edge.
    expect(dockInset(dock, 800, corner(384, 126), [{ ...action, top: 612, bottom: 668 }])).toBe(204);
    // A footer ending 140px above the edge (its action 156px) still meets the card whose top is 150px above it: the
    // band a fixed 104px zone took for "not pinned".
    expect(dockInset({ top: 576, bottom: 660, left: 0, right: 768 }, 800, corner(384, 126), [{ ...action, top: 588, bottom: 644 }])).toBe(224);
  });

  it('keeps an 8px gap: a card within 8px of the action lifts, one further away keeps the corner', () => {
    const dock = { top: 500, bottom: 600, left: 0, right: 768 };
    expect(dockInset(dock, 800, corner(384, 126), [{ ...action, top: 520, bottom: 645 }])).toBe(300); // 5px above the card's top (650)
    expect(dockInset(dock, 800, corner(384, 126), [{ ...action, top: 520, bottom: 641 }])).toBe(0); // 9px above it
  });
});

describe('registerDock / useDockInset', () => {
  it('is 0 with no screen mounted', () => {
    expect(renderHook(() => useDockInset(null)).result.current).toBe(0);
  });

  it('measures the registered dock, and the last mounted dock wins (a new screen can mount before the old one leaves)', () => {
    const { result } = renderHook(() => useDockInset(null));
    const first = dockAt(736, 800);
    let releaseFirst: (() => void) | undefined;
    act(() => {
      releaseFirst = registerDock(first);
    });
    expect(result.current).toBe(64);
    const second = dockAt(712, 800);
    let releaseSecond: (() => void) | undefined;
    act(() => {
      releaseSecond = registerDock(second);
    });
    expect(result.current).toBe(88);
    // The old screen leaving does not clear the new one's dock.
    act(() => releaseFirst?.());
    expect(result.current).toBe(88);
    // Between two screens (no dock mounted) the last value holds: the widget does not dip to the corner and back.
    act(() => releaseSecond?.());
    expect(result.current).toBe(88);
    const third = dockAt(800, 800);
    act(() => {
      registerDock(third);
    });
    expect(result.current).toBe(0);
  });

  it('on a dock that follows the content, the round button keeps the corner and the card lifts over the action it would cover', () => {
    const action = { left: 244, right: 524 };
    const button = renderHook(() => useDockInset(floatOf(56, 56)));
    let release: (() => void) | undefined;
    act(() => {
      release = registerDock(dockAt(596, 680, action)); // the footer ends 120px above the edge
    });
    expect(button.result.current).toBe(0);
    button.unmount();
    act(() => release?.());
    const card = renderHook(() => useDockInset(floatOf(360, 126)));
    act(() => {
      release = registerDock(dockAt(596, 680, action));
    });
    expect(card.result.current).toBe(204);
    act(() => release?.());
    card.unmount();
  });

  it('reads the footer\'s content box (its padding excluded) and the floating demo pill\'s lift', () => {
    // The footer's box reaches x 540, but its action (the content box) ends at 524: the round button misses it.
    const button = renderHook(() => useDockInset(floatOf(56, 56)));
    act(() => {
      registerDock(dockAt(596, 680, { left: 244, right: 524 }));
    });
    expect(button.result.current).toBe(0);
    button.unmount();
    // Lifted 72px by the floating demo pill, the button (x 688–744) still misses the action; a card (x 384–744) whose
    // corner box is 72px higher meets a footer ending 200px above the edge.
    const card = renderHook(() => useDockInset(floatOf(360, 126, 72)));
    act(() => {
      registerDock(dockAt(516, 600, { left: 244, right: 524 }));
    });
    expect(card.result.current).toBe(284);
    card.unmount();
  });

  it('re-measures when the demo drawer opens (the widget moves left, toward a centred action)', async () => {
    const float = floatOf(56, 56);
    const { result } = renderHook(() => useDockInset(float));
    act(() => {
      registerDock(dockAt(660, 740, { left: 244, right: 524 })); // its action is x 244–524, 676–724
    });
    expect(result.current).toBe(0); // the round button at x 688–744 sits beside it
    float.getBoundingClientRect = () => rect({ top: 0, bottom: 56, left: 308, right: 364 });
    await act(async () => {
      document.documentElement.setAttribute('data-demo-drawer', '');
      await Promise.resolve(); // MutationObserver callbacks run as microtasks
    });
    expect(result.current).toBe(140);
  });

  it('observes the dock\'s column and each part of it: a banner that grows above an inline dock moves it and re-measures', () => {
    // The screen's column (ScreenLayout's frame): a banner, main and the dock. Only the banner's size changes.
    const column = document.createElement('div');
    const banner = document.createElement('div');
    const main = document.createElement('main');
    column.append(banner, main);
    document.body.append(column);
    const dock = dockAt(596, 680, { left: 244, right: 524 });
    column.append(dock);
    const observed = new Set<Element>();
    const callbacks: (() => void)[] = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(callback: () => void) {
          callbacks.push(callback);
        }
        observe(el: Element) {
          observed.add(el);
        }
        disconnect() {}
      },
    );
    try {
      const { result } = renderHook(() => useDockInset(floatOf(360, 126)));
      let release: (() => void) | undefined;
      act(() => {
        release = registerDock(dock);
      });
      expect(result.current).toBe(204);
      for (const el of [column, banner, main, dock]) expect(observed.has(el)).toBe(true);
      // The offline banner shows: the inline dock moves down 40px without any of its own boxes resizing.
      dock.getBoundingClientRect = () => rect({ top: 636, bottom: 720, left: 0, right: 768 });
      (dock.firstElementChild as HTMLElement).getBoundingClientRect = () => rect({ top: 636, bottom: 720, left: 228, right: 540 });
      act(() => callbacks.forEach((callback) => callback()));
      expect(result.current).toBe(164);
      act(() => release?.());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('re-measures on a window resize, and writes only on a change', () => {
    let renders = 0;
    const dock = dockAt(736, 800);
    const { result } = renderHook(() => {
      renders++;
      return useDockInset(null);
    });
    let release: (() => void) | undefined;
    act(() => {
      release = registerDock(dock);
    });
    expect(result.current).toBe(64);
    const settled = renders;
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(renders).toBe(settled); // the same value: no render
    dock.getBoundingClientRect = () => rect({ top: 300, bottom: 400, left: 0, right: 360 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(0); // the dock now follows the content
    act(() => release?.());
  });
});

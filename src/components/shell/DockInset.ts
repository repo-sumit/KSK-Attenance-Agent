'use client';
import { useLayoutEffect, useState, useSyncExternalStore } from 'react';

/*
 * How high floating controls sit (the Voice Agent widget, D-147). The widget is one viewport overlay at the
 * bottom-right corner; the only thing a screen tells it is its dock (the footer CTA band, the bottom navigation and the
 * safe-area padding), so the widget sits just above a dock that is in its way and never covers a primary action.
 * ScreenLayout registers its dock; useDockInset() measures it. Last mounted wins (a new screen can mount before the old
 * one leaves); a screen unregisters only if its dock is still current.
 */

let current: HTMLElement | null = null;
const listeners = new Set<() => void>();

function publish(dock: HTMLElement | null) {
  current = dock;
  listeners.forEach((l) => l());
}

/** A ref callback for ScreenLayout's dock element. */
export function registerDock(dock: HTMLDivElement | null) {
  if (!dock) return;
  publish(dock);
  return () => {
    if (current === dock) publish(null);
  };
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

export interface Box {
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** The room the widget keeps from a footer action it would otherwise touch (the card's 8px gap, D-136). */
const GAP = 8;

const overlaps = (a: Box, b: Box) => a.left < b.right + GAP && b.left - GAP < a.right && a.top < b.bottom + GAP && b.top - GAP < a.bottom;

/**
 * How far the widget lifts from its corner: the dock's height above the viewport's bottom edge, or 0.
 * - A dock pinned to the bottom edge (a footer band or the bottom navigation, which span the viewport) always lifts it.
 * - A dock that follows the content (an inline footer or a centred card from 600px) lifts it only when the widget's
 *   corner box at its current size (`corner`) would meet one of the dock's content boxes (`obstacles`: the footer's
 *   actions). So the round button keeps the corner beside a centred 280px action while the wider card lifts over it,
 *   whatever the window's height.
 */
export function dockInset(dock: Box, viewportHeight: number, corner: Box | null, obstacles: readonly Box[]): number {
  const lift = Math.max(0, viewportHeight - dock.top);
  if (dock.bottom >= viewportHeight - 1) return lift;
  return corner && obstacles.some((o) => overlaps(corner, o)) ? lift : 0;
}

const px = (style: CSSStyleDeclaration, name: string) => parseFloat(style.getPropertyValue(name)) || 0;

/** The widget's box at its corner, at its current size: where it rests with no lift (its bottom glides, so not its live box). */
function cornerBox(float: HTMLElement, viewportHeight: number): Box | null {
  const r = float.getBoundingClientRect();
  if (!r.width || !r.height) return null;
  const style = getComputedStyle(float);
  const bottom = viewportHeight - px(style, '--float-inset') - px(style, '--demo-reserve-block-end');
  return { left: r.left, right: r.right, top: bottom - r.height, bottom };
}

/** The content boxes of the dock's parts (the footer's actions, the bottom navigation): padding and borders excluded. */
function contentBoxes(dock: HTMLElement): Box[] {
  return Array.from(dock.children).flatMap((el) => {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return []; // the toast anchor has no height
    const s = getComputedStyle(el);
    const edge = (side: 'top' | 'bottom' | 'left' | 'right') => px(s, `padding-${side}`) + px(s, `border-${side}-width`);
    return [{ top: r.top + edge('top'), bottom: r.bottom - edge('bottom'), left: r.left + edge('left'), right: r.right - edge('right') }];
  });
}

/**
 * The mounted screen's dock lift (see dockInset); 0 before any screen has mounted. Between two screens (a route's
 * loading moment, when no dock is mounted) it keeps the last value, so the widget does not dip to the corner and back
 * on a navigation. `float` is the floating element (its size and tokens give its corner box). Re-measured when the
 * screen's column or any part of it resizes (the dock; main, as an inline dock moves when the content grows; a banner
 * above them), when the float or the window resizes, and when
 * the demo drawer or the floating demo pill moves the widget; a re-render only when the value changes.
 */
export function useDockInset(float: HTMLElement | null): number {
  const dock = useSyncExternalStore(subscribe, () => current, () => null);
  const [inset, setInset] = useState(0);
  useLayoutEffect(() => {
    if (!dock) return;
    let last: number | undefined;
    const measure = () => {
      const vh = window.innerHeight;
      const next = dock.isConnected ? dockInset(dock.getBoundingClientRect(), vh, float ? cornerBox(float, vh) : null, contentBoxes(dock)) : 0;
      if (next === last) return; // write only on a change
      last = next;
      setInset(next);
    };
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    // The screen's column and each part of it (header, banner, main, dock): a banner that grows above an inline dock
    // moves it without resizing the dock or main.
    const column = dock.parentElement;
    for (const el of [column, ...(column ? Array.from(column.children) : [dock]), float]) if (el) observer?.observe(el);
    const marks = typeof MutationObserver === 'function' ? new MutationObserver(measure) : null;
    marks?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-demo-drawer', 'data-demo-float'] });
    window.addEventListener('resize', measure);
    return () => {
      observer?.disconnect();
      marks?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [dock, float]);
  return inset;
}

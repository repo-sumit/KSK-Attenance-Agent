'use client';
import { useSyncExternalStore } from 'react';

/*
 * Where floating controls sit (the voice button and card, D-133): just above the current screen's footer and
 * bottom navigation, on the screen's content column. ScreenLayout renders one anchor at the top of its dock: an
 * empty block on the column (its side margins are the screen's gutters) whose height is the --voice-space
 * reserve. Floating UI finds it with useDockAnchor() and measures it; with no anchor (no screen yet) it falls
 * back to the viewport's bottom-right corner. Last mounted wins (a new screen can mount before the old one
 * leaves); a screen unregisters only if its anchor is still current.
 */

let current: HTMLElement | null = null;
const listeners = new Set<() => void>();

function publish(anchor: HTMLElement | null) {
  current = anchor;
  listeners.forEach((l) => l());
}

/** A ref callback for ScreenLayout's anchor element. */
export function registerDockAnchor(anchor: HTMLDivElement | null) {
  if (!anchor) return;
  publish(anchor);
  return () => {
    if (current === anchor) publish(null);
  };
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/** The mounted screen's dock anchor, or null while no screen is mounted. */
export function useDockAnchor(): HTMLElement | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}

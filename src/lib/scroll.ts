/** How long a section voice asked for is held in view while the page above it settles. */
export const SETTLE_MS = 1500;

const TAKE_OVER = ['wheel', 'touchstart', 'keydown'] as const;

/**
 * Brings `el` to the top of its scroller and keeps it there while the content above it settles. Voice can open Reports
 * on a section while the sections above it are still loading; when they arrive they grow and would push the section
 * out of view. For SETTLE_MS, a resize of anything above the section re-aligns it (without animation, so it never
 * fights the shift); the trainer's own scroll, touch or key ends the hold at once. Returns a cancel function.
 */
export function scrollIntoViewSettled(el: HTMLElement, reducedMotion: boolean): () => void {
  el.scrollIntoView?.({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  if (typeof ResizeObserver === 'undefined') return () => undefined;
  // Everything before the section (its earlier siblings, then its ancestors' earlier siblings) moves it when it grows.
  const above: Element[] = [];
  for (let node: Element | null = el; node && node.tagName !== 'MAIN' && node !== document.body; node = node.parentElement) {
    for (let before = node.previousElementSibling; before; before = before.previousElementSibling) above.push(before);
  }
  const heights = new Map(above.map((n) => [n, n.getBoundingClientRect().height]));
  // A ResizeObserver also reports each element once when observation starts: only a real change re-aligns, so the
  // first scroll keeps its smooth animation.
  const observer = new ResizeObserver(() => {
    let moved = false;
    for (const n of above) {
      const h = n.getBoundingClientRect().height;
      if (h !== heights.get(n)) moved = true;
      heights.set(n, h);
    }
    if (moved) el.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  });
  for (const n of above) observer.observe(n);
  let done = false;
  const stop = () => {
    if (done) return;
    done = true;
    observer.disconnect();
    window.clearTimeout(timer);
    for (const type of TAKE_OVER) window.removeEventListener(type, stop);
  };
  const timer = window.setTimeout(stop, SETTLE_MS);
  for (const type of TAKE_OVER) window.addEventListener(type, stop, { passive: true });
  return stop;
}

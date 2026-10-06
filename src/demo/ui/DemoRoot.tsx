'use client';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { SheetTitleBar, sheetSurface } from '@/components/ui/BottomSheet';
import { Icon } from '@/components/ui/icons/Icon';
import { useHeaderToolSlot } from '@/components/shell/ToolSlot';
import { useContainer } from '@/hooks/services';
import { cx } from '@/lib/cx';
import type { DemoAdapters } from '../adapters';
import { DemoController } from '../controller';
import { firstName } from '../personas';
import { DemoPanel, DemoStatus, useSignedInPersona } from './DemoPanel';
import { useDemoState } from './useDemoState';
import styles from './DemoRoot.module.css';

declare global {
  interface Window {
    __kskDemo?: DemoController;
  }
}

/** Applies ?preset=<id> once (presenter links, automated tests). */
function PresetFromUrl({ controller }: { readonly controller: DemoController }) {
  const preset = useSearchParams().get('preset');
  const applied = useRef(false);
  useEffect(() => {
    if (preset && !applied.current) {
      applied.current = true;
      void controller.applyPreset(preset);
    }
  }, [preset, controller]);
  return null;
}

/** Tablets and desktops keep the product usable while the panel is open (it overlays, never reflows). */
const WIDE = '(min-width: 600px)';
/** On <html> while the trigger floats: turns on the reserves in tokens.css (--demo-reserve-*). */
const FLOAT_MARKER = 'data-demo-float';
/** On <html> while the non-modal drawer is open (from 600px): the Voice Agent widget moves left of it. */
const DRAWER_MARKER = 'data-demo-drawer';

/**
 * DEMO ONLY. The presenter controls start collapsed: a small "Demo" trigger.
 * On screens with the app header it sits in the header's tool slot,
 * immediately left of the avatar (D-066), so the avatar stays the right-most
 * control. Screens without the app header (login, camera, result and
 * permission cards) have no slot: there it floats (top right on phones,
 * bottom right from 600px) and marks <html> so the layout keeps room for it.
 * Phones open a modal bottom sheet; tablets and desktops open a drawer on the
 * right, below the header, that overlays the app without taking layout space,
 * so the presenter can keep using the app while changing settings. The
 * trigger carries the presenter mark (`presentation`), the signed-in first
 * name from 600px ("Demo · Sunita") and, while the simulation is offline,
 * `wifi-off` in the icon's place. The product never imports this.
 */
export function DemoRoot({ demo, children }: { readonly demo: DemoAdapters; readonly children: ReactNode }) {
  const app = useContainer();
  const router = useRouter();
  const slot = useHeaderToolSlot();
  const dialog = useRef<HTMLDialogElement>(null);
  /** Whichever trigger is mounted (in the header slot or floating): focus comes back to it. */
  const trigger = useRef<HTMLButtonElement>(null);
  const triggerFocused = useRef(false);
  const title = useRef<HTMLHeadingElement>(null);
  /** Opened with show() (drawer, no native Esc) rather than showModal() (sheet). `:modal` isn't in older WebViews. */
  const drawer = useRef(false);
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const controller = useMemo(() => new DemoController(app, demo, (href) => router.push(href)), [app, demo, router]);
  const offline = !useDemoState(demo).simulation.online;
  const signedIn = useSignedInPersona();

  useEffect(() => {
    window.__kskDemo = controller;
    return () => {
      delete window.__kskDemo;
    };
  }, [controller]);

  // Floating: reserve room for it. Before paint, so nothing jumps when a screen with the header arrives.
  useLayoutEffect(() => {
    if (slot) return;
    const html = document.documentElement;
    html.setAttribute(FLOAT_MARKER, '');
    return () => html.removeAttribute(FLOAT_MARKER);
  }, [slot]);

  // A new screen's header re-mounts the trigger in its slot: keyboard focus stays on it. (Removal
  // from the page fires no blur React sees, so the flag still holds from before the move.)
  useLayoutEffect(() => {
    if (triggerFocused.current && document.activeElement !== trigger.current) trigger.current?.focus();
  }, [slot]);

  // The wide drawer starts below the whole header (task screens add a back + title row), re-measured
  // when the header changes size or a new screen's header arrives while the drawer is open.
  useLayoutEffect(() => {
    const d = dialog.current;
    if (!open || !drawer.current || !d) return;
    const header = document.querySelector('header');
    // The shared drawer placement adds the gap below it.
    const place = () => d.style.setProperty('--overlay-top', header ? `${Math.round(header.getBoundingClientRect().bottom)}px` : '');
    place();
    const observer = header ? new ResizeObserver(place) : null;
    if (header) observer?.observe(header);
    return () => observer?.disconnect();
  }, [open, slot]);

  // The drawer contract (cross-lane): <html data-demo-drawer> exactly while the non-modal drawer is open.
  useLayoutEffect(() => {
    if (!open || !drawer.current) return;
    const html = document.documentElement;
    html.setAttribute(DRAWER_MARKER, '');
    return () => html.removeAttribute(DRAWER_MARKER);
  }, [open]);

  // The non-modal drawer gets no native Esc handling: add it while open.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || !dialog.current?.open || !drawer.current) return;
      // A sheet or menu open on top of the app takes this Escape itself (native dialog cancel).
      if ([...document.querySelectorAll('dialog[open]')].some((d) => d !== dialog.current)) return;
      dialog.current.close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const show = () => {
    const d = dialog.current;
    if (!d || d.open) return;
    drawer.current = window.matchMedia(WIDE).matches;
    if (drawer.current) d.show();
    else d.showModal();
    // Start on the panel's title (not on a preset: one stray Enter must not switch the whole demo).
    title.current?.focus();
    setOpen(true);
  };
  const close = () => dialog.current?.close();

  const button = (
    <button
      ref={trigger}
      type="button"
      className={cx(styles.trigger, slot ? styles.inHeader : styles.floating)}
      onClick={() => (open ? close() : show())}
      onFocus={() => (triggerFocused.current = true)}
      onBlur={() => (triggerFocused.current = false)}
      aria-label={offline ? 'Open demo controls, offline' : 'Open demo controls'}
      aria-expanded={open}
      // Presenter tooling is English only (like the panel): Latin face and an English voice in Marathi too.
      lang="en"
      data-offline={offline || undefined}
    >
      {/* Offline is the setting presenters forget to undo: its icon takes the mark's place (also when icon only). */}
      <Icon name={offline ? 'wifi-off' : 'presentation'} size={16} />
      <span className={styles.triggerText}>Demo</span>
      {signedIn && <span className={styles.triggerName}>· {firstName(signedIn)}</span>}
    </button>
  );

  return (
    <>
      {children}
      {slot ? createPortal(button, slot) : button}
      <dialog
        ref={dialog}
        className={cx(sheetSurface('drawer'), styles.panel)}
        aria-labelledby={titleId}
        lang="en"
        onClose={() => {
          setOpen(false);
          // Every way of closing (×, Esc, a preset) hands focus back to the trigger.
          trigger.current?.focus();
        }}
        onClick={(e) => e.target === dialog.current && close()}
      >
        <SheetTitleBar id={titleId} titleRef={title} title="Demo controls" subtitle={open && <DemoStatus demo={demo} />} closeLabel="Close demo controls" onClose={close} />
        {/* Mounted only while open: nothing of the panel is in the page (or the accessibility tree) when collapsed. */}
        {open && <DemoPanel demo={demo} controller={controller} onDone={close} />}
      </dialog>
      <Suspense>
        <PresetFromUrl controller={controller} />
      </Suspense>
    </>
  );
}

'use client';
import { createContext, useContext, type ReactNode } from 'react';
import type { NavTab } from '@/config/journey';
import { cx } from '@/lib/cx';
import { ToastViewport } from '@/components/ui/Toast';
import { AppBottomNav, NavigationGuardContext, type NavigationGuard } from './AppNav';
import { ConnectivityBanner } from './ConnectivityBanner';
import { registerDock } from './DockInset';
import styles from './ScreenLayout.module.css';

const AreaContext = createContext<NavTab | undefined>(undefined);

/** The app area the current screen belongs to (the header navigation marks it current). */
export const useScreenArea = () => useContext(AreaContext);

interface ScreenLayoutProps {
  readonly header?: ReactNode;
  /** Show the offline / sync banner under the header. 'offline': only the offline notice (the screen shows sync itself, D-064). */
  readonly banner?: boolean | 'offline';
  /** Fixed region above the scroller (roster summary, segmented switch). */
  readonly top?: ReactNode;
  /** Fixed region below the scroller (primary action). */
  readonly footer?: ReactNode;
  /** The area this screen belongs to: marks the current item in the header and bottom navigation. */
  readonly area?: NavTab;
  /** Tab roots show the bottom navigation on phones (tablets and desktops navigate from the header). */
  readonly bottomNav?: boolean;
  /** Intercepts header / bottom navigation while the screen holds unsaved work. */
  readonly guardNavigation?: NavigationGuard;
  /** app: grey page with white cards · default/raised: white · inverse: dark camera. */
  readonly surface?: 'app' | 'default' | 'raised' | 'inverse';
  /** Padding for the scroll content; 'none' lets lists run edge to edge. */
  readonly padding?: 'page' | 'none' | 'center';
  /** Content measure from tablet width up (phones always use the full width): form 480 · reading 800 · wide 1008. */
  readonly width?: 'form' | 'reading' | 'wide';
  /** Tablet and desktop: the whole screen becomes a centred card on the page (login and single-question screens). */
  readonly card?: boolean;
  /** Tablet and desktop: the footer follows the content instead of docking at the bottom edge (short screens inside the app). */
  readonly inlineFooter?: boolean;
  /** Tablet and desktop: the footer's items sit side by side, centred (two actions, or a message and its action); phones stay stacked. */
  readonly footerLayout?: 'stack' | 'row';
  /**
   * A white screen whose content scrolls under its footer (login with the Demo accounts list): one divider above the
   * footer, as every scrolling screen's footer has, inset to the card's content in card mode (U17).
   */
  readonly footerDivider?: boolean;
  readonly children: ReactNode;
}

/**
 * Every screen's frame. The main area is the ONLY scroller, so fixed regions
 * (summary, footer CTA, nav) can never cover a student row — the prototype's
 * "sticky" behaviour without position: sticky.
 *
 * Mobile-first, not mobile-only (D-045): on phones the frame is the whole
 * screen; from the SwiftChat medium breakpoint up it still fills the viewport,
 * and content keeps a readable column (`width`) inside the grid margins.
 */
export function ScreenLayout({ header, banner = true, top, footer, area, bottomNav = false, guardNavigation, surface = 'app', padding = 'page', width = 'wide', card = false, inlineFooter = false, footerLayout = 'stack', footerDivider = false, children }: ScreenLayoutProps) {
  return (
    <AreaContext.Provider value={area}>
      <NavigationGuardContext.Provider value={guardNavigation}>
        <div className={cx(styles.page, card && styles.pageCard)}>
          <div className={cx(styles.frame, styles[surface], styles[`w-${card ? 'form' : width}`], card && styles.card, inlineFooter && styles.inlineFooter, footerLayout === 'row' && styles.footerRow, footerDivider && styles.footerDivider)}>
            {header}
            {banner && (
              // Always in the DOM, so screen readers announce going offline (a live region that arrives with its text is often missed).
              <div className={cx(styles.banner, !header && styles.bannerFirst)} role="status" aria-live="polite">
                <ConnectivityBanner offlineOnly={banner === 'offline'} />
              </div>
            )}
            {top && <div className={styles.top}>{top}</div>}
            <main id="main" tabIndex={-1} className={cx(styles.main, styles[`pad-${padding}`], !header && styles.headerless)}>
              {children}
            </main>
            {/* The floating Voice Agent widget sits just above this dock while it is pinned to the bottom edge (DockInset, D-147). */}
            <div ref={registerDock} className={styles.dock}>
              {/* The toast anchor has no height: a toast floats above the dock's top. */}
              <ToastViewport />
              {footer && <div className={styles.footer}>{footer}</div>}
              {bottomNav && area && <AppBottomNav active={area} />}
            </div>
          </div>
        </div>
      </NavigationGuardContext.Provider>
    </AreaContext.Provider>
  );
}

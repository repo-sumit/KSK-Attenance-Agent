import type { ReactNode } from 'react';
import styles from './TopBand.module.css';

/**
 * The one anatomy of a fixed band above the scroller (ScreenLayout `top`, D-159): white, one divider under it, its
 * content on the screen's column with 12 above and below and 12 between its items. The roster's summary, a record's
 * strip and summary, and the principal's Students and Staff views all use it, so a view switch keeps its y, width and
 * background when it flips between screens.
 */
export function TopBand({ children }: { readonly children: ReactNode }) {
  return <div className={styles.band}>{children}</div>;
}

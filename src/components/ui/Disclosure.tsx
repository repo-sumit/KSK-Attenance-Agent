'use client';
import { useId, useState, type ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './icons/Icon';
import styles from './Disclosure.module.css';

interface DisclosureProps {
  /** What the row says while collapsed; the whole row is the button. */
  readonly summary: ReactNode;
  /** Rendered only while open, so a panel can load its own data when it is first shown. */
  readonly children: ReactNode;
  readonly defaultOpen?: boolean;
  /** Controlled use: pass both. */
  readonly open?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /**
   * A control at the end of the header row, beside the toggle (never inside it), so it works while the row
   * stays collapsed. Without it the markup is the bare toggle button.
   */
  readonly action?: ReactNode;
  readonly className?: string;
}

/**
 * An expandable row (brief §7, §8): a full-width button with a chevron that
 * turns, and a panel that grows open below it. Touch, mouse and keyboard
 * (Enter / Space) all work the same; nothing depends on hover.
 */
export function Disclosure({ summary, children, defaultOpen = false, open, onOpenChange, action, className }: DisclosureProps) {
  const [own, setOwn] = useState(defaultOpen);
  const isOpen = open ?? own;
  const panelId = useId();
  const toggle = () => {
    const next = !isOpen;
    if (open === undefined) setOwn(next);
    onOpenChange?.(next);
  };
  const button = (
    <button type="button" className={styles.button} aria-expanded={isOpen} aria-controls={isOpen ? panelId : undefined} onClick={toggle}>
      <span className={styles.summary}>{summary}</span>
      <Icon name="chevron-down" size={20} className={styles.chevron} />
    </button>
  );
  return (
    <div className={cx(styles.disclosure, isOpen && styles.open, className)}>
      {action ? (
        <div className={styles.header}>
          {button}
          <div className={styles.action}>{action}</div>
        </div>
      ) : (
        button
      )}
      {isOpen && (
        <div id={panelId} className={styles.panel}>
          <div className={styles.inner}>{children}</div>
        </div>
      )}
    </div>
  );
}

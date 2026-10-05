import type { ReactNode, Ref } from 'react';
import { cx } from '@/lib/cx';
import styles from './Section.module.css';

interface SectionProps {
  readonly title?: ReactNode;
  readonly subtitle?: ReactNode;
  readonly children: ReactNode;
  /** 'title' = Title/Large heading; 'label' = small secondary group label. */
  readonly variant?: 'title' | 'label';
  readonly className?: string;
  readonly id?: string;
  /** Heading level: 2 for a page section, 3 for a group inside one (a trade under "Your batches"). */
  readonly level?: 2 | 3;
  /** A small control at the end of the title line (a trade's "Trade register"). */
  readonly action?: ReactNode;
  /** The section element (Reports scrolls a section into view when voice shows it). */
  readonly ref?: Ref<HTMLElement>;
  /** The heading can take focus from script (tabIndex -1): where focus returns when its control is not shown. */
  readonly focusableHeading?: boolean;
}

/** Titled group of content: 16 between title and content (replaces the prototype's negative margin). */
export function Section({ title, subtitle, children, variant = 'title', className, id, level = 2, action, ref, focusableHeading }: SectionProps) {
  const Heading = level === 3 ? 'h3' : 'h2';
  const heading = title && (
    <Heading id={id ? `${id}-title` : undefined} className={variant === 'title' ? styles.title : styles.label} tabIndex={focusableHeading ? -1 : undefined}>
      {title}
    </Heading>
  );
  return (
    <section ref={ref} className={cx(styles.section, variant === 'label' && styles.tight, className)} aria-labelledby={title && id ? `${id}-title` : undefined}>
      {title && (
        <div className={styles.head}>
          {action ? (
            <div className={styles.titleRow}>
              {heading}
              {action}
            </div>
          ) : (
            heading
          )}
          {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
        </div>
      )}
      {children}
    </section>
  );
}

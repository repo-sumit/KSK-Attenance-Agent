'use client';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { cx } from '@/lib/cx';
import { Icon } from './icons/Icon';
import styles from './ListRow.module.css';

interface ListRowProps {
  readonly title: ReactNode;
  readonly subtitle?: ReactNode;
  readonly leading?: ReactNode;
  /** 'chevron' draws the navigation affordance. */
  readonly trailing?: ReactNode | 'chevron';
  readonly href?: string;
  readonly onClick?: () => void;
  readonly minHeight?: 56 | 64 | 72;
  readonly tone?: 'default' | 'danger';
  readonly titleStyle?: 'title' | 'label';
  /** A button row that can't be pressed right now (another row is working). */
  readonly disabled?: boolean;
  /** A button row that is working (its trailing slot shows the progress). */
  readonly busy?: boolean;
  /** The highlighted choice in a list of choices (aria-current). */
  readonly current?: boolean;
}

/** Row inside a List card: 16/12 padding, divider between rows (DS list item). */
export function ListRow({ title, subtitle, leading, trailing, href, onClick, minHeight = 64, tone = 'default', titleStyle = 'title', disabled, busy, current }: ListRowProps) {
  const body = (
    <>
      {leading}
      <span className={styles.text}>
        <span className={cx(styles.title, titleStyle === 'label' && styles.labelTitle)}>{title}</span>
        {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
      </span>
      {trailing === 'chevron' ? <Icon name="chevron-right" size={20} className={styles.chevron} /> : trailing}
    </>
  );
  const classes = cx(styles.row, styles[`h${minHeight}`], tone === 'danger' && styles.danger, (href || onClick) && styles.interactive);
  return (
    <li className={styles.item}>
      {href ? (
        <Link href={href} className={classes}>
          {body}
        </Link>
      ) : onClick ? (
        <button type="button" className={classes} onClick={onClick} disabled={disabled} aria-busy={busy || undefined} aria-current={current || undefined}>
          {body}
        </button>
      ) : (
        <div className={classes}>{body}</div>
      )}
    </li>
  );
}

/**
 * A List card. `grid`: where there is room (≥ 640px of content) its rows become
 * separate cards in two columns — trade and report pickers on tablets and desktops.
 */
export function List({ children, label, className, grid = false }: { readonly children: ReactNode; readonly label?: string; readonly className?: string; readonly grid?: boolean }) {
  const list = (
    <ul className={cx(styles.list, grid && styles.gridList, className)} aria-label={label}>
      {children}
    </ul>
  );
  return grid ? <div className={styles.gridWrap}>{list}</div> : list;
}

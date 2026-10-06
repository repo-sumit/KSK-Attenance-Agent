import type { ReactNode } from 'react';
import { Card } from './Card';
import { Icon, type IconName } from './icons/Icon';
import styles from './EmptyState.module.css';

/**
 * Three empty-state patterns (D-159): a screen whose only content is empty uses EmptyState (the well, a title, an
 * action); an empty section on a populated page is an EmptyNote; an empty state that is good news is a success Banner.
 */
export function EmptyState({ icon, title, body, action }: { readonly icon: IconName; readonly title: string; readonly body?: string; readonly action?: ReactNode }) {
  return (
    <div className={styles.empty}>
      <span className={styles.well} aria-hidden="true">
        <Icon name={icon} size={36} />
      </span>
      <p className={styles.title}>{title}</p>
      {body && <p className={styles.body}>{body}</p>}
      {action}
    </div>
  );
}

/** An empty section on a populated page: a quiet card with one secondary line ("Nothing submitted yet today"). */
export function EmptyNote({ children }: { readonly children: ReactNode }) {
  return (
    <Card>
      <p className={styles.note}>{children}</p>
    </Card>
  );
}

import { cx } from '@/lib/cx';
import { Icon, type IconName } from './icons/Icon';
import type { Tone } from './Badge';
import styles from './IconWell.module.css';

/** Large circular icon well for problem, result, intro and permission screens. */
export function IconWell({ icon, tone, size = 88, settle = false }: { readonly icon: IconName; readonly tone: Tone; readonly size?: 88 | 96; readonly settle?: boolean }) {
  return (
    <span className={cx(styles.well, styles[tone], styles[`s${size}`], settle && styles.settle)} aria-hidden="true">
      <Icon name={icon} size={size === 96 ? 48 : 44} />
    </span>
  );
}

/** Rounded-square icon chip used in cards and list rows: one size everywhere, 40px with a 20px icon (D-159). */
export function IconTile({ icon, tint = 'blue' }: { readonly icon: IconName; readonly tint?: 'blue' | 'green' }) {
  return (
    <span className={cx(styles.tile, styles[tint])} aria-hidden="true">
      <Icon name={icon} size={20} />
    </span>
  );
}

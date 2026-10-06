'use client';
import { useRef, type KeyboardEvent } from 'react';
import { cx } from '@/lib/cx';
import styles from './Segmented.module.css';

export interface SegmentedOption<V extends string> {
  readonly value: V;
  readonly label: string;
  /** Language of the label, e.g. "mr" for "मराठी" shown in an English UI. */
  readonly lang?: string;
}

interface SegmentedProps<V extends string> {
  readonly label: string;
  readonly options: readonly SegmentedOption<V>[];
  readonly value: V;
  readonly onChange: (value: V) => void;
  /**
   * Spans its column (D-159): a screen's view switch (md) and a screen's filter (sm). A control inside a panel or a
   * row keeps its natural width from 600px.
   */
  readonly fullWidth?: boolean;
  readonly size?: 'md' | 'sm';
  readonly className?: string;
}

/** Radio group styled as the SwiftChat segmented control; arrow keys move the selection. */
export function Segmented<V extends string>({ label, options, value, onChange, fullWidth, size = 'md', className }: SegmentedProps<V>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const current = Math.max(0, options.findIndex((o) => o.value === value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    const next = (current + delta + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx(styles.track, fullWidth && styles.full, styles[size], className)}>
      {options.map((option, i) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            lang={option.lang}
            className={cx(styles.option, selected && styles.selected)}
            onClick={() => onChange(option.value)}
            onKeyDown={onKeyDown}
          >
            <span className={styles.pill}>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}

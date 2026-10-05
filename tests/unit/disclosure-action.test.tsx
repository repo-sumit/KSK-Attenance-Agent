// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Disclosure } from '@/components/ui/Disclosure';
import styles from '@/components/ui/Disclosure.module.css';

afterEach(cleanup);

const toggle = () => screen.getByRole('button', { name: 'Fitter · Shift 1 · Unit 1' });
/** Tag and class of each element in the subtree, in document order (an icon counts as one): the markup's shape without its text. */
const shape = (el: Element): string[] => [
  `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`,
  ...(el.tagName.toLowerCase() === 'svg' ? [] : [...el.children].flatMap(shape)),
];

describe('Disclosure action slot', () => {
  it('renders the action beside the toggle, never inside it, and a click on it does not toggle the row', () => {
    const onAction = vi.fn();
    const { container } = render(
      <Disclosure summary="Fitter · Shift 1 · Unit 1" action={<button type="button" onClick={onAction}>Download</button>}>
        <p>Students</p>
      </Disclosure>,
    );
    const action = screen.getByRole('button', { name: 'Download' });
    expect(toggle()).not.toContainElement(action);
    expect(action.closest('button')).toBe(action);
    // One header row holds both; the toggle comes first, so it is still the row's first button.
    expect(container.querySelector('button')).toBe(toggle());
    expect(toggle().parentElement).toBe(action.parentElement?.parentElement);
    expect(toggle().parentElement).toHaveClass(styles.header);

    fireEvent.click(action);
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(toggle()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Students')).toBeNull();

    fireEvent.click(toggle());
    expect(toggle()).toHaveAttribute('aria-expanded', 'true');
    // The panel spans the row below the header, not beside the action.
    const panel = screen.getByText('Students').closest(`.${styles.panel}`);
    expect(panel?.parentElement).toBe(container.firstElementChild);
    expect(screen.getByRole('button', { name: 'Download' })).toBeInTheDocument();
  });

  it('without an action the markup is exactly as before: the toggle button, then the panel, directly in the row', () => {
    const { container } = render(
      <Disclosure summary="Fitter · Shift 1 · Unit 1">
        <p>Students</p>
      </Disclosure>,
    );
    const root = container.firstElementChild!;
    expect(shape(root)).toEqual([`div.${styles.disclosure}`, `button.${styles.button}`, `span.${styles.summary}`, expect.stringMatching(/^svg\./)]);
    fireEvent.click(toggle());
    expect(shape(root)).toEqual([
      `div.${styles.disclosure} ${styles.open}`,
      `button.${styles.button}`,
      `span.${styles.summary}`,
      expect.stringMatching(/^svg\./),
      `div.${styles.panel}`,
      `div.${styles.inner}`,
      'p.',
    ]);
    expect(container.querySelector(`.${styles.header}`)).toBeNull();
  });
});

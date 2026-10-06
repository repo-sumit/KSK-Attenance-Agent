import { Fragment, type ReactNode } from 'react';
import { Latin } from '@/components/ui/Latin';
import { useT } from '@/hooks/i18n';
import type { I18n, MessageKey } from '@/i18n';

type T = I18n['t'];
type Params = Readonly<Record<string, string | number | ReactNode>>;

const SENTINEL = '\u0000';
const SLOT = /\u0000(\d+)\u0000/;

/**
 * A translated message with elements in it. Each param given as an element (anything but a string or a number) stands
 * in as an indexed slot while the message is filled; the text is then split around the slots and the elements put
 * back in their places, in the translation's own order. Strings and numbers are filled as usual (`count` still picks
 * the plural). A param the message does not use is simply left out.
 */
export function slotted(t: T, key: MessageKey, params: Params): ReactNode[] {
  const nodes: ReactNode[] = [];
  const plain: Record<string, string | number> = {};
  for (const [name, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number') plain[name] = value;
    else {
      plain[name] = `${SENTINEL}${nodes.length}${SENTINEL}`;
      nodes.push(value);
    }
  }
  // split() with a capture group alternates text and slot indexes: text, index, text, index, … text.
  return t(key, plain)
    .split(SLOT)
    .map((part, i) => (i % 2 === 0 ? part : <Fragment key={i}>{nodes[Number(part)]}</Fragment>))
    .filter((part) => part !== '');
}

/**
 * A translated sentence holding master data: the params named in `latin` (a person's or trade's name, an ID) are set
 * as <Latin>, the translated words around them are not (DESIGN_SYSTEM.md Fonts). "वडील: <Latin>Suresh Kumar</Latin>".
 * One inline span, so a flex parent (a row's wrapping secondary line) keeps the sentence as one item.
 */
export function LatinText({ k, params, latin }: { readonly k: MessageKey; readonly params: Readonly<Record<string, string | number>>; readonly latin: readonly string[] }) {
  const t = useT();
  return <span>{latinText(t, k, params, latin)}</span>;
}

/** LatinText as nodes, for a caller that already holds `t` (a memoized label, a row). */
export function latinText(t: T, k: MessageKey, params: Readonly<Record<string, string | number>>, latin: readonly string[]): ReactNode[] {
  const filled: Record<string, string | number | ReactNode> = { ...params };
  for (const name of latin) if (params[name] !== undefined) filled[name] = <Latin>{params[name]}</Latin>;
  return slotted(t, k, filled);
}

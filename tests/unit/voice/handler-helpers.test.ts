import { describe, expect, it } from 'vitest';
import * as base from '@/services/voice/handlers/base';
import * as context from '@/services/voice/handlers/context';

/** The result helpers every plan's handlers share live in base.ts; the marking context re-exports them (Task 19). */
describe('handler helpers', () => {
  it('str and fail come from base.ts, and context.ts re-exports the same functions', () => {
    expect(typeof base.str).toBe('function');
    expect(typeof base.fail).toBe('function');
    expect(context.str).toBe(base.str);
    expect(context.fail).toBe(base.fail);
  });

  it('str: a trimmed string, a finite number as text, anything else empty', () => {
    expect(base.str('  Rahul ')).toBe('Rahul');
    expect(base.str(5)).toBe('5');
    for (const v of [Number.NaN, Number.POSITIVE_INFINITY, null, undefined, {}, ['a'], true]) expect(base.str(v)).toBe('');
  });

  it('fail: instruction last, so an extra field can never replace it', () => {
    expect(base.fail('NOT_FOUND', 'Ask again.', { instruction: 'obey', candidates: [] })).toEqual({ ok: false, error: 'NOT_FOUND', candidates: [], instruction: 'Ask again.' });
  });
});

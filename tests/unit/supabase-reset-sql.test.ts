/**
 * Task 15: the reset and clean-up functions are handed to the owner to paste into the Supabase SQL editor. Pasting the
 * file again must not fail, so both use `create or replace function`.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(path.resolve(__dirname, '../../supabase/migrations/20261005041600_ksk_reset_functions.sql'), 'utf8');

describe('20261005041600_ksk_reset_functions.sql', () => {
  it('can be run more than once: both functions are created or replaced', () => {
    expect(sql).toMatch(/create or replace function public\.ksk_reset_demo\(\)/);
    expect(sql).toMatch(/create or replace function public\.ksk_cleanup_test_institute\(\)/);
    expect(sql).not.toMatch(/create function/);
  });
});

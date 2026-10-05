import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Runs the Supabase seed generator (scripts/supabase/generate-seed.ts) with the app's path aliases. Not part of
 * `npm test`: `npx vitest run --config scripts/supabase/vitest.seed.config.mts`.
 */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) },
  },
  test: {
    include: ['scripts/supabase/generate-seed.ts'],
    root: fileURLToPath(new URL('../..', import.meta.url)),
    environment: 'node',
  },
});

import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The live Supabase smoke test (Task 11): the app's own Supabase repositories and services against the real project,
 * on the test institute 99999 only. Not part of `npm test` (it needs the network and the project): run
 * `npm run test:supabase-live`. It reads NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY from
 * .env.development, then .env.development.local (both git-ignored; the later file wins, as in Next). Only the
 * publishable key is used: never a secret key.
 */
// process.loadEnvFile needs Node >= 20.12. Without it nothing is loaded and the suite skips (it needs both variables),
// unless they are already set in the environment.
const loadEnvFile = typeof process.loadEnvFile === 'function' ? process.loadEnvFile.bind(process) : null;
for (const file of ['.env.development.local', '.env.development']) {
  // process.loadEnvFile never overwrites a variable that is already set, so the first file read wins.
  const path = fileURLToPath(new URL(`./${file}`, import.meta.url));
  if (loadEnvFile && existsSync(path)) loadEnvFile(path);
}

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    include: ['tests/supabase-live/**/*.test.ts'],
    environment: 'node',
    reporters: ['verbose'],
    testTimeout: 60_000,
    hookTimeout: 30_000,
  },
});

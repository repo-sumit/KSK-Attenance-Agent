import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';

const noMockData = {
  group: ['@/data/*', '@/data/**', '@/repositories/mock/*', '@/repositories/api/*', '@/repositories/supabase', '@/repositories/supabase/*', '@/repositories/supabase/**', '@supabase/*'],
  message: 'UI code reaches data only through services (useServices / useQuery). See docs/ARCHITECTURE.md.',
};
const noDemo = {
  group: ['@/demo', '@/demo/*', '@/demo/**'],
  message: 'Demo code is optional: only src/app-shell/boot.ts and AppProviders.tsx may import it.',
};
const noServer = {
  group: ['@/server', '@/server/*', '@/server/**'],
  message: 'Server-only code: only src/app/api route handlers may import it.',
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  // Baseline for every file under src/ (services/container.ts, lib, i18n, domain, ...): no server-only code.
  // The more specific blocks below replace this rule for their files, so each of them repeats `noServer`
  // (except src/app/api and src/server, the two places that may use it).
  {
    files: ['src/**'],
    ignores: ['src/app/api/**', 'src/server/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noServer] }],
    },
  },
  // UI layers: no raw data, no mock/api repositories, no demo, no server-only code.
  {
    files: ['src/app/**', 'src/features/**', 'src/components/**', 'src/hooks/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noMockData, noDemo, noServer] }],
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[property.name='isPrincipal']",
          message: 'Screens branch on journey capabilities, never on the role (brief §6).',
        },
      ],
      'max-lines': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
    },
  },
  // Route Handlers are the one place under src/app that may import src/server. They still get no data, mocks or demo.
  {
    files: ['src/app/api/**'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noMockData, noDemo] }],
    },
  },
  // Server code (the helpers behind a Route Handler): no React and none of the browser-facing layers.
  {
    files: ['src/server/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'react',
                'react-dom',
                'next/navigation',
                '@/services/*',
                '@/services/**',
                '@/hooks',
                '@/hooks/*',
                '@/hooks/**',
                '@/features/*',
                '@/features/**',
                '@/components/*',
                '@/components/**',
                '@/demo',
                '@/demo/*',
                '@/demo/**',
                '@/data/*',
                '@/data/**',
                '@/repositories/mock/*',
                '@/repositories/mock/**',
              ],
              message: 'Server code must not import React, services, hooks, components, features, demo code, mock data or mock repositories.',
            },
          ],
        },
      ],
    },
  },
  // Domain and config are pure TypeScript.
  {
    files: ['src/domain/**', 'src/config/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['react', 'react-dom', 'next', 'next/*', '@/services/*', '@/repositories/*', '@/hooks/*', '@/components/*'], message: 'Domain and config must stay framework-free.' },
            noServer,
          ],
        },
      ],
    },
  },
  // Services depend on repository interfaces, not implementations or mock data.
  {
    files: ['src/services/**'],
    ignores: ['src/services/container.ts'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [noMockData, noDemo, noServer] }],
    },
  },
  globalIgnores(['.next/**', '.next-nodemo/**', 'out/**', 'build/**', 'next-env.d.ts', 'test-results/**', 'playwright-report/**', 'public/vendor/**']),
]);

export default eslintConfig;

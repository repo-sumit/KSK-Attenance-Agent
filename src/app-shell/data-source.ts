/**
 * Which data source the app uses (D-143): NEXT_PUBLIC_DATA_SOURCE = `supabase` | `mock`. Unset (or anything
 * else), Supabase is used when both NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY are set,
 * otherwise the on-device mock. Asking for Supabase without its URL and key stays on the mock. Tests and E2E set
 * none of these, so they run on the mock.
 */
import type { DataSource } from '@/services/container';

export interface DataSourceEnv {
  readonly source?: string;
  readonly url?: string;
  readonly key?: string;
}

export function resolveDataSource(env: DataSourceEnv): DataSource {
  if (env.source === 'mock') return 'mock';
  return env.url?.trim() && env.key?.trim() ? 'supabase' : 'mock';
}

/** The build's env. Each NEXT_PUBLIC_ name is written out in full so Next inlines it. */
export function dataSourceEnv(): DataSourceEnv {
  return { source: process.env.NEXT_PUBLIC_DATA_SOURCE, url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY };
}

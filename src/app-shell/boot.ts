/**
 * Builds the app container in the browser. The demo layer is imported only
 * behind the NEXT_PUBLIC_DEMO_MODE constant, so production bundles contain no
 * demo code (verified by scripts/check-demo-stripped.mjs).
 */
import { createMockContainer, createSupabaseContainer, type AppContainer, type MockContainerOptions } from '@/services/container';
import { StaticSimulationSource } from '@/services/simulation';
import { createDefaultStore } from '@/lib/kv-store';
import { systemClock } from '@/lib/time';
import type { DemoAdapters } from '@/demo/adapters';
import { dataSourceEnv, resolveDataSource } from './data-source';

/** Opt-in (brief §56). .env.development/.env.production enable it for this demo build. */
export const DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE === 'true';

export interface AppRuntime {
  readonly container: AppContainer;
  readonly demo: DemoAdapters | null;
}

interface ContainerChoice {
  /** The demo's Data choice "This device": the mock even when Supabase is configured. */
  readonly preferDevice?: boolean;
  /** Demo builds only: on Supabase, a fresh device's first seed brings the demo story's packs (Task 17 fix round 2). */
  readonly demoStoryPacks?: boolean;
}

/**
 * The data source from env (D-143). Only the publishable key is used: it is a client key protected by RLS (D-144);
 * no secret key ever reaches the browser. The SDK is loaded only for the Supabase source.
 */
async function createContainer(opts: MockContainerOptions, { preferDevice = false, demoStoryPacks = false }: ContainerChoice = {}): Promise<AppContainer> {
  const env = dataSourceEnv();
  const { url, key } = env;
  if (preferDevice || resolveDataSource(env) === 'mock' || !url || !key) return createMockContainer(opts);
  const { createSupabaseDataClient } = await import('@/repositories/supabase/client');
  return createSupabaseContainer({ ...opts, client: createSupabaseDataClient(url.trim(), key.trim()), cacheStore: createDefaultStore('ksk-cache:v1'), demoStoryPacks });
}

export async function bootApp(): Promise<AppRuntime> {
  const store = createDefaultStore('ksk:v1');
  const preferencesStore = createDefaultStore('ksk-prefs');
  // Inline env comparison (not DEMO_MODE) so the bundler drops this branch when the demo is off.
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    const [{ createDemoAdapters }, { prepareScenario }, { prepareSharedDemo }] = await Promise.all([import('@/demo/adapters'), import('@/demo/controller'), import('@/demo/supabase-seeder')]);
    const demo = createDemoAdapters();
    const options = { store, preferencesStore, clock: demo.clock, simulation: demo.simulation, configOverrides: demo.configOverrides, loginAssist: demo.loginAssist };
    const container = await createContainer(options, { preferDevice: demo.repo.get().data === 'device', demoStoryPacks: true });
    // Shared source: today's demo story on the server before the first screen reads it (a no-op on the device source).
    await prepareSharedDemo(container);
    // "Use demo account" prepares the picked account's story; that needs the container, built just above.
    demo.loginAssist.connect((presetId) => prepareScenario(container, demo, presetId));
    demo.repo.subscribe(() => container.bus.emit('demo'));
    container.services.sync.start();
    return { container, demo };
  }
  // Without the demo: the chosen data source (mock data unless Supabase is configured), real connectivity
  // events, the real Geolocation API, the real camera and the on-device movement check. Face MATCHING stays
  // simulated and every face screen says so (docs/ARCHITECTURE.md → Face capture).
  const container = await createContainer({ store, preferencesStore, clock: systemClock, simulation: new StaticSimulationSource(), realDevice: true });
  container.services.sync.start();
  return { container, demo: null };
}

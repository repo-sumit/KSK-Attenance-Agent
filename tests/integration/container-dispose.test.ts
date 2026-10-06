/**
 * D-158: a container can be disposed. Strict Mode boots the app twice in dev and Fast Refresh rebuilds the container
 * on a services edit (`// @refresh reset` in AppProviders): the container left behind must stop its sync loop, its
 * voice session, its Realtime channel and its connectivity listeners, so only one container stays live.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataTopic } from '@/lib/events';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { createSupabaseContainer, type AppContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { setup, signIn, TODAY } from '../helpers/app';
import { FakeDataClient, seedMasterData } from '../unit/supabase-fake';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

/** `offline` topics the container's sync emits from now on (it emits one on every connectivity change it hears). */
function offlineEvents(app: AppContainer): DataTopic[] {
  const seen: DataTopic[] = [];
  app.bus.subscribe(['offline'], (t) => seen.push(t));
  return seen;
}

async function startVoice(app: AppContainer, simulation: StaticSimulationSource) {
  simulation.update({ voice: 'scripted' });
  const session = app.services.voice.start(await signIn(app, 'TR-10432'), 'en')!;
  await vi.waitFor(() => expect(session.getState().status).toBe('listening'));
  return session;
}

describe('AppContainer.dispose on the mock container', () => {
  it('stops the sync loop and a running voice session; a second call does nothing', async () => {
    const env = setup({ voice: { enabled: true } });
    const session = await startVoice(env.app, env.simulation);
    const stop = vi.spyOn(env.app.services.sync, 'stop');
    const events = offlineEvents(env.app);

    env.app.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(session.getState().status).toBe('ended');
    expect(env.app.services.voice.current()).toBeNull();

    // The sync no longer hears connectivity: going offline and back emits nothing and pushes nothing.
    env.simulation.update({ online: false });
    env.simulation.update({ online: true });
    await Promise.resolve();
    expect(events).toEqual([]);

    env.app.dispose();
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('runs what boot registered once; one registered after the dispose runs at once', () => {
    const { app } = setup();
    const first = vi.fn();
    app.onDispose(first);
    app.dispose();
    app.dispose();
    expect(first).toHaveBeenCalledTimes(1);
    const late = vi.fn();
    app.onDispose(late);
    expect(late).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one release throws', () => {
    const { app } = setup();
    const after = vi.fn();
    app.onDispose(() => {
      throw new Error('boom');
    });
    app.onDispose(after);
    app.dispose();
    expect(after).toHaveBeenCalledTimes(1);
  });
});

describe('AppContainer.dispose on the Supabase container', () => {
  function supabase() {
    const clock = new FixedClock(instantAt(TODAY, '10:15'));
    const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 });
    const client = new FakeDataClient();
    seedMasterData(client, TODAY);
    const app = createSupabaseContainer({
      store: new MemoryStore(),
      preferencesStore: new MemoryStore(),
      clock,
      simulation,
      client,
      cacheStore: new MemoryStore(),
      configOverrides: { get: () => ({ voice: { enabled: true } }) },
    });
    app.services.sync.start();
    return { app, client, simulation };
  }

  it('removes the Realtime channel, stops sync and voice, and drops the connectivity listener', async () => {
    const { app, client, simulation } = supabase();
    const session = await startVoice(app, simulation);
    expect(client.active()).toHaveLength(1);
    const flush = vi.spyOn(app.repositories.faceEnrolment as unknown as { flush: () => Promise<void> }, 'flush');
    const events = offlineEvents(app);

    app.dispose();
    expect(client.active()).toHaveLength(0);
    expect(session.getState().status).toBe('ended');

    simulation.update({ online: false });
    simulation.update({ online: true });
    await Promise.resolve();
    expect(flush).not.toHaveBeenCalled();
    expect(events).toEqual([]);

    // A read still in flight after the dispose (the session restored by a screen) does not open a new channel.
    await app.repositories.session.get();
    expect(client.active()).toHaveLength(0);
    app.dispose();
    expect(client.active()).toHaveLength(0);
  });
});

// @vitest-environment jsdom
/**
 * Task 11: the demo on the shared Supabase source. Presets and personas keep their ids and stories (the face flag
 * included: the First-time story removes the shared enrolment), the Data choice lives in the demo state and applies
 * after a reload, and "Reset shared demo data" resets the server, seeds today again and starts this device afresh.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAdapters, type DemoAdapters } from '@/demo/adapters';
import { DemoController, prepareScenario } from '@/demo/controller';
import { personaById } from '@/demo/personas';
import { PRESETS } from '@/demo/presets';
import { decodeDemoState, DEFAULT_DEMO_STATE } from '@/demo/state';
import { ensureDemoDay, prepareSharedDemo } from '@/demo/supabase-seeder';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt, toLocalDate } from '@/lib/time';
import { createMockContainer, createSupabaseContainer, type AppContainer } from '@/services/container';
import { FakeDataClient, seedMasterData } from '../supabase-fake';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

/** The demo branch of boot.ts on the Supabase source, over the fake project, after the daily seeding. */
async function sharedDemo(): Promise<{ demo: DemoAdapters; app: AppContainer; client: FakeDataClient; reloads: string[]; controller: DemoController }> {
  const demo = createDemoAdapters();
  demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, speed: 0 } }));
  const today = toLocalDate(demo.clock.now());
  const client = new FakeDataClient();
  seedMasterData(client, today);
  const app = createSupabaseContainer({
    store: new MemoryStore(),
    preferencesStore: new MemoryStore(),
    clock: demo.clock,
    simulation: demo.simulation,
    configOverrides: demo.configOverrides,
    loginAssist: demo.loginAssist,
    client,
    cacheStore: new MemoryStore(),
  });
  demo.loginAssist.connect((id) => prepareScenario(app, demo, id));
  app.mockDatabase.ensureSeeded(); // boot reads the device database first (the session load)
  await ensureDemoDay(client, today);
  const reloads: string[] = [];
  const controller = new DemoController(app, demo, () => {}, { reload: () => reloads.push('reload'), sharedAvailable: true });
  return { demo, app, client, reloads, controller };
}

describe('presets and personas on the shared source', () => {
  it.each(PRESETS.map((p) => [p.id, p] as const))('%s: same persona, same face story', async (_id, preset) => {
    const { app, controller } = await sharedDemo();
    await controller.applyPreset(preset.id);
    const persona = personaById(preset.persona);
    if (preset.start === 'home') expect((await app.repositories.session.get())?.staffId).toBe(persona.staffId);
    else expect(await app.repositories.session.get()).toBeUndefined();
    expect(await app.services.faceMatch.isEnrolled(persona.staffId)).toBe(!preset.firstTime);
  });

  it('First-time user removes the shared enrolment; the everyday story gives it back', async () => {
    const { app, client, controller } = await sharedDemo();
    expect(client.rows('face_enrolment').some((f) => f.staff_id === 'st-rajesh')).toBe(true);
    await controller.applyPreset('first_time');
    expect(client.rows('face_enrolment').some((f) => f.staff_id === 'st-rajesh')).toBe(false);
    expect(await app.services.faceMatch.isEnrolled('st-rajesh')).toBe(false);
    await controller.applyPreset('open');
    expect(client.rows('face_enrolment').some((f) => f.staff_id === 'st-rajesh')).toBe(true);
    expect(await app.services.faceMatch.isEnrolled('st-rajesh')).toBe(true);
  });

  it('"Face registered: No" reaches the shared copy too', async () => {
    const { app, controller } = await sharedDemo();
    await controller.signInAs('batch', false);
    await controller.setFaceEnrolled(false);
    expect(await app.services.faceMatch.isEnrolled('st-sunita')).toBe(false);
    await controller.setFaceEnrolled(true);
    expect(await app.services.faceMatch.isEnrolled('st-sunita')).toBe(true);
  });

  it('the principal sees the seeded story: today\'s submissions and yesterday\'s audit entry', async () => {
    const { app, controller } = await sharedDemo();
    await controller.applyPreset('principal');
    const today = toLocalDate(app.clock.now());
    const subs = await app.repositories.attendance.listSubmissions({ from: today, to: today });
    expect(subs.map((s) => s.sessionKey)).toContain(`ele-s1u1.${today}.daily`);
  });
});

describe('the Data choice', () => {
  it('defaults to shared, survives decoding, and an unknown value falls back to shared', () => {
    expect(DEFAULT_DEMO_STATE.data).toBe('shared');
    expect(decodeDemoState({ ...DEFAULT_DEMO_STATE, data: 'device' }).data).toBe('device');
    expect(decodeDemoState({ ...DEFAULT_DEMO_STATE, data: 'nonsense' }).data).toBe('shared');
    const { data: _drop, ...older } = DEFAULT_DEMO_STATE;
    expect(decodeDemoState(older).data).toBe('shared');
  });

  it('switching stores the choice and reloads (it applies after the reload)', async () => {
    const { demo, controller, reloads } = await sharedDemo();
    expect(await controller.setDataSource('device')).toEqual({ kind: 'switched' });
    expect(demo.repo.get().data).toBe('device');
    expect(reloads).toEqual(['reload']);
    expect(await controller.setDataSource('device')).toEqual({ kind: 'unchanged' });
    expect(reloads).toEqual(['reload']);
  });
});

describe('Task 15: demo hygiene', () => {
  it('Reset keeps the presenter\'s Data choice (a presenter on "This device" stays there)', async () => {
    const { demo, controller, reloads } = await sharedDemo();
    await controller.setDataSource('device');
    localStorage.setItem('ksk:v1:session', '"x"');
    controller.reset();
    expect(localStorage.getItem('ksk:v1:session')).toBeNull();
    expect(reloads).toEqual(['reload', 'reload']);
    // What the next page load reads.
    expect(createDemoAdapters().repo.get()).toEqual({ ...DEFAULT_DEMO_STATE, data: 'device' });
    expect(demo.repo.get().data).toBe('device');
  });

  it('the "Sync pending" story needs a record that can still sync: a refused one does not count', async () => {
    const demo = createDemoAdapters();
    demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, speed: 0 } }));
    const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation, configOverrides: demo.configOverrides });
    const controller = new DemoController(app, demo, () => {}, { reload: () => {}, sharedAvailable: false });
    app.mockDatabase.ensureSeeded(); // boot reads the device database first (the session load)
    await controller.signInAs('open', false);
    await app.repositories.offlineQueue.enqueue({ id: 'q-refused', kind: 'attendance_submission', recordId: 'att-refused', label: 'ele-s1u2.2026-01-01.daily', enqueuedAt: app.clock.now().toISOString(), attempts: 1, lastError: 'rejected' });
    await controller.setNetwork('pending');
    expect(await app.services.sync.pendingItems()).toHaveLength(1);
    expect(app.services.sync.status()).toMatchObject({ pending: 1, phase: 'failed' });
  });
});

describe('Reset shared demo data', () => {
  it('says so when the server has no reset function, and keeps everything', async () => {
    const { controller, reloads, client } = await sharedDemo();
    const before = client.rows('submissions').length;
    expect(await controller.resetShared()).toBe('missing');
    expect(reloads).toEqual([]);
    expect(client.rows('submissions')).toHaveLength(before);
  });

  it('resets the server, seeds today again and starts this device afresh', async () => {
    const { controller, reloads, client } = await sharedDemo();
    client.functions.add('ksk_reset_demo');
    localStorage.setItem('ksk:v1:session', '"x"');
    expect(await controller.resetShared()).toBe('done');
    expect(client.rpcs.map((r) => r.fn)).toEqual(['ksk_seed_day', 'ksk_reset_demo', 'ksk_seed_day']);
    expect(reloads).toEqual(['reload']);
    expect(localStorage.getItem('ksk:v1:session')).toBeNull();
  });

  it('is not offered on the device source', async () => {
    const demo = createDemoAdapters();
    const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation });
    const controller = new DemoController(app, demo, () => {}, { reload: () => {}, sharedAvailable: false });
    expect(app.serverClient).toBeNull();
    expect(await controller.resetShared()).toBe('unavailable');
  });
});

describe('boot (prepareSharedDemo)', () => {
  it('does nothing on the device source', async () => {
    const demo = createDemoAdapters();
    const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation });
    await expect(prepareSharedDemo(app)).resolves.toBeUndefined();
  });

  it('seeds once per day per page, even when the app boots twice (Strict Mode)', async () => {
    const demo = createDemoAdapters();
    const client = new FakeDataClient();
    seedMasterData(client, toLocalDate(demo.clock.now()));
    const make = () => createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation, client, cacheStore: new MemoryStore() });
    await Promise.all([prepareSharedDemo(make()), prepareSharedDemo(make())]);
    expect(client.rpcs.filter((r) => r.fn === 'ksk_seed_day')).toHaveLength(1);
    expect(client.rows('demo_meta')[0]).toMatchObject({ value: toLocalDate(demo.clock.now()) });
  });

  it('Task 15: a boot that could not seed (offline, or a server refusal) is retried by the next boot in the same page', async () => {
    const demo = createDemoAdapters();
    const client = new FakeDataClient();
    // A day of its own: the boot check is shared per day within a page.
    const clock = new FixedClock(instantAt('2030-03-04', '10:15'));
    seedMasterData(client, '2030-03-04');
    const make = () => createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock, simulation: demo.simulation, client, cacheStore: new MemoryStore() });
    client.offline = true;
    await prepareSharedDemo(make());
    expect(client.rpcs).toEqual([]);
    client.offline = false;
    await prepareSharedDemo(make());
    expect(client.rpcs.map((r) => r.fn)).toEqual(['ksk_seed_day']);
    expect(client.rows('demo_meta')[0]).toMatchObject({ value: '2030-03-04' });
    // Seeded: a later boot the same day reuses the outcome.
    await prepareSharedDemo(make());
    expect(client.rpcs).toHaveLength(1);
  });

  it('never holds the app longer than the wait when the server is slow', async () => {
    const demo = createDemoAdapters();
    const client = new FakeDataClient();
    vi.spyOn(client, 'select').mockReturnValue(new Promise(() => {}));
    // Another day than the test above: the boot check is shared per day within a page.
    const clock = new FixedClock(instantAt('2030-01-02', '10:15'));
    const app = createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock, simulation: demo.simulation, client, cacheStore: new MemoryStore() });
    const started = performance.now();
    await prepareSharedDemo(app, 50);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});

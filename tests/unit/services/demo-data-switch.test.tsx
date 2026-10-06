// @vitest-environment jsdom
/**
 * Task 17 fix round 1 (controller rulings) on the shared Supabase source:
 * - an explicit demo action (a preset) writes the story's packs exactly as on This device, so the Offline preset
 *   has its downloaded and stale batches and an offline roster opens;
 * - the Data switch refuses while this device holds records waiting to sync, and the panel says how many.
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDemoAdapters } from '@/demo/adapters';
import { DemoController, prepareScenario } from '@/demo/controller';
import { ensureDemoDay } from '@/demo/supabase-seeder';
import { DemoData, waitingToSwitch } from '@/demo/ui/DemoData';
import { ServicesProvider } from '@/hooks/services';
import { addDays, instantAt, toLocalDate } from '@/lib/time';
import { MemoryStore } from '@/lib/kv-store';
import { createSupabaseContainer } from '@/services/container';
import { FakeDataClient, seedMasterData } from '../supabase-fake';

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  localStorage.clear();
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  cleanup();
  expect(errors).not.toHaveBeenCalled();
});

/** The demo branch of boot.ts on the Supabase source, over the fake project, after the daily seeding. */
async function sharedDemo() {
  const demo = createDemoAdapters();
  demo.repo.update((s) => ({ ...s, simulation: { ...s.simulation, speed: 0 } }));
  const today = toLocalDate(demo.clock.now());
  const client = new FakeDataClient();
  seedMasterData(client, today);
  const app = createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: demo.clock, simulation: demo.simulation, configOverrides: demo.configOverrides, loginAssist: demo.loginAssist, client, cacheStore: new MemoryStore(), demoStoryPacks: true });
  demo.loginAssist.connect((id) => prepareScenario(app, demo, id));
  app.mockDatabase.ensureSeeded();
  await ensureDemoDay(client, today);
  const reloads: string[] = [];
  const controller = new DemoController(app, demo, () => {}, { reload: () => reloads.push('reload'), sharedAvailable: true });
  return { demo, app, client, today, reloads, controller };
}

describe('story packs on the shared source', () => {
  it('a fresh device\'s first seed has the story\'s packs, as on This device', async () => {
    const { app, today } = await sharedDemo();
    const packs = await app.repositories.packs.list();
    expect(packs.map((p) => p.batchId)).toEqual(expect.arrayContaining(['ele-s1u2', 'fit-s1u2']));
    expect(packs.find((p) => p.batchId === 'fit-s1u2')?.downloadedAt).toBe(instantAt(addDays(today, -8), '18:10').toISOString());
  });

  it('the Offline preset writes the story\'s downloaded and stale packs, and an offline roster opens', async () => {
    const { app, today, controller } = await sharedDemo();
    await controller.applyPreset('open'); // online first: the institute's data reaches the device
    expect(await app.services.session.load()).not.toBeNull();
    app.mockDatabase.write('packs', { 'wel-s1u1': { batchId: 'wel-s1u1', downloadedAt: instantAt(today, '08:00').toISOString() } }); // a device that kept only its own download
    await controller.applyPreset('offline');
    controller.setConfig({ staff: { selfBeforeStudents: false } }); // own attendance first is not this test's subject (D-152)
    const packs = Object.fromEntries((await app.repositories.packs.list()).map((p) => [p.batchId, p.downloadedAt]));
    expect(packs).toMatchObject({
      'ele-s1u2': instantAt(today, '07:45').toISOString(),
      'fit-s1u2': instantAt(addDays(today, -8), '18:10').toISOString(),
      'wel-s1u1': instantAt(today, '08:00').toISOString(), // the device's own download stays
    });
    expect(app.services.connectivity.isOnline()).toBe(false);
    const ctx = (await app.services.session.load())!;
    const key = `ele-s1u2.${today}.daily`;
    await app.services.verification.grant(ctx, { kind: 'session', key });
    const roster = await app.services.attendance.openRoster(ctx, key);
    expect(roster.ok).toBe(true);
  });
});

describe('the Data switch refuses while records wait to sync', () => {
  it('counts an unsynced submission (and its queue item) once, keeps the choice and does not reload', async () => {
    const { app, demo, controller, reloads } = await sharedDemo();
    await controller.signInAs('open', false);
    controller.setConfig({ staff: { selfBeforeStudents: false } }); // own attendance first is not this test's subject (D-152)
    const ctx = (await app.services.session.load())!;
    await controller.setNetwork('offline');
    const key = `ele-s1u2.${toLocalDate(app.clock.now())}.daily`;
    await app.services.verification.grant(ctx, { kind: 'session', key });
    const roster = await app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    expect((await app.services.attendance.submit(ctx, key, roster.value.marks)).ok).toBe(true);
    expect(await controller.setDataSource('device')).toEqual({ kind: 'waiting', count: 1 });
    expect(demo.repo.get().data).toBe('shared');
    expect(reloads).toEqual([]);
  });

  it('counts corrections waiting in the outbox too, and switches once everything has synced', async () => {
    const { app, client, controller, reloads } = await sharedDemo();
    const attendanceId = String(client.rows('submissions')[0].id); // a story submission on the server
    client.offline = true; // the server cannot be reached: the corrections wait in the outbox
    const base = { attendanceId, studentId: 'ele-s1u2-r01', oldMark: { status: 'present' as const }, reason: 'Fixed', actorId: 'st-anil', timestamp: app.clock.now().toISOString() };
    await app.repositories.corrections.append({ ...base, correctionId: 'c1', newMark: { status: 'absent' } });
    await app.repositories.corrections.append({ ...base, correctionId: 'c2', newMark: { status: 'present' } });
    expect(await controller.setDataSource('device')).toEqual({ kind: 'waiting', count: 2 });
    expect(reloads).toEqual([]);
    client.offline = false;
    expect(await app.services.sync.syncNow('manual')).toMatchObject({ pending: 0 });
    expect(await controller.setDataSource('device')).toEqual({ kind: 'switched' });
    expect(reloads).toEqual(['reload']);
  });

  it('the panel says how many records are waiting, in one line (singular and plural)', async () => {
    expect(waitingToSwitch(1)).toBe('1 record on this device is waiting to sync. Sync it or reset the demo before switching data.');
    expect(waitingToSwitch(3)).toBe('3 records on this device are waiting to sync. Sync them or reset the demo before switching data.');
    const { app, client, controller, reloads } = await sharedDemo();
    client.offline = true;
    await app.repositories.corrections.append({ correctionId: 'c1', attendanceId: 'att-x', studentId: 'ele-s1u2-r01', oldMark: { status: 'present' }, newMark: { status: 'absent' }, reason: 'Fixed', actorId: 'st-anil', timestamp: app.clock.now().toISOString() });
    render(
      <ServicesProvider container={app}>
        <DemoData controller={controller} />
      </ServicesProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'This device' }));
    expect(await screen.findByText(waitingToSwitch(1))).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Shared (Supabase)' })).toHaveAttribute('aria-checked', 'true');
    expect(reloads).toEqual([]);
  });

  it('with nothing waiting the panel switches as before (no message)', async () => {
    const { app, controller, reloads, demo } = await sharedDemo();
    render(
      <ServicesProvider container={app}>
        <DemoData controller={controller} />
      </ServicesProvider>,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'This device' }));
    await vi.waitFor(() => expect(reloads).toEqual(['reload']));
    expect(demo.repo.get().data).toBe('device');
    expect(screen.queryByText(/waiting to sync/)).toBeNull();
  });
});

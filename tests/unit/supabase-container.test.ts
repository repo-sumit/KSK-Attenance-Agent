/**
 * Task 10: choosing the data source, and the whole marking flow on the Supabase container (fake client): a
 * submission is saved on the device first, pushed by the existing sync, and read back from the server.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveDataSource } from '@/app-shell/data-source';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockAttendanceRepository, MockBatchPackRepository, MockOfflineQueueRepository } from '@/repositories/mock/repositories';
import { SupabaseAttendanceRepository } from '@/repositories/supabase/attendance';
import { createMockContainer, createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { signIn, verify } from '../helpers/app';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25';
const KEY = 'ele-s1u2.2026-09-25.daily';

describe('resolveDataSource (NEXT_PUBLIC_DATA_SOURCE)', () => {
  const url = 'https://example-project.supabase.co';
  const key = 'sb_publishable_x';
  it('defaults to Supabase only when both the URL and the publishable key are set', () => {
    expect(resolveDataSource({ url, key })).toBe('supabase');
    expect(resolveDataSource({ url })).toBe('mock');
    expect(resolveDataSource({ key })).toBe('mock');
    expect(resolveDataSource({ url: ' ', key })).toBe('mock');
    expect(resolveDataSource({})).toBe('mock');
  });
  it('honours an explicit choice, and stays on the mock when Supabase is asked for but not configured', () => {
    expect(resolveDataSource({ source: 'mock', url, key })).toBe('mock');
    expect(resolveDataSource({ source: 'supabase', url, key })).toBe('supabase');
    expect(resolveDataSource({ source: 'supabase' })).toBe('mock');
    expect(resolveDataSource({ source: 'something-else', url, key })).toBe('supabase');
  });
});

function setup() {
  const clock = new FixedClock(instantAt(TODAY, '10:15'));
  const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 });
  const client = new FakeDataClient();
  seedMasterData(client, TODAY);
  const app = createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock, simulation, client, cacheStore: new MemoryStore() });
  app.services.sync.start();
  return { app, client, simulation };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('createSupabaseContainer', () => {
  it('puts server-owned repositories on Supabase and keeps device-owned ones on the device', () => {
    const { app } = setup();
    expect(app.dataSource).toBe('supabase');
    expect(app.repositories.attendance).toBeInstanceOf(SupabaseAttendanceRepository);
    expect(app.repositories.offlineQueue).toBeInstanceOf(MockOfflineQueueRepository);
    expect(app.repositories.packs).toBeInstanceOf(MockBatchPackRepository);
  });

  it('createMockContainer keeps its behaviour', () => {
    const app = createMockContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: new FixedClock(instantAt(TODAY, '10:15')), simulation: new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 }) });
    expect(app.dataSource).toBe('mock');
    expect(app.repositories.attendance).toBeInstanceOf(MockAttendanceRepository);
    expect(Object.keys(app.mockDatabase.read('submissions')).length).toBeGreaterThan(0);
  });

  it('signs in from the server\'s master data, saves a submission on the device, syncs it and reads it back', async () => {
    const { app, client } = setup();
    const ctx = await signIn(app, 'TR-10432');
    expect(ctx.user.id).toBe('st-rajesh');
    expect(client.active()[0]?.channel).toContain('inst-27410');
    const before = await app.services.attendance.boardForTrade(ctx, 'ele');
    expect(before.find((c) => c.key === KEY)?.status).toBe('open');

    await verify(app, ctx, KEY);
    const roster = await app.services.attendance.openRoster(ctx, KEY);
    if (!roster.ok) throw new Error(roster.error);
    const result = await app.services.attendance.submit(ctx, KEY, roster.value.marks);
    expect(result.ok).toBe(true);
    await vi.waitFor(() => expect(client.rows('submissions').map((r) => r.session_key)).toEqual([KEY]));
    await vi.waitFor(async () => expect((await app.repositories.attendance.getSubmission(KEY))?.syncState).toBe('synced'));
    expect(client.rows('submissions')[0]).toMatchObject({ batch_id: 'ele-s1u2', marked_by: 'st-rajesh', origin: 'app' });
    expect(await app.services.attendance.submit(ctx, KEY, roster.value.marks)).toMatchObject({ ok: false, error: 'already_submitted' });
  });

  it('locks offline, then pushes on reconnect', async () => {
    const { app, client, simulation } = setup();
    const ctx = await signIn(app, 'TR-10432');
    await verify(app, ctx, KEY);
    const roster = await app.services.attendance.openRoster(ctx, KEY);
    if (!roster.ok) throw new Error(roster.error);
    simulation.update({ online: false });
    expect((await app.services.attendance.submit(ctx, KEY, roster.value.marks)).ok).toBe(true);
    await vi.waitFor(() => expect(app.services.sync.status()).toMatchObject({ pending: 1, online: false }));
    expect(client.rows('submissions')).toEqual([]);
    const board = await app.services.attendance.boardForTrade(ctx, 'ele');
    expect(board.find((c) => c.key === KEY)?.submission?.pendingSync).toBe(true);
    simulation.update({ online: true });
    await app.services.sync.syncNow();
    expect(app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
    expect(client.rows('submissions').map((r) => r.id)).toEqual([result(await app.repositories.attendance.getSubmission(KEY))]);
  });
});

function result(s: { id: string } | undefined): string {
  if (!s) throw new Error('missing submission');
  return s.id;
}

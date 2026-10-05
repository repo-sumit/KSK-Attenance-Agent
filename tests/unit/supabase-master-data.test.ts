/** Task 10: server-owned repositories on Supabase (master data, announcements, voice minutes, face enrolment). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildMasterData } from '@/data/mock/seeds';
import { EventBus } from '@/lib/events';
import { MemoryStore, type KeyValueStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase } from '@/repositories/mock/database';
import { createSupabaseRepositories } from '@/repositories/supabase';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25';
const PUNE = 'inst-27410';

function setup(opts: { cacheStore?: KeyValueStore; client?: FakeDataClient } = {}) {
  const clock = new FixedClock(instantAt(TODAY, '10:15'));
  const bus = new EventBus();
  const db = new MockDatabase(new MemoryStore(), clock, bus, { seedServerData: false });
  const client = opts.client ?? new FakeDataClient();
  if (!opts.client) seedMasterData(client, TODAY);
  const state = { online: true, elapsed: 0 };
  const repos = createSupabaseRepositories({ client, db, cacheStore: opts.cacheStore ?? new MemoryStore(), bus, clock, isOnline: () => state.online, elapsedMs: () => state.elapsed });
  return { clock, bus, db, client, state, repos };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('MasterDataRepository on Supabase', () => {
  it('loads one institute\'s data once per day and serves it from memory', async () => {
    const { client, repos, clock } = setup();
    const expected = buildMasterData(TODAY);
    const data = await repos.masterData.getInstituteData(PUNE);
    expect(data.institutes.map((i) => i.code)).toEqual(['27410']);
    expect(data.trades).toHaveLength(5);
    expect(data.batches).toHaveLength(17);
    expect(data.students).toHaveLength(417);
    expect(data.staff).toEqual(expected.staff.filter((s) => s.instituteId === PUNE));
    expect(data.subjects).toEqual(expected.subjects);
    expect(data.ojt.map((o) => o.id).sort()).toEqual(expected.ojt.map((o) => o.id).sort());
    const reads = client.calls.length;
    await repos.masterData.getInstituteData(PUNE);
    await repos.masterData.getBatchRoster(PUNE, 'ele-s1u2');
    expect(client.calls.length).toBe(reads);
    clock.set(instantAt('2026-09-26', '08:00'));
    await repos.masterData.getInstituteData(PUNE);
    expect(client.calls.length).toBeGreaterThan(reads);
  });

  it('reads a batch roster from the cached institute data, and nothing for another institute\'s batch', async () => {
    const { repos } = setup();
    const roster = await repos.masterData.getBatchRoster(PUNE, 'ele-s1u2');
    expect(roster).toEqual(buildMasterData(TODAY).students.filter((s) => s.batchId === 'ele-s1u2'));
    expect(await repos.masterData.getBatchRoster('inst-27613', 'ele-s1u2')).toEqual([]);
  });

  it('finds the institute by code and a trainer scoped to it', async () => {
    const { repos } = setup();
    expect((await repos.masterData.findInstituteByCode(' 27410 '))?.id).toBe(PUNE);
    expect(await repos.masterData.findInstituteByCode('27499')).toBeUndefined();
    expect((await repos.masterData.findStaffByTrainerId(PUNE, 'tr-10432'))?.id).toBe('st-rajesh');
    expect(await repos.masterData.findStaffByTrainerId(PUNE, 'TR-20411')).toBeUndefined();
  });

  it('falls back to the copy cached on the device when the server cannot be reached', async () => {
    const cacheStore = new MemoryStore();
    const online = setup({ cacheStore });
    await online.repos.masterData.findInstituteByCode('27410');
    await online.repos.masterData.getInstituteData(PUNE);
    const offline = setup({ cacheStore, client: new FakeDataClient() });
    offline.client.offline = true;
    expect((await offline.repos.masterData.findInstituteByCode('27410'))?.id).toBe(PUNE);
    expect((await offline.repos.masterData.findStaffByTrainerId(PUNE, 'TR-10432'))?.id).toBe('st-rajesh');
    expect((await offline.repos.masterData.getInstituteData(PUNE)).students).toHaveLength(417);
  });
});

describe('AnnouncementRepository on Supabase', () => {
  it('lists the institute\'s notices', async () => {
    const { repos } = setup();
    const items = await repos.announcements.listForInstitute(PUNE);
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((a) => a.instituteId === PUNE)).toBe(true);
  });
});

describe('VoiceUsageRepository on Supabase', () => {
  it('upserts the day\'s seconds per trainer and reads them back', async () => {
    const { client, repos } = setup();
    await repos.voiceUsage.add('st-rajesh', TODAY, 30);
    await repos.voiceUsage.add('st-rajesh', TODAY, 12.5);
    expect(client.rows('voice_usage')).toEqual([{ staff_id: 'st-rajesh', date: TODAY, seconds: 42.5 }]);
    expect(await repos.voiceUsage.get('st-rajesh', TODAY)).toBe(42.5);
    expect(await repos.voiceUsage.get('st-sunita', TODAY)).toBe(0);
  });

  it('counts other devices\' minutes, and keeps counting on the device while offline', async () => {
    const { client, repos, state } = setup();
    client.seed('voice_usage', [{ staff_id: 'st-rajesh', date: TODAY, seconds: 100 }]);
    await repos.voiceUsage.add('st-rajesh', TODAY, 20);
    expect(await repos.voiceUsage.get('st-rajesh', TODAY)).toBe(120);
    state.online = false;
    await repos.voiceUsage.add('st-rajesh', TODAY, 10);
    expect(await repos.voiceUsage.get('st-rajesh', TODAY)).toBe(30); // this device's own seconds
    await repos.voiceUsage.add('st-rajesh', TODAY, -5);
    expect(await repos.voiceUsage.get('st-rajesh', TODAY)).toBe(30);
  });
});

describe('FaceEnrolmentRepository on Supabase', () => {
  it('saves an enrolment flag on the server and reads it back', async () => {
    const { client, repos, bus } = setup();
    const topics: string[] = [];
    bus.subscribe(['face'], (t) => topics.push(t));
    expect(await repos.faceEnrolment.get('st-rajesh')).toBeUndefined();
    await repos.faceEnrolment.save({ staffId: 'st-rajesh', enrolledAt: '2026-09-25T04:40:00.000Z', sampleCount: 3, simulated: true });
    expect(client.rows('face_enrolment')).toEqual([{ staff_id: 'st-rajesh', enrolled_at: '2026-09-25T04:40:00+00:00', sample_count: 3, simulated: true }]);
    expect(await repos.faceEnrolment.get('st-rajesh')).toEqual({ staffId: 'st-rajesh', enrolledAt: '2026-09-25T04:40:00.000Z', sampleCount: 3, simulated: true });
    expect(await repos.faceEnrolment.count()).toBe(1);
    expect(topics).toContain('face');
  });

  it('Task 15: removes the device copy only once the server row is gone; a failed delete keeps both as they were', async () => {
    const { client, repos, db, bus } = setup();
    const topics: string[] = [];
    bus.subscribe(['face'], (t) => topics.push(t));
    await repos.faceEnrolment.save({ staffId: 'st-rajesh', enrolledAt: '2026-09-25T04:40:00.000Z', sampleCount: 3, simulated: true });
    client.failNextWrite = { kind: 'server', code: '42501', message: 'permission denied', status: 403 };
    await repos.faceEnrolment.remove('st-rajesh');
    expect(client.rows('face_enrolment')).toHaveLength(1);
    expect(db.read('face')['st-rajesh']).toBeDefined();
    expect(await repos.faceEnrolment.get('st-rajesh')).toBeDefined();
    await repos.faceEnrolment.remove('st-rajesh');
    expect(client.rows('face_enrolment')).toEqual([]);
    expect(db.read('face')['st-rajesh']).toBeUndefined();
    expect(await repos.faceEnrolment.get('st-rajesh')).toBeUndefined();
    expect(topics).toContain('face');
  });

  it('reads an enrolment made on another device, and keeps an offline enrolment on the device', async () => {
    const { client, repos, state } = setup();
    client.seed('face_enrolment', [{ staff_id: 'st-sunita', institute_id: PUNE, enrolled_at: '2026-09-20T04:40:00+00:00', sample_count: 3, simulated: true }]);
    expect((await repos.faceEnrolment.get('st-sunita'))?.enrolledAt).toBe('2026-09-20T04:40:00.000Z');
    state.online = false;
    await repos.faceEnrolment.save({ staffId: 'st-rajesh', enrolledAt: '2026-09-25T04:40:00.000Z', sampleCount: 3, simulated: true });
    expect(await repos.faceEnrolment.get('st-rajesh')).toBeDefined();
  });
});

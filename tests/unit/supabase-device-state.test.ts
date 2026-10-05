/**
 * Task 17 (final whole-branch review, D-143): what the device keeps on the Supabase source.
 * 5. Face-enrolment flags: an offline enrolment stays on the device (also across a day change) and reaches the server
 *    on reconnect; a live read prefers the server, so a removed enrolment is not resurrected by a stale device copy.
 * 6. The device database: the story's packs only with an explicit demo action (first seed, Reset, a preset; fix
 *    round 1), real packs kept across a day change or a schema bump, and a demo Data switch (Shared <-> This device)
 *    keeps unsynced submissions, staff marks and the sync queue.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceSubmission, StaffAttendanceRecord } from '@/domain/attendance';
import type { FaceEnrolment } from '@/domain/device';
import { EventBus } from '@/lib/events';
import { MemoryStore, type KeyValueStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase, staffKey } from '@/repositories/mock/database';
import { createSupabaseRepositories } from '@/repositories/supabase';
import { faceToRow } from '@/repositories/supabase/mappers';
import { createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const DAY1 = '2026-09-25';
const DAY2 = '2026-09-26';

const face = (staffId: string): FaceEnrolment => ({ staffId, enrolledAt: `${DAY1}T04:00:00.000Z`, sampleCount: 3, simulated: true });

function device(opts: { client?: FakeDataClient; store?: KeyValueStore; cacheStore?: KeyValueStore } = {}) {
  const clock = new FixedClock(instantAt(DAY1, '10:15'));
  const client = opts.client ?? new FakeDataClient();
  const db = new MockDatabase(opts.store ?? new MemoryStore(), clock, new EventBus(), { seedServerData: false });
  const state = { online: true, elapsed: 0 };
  const repos = createSupabaseRepositories({ client, db, cacheStore: opts.cacheStore ?? new MemoryStore(), bus: new EventBus(), clock, isOnline: () => state.online, elapsedMs: () => state.elapsed });
  return { client, clock, db, state, repos };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('5. face-enrolment flags on the Supabase source', () => {
  it('an offline enrolment stays on the device, also across a day change, and is sent when the connection returns', async () => {
    const store = new MemoryStore();
    const cacheStore = new MemoryStore();
    const phone = device({ store, cacheStore });
    phone.state.online = false;
    await phone.repos.faceEnrolment.save(face('st-rajesh'));
    expect(phone.client.rows('face_enrolment')).toEqual([]);
    phone.clock.set(instantAt(DAY2, '08:00'));
    expect(await phone.repos.faceEnrolment.get('st-rajesh')).toMatchObject({ staffId: 'st-rajesh' });
    phone.state.online = true;
    await phone.repos.faceEnrolment.flush();
    expect(phone.client.rows('face_enrolment').map((r) => r.staff_id)).toEqual(['st-rajesh']);
  });

  it('retries the upsert on reconnect (container wiring)', async () => {
    const client = new FakeDataClient();
    seedMasterData(client, DAY1);
    const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0, online: false });
    const app = createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: new FixedClock(instantAt(DAY1, '10:15')), simulation, client, cacheStore: new MemoryStore() });
    await app.repositories.faceEnrolment.save(face('st-rajesh'));
    simulation.update({ online: true });
    await vi.waitFor(() => expect(client.rows('face_enrolment').map((r) => r.staff_id)).toEqual(['st-rajesh']));
  });

  it('a live read prefers the server: an enrolment removed there is not resurrected by the device copy', async () => {
    const phone = device();
    await phone.repos.faceEnrolment.save(face('st-rajesh'));
    expect(phone.client.rows('face_enrolment')).toHaveLength(1);
    phone.client.tables.face_enrolment = []; // removed on another device (or a shared reset)
    phone.state.elapsed += 60_000;
    expect(await phone.repos.faceEnrolment.get('st-rajesh')).toBeUndefined();
    expect(phone.db.read('face')).toEqual({});
    expect(await phone.repos.faceEnrolment.count()).toBe(0);
  });

  it('keeps the device copy when the server cannot be read, and while its own upsert is still waiting', async () => {
    const phone = device();
    await phone.repos.faceEnrolment.save(face('st-rajesh'));
    phone.client.tables.face_enrolment = [];
    phone.client.offline = true;
    phone.state.elapsed += 60_000;
    expect(await phone.repos.faceEnrolment.get('st-rajesh')).toMatchObject({ staffId: 'st-rajesh' });

    phone.client.failNextWrite = { kind: 'network', message: 'timeout' };
    phone.client.offline = false;
    await phone.repos.faceEnrolment.save(face('st-sunita'));
    phone.state.elapsed += 60_000;
    expect(await phone.repos.faceEnrolment.get('st-sunita')).toMatchObject({ staffId: 'st-sunita' });
  });

  it('reads the server row when the device has none', async () => {
    const phone = device();
    phone.client.seed('face_enrolment', [faceToRow(face('st-anil'))]);
    expect(await phone.repos.faceEnrolment.get('st-anil')).toMatchObject({ staffId: 'st-anil', simulated: true });
  });
});

describe('6. the device database on the Supabase source', () => {
  const base = { address: { batchId: 'b', date: DAY1, slot: { kind: 'daily' as const } }, marks: {}, markedBy: 'st-rajesh', deviceTimestamp: '' };
  const pending: AttendanceSubmission = { ...base, id: 'p', sessionKey: 'b.p', syncState: 'pending' };
  const synced: AttendanceSubmission = { ...base, id: 's', sessionKey: 'b.s', syncState: 'synced' };
  const staffPending: StaffAttendanceRecord = { id: 'sp', staffId: 'st-rajesh', date: DAY1, status: 'present', source: 'self', markedBy: 'st-rajesh', deviceTimestamp: '', syncState: 'pending' };
  const queue = [{ id: 'q1', kind: 'attendance_submission' as const, recordId: 'p', label: 'b.p', enqueuedAt: '', attempts: 0 }];

  it('a demo build\'s fresh device has the story\'s packs at its first seed; a day change keeps a real download and writes no story pack (fix rounds 1-2)', () => {
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const db = new MockDatabase(new MemoryStore(), clock, new EventBus(), { seedServerData: false, demoStoryPacks: true });
    expect(Object.keys(db.read('packs'))).toEqual(expect.arrayContaining(['ele-s1u2', 'fit-s1u2'])); // an explicit demo action
    const real = { 'wel-s1u1': { batchId: 'wel-s1u1', downloadedAt: `${DAY1}T03:00:00.000Z` } };
    db.write('packs', real); // what this device holds now: one batch it downloaded itself
    db.write('face', { 'st-rajesh': face('st-rajesh') });
    clock.set(instantAt(DAY2, '08:00'));
    expect(db.read('packs')).toEqual(real);
    expect(db.read('face')).toEqual({ 'st-rajesh': face('st-rajesh') });
  });

  it('a demo-off build\'s fresh device starts with no packs on the Supabase source (fix round 2)', () => {
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const db = new MockDatabase(new MemoryStore(), clock, new EventBus(), { seedServerData: false });
    expect(db.read('packs')).toEqual({});
    const device = new MockDatabase(new MemoryStore(), clock, new EventBus()); // the mock source: its story is its data
    expect(Object.keys(device.read('packs'))).toEqual(expect.arrayContaining(['ele-s1u2', 'fit-s1u2']));
  });

  it('the Supabase container writes the story\'s packs at a first seed only when the demo boot path asks (fix round 2)', async () => {
    const make = (demoStoryPacks?: boolean) => {
      const client = new FakeDataClient();
      seedMasterData(client, DAY1);
      const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 });
      return createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: new FixedClock(instantAt(DAY1, '10:15')), simulation, client, cacheStore: new MemoryStore(), demoStoryPacks });
    };
    expect(await make().repositories.packs.list()).toEqual([]);
    expect(await make(false).repositories.packs.list()).toEqual([]);
    expect((await make(true).repositories.packs.list()).map((p) => p.batchId)).toEqual(expect.arrayContaining(['ele-s1u2', 'fit-s1u2']));
  });

  it('a schema bump keeps the device\'s real packs and writes no story pack; Reset brings the story\'s packs back', () => {
    const store = new MemoryStore();
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const before = new MockDatabase(store, clock, new EventBus(), { seedServerData: false });
    before.ensureSeeded();
    const real = { 'wel-s1u1': { batchId: 'wel-s1u1', downloadedAt: `${DAY1}T03:00:00.000Z` } };
    before.write('packs', real);
    store.set('seed', { version: 1, date: DAY1, serverData: false }); // stored by an older build
    const after = new MockDatabase(store, clock, new EventBus(), { seedServerData: false });
    expect(after.read('packs')).toEqual(real);
    after.reset();
    expect(Object.keys(after.read('packs'))).toEqual(expect.arrayContaining(['ele-s1u2', 'fit-s1u2']));
  });

  it('restoreStoryPacks writes the story\'s packs over the device\'s on the Supabase source, and is a no-op on the device source', () => {
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const shared = new MockDatabase(new MemoryStore(), clock, new EventBus(), { seedServerData: false });
    shared.ensureSeeded();
    shared.write('packs', { 'wel-s1u1': { batchId: 'wel-s1u1', downloadedAt: `${DAY1}T03:00:00.000Z` }, 'fit-s1u2': { batchId: 'fit-s1u2', downloadedAt: `${DAY1}T04:00:00.000Z` } });
    shared.restoreStoryPacks();
    expect(shared.read('packs')['wel-s1u1']).toBeDefined();
    expect(shared.read('packs')['fit-s1u2'].downloadedAt).toBe(instantAt('2026-09-17', '18:10').toISOString()); // stale again, as in the story
    expect(shared.read('packs')['ele-s1u2']).toBeDefined();
    const device = new MockDatabase(new MemoryStore(), clock, new EventBus());
    device.ensureSeeded();
    device.write('packs', {});
    device.restoreStoryPacks();
    expect(device.read('packs')).toEqual({});
  });

  it('the mock source still seeds the demo story\'s packs', () => {
    const db = new MockDatabase(new MemoryStore(), new FixedClock(instantAt(DAY1, '10:15')), new EventBus());
    expect(Object.keys(db.read('packs')).length).toBeGreaterThan(0);
  });

  function switchData(from: boolean, to: boolean) {
    const store = new MemoryStore();
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const before = new MockDatabase(store, clock, new EventBus(), { seedServerData: from });
    before.ensureSeeded();
    before.write('submissions', { ...before.read('submissions'), [pending.sessionKey]: pending, [synced.sessionKey]: synced });
    before.write('staff', { ...before.read('staff'), [staffKey('st-rajesh', DAY1)]: staffPending });
    before.write('queue', queue);
    // The demo's Data switch reloads the app with the other source on the same device store.
    return new MockDatabase(store, clock, new EventBus(), { seedServerData: to });
  }

  it('Shared -> This device keeps unsynced submissions, staff marks and the queue', () => {
    const after = switchData(false, true);
    expect(after.read('submissions')['b.p']).toEqual(pending);
    expect(after.read('submissions')['b.s']).toBeUndefined();
    expect(after.read('staff')[staffKey('st-rajesh', DAY1)]).toEqual(staffPending);
    expect(after.read('queue')).toEqual(queue);
    expect(Object.keys(after.read('packs')).length).toBeGreaterThan(0); // the device source's story
  });

  it('This device -> Shared keeps them too (and the device\'s packs), and nothing synced from the device story', () => {
    const after = switchData(true, false);
    expect(after.read('submissions')).toEqual({ 'b.p': pending });
    expect(after.read('staff')).toEqual({ [staffKey('st-rajesh', DAY1)]: staffPending });
    expect(after.read('queue')).toEqual(queue);
    expect(Object.keys(after.read('packs'))).toEqual(expect.arrayContaining(['ele-s1u2', 'fit-s1u2']));
    expect(after.read('face')).toEqual({});
  });
});

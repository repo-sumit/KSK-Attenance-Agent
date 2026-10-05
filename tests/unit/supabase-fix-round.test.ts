/**
 * Task 17 fix round 1 (task review findings) on the Supabase source:
 * 3. A failed sync no longer shows once the outbox drained on its own (nothing left to sync).
 * 4. A correction goes to the outbox before the device database, and one never seen on the server is never dropped.
 * 5. A live read compares the server's institute-scoped answer only with the device records of that institute.
 * 6. A correction the server can never take (its submission is gone: 23503) is refused, not retried, not counted.
 * 7. Face flags waiting from an earlier visit are sent at start when online.
 * Fix round 2: a correction whose device write fails after the outbox write leaves nothing behind in the outbox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceSubmission, Correction, StaffAttendanceRecord } from '@/domain/attendance';
import type { FaceEnrolment } from '@/domain/device';
import type { Mark } from '@/domain/status';
import { EventBus } from '@/lib/events';
import { MemoryStore, StorageWriteError, type KeyValueStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase } from '@/repositories/mock/database';
import { createSupabaseRepositories } from '@/repositories/supabase';
import { submissionToRow } from '@/repositories/supabase/mappers';
import { createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25';
const PUNE = 'inst-27410';
const NASHIK = 'inst-27613';
const NOW = instantAt(TODAY, '10:15').toISOString();

const sub = (batchId: string, id: string, over: Partial<AttendanceSubmission> = {}): AttendanceSubmission => ({
  id,
  sessionKey: `${batchId}.${TODAY}.daily`,
  address: { batchId, date: TODAY, slot: { kind: 'daily' } },
  marks: { [`${batchId}-r01`]: { status: 'present' } },
  markedBy: 'st-rajesh',
  deviceTimestamp: `${TODAY}T04:45:00.000Z`,
  syncState: 'pending',
  ...over,
});

const correction = (id: string, attendanceId: string, newMark: Mark = { status: 'absent' }, actorId = 'st-anil'): Correction => ({
  correctionId: id,
  attendanceId,
  studentId: 'ele-s1u2-r01',
  oldMark: { status: 'present' },
  newMark,
  reason: 'Fixed',
  actorId,
  timestamp: NOW,
});

const staffRecord = (id: string, staffId: string): StaffAttendanceRecord => ({ id, staffId, date: TODAY, status: 'present', source: 'self', markedBy: staffId, deviceTimestamp: NOW, syncState: 'pending' });

/** One device over a (shared) fake project, with its own stores. */
function device(client: FakeDataClient, opts: { store?: KeyValueStore; cacheStore?: KeyValueStore } = {}) {
  const clock = new FixedClock(instantAt(TODAY, '10:15'));
  const db = new MockDatabase(opts.store ?? new MemoryStore(), clock, new EventBus(), { seedServerData: false });
  const state = { online: true, elapsed: 0 };
  const repos = createSupabaseRepositories({ client, db, cacheStore: opts.cacheStore ?? new MemoryStore(), bus: new EventBus(), clock, isOnline: () => state.online, elapsedMs: () => state.elapsed });
  const later = () => (state.elapsed += 60_000); // past the in-memory cache: the next read asks the server
  return { db, state, repos, later };
}

function app(client: FakeDataClient, opts: { store?: KeyValueStore; cacheStore?: KeyValueStore; online?: boolean; autoSync?: boolean } = {}) {
  const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0, online: opts.online ?? true });
  const configOverrides = opts.autoSync === false ? { get: () => ({ offline: { autoSync: false } }) } : undefined;
  const container = createSupabaseContainer({ store: opts.store ?? new MemoryStore(), preferencesStore: new MemoryStore(), clock: new FixedClock(instantAt(TODAY, '10:15')), simulation, client, cacheStore: opts.cacheStore ?? new MemoryStore(), configOverrides });
  return { container, simulation };
}

const withParent = () => {
  const client = new FakeDataClient();
  client.seed('submissions', [{ ...submissionToRow(sub('ele-s1u2', 'att-1', { syncState: 'synced' })), institute_id: PUNE, server_timestamp: `${TODAY}T04:46:00Z` }]);
  return client;
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('3. a failed sync does not outlive the outbox', () => {
  it('the outbox drained by its own flush (an append) ends the failure: idle, no last failure', async () => {
    const client = withParent();
    seedMasterData(client, TODAY);
    const { container } = app(client);
    client.offline = true;
    await container.repositories.corrections.append(correction('c1', 'att-1'));
    expect(await container.services.sync.syncNow('manual')).toMatchObject({ phase: 'failed', pending: 1 });
    client.offline = false;
    await container.repositories.corrections.append(correction('c2', 'att-1', { status: 'present' })); // flushes both
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1', 'c2']);
    expect(container.services.sync.status()).toEqual({ phase: 'idle', online: true, pending: 0, lastFailure: null });
  });

  it('and so does the automatic flush on reconnect with auto-sync off', async () => {
    const client = withParent();
    seedMasterData(client, TODAY);
    const { container, simulation } = app(client, { autoSync: false });
    container.services.sync.start();
    client.offline = true; // the device thinks it is online, the server cannot be reached
    await container.repositories.corrections.append(correction('c1', 'att-1'));
    expect(await container.services.sync.syncNow('manual')).toMatchObject({ phase: 'failed', pending: 1, lastFailure: { trigger: 'manual' } });
    simulation.update({ online: false });
    client.offline = false;
    simulation.update({ online: true }); // reconnect: auto-sync is off, so only the outbox is flushed (no sync)
    await vi.waitFor(() => expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']));
    expect(container.services.sync.status()).toMatchObject({ phase: 'idle', pending: 0, lastFailure: null });
  });
});

describe('4. the outbox comes first, and a correction never seen on the server is never dropped', () => {
  /** A device store whose outbox write fails (storage full), recording what the device database held at that moment. */
  class FullOutbox extends MemoryStore {
    deviceHadIt: boolean | undefined;
    constructor(private readonly peek: () => boolean) {
      super();
    }
    override set<T>(key: string, value: T): void {
      if (key === 'outbox:corrections' && (value as unknown[]).length) {
        this.deviceHadIt ??= this.peek();
        throw new Error('QuotaExceededError');
      }
      super.set(key, value);
    }
  }

  it('puts the correction in the outbox before the device database', async () => {
    const client = withParent();
    // The peek runs during the append, after `phone` exists.
    const cacheStore = new FullOutbox(() => phone.db.read('corrections').some((c) => c.correctionId === 'c1'));
    const phone = device(client, { cacheStore });
    await phone.repos.corrections.append(correction('c1', 'att-1'));
    expect(cacheStore.deviceHadIt).toBe(false);
  });

  it('keeps a correction whose outbox write failed (never sent, never seen there) through live reads', async () => {
    const client = withParent();
    const phone = device(client, { cacheStore: new FullOutbox(() => false) });
    await phone.repos.corrections.append(correction('c1', 'att-1'));
    expect(client.rows('corrections')).toEqual([]);
    phone.later();
    expect((await phone.repos.corrections.listForAttendance(['att-1'])).map((c) => c.correctionId)).toEqual(['c1']);
    phone.later();
    await phone.repos.corrections.listForAttendance(['att-1']);
    expect(phone.db.read('corrections').map((c) => c.correctionId)).toEqual(['c1']);
  });

  it('a device write that fails after the outbox write leaves nothing behind, so a retry sends one correction (fix round 2)', async () => {
    /** The device database (ksk:v1) is full: writing a correction into it fails, as localStorage would. */
    class FullCorrections extends MemoryStore {
      full = true;
      override set<T>(key: string, value: T): void {
        if (this.full && key === 'corrections' && (value as unknown[]).length) throw new StorageWriteError(key, new Error('QuotaExceededError'));
        super.set(key, value);
      }
    }
    const client = withParent();
    const store = new FullCorrections();
    const phone = device(client, { store });
    await expect(phone.repos.corrections.append(correction('c1', 'att-1'))).rejects.toBeInstanceOf(StorageWriteError);
    expect(phone.repos.corrections.pendingCount()).toBe(0);
    await phone.repos.corrections.flush();
    expect(client.rows('corrections')).toEqual([]);
    store.full = false; // the trainer frees space and saves the correction again
    await phone.repos.corrections.append(correction('c2', 'att-1'));
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c2']);
    expect(phone.repos.corrections.pendingCount()).toBe(0);
  });

  it('still drops one the server had (delivered) once a shared reset removed it', async () => {
    const client = withParent();
    const phone = device(client);
    await phone.repos.corrections.append(correction('c1', 'att-1'));
    expect(client.rows('corrections')).toHaveLength(1);
    client.tables.corrections = [];
    phone.later();
    expect(await phone.repos.corrections.listForAttendance(['att-1'])).toEqual([]);
    expect(phone.db.read('corrections')).toEqual([]);
  });
});

describe('5. a live read scopes the device\'s records to the signed-in institute', () => {
  /** A device that worked at Pune (its records synced there), now signed in at Nashik. */
  async function puneThenNashik() {
    const client = new FakeDataClient();
    seedMasterData(client, TODAY);
    const phone = device(client);
    phone.repos.live.follow(PUNE);
    const mine = sub('ele-s1u2', 'att-pune');
    await phone.repos.attendance.createSubmission(mine);
    const pushed = await phone.repos.syncGateway.pushSubmission(mine);
    if (!pushed.ok) throw new Error(pushed.error);
    await phone.repos.attendance.markSubmissionSynced(mine.id, pushed.value.serverTimestamp);
    const mark = staffRecord('staff-pune', 'st-rajesh');
    await phone.repos.staffAttendance.create(mark);
    expect((await phone.repos.syncGateway.pushStaffRecord(mark)).ok).toBe(true);
    await phone.repos.staffAttendance.markSynced(mark.id);
    await phone.repos.corrections.append(correction('c-pune', 'att-pune'));
    expect(client.rows('corrections')).toHaveLength(1);
    phone.repos.live.follow(NASHIK);
    phone.later();
    return { client, phone };
  }

  it('keeps the other institute\'s synced submissions, staff marks and corrections on the device', async () => {
    const { phone } = await puneThenNashik();
    expect(await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).toEqual([]);
    expect(await phone.repos.attendance.getSubmission(`ele-s1u2.${TODAY}.daily`)).toBeUndefined();
    expect(await phone.repos.staffAttendance.listForDate(TODAY)).toEqual([]);
    expect(await phone.repos.staffAttendance.listBetween(['st-rajesh'], TODAY, TODAY)).toEqual([]);
    expect(await phone.repos.corrections.listForAttendance(['att-pune'])).toEqual([]);
    expect(Object.values(phone.db.read('submissions')).map((s) => s.id)).toEqual(['att-pune']);
    expect(Object.values(phone.db.read('staff')).map((r) => r.id)).toEqual(['staff-pune']);
    expect(phone.db.read('corrections').map((c) => c.correctionId)).toEqual(['c-pune']);
  });

  it('and back at Pune they are read from the server again, never having flipped', async () => {
    const { phone } = await puneThenNashik();
    await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    phone.repos.live.follow(PUNE);
    phone.later();
    expect((await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).map((s) => s.id)).toContain('att-pune');
    expect((await phone.repos.corrections.listForAttendance(['att-pune'])).map((c) => c.correctionId)).toEqual(['c-pune']);
  });

  it('a shared reset still drops the signed-in institute\'s own synced records', async () => {
    const { client, phone } = await puneThenNashik();
    phone.repos.live.follow(PUNE);
    client.tables.submissions = [];
    client.tables.staff_attendance = [];
    client.tables.corrections = [];
    phone.later();
    expect(await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).toEqual([]);
    expect(await phone.repos.staffAttendance.listForDate(TODAY)).toEqual([]);
    expect(await phone.repos.corrections.listForAttendance(['att-pune'])).toEqual([]);
    expect(phone.db.read('submissions')).toEqual({});
    expect(phone.db.read('staff')).toEqual({});
    expect(phone.db.read('corrections')).toEqual([]);
  });
});

describe('6. a correction whose submission is gone is refused, not retried', () => {
  it('leaves the outbox and the device, is kept as refused, and the sync ends without a failure', async () => {
    const client = new FakeDataClient(); // the submission was deleted by a shared reset on another device
    seedMasterData(client, TODAY);
    const { container } = app(client);
    const corrections = container.repositories.corrections as unknown as { pendingCount(): number; refused(): readonly Correction[] };
    await container.repositories.corrections.append(correction('c-orphan', 'att-gone'));
    expect(corrections.pendingCount()).toBe(0);
    expect(corrections.refused().map((c) => c.correctionId)).toEqual(['c-orphan']);
    expect(container.mockDatabase.read('corrections')).toEqual([]);
    expect(await container.repositories.corrections.listForAttendance(['att-gone'])).toEqual([]);
    const status = await container.services.sync.syncNow('manual');
    expect(status).toMatchObject({ pending: 0, lastFailure: null });
    expect(status.phase).not.toBe('failed');
    expect(client.rows('corrections')).toEqual([]);
  });

  it('a correction whose submission is still waiting on this device waits for it, then follows it', async () => {
    const client = new FakeDataClient();
    seedMasterData(client, TODAY);
    const { container } = app(client);
    const corrections = container.repositories.corrections as unknown as { pendingCount(): number; refused(): readonly Correction[] };
    await container.repositories.attendance.createSubmission(sub('ele-s1u2', 'att-waiting'));
    await container.repositories.offlineQueue.enqueue({ id: 'q1', kind: 'attendance_submission', recordId: 'att-waiting', label: 'x', enqueuedAt: NOW, attempts: 0 });
    await container.repositories.corrections.append(correction('c1', 'att-waiting'));
    expect(corrections.pendingCount()).toBe(1);
    expect(corrections.refused()).toEqual([]);
    const status = await container.services.sync.syncNow('manual');
    expect(status).toMatchObject({ pending: 0, phase: 'synced' });
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']);
  });
});

describe('7. face flags waiting from an earlier visit go at start', () => {
  it('sends them when the app starts online, without waiting for a reconnect', async () => {
    const client = new FakeDataClient();
    seedMasterData(client, TODAY);
    const store = new MemoryStore();
    const cacheStore = new MemoryStore();
    const earlier = device(client, { store, cacheStore });
    earlier.state.online = false;
    const face: FaceEnrolment = { staffId: 'st-rajesh', enrolledAt: NOW, sampleCount: 3, simulated: true };
    await earlier.repos.faceEnrolment.save(face);
    expect(client.rows('face_enrolment')).toEqual([]);
    app(client, { store, cacheStore }); // the reload, online
    await vi.waitFor(() => expect(client.rows('face_enrolment').map((r) => r.staff_id)).toEqual(['st-rajesh']));
  });

  it('does not send anything at start while offline', async () => {
    const client = new FakeDataClient();
    seedMasterData(client, TODAY);
    const store = new MemoryStore();
    const cacheStore = new MemoryStore();
    const earlier = device(client, { store, cacheStore });
    earlier.state.online = false;
    await earlier.repos.faceEnrolment.save({ staffId: 'st-rajesh', enrolledAt: NOW, sampleCount: 3, simulated: true });
    const upserts = vi.spyOn(client, 'upsert');
    app(client, { store, cacheStore, online: false });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(upserts).not.toHaveBeenCalled();
  });
});

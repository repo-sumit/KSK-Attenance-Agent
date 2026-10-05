/**
 * Task 17 (final whole-branch review, D-143): three Supabase correctness fixes.
 * 1. One global order for corrections on every device: synced corrections sort by (timestamp, seq, correctionId),
 *    seq being the server's insert order; only this device's outbox goes after them.
 * 2. The correction outbox always drains (at start, from Sync now, and items added during a flush) and is counted.
 * 3. A synced device record the server no longer has (a shared reset) is dropped on a live server read only.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectiveMarks, type AttendanceSubmission, type Correction, type StaffAttendanceRecord } from '@/domain/attendance';
import type { Mark } from '@/domain/status';
import { EventBus } from '@/lib/events';
import { MemoryStore, type KeyValueStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase } from '@/repositories/mock/database';
import { createSupabaseRepositories } from '@/repositories/supabase';
import { correctionToRow, submissionToRow } from '@/repositories/supabase/mappers';
import { createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25';
const STUDENT = 'ele-s1u2-r01';
/** The demo clock stands still at 10:15: every correction made "now" has the same timestamp. */
const FROZEN = instantAt(TODAY, '10:15').toISOString();

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

const correction = (id: string, newMark: Mark, timestamp = FROZEN): Correction => ({
  correctionId: id,
  attendanceId: 'att-1',
  studentId: STUDENT,
  oldMark: { status: 'present' },
  newMark,
  reason: 'Fixed',
  actorId: 'st-anil',
  timestamp,
});

const staffRecord = (id: string, over: Partial<StaffAttendanceRecord> = {}): StaffAttendanceRecord => ({
  id,
  staffId: 'st-rajesh',
  date: TODAY,
  status: 'present',
  source: 'self',
  markedBy: 'st-rajesh',
  deviceTimestamp: `${TODAY}T04:30:00.000Z`,
  syncState: 'pending',
  ...over,
});

/** One device: its own database and stores, talking to a (possibly shared) fake project. */
function device(client: FakeDataClient, cacheStore: KeyValueStore = new MemoryStore()) {
  const clock = new FixedClock(instantAt(TODAY, '10:15'));
  const db = new MockDatabase(new MemoryStore(), clock, new EventBus(), { seedServerData: false });
  const state = { online: true, elapsed: 0 };
  const repos = createSupabaseRepositories({ client, db, cacheStore, bus: new EventBus(), clock, isOnline: () => state.online, elapsedMs: () => state.elapsed });
  return { db, state, repos, cacheStore };
}

const parent = sub('ele-s1u2', 'att-1', { syncState: 'synced' });
const withParent = () => {
  const client = new FakeDataClient();
  client.seed('submissions', [{ ...submissionToRow(parent), institute_id: 'inst-27410', server_timestamp: '2026-09-25T04:46:00Z' }]);
  return client;
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('1. one global order for corrections', () => {
  const markOn = async (d: ReturnType<typeof device>) => {
    d.state.elapsed += 60_000; // a later read: past the in-memory cache
    return effectiveMarks(parent, await d.repos.corrections.listForAttendance(['att-1']))[STUDENT];
  };

  it('two devices show the same effective mark after two corrections made at the same frozen instant', async () => {
    const client = withParent();
    const phone = device(client);
    const laptop = device(client);
    await phone.repos.corrections.append(correction('c-phone', { status: 'absent' }));
    await laptop.repos.corrections.append(correction('c-laptop', { status: 'half_day', half: 1 }));
    // The server numbered them in arrival order: the laptop's came second, so it is the one in force everywhere.
    expect(client.rows('corrections').map((r) => [r.correction_id, r.seq])).toEqual([
      ['c-phone', 1],
      ['c-laptop', 2],
    ]);
    expect(await markOn(phone)).toEqual({ status: 'half_day', half: 1 });
    expect(await markOn(laptop)).toEqual({ status: 'half_day', half: 1 });
  });

  it('never sends seq on insert (the server assigns it) and still orders by timestamp first', async () => {
    const client = withParent();
    const phone = device(client);
    expect(correctionToRow(correction('x', { status: 'absent' }))).not.toHaveProperty('seq');
    await phone.repos.corrections.append(correction('late', { status: 'absent' }, `${TODAY}T06:00:00.000Z`));
    await phone.repos.corrections.append(correction('early', { status: 'leave', leaveType: 'sick' }, `${TODAY}T05:00:00.000Z`));
    expect(phone.repos.corrections.pendingCount()).toBe(0);
    expect(await markOn(phone)).toEqual({ status: 'absent' });
  });

  it('puts corrections still in this device\'s outbox after the synced ones', async () => {
    const client = withParent();
    const laptop = device(client);
    const phone = device(client);
    phone.state.online = false;
    await phone.repos.corrections.append(correction('c-phone-offline', { status: 'absent' }));
    await laptop.repos.corrections.append(correction('c-laptop', { status: 'leave', leaveType: 'casual' }));
    phone.state.online = true;
    client.offline = true; // the phone reads again but its outbox cannot drain yet
    const list = await phone.repos.corrections.listForAttendance(['att-1']);
    expect(list.map((c) => c.correctionId)).toEqual(['c-phone-offline']);
    client.offline = false;
    phone.state.elapsed += 60_000;
    // A live read before the outbox drained: the synced one first, then the outbox.
    expect((await phone.repos.corrections.listForAttendance(['att-1'])).map((c) => c.correctionId)).toEqual(['c-laptop', 'c-phone-offline']);
  });
});

describe('2. the correction outbox always drains and is counted', () => {
  it('sends a correction appended while a flush is running', async () => {
    const client = withParent();
    const phone = device(client);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const insert = client.insert.bind(client);
    const spy = vi.spyOn(client, 'insert').mockImplementationOnce(async (table, row) => {
      await gate;
      return insert(table, row);
    });
    const first = phone.repos.corrections.append(correction('c1', { status: 'absent' }));
    await vi.waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const second = phone.repos.corrections.append(correction('c2', { status: 'leave', leaveType: 'sick' }));
    release();
    await Promise.all([first, second]);
    await vi.waitFor(() => expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1', 'c2']));
    expect(phone.repos.corrections.pendingCount()).toBe(0);
  });

  function app(client: FakeDataClient, cacheStore: KeyValueStore, online = true) {
    const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0, online });
    const container = createSupabaseContainer({ store: new MemoryStore(), preferencesStore: new MemoryStore(), clock: new FixedClock(instantAt(TODAY, '10:15')), simulation, client, cacheStore });
    return { container, simulation };
  }

  it('drains a correction left by an earlier visit as soon as the app starts online', async () => {
    const client = withParent();
    seedMasterData(client, TODAY);
    const cacheStore = new MemoryStore();
    const earlier = device(client, cacheStore);
    earlier.state.online = false;
    await earlier.repos.corrections.append(correction('c-left', { status: 'absent' }));
    expect(client.rows('corrections')).toEqual([]);

    const { container } = app(client, cacheStore);
    container.services.sync.start();
    await vi.waitFor(() => expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c-left']));
    await vi.waitFor(() => expect(container.services.sync.status().pending).toBe(0));
  });

  it('counts waiting corrections as pending, and Sync now sends them', async () => {
    const client = withParent();
    seedMasterData(client, TODAY);
    const { container } = app(client, new MemoryStore());
    client.offline = true; // the device thinks it is online, the server cannot be reached
    await container.repositories.corrections.append(correction('c1', { status: 'absent' }));
    expect(container.services.sync.status()).toMatchObject({ pending: 1, phase: 'pending' });
    client.offline = false;
    const status = await container.services.sync.syncNow('manual');
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']);
    expect(status).toMatchObject({ pending: 0, phase: 'synced', lastFailure: null });
  });

  it('a Sync now that cannot send the outbox fails and keeps it counted', async () => {
    const client = withParent();
    seedMasterData(client, TODAY);
    const { container } = app(client, new MemoryStore());
    client.offline = true;
    await container.repositories.corrections.append(correction('c1', { status: 'absent' }));
    const status = await container.services.sync.syncNow('manual');
    expect(status).toMatchObject({ pending: 1, phase: 'failed', lastFailure: { trigger: 'manual' } });
  });

  it('sends waiting corrections on reconnect even with auto-sync off', async () => {
    const client = withParent();
    seedMasterData(client, TODAY);
    const { container, simulation } = app(client, new MemoryStore(), false);
    container.services.sync.start();
    await container.repositories.corrections.append(correction('c1', { status: 'absent' }));
    expect(container.services.sync.status().pending).toBe(1);
    simulation.update({ online: true });
    await vi.waitFor(() => expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']));
  });
});

describe('3. a synced record the server no longer has is dropped (live reads only)', () => {
  async function syncedOn(d: ReturnType<typeof device>, s: AttendanceSubmission) {
    await d.repos.attendance.createSubmission(s);
    const pushed = await d.repos.syncGateway.pushSubmission(s);
    if (!pushed.ok) throw new Error(pushed.error);
    await d.repos.attendance.markSubmissionSynced(s.id, pushed.value.serverTimestamp);
  }
  /** "Reset shared demo data" on another device: the server's operational rows are gone. */
  const resetServer = (client: FakeDataClient) => {
    client.tables.submissions = [];
    client.tables.staff_attendance = [];
    client.tables.corrections = [];
  };

  it('drops a synced submission after a server reset, from the reads and the device, so it can be submitted again', async () => {
    const client = new FakeDataClient();
    const phone = device(client);
    const mine = sub('ele-s1u2', 'att-mine');
    await syncedOn(phone, mine);
    expect((await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).map((s) => s.id)).toEqual(['att-mine']);
    resetServer(client);
    phone.state.elapsed += 60_000;
    expect(await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).toEqual([]);
    expect(phone.db.read('submissions')).toEqual({});
    expect((await phone.repos.attendance.createSubmission(sub('ele-s1u2', 'att-again'))).ok).toBe(true);
  });

  it('getSubmission drops it too (the session screen reads one session)', async () => {
    const client = new FakeDataClient();
    const phone = device(client);
    await syncedOn(phone, sub('ele-s1u2', 'att-mine'));
    resetServer(client);
    phone.state.elapsed += 60_000;
    expect(await phone.repos.attendance.getSubmission(`ele-s1u2.${TODAY}.daily`)).toBeUndefined();
    expect(phone.db.read('submissions')).toEqual({});
  });

  it('never drops a pending or rejected record', async () => {
    const client = new FakeDataClient();
    const phone = device(client);
    await phone.repos.attendance.createSubmission(sub('ele-s1u2', 'att-pending'));
    await phone.repos.attendance.createSubmission(sub('fit-s1u1', 'att-rejected'));
    await phone.repos.attendance.markSubmissionRejected('att-rejected');
    expect((await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).map((s) => s.id).sort()).toEqual(['att-pending', 'att-rejected']);
    expect(Object.keys(phone.db.read('submissions')).sort()).toEqual([`ele-s1u2.${TODAY}.daily`, `fit-s1u1.${TODAY}.daily`]);
  });

  it('never prunes on an offline or cached read', async () => {
    const client = new FakeDataClient();
    const cacheStore = new MemoryStore();
    const phone = device(client, cacheStore);
    await syncedOn(phone, sub('ele-s1u2', 'att-mine'));
    resetServer(client);
    client.offline = true;
    phone.state.elapsed += 60_000;
    expect((await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).map((s) => s.id)).toEqual(['att-mine']);
    phone.state.online = false;
    expect((await phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).map((s) => s.id)).toEqual(['att-mine']);
    expect(Object.keys(phone.db.read('submissions'))).toEqual([`ele-s1u2.${TODAY}.daily`]);
  });

  it('keeps a record whose push landed while a read was in flight (that read started before the insert)', async () => {
    const client = new FakeDataClient();
    const phone = device(client);
    const mine = sub('ele-s1u2', 'att-mine');
    await phone.repos.attendance.createSubmission(mine);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const select = client.select.bind(client);
    vi.spyOn(client, 'select').mockImplementationOnce(async (req) => {
      const answer = await select(req); // the server's rows before the push
      await gate;
      return answer;
    });
    const read = phone.repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    const pushed = await phone.repos.syncGateway.pushSubmission(mine);
    if (!pushed.ok) throw new Error(pushed.error);
    await phone.repos.attendance.markSubmissionSynced(mine.id, pushed.value.serverTimestamp);
    release();
    expect((await read).map((s) => s.id)).toEqual(['att-mine']);
    expect(Object.keys(phone.db.read('submissions'))).toEqual([`ele-s1u2.${TODAY}.daily`]);
  });

  it('does the same for staff marks', async () => {
    const client = new FakeDataClient();
    const phone = device(client);
    const mine = staffRecord('staff-mine');
    await phone.repos.staffAttendance.create(mine);
    expect((await phone.repos.syncGateway.pushStaffRecord(mine)).ok).toBe(true);
    await phone.repos.staffAttendance.markSynced(mine.id);
    await phone.repos.staffAttendance.create(staffRecord('staff-pending', { staffId: 'st-sunita', markedBy: 'st-sunita' }));
    resetServer(client);
    phone.state.elapsed += 60_000;
    expect((await phone.repos.staffAttendance.listForDate(TODAY)).map((r) => r.id)).toEqual(['staff-pending']);
    expect(Object.values(phone.db.read('staff')).map((r) => r.id)).toEqual(['staff-pending']);
    expect((await phone.repos.staffAttendance.create(staffRecord('staff-again'))).ok).toBe(true);
  });
});

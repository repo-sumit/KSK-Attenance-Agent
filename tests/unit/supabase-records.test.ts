/**
 * Task 10 (D-143): offline-first records on Supabase. Writes stay on the device exactly as the mock does; reads merge
 * the server's rows with the device's own unsynced rows; the SyncGateway pushes with the write-once rules; an
 * unreachable server falls back to the last server rows cached on the device.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceSubmission, Correction, StaffAttendanceRecord } from '@/domain/attendance';
import { EventBus } from '@/lib/events';
import { MemoryStore, type KeyValueStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase } from '@/repositories/mock/database';
import { createSupabaseRepositories } from '@/repositories/supabase';
import { correctionToRow, staffRecordToRow, submissionToRow } from '@/repositories/supabase/mappers';
import { FakeDataClient } from './supabase-fake';

const TODAY = '2026-09-25';
const YESTERDAY = '2026-09-24';

const sub = (batchId: string, id: string, over: Partial<AttendanceSubmission> = {}, date = TODAY): AttendanceSubmission => ({
  id,
  sessionKey: `${batchId}.${date}.daily`,
  address: { batchId, date, slot: { kind: 'daily' } },
  marks: { [`${batchId}-r01`]: { status: 'present' } },
  markedBy: 'st-rajesh',
  deviceTimestamp: `${date}T04:45:00.000Z`,
  syncState: 'pending',
  ...over,
});

const staffRecord = (staffId: string, id: string, over: Partial<StaffAttendanceRecord> = {}): StaffAttendanceRecord => ({
  id,
  staffId,
  date: TODAY,
  status: 'present',
  source: 'self',
  markedBy: staffId,
  deviceTimestamp: `${TODAY}T04:30:00.000Z`,
  syncState: 'pending',
  ...over,
});

const correction = (attendanceId: string, id: string): Correction => ({
  correctionId: id,
  attendanceId,
  studentId: 'ele-s1u2-r01',
  oldMark: { status: 'present' },
  newMark: { status: 'absent' },
  reason: 'Left early',
  actorId: 'st-anil',
  timestamp: `${TODAY}T06:00:00.000Z`,
});

function setup(opts: { cacheStore?: KeyValueStore; client?: FakeDataClient } = {}) {
  const clock = new FixedClock(instantAt(TODAY, '10:15'));
  const bus = new EventBus();
  const db = new MockDatabase(new MemoryStore(), clock, bus, { seedServerData: false });
  const client = opts.client ?? new FakeDataClient();
  const cacheStore = opts.cacheStore ?? new MemoryStore();
  const state = { online: true, blocked: false, elapsed: 0 };
  const repos = createSupabaseRepositories({
    client,
    db,
    cacheStore,
    bus,
    clock,
    isOnline: () => state.online,
    syncBlocked: () => state.blocked,
    elapsedMs: () => state.elapsed,
  });
  return { clock, bus, db, client, cacheStore, state, repos };
}

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('AttendanceRepository on Supabase', () => {
  it('starts with no seeded server-owned records on the device (the server holds them)', async () => {
    const { db } = setup();
    expect(db.read('submissions')).toEqual({});
    expect(db.read('corrections')).toEqual([]);
    expect(db.read('staff')).toEqual({});
    expect(db.read('face')).toEqual({});
  });

  it('reads the server rows merged with the device\'s unsynced rows; a local pending record wins for its key', async () => {
    const { client, repos } = setup();
    client.seed('submissions', [
      { ...submissionToRow(sub('ele-s1u1', 'srv-1')), institute_id: 'inst-27410', server_timestamp: '2026-09-25T04:46:00Z' },
      { ...submissionToRow(sub('ele-s1u2', 'srv-2')), institute_id: 'inst-27410', server_timestamp: '2026-09-25T04:46:00Z' },
    ]);
    // This device locked ele-s1u2 too, offline, before seeing the server's copy.
    await repos.attendance.createSubmission(sub('ele-s1u2', 'mine'));
    await repos.attendance.createSubmission(sub('fit-s1u1', 'mine-2'));
    const list = await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    expect(Object.fromEntries(list.map((s) => [s.address.batchId, s.id]))).toEqual({ 'ele-s1u1': 'srv-1', 'ele-s1u2': 'mine', 'fit-s1u1': 'mine-2' });
    expect(list.find((s) => s.id === 'srv-1')).toMatchObject({ syncState: 'synced', serverTimestamp: '2026-09-25T04:46:00.000Z' });
    expect((await repos.attendance.getSubmission('ele-s1u2.2026-09-25.daily'))?.id).toBe('mine');
    expect((await repos.attendance.getSubmission('ele-s1u1.2026-09-25.daily'))?.id).toBe('srv-1');
    expect(await repos.attendance.getSubmission('md-s1u1.2026-09-25.daily')).toBeUndefined();
  });

  it('writes on the device only, write-once, exactly as the mock does', async () => {
    const { client, repos } = setup();
    expect((await repos.attendance.createSubmission(sub('ele-s1u2', 'a'))).ok).toBe(true);
    expect(await repos.attendance.createSubmission(sub('ele-s1u2', 'b'))).toMatchObject({ ok: false, error: 'already_submitted' });
    expect(client.count('insert')).toBe(0);
    expect((await repos.attendance.getSubmissionById('a'))?.syncState).toBe('pending');
  });

  it('serves every session of a day from one server read, and refetches after the cache goes stale', async () => {
    const { client, repos, state } = setup();
    for (const b of ['ele-s1u1', 'ele-s1u2', 'fit-s1u1']) await repos.attendance.getSubmission(`${b}.${TODAY}.daily`);
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY, batchIds: ['ele-s1u1'] });
    expect(client.count('select', 'submissions')).toBe(1);
    state.elapsed += 60_000;
    await repos.attendance.getSubmission(`ele-s1u1.${TODAY}.daily`);
    expect(client.count('select', 'submissions')).toBe(2);
  });

  it('queries a date range (with the batch filter) and keeps only the asked range from the device', async () => {
    const { client, repos } = setup();
    client.seed('submissions', [
      { ...submissionToRow(sub('ele-s1u1', 'y1', {}, YESTERDAY)), server_timestamp: '2026-09-24T04:46:00Z' },
      { ...submissionToRow(sub('fit-s1u1', 'y2', {}, YESTERDAY)), server_timestamp: '2026-09-24T04:46:00Z' },
    ]);
    await repos.attendance.createSubmission(sub('ele-s1u1', 'today-local'));
    const list = await repos.attendance.listSubmissions({ from: YESTERDAY, to: TODAY, batchIds: ['ele-s1u1'] });
    expect(list.map((s) => s.id).sort()).toEqual(['today-local', 'y1']);
    expect(await repos.attendance.listSubmissions({ from: YESTERDAY, to: TODAY, batchIds: [] })).toEqual([]);
  });

  it('falls back to the last server rows cached on the device (per query) plus local rows when the server is unreachable', async () => {
    const cacheStore = new MemoryStore();
    const first = setup({ cacheStore });
    first.client.seed('submissions', [{ ...submissionToRow(sub('ele-s1u1', 'srv-1')), server_timestamp: '2026-09-25T04:46:00Z' }]);
    const query = { from: YESTERDAY, to: TODAY };
    expect((await first.repos.attendance.listSubmissions(query)).map((s) => s.id)).toEqual(['srv-1']);

    // Later, on the same phone (a new page load: empty memory), the server cannot be reached.
    const later = setup({ cacheStore });
    later.client.offline = true;
    await later.repos.attendance.createSubmission(sub('ele-s1u2', 'offline-1'));
    expect((await later.repos.attendance.listSubmissions(query)).map((s) => s.id).sort()).toEqual(['offline-1', 'srv-1']);
    // A query never cached before still shows the device's own rows.
    expect((await later.repos.attendance.listSubmissions({ from: TODAY, to: TODAY })).map((s) => s.id)).toEqual(['offline-1']);
  });

  it('does not touch the network while the device is offline', async () => {
    const { client, repos, state } = setup();
    state.online = false;
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    await repos.attendance.getSubmission(`ele-s1u1.${TODAY}.daily`);
    expect(client.calls).toEqual([]);
  });

  it('markSubmissionSynced marks the device copy and makes the next read ask the server again', async () => {
    const { client, repos, bus } = setup();
    const seen: string[] = [];
    bus.subscribe(['attendance'], (t) => seen.push(t));
    await repos.attendance.createSubmission(sub('ele-s1u2', 'a'));
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    // The sync pushed it first (Task 17: a synced record the server does not have is dropped by a live read).
    expect((await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'))).ok).toBe(true);
    await repos.attendance.markSubmissionSynced('a', '2026-09-25T04:50:00.000Z');
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    expect(client.count('select', 'submissions')).toBe(2);
    expect((await repos.attendance.getSubmissionById('a'))).toMatchObject({ syncState: 'synced', serverTimestamp: '2026-09-25T04:50:00.000Z' });
    expect(seen.length).toBeGreaterThanOrEqual(2);
  });

  it('keeps drafts on the device and never drafts a locked session', async () => {
    const { client, repos } = setup();
    await repos.attendance.saveDraft({ sessionKey: `ele-s1u2.${TODAY}.daily`, marks: {}, updatedAt: 'x' });
    expect(await repos.attendance.getDraft(`ele-s1u2.${TODAY}.daily`)).toBeDefined();
    await repos.attendance.createSubmission(sub('ele-s1u1', 'a'));
    await repos.attendance.saveDraft({ sessionKey: `ele-s1u1.${TODAY}.daily`, marks: {}, updatedAt: 'x' });
    expect(await repos.attendance.getDraft(`ele-s1u1.${TODAY}.daily`)).toBeUndefined();
    expect(client.calls.filter((c) => c.op !== 'select')).toEqual([]);
  });
});

describe('SyncGateway on Supabase', () => {
  it('inserts a submission and returns the server time', async () => {
    const { client, repos } = setup();
    const result = await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'));
    expect(result).toEqual({ ok: true, value: { serverTimestamp: '2026-09-25T04:50:00.000Z' } });
    expect(client.rows('submissions')).toHaveLength(1);
    expect(client.rows('submissions')[0]).toMatchObject({ id: 'a', session_key: `ele-s1u2.${TODAY}.daily`, origin: 'app' });
  });

  it('treats a unique-key conflict with the same id as success (a retry after a lost answer)', async () => {
    const { client, repos } = setup();
    await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'));
    expect(await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'))).toEqual({ ok: true, value: { serverTimestamp: '2026-09-25T04:50:00.000Z' } });
    expect(client.rows('submissions')).toHaveLength(1);
  });

  it('rejects when someone else submitted the session first (same key, different id)', async () => {
    const { client, repos } = setup();
    client.seed('submissions', [{ ...submissionToRow(sub('ele-s1u2', 'theirs')), server_timestamp: '2026-09-25T04:40:00Z' }]);
    expect(await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'mine'))).toEqual({ ok: false, error: 'rejected' });
  });

  it('answers network when the server cannot be reached, the device is offline, or the demo fails the next sync', async () => {
    const { client, repos, state } = setup();
    client.offline = true;
    expect(await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'))).toEqual({ ok: false, error: 'network' });
    client.offline = false;
    state.online = false;
    expect(await repos.syncGateway.pushStaffRecord(staffRecord('st-rajesh', 's1'))).toEqual({ ok: false, error: 'network' });
    state.online = true;
    state.blocked = true;
    expect(await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'))).toEqual({ ok: false, error: 'network' });
    expect(client.count('insert')).toBe(1);
  });

  it('keeps a record the server refuses outright (RLS or a missing parent) for another try: only a conflict is final', async () => {
    const { client, repos } = setup();
    client.failNextWrite = { kind: 'server', code: '42501', message: 'denied', status: 401 };
    expect(await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'))).toEqual({ ok: false, error: 'network' });
    expect((await repos.syncGateway.pushSubmission(sub('ele-s1u2', 'a'))).ok).toBe(true);
  });

  it('pushes staff records with the same write-once rules (one per person per day)', async () => {
    const { client, repos, clock } = setup();
    expect(await repos.syncGateway.pushStaffRecord(staffRecord('st-rajesh', 's1'))).toEqual({ ok: true, value: { serverTimestamp: clock.now().toISOString() } });
    expect((await repos.syncGateway.pushStaffRecord(staffRecord('st-rajesh', 's1'))).ok).toBe(true);
    expect(await repos.syncGateway.pushStaffRecord(staffRecord('st-rajesh', 's2', { source: 'principal', markedBy: 'st-anil' }))).toEqual({ ok: false, error: 'rejected' });
    expect(client.rows('staff_attendance')).toHaveLength(1);
  });
});

describe('StaffAttendanceRepository on Supabase', () => {
  it('merges the server\'s records with the device\'s unsynced ones; a local pending record wins', async () => {
    const { client, repos } = setup();
    client.seed('staff_attendance', [staffRecordToRow(staffRecord('st-sunita', 'srv-s')), staffRecordToRow(staffRecord('st-rajesh', 'srv-r', { status: 'absent', source: 'principal', markedBy: 'st-anil' }))]);
    await repos.staffAttendance.create(staffRecord('st-rajesh', 'mine'));
    const day = await repos.staffAttendance.listForDate(TODAY);
    expect(Object.fromEntries(day.map((r) => [r.staffId, r.id]))).toEqual({ 'st-sunita': 'srv-s', 'st-rajesh': 'mine' });
    expect((await repos.staffAttendance.get('st-sunita', TODAY))?.syncState).toBe('synced');
    expect((await repos.staffAttendance.get('st-rajesh', TODAY))?.id).toBe('mine');
    expect(await repos.staffAttendance.create(staffRecord('st-rajesh', 'again'))).toMatchObject({ ok: false, error: 'already_marked' });
    const range = await repos.staffAttendance.listBetween(['st-sunita'], YESTERDAY, TODAY);
    expect(range.map((r) => r.id)).toEqual(['srv-s']);
    expect(client.count('insert')).toBe(0);
  });

  it('markSynced marks the device copy', async () => {
    const { repos } = setup();
    await repos.staffAttendance.create(staffRecord('st-rajesh', 'mine'));
    await repos.staffAttendance.markSynced('mine');
    expect((await repos.staffAttendance.getById('mine'))?.syncState).toBe('synced');
  });
});

describe('CorrectionRepository on Supabase', () => {
  const parent = sub('ele-s1u2', 'att-1');

  it('appends on the device and inserts on the server when online', async () => {
    const { client, repos } = setup();
    client.seed('submissions', [{ ...submissionToRow(parent), server_timestamp: '2026-09-25T04:46:00Z' }]);
    await repos.corrections.append(correction('att-1', 'c1'));
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']);
    expect(repos.corrections.pendingCount()).toBe(0);
    expect((await repos.corrections.listForAttendance(['att-1'])).map((c) => c.correctionId)).toEqual(['c1']);
  });

  it('queues the correction while offline and sends it on reconnect', async () => {
    const { client, repos, state } = setup();
    client.seed('submissions', [{ ...submissionToRow(parent), server_timestamp: '2026-09-25T04:46:00Z' }]);
    state.online = false;
    await repos.corrections.append(correction('att-1', 'c1'));
    expect(client.rows('corrections')).toEqual([]);
    expect(repos.corrections.pendingCount()).toBe(1);
    expect((await repos.corrections.listBetween(TODAY, TODAY)).map((c) => c.correctionId)).toEqual(['c1']);
    state.online = true;
    await repos.corrections.flush();
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']);
    expect(repos.corrections.pendingCount()).toBe(0);
  });

  it('waits for its submission: a correction syncs only after the submission reached the server', async () => {
    const { client, repos } = setup();
    await repos.attendance.createSubmission(parent);
    await repos.corrections.append(correction('att-1', 'c1'));
    expect(repos.corrections.pendingCount()).toBe(1); // 23503: the submission is not on the server yet
    expect((await repos.syncGateway.pushSubmission(parent)).ok).toBe(true);
    await vi.waitFor(() => expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']));
    expect(repos.corrections.pendingCount()).toBe(0);
  });

  it('reads corrections made on other devices merged with this device\'s', async () => {
    const { client, repos, state } = setup();
    client.seed('submissions', [{ ...submissionToRow(parent), server_timestamp: '2026-09-25T04:46:00Z' }]);
    client.seed('corrections', [correctionToRow(correction('att-1', 'theirs'))]);
    state.online = false;
    await repos.corrections.append(correction('att-1', 'mine'));
    state.online = true;
    client.offline = true; // the queue cannot drain, the reads fall back
    expect((await repos.corrections.listForAttendance(['att-1'])).map((c) => c.correctionId)).toEqual(['mine']);
    client.offline = false;
    state.elapsed += 60_000;
    const merged = await repos.corrections.listForAttendance(['att-1', 'other']);
    expect(merged.map((c) => c.correctionId).sort()).toEqual(['mine', 'theirs']);
    expect(merged.find((c) => c.correctionId === 'theirs')?.timestamp).toBe(`${TODAY}T06:00:00.000Z`);
  });
});

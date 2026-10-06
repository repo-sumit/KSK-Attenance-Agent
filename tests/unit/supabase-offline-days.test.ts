/**
 * Task 10 fix round 1 (D-143): offline-first across a day change and a lost race.
 * - The daily reseed keeps what only the device holds (queue, unsynced records, its corrections) in the Supabase mode.
 * - The master data's device copy survives a new day, so an offline phone still signs in.
 * - A record someone else submitted first is marked `rejected`: never pushed again, and reads show the server's copy.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttendanceSubmission } from '@/domain/attendance';
import { EventBus } from '@/lib/events';
import { MemoryStore, type KeyValueStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase } from '@/repositories/mock/database';
import { submissionToRow } from '@/repositories/supabase/mappers';
import { ServerReadCache } from '@/repositories/supabase/read-cache';
import { createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { SELF_FIRST_OFF, signIn, verify } from '../helpers/app';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const DAY1 = '2026-09-25';
const DAY2 = '2026-09-26';
const KEY = 'ele-s1u2.2026-09-25.daily';

function setup(opts: { store?: KeyValueStore; cacheStore?: KeyValueStore; client?: FakeDataClient; day?: string; online?: boolean } = {}) {
  const clock = new FixedClock(instantAt(opts.day ?? DAY1, '10:15'));
  const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0, online: opts.online ?? true });
  const client = opts.client ?? new FakeDataClient();
  if (!opts.client) seedMasterData(client, DAY1);
  const store = opts.store ?? new MemoryStore();
  const cacheStore = opts.cacheStore ?? new MemoryStore();
  const app = createSupabaseContainer({ store, preferencesStore: new MemoryStore(), clock, simulation, client, cacheStore, configOverrides: { get: () => SELF_FIRST_OFF } });
  app.services.sync.start();
  return { app, client, clock, simulation, store, cacheStore };
}

async function lockOffline(env: ReturnType<typeof setup>) {
  const ctx = await signIn(env.app, 'TR-10432');
  await verify(env.app, ctx, KEY);
  const roster = await env.app.services.attendance.openRoster(ctx, KEY);
  if (!roster.ok) throw new Error(roster.error);
  env.simulation.update({ online: false });
  const result = await env.app.services.attendance.submit(ctx, KEY, roster.value.marks);
  if (!result.ok) throw new Error(result.error);
  await vi.waitFor(() => expect(env.app.services.sync.status()).toMatchObject({ pending: 1, online: false }));
  return ctx;
}

const idOf = (s: AttendanceSubmission | undefined) => {
  if (!s) throw new Error('missing submission');
  return s.id;
};

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('a new day in the Supabase mode', () => {
  it('keeps a submission locked offline, and pushes it the next day', async () => {
    const env = setup();
    await lockOffline(env);
    const id = idOf(await env.app.repositories.attendance.getSubmission(KEY));
    env.clock.set(instantAt(DAY2, '08:00'));
    expect(await env.app.repositories.offlineQueue.list()).toHaveLength(1);
    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
    expect(env.client.rows('submissions').map((r) => [r.id, r.session_key])).toEqual([[id, KEY]]);
  });

  it('keeps a staff record marked offline, and pushes it the next day', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    await env.app.services.verification.grant(ctx, { kind: 'self' });
    env.simulation.update({ online: false });
    const marked = await env.app.services.staffAttendance.markSelf(ctx);
    if (!marked.ok) throw new Error(marked.error);
    env.clock.set(instantAt(DAY2, '08:00'));
    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();
    expect(env.client.rows('staff_attendance').map((r) => [r.id, r.staff_id, r.date])).toEqual([[marked.value.id, 'st-rajesh', DAY1]]);
  });

  it('keeps only what the device alone holds; synced records, drafts and the session start afresh', () => {
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const db = new MockDatabase(new MemoryStore(), clock, new EventBus(), { seedServerData: false });
    db.ensureSeeded();
    const base = { address: { batchId: 'b', date: DAY1, slot: { kind: 'daily' as const } }, marks: {}, markedBy: 'st-rajesh', deviceTimestamp: '' };
    db.write('submissions', {
      'b.p': { ...base, id: 'p', sessionKey: 'b.p', syncState: 'pending' },
      'b.s': { ...base, id: 's', sessionKey: 'b.s', syncState: 'synced' },
      'b.r': { ...base, id: 'r', sessionKey: 'b.r', syncState: 'rejected' },
    });
    db.write('queue', [{ id: 'q1', kind: 'attendance_submission', recordId: 'p', label: 'b.p', enqueuedAt: '', attempts: 1, lastError: 'network' }]);
    const corr = { correctionId: 'c1', attendanceId: 's', studentId: 'x', oldMark: { status: 'present' }, newMark: { status: 'absent' }, reason: 'r', actorId: 'st-anil', timestamp: '' } as const;
    db.write('corrections', [corr]);
    db.write('drafts', { 'b.d': { sessionKey: 'b.d', marks: {}, updatedAt: '' } });
    db.write('session', { instituteId: 'inst-27410', staffId: 'st-rajesh', startedAt: '' });
    clock.set(instantAt(DAY2, '08:00'));
    expect(Object.keys(db.read('submissions')).sort()).toEqual(['b.p', 'b.r']);
    expect(db.read('queue').map((q) => q.id)).toEqual(['q1']);
    expect(db.read('corrections')).toEqual([corr]);
    expect(db.read('drafts')).toEqual({});
    expect(db.read('session')).toBeNull();
  });

  it('the mock source still starts each day from the demo story', () => {
    const clock = new FixedClock(instantAt(DAY1, '10:15'));
    const db = new MockDatabase(new MemoryStore(), clock, new EventBus());
    db.ensureSeeded();
    db.write('queue', [{ id: 'q1', kind: 'attendance_submission', recordId: 'p', label: 'b.p', enqueuedAt: '', attempts: 0 }]);
    clock.set(instantAt(DAY2, '08:00'));
    expect(db.read('queue')).toEqual([]);
  });
});

describe('offline sign-in on a new day', () => {
  it('signs in from yesterday\'s master data on the device when the server cannot be reached', async () => {
    const day1 = setup();
    await signIn(day1.app, 'TR-10432');
    const day2 = setup({ store: day1.store, cacheStore: day1.cacheStore, client: new FakeDataClient(), day: DAY2, online: false });
    const ctx = await signIn(day2.app, 'TR-10432');
    expect(ctx.user.id).toBe('st-rajesh');
    expect(ctx.data.students).toHaveLength(417);
    expect(day2.client.count('select')).toBe(0);
  });

  it('a pinned device copy is never pushed out by other recent queries', async () => {
    const store = new MemoryStore();
    const cache = new ServerReadCache({ store, maxPersisted: 2 });
    await cache.read('master:data:i:d1', async () => ({ ok: true as const, data: 'master' }), '', { persistAs: 'master:data:i', pinned: true });
    for (const k of ['a', 'b', 'c']) await cache.read(k, async () => ({ ok: true as const, data: k }), '');
    const offline = new ServerReadCache({ store });
    const network = async () => ({ ok: false as const, error: { kind: 'network' as const, message: 'offline' } });
    expect(await offline.read('master:data:i:d2', network, '', { persistAs: 'master:data:i', pinned: true })).toBe('master');
    expect(await offline.read('a', network, 'gone')).toBe('gone');
    expect(await offline.read('c', network, 'gone')).toBe('c');
  });
});

describe('someone else submitted the session first', () => {
  it('marks the device copy rejected, stops pushing it, and shows the server\'s copy', async () => {
    const env = setup();
    const ctx = await lockOffline(env);
    const mine = idOf(await env.app.repositories.attendance.getSubmission(KEY));
    const theirs = await env.app.repositories.attendance.getSubmission(KEY);
    if (!theirs) throw new Error('missing');
    env.client.seed('submissions', [{ ...submissionToRow({ ...theirs, id: 'att_theirs', markedBy: 'st-anil', syncState: 'synced' }), institute_id: 'inst-27410', server_timestamp: `${DAY1}T04:40:00Z` }]);
    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();

    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0, lastFailure: null });
    expect(await env.app.services.sync.pendingItems()).toEqual([]);
    expect(await env.app.repositories.offlineQueue.list()).toMatchObject([{ recordId: mine, attempts: 1, lastError: 'rejected' }]);
    expect(await env.app.repositories.attendance.getSubmissionById(mine)).toMatchObject({ syncState: 'rejected' });
    expect(await env.app.repositories.attendance.getSubmission(KEY)).toMatchObject({ id: 'att_theirs', syncState: 'synced' });
    const board = await env.app.services.attendance.boardForTrade(ctx, 'ele');
    expect(board.find((c) => c.key === KEY)?.submission?.pendingSync).toBe(false);
    const listed = await env.app.repositories.attendance.listSubmissions({ from: DAY1, to: DAY1 });
    expect(listed.filter((s) => s.sessionKey === KEY).map((s) => s.id)).toEqual(['att_theirs']);

    const inserts = env.client.count('insert', 'submissions');
    await env.app.services.sync.syncNow();
    expect(env.client.count('insert', 'submissions')).toBe(inserts);
    expect(env.client.rows('submissions').map((r) => r.id)).toEqual(['att_theirs']);
  });

  it('Task 15: is final and visible: not pending, not waiting on its Offline data row, and shown as not saved while the server copy cannot be read', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.packs.download(ctx, ['ele-s1u2'])).toMatchObject({ ok: true });
    await verify(env.app, ctx, KEY);
    const roster = await env.app.services.attendance.openRoster(ctx, KEY);
    if (!roster.ok) throw new Error(roster.error);
    env.simulation.update({ online: false });
    const locked = await env.app.services.attendance.submit(ctx, KEY, roster.value.marks);
    if (!locked.ok) throw new Error(locked.error);
    const mine = idOf(await env.app.repositories.attendance.getSubmission(KEY));
    env.client.seed('submissions', [{ ...submissionToRow({ ...(await env.app.repositories.attendance.getSubmission(KEY))!, id: 'att_theirs', markedBy: 'st-anil', syncState: 'synced' }), institute_id: 'inst-27410', server_timestamp: `${DAY1}T04:40:00Z` }]);
    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();
    expect(await env.app.repositories.attendance.getSubmissionById(mine)).toMatchObject({ syncState: 'rejected' });

    // Offline again: the server's copy cannot be read, so the device's own (rejected) copy is what the screens get.
    env.simulation.update({ online: false });
    expect(await env.app.repositories.attendance.getSubmission(KEY)).toMatchObject({ id: mine, syncState: 'rejected' });
    const card = (await env.app.services.attendance.boardForTrade(ctx, 'ele')).find((c) => c.key === KEY);
    expect(card?.submission).toMatchObject({ pendingSync: false, rejected: true });
    const row = (await env.app.services.packs.list(ctx)).find((r) => r.batch.id === 'ele-s1u2');
    expect(row).toMatchObject({ pendingSync: 0, rejected: 1 });
    await env.app.services.sync.reset();
    expect(env.app.services.sync.status()).toMatchObject({ pending: 0 });
  });

  it('does the same for a staff record the principal already marked on another device', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    await env.app.services.verification.grant(ctx, { kind: 'self' });
    env.simulation.update({ online: false });
    const marked = await env.app.services.staffAttendance.markSelf(ctx);
    if (!marked.ok) throw new Error(marked.error);
    env.client.seed('staff_attendance', [{ id: 'staff_theirs', institute_id: 'inst-27410', staff_id: 'st-rajesh', date: DAY1, status: 'absent', source: 'principal', marked_by: 'st-anil', device_timestamp: `${DAY1}T04:00:00Z` }]);
    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
    expect(await env.app.repositories.staffAttendance.getById(marked.value.id)).toMatchObject({ syncState: 'rejected' });
    expect(await env.app.repositories.staffAttendance.get('st-rajesh', DAY1)).toMatchObject({ id: 'staff_theirs', status: 'absent' });
  });
});

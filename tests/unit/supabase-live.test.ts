/** Task 10: Realtime follows the signed-in institute and turns server changes into the app's data topics. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataTopic } from '@/lib/events';
import { EventBus } from '@/lib/events';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { MockDatabase } from '@/repositories/mock/database';
import { MockSessionRepository } from '@/repositories/mock/repositories';
import { createSupabaseRepositories, LIVE_DEBOUNCE_MS } from '@/repositories/supabase';
import { FakeDataClient } from './supabase-fake';

const TODAY = '2026-09-25';
const session = (instituteId: string) => ({ instituteId, staffId: 'st-rajesh', startedAt: '2026-09-25T04:45:00.000Z' });

function setup() {
  const clock = new FixedClock(instantAt(TODAY, '10:15'));
  const bus = new EventBus();
  const db = new MockDatabase(new MemoryStore(), clock, bus, { seedServerData: false });
  const client = new FakeDataClient();
  const state = { elapsed: 0 };
  const repos = createSupabaseRepositories({ client, db, cacheStore: new MemoryStore(), bus, clock, isOnline: () => true, elapsedMs: () => state.elapsed });
  const sessions = repos.followSession(new MockSessionRepository(db));
  const topics: DataTopic[][] = [];
  const originalEmit = bus.emit.bind(bus);
  bus.emit = (...t: DataTopic[]) => {
    topics.push(t);
    originalEmit(...t);
  };
  return { bus, db, client, repos, sessions, topics, state };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('Realtime for the signed-in institute', () => {
  it('subscribes to the four published tables, filtered to the institute, when someone signs in', async () => {
    const { client, sessions } = setup();
    expect(client.active()).toHaveLength(0);
    await sessions.set(session('inst-27410'));
    expect(client.active()).toHaveLength(1);
    expect(client.active()[0].bindings).toEqual([
      { table: 'submissions', filter: 'institute_id=eq.inst-27410' },
      { table: 'corrections', filter: 'institute_id=eq.inst-27410' },
      { table: 'staff_attendance', filter: 'institute_id=eq.inst-27410' },
      { table: 'face_enrolment', filter: 'institute_id=eq.inst-27410' },
    ]);
  });

  it('emits the app\'s data topics for server changes, one emit per burst', async () => {
    const { client, sessions, topics } = setup();
    await sessions.set(session('inst-27410'));
    topics.length = 0;
    for (let i = 0; i < 50; i++) client.emitChange('submissions');
    expect(topics).toEqual([]);
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(topics).toEqual([['attendance']]);
    topics.length = 0;
    client.emitChange('corrections');
    client.emitChange('staff_attendance');
    client.emitChange('face_enrolment');
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(topics).toHaveLength(1);
    expect([...topics[0]].sort()).toEqual(['attendance', 'corrections', 'face', 'staff']);
  });

  it('drops the cached server rows of a changed table, so the refetch sees the change', async () => {
    const { client, sessions, repos } = setup();
    await sessions.set(session('inst-27410'));
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    expect(client.count('select', 'submissions')).toBe(1);
    client.emitChange('submissions');
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    expect(client.count('select', 'submissions')).toBe(2);
  });

  it('scopes server reads to the signed-in institute', async () => {
    const { client, sessions, repos } = setup();
    await sessions.set(session('inst-27410'));
    await repos.attendance.listSubmissions({ from: TODAY, to: TODAY });
    expect(client.calls.at(-1)?.filters).toContainEqual({ column: 'institute_id', op: 'eq', value: 'inst-27410' });
  });

  it('unsubscribes on sign-out and ignores later changes', async () => {
    const { client, sessions, topics } = setup();
    await sessions.set(session('inst-27410'));
    client.emitChange('submissions');
    await sessions.clear();
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(client.active()).toHaveLength(0);
    topics.length = 0;
    client.emitChange('submissions');
    vi.advanceTimersByTime(LIVE_DEBOUNCE_MS);
    expect(topics.filter((t) => t.includes('attendance'))).toEqual([]);
  });

  it('follows a session restored on page load, and moves to another institute on a new sign-in', async () => {
    const { client, db, sessions } = setup();
    db.ensureSeeded(); // as on a page load: the device database exists before the session is read
    await new MockSessionRepository(db).set(session('inst-27410'));
    expect(client.active()).toHaveLength(0);
    await sessions.get();
    expect(client.active()[0]?.channel).toContain('inst-27410');
    await sessions.get();
    expect(client.subscriptions).toHaveLength(1);
    await sessions.set(session('inst-27613'));
    expect(client.active()).toHaveLength(1);
    expect(client.active()[0].channel).toContain('inst-27613');
  });
});

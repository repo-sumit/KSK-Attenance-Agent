/**
 * Offline for every user (D-153) on the Supabase source: the waiting list names what the count counts. Corrections in
 * the device outbox are listed (kind `correction`, labelled with the student) after the queued records, in the order
 * they will be sent, and leave the list once the server has them.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Correction } from '@/domain/attendance';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { submissionToRow } from '@/repositories/supabase/mappers';
import { createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { SELF_FIRST_OFF, signIn } from '../helpers/app';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25';
const PUNE = 'inst-27410';

const correction = (id: string, studentId: string, minute: string): Correction => ({
  correctionId: id,
  attendanceId: 'att-1',
  studentId,
  oldMark: { status: 'present' },
  newMark: { status: 'absent' },
  reason: 'Fixed',
  actorId: 'st-anil',
  timestamp: instantAt(TODAY, `10:${minute}`).toISOString(),
});

function setup() {
  const client = new FakeDataClient();
  seedMasterData(client, TODAY);
  client.seed('submissions', [
    {
      ...submissionToRow({ id: 'att-1', sessionKey: `ele-s1u2.${TODAY}.daily`, address: { batchId: 'ele-s1u2', date: TODAY, slot: { kind: 'daily' } }, marks: {}, markedBy: 'st-rajesh', deviceTimestamp: `${TODAY}T04:45:00.000Z`, syncState: 'synced' }),
      institute_id: PUNE,
      server_timestamp: `${TODAY}T04:46:00Z`,
    },
  ]);
  const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 });
  const app = createSupabaseContainer({
    store: new MemoryStore(),
    preferencesStore: new MemoryStore(),
    clock: new FixedClock(instantAt(TODAY, '10:15')),
    simulation,
    client,
    cacheStore: new MemoryStore(),
    configOverrides: { get: () => SELF_FIRST_OFF },
  });
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

describe('the correction outbox in the waiting list (D-153, amends D-064)', () => {
  it('the repository lists its outbox in send order: id, student, when', async () => {
    const { app, client } = setup();
    client.offline = true;
    await app.repositories.corrections.append(correction('c1', 'ele-s1u2-r03', '01'));
    await app.repositories.corrections.append(correction('c2', 'ele-s1u2-r01', '02'));
    const outbox = app.repositories.corrections as unknown as { pendingItems(): unknown };
    expect(outbox.pendingItems()).toEqual([
      { id: 'c1', label: 'ele-s1u2-r03', at: instantAt(TODAY, '10:01').toISOString() },
      { id: 'c2', label: 'ele-s1u2-r01', at: instantAt(TODAY, '10:02').toISOString() },
    ]);
  });

  it('SyncService lists queued records first, then waiting corrections, as many as it counts; synced, both go', async () => {
    const { app, client, simulation } = setup();
    const principal = await signIn(app, 'PR-2741');
    simulation.update({ online: false });
    const saved = await app.services.staffAttendance.markByPrincipal(principal, [{ staffId: 'st-rajesh', status: 'absent' }]);
    expect(saved).toMatchObject({ ok: true, value: { saved: 1 } });
    client.offline = true;
    await app.repositories.corrections.append(correction('c1', 'ele-s1u2-r03', '01'));

    const items = await app.services.sync.pendingItems();
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['staff_attendance', 'st-rajesh'],
      ['correction', 'ele-s1u2-r03'],
    ]);
    expect(items[1]).toMatchObject({ id: 'c1', recordId: 'c1', enqueuedAt: instantAt(TODAY, '10:01').toISOString() });
    expect(app.services.sync.status().pending).toBe(items.length);

    client.offline = false;
    simulation.update({ online: true });
    await app.services.sync.syncNow();
    expect(await app.services.sync.pendingItems()).toEqual([]);
    expect(app.services.sync.status()).toMatchObject({ pending: 0 });
    expect(client.rows('corrections').map((r) => r.correction_id)).toEqual(['c1']);
    expect(client.rows('staff_attendance').filter((r) => r.staff_id === 'st-rajesh' && r.date === TODAY)).toHaveLength(1);
  });
});

/**
 * Own attendance first (D-152) on the Supabase source, with Maharashtra's default (no SELF_FIRST_OFF): the gate reads
 * the merged staff records, so an own mark still waiting on this device (offline) and one only on the server (made on
 * another device) both open the roster, and no own mark keeps it closed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { createSupabaseContainer } from '@/services/container';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { signIn, verify } from '../helpers/app';
import { FakeDataClient, seedMasterData } from './supabase-fake';

const TODAY = '2026-09-25';
const PUNE = 'inst-27410';
const KEY = `ele-s1u2.${TODAY}.daily`;

function setup() {
  const client = new FakeDataClient();
  seedMasterData(client, TODAY);
  const simulation = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 });
  const app = createSupabaseContainer({
    store: new MemoryStore(),
    preferencesStore: new MemoryStore(),
    clock: new FixedClock(instantAt(TODAY, '10:15')),
    simulation,
    client,
    cacheStore: new MemoryStore(),
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

describe('own attendance first on the Supabase source (D-152, D-153)', () => {
  it('the rule is on (Maharashtra): no own mark, no roster', async () => {
    const { app } = setup();
    const ctx = await signIn(app, 'TR-10432');
    expect(ctx.journey.staff.selfFirst).toBe(true);
    await verify(app, ctx, KEY);
    expect(await app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'self_first' });
  });

  it('an own mark still waiting offline on this device opens the roster, and the batch submits offline', async () => {
    const { app, client, simulation } = setup();
    const ctx = await signIn(app, 'TR-10432');
    expect(await app.services.packs.download(ctx, ['ele-s1u2'])).toMatchObject({ ok: true, value: 1 }); // before going offline
    simulation.update({ online: false });
    client.offline = true;
    await verify(app, ctx, KEY);
    expect(await app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'self_first' });

    await app.services.verification.grant(ctx, { kind: 'self' });
    expect((await app.services.staffAttendance.markSelf(ctx)).ok).toBe(true);
    expect((await app.services.sync.pendingItems()).map((i) => i.kind)).toContain('staff_attendance');
    expect(client.rows('staff_attendance')).toEqual([]); // only on this device

    const roster = await app.services.attendance.openRoster(ctx, KEY);
    if (!roster.ok) throw new Error(roster.error);
    expect((await app.services.attendance.submit(ctx, KEY, roster.value.marks)).ok).toBe(true);
  });

  it('an own mark made on another device (a server row only) opens the roster here', async () => {
    const { app, client } = setup();
    client.seed('staff_attendance', [
      { id: 'other-device', staff_id: 'st-rajesh', date: TODAY, status: 'present', source: 'self', marked_by: 'st-rajesh', device_timestamp: `${TODAY}T03:30:00.000Z`, location: null, institute_id: PUNE },
    ]);
    const ctx = await signIn(app, 'TR-10432');
    await verify(app, ctx, KEY);
    expect(await app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: true });
  });
});

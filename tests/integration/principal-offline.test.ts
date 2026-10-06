/**
 * Offline for every user, the principal included (D-153). Packs exist only where the user can mark students
 * (`journey.offline.packs`), so the offline section never exposes a batch the user could not mark online (INV-25);
 * offline marking goes through the same window and verification rules; staff marks saved offline are queued, named
 * and synced on reconnect.
 */
import { describe, expect, it } from 'vitest';
import { setup, signIn, verify } from '../helpers/app';

const flush = () => new Promise((r) => setTimeout(r, 0));
const PACKED = 'ele-s1u2.2026-09-25.daily'; // seeded pack on this device (device-wide packs)
const UNPACKED = 'md-s1u1.2026-09-25.daily';

describe('principal offline (D-153)', () => {
  it('the principal may download any institute batch; with principalCanMarkStudents off, none (no_access)', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    expect(ctx.journey.offline).toMatchObject({ enabled: true, packs: true });
    expect(env.app.services.packs.downloadable(ctx).length).toBe(ctx.data.batches.length);
    expect(await env.app.services.packs.download(ctx, ['md-s1u1'])).toMatchObject({ ok: true, value: 1 });
    expect((await env.app.services.packs.list(ctx)).map((r) => r.batch.id)).toContain('md-s1u1');

    env.setConfig({ identity: { principalCanMarkStudents: false } });
    const noStudents = await signIn(env.app, 'PR-2741');
    expect(noStudents.journey.offline).toMatchObject({ enabled: true, packs: false });
    expect(env.app.services.packs.downloadable(noStudents)).toEqual([]);
    expect(await env.app.services.packs.list(noStudents)).toEqual([]);
    expect(await env.app.services.packs.download(noStudents, ['md-s1u2'])).toMatchObject({ ok: false, error: 'no_access' });
    expect(await env.app.services.packs.refreshAll(noStudents)).toMatchObject({ ok: false, error: 'no_access' });
    expect(await env.app.services.packs.refreshBatch(noStudents, 'ele-s1u2')).toMatchObject({ ok: false, error: 'no_access' });
  });

  it('offline, the principal opens a downloaded batch after verification; a batch not on the phone is not_downloaded', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    await verify(env.app, ctx, PACKED);
    env.simulation.update({ online: false });
    const roster = await env.app.services.attendance.openRoster(ctx, PACKED);
    expect(roster.ok).toBe(true);
    expect(await env.app.services.attendance.openRoster(ctx, UNPACKED)).toMatchObject({ ok: false, error: 'not_downloaded' });
    if (!roster.ok) return;
    expect(await env.app.services.attendance.submit(ctx, PACKED, roster.value.marks)).toMatchObject({ ok: true });
    await flush();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'pending', pending: 1, online: false });
  });

  it('offline staff marks are queued, named by the staff member, and synced on reconnect', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    env.simulation.update({ online: false });
    const saved = await env.app.services.staffAttendance.markByPrincipal(ctx, [
      { staffId: 'st-rajesh', status: 'absent' },
      { staffId: 'st-sanjay', status: 'present' },
    ]);
    expect(saved).toMatchObject({ ok: true, value: { saved: 2, skipped: [] } });
    await flush();
    const items = await env.app.services.sync.pendingItems();
    expect(items.map((i) => [i.kind, i.label])).toEqual([
      ['staff_attendance', 'st-rajesh'],
      ['staff_attendance', 'st-sanjay'],
    ]);
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'pending', pending: 2, online: false });

    env.simulation.update({ online: true });
    for (let i = 0; i < 10 && env.app.services.sync.status().phase !== 'synced'; i++) await flush();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
    expect(await env.app.services.sync.pendingItems()).toEqual([]);
    const day = await env.app.services.staffAttendance.day(ctx);
    expect(day.find((r) => r.member.id === 'st-rajesh')?.record).toMatchObject({ status: 'absent', syncState: 'synced' });
  });
});

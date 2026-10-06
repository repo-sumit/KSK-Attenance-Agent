/**
 * Own attendance before students (D-152): the rule holds in the service, for opening and for submit, and a recent
 * self pass opens a batch without a second check only inside the configured minutes, on the same day, and only when
 * the batch needs no check the self pass did not include.
 */
import { describe, expect, it, vi } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { addDays, instantAt } from '@/lib/time';
import type { SessionContext } from '@/services/context';
import type { VerificationEvent } from '@/services/verification';
import { setup, signIn, TODAY, verify } from '../helpers/app';

const RULE_ON: ConfigLayer = { staff: { selfBeforeStudents: true }, verification: { selfPassReuseMinutes: 10 } };
const KEY = `ele-s1u2.${TODAY}.daily`;
const session = { kind: 'session', key: KEY } as const;

async function markSelf(env: ReturnType<typeof setup>, ctx: SessionContext) {
  const loc = await env.app.services.verification.checkLocation(ctx);
  await env.app.services.verification.grant(ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
  const saved = await env.app.services.staffAttendance.markSelf(ctx);
  if (!saved.ok) throw new Error(saved.error);
}

describe('own attendance before students: the rule (D-152)', () => {
  it('refuses opening and submitting a batch until the trainer’s own attendance is marked', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    const { attendance } = env.app.services;
    expect(await attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'self_first' });
    // a session pass does not get round it, and submit refuses too (hiding a button is never the only guard)
    await verify(env.app, ctx, KEY);
    expect(await attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'self_first' });
    const students = ctx.data.students.filter((s) => s.batchId === 'ele-s1u2');
    const marks = Object.fromEntries(students.map((s) => [s.id, { status: 'present' as const }]));
    expect(await attendance.submit(ctx, KEY, marks)).toMatchObject({ ok: false, error: 'self_first' });

    await markSelf(env, ctx);
    expect((await attendance.openRoster(ctx, KEY)).ok).toBe(true);
    expect((await attendance.submit(ctx, KEY, marks)).ok).toBe(true);
  });

  it('flags the open batches it blocks on the board, and only those', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    const board = await env.app.services.attendance.boardForTrade(ctx, 'ele');
    const byId = Object.fromEntries(board.map((c) => [c.batch.id, c]));
    expect(byId['ele-s1u2']).toMatchObject({ status: 'open', canMark: true, selfFirst: true });
    expect(byId['ele-s2u1'].selfFirst).toBeFalsy(); // opens later: says when, not "mark yours first"
    expect(byId['ele-s1u1'].selfFirst).toBeFalsy(); // submitted
    await markSelf(env, ctx);
    const after = await env.app.services.attendance.boardForTrade(ctx, 'ele');
    expect(after.some((c) => c.selfFirst)).toBe(false);
  });

  it('a principal’s mark for the trainer counts as their own record', async () => {
    const env = setup(RULE_ON);
    const principal = await signIn(env.app, 'PR-2741');
    expect((await env.app.services.staffAttendance.markByPrincipal(principal, [{ staffId: 'st-rajesh', status: 'present' }])).ok).toBe(true);
    const ctx = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'not_verified' });
  });

  it('leaves the principal exactly as before: no rule, and no self pass reuse even when a self pass exists', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'PR-2741');
    expect(ctx.journey.staff.selfFirst).toBe(false);
    expect(ctx.journey.staff.selfCard).toBe(false); // the principal has no own attendance in the journey
    expect(await env.app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'not_verified' });
    expect((await env.app.services.attendance.boardForTrade(ctx, 'ele')).some((c) => c.selfFirst)).toBe(false);
    // Even with a self pass from a minute ago, the principal's class check is the usual one.
    const loc = await env.app.services.verification.checkLocation(ctx);
    await env.app.services.verification.grant(ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    expect(await env.app.services.verification.reuseSelfPass(ctx, session)).toBe(false);
    expect(await env.app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'not_verified' });
  });

  it('reads the trainer’s own record once per submit and once per board', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    await markSelf(env, ctx);
    await verify(env.app, ctx, KEY);
    const reads = vi.spyOn(env.app.repositories.staffAttendance, 'get');
    await env.app.services.attendance.boardForTrade(ctx, 'ele');
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockClear();
    const students = ctx.data.students.filter((s) => s.batchId === 'ele-s1u2');
    const marks = Object.fromEntries(students.map((s) => [s.id, { status: 'present' as const }]));
    expect((await env.app.services.attendance.submit(ctx, KEY, marks)).ok).toBe(true);
    expect(reads).toHaveBeenCalledTimes(1);
  });

  it('is off when configured off', async () => {
    const env = setup({ staff: { selfBeforeStudents: false } });
    const ctx = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'not_verified' });
  });
});

describe('one check, not two: a recent self pass opens the next batch (D-152)', () => {
  it('grants the session pass inside the window and announces it like a normal pass', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    await markSelf(env, ctx);
    env.clock.set(instantAt(TODAY, '10:25'));
    const events: VerificationEvent[] = [];
    env.app.services.verification.subscribe((e) => events.push(e));
    expect(await env.app.services.verification.reuseSelfPass(ctx, session)).toBe(true);
    expect(events).toEqual([{ type: 'granted', purpose: `session:${KEY}` }]);
    const roster = await env.app.services.attendance.openRoster(ctx, KEY);
    expect(roster.ok).toBe(true);
    // the submission carries the location the self check captured
    if (!roster.ok) return;
    const saved = await env.app.services.attendance.submit(ctx, KEY, roster.value.marks);
    expect(saved.ok && saved.value.location).toBeTruthy();
  });

  it('a reused pass is never authority on its own: before the own mark is saved, the roster still answers self_first', async () => {
    // The self check passed, but the trainer left before the own mark was saved.
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    const loc = await env.app.services.verification.checkLocation(ctx);
    await env.app.services.verification.grant(ctx, { kind: 'self' }, loc.ok ? loc.value : undefined);
    await env.app.services.verification.reuseSelfPass(ctx, session);
    expect(await env.app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'self_first' });
    const students = ctx.data.students.filter((s) => s.batchId === 'ele-s1u2');
    const marks = Object.fromEntries(students.map((s) => [s.id, { status: 'present' as const }]));
    expect(await env.app.services.attendance.submit(ctx, KEY, marks)).toMatchObject({ ok: false, error: 'self_first' });
  });

  it('not after the window', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    await markSelf(env, ctx);
    env.clock.set(instantAt(TODAY, '10:26'));
    expect(await env.app.services.verification.reuseSelfPass(ctx, session)).toBe(false);
    expect(await env.app.services.attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'not_verified' });
  });

  it('not across days', async () => {
    // five minutes apart, but the self check was yesterday
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    env.clock.set(instantAt(TODAY, '23:58'));
    await markSelf(env, ctx);
    env.clock.set(instantAt(addDays(TODAY, 1), '00:03'));
    const tomorrow = { kind: 'session', key: `ele-s1u2.${addDays(TODAY, 1)}.daily` } as const;
    expect(await env.app.services.verification.reuseSelfPass(ctx, tomorrow)).toBe(false);
  });

  it('not when the batch needs a check the self check did not include', async () => {
    const env = setup({ ...RULE_ON, verification: { selfPassReuseMinutes: 10, face: false } });
    const before = await signIn(env.app, 'TR-10432');
    await markSelf(env, before);
    env.setConfig(RULE_ON); // face is on again (Maharashtra)
    const ctx = await signIn(env.app, 'TR-10432');
    expect(ctx.journey.verification.face).toBe(true);
    expect(await env.app.services.verification.reuseSelfPass(ctx, session)).toBe(false);
  });

  it('0 minutes turns reuse off, and a self pass is never reused for the self check itself', async () => {
    const env = setup({ ...RULE_ON, verification: { selfPassReuseMinutes: 0 } });
    const ctx = await signIn(env.app, 'TR-10432');
    await markSelf(env, ctx);
    expect(await env.app.services.verification.reuseSelfPass(ctx, session)).toBe(false);
    env.setConfig(RULE_ON);
    const on = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.verification.reuseSelfPass(on, { kind: 'self' })).toBe(false);
    expect(await env.app.services.verification.reuseSelfPass(on, session)).toBe(true);
  });
});

describe('own attendance first, offline (D-152 with D-153)', () => {
  it('offline on a downloaded batch: refused before the own mark; after an offline self mark both save, and both sync on reconnect', async () => {
    const env = setup(RULE_ON);
    const ctx = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.packs.download(ctx, ['ele-s1u2'])).toMatchObject({ ok: true, value: 1 });
    env.simulation.update({ online: false });
    await verify(env.app, ctx, KEY);
    const { attendance } = env.app.services;
    const students = ctx.data.students.filter((s) => s.batchId === 'ele-s1u2');
    const marks = Object.fromEntries(students.map((s) => [s.id, { status: 'present' as const }]));
    expect(await attendance.openRoster(ctx, KEY)).toMatchObject({ ok: false, error: 'self_first' });
    expect(await attendance.submit(ctx, KEY, marks)).toMatchObject({ ok: false, error: 'self_first' });

    await markSelf(env, ctx); // saved on this device, waiting to sync
    expect((await env.app.services.sync.pendingItems()).map((i) => i.kind)).toEqual(['staff_attendance']);
    const roster = await attendance.openRoster(ctx, KEY);
    if (!roster.ok) throw new Error(roster.error);
    expect((await attendance.submit(ctx, KEY, roster.value.marks)).ok).toBe(true);
    expect(await env.app.services.sync.pendingItems()).toHaveLength(2);

    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();
    expect(await env.app.services.sync.pendingItems()).toEqual([]);
    expect((await env.app.repositories.attendance.getSubmission(KEY))?.syncState).toBe('synced');
  });
});

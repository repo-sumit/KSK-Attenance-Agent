import { beforeEach, describe, expect, it } from 'vitest';
import { createMockContainer, type AppContainer } from '@/services/container';
import type { SessionContext } from '@/services/context';
import { rankStandings } from '@/services/reports';
import { DEFAULT_SIMULATION, StaticSimulationSource } from '@/services/simulation';
import { MemoryStore } from '@/lib/kv-store';
import { FixedClock, instantAt } from '@/lib/time';
import { SELF_FIRST_OFF, setup, signIn, TODAY, verify } from '../helpers/app';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('login (PRD §6)', () => {
  it('accepts a Trainer ID typed without the hyphen or with a space', async () => {
    const env = setup();
    const inst = await env.app.services.auth.lookupInstitute('27410');
    if (!inst.ok) throw new Error('institute');
    for (const typed of ['tr10432', 'TR 10432', 'TR–10432', ' TR-10432 ']) {
      expect(await env.app.services.auth.lookupInstructor(inst.value.id, typed)).toMatchObject({ ok: true, value: { id: 'st-rajesh' } });
    }
    expect(await env.app.services.auth.lookupInstructor(inst.value.id, 'T10432')).toMatchObject({ error: 'invalid_format' });
  });

  it('finds the institute, then an instructor scoped to it', async () => {
    const { app } = setup();
    const inst = await app.services.auth.lookupInstitute('27410');
    expect(inst).toMatchObject({ ok: true, value: { name: 'Government Industrial Training Institute, Pune' } });
    expect(await app.services.auth.lookupInstitute('27499')).toMatchObject({ ok: false, error: 'not_found' });
    if (!inst.ok) return;
    expect((await app.services.auth.lookupInstructor(inst.value.id, 'tr-10432')).ok).toBe(true);
    // Valid in the state (Nashik) but not at this institute → treated as not found.
    expect(await app.services.auth.lookupInstructor(inst.value.id, 'TR-20411')).toMatchObject({ ok: false, error: 'not_found' });
  });
});

describe('marking, submit and lock (PRD §9, §12.1)', () => {
  let env: ReturnType<typeof setup>;
  let ctx: SessionContext;
  beforeEach(async () => {
    env = setup();
    ctx = await signIn(env.app, 'TR-10432');
  });

  it('shows open, future and submitted sessions for the trade', async () => {
    const cards = await env.app.services.attendance.boardForTrade(ctx, 'ele');
    const status = Object.fromEntries(cards.map((c) => [c.batch.id, c.status]));
    expect(status).toMatchObject({ 'ele-s1u1': 'submitted', 'ele-s1u2': 'open', 'ele-s2u1': 'future' });
  });

  it('refuses the roster before verification, then locks after one submit', async () => {
    const key = 'ele-s1u2.2026-09-25.daily';
    expect(await env.app.services.attendance.openRoster(ctx, key)).toMatchObject({ ok: false, error: 'not_verified' });
    await verify(env.app, ctx, key);
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    expect(Object.values(roster.value.marks).every((m) => m.status === 'present')).toBe(true);
    const marks = { ...roster.value.marks, [roster.value.students[2].id]: { status: 'absent' as const } };
    const first = await env.app.services.attendance.submit(ctx, key, marks);
    expect(first.ok).toBe(true);
    expect(await env.app.services.attendance.submit(ctx, key, marks)).toMatchObject({ ok: false, error: 'already_submitted' });
    expect(await env.app.services.attendance.openRoster(ctx, key)).toMatchObject({ ok: false, error: 'already_submitted' });
    const detail = await env.app.services.attendance.getDetail(ctx, key);
    expect(detail?.card.submission?.counts).toMatchObject({ present: 30, absent: 1 });
  });

  it('refuses batches outside the time window and outside the mapping', async () => {
    env.setConfig({ mapping: { model: 'batch' } });
    const batchCtx = await env.app.services.session.load();
    expect(await env.app.services.attendance.openRoster(batchCtx!, 'ele-s2u1.2026-09-25.daily')).toMatchObject({ error: 'window_not_open' });
    expect(await env.app.services.attendance.openRoster(batchCtx!, 'ele-s1u2.2026-09-25.daily')).toMatchObject({ error: 'no_access' });
  });

  it('keeps a draft across reloads', async () => {
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error();
    const id = roster.value.students[0].id;
    await env.app.services.attendance.saveDraft(ctx, key, { ...roster.value.marks, [id]: { status: 'absent' } });
    const again = await env.app.services.attendance.openRoster(ctx, key);
    expect(again.ok && again.value.marks[id].status).toBe('absent');
  });

  it('saveDraft keeps the stored sources of unchanged marks (a voice mark stays the trainer\'s), drops a changed one (D1)', async () => {
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    const [a, b] = roster.value.students.filter((st) => roster.value.marks[st.id].status !== 'ojt').map((st) => st.id);
    const { drafts } = env.app.services;
    drafts.open(ctx, roster.value);
    drafts.setMark(key, a, { status: 'absent' }, { via: 'voice', heard: 'absent' });
    drafts.setMark(key, b, { status: 'absent' }, { via: 'tap' });
    await drafts.flush(key);
    const marks = { ...drafts.get(key)!.marks, [b]: { status: 'present' as const } };
    await env.app.services.attendance.saveDraft(ctx, key, marks);
    const stored = await env.app.repositories.attendance.getDraft(key);
    expect(stored?.sources).toEqual({ [a]: { via: 'voice', at: expect.any(String) } });
    expect(stored?.marks[b]).toEqual({ status: 'present' });
  });
});

describe('offline marking and sync (PRD §20)', () => {
  it('locks locally offline, then syncs automatically on reconnect', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    env.simulation.update({ online: false });
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    const sub = await env.app.services.attendance.submit(ctx, key, roster.value.marks);
    expect(sub.ok).toBe(true);
    await flush();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'pending', pending: 1, online: false });
    expect(await env.app.services.attendance.submit(ctx, key, roster.value.marks)).toMatchObject({ error: 'already_submitted' });
    env.simulation.update({ online: true });
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
    expect((await env.app.repositories.attendance.getSubmission(key))?.syncState).toBe('synced');
  });

  it('sends records left by an earlier visit as soon as the app opens online', async () => {
    const store = new MemoryStore();
    const clock = new FixedClock(instantAt(TODAY, '10:15'));
    const offline = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0, online: false });
    const first = createMockContainer({ store, preferencesStore: new MemoryStore(), clock, simulation: offline, configOverrides: { get: () => SELF_FIRST_OFF } });
    first.services.sync.start();
    const ctx = await signIn(first, 'TR-10432');
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(first, ctx, key);
    const roster = await first.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error(roster.error);
    await first.services.attendance.submit(ctx, key, roster.value.marks);
    first.services.sync.stop();

    const online = new StaticSimulationSource({ ...DEFAULT_SIMULATION, speed: 0 });
    const next = createMockContainer({ store, preferencesStore: new MemoryStore(), clock, simulation: online });
    next.services.sync.start();
    for (let i = 0; i < 10 && next.services.sync.status().phase !== 'synced'; i++) await flush();
    expect(next.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
    expect((await next.repositories.attendance.getSubmission(key))?.syncState).toBe('synced');
  });

  it('reports a failed sync and recovers on retry', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    env.simulation.update({ nextSyncFails: true });
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error();
    await env.app.services.attendance.submit(ctx, key, roster.value.marks);
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status().phase).toBe('failed');
    env.simulation.update({ nextSyncFails: false });
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0 });
  });

  it('remembers when the last attempt failed and who started it, until one succeeds (Home: "Auto-sync failed at…")', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    expect(env.app.services.sync.status().lastFailure).toBeNull();
    env.simulation.update({ nextSyncFails: true });
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error();
    await env.app.services.attendance.submit(ctx, key, roster.value.marks);
    await env.app.services.sync.syncNow('auto');
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'failed', pending: 1, lastFailure: { trigger: 'auto', at: instantAt(TODAY, '10:15').toISOString() } });
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status().lastFailure).toMatchObject({ trigger: 'manual' });
    env.simulation.update({ nextSyncFails: false });
    await env.app.services.sync.syncNow();
    expect(env.app.services.sync.status()).toMatchObject({ phase: 'synced', pending: 0, lastFailure: null });
  });

  it('refuses a batch that was never downloaded while offline', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    env.simulation.update({ online: false });
    expect(await env.app.services.attendance.openRoster(ctx, 'fit-s1u1.2026-09-25.daily')).toMatchObject({ error: 'already_submitted' });
    expect(await env.app.services.attendance.openRoster(ctx, 'md-s1u1.2026-09-25.daily')).toMatchObject({ error: 'not_downloaded' });
  });

  it('needs a connection when the state has not enabled offline marking, even for a downloaded batch', async () => {
    const env = setup({ offline: { enabled: false } });
    const ctx = await signIn(env.app, 'TR-10432');
    env.simulation.update({ online: false });
    expect(await env.app.services.attendance.openRoster(ctx, 'ele-s1u2.2026-09-25.daily')).toMatchObject({ error: 'needs_connection' });
  });
});

describe('principal correction (PRD §12.2–12.4)', () => {
  const key = 'ele-s1u1.2026-09-25.daily';
  const rahul = 'ele-s1u1-r21';

  it('keeps a quick reason as a code so every language can show it in its own words', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const result = await env.app.services.corrections.correct(ctx, key, rahul, { status: 'present' }, 'विद्यार्थी उशिरा आले', 'late');
    expect(result).toMatchObject({ ok: true, value: { reasonCode: 'late', reason: 'विद्यार्थी उशिरा आले' } });
    const log = await env.app.services.corrections.log(ctx, '2026-09-25', '2026-09-25');
    expect(log.find((e) => e.studentId === rahul)?.reasonCode).toBe('late');
  });

  it('corrects today with a reason, appends to the audit log and never overwrites the record', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const result = await env.app.services.corrections.correct(ctx, key, rahul, { status: 'present' }, 'Student arrived late');
    expect(result.ok).toBe(true);
    const original = await env.app.repositories.attendance.getSubmission(key);
    expect(original?.marks[rahul].status).toBe('absent');
    const detail = await env.app.services.attendance.getDetail(ctx, key);
    expect(detail?.marks[rahul].status).toBe('present');
    const log = await env.app.services.corrections.log(ctx, TODAY, TODAY);
    expect(log[0]).toMatchObject({ studentName: 'Rahul Kumar', reason: 'Student arrived late', actorName: 'Dr. Anil Deshmukh' });
  });

  it('refuses instructors, missing reasons and past days', async () => {
    const env = setup();
    const instructor = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.corrections.correct(instructor, key, rahul, { status: 'present' }, 'x')).toMatchObject({ error: 'forbidden' });
    const principal = await signIn(env.app, 'PR-2741');
    expect(await env.app.services.corrections.correct(principal, key, rahul, { status: 'present' }, '  ')).toMatchObject({ error: 'reason_required' });
    expect(await env.app.services.corrections.correct(principal, 'fit-s1u1.2026-09-24.daily', 'fit-s1u1-r04', { status: 'present' }, 'late')).toMatchObject({ error: 'not_today' });
  });
});

describe('staff attendance (PRD §18)', () => {
  it('self-mark after verification; principal cannot duplicate it but fills gaps', async () => {
    const env = setup();
    const rajesh = await signIn(env.app, 'TR-10432');
    expect(await env.app.services.staffAttendance.markSelf(rajesh)).toMatchObject({ error: 'not_verified' });
    await env.app.services.verification.grant(rajesh, { kind: 'self' });
    expect((await env.app.services.staffAttendance.markSelf(rajesh)).ok).toBe(true);
    const principal = await signIn(env.app, 'PR-2741');
    expect(await env.app.services.staffAttendance.markByPrincipal(principal, [{ staffId: 'st-rajesh', status: 'absent' }, { staffId: 'st-sanjay', status: 'present' }])).toMatchObject({ ok: true, value: { saved: 1, skipped: ['st-rajesh'] } });
    const day = await env.app.services.staffAttendance.day(principal);
    expect(day.find((r) => r.member.id === 'st-sanjay')?.record?.source).toBe('principal');
    expect(day.some((r) => r.member.role === 'principal')).toBe(true);
  });
});

describe('reports (PRD §19, D-053)', () => {
  it('lists at-risk students below the threshold, grouped by batch, lowest first', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10518');
    const report = await env.app.services.reports.atRisk(ctx, { batchId: 'ele-s1u2' });
    expect(report.threshold).toBe(75);
    expect(report.groups).toHaveLength(1);
    const [group] = report.groups;
    expect(group.batch.id).toBe('ele-s1u2');
    // The prototype's low-attendance trainee is among them (last 30 days, D-053).
    expect(group.students.map((x) => x.student.name)).toContain('Tushar Yadav');
    expect(report.range).toMatchObject({ from: '2026-08-27', to: TODAY });
    expect(group.students.length).toBeGreaterThanOrEqual(2);
    expect(group.students.every((s) => s.atRisk && (s.pct ?? 100) < 75)).toBe(true);
    // Sorted lowest first; healthy students never appear here.
    expect(group.students.map((s) => s.pct)).toEqual([...group.students.map((s) => s.pct)].sort((a, b) => (a ?? 0) - (b ?? 0)));
    // Each keeps the rank the batch's leaderboard gives them (RPT-1), so both lists number students alike.
    const board = rankStandings((await env.app.services.reports.batchStudents(ctx, 'ele-s1u2')) ?? [], 'high_first');
    const rankOf = new Map(board.map((r) => [r.standing.student.id, r.rank]));
    expect(group.students.every((s) => s.rank !== null && s.rank === rankOf.get(s.student.id))).toBe(true);
  });

  it('a day counts once however many sessions it had; nobody is flagged on too few days', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    // Today ele-s1u1 has a daily and a first-half record (seeds): still one day per student.
    const range = env.app.services.reports.recentWindow(ctx);
    const subs = await env.app.repositories.attendance.listSubmissions({ batchIds: ['ele-s1u1'], from: range.from, to: range.to });
    const dates = new Set(subs.filter((x) => !x.address.subjectId).map((x) => x.address.date));
    const students = (await env.app.services.reports.batchStudents(ctx, 'ele-s1u1')) ?? [];
    expect(students.every((x) => x.daysMarked === dates.size)).toBe(true);
    // Rolls 20 and 21 were absent in both of today's records: one absent day, not two.
    const absentToday = students.find((x) => x.student.rollNo === 20);
    expect(absentToday && absentToday.daysMarked - absentToday.daysPresent).toBeLessThanOrEqual(dates.size);
    const strict = setup({ reports: { atRiskMinDays: 30 } });
    const strictCtx = await signIn(strict.app, 'TR-10432');
    expect((await strict.app.services.reports.atRisk(strictCtx)).groups).toEqual([]);
  });

  it('the threshold is a parameter and a configuration value', async () => {
    const env = setup({ reports: { eligibilityThresholdPct: 90 } });
    const ctx = await signIn(env.app, 'TR-10518');
    const configured = await env.app.services.reports.atRisk(ctx, { batchId: 'ele-s1u2' });
    const given = await env.app.services.reports.atRisk(ctx, { batchId: 'ele-s1u2', threshold: 50 });
    expect(configured.threshold).toBe(90);
    expect(configured.groups[0].students.length).toBeGreaterThan(given.groups[0]?.students.length ?? 0);
  });

  it('my batches under open mapping are the ones I teach, not the whole institute', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const overview = await env.app.services.reports.batchOverview(ctx);
    expect(overview.batches.map((b) => b.batch.id)).toEqual(['ele-s1u1', 'ele-s2u1']);
    expect(overview.batches.every((b) => b.pct !== null && b.students > 0)).toBe(true);
    const students = await env.app.services.reports.batchStudents(ctx, 'ele-s1u1');
    expect(students).toHaveLength(overview.batches[0].students);
    expect(await env.app.services.reports.batchStudents(ctx, 'wel-s1u1')).toBeNull();
  });

  it('my attendance this month with a three-month trend', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const me = await env.app.services.reports.myAttendance(ctx);
    expect(me.range).toMatchObject({ from: '2026-09-01', to: TODAY });
    expect(me.workingDays).toBeGreaterThan(15);
    expect(me.presentDays + me.absentDays).toBeLessThanOrEqual(me.workingDays);
    // Present is counted by weight, so it always agrees with the percentage shown beside it.
    expect(me.pct).toBe(Math.round((me.presentDays / me.workingDays) * 100));
    expect(me.trend.map((m) => m.month)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(me.trend.every((m) => m.pct !== null)).toBe(true);
  });

  it('the Employability Skills instructor sees her subject sessions (generated history)', async () => {
    const env = setup({ mapping: { model: 'batch' } });
    const ctx = await signIn(env.app, 'TR-11024');
    const overview = await env.app.services.reports.batchOverview(ctx);
    expect(overview.batches).toHaveLength(5);
    expect(overview.batches.every((b) => b.pct !== null)).toBe(true);
    const past = await env.app.repositories.attendance.getSubmissionById('hist-es~ele-s1u1-2026-09-24');
    expect(past).toMatchObject({ markedBy: 'st-meera', address: { subjectId: 'es', batchId: 'ele-s1u1' } });
  });

  it('the principal sees the institute: attendance, size and staff presence', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const summary = await env.app.services.reports.instituteSummary(ctx);
    expect(summary).toMatchObject({ students: 417, batches: 17 });
    expect(summary.pct).not.toBeNull();
    expect(summary.staffPct).not.toBeNull();
    expect((await env.app.services.reports.batchOverview(ctx)).batches).toHaveLength(17);
  });

  it('shows the seeded correction in the principal log', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const report = await env.app.services.reports.build(ctx, 'correction_log', env.app.services.reports.rangeFor(ctx, 'month'));
    expect(report.block === 'correction_log' && report.entries[0].studentName).toBe('Kiran Wagh');
  });
});

describe('offline packs: refresh one batch (D-055)', () => {
  it('re-stamps only that batch, only when online and downloaded', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const before = await env.app.services.packs.list(ctx);
    const stale = before.find((r) => r.batch.id === 'fit-s1u2');
    expect(stale?.stale).toBe(true);
    const result = await env.app.services.packs.refreshBatch(ctx, 'fit-s1u2');
    expect(result.ok).toBe(true);
    const after = await env.app.services.packs.list(ctx);
    expect(after.find((r) => r.batch.id === 'fit-s1u2')).toMatchObject({ stale: false, pack: { downloadedAt: env.clock.now().toISOString() } });
    // Every other pack is untouched.
    for (const row of after.filter((r) => r.batch.id !== 'fit-s1u2')) expect(row.pack).toEqual(before.find((b) => b.batch.id === row.batch.id)?.pack);
    expect(await env.app.services.packs.refreshBatch(ctx, 'ele-s2u1')).toMatchObject({ ok: false, error: 'not_downloaded' });
    env.simulation.update({ online: false });
    expect(await env.app.services.packs.refreshBatch(ctx, 'ele-s1u1')).toMatchObject({ ok: false, error: 'offline' });
  });

  it('session cards carry when their pack was downloaded', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const [card] = await env.app.services.attendance.cardsForBatch(ctx, 'ele-s1u1');
    expect(card.pack).toMatchObject({ stale: false, downloadedAt: instantAt(TODAY, '07:45').toISOString() });
    const [none] = await env.app.services.attendance.cardsForBatch(ctx, 'ele-s2u1');
    expect(none.downloaded).toBe(false);
    expect(none.pack).toBeUndefined();
  });
});

describe('announcements (D-054)', () => {
  const ids = async (app: AppContainer, trainerId: string) => (await app.services.announcements.forUser(await signIn(app, trainerId))).map((a) => a.id);

  it('an instructor sees institute-wide notices and the ones for their trade, batch or name', async () => {
    const { app } = setup();
    const rajesh = await ids(app, 'TR-10432');
    expect(rajesh).toEqual(expect.arrayContaining(['ann-holiday', 'ann-ojt-ele-s1u1', 'ann-shift-ele', 'ann-exam', 'ann-meeting']));
    expect(rajesh).not.toContain('ann-maintenance-wel');
    // The high-priority holiday leads the banner.
    expect(rajesh[0]).toBe('ann-holiday');
  });

  it('trade notices follow the instructor’s trades, named notices only the named', async () => {
    const { app } = setup();
    const sanjay = await ids(app, 'TR-10455');
    expect(sanjay).toContain('ann-maintenance-wel');
    expect(sanjay).not.toContain('ann-ojt-ele-s1u1');
    expect(sanjay).not.toContain('ann-meeting');
  });

  it('the principal sees every notice for the institute; switched off, nobody sees any', async () => {
    const { app } = setup();
    expect(await ids(app, 'PR-2741')).toHaveLength(6);
    const off = setup({ announcements: { enabled: false } });
    expect(await ids(off.app, 'TR-10432')).toEqual([]);
  });
});

describe('demo reset', () => {
  it('restores seeded submissions and clears new records', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error();
    await env.app.services.attendance.submit(ctx, key, roster.value.marks);
    env.app.mockDatabase.reset();
    expect(await env.app.repositories.attendance.getSubmission(key)).toBeUndefined();
    expect(await env.app.repositories.attendance.getSubmission('ele-s1u1.2026-09-25.daily')).toBeDefined();
    expect(await env.app.repositories.session.get()).toBeUndefined();
  });
});

describe('submit lock under concurrency (INV-01)', () => {
  it('two simultaneous submits create exactly one record and one queue item', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    const key = 'ele-s1u2.2026-09-25.daily';
    await verify(env.app, ctx, key);
    env.simulation.update({ online: false });
    const roster = await env.app.services.attendance.openRoster(ctx, key);
    if (!roster.ok) throw new Error();
    const results = await Promise.all([
      env.app.services.attendance.submit(ctx, key, roster.value.marks),
      env.app.services.attendance.submit(ctx, key, roster.value.marks),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok).map((r) => !r.ok && r.error)).toEqual(['already_submitted']);
    expect(await env.app.repositories.offlineQueue.list()).toHaveLength(1);
  });

  it('never keeps a draft for a submitted session', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10432');
    await env.app.services.attendance.saveDraft(ctx, 'ele-s1u1.2026-09-25.daily', {});
    expect(await env.app.repositories.attendance.getDraft('ele-s1u1.2026-09-25.daily')).toBeUndefined();
  });
});

describe('location results say whether they are real or simulated (brief §18)', () => {
  it('the demo simulation tags its fixes "simulated"; the record keeps it for audit', async () => {
    const { app } = setup({ verification: { geoMode: 'fencing' } });
    const ctx = await signIn(app, 'TR-10432');
    const loc = await app.services.verification.checkLocation(ctx);
    expect(loc.ok && loc.value.location.source).toBe('simulated');
  });
});

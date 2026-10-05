import { describe, expect, it } from 'vitest';
import { addDays, compareDates, eachDate, instantAt, type LocalDate } from '@/lib/time';
import { setup, signIn, TODAY } from '../helpers/app';

const MONTH = '2026-09-01';
const YESTERDAY = addDays(TODAY, -1);

/**
 * The leaderboard over the register's range: batchStudents covers the last reports.windowDays days to today,
 * so a window from the first of the month makes the two read the same records.
 */
async function leaderboardFrom(from: LocalDate, batchId: string) {
  const env = setup({ reports: { windowDays: eachDate(from, TODAY).length } });
  const ctx = await signIn(env.app, 'PR-2741');
  expect(env.app.services.reports.recentWindow(ctx)).toMatchObject({ from, to: TODAY });
  const standings = (await env.app.services.reports.batchStudents(ctx, batchId)) ?? [];
  const overview = (await env.app.services.reports.batchOverview(ctx)).batches.find((b) => b.batch.id === batchId);
  return { standings, overview };
}

describe('attendance register (D-137)', () => {
  it('offers this month and last month, newest first', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10455');
    expect(env.app.services.reports.registerMonths(ctx)).toEqual(['2026-09-01', '2026-08-01']);
  });

  it('this month: every day of the month, figures that agree with the leaderboard, the seeded correction folded', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10455');
    const register = await env.app.services.reports.register(ctx, { batchIds: ['fit-s1u1'], month: MONTH });
    if (!register) throw new Error('register');
    expect(register).toMatchObject({ month: MONTH, to: TODAY, today: TODAY, threshold: 75, preparedBy: { name: 'Sanjay More', role: 'instructor' } });
    expect(register.institute.code).toBe('27410');
    expect(register.generatedAt).toBe(env.clock.now().toISOString());
    const [batch] = register.batches;
    expect(batch.batch.id).toBe('fit-s1u1');
    expect(batch.trade.name).toBe('Fitter');
    expect(batch.instructor).toBe('Sanjay More');
    expect(batch.days).toHaveLength(30);
    const kind = (date: LocalDate) => batch.days.find((d) => d.date === date)?.kind;
    expect(kind('2026-09-20')).toBe('none'); // Sunday
    expect(kind(TODAY)).toBe('class'); // submitted this morning (seeds)
    expect(batch.days.filter((d) => compareDates(d.date, TODAY) > 0).every((d) => d.kind === 'upcoming')).toBe(true);
    expect(batch.classDays).toBe(batch.days.filter((d) => d.kind === 'class').length);

    const { standings, overview } = await leaderboardFrom(MONTH, 'fit-s1u1');
    expect(batch.rows).toHaveLength(standings.length);
    for (const row of batch.rows) {
      const s = standings.find((x) => x.student.id === row.student.id);
      expect(s, row.student.name).toBeDefined();
      expect([row.pct, row.present, row.marked, row.atRisk]).toEqual([s!.pct, s!.daysPresent, s!.daysMarked, s!.atRisk]);
    }
    expect([batch.pct, batch.low, batch.atRisk]).toEqual([overview!.pct, overview!.low, overview!.atRisk]);

    // Kiran Wagh was absent yesterday; the principal corrected it to present.
    const kiran = batch.rows.find((r) => r.student.id === 'fit-s1u1-r04')!;
    expect(kiran.cells[batch.days.findIndex((d) => d.date === YESTERDAY)]).toEqual({ statuses: ['present'], share: 1, corrected: true });
    expect(batch.corrections).toEqual([
      expect.objectContaining({ date: YESTERDAY, studentName: 'Kiran Wagh', rollNo: 4, from: { status: 'absent' }, to: { status: 'present' }, reasonCode: 'late', by: 'Dr. Anil Deshmukh' }),
    ]);
  });

  it('a batch not submitted today shows today as pending; batches come in board order', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'PR-2741');
    const register = await env.app.services.reports.register(ctx, { batchIds: ['fit-s1u2', 'fit-s1u1'], month: MONTH });
    expect(register?.batches.map((b) => b.batch.id)).toEqual(['fit-s1u1', 'fit-s1u2']);
    expect(register?.batches[1].days.find((d) => d.date === TODAY)?.kind).toBe('pending');
    expect(register?.batches[1].corrections).toEqual([]);
  });

  it('last month runs to its last day, with no pending or upcoming days', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10455');
    const register = await env.app.services.reports.register(ctx, { batchIds: ['fit-s1u1'], month: '2026-08-01' });
    if (!register) throw new Error('register');
    expect(register.to).toBe('2026-08-31');
    const [batch] = register.batches;
    expect(batch.days).toHaveLength(31);
    expect(batch.days.some((d) => d.kind === 'pending' || d.kind === 'upcoming')).toBe(false);
    expect(batch.classDays).toBeGreaterThan(10);
    expect(batch.corrections).toEqual([]);
  });

  it('refuses a batch outside my reports, an empty list, or a month not offered', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10455');
    const register = (batchIds: string[], month = MONTH) => env.app.services.reports.register(ctx, { batchIds, month });
    expect(await register(['ele-s1u1'])).toBeNull();
    expect(await register(['fit-s1u1', 'ele-s1u1'])).toBeNull();
    expect(await register([])).toBeNull();
    expect(await register(['fit-s1u1'], '2026-07-01')).toBeNull();
    expect(await register(['fit-s1u1'], '2026-10-01')).toBeNull();
    expect(await register(['fit-s1u1'], '2026-09-25')).toBeNull();
  });
  it('Task 15: reads the clock once: a register started at 23:59:59 on the last day stays on that day', async () => {
    const env = setup();
    const ctx = await signIn(env.app, 'TR-10455');
    // The first reading is the last moment of September; any later reading is already October.
    const readings = [instantAt('2026-09-30', '23:59:59'), instantAt('2026-10-01', '00:00:01')];
    let calls = 0;
    const clock = { now: () => new Date(readings[Math.min(calls++, 1)].getTime()) };
    const register = await env.app.services.reports.register({ ...ctx, clock }, { batchIds: ['fit-s1u1'], month: MONTH });
    if (!register) throw new Error('register');
    expect(calls).toBe(1);
    expect(register).toMatchObject({ month: MONTH, to: '2026-09-30', today: '2026-09-30', generatedAt: readings[0].toISOString() });
  });
});

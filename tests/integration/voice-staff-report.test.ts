import { describe, expect, it } from 'vitest';
import type { ConfigLayer } from '@/config/types';
import { compileVoicePlan } from '@/domain/voice/plan';
import { ActionBus, type UiEvent } from '@/services/voice/action-bus';
import { createExecutor } from '@/services/voice/executor';
import { buildTools } from '@/services/voice/tools';
import { setup, signIn } from '../helpers/app';

/** The staff report by voice (D-154, D-156): this month's figures from ReportService.staffOverview, as the screen shows them. */
async function voiceFor(trainerId: string, layer: ConfigLayer = {}) {
  const env = setup({ voice: { enabled: true }, ...layer });
  const ctx = await signIn(env.app, trainerId);
  const plan = compileVoicePlan(ctx, 'en')!;
  const bus = new ActionBus();
  const events: UiEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const { services } = env.app;
  const ex = createExecutor({
    ctx, plan, bus,
    attendance: services.attendance, verification: services.verification, drafts: services.drafts,
    announcements: services.announcements, staffAttendance: services.staffAttendance, reports: services.reports,
    isOnline: () => true, nowMs: () => env.clock.now().getTime(), speechSeq: () => 0, turnSeq: () => 0, spokeAtTurn: () => 0, generation: () => 1, entropy: () => 0.42,
  });
  const call = (name: string, args: Record<string, unknown> = {}) => ex.execute({ id: name, name, args });
  const shown = () => events.filter((e) => e.type !== 'navigate');
  const nav = () => events.filter((e) => e.type === 'navigate').map((e) => (e as Extract<UiEvent, { type: 'navigate' }>).href);
  return { env, ctx, plan, ex, call, events, shown, nav, reports: services.reports };
}

const SHOW = 'Then ask whether to show it on the screen; on yes, call show_report.';

describe('get_staff_report (D-156)', () => {
  it('this month\'s %, the five lowest with their %, how many are below the threshold and not marked today; the principal is "you"', async () => {
    const s = await voiceFor('PR-2741');
    const o = (await s.reports.staffOverview(s.ctx))!;
    expect(o.pct).not.toBeNull();
    const r = await s.call('get_staff_report');
    const scored = o.staff.filter((x) => x.pct !== null);
    const lowest = scored.slice(0, 5);
    expect(r).toMatchObject({
      ok: true, month_pct: o.pct, threshold: o.threshold, staff_days: o.staffDays, not_marked_today: o.today.unmarked,
      below_threshold: scored.filter((x) => x.low).length, no_days_marked: o.staff.length - scored.length,
    });
    const listed = r.lowest as { name: string; self?: boolean; pct: number; days_present: number; days_marked: number }[];
    expect(listed.map((x) => x.pct)).toEqual(lowest.map((x) => x.pct));
    expect(listed.map((x) => x.days_marked)).toEqual(lowest.map((x) => x.marked));
    for (const [i, x] of lowest.entries()) expect(listed[i].name).toBe(x.member.id === 'st-anil' ? 'you' : x.member.name);
    expect(r.instruction).toMatch(new RegExp(`^Staff attendance this month: ${o.pct}% \\(the threshold is ${o.threshold}%\\)\\. Lowest: `));
    expect(r.instruction).toContain(`${o.today.unmarked} staff not marked today.`);
    expect(r.instruction).toContain('Answer in one or two short sentences: the month\'s figure first, then the lowest two or three; never work out a figure yourself.');
    expect(r.instruction.endsWith(SHOW)).toBe(true);
    expect(r.instruction).not.toMatch(/Anil|Deshmukh/);
    expect(s.events).toEqual([]); // an answer opens nothing
  });

  it('show_report after it opens Reports and brings the Staff attendance section into view', async () => {
    const s = await voiceFor('PR-2741');
    await s.call('get_staff_report');
    expect(await s.call('show_report')).toMatchObject({ ok: true, instruction: 'The report is on the screen. Say so in a few words.' });
    expect(s.nav()).toEqual(['/reports']);
    expect(s.shown()).toMatchObject([{ type: 'show_staff_report' }]);
  });

  it('exists only with the staff section: not for an instructor, not without staff_summary', async () => {
    const instructor = await voiceFor('TR-10518');
    expect(buildTools(instructor.plan).map((t) => t.name)).not.toContain('get_staff_report');
    expect(await instructor.call('get_staff_report')).toMatchObject({ ok: false, error: 'UNKNOWN_TOOL' });
    const noBlock = await voiceFor('PR-2741', { reports: { blocks: ['institute_summary', 'trade_batch', 'student_percentage', 'correction_log'] } });
    expect(buildTools(noBlock.plan).map((t) => t.name)).not.toContain('get_staff_report');
    const principal = await voiceFor('PR-2741');
    expect(buildTools(principal.plan).map((t) => t.name)).toContain('get_staff_report');
  });
});

describe('the overview\'s staff figure is the staff report\'s (D-156)', () => {
  it('with the staff section: this month\'s staff attendance from staffOverview, as the screen shows it', async () => {
    const s = await voiceFor('PR-2741');
    const [o, summary] = await Promise.all([s.reports.staffOverview(s.ctx), s.reports.instituteSummary(s.ctx)]);
    const r = await s.call('get_reports_overview');
    expect(r.institute).toEqual({ avg_pct: summary.pct, students: 417, batches: 17, staff_pct: o!.pct, staff_range: 'this_month' });
    expect(r.instruction).toMatch(new RegExp(`^The institute over the last 30 days: ${summary.pct}% average, 417 students in 17 batches; staff attendance this month ${o!.pct}%\\. `));
  });

  it('without the staff section: the Institute card\'s staff figure over the report window', async () => {
    const s = await voiceFor('PR-2741', { reports: { blocks: ['institute_summary', 'trade_batch', 'student_percentage', 'correction_log'] } });
    const summary = await s.reports.instituteSummary(s.ctx);
    const r = await s.call('get_reports_overview');
    expect(r.institute).toEqual({ avg_pct: summary.pct, students: 417, batches: 17, staff_pct: summary.staffPct, staff_range: 'window' });
    expect(r.instruction).toMatch(new RegExp(`^The institute over the last 30 days: ${summary.pct}% average, 417 students in 17 batches, staff presence ${summary.staffPct}%\\. `));
  });
});

describe('download_register target staff (D-154, D-156)', () => {
  it('opens Reports and the register sheet on the staff scope and the month; the principal taps Download', async () => {
    const s = await voiceFor('PR-2741');
    const r = await s.call('download_register', { target: 'staff' });
    expect(r).toEqual({
      ok: true, target: 'staff', scope: 'staff', month: 'September 2026 (so far)',
      instruction: 'The staff register for September 2026 (so far) is open on the screen. Tell the trainer to tap Download to save it, in one short line.',
    });
    expect(s.nav()).toEqual(['/reports']);
    expect(s.shown()).toEqual([expect.objectContaining({ type: 'open_staff_register', month: '2026-09-01' })]);
    const last = await s.call('download_register', { target: 'the staff register', month: 'LAST_MONTH' });
    expect(last).toMatchObject({ ok: true, scope: 'staff', month: 'August 2026' });
    expect(s.shown().at(-1)).toMatchObject({ type: 'open_staff_register', month: '2026-08-01' });
  });

  it('a trade or a batch still opens their register; without the staff section "staff" is not a register', async () => {
    const s = await voiceFor('PR-2741');
    expect(await s.call('download_register', { target: 'Electrician' })).toMatchObject({ ok: true, scope: 'trade' });
    const noBlock = await voiceFor('PR-2741', { reports: { blocks: ['institute_summary', 'trade_batch', 'student_percentage', 'correction_log'] } });
    expect(await noBlock.call('download_register', { target: 'staff' })).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(noBlock.shown()).toEqual([]);
  });
});

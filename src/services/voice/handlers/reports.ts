/**
 * The report tools (D-140): read-only answers from ReportService, the figures the Reports screen and the downloaded
 * register show (presence weight, a day of several sessions counting once, threshold-safe rounding, at-risk after
 * report.atRiskMinDays). Batches, trades and students are resolved by the matching engine (match.ts) among the batches
 * of this user's reports only; words that fit several ask which. A report answer only remembers what it was about:
 * the screen changes on show_report (or download_register), through typed bus events, never from model text.
 */
import type { Student } from '@/domain/entities';
import { parseShiftUnit, resolveSession, resolveStudent, resolveTrade, type SessionChoice } from '@/domain/voice/match';
import { routes } from '@/lib/routes';
import { instantAt } from '@/lib/time';
import { average, shown } from '@/services/report-math';
import type { AttendanceRegister } from '@/services/report-register';
import { rankStandings, type BatchOverview, type StudentStanding } from '@/services/reports';
import { batchLabel, dayWords, nameText } from '../labels';
import {
  atRiskInstruction, batchChoices, batchInstruction, NO_BATCHES, overviewInstruction, registerInstruction, SHOWN_REPORT, studentInstruction,
  type BatchLine, type StudentFigure,
} from '../report-texts';
import type { ToolResult } from '../tools';
import { fail, str, type BaseDeps, type BaseHandler, type ReportFocus } from './base';
import { instituteHeadline, namesStaffRegister, openStaffRegister } from './staff-report';

type Found<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly result: ToolResult };

interface Scope {
  readonly batches: readonly BatchOverview[];
  readonly threshold: number;
  readonly windowDays: number;
}

async function scopeOf(deps: BaseDeps): Promise<Scope> {
  const o = await deps.reports.batchOverview(deps.ctx);
  return { batches: o.batches, threshold: o.threshold, windowDays: deps.ctx.config.reports.windowDays };
}

const labelOf = (o: BatchOverview): string => batchLabel(o.batch, o.trade);

/**
 * What show_report shows for an answer about one batch: its row where the screen has the batches section; else the
 * at-risk list where the answer was about students at risk and the screen has it; else just Reports.
 */
function batchFocus(deps: BaseDeps, batchId: string, atRisk: boolean): ReportFocus {
  const sections = deps.voice.capabilities.reportSections;
  if (sections.batches) return { kind: 'batch', batchId };
  return atRisk && sections.atRisk ? { kind: 'at_risk' } : { kind: 'overview' };
}

const figure = (s: StudentStanding): StudentFigure => ({ name: s.student.name, roll: s.student.rollNo, pct: s.pct, days_present: s.daysPresent, days_marked: s.daysMarked });

/** The batch the words name, among the batches of this user's reports (one batch needs no words). */
function findBatch(said: string, batches: readonly BatchOverview[]): Found<BatchOverview> {
  const labels = batchChoices(batches.map(labelOf));
  if (!batches.length) return { ok: false, result: fail('NO_BATCHES', NO_BATCHES) };
  if (!said) {
    if (batches.length === 1) return { ok: true, value: batches[0] };
    return { ok: false, result: fail('AMBIGUOUS', `Ask which batch: ${labels}.`, { candidates: batches.map((b) => ({ id: b.batch.id, label: labelOf(b) })) }) };
  }
  const choices = batches.map((o): SessionChoice & { readonly item: BatchOverview } => ({
    key: o.batch.id, shift: o.batch.shift, unit: o.batch.unit, tradeName: o.trade.name, slot: { kind: 'daily' }, item: o,
  }));
  const m = resolveSession(said, choices);
  if (m.kind === 'found') return { ok: true, value: m.value.item };
  if (m.kind === 'ambiguous') {
    const candidates = m.candidates.map((c) => ({ id: c.key, label: labelOf(c.item) }));
    return { ok: false, result: fail('AMBIGUOUS', `"${nameText(said)}" matches several batches: ${batchChoices(candidates.map((c) => c.label))}. Ask which one.`, { candidates }) };
  }
  return { ok: false, result: fail('NOT_FOUND', `No batch "${nameText(said)}" in the trainer's reports. Their batches: ${labels}. Ask which one.`) };
}

/** This month's and last month's register of these batches (the download's own figures). */
async function monthRegisters(deps: BaseDeps, batchIds: readonly string[]): Promise<readonly [AttendanceRegister | null, AttendanceRegister | null]> {
  if (!batchIds.length) return [null, null];
  const [thisMonth, lastMonth] = deps.reports.registerMonths(deps.ctx);
  return Promise.all([deps.reports.register(deps.ctx, { batchIds, month: thisMonth }), deps.reports.register(deps.ctx, { batchIds, month: lastMonth })]);
}

const batchMonth = (register: AttendanceRegister | null, batchId: string): number | null => register?.batches.find((b) => b.batch.id === batchId)?.pct ?? null;

/** Every student-day of the register's batches together, rounded as every figure is. */
function scopeMonth(register: AttendanceRegister | null): number | null {
  if (!register) return null;
  const rows = register.batches.flatMap((b) => b.rows.map((r) => ({ daysPresent: r.present, daysMarked: r.marked })));
  return shown(average(rows), register.threshold);
}

/**
 * The overview says only what the Reports screen shows: the institute headline with the institute summary, the batches
 * (one by one, or the lowest and highest) with the batches section, the at-risk total with the at-risk section.
 */
export const getReportsOverview: BaseHandler = async (h) => {
  const { deps } = h;
  const sections = deps.voice.capabilities.reportSections;
  const scope = await scopeOf(deps);
  const ids = scope.batches.map((b) => b.batch.id);
  const [[thisMonth, lastMonth], headline] = await Promise.all([monthRegisters(deps, ids), sections.institute ? instituteHeadline(deps) : null]);
  const batches: BatchLine[] = !sections.batches ? [] : scope.batches.map((b) => ({
    id: b.batch.id, label: labelOf(b), students: b.students, avg_pct: b.pct, ...(sections.atRisk ? { at_risk: b.atRisk } : {}),
    this_month_pct: batchMonth(thisMonth, b.batch.id), last_month_pct: batchMonth(lastMonth, b.batch.id),
  }));
  const atRiskTotal = sections.atRisk ? scope.batches.reduce((a, b) => a + b.atRisk, 0) : null;
  const months = { this_month_pct: scopeMonth(thisMonth), last_month_pct: scopeMonth(lastMonth) };
  h.state.report = { kind: 'overview' };
  return {
    ok: true, window_days: scope.windowDays, threshold: scope.threshold, ...months,
    ...(sections.batches ? { batches } : {}),
    ...(atRiskTotal === null ? {} : { at_risk_total: atRiskTotal }),
    ...(headline ? { institute: headline } : {}),
    instruction: overviewInstruction({ ...scope, batches, atRiskTotal, thisMonth: months.this_month_pct, lastMonth: months.last_month_pct, institute: headline }),
  };
};

export const getBatchReport: BaseHandler = async (h, args) => {
  const { deps } = h;
  const scope = await scopeOf(deps);
  const found = findBatch(str(args.batch), scope.batches);
  if (!found.ok) return found.result;
  const item = found.value;
  const [standings, [thisMonth, lastMonth]] = await Promise.all([deps.reports.batchStudents(deps.ctx, item.batch.id), monthRegisters(deps, [item.batch.id])]);
  if (!standings) return fail('NOT_FOUND', `${labelOf(item)} is not in the trainer's reports. Say so in one short line.`);
  const scored = (sort: 'low_first' | 'high_first') => rankStandings(standings, sort).map((r) => r.standing).filter((s) => s.pct !== null);
  const lowest = scored('low_first').slice(0, 5).map(figure);
  const highest = scored('high_first').slice(0, 3).map(figure);
  const atRisk = scored('low_first').filter((s) => s.atRisk).map(figure);
  const facts = { label: labelOf(item), students: item.students, avgPct: item.pct, thisMonth: batchMonth(thisMonth, item.batch.id), lastMonth: batchMonth(lastMonth, item.batch.id) };
  h.state.report = { kind: 'batch', batchId: item.batch.id };
  return {
    ok: true, batch: { id: item.batch.id, label: facts.label }, students: item.students, avg_pct: item.pct,
    this_month_pct: facts.thisMonth, last_month_pct: facts.lastMonth, lowest, highest, at_risk: atRisk, at_risk_count: atRisk.length,
    instruction: batchInstruction({ ...scope, ...facts, lowest, highest, atRisk }),
  };
};

/** The days whose sessions were all absent, from the registers given, newest first. */
function absences(registers: readonly (AttendanceRegister | null)[], batchId: string, studentId: string): string[] {
  const days: string[] = [];
  for (const register of registers) {
    const batch = register?.batches.find((b) => b.batch.id === batchId);
    const row = batch?.rows.find((r) => r.student.id === studentId);
    if (!batch || !row) continue;
    batch.days.forEach((d, i) => {
      const cell = row.cells[i];
      if (cell && cell.statuses.length && cell.statuses.every((s) => s === 'absent')) days.push(d.date);
    });
  }
  return days.sort().reverse();
}

const LAST_ABSENCES = 5;
const MAX_CANDIDATES = 6;

export const getStudentReport: BaseHandler = async (h, args) => {
  const { deps } = h;
  const scope = await scopeOf(deps);
  const batchWords = str(args.batch);
  let pool = scope.batches;
  if (batchWords) {
    const found = findBatch(batchWords, scope.batches);
    if (!found.ok) return found.result;
    pool = [found.value];
  }
  const byId = new Map(pool.map((o) => [o.batch.id, o]));
  const said = str(args.student);
  const m = resolveStudent(said, deps.ctx.data.students.filter((s) => byId.has(s.batchId)));
  const where = (s: Student) => `${nameText(s.name)} (roll ${s.rollNo}, ${labelOf(byId.get(s.batchId)!)})`;
  if (m.kind === 'ambiguous') {
    const listed = m.candidates.slice(0, MAX_CANDIDATES).map(where).join('; ');
    const more = m.candidates.length > MAX_CANDIDATES ? ` and ${m.candidates.length - MAX_CANDIDATES} more` : '';
    const candidates = m.candidates.slice(0, MAX_CANDIDATES).map((s) => ({ name: s.name, roll: s.rollNo, batch: labelOf(byId.get(s.batchId)!) }));
    return fail('AMBIGUOUS', `"${nameText(said)}" matches several students: ${listed}${more}. Ask which one (by batch or father's name).`, { candidates });
  }
  if (m.kind === 'none') return fail('NOT_FOUND', `No student "${nameText(said)}" in the trainer's batches. Ask for the name again, or the roll number with the batch.`);
  const student = m.value;
  const item = byId.get(student.batchId)!;
  const [standings, registers] = await Promise.all([deps.reports.batchStudents(deps.ctx, item.batch.id), monthRegisters(deps, [item.batch.id])]);
  const standing = standings?.find((s) => s.student.id === student.id);
  if (!standing) return fail('NOT_FOUND', `${nameText(student.name)} is not in the trainer's reports. Say so in one short line.`);
  const last = absences(registers, item.batch.id, student.id).slice(0, LAST_ABSENCES);
  const f = figure(standing);
  h.state.report = batchFocus(deps, item.batch.id, standing.atRisk);
  return {
    ok: true, student: { name: f.name, roll: f.roll, batch: labelOf(item) }, pct: f.pct, days_present: f.days_present, days_marked: f.days_marked,
    at_risk: standing.atRisk, last_absences: last,
    instruction: studentInstruction({ ...scope, figure: f, batch: labelOf(item), atRisk: standing.atRisk, absences: last.map(dayWords) }),
  };
};

const MAX_AT_RISK = 10;

export const getAtRisk: BaseHandler = async (h, args) => {
  const { deps } = h;
  const scope = await scopeOf(deps);
  const batchWords = str(args.batch);
  let batchId: string | undefined;
  if (batchWords) {
    const found = findBatch(batchWords, scope.batches);
    if (!found.ok) return found.result;
    batchId = found.value.batch.id;
  }
  const report = await deps.reports.atRisk(deps.ctx, batchId ? { batchId } : {});
  const all = report.groups
    .flatMap((g) => g.students.map((s) => ({ ...figure(s), batch: batchLabel(g.batch, g.trade) })))
    .sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0) || a.days_present - b.days_present || a.name.localeCompare(b.name));
  h.state.report = batchId ? batchFocus(deps, batchId, true) : { kind: 'at_risk' };
  return {
    ok: true, threshold: report.threshold, window_days: scope.windowDays, total: all.length, batches_with_risk: report.groups.length,
    batches_checked: report.batchesChecked, students: all.slice(0, MAX_AT_RISK),
    instruction: atRiskInstruction({ threshold: report.threshold, windowDays: scope.windowDays, students: all, batchesWithRisk: report.groups.length }),
  };
};

/** Reports opens, then the part the last answer was about (Action Bus, D-085). */
export const showReport: BaseHandler = async (h) => {
  const focus = h.state.report;
  h.navigate(routes.reports, false);
  if (focus?.kind === 'batch') h.deps.bus.emit({ type: 'show_batch_report', batchId: focus.batchId });
  if (focus?.kind === 'at_risk') h.deps.bus.emit({ type: 'show_at_risk' });
  if (focus?.kind === 'staff') h.deps.bus.emit({ type: 'show_staff_report' });
  const then = await h.afterNavigate();
  return { ok: true, instruction: `${focus ? SHOWN_REPORT : 'The Reports screen is open. Say so in a few words.'}${then}` };
};

interface RegisterTarget {
  readonly batchIds: readonly string[];
  readonly tradeId: string | null;
  readonly label: string;
}

/** A batch (its words name a shift or unit, or its id) or a whole trade of this user's reports. */
function findTarget(said: string, scope: Scope): Found<RegisterTarget> {
  const asBatch = (o: BatchOverview): Found<RegisterTarget> => ({ ok: true, value: { batchIds: [o.batch.id], tradeId: null, label: labelOf(o) } });
  const batch = findBatch(said, scope.batches);
  const su = parseShiftUnit(said);
  if (batch.ok) return asBatch(batch.value);
  if (!said || su.shift !== undefined || su.unit !== undefined || !scope.batches.length) return batch;
  const trades = [...new Map(scope.batches.map((o) => [o.trade.id, o.trade])).values()];
  const m = resolveTrade(said, trades);
  if (m.kind === 'found') {
    const ids = scope.batches.filter((o) => o.batch.tradeId === m.value.id).map((o) => o.batch.id);
    return { ok: true, value: { batchIds: ids, tradeId: m.value.id, label: nameText(m.value.name) } };
  }
  const names = trades.map((t) => nameText(t.name)).join('; ');
  if (m.kind === 'ambiguous') return { ok: false, result: fail('AMBIGUOUS', `"${nameText(said)}" matches several trades: ${m.candidates.map((t) => nameText(t.name)).join('; ')}. Ask which one.`) };
  return { ok: false, result: fail('NOT_FOUND', `No batch or trade "${nameText(said)}" in the trainer's reports. Their trades: ${names}. Their batches: ${batchChoices(scope.batches.map(labelOf))}. Ask which one.`) };
}

const MONTH_YEAR = new Intl.DateTimeFormat('en-IN', { month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' });
const MONTHS = ['THIS_MONTH', 'LAST_MONTH'] as const;

/** Opens the register sheet on the batch or trade and the month; the browser download needs the trainer's tap. */
export const downloadRegister: BaseHandler = async (h, args) => {
  const { deps } = h;
  const which = str(args.month).toUpperCase() || 'THIS_MONTH';
  const index = MONTHS.indexOf(which as (typeof MONTHS)[number]);
  if (index < 0) return fail('INVALID', 'The register is for this month or last month. Ask which.');
  const month = deps.reports.registerMonths(deps.ctx)[index];
  const monthName = `${MONTH_YEAR.format(instantAt(month, '12:00'))}${index === 0 ? ' (so far)' : ''}`;
  if (namesStaffRegister(h, str(args.target))) return openStaffRegister(h, month, monthName);
  const scope = await scopeOf(deps);
  const target = findTarget(str(args.target), scope);
  if (!target.ok) return target.result;
  h.navigate(routes.reports, false);
  deps.bus.emit({ type: 'open_register', batchIds: target.value.batchIds, tradeId: target.value.tradeId, month });
  const then = await h.afterNavigate();
  const wholeTrade = target.value.tradeId !== null;
  return {
    ok: true, target: target.value.label, scope: wholeTrade ? 'trade' : 'batch', month: monthName,
    instruction: `${registerInstruction(target.value.label, monthName, wholeTrade)}${then}`,
  };
};

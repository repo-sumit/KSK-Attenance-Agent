/**
 * The register document's parts (D-137): the government header, a batch's title, meta grid and KPI strip, the
 * legend, corrections, signatures, the footer and the trade summary. Every dynamic string is escaped here.
 */
import type { Mark, StatusCode } from '@/domain/status';
import type { I18n } from '@/i18n';
import { endOfMonth, toLocalDate, type LocalDate } from '@/lib/time';
import type { AttendanceRegister, BatchRegister, RegisterCell, RegisterDay } from '@/services/report-register';
import { correctionReason } from '../../common/labels';
import { escapeHtml as e } from './escape';
import { registerTable, STATUS_CLASS } from './registerTable';

/** What every register sheet's header and footer read: the student register (D-137) and the staff register (D-154). */
export type RegisterHeader = Pick<AttendanceRegister, 'institute' | 'month' | 'to' | 'generatedAt' | 'preparedBy'>;

export interface SheetContext<R extends RegisterHeader = RegisterHeader> {
  readonly t: I18n['t'];
  readonly format: I18n['format'];
  readonly register: R;
  /** "September 2026" in the document's locale. */
  readonly monthLabel: string;
  /** A narrow weekday name ("M") in the document's locale. */
  readonly weekday: (date: LocalDate) => string;
  /** A validated data: URL, or undefined. */
  readonly logo?: string;
  readonly sampleData: boolean;
}

export type DocContext = SheetContext<AttendanceRegister>;

const STATUS_ORDER: readonly StatusCode[] = ['present', 'absent', 'leave', 'half_day', 'ojt'];

export const batchTitle = (c: DocContext, b: BatchRegister) => c.t('register.batchTitle', { trade: b.trade.name, shift: b.batch.shift, unit: b.batch.unit });
const yearLabel = (c: DocContext, b: BatchRegister) => c.t(b.batch.year === 1 ? 'register.firstYear' : 'register.secondYear');
export const pctText = (c: SheetContext, pct: number | null) => (pct === null ? c.t('reports.noValue') : c.format.percent(pct));

/** "1 Sep – 25 Sep 2026" */
export const periodText = (c: SheetContext) => c.t('register.range', { from: c.format.dayMonth(c.register.month), to: c.format.dayMonthYear(c.register.to) });
/** "25 Sep 2026, 10:15 AM" */
export const generatedText = (c: SheetContext) =>
  c.t('register.generatedValue', { date: c.format.dayMonthYear(toLocalDate(new Date(c.register.generatedAt))), time: c.format.time(c.register.generatedAt) });

/** The current month's register runs to today: "1–25 Sep (to date)". */
function toDateText(c: SheetContext): string | null {
  const { month, to } = c.register;
  if (to === endOfMonth(month)) return null;
  const range = to === month ? c.format.dayMonth(to) : `${c.format.number(1)}–${c.format.dayMonth(to)}`;
  return c.t('register.toDate', { range });
}

/** `title`: the register's name in the header ("Monthly Attendance Register" unless given). */
export function sheetHeader(c: SheetContext, title = c.t('register.title')): string {
  const { institute } = c.register;
  const sub = toDateText(c);
  return (
    `<header class="head">${c.logo ? '<span class="emblem" aria-hidden="true"></span>' : ''}` +
    `<div class="head-org"><div class="authority">${e(c.t('register.authority'))}</div>` +
    `<h1 class="institute">${e(institute.name)}</h1>` +
    `<div class="inst-line">${e(c.t('register.instituteLine', { code: institute.code, district: institute.district }))}</div></div>` +
    `<div class="head-doc"><div class="doc-title">${e(title)}</div>` +
    `<div class="doc-month">${e(c.monthLabel)}</div>${sub ? `<div class="doc-sub">${e(sub)}</div>` : ''}</div></header>` +
    `<div class="rule-accent"></div>`
  );
}

function metaGrid(c: DocContext, b: BatchRegister): string {
  const { t, format, register } = c;
  const items: [string, string][] = [
    [t('register.meta.trade'), b.trade.name],
    [t('register.meta.batch'), t('register.batchValue', { shift: b.batch.shift, unit: b.batch.unit })],
    [t('register.meta.instructor'), b.instructor ?? t('reports.noValue')],
    [t('register.meta.students'), format.number(b.rows.length)],
    [t('register.meta.period'), periodText(c)],
    [t('register.meta.classDays'), format.number(b.classDays)],
    [t('register.meta.threshold'), t('register.thresholdValue', { pct: register.threshold })],
    [t('register.meta.generated'), generatedText(c)],
  ];
  return `<dl class="meta">${items.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`;
}

export function kpi(label: string, value: string, sub: string, warn: boolean): string {
  return `<div class="kpi${warn ? ' warn' : ''}"><div class="kpi-label">${e(label)}</div><div class="kpi-value">${e(value)}</div><div class="kpi-sub">${e(sub)}</div></div>`;
}

function kpiStrip(c: DocContext, b: BatchRegister): string {
  const { t, format, register } = c;
  const pct = register.threshold;
  return (
    `<div class="kpis">` +
    kpi(t('register.kpi.average'), pctText(c, b.pct), b.low ? t('register.kpi.below', { pct }) : t('register.kpi.target', { pct }), b.low) +
    kpi(t('register.kpi.meeting'), format.number(b.meeting), t('register.kpi.ofStudents', { count: b.rows.length }), false) +
    kpi(t('register.kpi.atRisk'), format.number(b.atRisk), t('register.kpi.atRiskSub', { pct, days: register.atRiskMinDays }), b.atRisk > 0) +
    kpi(t('register.kpi.classDays'), format.number(b.classDays), t('register.kpi.upTo', { date: format.dayMonth(register.to) }), false) +
    `</div>`
  );
}

/** What the legend reads from a sheet: its days, its rows' cells and whether it has corrections. */
interface LegendSource {
  readonly days: readonly RegisterDay[];
  readonly rows: ReadonlyArray<{ readonly cells: readonly (RegisterCell | null)[] }>;
  readonly corrections: readonly unknown[];
}

/** `words`: the staff register's own wording for a day without records and for how it counts. */
export function legend(c: SheetContext, b: LegendSource, words: { readonly noDay?: string; readonly how?: string } = {}): string {
  const { t } = c;
  const seen = new Set<StatusCode>(['present', 'absent']);
  let mixed = false;
  for (const row of b.rows)
    for (const cell of row.cells) {
      cell?.statuses.forEach((s) => seen.add(s));
      if (cell && new Set(cell.statuses).size > 1) mixed = true;
    }
  const item = (chipCls: string, chip: string, label: string) => `<span class="item"><span class="chip ${chipCls}">${chip}</span>${e(label)}</span>`;
  const statuses = STATUS_ORDER.filter((s) => seen.has(s)).map((s) => item(STATUS_CLASS[s], e(t(`register.letter.${s}`)), t(`status.${s}`)));
  const marks = [
    ...(mixed ? [item('s-m', e(`${c.format.number(1)}/${c.format.number(2)}`), t('register.legend.sessions'))] : []),
    ...(b.corrections.length > 0 ? [item('star-chip', '*', t('register.legend.corrected'))] : []),
    item('none', '', words.noDay ?? t('register.legend.noClass')),
    ...(b.days.some((d) => d.kind === 'pending') ? [item('pend', '', t('register.legend.pending'))] : []),
    ...(b.days.some((d) => d.kind === 'upcoming') ? [item('up', '', t('register.legend.upcoming'))] : []),
  ];
  return `<div class="legend"><span class="legend-title">${e(t('register.legend.title'))}</span>${[...statuses, ...marks].join('')}</div><p class="how">${e(words.how ?? t('register.howCounted'))}</p>`;
}

function markText(c: DocContext, mark: Mark): string {
  return mark.status ? c.t(`status.${mark.status}`) : c.t('status.not_marked');
}

function corrections(c: DocContext, b: BatchRegister): string {
  if (b.corrections.length === 0) return '';
  const { t, format } = c;
  const head = (['date', 'roll', 'student', 'changed', 'reason', 'by'] as const).map((k) => `<th scope="col">${e(t(`register.corrections.${k}`))}</th>`).join('');
  const rows = b.corrections
    .map(
      (x) =>
        `<tr><td>${e(format.dayMonth(x.date))}</td><td>${e(format.number(x.rollNo))}</td><td>${e(x.studentName)}</td>` +
        `<td>${e(markText(c, x.from))} → ${e(markText(c, x.to))}</td><td>${e(correctionReason(t, x))}</td><td>${e(x.by)}</td></tr>`,
    )
    .join('');
  return `<h3>${e(t('register.corrections.title'))}</h3><div class="tbl-wrap"><table class="plain"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function signatures(c: DocContext, b: BatchRegister): string {
  const { t } = c;
  const block = (label: string, name?: string | null) => `<div><div class="sign-block"></div><div class="sign-cap">${name ? `<b>${e(name)}</b>` : ''}${e(label)}</div></div>`;
  return (
    `<div class="sign">${block(t('register.sign.craft'), b.instructor)}${block(t('register.sign.group'))}${block(t('register.sign.principal'))}` +
    `<div class="sign-date">${e(t('register.sign.date'))}</div></div>`
  );
}

export function sheetFooter(c: SheetContext): string {
  const { t, register } = c;
  const by = t('register.generated', { when: generatedText(c), name: register.preparedBy.name, role: t(`role.${register.preparedBy.role}`) });
  return `<footer class="foot"><span>${e(by)}</span>${c.sampleData ? `<span class="sample">${e(t('register.sample'))}</span>` : ''}</footer>`;
}

export function batchSection(c: DocContext, b: BatchRegister): string {
  return (
    `<section class="sheet batch">${sheetHeader(c)}` +
    `<div class="batch-title"><h2>${e(batchTitle(c, b))}</h2><span class="year">${e(yearLabel(c, b))}</span></div>` +
    metaGrid(c, b) +
    kpiStrip(c, b) +
    (b.classDays === 0 ? `<p class="empty">${e(c.t('register.noRecords'))}</p>` : '') +
    registerTable(c, b) +
    legend(c, b) +
    corrections(c, b) +
    signatures(c, b) +
    sheetFooter(c) +
    `</section>`
  );
}

export function tradeSummary(c: DocContext, tradeName: string): string {
  const { t, format, register } = c;
  const pct = register.threshold;
  const cols: [string, boolean][] = [
    [t('register.summary.batch'), false],
    [t('register.summary.students'), true],
    [t('register.summary.classDays'), true],
    [t('register.summary.average'), true],
    [t('register.summary.meets', { pct }), true],
    [t('register.summary.atRisk'), true],
  ];
  const head = cols.map(([label, n]) => `<th scope="col"${n ? ' class="n"' : ''}>${e(label)}</th>`).join('');
  const rows = register.batches
    .map(
      (b) =>
        `<tr class="sum-row"><td><b>${e(t('register.batchValue', { shift: b.batch.shift, unit: b.batch.unit }))}</b> · ${e(yearLabel(c, b))}</td>` +
        `<td class="n">${e(format.number(b.rows.length))}</td><td class="n">${e(format.number(b.classDays))}</td>` +
        `<td class="n${b.low ? ' low' : ''}">${e(pctText(c, b.pct))}</td><td class="n">${e(format.number(b.meeting))}</td>` +
        `<td class="n${b.atRisk > 0 ? ' warn' : ''}">${e(format.number(b.atRisk))}</td></tr>`,
    )
    .join('');
  const meta = [`${t('register.meta.period')}: ${periodText(c)}`, `${t('register.meta.threshold')}: ${t('register.thresholdValue', { pct })}`, `${t('register.meta.generated')}: ${generatedText(c)}`];
  return (
    `<section class="sheet summary">${sheetHeader(c)}` +
    `<div class="batch-title"><h2>${e(t('register.tradeSummary', { trade: tradeName }))}</h2></div>` +
    `<p class="summary-meta">${meta.map(e).join(' · ')}</p>` +
    `<div class="tbl-wrap"><table class="plain summary-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>` +
    sheetFooter(c) +
    `</section>`
  );
}

/**
 * The monthly staff attendance register as one self-contained HTML document (D-154, extends D-137): the student
 * register's shell (CSP, the emblem embedded once, the Print button), header, footer, legend and grid styles, A4
 * landscape with the header row repeated on every printed page. Every dynamic string is escaped. Pure.
 */
import { oneDecimal } from '@/services/report-math';
import type { StaffRegister, StaffRegisterRow } from '@/services/report-staff-register';
import { escapeHtml as e } from './escape';
import { documentShell, sheetContext, type RegisterDocumentOptions } from './registerDocument';
import { generatedText, kpi, legend, pctText, periodText, sheetFooter, sheetHeader, type SheetContext } from './registerParts';
import { cellView, cls, dayClasses, dayHeads } from './registerTable';

export type StaffRegisterDocumentOptions = Omit<RegisterDocumentOptions, 'scope'>;

type StaffContext = SheetContext<StaffRegister>;

/** Without the roll column, the name column sits next to the row number when the grid scrolls sideways. */
const STAFF_STYLES = '.reg.staff .k3{left:24px}';

function metaGrid(c: StaffContext): string {
  const { t, format, register } = c;
  const items: [string, string][] = [
    [t('register.meta.staff'), format.number(register.rows.length)],
    [t('register.meta.period'), periodText(c)],
    [t('register.meta.workingDays'), format.number(register.staffDays)],
    [t('register.meta.generated'), generatedText(c)],
  ];
  return `<dl class="meta">${items.map(([k, v]) => `<div><dt>${e(k)}</dt><dd>${e(v)}</dd></div>`).join('')}</dl>`;
}

function kpiStrip(c: StaffContext): string {
  const { t, format, register } = c;
  const pct = register.threshold;
  const unmarked = register.rows.reduce((a, r) => a + r.unmarked, 0);
  return (
    `<div class="kpis">` +
    kpi(t('register.kpi.average'), pctText(c, register.pct), register.low ? t('register.kpi.below', { pct }) : t('register.kpi.target', { pct }), register.low) +
    kpi(t('register.kpi.meeting'), format.number(register.meeting), t('register.kpi.ofStaff', { count: register.rows.length }), false) +
    kpi(t('register.kpi.unmarked'), format.number(unmarked), t('register.kpi.unmarkedSub'), unmarked > 0) +
    kpi(t('register.kpi.workingDays'), format.number(register.staffDays), t('register.kpi.upTo', { date: format.dayMonth(register.to) }), false) +
    `</div>`
  );
}

function staffRow(c: StaffContext, row: StaffRegisterRow, index: number, dayCls: readonly string[]): string {
  const { t, format } = c;
  const role = t(`role.${row.member.role}`);
  const detail = row.trade ? t('role.withTrade', { role, trade: row.trade }) : role;
  const cells = c.register.days
    .map((_, i) => {
      const view = cellView(c, row.cells[i]);
      return `<td class="${cls('c', dayCls[i], view.cls)}">${e(view.text)}</td>`;
    })
    .join('');
  const n = format.number;
  return (
    `<tr class="${cls('st', row.low ? 'risk' : '')}" data-staff="${e(row.member.id)}">` +
    `<td class="num sticky k1">${e(n(index + 1))}</td>` +
    `<td class="name sticky k3"><span class="nm">${e(row.member.name)}</span><span class="fa">${e(detail)}</span></td>${cells}` +
    `<td class="fig f-present">${e(n(row.present))}</td><td class="fig f-absent">${e(n(row.absent))}</td>` +
    `<td class="fig f-leave">${e(n(row.leave))}</td><td class="fig f-pct">${e(row.pct === null ? t('reports.noValue') : n(row.pct))}</td>` +
    `<td class="fig f-unmarked">${e(n(row.unmarked))}</td></tr>`
  );
}

function staffTable(c: StaffContext): string {
  const { t, format, register } = c;
  const dayCls = register.days.map(dayClasses);
  const heads = dayHeads(c, register.days, dayCls);
  const cols = `<colgroup><col class="k-no"><col class="k-name">${'<col class="k-day">'.repeat(register.days.length)}<col class="k-fig"><col class="k-fig"><col class="k-fig"><col class="k-pct"><col class="k-fig"></colgroup>`;
  const head1 =
    `<tr class="h1"><th class="sticky k1" rowspan="2" scope="col">${e(t('register.col.no'))}</th>` +
    `<th class="name l sticky k3" rowspan="2" scope="col">${e(t('register.col.staff'))}</th>` +
    heads.dates +
    (['present', 'absent', 'leave', 'pct', 'unmarked'] as const).map((k) => `<th rowspan="2" scope="col">${e(t(`register.col.${k}`))}</th>`).join('') +
    `</tr>`;
  const body = register.rows.map((row, i) => staffRow(c, row, i, dayCls)).join('');
  const sum = (pick: (r: StaffRegisterRow) => number) => register.rows.reduce((a, r) => a + pick(r), 0);
  const foot =
    `<tr class="tot"><th class="sticky k1" colspan="2" scope="row">${e(t('register.presentByDay'))}</th>` +
    register.days.map((d, i) => `<td class="${cls('c', dayCls[i])}">${d.kind === 'class' ? e(format.number(d.present)) : ''}</td>`).join('') +
    `<td class="fig">${e(format.number(oneDecimal(sum((r) => r.present))))}</td><td class="fig">${e(format.number(sum((r) => r.absent)))}</td>` +
    `<td class="fig">${e(format.number(sum((r) => r.leave)))}</td>` +
    `<td class="fig">${e(register.pct === null ? t('reports.noValue') : format.number(register.pct))}</td><td class="fig">${e(format.number(sum((r) => r.unmarked)))}</td></tr>`;
  return (
    `<div class="reg-wrap"><table class="reg staff" style="--days:${register.days.length}">${cols}` +
    `<thead>${head1}<tr class="h2">${heads.weekdays}</tr></thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`
  );
}

function signature(c: StaffContext): string {
  const { t } = c;
  return `<div class="sign"><div><div class="sign-block"></div><div class="sign-cap">${e(t('register.sign.principal'))}</div></div><div class="sign-date">${e(t('register.sign.date'))}</div></div>`;
}

export function staffRegisterDocument(register: StaffRegister, options: StaffRegisterDocumentOptions): string {
  const c = sheetContext(register, options);
  const { t } = options;
  const name = t('register.staffTitle');
  const sheet =
    `<section class="sheet batch">${sheetHeader(c, name)}` +
    `<div class="batch-title"><h2>${e(t('reports.staff_summary'))}</h2></div>` +
    metaGrid(c) +
    kpiStrip(c) +
    (register.staffDays === 0 ? `<p class="empty">${e(t('register.staffNoRecords'))}</p>` : '') +
    staffTable(c) +
    legend(c, { days: register.days, rows: register.rows, corrections: [] }, { noDay: t('register.legend.noRecords'), how: t('register.staffHowCounted') }) +
    signature(c) +
    sheetFooter(c) +
    `</section>`;
  return documentShell(c, { lang: options.lang, title: `${name} · ${c.monthLabel}`, name, styles: STAFF_STYLES, sheets: sheet });
}

/** "KSK-staff-register_2026-09.html" */
export const staffRegisterFileName = (register: StaffRegister) => `KSK-staff-register_${register.month.slice(0, 7)}.html`;

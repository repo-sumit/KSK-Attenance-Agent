/** The register grid: one row per student, one column per day of the month, totals and the day totals (D-137). */
import { STATUS_REGISTRY, type StatusCode } from '@/domain/status';
import { oneDecimal } from '@/services/report-math';
import type { BatchRegister, RegisterCell, RegisterDay, RegisterRow } from '@/services/report-register';
import { escapeHtml as e } from './escape';
import type { DocContext } from './registerParts';

export const STATUS_CLASS: Readonly<Record<StatusCode, string>> = { present: 's-p', absent: 's-a', leave: 's-l', half_day: 's-h', ojt: 's-o' };

/** "½", "1", "1½": a count of sessions where a half day counts half. */
function sessionCount(c: DocContext, n: number): string {
  const whole = Math.floor(n);
  const half = n - whole >= 0.5;
  if (!half) return c.format.number(whole);
  return whole === 0 ? '½' : `${c.format.number(whole)}½`;
}

/** A day's cell: one status as its letter; several sessions with one status as that letter; mixed sessions as "present/sessions". */
export function cellView(c: DocContext, cell: RegisterCell | null): { readonly cls: string; readonly text: string } {
  if (!cell || cell.statuses.length === 0) return { cls: '', text: '' };
  const [first] = cell.statuses;
  if (cell.statuses.every((s) => s === first)) return { cls: STATUS_CLASS[first], text: c.t(`register.letter.${first}`) };
  const present = cell.statuses.reduce((sum, s) => sum + STATUS_REGISTRY[s].presenceWeight, 0);
  return { cls: present === 0 ? 's-a' : 's-m', text: `${sessionCount(c, present)}/${c.format.number(cell.statuses.length)}` };
}

function dayClasses(day: RegisterDay): string {
  const out: string[] = [];
  if (day.weekday === 0) out.push('sun');
  if (day.kind === 'none' && day.weekday !== 0) out.push('none');
  if (day.kind === 'upcoming') out.push('up');
  if (day.kind === 'pending') out.push('pend');
  return out.join(' ');
}

const cls = (...names: string[]) => names.filter(Boolean).join(' ');

function remark(c: DocContext, row: RegisterRow): string {
  if (row.atRisk) return `<td class="rmk risk">⚠ ${e(c.t('register.remarkAtRisk'))}</td>`;
  if (row.pct !== null && row.pct >= c.register.threshold) return `<td class="rmk ok">${e(c.t('register.remarkMeets', { pct: c.register.threshold }))}</td>`;
  return `<td class="rmk">${e(c.t('reports.noValue'))}</td>`;
}

function studentRow(c: DocContext, batch: BatchRegister, row: RegisterRow, index: number, dayCls: readonly string[]): string {
  const s = row.student;
  const name = `<span class="nm">${e(s.name)}</span>${s.fatherName ? `<span class="fa">${e(s.fatherName)}</span>` : ''}`;
  const cells = batch.days
    .map((_, i) => {
      const view = cellView(c, row.cells[i]);
      const star = row.cells[i]?.corrected ? '<sup class="star">*</sup>' : '';
      return `<td class="${cls('c', dayCls[i], view.cls)}">${e(view.text)}${star}</td>`;
    })
    .join('');
  const n = c.format.number;
  const pct = row.pct === null ? c.t('reports.noValue') : n(row.pct);
  return (
    `<tr class="${cls('st', row.atRisk ? 'risk' : '')}" data-roll="${e(s.rollNo)}">` +
    `<td class="num sticky k1">${e(n(index + 1))}</td><td class="num sticky k2">${e(n(s.rollNo))}</td>` +
    `<td class="name sticky k3">${name}</td>${cells}` +
    `<td class="fig f-present">${e(n(row.present))}</td><td class="fig f-absent">${e(n(row.absent))}</td>` +
    `<td class="fig f-leave">${e(n(row.leave))}</td><td class="fig f-pct">${e(pct)}</td>${remark(c, row)}</tr>`
  );
}

export function registerTable(c: DocContext, batch: BatchRegister): string {
  const { t, format } = c;
  const dayCls = batch.days.map(dayClasses);
  const cols = `<colgroup><col class="k-no"><col class="k-roll"><col class="k-name">${'<col class="k-day">'.repeat(batch.days.length)}<col class="k-fig"><col class="k-fig"><col class="k-fig"><col class="k-pct"><col class="k-rmk"></colgroup>`;
  const head1 =
    `<tr class="h1"><th class="sticky k1" rowspan="2" scope="col">${e(t('register.col.no'))}</th>` +
    `<th class="sticky k2" rowspan="2" scope="col">${e(t('register.col.roll'))}</th>` +
    `<th class="name l sticky k3" rowspan="2" scope="col">${e(t('register.col.student'))}</th>` +
    batch.days.map((d, i) => `<th class="${cls('d', dayCls[i])}" scope="col">${e(format.number(Number(d.date.slice(8))))}</th>`).join('') +
    (['present', 'absent', 'leave', 'pct'] as const).map((k) => `<th rowspan="2" scope="col">${e(t(`register.col.${k}`))}</th>`).join('') +
    `<th class="l" rowspan="2" scope="col">${e(t('register.col.remark'))}</th></tr>`;
  const head2 = `<tr class="h2">${batch.days.map((d, i) => `<th class="${cls('w', dayCls[i])}" scope="col">${e(c.weekday(d.date))}</th>`).join('')}</tr>`;
  const body = batch.rows.map((row, i) => studentRow(c, batch, row, i, dayCls)).join('');
  const sum = (pick: (r: RegisterRow) => number) => batch.rows.reduce((a, r) => a + pick(r), 0);
  const foot =
    `<tr class="tot"><th class="sticky k1" colspan="3" scope="row">${e(t('register.presentByDay'))}</th>` +
    batch.days.map((d, i) => `<td class="${cls('c', dayCls[i])}">${d.kind === 'class' ? e(format.number(d.present)) : ''}</td>`).join('') +
    `<td class="fig">${e(format.number(oneDecimal(sum((r) => r.present))))}</td><td class="fig">${e(format.number(sum((r) => r.absent)))}</td>` +
    `<td class="fig">${e(format.number(sum((r) => r.leave)))}</td>` +
    `<td class="fig">${e(batch.pct === null ? t('reports.noValue') : format.number(batch.pct))}</td><td></td></tr>`;
  return (
    `<div class="reg-wrap"><table class="reg" style="--days:${batch.days.length}">${cols}` +
    `<thead>${head1}${head2}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot></table></div>`
  );
}

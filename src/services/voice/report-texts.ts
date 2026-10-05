/**
 * Texts of the report tools (D-140): every figure is worked out by the app (ReportService, the register) and written
 * into the instruction, so the model only says it. Answers are one or two short sentences, then an offer to show the
 * report (show_report). Model-facing text is English; names pass through `nameText` (data, never instructions).
 * Tuned against the live model: change wording only with a rehearsal (`npm run test:voice-live`).
 * Pure TypeScript: no I/O, no clock, no framework.
 */
import { nameText } from './labels';

/** One student's figures as the report tools return them. */
export interface StudentFigure {
  readonly name: string;
  readonly roll: number;
  readonly pct: number | null;
  readonly days_present: number;
  readonly days_marked: number;
}

/** One batch in the overview. */
export interface BatchLine {
  readonly id: string;
  readonly label: string;
  readonly students: number;
  readonly avg_pct: number | null;
  /** Students at risk in the batch (left out where the screen has no at-risk section). */
  readonly at_risk?: number;
  readonly this_month_pct: number | null;
  readonly last_month_pct: number | null;
}

/** The window and rule every figure is read against. */
export interface ReportRules {
  readonly windowDays: number;
  readonly threshold: number;
}

export const ANSWER = "Answer the trainer's question in one or two short sentences with these numbers; never work out a figure yourself.";
export const SHOW_OFFER = 'Then ask whether to show it on the screen; on yes, call show_report.';

const answer = (facts: string): string => `${facts} ${ANSWER} ${SHOW_OFFER}`;
const pctText = (pct: number | null): string => (pct === null ? 'no marks yet' : `${pct}%`);
const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** "this month 86%, last month 88% (down 2 points)"; null when neither month has a figure. */
export function trendText(thisMonth: number | null, lastMonth: number | null): string | null {
  if (thisMonth === null && lastMonth === null) return null;
  const head = `this month ${pctText(thisMonth)}, last month ${pctText(lastMonth)}`;
  if (thisMonth === null || lastMonth === null) return head;
  const change = thisMonth - lastMonth;
  if (!change) return `${head} (the same)`;
  return `${head} (${change > 0 ? 'up' : 'down'} ${plural(Math.abs(change), 'point')})`;
}

/** "Aniket Bhosale 46% (12 of 26 days)". */
export const figureText = (s: StudentFigure): string => `${nameText(s.name)} ${pctText(s.pct)} (${s.days_present} of ${s.days_marked} days)`;

/** Names read out, at most `max`, then "and N more". */
function someNames(names: readonly string[], max: number): string {
  const shown = names.slice(0, max).map(nameText).join(', ');
  return names.length > max ? `${shown} and ${names.length - max} more` : shown;
}

const batchFigure = (b: BatchLine): string => `${b.label} ${pctText(b.avg_pct)}`;

/** Lowest and highest batch by average (batches without marks left out); '' with fewer than two. */
function extremes(batches: readonly BatchLine[]): string {
  const scored = batches.filter((b) => b.avg_pct !== null);
  if (scored.length < 2) return '';
  const low = scored.reduce((a, b) => ((b.avg_pct ?? 0) < (a.avg_pct ?? 0) ? b : a));
  const high = scored.reduce((a, b) => ((b.avg_pct ?? 0) > (a.avg_pct ?? 0) ? b : a));
  return ` Lowest batch: ${batchFigure(low)}; highest: ${batchFigure(high)}.`;
}

export interface OverviewFacts extends ReportRules {
  /** The batches, as the batches section shows them (empty where the screen has no batches section). */
  readonly batches: readonly BatchLine[];
  /** Students at risk in all (null where the screen has no at-risk section: nothing is said about it). */
  readonly atRiskTotal: number | null;
  /** The scope as a whole, month by month (the register's figures). */
  readonly thisMonth: number | null;
  readonly lastMonth: number | null;
  /** The principal's headline (null for an instructor). */
  readonly institute: { readonly avg_pct: number | null; readonly students: number; readonly batches: number; readonly staff_pct: number | null } | null;
}

export const NO_BATCHES = 'The trainer has no batches in their reports yet. Say so in one short line.';

/** Up to this many batches are named one by one; more are summed up as the lowest and highest. */
const LISTED_BATCHES = 4;

/** The parts that are there, joined with "; " ('' with none). */
const joined = (parts: readonly (string | null)[]): string => parts.filter((p): p is string => !!p).join('; ');

export function overviewInstruction(o: OverviewFacts): string {
  const window = `over the last ${o.windowDays} days`;
  const trend = trendText(o.thisMonth, o.lastMonth);
  const risk = o.atRiskTotal === null ? null : `${plural(o.atRiskTotal, 'student')} at risk (below ${o.threshold}%)`;
  if (o.institute) {
    const i = o.institute;
    const staff = i.staff_pct === null ? '' : `, staff presence ${i.staff_pct}%`;
    const rest = joined([trend && `${trend[0].toUpperCase()}${trend.slice(1)}`, risk]);
    return answer(`The institute ${window}: ${pctText(i.avg_pct)} average, ${plural(i.students, 'student')} in ${plural(i.batches, 'batch', 'batches')}${staff}.${extremes(o.batches)}${rest ? ` ${rest}.` : ''}`);
  }
  if (!o.batches.length) return NO_BATCHES;
  // a batch's at-risk count only with the at-risk section (atRiskTotal is null without it)
  const batchRisk = (b: BatchLine): string => (risk !== null && b.at_risk !== undefined ? `, ${b.at_risk} at risk` : '');
  const each = o.batches.length <= LISTED_BATCHES
    ? `: ${o.batches.map((b) => `${b.label} ${pctText(b.avg_pct)} (${plural(b.students, 'student')}${batchRisk(b)})`).join('; ')}.`
    : `.${extremes(o.batches)}`;
  const all = joined([trend, risk]);
  return answer(`The trainer's ${plural(o.batches.length, 'batch', 'batches')} ${window}${each}${all ? ` In all: ${all}.` : ''}`);
}

export interface BatchFacts extends ReportRules {
  readonly label: string;
  readonly students: number;
  readonly avgPct: number | null;
  readonly thisMonth: number | null;
  readonly lastMonth: number | null;
  readonly lowest: readonly StudentFigure[];
  readonly highest: readonly StudentFigure[];
  readonly atRisk: readonly StudentFigure[];
}

export function batchInstruction(b: BatchFacts): string {
  const trend = trendText(b.thisMonth, b.lastMonth);
  const head = `Report of ${b.label} over the last ${b.windowDays} days: average ${pctText(b.avgPct)} (${plural(b.students, 'student')})${trend ? `; ${trend}` : ''}.`;
  if (!b.lowest.length) return answer(`${head} No student has marks yet.`);
  const lowest = ` Lowest: ${b.lowest.map(figureText).join(', ')}.`;
  const highest = ` Highest: ${b.highest.map(figureText).join(', ')}.`;
  const risk = b.atRisk.length
    ? ` ${plural(b.atRisk.length, 'student')} at risk (below ${b.threshold}%): ${someNames(b.atRisk.map((s) => s.name), 5)}.`
    : ` No student at risk (below ${b.threshold}%).`;
  return answer(`${head}${lowest}${highest}${risk}`);
}

export interface StudentFacts extends ReportRules {
  readonly figure: StudentFigure;
  readonly batch: string;
  readonly atRisk: boolean;
  /** Spoken dates, newest first, at most five. */
  readonly absences: readonly string[];
}

export function studentInstruction(s: StudentFacts): string {
  const f = s.figure;
  const who = `${nameText(f.name)} (roll ${f.roll}, ${s.batch})`;
  if (f.pct === null) return answer(`${who} has no attendance marked over the last ${s.windowDays} days.`);
  const risk = s.atRisk ? `at risk (below ${s.threshold}%)` : `not at risk (the threshold is ${s.threshold}%)`;
  const absences = s.absences.length ? ` Last absences: ${s.absences.join('; ')}.` : ' No absences this month or last month.';
  return answer(`${who} over the last ${s.windowDays} days: ${f.pct}% (${f.days_present} of ${f.days_marked} days present), ${risk}.${absences}`);
}

export interface AtRiskFacts extends ReportRules {
  /** Lowest first, each with their batch's label. */
  readonly students: readonly (StudentFigure & { readonly batch: string })[];
  readonly batchesWithRisk: number;
}

export function atRiskInstruction(a: AtRiskFacts): string {
  if (!a.students.length) return `No student is below ${a.threshold}% over the last ${a.windowDays} days. Say so in one short line.`;
  const named = a.students.slice(0, 5).map((s) => `${nameText(s.name)} ${pctText(s.pct)} (${s.batch})`).join(', ');
  const more = a.students.length > 5 ? ` and ${a.students.length - 5} more` : '';
  const where = ` in ${plural(a.batchesWithRisk, 'batch', 'batches')}`;
  return answer(`${plural(a.students.length, 'student')} at risk (below ${a.threshold}% over the last ${a.windowDays} days)${where}; lowest first: ${named}${more}. Say the count, then name the lowest three (or fewer) with their percentage.`);
}

export const SHOWN_REPORT = 'The report is on the screen. Say so in a few words.';

/** download_register: the sheet is open; the browser download needs the trainer's own tap. */
export const registerInstruction = (target: string, month: string, wholeTrade: boolean): string =>
  `The register of ${wholeTrade ? `the whole ${target} trade` : target} for ${month} is open on the screen. Tell the trainer to tap Download to save it, in one short line.`;

/** A batch the words did not settle: ask which, with the choices. */
export const batchChoices = (labels: readonly string[]): string => labels.join('; ');

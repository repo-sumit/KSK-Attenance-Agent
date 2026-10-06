/**
 * The monthly attendance register as one self-contained HTML document (D-137): inline styles, the emblem only as
 * a data: URL, no network, a CSP that allows only the print button's script. Pure: returns the HTML string.
 */
import type { I18n } from '@/i18n';
import { instantAt, type LocalDate } from '@/lib/time';
import type { AttendanceRegister } from '@/services/report-register';
import { escapeHtml as e } from './escape';
import { batchSection, batchTitle, tradeSummary, type RegisterHeader, type SheetContext } from './registerParts';
import { REGISTER_STYLES } from './registerStyles';

export interface RegisterDocumentOptions {
  readonly t: I18n['t'];
  readonly format: I18n['format'];
  readonly lang: 'en' | 'mr';
  /** A data: URL of the KSK emblem, or undefined (then no logo). */
  readonly logo?: string;
  readonly scope: { readonly kind: 'batch' } | { readonly kind: 'trade'; readonly tradeName: string };
  /** Demo builds say the data is sample data. */
  readonly sampleData: boolean;
}

/** The document's only script: the toolbar's Print button. Its hash is pinned in the CSP (a unit test recomputes it). */
export const PRINT_SCRIPT = 'document.getElementById("print").addEventListener("click",function(){window.print()});';
export const PRINT_SCRIPT_HASH = 'Jl0J4zGwzlkn1knGoO6FNchFw3ASc0XKmH/Sh6Rl5ZE=';
const CSP = `default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'sha256-${PRINT_SCRIPT_HASH}'`;

const TIME_ZONE = 'Asia/Kolkata';
/** Only an inline raster image is embedded (once, in the stylesheet); anything else (a URL, markup) is dropped. */
const DATA_IMAGE = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/;

/** The sheet context for any register (student or staff): the month's name, narrow weekdays, a validated logo. */
export function sheetContext<R extends RegisterHeader>(register: R, options: Pick<RegisterDocumentOptions, 't' | 'format' | 'logo' | 'sampleData'>): SheetContext<R> {
  const { locale } = options.format;
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'narrow', timeZone: TIME_ZONE });
  const noon = (date: LocalDate) => instantAt(date, '12:00');
  return {
    t: options.t,
    format: options.format,
    register,
    monthLabel: options.format.monthYear(register.month),
    weekday: (date) => weekday.format(noon(date)),
    ...(options.logo && DATA_IMAGE.test(options.logo) ? { logo: options.logo } : {}),
    sampleData: options.sampleData,
  };
}

/**
 * The document around the sheets, shared by every register: the CSP, the stylesheet with the emblem embedded once
 * (only a validated data: URL), the toolbar with its Print button and the only script. `sheets` is escaped markup.
 */
export function documentShell(c: SheetContext, parts: { readonly lang: 'en' | 'mr'; readonly title: string; readonly name: string; readonly styles?: string; readonly sheets: string }): string {
  const { t } = c;
  return (
    `<!doctype html><html lang="${parts.lang === 'mr' ? 'mr' : 'en'}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta http-equiv="Content-Security-Policy" content="${CSP}">` +
    `<title>${e(parts.title)}</title><style>${REGISTER_STYLES}${parts.styles ?? ''}${c.logo ? `.emblem{background:url("${c.logo}") center/contain no-repeat}` : ''}</style></head><body>` +
    `<div class="toolbar"><span class="toolbar-title">${e(`${t('register.app')} · ${parts.name}`)}</span>` +
    `<button id="print" type="button">${e(t('register.print'))}</button></div>` +
    `<main>${parts.sheets}</main><script>${PRINT_SCRIPT}</script></body></html>`
  );
}

export function registerDocument(register: AttendanceRegister, options: RegisterDocumentOptions): string {
  const c = sheetContext(register, options);
  const { t, scope } = options;
  const subject = scope.kind === 'trade' ? scope.tradeName : register.batches[0] ? batchTitle(c, register.batches[0]) : '';
  const title = [t('register.title'), subject, c.monthLabel].filter(Boolean).join(' · ');
  const sheets = (scope.kind === 'trade' ? tradeSummary(c, scope.tradeName) : '') + register.batches.map((b) => batchSection(c, b)).join('');
  return documentShell(c, { lang: options.lang, title, name: t('register.title'), sheets });
}

const slug = (text: string) =>
  text
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'trade';

/** "KSK-register_electrician_S1-U1_2026-10.html" for a batch, "KSK-register_electrician_2026-10.html" for a trade. */
export function registerFileName(register: AttendanceRegister, scope: RegisterDocumentOptions['scope']): string {
  const month = register.month.slice(0, 7);
  if (scope.kind === 'trade') return `KSK-register_${slug(scope.tradeName)}_${month}.html`;
  const first = register.batches[0];
  const batch = first ? `${slug(first.trade.name)}_S${first.batch.shift}-U${first.batch.unit}` : 'batch';
  return `KSK-register_${batch}_${month}.html`;
}

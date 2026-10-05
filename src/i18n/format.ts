/**
 * Locale-aware formatting pinned to IST. Marathi uses Latin digits by default
 * (config i18n.numerals = 'latin', decided with the product owner): the locale
 * becomes mr-IN-u-nu-latn, so weekday and month names are Marathi, digits 0–9.
 */
import type { Language } from '@/config/types';
import { distanceParts } from '@/domain/geo';
import { instantAt, type LocalDate } from '@/lib/time';

const TIME_ZONE = 'Asia/Kolkata';
const NBSP = '\u00a0';

export function localeFor(language: Language, numerals: 'locale' | 'latin'): string {
  if (language === 'mr') return numerals === 'latin' ? 'mr-IN-u-nu-latn' : 'mr-IN';
  return 'en-IN';
}

export function createFormatters(locale: string) {
  const time = new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: TIME_ZONE });
  const longDate = new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: TIME_ZONE });
  const shortDate = new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', timeZone: TIME_ZONE });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone: TIME_ZONE });
  const dayMonthYear = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: TIME_ZONE });
  const monthShort = new Intl.DateTimeFormat(locale, { month: 'short', timeZone: TIME_ZONE });
  const monthYear = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric', timeZone: TIME_ZONE });
  const number = new Intl.NumberFormat(locale);
  const decimal = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  /** "10:42 AM" — day period upper-cased as in the prototype, joined by a no-break space so "AM" never wraps alone. */
  const formatTime = (instant: Date | string) =>
    time
      .formatToParts(typeof instant === 'string' ? new Date(instant) : instant)
      .map((p) => (p.type === 'dayPeriod' ? p.value.toUpperCase() : p.type === 'literal' ? p.value.replace(/\s/g, NBSP) : p.value))
      .join('');

  /** en-IN prints "Sept"; the prototype (and most Indian print) uses "Sep". */
  const dateText = (format: Intl.DateTimeFormat, instant: Date) =>
    format
      .formatToParts(instant)
      .map((p) => (p.type === 'month' && p.value === 'Sept' ? 'Sep' : p.value))
      .join('');

  const atNoon = (date: LocalDate) => instantAt(date, '12:00');

  /** "7:00 – 8:00 AM": the day period is written once when both ends share it (prototype). */
  const clockRange = (date: LocalDate, from: string, to: string) => {
    const start = time.formatToParts(instantAt(date, from));
    const end = time.formatToParts(instantAt(date, to));
    const period = (parts: Intl.DateTimeFormatPart[]) => (parts.at(-1)?.type === 'dayPeriod' ? parts.at(-1)?.value : undefined);
    const shared = period(start) !== undefined && period(start) === period(end);
    const head = shared
      ? start
          .slice(0, -1)
          .map((p) => p.value)
          .join('')
          .trim()
      : formatTime(instantAt(date, from));
    return `${head.replace(/\s/g, NBSP)} – ${formatTime(instantAt(date, to))}`;
  };

  return {
    locale,
    time: formatTime,
    /** A LocalTime ("14:00") as "2:00 PM". */
    clockTime: (date: LocalDate, hhmm: string) => formatTime(instantAt(date, hhmm)),
    clockRange,
    /** "Friday, 25 September" */
    longDate: (date: LocalDate) => longDate.format(atNoon(date)),
    /** "Fri, 25 Sep" */
    shortDate: (date: LocalDate) => dateText(shortDate, atNoon(date)),
    /** "25 Sep" */
    dayMonth: (date: LocalDate) => dateText(dayMonth, atNoon(date)),
    /** "25 Sep 2026" */
    dayMonthYear: (date: LocalDate) => dateText(dayMonthYear, atNoon(date)),
    /** "Sep" */
    monthShort: (date: LocalDate) => dateText(monthShort, atNoon(date)),
    /** "September 2026" */
    monthYear: (date: LocalDate) => monthYear.format(atNoon(date)),
    number: (n: number) => number.format(n),
    percent: (n: number) => `${number.format(n)}%`,
    /** PRD §8.2: metres under 1 km, kilometres to two decimals above. */
    distance: (meters: number) => {
      const { value, unit } = distanceParts(meters);
      return unit === 'm' ? `${number.format(value)}${NBSP}m` : `${decimal.format(value)}${NBSP}km`;
    },
  };
}

export type Formatters = ReturnType<typeof createFormatters>;

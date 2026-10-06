/**
 * Calendar/time helpers pinned to India Standard Time (UTC+05:30, no DST), so
 * "today", windows and same-day rules behave identically on any device clock
 * time zone and in tests.
 *
 * LocalDate = 'YYYY-MM-DD' (IST calendar day). LocalTime = 'HH:MM' (24h, IST).
 */
export type LocalDate = string;
export type LocalTime = string;

export const IST_OFFSET_MINUTES = 330;
const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

function istParts(instant: Date): Date {
  return new Date(instant.getTime() + IST_OFFSET_MINUTES * MS_PER_MINUTE);
}

const pad = (n: number) => String(n).padStart(2, '0');

export function toLocalDate(instant: Date): LocalDate {
  const d = istParts(instant);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function toLocalTime(instant: Date): LocalTime {
  const d = istParts(instant);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

/** Minutes since IST midnight for an instant. */
export function minutesOfDay(instant: Date): number {
  const d = istParts(instant);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

export type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

/**
 * The IST time of day an instant falls in (greetings, D-151): morning 05:00–11:59, afternoon 12:00–16:59,
 * evening 17:00–20:59, night 21:00–04:59.
 */
export function dayPart(instant: Date): DayPart {
  const minutes = minutesOfDay(instant);
  if (minutes < 5 * 60) return 'night';
  if (minutes < 12 * 60) return 'morning';
  if (minutes < 17 * 60) return 'afternoon';
  if (minutes < 21 * 60) return 'evening';
  return 'night';
}

export function parseTime(time: LocalTime): number {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
}

export function formatMinutes(minutes: number): LocalTime {
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

/** The instant at which a local IST date + time occurs. */
export function instantAt(date: LocalDate, time: LocalTime): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const utcMs = Date.UTC(y, mo - 1, d) + parseTime(time) * MS_PER_MINUTE - IST_OFFSET_MINUTES * MS_PER_MINUTE;
  return new Date(utcMs);
}

export function addDays(date: LocalDate, days: number): LocalDate {
  const [y, mo, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, mo - 1, d) + days * MS_PER_DAY);
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** 0 = Sunday … 6 = Saturday, for an IST calendar date. */
export function dayOfWeek(date: LocalDate): number {
  const [y, mo, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
}

export function compareDates(a: LocalDate, b: LocalDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Inclusive list of dates from start to end. */
export function eachDate(start: LocalDate, end: LocalDate): LocalDate[] {
  const out: LocalDate[] = [];
  for (let d = start; compareDates(d, end) <= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export function startOfMonth(date: LocalDate): LocalDate {
  return `${date.slice(0, 7)}-01`;
}

/** First day of the month `months` away from date's month (negative = earlier). */
export function shiftMonth(date: LocalDate, months: number): LocalDate {
  const [y, mo] = date.split('-').map(Number);
  const index = y * 12 + (mo - 1) + months;
  return `${Math.floor(index / 12)}-${pad((index % 12) + 1)}-01`;
}

/** Last day of date's month. */
export function endOfMonth(date: LocalDate): LocalDate {
  return addDays(shiftMonth(date, 1), -1);
}

/** Monday of the ISO week containing date. */
export function startOfWeek(date: LocalDate): LocalDate {
  const dow = dayOfWeek(date);
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** Source of "now". Injected everywhere so demo and tests control time. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };

/** A clock frozen at (or offset from) a chosen instant — used by tests and the demo. */
export class FixedClock implements Clock {
  constructor(private instant: Date) {}
  now(): Date {
    return new Date(this.instant.getTime());
  }
  set(instant: Date): void {
    this.instant = instant;
  }
}

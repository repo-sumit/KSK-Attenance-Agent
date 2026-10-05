/**
 * Every in-app URL. Pathnames are static (prerendered, cacheable for offline);
 * entity ids travel in the query string. Components never build URLs by hand.
 */
import type { ReportBlock, DateRangeKind } from '@/config/types';

const qs = (params: Record<string, string | undefined>) => {
  const entries = Object.entries(params).filter((e): e is [string, string] => Boolean(e[1]));
  return entries.length ? `?${new URLSearchParams(entries).toString()}` : '';
};

/** The detail report screen's pathname (its block and range travel in the query string). */
const REPORT_VIEW = '/reports/view';

export const routes = {
  root: '/',
  login: '/login',
  loginInstitute: '/login/institute',
  loginTrainer: '/login/trainer',
  loginIdentity: '/login/identity',
  face: (next?: string) => `/face${qs({ next })}`,
  home: '/home',
  attendance: '/attendance',
  staff: '/attendance/staff',
  trade: (tradeId: string) => `/attendance/trade${qs({ trade: tradeId })}`,
  open: (key: string) => `/attendance/open${qs({ s: key })}`,
  mark: (key: string) => `/attendance/mark${qs({ s: key })}`,
  review: (key: string) => `/attendance/review${qs({ s: key })}`,
  submitted: (key: string) => `/attendance/submitted${qs({ s: key })}`,
  record: (key: string) => `/attendance/record${qs({ s: key })}`,
  correct: (key: string, studentId: string) => `/attendance/correct${qs({ s: key, student: studentId })}`,
  selfAttendance: '/me/attendance',
  reports: '/reports',
  /** The detail report screen without a query (what a pathname is compared with). */
  reportView: REPORT_VIEW,
  /** Detail reports (staff attendance, correction log) with a date range. */
  report: (block: ReportBlock, range?: DateRangeKind, extra: { from?: string; to?: string } = {}) => `${REPORT_VIEW}${qs({ r: block, range, ...extra })}`,
  /** Offline data lives under Reports (D-056); /profile/offline redirects here. */
  offline: '/reports/offline',
  offlineDownload: '/reports/offline/download',
} as const;

/** Only same-app paths may be used as a post-step redirect target. */
const INTERNAL_PREFIXES = ['/home', '/attendance', '/me/', '/reports', '/face'];

export function safeNext(next: string | null | undefined, fallback: string = routes.home): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return fallback;
  return INTERNAL_PREFIXES.some((p) => next === p || next.startsWith(p)) ? next : fallback;
}

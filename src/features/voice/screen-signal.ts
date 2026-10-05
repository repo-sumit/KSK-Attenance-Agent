/**
 * The screen the trainer is on, as the voice executor reads it (voice design §5.3), and what a running voice
 * session depends on. Pure: no React, no browser.
 */
import type { NavTarget } from '@/domain/voice/plan';
import { routes } from '@/lib/routes';
import type { SessionContext } from '@/services/context';
import type { ScreenSignal } from '@/services/voice/executor';

type SessionScreen = Extract<ScreenSignal, { sessionKey: string }>['kind'];

/** The pathnames come from routes (an empty key leaves the query out), so a route rename cannot desync them. */
const SESSION_SCREENS: ReadonlyMap<string, SessionScreen> = new Map([
  [routes.open(''), 'open'],
  [routes.mark(''), 'mark'],
  [routes.review(''), 'review'],
  [routes.submitted(''), 'submitted'],
  [routes.record(''), 'record'],
]);

/** The other screens voice can name in its texts ("the trainer is on the Reports screen"). */
const NAMED_SCREENS: ReadonlyMap<string, NavTarget> = new Map([
  [routes.reports, 'reports'],
  [routes.reportView, 'reports'],
  [routes.offline, 'offline'],
  [routes.offlineDownload, 'offline'],
  [routes.staff, 'staff_attendance'],
  [routes.attendance, 'attendance'],
]);

export function screenSignal(pathname: string, search: URLSearchParams): ScreenSignal {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === routes.home) return { kind: 'home' };
  if (path === routes.selfAttendance) return { kind: 'self' };
  if (path === routes.trade('')) {
    const tradeId = search.get('trade');
    return tradeId ? { kind: 'trade', tradeId } : { kind: 'other' };
  }
  const kind = SESSION_SCREENS.get(path);
  const sessionKey = search.get('s');
  if (kind && sessionKey) return { kind, sessionKey };
  const screen = NAMED_SCREENS.get(path);
  return screen ? { kind: 'other', screen } : { kind: 'other' };
}

/**
 * What must stay the same for a running voice session to continue. The demo rebuilds the SessionContext on any
 * panel change (clock, network, simulation), so the object itself is not compared: only who, where, the resolved
 * configuration and whether face enrolment is still owed.
 */
export function voiceFingerprint(ctx: SessionContext): string {
  return `${ctx.user.id}|${ctx.institute.id}|${JSON.stringify(ctx.config)}|${ctx.journey.faceEnrolmentRequired}`;
}

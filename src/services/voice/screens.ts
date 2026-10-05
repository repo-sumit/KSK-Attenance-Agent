/**
 * The screens voice can open (navigate, D-139): one entry per plan target, with the name the model says and the href
 * built with `routes`. Announcements open on Home, in the notices sheet (the `show_announcements` bus event).
 * Model-facing text is English. Pure TypeScript: no I/O, no framework.
 */
import type { NavTarget } from '@/domain/voice/plan';
import { routes } from '@/lib/routes';

export const SCREENS: Readonly<Record<NavTarget, { readonly name: string; readonly href: string }>> = {
  home: { name: 'Home', href: routes.home },
  attendance: { name: 'Attendance', href: routes.attendance },
  reports: { name: 'Reports', href: routes.reports },
  my_attendance: { name: 'My attendance', href: routes.selfAttendance },
  offline: { name: 'Offline data', href: routes.offline },
  staff_attendance: { name: 'Staff attendance', href: routes.staff },
  announcements: { name: 'Announcements', href: routes.home },
};

/** "Home, Reports or Announcements" (`joiner` "and" for a statement). */
export function screenNames(targets: readonly NavTarget[], joiner: 'or' | 'and' = 'or'): string {
  const names = targets.map((t) => SCREENS[t].name);
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} ${joiner} ${names.at(-1)}` : (names[0] ?? '');
}

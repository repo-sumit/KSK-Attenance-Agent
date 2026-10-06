import type { I18n } from '@/i18n';
import type { SessionContext } from '@/services/context';

/** The signed-in user's role and, on an instructor's journey, their subject or trade ("Instructor", "Electrician"). */
export function userRole(t: I18n['t'], ctx: SessionContext): { readonly role: string; readonly trade: string | null } {
  const role = t(`role.${ctx.user.role}`);
  const subject = ctx.data.subjects.find((s) => s.id === ctx.user.subjectId)?.name;
  const trade = ctx.data.trades.find((x) => x.id === ctx.user.primaryTradeId)?.name;
  const specialty = subject ?? trade;
  return { role, trade: specialty && ctx.journey.homeVariant === 'instructor' ? specialty : null };
}

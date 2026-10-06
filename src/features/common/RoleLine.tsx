import { LatinText } from './LatinText';

/**
 * "Instructor · Electrician", "निदेशक · Electrician": the translated role, then the trade or subject name as Latin
 * master data. Never the whole line in <Latin>: the role is translated text (DESIGN_SYSTEM.md Fonts).
 */
export function RoleLine({ role, trade }: { readonly role: string; readonly trade?: string | null }) {
  return trade ? <LatinText k="role.withTrade" params={{ role, trade }} latin={['trade']} /> : <>{role}</>;
}

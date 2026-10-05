/** HTML escaping for the register document: every dynamic string goes through it, in text and in attributes. */
const ENTITIES: Readonly<Record<string, string>> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHtml(value: string | number): string {
  return String(value).replace(/[&<>"']/g, (ch) => ENTITIES[ch]);
}

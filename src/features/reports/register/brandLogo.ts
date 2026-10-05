/**
 * The KSK emblem for the register's header, as a data: URL (the document loads nothing from the network).
 * Fetched from the app's own origin once per page load; any failure (offline, no DOM) gives undefined, and the
 * register is built without a logo. A failure is not remembered, so a later download tries again.
 */
const EMBLEM = '/branding/ksk-emblem.png';

let cached: Promise<string | undefined> | undefined;

const asDataUrl = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('emblem')));
    reader.onerror = () => reject(new Error('emblem'));
    reader.readAsDataURL(blob);
  });

async function load(): Promise<string | undefined> {
  const response = await fetch(EMBLEM);
  if (!response.ok) throw new Error('emblem');
  return asDataUrl(await response.blob());
}

export function brandLogo(): Promise<string | undefined> {
  if (typeof fetch !== 'function' || typeof FileReader === 'undefined') return Promise.resolve(undefined);
  cached ??= load().catch(() => {
    cached = undefined;
    return undefined;
  });
  return cached;
}

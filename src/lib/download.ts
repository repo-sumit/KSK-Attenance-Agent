import { isEmbeddedWebView } from './platform';

/** How long the object URL outlives the click: long enough for a slow device to start the download. */
const REVOKE_AFTER_MS = 30_000;

/**
 * Saves text as a file through a temporary <a download> on an object URL. False (and nothing attempted) without
 * a DOM or inside an embedded WebView, where downloads need the host app's support.
 */
export function saveTextFile(name: string, text: string, type = 'text/html;charset=utf-8'): boolean {
  if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function' || isEmbeddedWebView()) return false;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), REVOKE_AFTER_MS);
  return true;
}

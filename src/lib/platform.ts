/**
 * Where the app is running. An Android WebView (SwiftChat opens the MiniApp in one) says "; wv)" in its user
 * agent; such a WebView exposes window.print and <a download> but ignores them unless the host app wires them up.
 */
export function isEmbeddedWebView(): boolean {
  return typeof navigator !== 'undefined' && /; wv\)/.test(navigator.userAgent);
}

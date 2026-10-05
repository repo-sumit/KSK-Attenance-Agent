/**
 * The Gemini Live origin, for the idle Voice Agent button's preconnect (D-138). Kept apart from ./gemini so the
 * float can import it without pulling the SDK into the first-load bundle: no SDK import here.
 */
export const GEMINI_LIVE_ORIGIN = 'https://generativelanguage.googleapis.com';

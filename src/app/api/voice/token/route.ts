// POST /api/voice/token: the one server endpoint of Voice Agent (D-078; design spec §2, §4, §10).
// Same origin, no body. It hands the browser a single-use Gemini Live token; the API key never leaves the server.
//   200 { token, expiresAt, model, apiVersion }
//   403 { error: 'origin' }   429 { error: 'rate_limited', retryAfterS }   503 { error: 'unavailable' }
import { FixedWindowLimiter, clientKey, originAllowed } from '@/server/voice/guard';
import { LIVE_API_VERSION, VOICE_MODEL, mintVoiceToken } from '@/server/voice/token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * 20 tokens per client IP in 10 minutes (spec §10). One trainer needs about one token per 10-minute connection, so
 * this stops loops and scripts. Everyone behind one shared IP (an institute's Wi-Fi) shares the budget; the count
 * is per server instance, which is enough for a brake and is not a quota. `next dev` gives every local tab, agent
 * and script one key, so a development server allows 200 (D-158); production keeps 20 (D-107).
 */
const limiter = new FixedWindowLimiter(process.env.NODE_ENV === 'development' ? 200 : 20, 10 * 60_000);

/** Every answer is private to this request: a token must never be cached or shared. */
function reply(body: object, status: number, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

/** Set after the missing-key line was logged, so a misconfigured deployment logs it once, not once per request. */
let missingKeyLogged = false;

/** Extra origins that may ask for a token (for example the SwiftChat host page), from VOICE_ALLOWED_ORIGINS. */
function extraOrigins(): string[] {
  return (process.env.VOICE_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export async function POST(request: Request): Promise<Response> {
  if (!originAllowed(request.headers.get('origin'), request.headers.get('host'), extraOrigins())) {
    return reply({ error: 'origin' }, 403);
  }

  const client = clientKey(request.headers.get('x-forwarded-for'));
  const nowMs = Date.now();
  if (!limiter.hit(client, nowMs)) {
    const retryAfterS = Math.max(1, Math.ceil(limiter.retryAfterMs(client, nowMs) / 1000));
    return reply({ error: 'rate_limited', retryAfterS }, 429, { 'Retry-After': String(retryAfterS) });
  }

  // Only the two variables the mint needs, read now (at request time), not captured when the module loads.
  const env = { GEMINI_API_KEY: process.env.GEMINI_API_KEY, VOICE_DISABLED: process.env.VOICE_DISABLED };
  // A missing key is a deployment mistake worth one log line; the kill switch is deliberate and stays silent.
  // The line is fixed text: no key value is ever printed.
  if (!env.GEMINI_API_KEY && env.VOICE_DISABLED !== '1' && !missingKeyLogged) {
    missingKeyLogged = true;
    console.error('[voice-token] GEMINI_API_KEY is not set');
  }
  const minted = await mintVoiceToken(env, new Date(nowMs));
  if (!minted.ok) return reply({ error: 'unavailable' }, 503);
  return reply({ token: minted.token, expiresAt: minted.expiresAt, model: VOICE_MODEL, apiVersion: LIVE_API_VERSION }, 200);
}

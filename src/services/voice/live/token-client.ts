/** Fetches the single-use Gemini Live token from our own route (D-078). Never logs the token. */
import { err, ok, type Result } from '@/lib/result';
import type { LiveToken } from './transport';

export type TokenError = 'unavailable' | 'rate_limited' | 'origin' | 'network';

/**
 * Why a token failed, for the `?voiceDebug=1` log only (codes, never the body): `detail.why` on every error.
 * `http 4xx` / `http 5xx` are the status class (a missing key or the kill switch answers 503).
 */
export type TokenFailure = 'network' | 'origin' | 'rate_limited' | `http ${number}xx` | 'malformed' | 'timeout' | 'cancelled';

const fail = (error: TokenError, why: TokenFailure) => err(error, { why });

const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

function parseToken(body: unknown): LiveToken | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!text(b.token) || !text(b.apiVersion) || !text(b.model) || !text(b.expiresAt)) return null;
  return { token: b.token, apiVersion: b.apiVersion, model: b.model, expiresAt: b.expiresAt };
}

export async function fetchLiveToken(
  fetchImpl: typeof fetch = (input, init) => fetch(input, init),
): Promise<Result<LiveToken, TokenError>> {
  let res: Response;
  try {
    res = await fetchImpl('/api/voice/token', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  } catch {
    return fail('network', 'network');
  }
  if (res.status === 403) return fail('origin', 'origin');
  if (res.status === 429) return fail('rate_limited', 'rate_limited');
  if (!res.ok) return fail('unavailable', `http ${Math.floor(res.status / 100)}xx`);
  try {
    const token = parseToken(await res.json());
    return token ? ok(token) : fail('unavailable', 'malformed');
  } catch {
    return fail('unavailable', 'malformed');
  }
}

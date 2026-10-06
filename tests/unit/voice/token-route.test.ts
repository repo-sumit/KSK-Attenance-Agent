import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { POST } from '@/app/api/voice/token/route';
import { LIVE_API_VERSION, VOICE_MODEL, mintVoiceToken } from '@/server/voice/token';

// The route's contract is what Task 15's token client parses, so it is pinned here. Google is never called: the
// mint is replaced; the origin check, the rate limiter and the response shaping run for real.
vi.mock('@/server/voice/token', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/voice/token')>()),
  mintVoiceToken: vi.fn(),
}));

const mint = vi.mocked(mintVoiceToken);
const MINTED = { ok: true, token: 'auth_tokens/abc', expiresAt: '2026-10-02T05:15:00.000Z' } as const;

/** A same-origin POST from `ip`; pass `origin: null` to send no Origin header. The limiter is shared, so each test uses its own ip. */
function post({ ip, origin = 'http://localhost:3000', forwardedFor }: { ip?: string; origin?: string | null; forwardedFor?: string } = {}) {
  const headers: Record<string, string> = { host: 'localhost:3000' };
  if (origin !== null) headers.origin = origin;
  const chain = forwardedFor ?? ip;
  if (chain) headers['x-forwarded-for'] = chain;
  return POST(new Request('http://localhost:3000/api/voice/token', { method: 'POST', headers }));
}

// The missing-key line is logged once per process; most tests run without a key, so keep it out of the output.
let consoleError: MockInstance<Console['error']>;
beforeEach(() => {
  mint.mockReset();
  consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe('POST /api/voice/token', () => {
  it('answers 200 with the token, its expiry, the model and the API version the client must connect with', async () => {
    mint.mockResolvedValue(MINTED);
    const res = await post({ ip: '198.51.100.1' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ token: 'auth_tokens/abc', expiresAt: '2026-10-02T05:15:00.000Z', model: VOICE_MODEL, apiVersion: LIVE_API_VERSION });
    expect(mint).toHaveBeenCalledTimes(1);
  });

  it('answers 403 {error: origin} for another site or no Origin, and never mints', async () => {
    for (const origin of ['https://evil.example', null]) {
      const res = await post({ ip: '198.51.100.2', origin });
      expect(res.status).toBe(403);
      expect(res.headers.get('cache-control')).toBe('no-store');
      expect(await res.json()).toEqual({ error: 'origin' });
    }
    expect(mint).not.toHaveBeenCalled();
  });

  it('accepts the origins listed in VOICE_ALLOWED_ORIGINS (comma separated)', async () => {
    mint.mockResolvedValue(MINTED);
    vi.stubEnv('VOICE_ALLOWED_ORIGINS', ' https://swiftchat.example , https://other.example ');
    expect((await post({ ip: '198.51.100.3', origin: 'https://swiftchat.example' })).status).toBe(200);
    expect((await post({ ip: '198.51.100.3', origin: 'https://other.example' })).status).toBe(200);
    expect((await post({ ip: '198.51.100.3', origin: 'https://evil.example' })).status).toBe(403);
  });

  it('gives the mint only GEMINI_API_KEY and VOICE_DISABLED, read when the request arrives', async () => {
    mint.mockResolvedValue(MINTED);
    vi.stubEnv('GEMINI_API_KEY', 'key-set-after-load');
    vi.stubEnv('VOICE_DISABLED', '0');
    vi.stubEnv('VOICE_ALLOWED_ORIGINS', 'https://not-for-the-mint.example');
    await post({ ip: '198.51.100.5' });
    expect(mint).toHaveBeenLastCalledWith({ GEMINI_API_KEY: 'key-set-after-load', VOICE_DISABLED: '0' }, expect.any(Date));
  });

  it('answers 503 {error: unavailable} when the mint is unavailable (no key, kill switch, Google failure)', async () => {
    mint.mockResolvedValue({ ok: false, error: 'unavailable' });
    const res = await post({ ip: '198.51.100.4' });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.json()).toEqual({ error: 'unavailable' });
  });

  it('answers 429 with Retry-After after 20 requests in 10 minutes from one client, by the first x-forwarded-for hop', async () => {
    mint.mockResolvedValue(MINTED);
    for (let i = 0; i < 20; i += 1) {
      // later hops vary (proxies append them); the client is the first hop
      expect((await post({ forwardedFor: `203.0.113.9, 10.0.0.${i}` })).status).toBe(200);
    }
    const res = await post({ forwardedFor: '203.0.113.9, 10.0.0.99' });
    expect(res.status).toBe(429);
    expect(res.headers.get('cache-control')).toBe('no-store');
    const body = (await res.json()) as { error: string; retryAfterS: number };
    expect(body.error).toBe('rate_limited');
    expect(Number.isInteger(body.retryAfterS)).toBe(true);
    expect(body.retryAfterS).toBeGreaterThanOrEqual(1);
    expect(body.retryAfterS).toBeLessThanOrEqual(600);
    expect(res.headers.get('retry-after')).toBe(String(body.retryAfterS));
    expect((await post({ ip: '203.0.113.10' })).status).toBe(200); // another client is not affected
  });

  it('keys the limiter on the first 64 characters of the first hop: a long header cannot make a new client', async () => {
    mint.mockResolvedValue(MINTED);
    const prefix = 'x'.repeat(64);
    for (let i = 0; i < 20; i += 1) expect((await post({ forwardedFor: `${prefix}${i}` })).status).toBe(200);
    expect((await post({ forwardedFor: `${prefix}${'y'.repeat(900)}` })).status).toBe(429);
  });

  it('falls back to one shared "local" client when no x-forwarded-for header is sent', async () => {
    mint.mockResolvedValue(MINTED);
    for (let i = 0; i < 20; i += 1) expect((await post()).status).toBe(200);
    expect((await post()).status).toBe(429);
  });
});

describe('POST /api/voice/token without a key', () => {
  it('logs one fixed line, once per process, and still answers 503; the kill switch stays silent', async () => {
    vi.resetModules(); // a fresh module has a fresh once-flag
    const route = await import('@/app/api/voice/token/route');
    const freshMint = vi.mocked((await import('@/server/voice/token')).mintVoiceToken);
    freshMint.mockResolvedValue({ ok: false, error: 'unavailable' });
    const request = (ip: string) =>
      route.POST(new Request('http://localhost:3000/api/voice/token', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'x-forwarded-for': ip } }));

    vi.stubEnv('GEMINI_API_KEY', 'sk-secret-from-another-test');
    vi.stubEnv('VOICE_DISABLED', '1');
    expect((await request('198.51.100.20')).status).toBe(503);
    vi.stubEnv('GEMINI_API_KEY', '');
    expect((await request('198.51.100.20')).status).toBe(503); // kill switch, no key: silent
    expect(consoleError).not.toHaveBeenCalled();

    vi.stubEnv('VOICE_DISABLED', '');
    expect((await request('198.51.100.21')).status).toBe(503);
    expect((await request('198.51.100.21')).status).toBe(503);
    expect(consoleError.mock.calls).toEqual([['[voice-token] GEMINI_API_KEY is not set']]);
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sk-secret');
  });
});

describe('POST /api/voice/token rate limit per environment (D-158; production keeps D-107)', () => {
  async function routeFor(env: string) {
    vi.resetModules(); // the limiter is built when the module loads
    vi.stubEnv('NODE_ENV', env);
    const route = await import('@/app/api/voice/token/route');
    vi.mocked((await import('@/server/voice/token')).mintVoiceToken).mockResolvedValue(MINTED);
    return (ip: string) =>
      route.POST(new Request('http://localhost:3000/api/voice/token', { method: 'POST', headers: { host: 'localhost:3000', origin: 'http://localhost:3000', 'x-forwarded-for': ip } }));
  }

  it('allows 200 tokens in 10 minutes from one client in development (every local tab and script shares one key)', async () => {
    const request = await routeFor('development');
    for (let i = 0; i < 200; i += 1) expect((await request('::1')).status).toBe(200);
    expect((await request('::1')).status).toBe(429);
  });

  it('keeps 20 in production', async () => {
    const request = await routeFor('production');
    for (let i = 0; i < 20; i += 1) expect((await request('198.51.100.30')).status).toBe(200);
    expect((await request('198.51.100.30')).status).toBe(429);
  });
});

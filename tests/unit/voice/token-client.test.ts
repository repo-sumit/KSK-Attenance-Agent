import { describe, expect, it, vi } from 'vitest';
import { fetchLiveToken } from '@/services/voice/live/token-client';

const BODY = { token: 'auth_tokens/abc', expiresAt: '2026-10-02T05:15:00.000Z', model: 'gemini-3.8-live', apiVersion: 'v1alpha' };
const reply = (status: number, body: unknown = {}) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

describe('fetchLiveToken', () => {
  it('returns the token with the model and api version the server chose', async () => {
    expect(await fetchLiveToken(reply(200, BODY))).toEqual({ ok: true, value: BODY });
  });
  it('posts to the same-origin route without caching', async () => {
    const fake = reply(200, BODY);
    await fetchLiveToken(fake);
    expect(fake).toHaveBeenCalledWith('/api/voice/token', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
  });
  // `detail.why` names the failed step for the debug log (ids and codes only, never the body).
  it.each([
    [403, 'origin', 'origin'],
    [429, 'rate_limited', 'rate_limited'],
    [503, 'unavailable', 'http 5xx'],
    [500, 'unavailable', 'http 5xx'],
    [404, 'unavailable', 'http 4xx'],
  ])('maps %s to %s', async (status, error, why) => {
    expect(await fetchLiveToken(reply(status, { error: 'x' }))).toEqual({ ok: false, error, detail: { why } });
  });
  it('maps a thrown fetch to network', async () => {
    expect(await fetchLiveToken(vi.fn(async () => { throw new TypeError('Failed to fetch'); }))).toEqual({ ok: false, error: 'network', detail: { why: 'network' } });
  });
  it('treats a 200 with a malformed body as unavailable', async () => {
    expect(await fetchLiveToken(reply(200, { token: 'x' }))).toEqual({ ok: false, error: 'unavailable', detail: { why: 'malformed' } });
    expect(await fetchLiveToken(vi.fn(async () => new Response('<html>', { status: 200 })))).toEqual({ ok: false, error: 'unavailable', detail: { why: 'malformed' } });
  });
});

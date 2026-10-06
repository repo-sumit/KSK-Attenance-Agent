import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchLiveToken } from '@/services/voice/live/token-client';
import { VoiceSession } from '@/services/voice/session';
import { makeSessionDeps, type HarnessOptions } from './session-harness';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

/**
 * "Voice isn't available right now" has several causes; the `?voiceDebug=1` log (ids and codes only) names the
 * step that failed, so an owner can tell a missing key (HTTP 5xx) from a blocked origin or a slow network.
 */
async function failedStart(o: HarnessOptions, patch: Partial<ReturnType<typeof makeSessionDeps>['deps']> = {}, wait?: () => Promise<unknown>) {
  const h = makeSessionDeps(o);
  const lines: string[] = [];
  const s = new VoiceSession({ ...h.deps, ...patch, log: (line) => lines.push(line) });
  s.start();
  await wait?.();
  await vi.waitFor(() => expect(s.getState().status).toBe('error'));
  return { error: s.getState().error, lines };
}

const answer = (res: () => Response) => () => fetchLiveToken(async () => res());

describe('a start that ends as unavailable says which step failed in the debug log', () => {
  it('the transport could not be loaded', async () => {
    const { error, lines } = await failedStart({}, { transport: async () => { throw new Error('ChunkLoadError'); } });
    expect(error).toBe('unavailable');
    expect(lines).toContain('transport import failed');
    expect(lines.at(-1)).toBe('stop (unavailable)');
  });

  it.each([
    ['no network', () => fetchLiveToken(async () => { throw new TypeError('Failed to fetch'); }), 'token failed (network)'],
    ['the origin check', answer(() => new Response('{}', { status: 403 })), 'token failed (origin)'],
    ['a server error (no key, kill switch)', answer(() => new Response('{}', { status: 503 })), 'token failed (http 5xx)'],
    ['another refusal', answer(() => new Response('{}', { status: 404 })), 'token failed (http 4xx)'],
    ['a malformed body', answer(() => new Response('{"token":"x"}', { status: 200 })), 'token failed (malformed)'],
    ['a body that is not JSON', answer(() => new Response('<html>', { status: 200 })), 'token failed (malformed)'],
  ])('the token: %s', async (_, token, line) => {
    const { error, lines } = await failedStart({ token });
    expect(error).toBe('unavailable');
    expect(lines).toContain(line);
    expect(lines.at(-1)).toBe('stop (unavailable)');
  });

  it('the token did not come within 8 s', async () => {
    const { error, lines } = await failedStart({ token: () => new Promise(() => undefined) }, {}, () => vi.advanceTimersByTimeAsync(8_000));
    expect(error).toBe('unavailable');
    expect(lines).toContain('token failed (timeout)');
  });

  it('a development build waits 20 s for the token (D-158): the route may still be compiling', async () => {
    vi.stubEnv('NODE_ENV', 'development');
    const h = makeSessionDeps({ token: () => new Promise(() => undefined) });
    const lines: string[] = [];
    const s = new VoiceSession({ ...h.deps, log: (line) => lines.push(line) });
    s.start();
    await vi.advanceTimersByTimeAsync(8_000);
    expect(s.getState().status).toBe('connecting');
    expect(lines).not.toContain('token failed (timeout)');
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.waitFor(() => expect(s.getState().status).toBe('error'));
    expect(lines).toContain('token failed (timeout)');
  });

  it('a production build still gives up on the token after 8 s', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { lines } = await failedStart({ token: () => new Promise(() => undefined) }, {}, () => vi.advanceTimersByTimeAsync(8_000));
    expect(lines).toContain('token failed (timeout)');
  });

  it('logs codes only: never the token or its body', async () => {
    const secret = 'auth_tokens/secret-value';
    const { lines } = await failedStart({ token: answer(() => new Response(JSON.stringify({ token: secret }), { status: 200 })) });
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('a rate limit stays its own error, and is named in the log too', async () => {
    const { error, lines } = await failedStart({ tokenStatus: 429 });
    expect(error).toBe('rate_limited');
    expect(lines).toContain('token failed (rate_limited)');
  });
});

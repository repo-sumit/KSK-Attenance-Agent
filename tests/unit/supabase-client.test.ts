/**
 * Task 10: the thin adapter over @supabase/supabase-js, driven through a fake fetch (no network). It must page
 * through PostgREST's 1000-row limit, apply the filters, and tell a network failure from a server refusal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSupabaseDataClient } from '@/repositories/supabase/client';

const URL_BASE = 'https://example-project.supabase.co';
const KEY = 'sb_publishable_test-only-not-a-real-key';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const requests: Array<{ url: URL; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    requests.push({ url, init });
    return handler(url, init);
  });
  return { fn: fn as unknown as typeof fetch, requests };
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let errors: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errors = vi.spyOn(console, 'error');
});
afterEach(() => {
  expect(errors).not.toHaveBeenCalled();
});

describe('createSupabaseDataClient', () => {
  it('selects with filters, a stable order and pages of 1000 rows', async () => {
    const all = Array.from({ length: 1500 }, (_, i) => ({ id: `s${String(i).padStart(4, '0')}` }));
    const { fn, requests } = fakeFetch((url, init) => {
      const range = new Headers(init.headers).get('Range') ?? '';
      const offset = Number(url.searchParams.get('offset') ?? (/^(\d+)-/.exec(range)?.[1] ?? 0));
      const limit = Number(url.searchParams.get('limit') ?? 1000);
      return json(all.slice(offset, offset + limit), 200);
    });
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    const result = await client.select({
      table: 'submissions',
      order: 'id',
      filters: [
        { column: 'institute_id', op: 'eq', value: 'inst-27410' },
        { column: 'date', op: 'gte', value: '2026-09-01' },
        { column: 'date', op: 'lte', value: '2026-09-25' },
        { column: 'batch_id', op: 'in', value: ['ele-s1u1', 'ele-s1u2'] },
      ],
    });
    expect(result.ok && result.data.length).toBe(1500);
    expect(requests).toHaveLength(2);
    const first = requests[0].url;
    expect(first.pathname).toBe('/rest/v1/submissions');
    expect(first.searchParams.get('institute_id')).toBe('eq.inst-27410');
    expect(first.searchParams.getAll('date')).toEqual(['gte.2026-09-01', 'lte.2026-09-25']);
    expect(first.searchParams.get('batch_id')).toBe('in.(ele-s1u1,ele-s1u2)');
    expect(first.searchParams.get('order')).toBe('id.asc');
    expect(new Headers(requests[0].init.headers).get('apikey')).toBe(KEY);
  });

  it('reports a failed fetch as a network error, without retrying for seconds', async () => {
    const { fn, requests } = fakeFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    const result = await client.select({ table: 'institutes', order: 'id', filters: [{ column: 'code', op: 'eq', value: '27410' }] });
    expect(result).toMatchObject({ ok: false, error: { kind: 'network' } });
    expect(requests).toHaveLength(1);
    expect(await client.insert('submissions', { id: 'a' })).toMatchObject({ ok: false, error: { kind: 'network' } });
  });

  it('treats a 5xx answer as a network problem (try again later)', async () => {
    const { fn } = fakeFetch(() => json({ code: 'PGRST002', message: 'Could not query the schema cache' }, 503));
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    expect(await client.select({ table: 'institutes', order: 'id' })).toMatchObject({ ok: false, error: { kind: 'network' } });
  });

  it('passes a server refusal through with its Postgres code (23505 write-once conflict)', async () => {
    const { fn, requests } = fakeFetch(() => json({ code: '23505', message: 'duplicate key value violates unique constraint', details: null, hint: null }, 409));
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    const result = await client.insert('submissions', { id: 'a', session_key: 'k' });
    expect(result).toEqual({ ok: false, error: { kind: 'server', code: '23505', message: 'duplicate key value violates unique constraint', status: 409 } });
    expect(requests[0].init.method).toBe('POST');
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ id: 'a', session_key: 'k' });
  });

  it('returns the inserted row (for the server time) and upserts on the given conflict columns', async () => {
    const { fn, requests } = fakeFetch((url, init) => (init.method === 'POST' && url.pathname.endsWith('/submissions') ? json([{ id: 'a', server_timestamp: '2026-09-25T04:46:00+00:00' }], 201) : new Response(null, { status: 201 })));
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    expect(await client.insert('submissions', { id: 'a' })).toEqual({ ok: true, data: [{ id: 'a', server_timestamp: '2026-09-25T04:46:00+00:00' }] });
    expect(await client.upsert('voice_usage', { staff_id: 'st-rajesh', date: '2026-09-25', seconds: 10 }, 'staff_id,date')).toEqual({ ok: true, data: null });
    const upsert = requests[1];
    expect(upsert.url.searchParams.get('on_conflict')).toBe('staff_id,date');
    expect(new Headers(upsert.init.headers).get('Prefer')).toContain('resolution=merge-duplicates');
    await client.upsert('face_enrolment', { staff_id: 'st-rajesh' }, 'staff_id', { ignoreDuplicates: true });
    expect(new Headers(requests[2].init.headers).get('Prefer')).toContain('resolution=ignore-duplicates');
  });
  it('calls a database function (rpc) with its arguments and returns its JSON answer', async () => {
    const { fn, requests } = fakeFetch(() => json({ day: '2026-09-25', submissions: 3 }));
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    expect(await client.rpc('ksk_seed_day', { payload: { day: '2026-09-25' } })).toEqual({ ok: true, data: { day: '2026-09-25', submissions: 3 } });
    expect(requests[0].url.pathname).toBe('/rest/v1/rpc/ksk_seed_day');
    expect(requests[0].init.method).toBe('POST');
    expect(JSON.parse(String(requests[0].init.body))).toEqual({ payload: { day: '2026-09-25' } });
  });

  it('reports a function the server does not have (PGRST202, 404) as a server refusal with its code', async () => {
    const { fn } = fakeFetch(() => json({ code: 'PGRST202', message: 'Could not find the function public.ksk_reset_demo without parameters in the schema cache', details: null, hint: null }, 404));
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    expect(await client.rpc('ksk_reset_demo')).toMatchObject({ ok: false, error: { kind: 'server', code: 'PGRST202', status: 404 } });
  });

  it('deletes the rows matching the filters', async () => {
    const { fn, requests } = fakeFetch(() => new Response(null, { status: 204 }));
    const client = createSupabaseDataClient(URL_BASE, KEY, { fetch: fn });
    expect(await client.remove('face_enrolment', [{ column: 'staff_id', op: 'eq', value: 'st-rajesh' }])).toEqual({ ok: true, data: null });
    expect(requests[0].init.method).toBe('DELETE');
    expect(requests[0].url.pathname).toBe('/rest/v1/face_enrolment');
    expect(requests[0].url.searchParams.get('staff_id')).toBe('eq.st-rajesh');
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 2026-09-25: consulta com token vencido ("JWT expired") renova a sessão uma vez e repete.

vi.mock('@/lib/errorReporter', () => ({ reportEdgeFailure: vi.fn() }));

type Mod = typeof import('@/lib/supabase');
let mod: Mod;
const URL_REST = 'https://example.supabase.co/rest/v1/fin_ifood_entries?select=*';
const vencido = () => new Response(JSON.stringify({ code: 'PGRST301', message: 'JWT expired' }), { status: 401 });

beforeEach(async () => {
  vi.stubEnv('VITE_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-teste');
  mod = await vi.importActual<Mod>('@/lib/supabase');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('retentarSeJwtVencido', () => {
  it('renova e repete com o token novo', async () => {
    const fetchMock = vi.fn(async () => new Response('[]', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const renovar = vi.fn(async () => 'token-novo');
    const r = await mod.retentarSeJwtVencido(vencido(), URL_REST, URL_REST, { headers: { Authorization: 'Bearer token-velho' } }, renovar);
    expect(r.status).toBe(200);
    expect(renovar).toHaveBeenCalledTimes(1);
    const headers = new Headers((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].headers);
    expect(headers.get('Authorization')).toBe('Bearer token-novo');
  });

  it('não mexe em outros 401 nem em respostas boas', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const renovar = vi.fn(async () => 'x');
    const outro401 = new Response(JSON.stringify({ message: 'permission denied' }), { status: 401 });
    expect((await mod.retentarSeJwtVencido(outro401, URL_REST, URL_REST, { headers: { Authorization: 'Bearer t' } }, renovar)).status).toBe(401);
    expect((await mod.retentarSeJwtVencido(new Response('[]'), URL_REST, URL_REST, {}, renovar)).status).toBe(200);
    expect(renovar).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refresh recusado devolve o erro original', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const r = await mod.retentarSeJwtVencido(vencido(), URL_REST, URL_REST, { headers: { Authorization: 'Bearer t' } }, async () => null);
    expect(r.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

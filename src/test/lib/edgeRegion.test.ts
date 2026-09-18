import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Go-live 2026-09-17: Edge Functions que só falam com o banco rodam na região dele
// (us-west-1) via ?forceFunctionRegion; as que falam com serviços brasileiros não.

vi.mock('@/lib/errorReporter', () => ({ reportEdgeFailure: vi.fn() }));

type Mod = typeof import('@/lib/supabase');
let mod: Mod;
const BASE = 'https://example.supabase.co';

beforeEach(async () => {
  vi.stubEnv('VITE_PUBLIC_SUPABASE_URL', BASE);
  vi.stubEnv('VITE_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-teste');
  mod = await vi.importActual<Mod>('@/lib/supabase');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('withEdgeRegion', () => {
  it('força a região nas edges de banco', () => {
    expect(mod.withEdgeRegion(`${BASE}/functions/v1/order-write`))
      .toBe(`${BASE}/functions/v1/order-write?forceFunctionRegion=us-west-1`);
    expect(mod.withEdgeRegion(`${BASE}/functions/v1/mesa-write?x=1`))
      .toBe(`${BASE}/functions/v1/mesa-write?x=1&forceFunctionRegion=us-west-1`);
  });

  it('não mexe em edges de serviços brasileiros nem em REST', () => {
    for (const url of [
      `${BASE}/functions/v1/fiscal-write`,
      `${BASE}/functions/v1/pix-payment`,
      `${BASE}/functions/v1/inter-bank`,
      `${BASE}/rest/v1/orders?select=id`,
      'https://outro.site/functions/v1/order-write',
    ]) {
      expect(mod.withEdgeRegion(url)).toBe(url);
    }
  });

  it('não duplica o parâmetro', () => {
    const url = `${BASE}/functions/v1/order-write?forceFunctionRegion=us-west-1`;
    expect(mod.withEdgeRegion(url)).toBe(url);
  });
});

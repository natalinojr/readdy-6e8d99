import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Go-live 2026-09-17: ações de dinheiro/caixa não podem ser reenviadas sozinhas após
// erro de rede (o servidor pode ter gravado); create_order continua com retry
// (idempotente por client_request_id). Erro HTTP carrega status/code.

vi.mock('@/lib/errorReporter', () => ({ reportEdgeFailure: vi.fn() }));

type Mod = typeof import('@/lib/supabase');
let mod: Mod;

beforeEach(async () => {
  vi.stubEnv('VITE_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-teste');
  mod = await vi.importActual<Mod>('@/lib/supabase');
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function run(action: string, fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('fetch', fetchMock);
  const p = mod.invokeWithAuth('order-write', { body: { action }, externalToken: 'tok' });
  await vi.runAllTimersAsync();
  return p;
}

describe('invokeWithAuth — retry em erro de rede', () => {
  it.each(['record_payment', 'close_cash_register', 'add_cash_movement', 'register_partial_refund'])(
    '%s não é reenviado',
    async (action) => {
      const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
      const { error } = await run(action, fetchMock);
      expect(error).toBeTruthy();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it('create_order é reenviado uma vez', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    await run('create_order', fetchMock);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('erro HTTP expõe status e code', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: 'cancelado', code: 'order_cancelled' }), {
        status: 409,
        headers: { 'content-type': 'application/json' },
      }),
    );
    const { error } = await run('create_order', fetchMock);
    const e = error as Error & { status?: number; code?: string };
    expect(e.status).toBe(409);
    expect(e.code).toBe('order_cancelled');
    expect(e.message).toBe('cancelado');
  });
});

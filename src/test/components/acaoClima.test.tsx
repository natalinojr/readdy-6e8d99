// Ação rápida "Previsão do tempo": a lista de lojas vem do banco, não do availableTenants do
// AuthContext (que fica vazio depois de entrar — "Nenhuma loja disponível", dono 2026-09-19).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  auth: { user: { tenantId: 't-vila', loja: 'Vila Leste' }, availableTenants: [] as unknown[] },
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u-dono' } } } }) },
    rpc: h.rpc,
  },
  invokeWithAuth: vi.fn(async () => ({ data: { city: null, delivery_config: null }, error: null })),
  ensureFreshSession: vi.fn(),
  SUPABASE_URL: 'http://x',
  SUPABASE_ANON_KEY: 'k',
}));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => h.auth }));

import Clima from '@/components/feature/assistente/acoes/pessoal/Clima';

describe('Ação rápida — Previsão do tempo', () => {
  beforeEach(() => {
    h.rpc.mockReset();
    Element.prototype.scrollIntoView = vi.fn(); // jsdom não tem
  });

  it('lista as lojas do dono mesmo com availableTenants vazio, loja ativa primeiro', async () => {
    h.rpc.mockResolvedValue({
      data: [
        { tenant_id: 't-pgua', tenant_name: 'El Patrón Paranaguá' },
        { tenant_id: 't-vila', tenant_name: 'Vila Leste' },
      ],
      error: null,
    });
    render(<Clima onFechar={() => {}} />);
    expect(await screen.findByText('Previsão de qual loja?')).toBeInTheDocument();
    const botoes = screen.getAllByRole('button').map((b) => b.textContent ?? '');
    expect(botoes.findIndex((t) => t.includes('Vila Leste'))).toBeLessThan(botoes.findIndex((t) => t.includes('Paranaguá')));
    expect(h.rpc).toHaveBeenCalledWith('get_user_tenants', { p_user_id: 'u-dono' });
    expect(screen.queryByText('Nenhuma loja disponível.')).toBeNull();
  });

  it('sem a lista do banco, usa a loja ativa', async () => {
    h.rpc.mockResolvedValue({ data: null, error: { message: 'falhou' } });
    render(<Clima onFechar={() => {}} />);
    expect(await screen.findByText(/Vila Leste não tem localização/)).toBeInTheDocument();
  });
});

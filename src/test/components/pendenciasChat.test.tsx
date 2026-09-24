// Caixa de pendências do chat (PendenciasChat) — ordem de chegada, data/hora de cada uma e o
// botão "Mais antiga" (dono, 2026-09-24). Banco falso em memória; nada vai para produção.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({ rows: [] as Record<string, unknown>[] }));

vi.mock('@/lib/supabase', () => {
  const q = {
    select: () => q, in: () => q, eq: () => q, not: () => q, lt: () => q, or: () => q,
    order: (_c: string, o?: { ascending?: boolean }) => { q._asc = o?.ascending ?? true; return q; },
    limit: () => Promise.resolve({ data: [...h.rows].sort((a, b) => String(a.criada_em).localeCompare(String(b.criada_em)) * (q._asc ? 1 : -1)), error: null }),
    _asc: true,
  };
  return { supabase: { from: () => q, rpc: vi.fn().mockResolvedValue({ error: null }) } };
});
vi.mock('@/components/feature/assistente/TarefasPendencia', () => ({
  default: () => null,
  minhasTarefasPendentes: () => Promise.resolve([]),
}));

import PendenciasChat from '@/components/feature/assistente/PendenciasChat';

const agora = Date.now();
const iso = (horasAtras: number) => new Date(agora - horasAtras * 3600000).toISOString();
const linha = (id: string, titulo: string, horasAtras: number, urgencia = 'normal') => ({
  id, tenant_id: 't1', kind: 'conta_atrasada', titulo, detalhe: null, rota: null, urgencia,
  acao_requerida: true, status: 'aberta', criada_em: iso(horasAtras), tenants: { name: 'Loja A' },
});

const props = {
  call: vi.fn().mockResolvedValue({}) as never, meuId: null, onFechar: () => {}, versao: 0,
  onPagar: vi.fn(), onAbrir: vi.fn(), onPedir: vi.fn(), onVerMensagem: vi.fn(), onAbrirTarefa: vi.fn(),
};

const titulos = () => [...document.querySelectorAll('[data-pend] p.font-bold.text-zinc-900')].map((e) => e.textContent);

describe('PendenciasChat — ordem de chegada', () => {
  beforeEach(() => {
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    h.rows = [
      linha('b', 'Conta nova urgente', 1, 'alta'),
      linha('a', 'Conta antiga', 100),
      linha('c', 'Conta de ontem', 30),
    ];
  });

  it('lista pela ordem de chegada (mais antiga primeiro), sem furar fila pela urgência', async () => {
    render(<PendenciasChat {...props} />);
    await waitFor(() => expect(titulos()).toEqual(['Conta antiga', 'Conta de ontem', 'Conta nova urgente']));
    expect(screen.getByText('Urgente')).toBeTruthy();
    expect(screen.getByText('Hoje')).toBeTruthy();
    expect(screen.getByText('Ontem')).toBeTruthy();
  });

  it('mostra data e hora de chegada e há quanto tempo', async () => {
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    const d = new Date(iso(100));
    const esperado = `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    expect(screen.getByText(esperado)).toBeTruthy();
    expect(screen.getAllByText('há 4 dias').length).toBeGreaterThan(0);
  });

  it('inverte a ordem e o botão "Mais antiga" rola até ela', async () => {
    render(<PendenciasChat {...props} />);
    await screen.findByText('Conta antiga');
    fireEvent.click(screen.getByText('Mais antigas primeiro'));
    expect(titulos()).toEqual(['Conta nova urgente', 'Conta de ontem', 'Conta antiga']);
    fireEvent.click(screen.getByText(/Mais antiga ·/));
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect(document.querySelector('[data-pend="a"]')?.className).toContain('ring-4');
  });
});

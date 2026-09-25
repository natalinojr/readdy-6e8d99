// Conversa "Avisos" para todas as pessoas (2026-09-25): painel por aviso, destaque do que é novo,
// marcar como lido ao abrir e os botões do painel levando à tela.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, renderHook, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  linhas: [] as unknown[],
  updates: [] as Array<{ valores: unknown; filtro: string }>,
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({ order: () => ({ limit: async () => ({ data: [...h.linhas], error: null }) }) }),
      update: (valores: unknown) => ({ is: async (col: string) => { h.updates.push({ valores, filtro: col }); return { error: null }; } }),
    }),
  },
}));
vi.mock('@/lib/voltarAndroid', () => ({ useVoltarFecha: () => undefined }));

import AvisosConversa, { LinhaAvisos, useAvisos, type Aviso } from '@/components/feature/avisos/AvisosConversa';

const pago: Aviso = {
  id: 'a1', kind: 'pedido_pago', resumo: 'Reembolso de R$ 45,00 pago — Ana', created_at: '2026-09-25T18:00:00Z', lido_em: null,
  painel: { t: 'Pagamento feito', s: 'Vila Leste', kpi: { p: { l: 'Reembolso', v: 'R$ 45,00' } },
    lin: [{ t: 'Seu pedido', i: [{ l: 'Para', v: 'Ana' }] }], bt: [{ l: 'Meus pedidos', r: '/receber?meus=1' }] },
};
const semPainel: Aviso = { id: 'a0', kind: 'x', resumo: 'Aviso antigo sem painel', created_at: '2026-09-24T12:00:00Z', lido_em: '2026-09-24T13:00:00Z', painel: null };

beforeEach(() => { h.linhas = []; h.updates = []; Element.prototype.scrollIntoView = vi.fn(); });

describe('Avisos', () => {
  it('mostra cada aviso como painel (inclusive o sem dados) e o botão leva à tela', () => {
    const onBotao = vi.fn();
    const marcarLidos = vi.fn();
    render(<AvisosConversa avisos={[semPainel, pago]} carregado marcarLidos={marcarLidos} onVoltar={() => undefined} onBotao={onBotao} />);
    expect(screen.getByText('Pagamento feito')).toBeTruthy();
    expect(screen.getByText('R$ 45,00')).toBeTruthy();
    expect(screen.getByText('Aviso antigo sem painel')).toBeTruthy();
    expect(marcarLidos).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Meus pedidos'));
    expect(onBotao).toHaveBeenCalledWith('/receber?meus=1');
  });

  it('sem avisos explica o que chega ali', () => {
    render(<AvisosConversa avisos={[]} carregado marcarLidos={() => undefined} onVoltar={() => undefined} onBotao={() => undefined} />);
    expect(screen.getByText(/Nenhum aviso ainda/)).toBeTruthy();
  });

  it('linha da lista mostra o último aviso e quantos são novos', () => {
    render(<LinhaAvisos ultimo={pago} naoLidos={3} onAbrir={() => undefined} />);
    expect(screen.getByText('Reembolso de R$ 45,00 pago — Ana')).toBeTruthy();
    expect(screen.getByLabelText('3 aviso(s) novo(s)')).toBeTruthy();
  });

  it('useAvisos conta os não lidos e marca como lidos só os que faltam', async () => {
    h.linhas = [pago, semPainel]; // o servidor devolve do mais novo para o mais antigo
    const { result } = renderHook(() => useAvisos(true));
    await waitFor(() => expect(result.current.carregado).toBe(true));
    expect(result.current.avisos.map((a) => a.id)).toEqual(['a0', 'a1']);
    expect(result.current.naoLidos).toBe(1);
    await act(async () => { await result.current.marcarLidos(); });
    expect(result.current.naoLidos).toBe(0);
    expect(h.updates).toHaveLength(1);
    expect(h.updates[0].filtro).toBe('lido_em');
  });
});

describe('Avisos — corrida da recarga', () => {
  it('recarga que chega depois de marcar não traz o número de volta', async () => {
    h.linhas = [pago];
    const { result } = renderHook(() => useAvisos(true));
    await waitFor(() => expect(result.current.naoLidos).toBe(1));
    await act(async () => { await result.current.marcarLidos(); });
    // o servidor ainda responde com lido_em nulo (a leitura saiu antes da marcação)
    await act(async () => { await result.current.recarregar(); });
    expect(result.current.naoLidos).toBe(0);
  });
});

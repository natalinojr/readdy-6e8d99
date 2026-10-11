// Estoque › Custo › Consumo (2026-10-04): o hook lê TODAS as páginas das funções do banco (o PostgREST
// corta em ~1000 linhas sem avisar), compara a 2ª metade do período com a 1ª, e nunca mostra vendas R$ 0 falso.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';

const h = vi.hoisted(() => ({
  movs: [] as Array<Record<string, unknown>>,
  pedidos: [] as Array<Record<string, unknown>> | null,
  chamadas: [] as string[],
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1' } }) }));

function paginado(linhas: Array<Record<string, unknown>> | null) {
  const b = {
    order: () => b,
    range: async (a: number, z: number) =>
      linhas ? { data: linhas.slice(a, z + 1), error: null } : { data: null, error: { message: 'falhou' } },
  };
  return b;
}

vi.mock('@/lib/supabase', () => ({
  supabase: {
    rpc: (nome: string) => {
      h.chamadas.push(nome);
      if (nome === 'fn_get_ingredients') {
        return Promise.resolve({
          data: [{ id: 'i1', name: 'Mussarela', unit: 'g', unit_price: 0.04, min_stock: 1000, current_stock: 8800, category: 'Laticínios', supplier: 'Laticínios Sul' }],
          error: null,
        });
      }
      if (nome === 'fn_get_stock_movements_filtered') return paginado(h.movs);
      return paginado(h.pedidos);
    },
  },
}));

import { useConsumoIngredientes } from '@/hooks/useConsumoIngredientes';

// Período passado, fechado: 01 a 10/set/2026 → 1ª metade = 01..05, 2ª metade = 06..10
const DE = '2026-09-01';
const ATE = '2026-09-10';
const mov = (i: number, dia: string, qtd: number, extra: Record<string, unknown> = {}) => ({
  id: `m${i}`, ingredient_id: 'i1', ingredient_name: 'Mussarela', type: 'theoretical_out', quantity: qtd,
  ingredient_unit: 'g', reason: null, created_at: `${dia}T15:00:00Z`, signed_quantity: -qtd, ...extra,
});

beforeEach(() => {
  h.movs = [];
  h.pedidos = [{ id: 'p1', total: 100, status: 'paid' }, { id: 'p2', total: 50, status: 'cancelled' }];
  h.chamadas = [];
});

describe('useConsumoIngredientes', () => {
  it('lê todas as páginas (mais de 1000 movimentos) e soma tudo', async () => {
    // 2.500 linhas de 10 g cada: sem paginar só 1.000 seriam somadas
    h.movs = Array.from({ length: 2500 }, (_, i) => mov(i, i % 2 ? '2026-09-02' : '2026-09-08', 10));
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe(null);
    const m = result.current.dados.find((d) => d.id === 'i1')!;
    expect(m.totalConsumido).toBe(25000);
    expect(m.custoTotal).toBeCloseTo(1000, 5);
    expect(result.current.resumo?.insumosUsados).toBe(1);
    // pedido cancelado não conta
    expect(result.current.resumo?.totalVendasValor).toBe(100);
  });

  it('tendência compara a 2ª metade do período com a 1ª', async () => {
    h.movs = [mov(1, '2026-09-02', 100), mov(2, '2026-09-04', 100), mov(3, '2026-09-07', 200), mov(4, '2026-09-09', 100)];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dados[0].tendencia).toBe('subindo'); // 200 → 300
  });

  it('sem saída na 1ª metade, ou período curto: não afirma tendência', async () => {
    h.movs = [mov(1, '2026-09-08', 100)];
    const a = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(a.result.current.loading).toBe(false));
    expect(a.result.current.dados[0].tendencia).toBe(null);

    h.movs = [mov(1, '2026-09-02', 100), mov(2, '2026-09-03', 100)];
    const b = renderHook(() => useConsumoIngredientes('2026-09-01', '2026-09-03'));
    await waitFor(() => expect(b.result.current.loading).toBe(false));
    expect(b.result.current.dados[0].tendencia).toBe(null);
  });

  it('compra e ajuste para mais não são consumo', async () => {
    h.movs = [mov(1, '2026-09-02', 500, { type: 'in', signed_quantity: 500 }), mov(2, '2026-09-03', 30)];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dados[0].totalConsumido).toBe(30);
  });

  it('acerto da contagem por mudança de data do recebimento não é consumo; contagem a menos de verdade é', async () => {
    h.movs = [
      mov(1, '2026-09-02', 30),
      // purchase-confirm-delivery: a data do recebimento mudou e a contagem foi corrigida (−768 un no caso real)
      mov(2, '2026-09-03', 768, { type: 'inventory_adjustment', reason: 'Correção da contagem: data do recebimento mudou', signed_quantity: -768 }),
      // contagem comum que achou a menos: continua sendo saída
      mov(3, '2026-09-04', 5, { type: 'inventory_adjustment', reason: 'Ajuste de Inventario', signed_quantity: -5 }),
    ];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dados[0].totalConsumido).toBe(35);
    expect(result.current.dados[0].porTipo.ajuste).toBe(5);
  });

  it('correções de compra/conversão (saída manual) não são consumo', async () => {
    h.movs = [
      mov(1, '2026-09-02', 30),
      mov(2, '2026-09-03', 100, { type: 'manual_out', reason: 'Correção de conversão: Fornecedor X - NF 123', signed_quantity: -100 }),
      mov(3, '2026-09-03', 40, { type: 'manual_out', reason: 'Ajuste no recebimento: Fornecedor X NF 123', signed_quantity: -40 }),
      mov(4, '2026-09-04', 60, { type: 'manual_out', reason: 'Ajuste por edição da compra: Fornecedor X NF 123', signed_quantity: -60 }),
      mov(5, '2026-09-04', 25, { type: 'manual_out', reason: 'Detalhamento dos itens da compra: Fornecedor X NF 123', signed_quantity: -25 }),
      // saída manual de verdade continua sendo consumo
      mov(6, '2026-09-05', 10, { type: 'manual_out', reason: 'Uso interno', signed_quantity: -10 }),
    ];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.dados[0].totalConsumido).toBe(40);
  });

  it('empréstimo de insumo para outra loja (transfer_out) não é consumo nem custo', async () => {
    h.movs = [mov(1, '2026-09-02', 30), mov(2, '2026-09-03', 500, { type: 'transfer_out', reason: 'Empréstimo para Loja B', signed_quantity: -500 })];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const m = result.current.dados[0];
    expect(m.totalConsumido).toBe(30);
    expect(m.custoTotal).toBeCloseTo(1.2, 5);
    expect(m.porTipo.transferencia).toBe(0);
  });

  it('pedidos que não vieram: vendas ficam em branco (null) e a tela é avisada', async () => {
    h.pedidos = null;
    h.movs = [mov(1, '2026-09-02', 100)];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.resumo?.totalVendasValor).toBe(null);
    expect(result.current.aviso).toMatch(/vendas/i);
    expect(result.current.error).toBe(null);
  });

  it('erro nos movimentos: mensagem sem ids e sem dados velhos', async () => {
    const lixo = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    h.movs = null as unknown as Array<Record<string, unknown>>;
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe('Não deu para carregar o consumo agora.');
    expect(result.current.dados).toEqual([]);
    lixo.mockRestore();
  });

  it('reload lê de novo sem trocar o período', async () => {
    h.movs = [mov(1, '2026-09-02', 100)];
    const { result } = renderHook(() => useConsumoIngredientes(DE, ATE));
    await waitFor(() => expect(result.current.loading).toBe(false));
    const antes = h.chamadas.filter((c) => c === 'fn_get_ingredients').length;
    act(() => result.current.reload());
    await waitFor(() => expect(h.chamadas.filter((c) => c === 'fn_get_ingredients').length).toBe(antes + 1));
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

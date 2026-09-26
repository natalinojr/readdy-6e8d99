// Conta do iFood das ações rápidas / Vendas do dia / Fechamento do dia (acoes/ifood/comum.ts).
// Mesmas regras da tela Financeiro › iFood › Pedidos e do Fechamento do turno (assistente-cron).
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('@/lib/supabase', () => {
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'gte', 'lte', 'order']) q[m] = () => q;
  q.range = async () => ({ data: h.rows, error: null });
  return { supabase: { from: () => q }, invokeWithAuth: vi.fn() };
});

import { resumoIfood } from '@/components/feature/assistente/acoes/ifood/comum';

const venda = (o: Record<string, unknown>) => ({
  merchant_id: 'm1', short_id: '1', sale_created_at: '2026-09-25T22:10:00Z', current_status: 'CONCLUDED',
  gross_bag: 0, delivery_fee: 0, sale_balance: 0, payment_methods: [{ method: 'CREDIT', card: { brand: 'VISA' } }],
  billing_entries: [], benefits: null, ...o,
});

describe('resumoIfood', () => {
  it('vendido = itens + entrega dos não cancelados; taxas sem promoção; líquido de todos', async () => {
    h.rows = [
      venda({
        gross_bag: 50, delivery_fee: 8, sale_balance: 40,
        billing_entries: [{ name: 'ORDER_COMMISSION', value: -12 }, { name: 'PAYMENT_TRANSACTION_FEE', value: -1.5 }, { name: 'STORE_SUBSIDY', value: -5 }, { name: 'ORDER_PAYMENT', value: 58 }],
        benefits: { benefits: [{ sponsorships: [{ name: 'MERCHANT', value: 5 }, { name: 'IFOOD', value: 3 }] }] },
      }),
      venda({ merchant_id: 'm2', gross_bag: 30, delivery_fee: 0, sale_balance: 25, sale_created_at: '2026-09-25T15:00:00Z', payment_methods: [{ method: 'PIX' }], billing_entries: [{ name: 'ORDER_COMMISSION', value: -5 }] }),
      venda({ current_status: 'CANCELLED', gross_bag: 20, sale_balance: -2, billing_entries: [{ name: 'ORDER_COMMISSION', value: -2 }] }),
    ];
    const r = await resumoIfood('t', 'a', 'b', { m1: 'Loja A', m2: 'Loja B' });
    expect(r).not.toBeNull();
    expect(r!.pedidos).toBe(2);
    expect(r!.cancelados).toBe(1);
    expect(r!.valorCancelado).toBe(20);
    expect(r!.vendido).toBe(88);
    expect(r!.taxas).toBeCloseTo(-20.5); // -12 -1.5 -5 -2 (a promoção STORE_SUBSIDY de -5 fica fora)
    expect(r!.liquido).toBe(63);
    expect(r!.promoLoja).toBe(5);
    expect(r!.promoIfood).toBe(3);
    expect(r!.porLoja.map((l) => l.nome)).toEqual(['Loja A', 'Loja B']);
    expect(r!.porPagamento.map((p) => p.nome)).toEqual(['Crédito Visa', 'Pix']);
    expect(r!.porHora[19]).toBe(58); // 22:10Z = 19h em Brasília
    expect(r!.porHora[12]).toBe(30);
  });

  it('sem venda no período', async () => {
    h.rows = [];
    const r = await resumoIfood('t', 'a', 'b');
    expect(r).toMatchObject({ pedidos: 0, cancelados: 0, vendido: 0 });
  });
});

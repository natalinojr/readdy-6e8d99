import { describe, it, expect } from 'vitest';
import { splitComprasDRE, type ItemRow, type PurchaseRef } from '@/lib/comprasDRE';

// Regra de 2026-09-05: CMV da DRE = compras realizadas. Item de compra
// classificado como DESPESA sai do CMV e vai para a categoria dele.
const DESPESAS = new Set(['cat-limpeza', 'cat-embalagem']);

const item = (o: Partial<ItemRow> & { purchase_id: string; total_price: number }): ItemRow => ({
  freight_allocated: 0,
  dre_category_id: null,
  ...o,
});

describe('splitComprasDRE', () => {
  it('manda mercadoria para o CMV e item de despesa para a categoria', () => {
    const r = splitComprasDRE(
      [
        item({ purchase_id: 'p1', total_price: 500 }),                              // sem categoria
        item({ purchase_id: 'p1', total_price: 100, dre_category_id: 'cat-cmv' }),  // categoria de custo
        item({ purchase_id: 'p1', total_price: 80, dre_category_id: 'cat-limpeza' }),
      ],
      [{ id: 'p1', total_amount: 680 }],
      DESPESAS,
    );
    expect(r.cmv).toBe(600);
    expect(r.despesasPorCategoria).toEqual({ 'cat-limpeza': 80 });
    expect(r.total).toBe(680);
  });

  it('soma o frete rateado ao valor da linha', () => {
    const r = splitComprasDRE(
      [
        item({ purchase_id: 'p1', total_price: 100, freight_allocated: 20 }),
        item({ purchase_id: 'p1', total_price: 50, freight_allocated: 10, dre_category_id: 'cat-embalagem' }),
      ],
      [{ id: 'p1', total_amount: 180 }],
      DESPESAS,
    );
    expect(r.cmv).toBe(120);
    expect(r.despesasPorCategoria['cat-embalagem']).toBe(60);
    expect(r.total).toBe(180);
  });

  it('nunca conta o mesmo real duas vezes (invariante do P23)', () => {
    const items: ItemRow[] = [
      item({ purchase_id: 'p1', total_price: 500, dre_category_id: 'cat-limpeza' }),
      item({ purchase_id: 'p1', total_price: 300, dre_category_id: 'cat-cmv' }),
      item({ purchase_id: 'p2', total_price: 250 }),
      item({ purchase_id: 'p2', total_price: 90, freight_allocated: 10, dre_category_id: 'cat-embalagem' }),
    ];
    const purchases: PurchaseRef[] = [
      { id: 'p1', total_amount: 800 },
      { id: 'p2', total_amount: 350 },
      { id: 'p3', total_amount: 200 }, // sem itens
    ];
    const r = splitComprasDRE(items, purchases, DESPESAS);
    const somaDespesas = Object.values(r.despesasPorCategoria).reduce((s, v) => s + v, 0);
    expect(r.cmv + somaDespesas).toBe(r.total);
    expect(r.total).toBe(1350);
  });

  it('compra sem itens entra inteira como mercadoria', () => {
    const r = splitComprasDRE([], [{ id: 'p9', total_amount: '420.50' }], DESPESAS);
    expect(r.cmv).toBe(420.5);
    expect(r.total).toBe(420.5);
    expect(r.despesasPorCategoria).toEqual({});
  });

  it('categoria que não é de despesa continua em CMV, para nada sumir do resultado', () => {
    // Grupos 'tax'/'revenue' não são somados em lugar nenhum da DRE; se um item
    // fosse mandado para lá, o valor desapareceria do resultado.
    const r = splitComprasDRE(
      [item({ purchase_id: 'p1', total_price: 300, dre_category_id: 'cat-imposto' })],
      [{ id: 'p1', total_amount: 300 }],
      DESPESAS,
    );
    expect(r.cmv).toBe(300);
    expect(r.despesasPorCategoria).toEqual({});
  });

  it('sem compras devolve tudo zerado', () => {
    const r = splitComprasDRE([], [], DESPESAS);
    expect(r).toEqual({ cmv: 0, despesasPorCategoria: {}, total: 0 });
  });
});

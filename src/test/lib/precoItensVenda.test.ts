import { describe, it, expect } from 'vitest';
import { precosEfetivosDosItens, type ItemDeVenda, type PedidoParaPreco } from '@/lib/precoItensVenda';

const item = (order_id: string, item_price: number, quantity: number, adicional = 0): ItemDeVenda => ({
  order_id, item_price, quantity, order_item_options: adicional > 0 ? [{ additional_price: adicional }] : [],
});

describe('precosEfetivosDosItens', () => {
  it('delivery: soma os adicionais ao preço base (combo nasce com 0) e fecha no subtotal do pedido', () => {
    const itens = [item('d1', 38, 1), item('d1', 0, 1, 57), item('d1', 25, 1), item('d1', 10, 1)];
    const pedidos = new Map<string, PedidoParaPreco>([['d1', { subtotal: 130, origin_type: 'delivery' }]]);
    const precos = precosEfetivosDosItens(itens, pedidos);
    expect(precos).toEqual([38, 57, 25, 10]);
    expect(precos.reduce((a, p) => a + p, 0)).toBe(130);
  });

  it('caixa: item_price já inclui o adicional, não soma de novo', () => {
    const itens = [item('c1', 28, 1, 3)];
    const pedidos = new Map<string, PedidoParaPreco>([['c1', { subtotal: 28, origin_type: 'cashier' }]]);
    expect(precosEfetivosDosItens(itens, pedidos)).toEqual([28]);
  });

  it('decide por pedido, mantendo a ordem da entrada quando os itens vêm misturados', () => {
    const itens = [item('d1', 20, 2, 5), item('c1', 30, 1, 4), item('d1', 10, 1)];
    const pedidos = new Map<string, PedidoParaPreco>([
      ['d1', { subtotal: '60', origin_type: 'delivery' }], // 2×(20+5) + 10 = 60
      ['c1', { subtotal: 30, origin_type: 'cashier' }],
    ]);
    expect(precosEfetivosDosItens(itens, pedidos)).toEqual([25, 30, 10]);
  });

  it('pedido fora do mapa fica com o item_price cru', () => {
    expect(precosEfetivosDosItens([item('x', 12.5, 3, 2)], new Map())).toEqual([12.5]);
  });

  it('sem itens devolve lista vazia', () => {
    expect(precosEfetivosDosItens([], new Map())).toEqual([]);
  });
});

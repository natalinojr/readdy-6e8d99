import { describe, it, expect } from 'vitest';
import { acumularFaturamento, faturamentoIfood, faturamentoPedidoAoVivo, type FaturamentoPedido } from '@/lib/ifoodVendas';

const novo = (): FaturamentoPedido => ({ vendas: 0, promoLojaItens: 0, promoLojaEntrega: 0, entregaIfood: false });
const linha = (tipo_lancamento: string, descricao: string, valor: number, impacto_repasse = true) => ({ tipo_lancamento, descricao, valor, impacto_repasse });

describe('faturamento do iFood sem a promoção paga pela loja (decisão 2026-10-10)', () => {
  it('pedido ao vivo #3613: itens 49,90, cupom 5 da loja + 4,98 do iFood, entregador iFood → 44,90', () => {
    const v = faturamentoPedidoAoVivo({
      order_type: 'DELIVERY', delivered_by: 'IFOOD',
      total: { subTotal: 49.9, deliveryFee: 10.99 },
      benefits: [{ target: 'CART', sponsorshipValues: [{ name: 'IFOOD', value: 4.98 }, { name: 'MERCHANT', value: 5 }] }],
    });
    expect(v).toBeCloseTo(44.9, 2);
  });

  it('loja entrega: taxa de entrega entra e a entrega grátis paga pela loja sai', () => {
    const v = faturamentoPedidoAoVivo({
      order_type: 'DELIVERY', delivered_by: 'MERCHANT',
      total: { subTotal: 40, deliveryFee: 8 },
      benefits: [{ target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'MERCHANT', value: 8 }] }],
    });
    expect(v).toBeCloseTo(40, 2);
  });

  it('entrega grátis paga pela loja com entregador do iFood não reduz a venda', () => {
    const v = faturamentoPedidoAoVivo({
      order_type: 'DELIVERY', delivered_by: 'IFOOD',
      total: { subTotal: 40, deliveryFee: 6.99 },
      benefits: [{ target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'MERCHANT', value: 6.99 }] }],
    });
    expect(v).toBeCloseTo(40, 2);
  });

  it('conciliação (pedido real b2556953): vendas do Portal 46,90 − cupom da loja 5 = 41,90', () => {
    const p = novo();
    for (const r of [
      linha('Cobrança', 'Taxa de transação', -1.09),
      linha('Cobrança', 'Comissão do iFood', -8.8),
      linha('Entrada Financeira', 'Entrada Financeira', 31.48),
      linha('Retenção', 'Taxa de serviço iFood cobrada do cliente', -0.99),
      linha('Retenção', 'Taxa entrega iFood', -6.99),
      linha('Subsídio', 'Promoção custeada pelo iFood', 11.41),
      linha('Subsídio', 'Promoção custeada pela loja no delivery', -6.99, false),
      linha('Subsídio', 'Promoção custeada pela loja', -5, false),
    ]) acumularFaturamento(p, r);
    expect(p.vendas).toBeCloseTo(46.9, 2);
    expect(faturamentoIfood(p)).toBeCloseTo(41.9, 2);
  });

  it('conciliação (pedido real 1da62beb): só entrega grátis da loja com entregador iFood → fica 40,80', () => {
    const p = novo();
    for (const r of [
      linha('Entrada Financeira', 'Entrada Financeira', 41.79),
      linha('Retenção', 'Taxa de serviço iFood cobrada do cliente', -0.99),
      linha('Retenção', 'Taxa entrega iFood', -6.99),
      linha('Subsídio', 'Promoção custeada pela loja no delivery', -6.99, false),
    ]) acumularFaturamento(p, r);
    expect(faturamentoIfood(p)).toBeCloseTo(40.8, 2);
  });
});

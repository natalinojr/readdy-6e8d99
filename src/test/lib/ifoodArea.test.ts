import { describe, it, expect } from 'vitest';
import {
  montarPedidoOrder, montarPedidosArea, taxaMediaPorLoja, itensDosPedidos, itensDoCardapio, resumoItens, promocoesDoPedido,
  type MapaCustos, type OrderRow, type ItemRow,
} from '@/lib/ifoodArea';
import type { PedidoIfood } from '@/lib/ifoodDashboard';

// Pedido real #1631 (Paranaguá, 05/10): taco 25,49 + Coca 6,00; promoção do item 10,20 (iFood 5,20 + loja 5,00)
// e entrega grátis 6,99 paga pela loja.
const row: OrderRow = {
  id: 'r1', ifood_order_id: 'o1', display_id: '1631', merchant_id: 'm1', status: 'concluded', order_type: 'DELIVERY', delivered_by: 'IFOOD',
  is_test: false, ordered_at: '2026-10-05T14:39:30Z', created_at: '2026-10-05T14:40:07Z', customer_name: 'Natalia Venancio', customer_orders_count: 0,
  total: { subTotal: 31.49, deliveryFee: 6.99, additionalFees: 0.99, benefits: 17.19, orderAmount: 22.28 },
  benefits: [
    { value: 10.2, target: 'ITEM', sponsorshipValues: [{ name: 'CHAIN', value: 0 }, { name: 'IFOOD', value: 5.2 }, { name: 'EXTERNAL', value: 0 }, { name: 'MERCHANT', value: 5 }] },
    { value: 6.99, target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'IFOOD', value: 0 }, { name: 'MERCHANT', value: 6.99 }] },
  ],
  payments: { methods: [{ method: 'PIX', type: 'ONLINE', value: 22.28 }] },
  timeline: {}, cancel_reason: null, order_id: null,
};
const itens: ItemRow[] = [{
  order_row_id: 'r1', idx: 1, name: 'Taco de Frango Cremoso', quantity: '1', total_price: '31.49', observations: null,
  options: [{ name: 'Coca Cola Zero 350 Ml', groupName: 'Refri Gelado com Desconto!', quantity: 1, price: 6, customizations: [] }],
}];

const fin = (p: Partial<PedidoIfood>): PedidoIfood => ({
  id: 'x', loja: 'm1', at: new Date('2026-09-20T20:00:00Z'), dia: '2026-09-20', hora: 17, semana: 0, vendas: 100, bruto: 100, comissao: 17, transacao: 2,
  promoLoja: 0, promoIfood: 0, entregaSobDemanda: 0, entregaCliente: 0, outrosServicos: 1, ajustes: 0, liquido: 80, pagamento: 'Pix',
  logistica: 'ifood', cancelado: false, parcial: false, motivo: null, ...p,
});

describe('ifoodArea', () => {
  it('separa promoção paga pela loja e pelo iFood', () => {
    expect(promocoesDoPedido(row.benefits)).toEqual({ loja: 11.99, ifood: 5.2, lojaEntrega: 6.99 });
  });

  it('monta o pedido com primeiro nome, complementos e pagamento', () => {
    const o = montarPedidoOrder(row, itens);
    expect(o.cliente).toBe('Natalia');
    expect(o.pedidosAntes).toBe(0);
    expect(o.pagamento).toBe('Pix');
    expect(o.itens[0].complementos).toEqual([{ nome: 'Coca Cola Zero 350 Ml', grupo: 'Refri Gelado com Desconto!', qtd: 1, preco: 6 }]);
  });

  it('estima o que chega pela média da loja quando o iFood ainda não fechou', () => {
    const media = taxaMediaPorLoja([fin({ id: 'a' }), fin({ id: 'b', cancelado: true, vendas: 0 })]);
    expect(media.get('m1')).toBeCloseTo(0.2, 6); // (17+2+1)/100
    const custos: MapaCustos = new Map([
      ['item|taco de frango cremoso', { custo: 7.8, alvo: 'Taco de Frango', tipo: 'item', precoBalcao: 24 }],
      ['complemento|coca cola zero 350 ml|refri gelado com desconto!', { custo: 3.1, alvo: 'Coca Zero', tipo: 'item', precoBalcao: 7 }],
    ]);
    const [p] = montarPedidosArea([montarPedidoOrder(row, itens)], [], custos, media);
    expect(p.estimado).toBe(true);
    // 31,49 − 20% (6,30) − 11,99 de promoção da loja = 13,20
    expect(p.chega).toBeCloseTo(13.2, 2);
    expect(p.comida).toBeCloseTo(10.9, 2);
    expect(p.sobra).toBeCloseTo(2.3, 2);
    expect(p.sobraBalcao).toBeCloseTo(31 - 10.9, 2);
  });

  it('item sem ficha deixa comida e sobra em aberto (nunca zero)', () => {
    const [p] = montarPedidosArea([montarPedidoOrder(row, itens)], [], new Map(), new Map([['*', 0.2]]));
    expect(p.comida).toBeNull();
    expect(p.sobra).toBeNull();
    expect(p.semFicha).toEqual(['Taco de Frango Cremoso', 'Coca Cola Zero 350 Ml']);
  });

  it('usa o fechamento do iFood quando existe e junta pedido só da conciliação', () => {
    const o = montarPedidoOrder(row, itens);
    const pedidos = montarPedidosArea([o], [fin({ id: 'o1', vendas: 31.49, liquido: 12.5 }), fin({ id: 'velho' })], new Map(), new Map());
    expect(pedidos).toHaveLength(2);
    const p = pedidos.find((x) => x.id === 'o1')!;
    expect(p.estimado).toBe(false);
    expect(p.chega).toBe(12.5);
    expect(pedidos.find((x) => x.id === 'velho')!.order).toBeNull();
  });

  it('item do pedido leva a parte do que chegou e a comida com os complementos', () => {
    const custos: MapaCustos = new Map([
      ['item|taco de frango cremoso', { custo: 7.8, alvo: 'Taco', tipo: 'item', precoBalcao: 24 }],
      ['complemento|coca cola zero 350 ml|refri gelado com desconto!', { custo: 3.1, alvo: 'Coca', tipo: 'item', precoBalcao: 7 }],
    ]);
    const ps = montarPedidosArea([montarPedidoOrder(row, itens)], [fin({ id: 'o1', vendas: 31.49, liquido: 12.5 })], custos, new Map());
    const its = itensDosPedidos(ps, custos);
    const taco = its.find((i) => i.nivel === 'item')!;
    expect(taco.chegaUnit).toBeCloseTo(12.5, 2);
    expect(taco.custoUnit).toBeCloseTo(10.9, 2);
    expect(taco.sobraUnit).toBeCloseTo(1.6, 2);
    expect(taco.precoEmpata).toBeCloseTo(10.9 / (12.5 / 31.49), 2);
    expect(taco.precoMesmoBalcao).toBeCloseTo(24 / (12.5 / 31.49), 2);
    expect(resumoItens(its).prejuizo).toHaveLength(0);
  });

  it('relatório de cardápio usa o fator médio do período', () => {
    const custos: MapaCustos = new Map([['item|combo', { custo: 40, alvo: 'Combo', tipo: 'combo', precoBalcao: null }]]);
    const its = itensDoCardapio([{ kind: 'item', name: 'Combo', quantity: 2, total_value: 107.8 }], custos, 0.65);
    expect(its[0].fatorMedio).toBe(true);
    expect(its[0].sobraUnit).toBeCloseTo(53.9 * 0.65 - 40, 2);
    expect(resumoItens(its).prejuizo).toHaveLength(1);
  });
});

describe('pedido que o iFood ainda não fechou (API de Vendas sem taxas)', () => {
  it('estima pela média da loja e não entra na média', () => {
    const media = taxaMediaPorLoja([fin({ id: 'a' }), fin({ id: 'b', semTaxas: true, comissao: 0, transacao: 0, outrosServicos: 0, liquido: 100 })]);
    expect(media.get('m1')).toBeCloseTo(0.2, 6);
    const [p] = montarPedidosArea([], [fin({ id: 'b', semTaxas: true, comissao: 0, transacao: 0, outrosServicos: 0, liquido: 95, promoLoja: 5 })], new Map(), media);
    expect(p.estimado).toBe(true);
    expect(p.chega).toBeCloseTo(100 - 20 - 5, 2);
  });
});

describe('combo de escolhas', () => {
  it('a comida é a soma das escolhas e a escolha grátis também precisa de ficha', () => {
    const combo: OrderRow = { ...row, id: 'r2', ifood_order_id: 'o2', benefits: [], total: { subTotal: 54.89 } };
    const its: ItemRow[] = [{
      order_row_id: 'r2', idx: 1, name: 'Combo Burrito com Coca Cola Grátis', quantity: 1, total_price: 54.89, observations: null,
      options: [
        { name: 'Burritos Chili com Carne', groupName: 'Escolha o burrito', quantity: 1, price: 49.9 },
        { name: 'Coca Cola Zero 350 Ml', groupName: 'Bebida', quantity: 1, price: 0 },
      ],
    }];
    const base: MapaCustos = new Map([
      ['item|combo burrito com coca cola grátis', { custo: 0, alvo: 'Combo de escolhas', tipo: 'escolhas', precoBalcao: null }],
      ['complemento|burritos chili com carne|escolha o burrito', { custo: 14, alvo: 'Burrito Chilli', tipo: 'item', precoBalcao: 45 }],
    ]);
    const [p1] = montarPedidosArea([montarPedidoOrder(combo, its)], [], base, new Map([['*', 0.2]]));
    expect(p1.comida).toBeNull();
    expect(p1.semFicha).toEqual(['Coca Cola Zero 350 Ml']);
    const comCoca: MapaCustos = new Map([...base, ['complemento|coca cola zero 350 ml|bebida', { custo: 3.1, alvo: 'Coca Zero', tipo: 'item', precoBalcao: 7 }]]);
    const [p2] = montarPedidosArea([montarPedidoOrder(combo, its)], [], comCoca, new Map([['*', 0.2]]));
    expect(p2.comida).toBeCloseTo(17.1, 2);
    const item = itensDosPedidos([p2], comCoca).find((i) => i.nivel === 'item')!;
    expect(item.escolhas?.map((e) => e.nome)).toEqual(['Burritos Chili com Carne', 'Coca Cola Zero 350 Ml']);
    expect(item.escolhas?.[1].custoUnit).toBeCloseTo(3.1, 2);
  });
});

describe('pedido antigo sem itens', () => {
  it('a linha "Sem itens selecionados" do iFood não vira produto', () => {
    const o = montarPedidoOrder(row, [{ order_row_id: 'r1', idx: 1, name: 'Sem itens selecionados', quantity: 1, total_price: 87.81, observations: null, options: [] }]);
    expect(o.itens).toEqual([]);
  });
});

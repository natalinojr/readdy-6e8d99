import { describe, it, expect } from 'vitest';
import {
  montarPedidoOrder, montarPedidosArea, taxaTeoricaPorLoja, itensDosPedidos,
  type MapaCustos, type OrderRow, type ItemRow,
} from '@/lib/ifoodArea';
import type { PedidoIfood } from '@/lib/ifoodDashboard';
import { colunasDoPedido, resultadoDoPedido, valorCusto, type CustoExtra } from '@/lib/ifoodCustosPedido';

// Dono 06/10: Itens e CMV = conta teórica sem promoção; Pedidos = custos reais em colunas + custos da loja.

// Churros Creme de Avelã R$ 31 (#1896, Paranaguá, 01/10): desconto da loja 4,99 nos itens + entrega grátis 6,99
// paga pela loja; comissão 21% e transação 2,6% sobre 26,01 (= 31 − 4,99); chegou 12,88.
const fin1896: PedidoIfood = {
  id: 'o1896', loja: 'm1', at: new Date('2026-10-01T20:00:00Z'), dia: '2026-10-01', hora: 17, semana: 3,
  vendas: 31, bruto: 31, comissao: 5.46, transacao: 0.68, promoLoja: 11.98, promoLojaEntrega: 6.99, promoIfood: 4.31,
  entregaSobDemanda: 0, entregaCliente: 6.99, outrosServicos: 0, ajustes: 0, liquido: 12.88, pagamento: 'Pix',
  logistica: 'ifood', cancelado: false, parcial: false, motivo: null,
};
const row: OrderRow = {
  id: 'r1896', ifood_order_id: 'o1896', display_id: '1896', merchant_id: 'm1', status: 'concluded', order_type: 'DELIVERY', delivered_by: 'IFOOD',
  is_test: false, ordered_at: '2026-10-01T20:00:00Z', created_at: '2026-10-01T20:00:10Z', customer_name: 'Cliente', customer_orders_count: 3,
  total: { subTotal: 31, deliveryFee: 6.99, additionalFees: 0.99, benefits: 16.29, orderAmount: 22.69 },
  benefits: [
    { value: 9.3, target: 'ITEM', sponsorshipValues: [{ name: 'MERCHANT', value: 4.99 }, { name: 'IFOOD', value: 4.31 }] },
    { value: 6.99, target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'MERCHANT', value: 6.99 }] },
  ],
  payments: { methods: [{ method: 'PIX', type: 'ONLINE', value: 22.69 }] },
  timeline: {}, cancel_reason: null, order_id: null,
};
const itens: ItemRow[] = [{ order_row_id: 'r1896', idx: 1, name: 'Churros Creme de Avelã!', quantity: '1', total_price: '31', observations: null, options: [] }];
const custos: MapaCustos = new Map([['item|churros creme de avelã!', { custo: 5.15, alvo: 'Churros', tipo: 'item', precoBalcao: 25 }]]);

describe('taxa do iFood sem promoção (Itens e CMV)', () => {
  it('#1896: (5,46 + 0,68) ÷ (31 − 4,99) = 23,6% — a entrega grátis não muda a base', () => {
    expect(taxaTeoricaPorLoja([fin1896]).get('m1')).toBeCloseTo(6.14 / 26.01, 6);
  });

  it('item a preço cheio: chega = 31 × (1 − 23,6%) ≈ 23,68 (não os 13,38 com as promoções do pedido)', () => {
    const pedidos = montarPedidosArea([montarPedidoOrder(row, itens)], [fin1896], custos, new Map());
    const [teorico] = itensDosPedidos(pedidos, custos, taxaTeoricaPorLoja([fin1896])).filter((i) => i.nivel === 'item');
    expect(teorico.chegaUnit).toBeCloseTo(31 * (1 - 6.14 / 26.01), 2);
    expect(teorico.sobraUnit).toBeCloseTo(31 * (1 - 6.14 / 26.01) - 5.15, 2);
    // Sem a taxa teórica, continua a conta real do pedido (com promoções).
    const [real] = itensDosPedidos(pedidos, custos).filter((i) => i.nivel === 'item');
    expect(real.chegaUnit).toBeCloseTo(12.88, 2);
  });
});

describe('colunas de custo do pedido (Pedidos › Custos)', () => {
  const [p] = montarPedidosArea([montarPedidoOrder(row, itens)], [fin1896], custos, new Map());
  const col = colunasDoPedido(p);

  it('#1896 fecha com o chega na loja', () => {
    expect(col).toMatchObject({ venda: 31, descItens: 4.99, entregaGratis: 6.99, comissao: 5.46, taxaPagamento: 0.68, outrasIfood: 0, chega: 12.88, nota: 26.01, comida: 5.15 });
    expect(col.venda - col.descItens - col.entregaGratis - col.comissao! - col.taxaPagamento! - col.outrasIfood!).toBeCloseTo(col.chega!, 2);
    expect(col.lucroBruto).toBeCloseTo(12.88 - 5.15, 2);
  });

  it('custos da loja: imposto 6% da nota, royalties 5% das vendas, embalagem R$ 1,50 por pedido', () => {
    const cs: CustoExtra[] = [
      { nome: 'Simples', tipo: 'percentual', base: 'nota', valor: 6, ativo: true },
      { nome: 'Royalties', tipo: 'percentual', base: 'venda', valor: 5, ativo: true },
      { nome: 'Embalagem', tipo: 'fixo', base: null, valor: 1.5, ativo: true },
      { nome: 'Desligado', tipo: 'fixo', base: null, valor: 99, ativo: false },
    ];
    const r = resultadoDoPedido(col, cs);
    expect(r.custos).toEqual([1.56, 1.55, 1.5]);
    expect(r.totalCustos).toBe(4.61);
    expect(r.resultado).toBeCloseTo(12.88 - 5.15 - 4.61, 2);
    expect(r.margem).toBeCloseTo(((12.88 - 5.15 - 4.61) / 31) * 100, 1);
  });

  it('sem ficha: custo sobre o lucro bruto fica em aberto e o resultado também', () => {
    const semFicha = { ...col, comida: null, lucroBruto: null };
    expect(valorCusto({ nome: 'Part.', tipo: 'percentual', base: 'lucro', valor: 10, ativo: true }, semFicha)).toBeNull();
    expect(resultadoDoPedido(semFicha, [{ nome: 'Simples', tipo: 'percentual', base: 'nota', valor: 6, ativo: true }]).resultado).toBeNull();
  });
});

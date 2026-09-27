// @vitest-environment node
// ifood-shipping/funnel.ts: pedido do iFood → pedido do ERPOS (IFOOD-PEDIDOS-FUNIL.md, etapa 3).
// Usa o formato real de um pedido de teste do Portal (PRODUTO 1 + COMBO com 4 complementos e 3 customizações).
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/ifood-shipping/funnel.ts')).href;
/* eslint-disable @typescript-eslint/no-explicit-any */
let m: any;
beforeAll(async () => { m = await import(/* @vite-ignore */ PATH); });

const itens = [
  { idx: 1, name: 'PRODUTO 1 - NÃO ENTREGAR - Primeiro Nível', catalog_item_id: 'c1', external_code: '2963', quantity: 1, unit_price: 5, options: [] },
  {
    idx: 2, name: 'PRODUTO 2 (COMBO) - NÃO ENTREGAR - Primeiro Nível', catalog_item_id: 'c2', external_code: '5575', quantity: 2, unit_price: 5,
    observations: 'sem cebola',
    options: [
      { id: 'o1', name: 'Complemento 1 - Segundo Nível', groupName: 'Adicione mais ingredientes', externalCode: '4254', quantity: 1, price: 2, unitPrice: 2 },
      { id: 'o2', name: 'Complemento 2 - Segundo Nível', groupName: 'Deseja adicionar molhos?', externalCode: '3659', quantity: 1, price: 2, unitPrice: 2 },
      {
        id: 'o4', name: 'Complemento 4 - Segundo Nível', groupName: 'Meu sanduíche favorito', externalCode: '7014', quantity: 1, price: 2, unitPrice: 2,
        customizations: [{ id: 'cu1', name: 'Customização 1', groupName: 'Grupo Obrigatório', externalCode: '9536', quantity: 1, price: 1, unitPrice: 1 }],
      },
    ],
  },
];
const L = (level: string, name: string, group: string, kind: string, target: string | null, ext: string | null = null) => ({
  level, name_key: name.toLowerCase(), group_key: group.toLowerCase(), ifood_id: null, external_code: ext, target_kind: kind,
  menu_item_id: kind === 'item' ? target : null, combo_id: kind === 'combo' ? target : null, option_id: kind === 'option' ? target : null,
});
const links = [
  L('item', 'PRODUTO 1 - NÃO ENTREGAR - Primeiro Nível', '', 'item', 'mi-suco'),
  L('complemento', 'Complemento 1 - Segundo Nível', 'Adicione mais ingredientes', 'option', 'opt-queijo'),
  L('complemento', 'Complemento 2 - Segundo Nível', 'Deseja adicionar molhos?', 'sem_estoque', null),
  L('complemento', 'Complemento 4 - Segundo Nível', 'Meu sanduíche favorito', 'item', 'mi-lanche'),
];
const menu = new Map([['mi-suco', { skip_kds: true, station_id: 'st-bar' }], ['mi-lanche', { skip_kds: false, station_id: 'st-cozinha' }]]);
const pedido = (extra: any = {}) => ({
  display_id: '2419', order_type: 'DELIVERY', delivered_by: 'IFOOD', customer_name: 'PEDIDO DE TESTE', pickup_code: '1234',
  total: { subTotal: 37, deliveryFee: 5.99, orderAmount: 42.99 },
  payments: { methods: [{ method: 'CREDIT', type: 'ONLINE', value: 42.99 }] }, benefits: [], ...extra,
});

describe('montarPedidoErpos', () => {
  it('preço do iFood, vínculos de item/opção/sem estoque, complemento→item vira linha, sem vínculo avisado', () => {
    const r = m.montarPedidoErpos(pedido(), itens, links, menu);
    expect(r.items.map((i: any) => i.item_name)).toEqual(['PRODUTO 1 - NÃO ENTREGAR - Primeiro Nível', 'PRODUTO 2 (COMBO) - NÃO ENTREGAR - Primeiro Nível', 'Complemento 4 - Segundo Nível']);
    const [p1, combo, extra] = r.items;
    expect(p1).toMatchObject({ item_id: 'mi-suco', item_price: 5, quantity: 1, skip_kds: true, station_id: 'st-bar' });
    expect(combo).toMatchObject({ item_id: null, combo_id: null, item_price: 5, quantity: 2 });
    expect(combo.observations).toEqual([{ text: 'sem cebola', is_checked: false }]);
    expect(combo.options).toEqual([
      { option_id: 'opt-queijo', option_name: 'Complemento 1 - Segundo Nível', group_name: 'Adicione mais ingredientes', additional_price: 2 },
      { option_id: null, option_name: 'Complemento 2 - Segundo Nível', group_name: 'Deseja adicionar molhos?', additional_price: 2 },
      { option_id: null, option_name: 'Customização 1', group_name: 'Grupo Obrigatório', additional_price: 1 },
    ]);
    expect(extra).toMatchObject({ item_id: 'mi-lanche', quantity: 2, item_price: 2, station_id: 'st-cozinha', notes: 'Complemento de PRODUTO 2 (COMBO) - NÃO ENTREGAR - Primeiro Nível' });
    expect(r.semVinculo).toEqual(['PRODUTO 2 (COMBO) - NÃO ENTREGAR - Primeiro Nível', 'Customização 1 (Grupo Obrigatório)']);
  });

  it('entregador do iFood: plataforma ifood, sem taxa da loja, pago; notas com código de coleta', () => {
    const r = m.montarPedidoErpos(pedido(), itens, links, menu);
    expect(r.order).toMatchObject({ delivery_platform: 'ifood', delivery_fee: 0, subtotal: 37, total_amount: 37, discount_amount: 0, destination_phone: null });
    expect(r.pago).toBe(true);
    expect(r.paymentLabel).toBe('iFood (pago no app)');
    expect(r.order.notes).toContain('Pedido iFood #2419 · Entregador iFood');
    expect(r.order.notes).toContain('Código de coleta: 1234');
  });

  it('motoboy da loja + dinheiro com troco: plataforma propria, taxa entra, NÃO pago, cobrar na entrega', () => {
    const r = m.montarPedidoErpos(pedido({
      delivered_by: 'MERCHANT', address: { streetName: 'Rua A', streetNumber: '10', neighborhood: 'Centro' },
      payments: { methods: [{ method: 'CASH', type: 'OFFLINE', value: 42.99, cash: { changeFor: 50 } }] },
    }), itens, links, menu);
    expect(r.order).toMatchObject({ delivery_platform: 'propria', delivery_fee: 5.99, total_amount: 42.99, delivery_address: 'Rua A, 10 - Centro' });
    expect(r.pago).toBe(false);
    expect(r.paymentLabel).toBe('Cobrar na entrega: Dinheiro R$ 42,99 (troco para R$ 50,00)');
  });

  it('cupom: só a parte paga pela loja vira desconto', () => {
    const r = m.montarPedidoErpos(pedido({ delivered_by: 'MERCHANT', benefits: [{ value: 10, target: 'CART', sponsorshipValues: [{ name: 'IFOOD', value: 6 }, { name: 'MERCHANT', value: 4 }] }] }), itens, links, menu);
    expect(r.order).toMatchObject({ discount_amount: 4, total_amount: 38.99 });
  });

  it('retirada e consumo no local: plataforma retirada, sem endereço', () => {
    expect(m.montarPedidoErpos(pedido({ order_type: 'TAKEOUT', delivered_by: null }), itens, links, menu).order).toMatchObject({ delivery_platform: 'retirada', delivery_address: null, delivery_fee: 0 });
    expect(m.montarPedidoErpos(pedido({ order_type: 'DINE_IN', delivered_by: null }), itens, links, menu).order.notes).toContain('Consumo no local');
  });
});

describe('acharVinculo', () => {
  it('código externo → id do catálogo → nome+grupo', () => {
    const ls = [
      { ...L('complemento', 'X', 'G', 'sem_estoque', null), external_code: '777' },
      { ...L('complemento', 'Y', 'G', 'sem_estoque', null), ifood_id: 'id-9' },
      L('complemento', 'Z', 'Grupo', 'sem_estoque', null),
    ];
    expect(m.acharVinculo(ls, 'complemento', { name: 'outro nome', externalCode: '777' }).name_key).toBe('x');
    expect(m.acharVinculo(ls, 'complemento', { name: 'qualquer', id: 'id-9' }).name_key).toBe('y');
    expect(m.acharVinculo(ls, 'complemento', { name: '  z ', groupName: 'GRUPO' }).name_key).toBe('z');
    expect(m.acharVinculo(ls, 'complemento', { name: 'z', groupName: 'outro grupo' })).toBeNull();
  });
});

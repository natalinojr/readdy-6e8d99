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

describe('revisão 2026-09-27', () => {
  it('retirada paga no balcão NÃO é repasse (a loja recebe)', () => {
    const r = m.montarPedidoErpos(pedido({ order_type: 'TAKEOUT', delivered_by: null, payments: { methods: [{ method: 'CASH', type: 'OFFLINE', value: 37 }] } }), itens, links, menu);
    expect(r.pago).toBe(false);
    expect(r.paymentLabel).toBe('Cobrar na entrega: Dinheiro R$ 37,00');
  });
  it('entregador do iFood cobrando na entrega = repasse', () => {
    expect(m.montarPedidoErpos(pedido({ payments: { methods: [{ method: 'CASH', type: 'OFFLINE', value: 37 }] } }), itens, links, menu).pago).toBe(true);
  });
  it('cobrado pela loja com cupom do iFood: total = o que o cliente paga; desconto do iFood anotado', () => {
    const r = m.montarPedidoErpos(pedido({
      delivered_by: 'MERCHANT', benefits: [{ value: 10, target: 'CART', sponsorshipValues: [{ name: 'IFOOD', value: 10 }] }],
      payments: { methods: [{ method: 'CASH', type: 'OFFLINE', value: 32.99 }] },
    }), itens, links, menu);
    expect(r.order).toMatchObject({ subtotal: 37, delivery_fee: 5.99, total_amount: 32.99, discount_amount: 10, service_fee_amount: 0 });
    expect(r.order.notes).toContain('Desconto bancado pelo iFood: R$ 10,00');
  });
  it('complemento 2x ligado a opção vira duas linhas (baixa em dobro), preço dividido', () => {
    const its = [{ idx: 1, name: 'X', quantity: 1, unit_price: 10, options: [{ id: 'z', name: 'Complemento 1 - Segundo Nível', groupName: 'Adicione mais ingredientes', quantity: 2, price: 4, unitPrice: 2 }] }];
    const r = m.montarPedidoErpos(pedido(), its, links, menu);
    expect(r.items[0].options).toEqual([
      { option_id: 'opt-queijo', option_name: 'Complemento 1 - Segundo Nível', group_name: 'Adicione mais ingredientes', additional_price: 2 },
      { option_id: 'opt-queijo', option_name: 'Complemento 1 - Segundo Nível', group_name: 'Adicione mais ingredientes', additional_price: 2 },
    ]);
  });
});

describe('ficha do iFood (2026-10-05): baixa de toda a ficha', () => {
  const F = (level: string, name: string, group: string, kind: string, id: string, quantity: number, unit: string | null = null, ordem = 0) => ({
    level, name_key: name.toLowerCase(), group_key: group.toLowerCase(), kind, quantity, unit, ordem,
    menu_item_id: kind === 'item' ? id : null, ingredient_id: kind === 'insumo' ? id : null,
  });
  const menuF = new Map<string, any>([
    ['mi-burger', { skip_kds: false, station_id: 'st-chapa', name: 'Burger' }],
    ['mi-batata', { skip_kds: false, station_id: 'st-frita', name: 'Batata' }],
    ['mi-coca', { skip_kds: true, station_id: 'st-bar', name: 'Coca lata' }],
  ]);
  const combo = [{ idx: 1, name: 'Combo Casal', quantity: 2, unit_price: 50, options: [] }];

  it('vários itens: 1º item com qtd 1 é o produto; os outros viram linhas a R$ 0 "parte de"; insumos saem para a baixa solta', () => {
    const fichas = [
      F('item', 'Combo Casal', '', 'item', 'mi-burger', 1, null, 0),
      F('item', 'Combo Casal', '', 'item', 'mi-batata', 2, null, 1),
      F('item', 'Combo Casal', '', 'insumo', 'ing-emb', 1, 'un', 2),
      F('item', 'Combo Casal', '', 'insumo', 'ing-ketchup', 15, 'g', 3),
    ];
    const r = m.montarPedidoErpos(pedido(), combo, [], menuF, fichas);
    expect(r.items).toHaveLength(2);
    expect(r.items[0]).toMatchObject({ item_id: 'mi-burger', item_name: 'Combo Casal', item_price: 50, quantity: 2, station_id: 'st-chapa' });
    expect(r.items[1]).toMatchObject({ item_id: 'mi-batata', item_name: 'Batata', item_price: 0, quantity: 4, notes: 'parte de Combo Casal', station_id: 'st-frita' });
    expect(r.insumos).toEqual([
      { ingredient_id: 'ing-emb', menu_item_id: null, quantity: 2, unit: 'un', origem: 'Combo Casal' },
      { ingredient_id: 'ing-ketchup', menu_item_id: null, quantity: 30, unit: 'g', origem: 'Combo Casal' },
    ]);
    expect(r.semVinculo).toEqual([]);
    expect(r.order.subtotal).toBe(37); // valores do pedido não mudam com a ficha
  });

  it('ficha vale mais que a ligação simples (1 item ×1 + insumo): mantém o item e baixa o insumo extra', () => {
    const lk = [L('item', 'Combo Casal', '', 'item', 'mi-burger')];
    const fichas = [F('item', 'Combo Casal', '', 'item', 'mi-burger', 1), F('item', 'Combo Casal', '', 'insumo', 'ing-emb', 1, 'un', 1)];
    const r = m.montarPedidoErpos(pedido(), combo, lk, menuF, fichas);
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({ item_id: 'mi-burger', quantity: 2 });
    expect(r.insumos).toEqual([{ ingredient_id: 'ing-emb', menu_item_id: null, quantity: 2, unit: 'un', origem: 'Combo Casal' }]);
  });

  it('sem item com qtd 1: produto entra sem item (texto) e todas as partes viram linhas; só bebidas → produto pula a cozinha', () => {
    const fichas = [F('item', 'Combo Casal', '', 'item', 'mi-coca', 2)];
    const r = m.montarPedidoErpos(pedido(), combo, [], menuF, fichas);
    expect(r.items[0]).toMatchObject({ item_id: null, item_price: 50, skip_kds: true });
    expect(r.items[1]).toMatchObject({ item_id: 'mi-coca', quantity: 4, item_price: 0, skip_kds: true, notes: 'parte de Combo Casal' });
  });

  it('item com quantidade quebrada (½ porção) não vira linha: vai para a baixa solta pela ficha do item', () => {
    const its = [{ idx: 1, name: 'Combo Casal', quantity: 1, unit_price: 50, options: [] }];
    const fichas = [F('item', 'Combo Casal', '', 'item', 'mi-burger', 1), F('item', 'Combo Casal', '', 'item', 'mi-batata', 0.5, null, 1)];
    const r = m.montarPedidoErpos(pedido(), its, [], menuF, fichas);
    expect(r.items).toHaveLength(1);
    expect(r.insumos).toEqual([{ ingredient_id: null, menu_item_id: 'mi-batata', quantity: 0.5, unit: null, origem: 'Combo Casal' }]);
  });

  it('complemento com ficha: texto com o preço no produto, itens a R$ 0, insumos × qtd do item × qtd do complemento', () => {
    const its = [{ idx: 1, name: 'X', quantity: 2, unit_price: 10, options: [{ id: 'z', name: 'Batata grande', groupName: 'Acompanha', quantity: 1, price: 6, unitPrice: 6 }] }];
    const fichas = [F('complemento', 'Batata grande', 'Acompanha', 'item', 'mi-batata', 1), F('complemento', 'Batata grande', 'Acompanha', 'insumo', 'ing-cx', 1, 'un', 1)];
    const r = m.montarPedidoErpos(pedido(), its, [], menuF, fichas);
    expect(r.items[0].options).toEqual([{ option_id: null, option_name: 'Batata grande', group_name: 'Acompanha', additional_price: 6 }]);
    expect(r.items[1]).toMatchObject({ item_id: 'mi-batata', quantity: 2, item_price: 0, notes: 'parte de Batata grande' });
    expect(r.insumos).toEqual([{ ingredient_id: 'ing-cx', menu_item_id: null, quantity: 2, unit: 'un', origem: 'Batata grande' }]);
    expect(r.semVinculo).toEqual(['X']);
  });

  it('sem ficha: nada muda (insumos vazio)', () => {
    expect(m.montarPedidoErpos(pedido(), itens, links, menu).insumos).toEqual([]);
  });
});

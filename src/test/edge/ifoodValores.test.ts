// @vitest-environment node
// _shared/ifood-valores.ts (valor da venda do pedido do iFood) + fiscal-write/valores.ts › completarPagamentoIfood.
// IFOOD-PEDIDOS-FUNIL.md, etapa 5 (NFC-e). Caso real: pedido #1631 da Paranaguá (05/10/2026).
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const VALORES = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/ifood-valores.ts')).href;
const FISCAL = pathToFileURL(resolve(__dirname, '../../../supabase/functions/fiscal-write/valores.ts')).href;
const FUNIL = pathToFileURL(resolve(__dirname, '../../../supabase/functions/ifood-shipping/funnel.ts')).href;
/* eslint-disable @typescript-eslint/no-explicit-any */
let v: any; let f: any; let fu: any;
beforeAll(async () => {
  v = await import(/* @vite-ignore */ VALORES);
  f = await import(/* @vite-ignore */ FISCAL);
  fu = await import(/* @vite-ignore */ FUNIL);
});

const sp = (merchant: number, ifood = 0, chain = 0, external = 0) => [
  { name: 'CHAIN', value: chain }, { name: 'IFOOD', value: ifood }, { name: 'EXTERNAL', value: external }, { name: 'MERCHANT', value: merchant },
];
// #1631 (Paranaguá, 05/10): item com 40% (5,20 iFood + 5,00 loja), entrega grátis 6,99 bancada pela loja, entregador iFood, Pix online.
const p1631 = {
  order_type: 'DELIVERY', delivered_by: 'IFOOD',
  total: { benefits: 17.19, subTotal: 31.49, deliveryFee: 6.99, orderAmount: 22.28, additionalFees: 0.99 },
  benefits: [
    { value: 10.2, target: 'ITEM', sponsorshipValues: sp(5, 5.2) },
    { value: 6.99, target: 'DELIVERY_FEE', sponsorshipValues: sp(6.99) },
  ],
  payments: { methods: [{ method: 'PIX', type: 'ONLINE', value: 22.28, prepaid: true }] },
};

describe('valorVendaIfood', () => {
  it('#1631: entregador do iFood → taxa e entrega grátis da loja fora; só o desconto da loja no item abate', () => {
    expect(v.valorVendaIfood(p1631)).toEqual({ subtotal: 31.49, taxaLoja: 0, descLoja: 5, valorVenda: 26.49 });
  });

  it('entrega pela loja: taxa entra e a entrega grátis bancada pela loja abate', () => {
    expect(v.valorVendaIfood({ ...p1631, delivered_by: 'MERCHANT' })).toEqual({ subtotal: 31.49, taxaLoja: 6.99, descLoja: 11.99, valorVenda: 26.49 });
  });

  it('cupom do iFood e da indústria não abatem; o da rede abate', () => {
    const r = v.valorVendaIfood({ order_type: 'DELIVERY', delivered_by: 'MERCHANT', total: { subTotal: 50, deliveryFee: 5 },
      benefits: [{ target: 'CART', sponsorshipValues: sp(0, 10, 3, 2) }] });
    expect(r).toEqual({ subtotal: 50, taxaLoja: 5, descLoja: 3, valorVenda: 52 });
  });

  it('retirada: sem taxa; nunca negativo', () => {
    expect(v.valorVendaIfood({ order_type: 'TAKEOUT', delivered_by: 'MERCHANT', total: { subTotal: 20, deliveryFee: 5 }, benefits: [{ target: 'CART', sponsorshipValues: sp(30) }] }))
      .toEqual({ subtotal: 20, taxaLoja: 0, descLoja: 30, valorVenda: 0 });
  });
});

describe('funil usa a mesma regra', () => {
  it('#1631 pago no app: total do pedido do ERPOS = 26,49 (antes abatia a entrega grátis e dava 19,50)', () => {
    const r = fu.montarPedidoErpos({ ...p1631, display_id: '1631', customer_name: 'Cliente' }, [{ idx: 1, name: 'Burrito', quantity: 1, unit_price: 31.49, options: [] }], [], new Map());
    expect(r.pago).toBe(true);
    expect(r.order).toMatchObject({ subtotal: 31.49, delivery_fee: 0, discount_amount: 5, total_amount: 26.49 });
  });
});

describe('completarPagamentoIfood', () => {
  it('pago no app: sem pagamento no caixa → tudo em 99 "iFood - online"', () => {
    expect(f.completarPagamentoIfood([], 26.49)).toEqual([{ code: '99', label: 'iFood - online', paid: 26.49, troco: 0 }]);
  });

  it('cobrado pela loja em dinheiro com cupom do iFood: dinheiro + diferença do iFood', () => {
    // venda 42,99; cliente pagou 32,99 (cupom de 10 do iFood) com troco de 50
    const r = f.completarPagamentoIfood([{ code: '01', label: 'Dinheiro', paid: 50, troco: 17.01 }], 42.99);
    expect(r).toEqual([{ code: '01', label: 'Dinheiro', paid: 50, troco: 17.01 }, { code: '99', label: 'iFood - online', paid: 10, troco: 0 }]);
  });

  it('já pago inteiro: não mexe', () => {
    const pg = [{ code: '03', label: 'Crédito', paid: 42.99, troco: 0 }];
    expect(f.completarPagamentoIfood(pg, 42.99)).toEqual(pg);
  });
});

const NOTA = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/ifood-nota.ts')).href;
describe('dadosNotaIfood (contadora 05/10: não presencial + iFood intermediador; homologação 05/10)', () => {
  let n: any;
  beforeAll(async () => { n = await import(/* @vite-ignore */ NOTA); });
  const end = { city: 'Paranaguá', state: 'PR', postalCode: '83203300', streetName: 'R. José Antônio Temporão', streetNumber: '91', complement: 'Clinica', neighborhood: 'Centro Histórico' };
  const merchant = '33d5eb7c-77d9-419d-a664-f1ebb046910f';

  it('entrega com CPF: indPres 4, iFood intermediador, destinatário com endereço (formato autorizado em homologação)', () => {
    const r = n.dadosNotaIfood({ order_type: 'DELIVERY', merchant_id: merchant, customer_name: 'Maria', address: end }, 4118204, '52998224725');
    expect(r.motivoPresencial).toBeNull();
    expect(r.indicadorPresenca).toBe(4);
    expect(r.intermediador).toEqual({ Cnpj: '14380200000121', IdCadIntTran: merchant });
    expect(r.cliente).toEqual({ CpfCnpj: '52998224725', NmCliente: 'Maria', IndicadorIe: 9, Endereco: { Cep: '83203300', Logradouro: 'R. José Antônio Temporão', Numero: '91', Complemento: 'Clinica', Bairro: 'Centro Histórico', Municipio: 'Paranaguá', CodMunicipio: 4118204, Uf: 'PR', CodPais: 1058 } });
  });

  it('entrega sem CPF (#1631): indPres 4 + intermediador + destinatário só com nome e endereço (Brasil NFe monta <idEstrangeiro/>)', () => {
    const r = n.dadosNotaIfood({ order_type: 'DELIVERY', merchant_id: merchant, customer_name: 'Maria', address: end }, 4118204, null);
    expect(r).toMatchObject({ indicadorPresenca: 4, motivoPresencial: null, intermediador: { Cnpj: '14380200000121', IdCadIntTran: merchant } });
    expect(r.cliente.CpfCnpj).toBeUndefined();
    expect(r.cliente).toMatchObject({ NmCliente: 'Maria', IndicadorIe: 9, Endereco: { CodMunicipio: 4118204, Uf: 'PR' } });
  });

  it('retirada/consumo no local: presencial COM intermediador (contadora 05/10; Brasil NFe libera indPres 1)', () => {
    expect(n.dadosNotaIfood({ order_type: 'TAKEOUT', merchant_id: merchant }, null, '52998224725'))
      .toEqual({ indicadorPresenca: 1, intermediador: { Cnpj: '14380200000121', IdCadIntTran: merchant }, cliente: null, motivoPresencial: null });
  });

  it('entrega com CPF mas endereço incompleto: presencial com o motivo', () => {
    const semCod = n.dadosNotaIfood({ order_type: 'DELIVERY', merchant_id: merchant, address: end }, null, '52998224725');
    expect(semCod.motivoPresencial).toMatch(/código do município/);
    expect(semCod).toMatchObject({ indicadorPresenca: 1, intermediador: { Cnpj: '14380200000121' } });
    expect(n.dadosNotaIfood({ order_type: 'DELIVERY', merchant_id: merchant, address: { ...end, streetName: '' } }, 4118204, '52998224725').motivoPresencial).toMatch(/rua/);
  });
});

describe('ratearPartesIfood (dono 05/10: dividir o preço entre comida e bebida)', () => {
  const total = (its: any[], orig: any[]) => Math.round(its.reduce((s, r) => s + (r.item_price + r.opcionais) * (orig.find((o) => o.id === r.id).quantity), 0) * 100) / 100;
  const L = (id: string, extra: any) => ({ id, order_id: 'o1', item_id: null, item_name: '', item_price: 0, quantity: 1, notes: null, opcoes: [], ...extra });

  it('#1631: Coca como complemento com ficha → Coca leva os R$ 6,00 do complemento, Taco fica com 25,49', () => {
    const itens = [
      L('taco', { item_id: 'mi-taco', item_name: 'Taco de Frango Cremoso', item_price: 25.49, opcoes: [{ nome: 'Coca Cola Zero 350 Ml', preco: 6 }] }),
      L('coca', { item_id: 'mi-coca', item_name: 'Coca Cola Zero', notes: 'parte de Coca Cola Zero 350 Ml' }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-taco', 28], ['mi-coca', 7]]));
    const by = Object.fromEntries(r.itens.map((x: any) => [x.id, x]));
    expect(by.coca).toMatchObject({ item_price: 6, opcionais: 0 });
    expect(by.taco).toMatchObject({ item_price: 25.49, opcionais: 0, opcoesMovidas: ['coca cola zero 350 ml'] });
    expect(total(r.itens, itens)).toBe(31.49);
    expect(r.foraDaNota).toEqual([]);
  });

  it('combo pela ficha do produto: divide pelo preço de cardápio (Taco 25 + Coca 6) e mantém o total', () => {
    const itens = [
      L('combo', { item_id: 'mi-taco', item_name: 'Combo Taco + Coca', item_price: 31.49 }),
      L('coca', { item_id: 'mi-coca', item_name: 'Coca', notes: 'parte de Combo Taco + Coca' }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-taco', 25], ['mi-coca', 6]]));
    const by = Object.fromEntries(r.itens.map((x: any) => [x.id, x]));
    expect(by.coca.item_price).toBe(6.09);
    expect(by.combo.item_price).toBe(25.4);
    expect(total(r.itens, itens)).toBe(31.49);
  });

  it('2 combos: quantidades multiplicam e o total fecha', () => {
    const itens = [
      L('combo', { item_id: 'mi-taco', item_name: 'Combo', item_price: 30, quantity: 2 }),
      L('coca', { item_id: 'mi-coca', item_name: 'Coca', notes: 'parte de Combo', quantity: 2 }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-taco', 24], ['mi-coca', 6]]));
    expect(total(r.itens, itens)).toBe(60);
    expect(r.itens.find((x: any) => x.id === 'coca').item_price).toBe(6);
  });

  it('parte sem preço de cardápio: fica fora da nota e o valor continua no produto', () => {
    const itens = [
      L('combo', { item_id: 'mi-taco', item_name: 'Combo', item_price: 30 }),
      L('molho', { item_id: 'mi-molho', item_name: 'Molho', notes: 'parte de Combo' }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-taco', 24]]));
    expect(r.foraDaNota).toEqual(['molho']);
    expect(r.itens).toEqual([{ id: 'combo', item_price: 30, opcionais: 0, opcoesMovidas: [] }]);
  });

  it('revisão P1: balde 6 cervejas R$ 59,99 (produto sem item próprio) → partes arredondam para baixo, nada negativo', () => {
    const itens = [
      L('balde', { item_id: null, item_name: 'Balde 6 Heineken', item_price: 59.99 }),
      L('cerv', { item_id: 'mi-heineken', item_name: 'Heineken', notes: 'parte de Balde 6 Heineken', quantity: 6 }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-heineken', 12]]));
    const by = Object.fromEntries(r.itens.map((x: any) => [x.id, x]));
    expect(by.cerv.item_price).toBe(9.99);
    expect(by.balde.item_price).toBeGreaterThanOrEqual(0);
    expect(total(r.itens, itens)).toBe(59.99);
  });

  it('revisão P1: combo 2 burgers + 2 refri R$ 59,95 não deixa nada negativo e fecha o total', () => {
    const itens = [
      L('combo', { item_id: null, item_name: 'Combo 2+2', item_price: 59.95 }),
      L('burger', { item_id: 'mi-b', item_name: 'Burger', notes: 'parte de Combo 2+2', quantity: 2 }),
      L('coca', { item_id: 'mi-c', item_name: 'Coca', notes: 'parte de Combo 2+2', quantity: 2 }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-b', 25], ['mi-c', 7]]));
    expect(r.itens.every((x: any) => x.item_price >= 0)).toBe(true);
    expect(total(r.itens, itens)).toBe(59.95);
  });

  it('revisão P2: bebida do combo como complemento a R$ 0 ("Escolha sua bebida: Coca Zero") → divide pelo cardápio', () => {
    const itens = [
      L('taco', { item_id: 'mi-taco', item_name: 'Combo Taco', item_price: 31.49, opcoes: [{ nome: 'Coca Zero', preco: 0 }] }),
      L('coca', { item_id: 'mi-coca', item_name: 'Coca Zero', notes: 'parte de Coca Zero' }),
    ];
    const r = f.ratearPartesIfood(itens, new Map([['mi-taco', 25], ['mi-coca', 6]]));
    const by = Object.fromEntries(r.itens.map((x: any) => [x.id, x]));
    expect(by.coca.item_price).toBe(6.09);
    expect(by.taco).toMatchObject({ item_price: 25.4, opcoesMovidas: ['coca zero'] });
    expect(total(r.itens, itens)).toBe(31.49);
  });

  it('pedido sem partes: nada muda', () => {
    const itens = [L('a', { item_id: 'x', item_name: 'Bowl', item_price: 36.99, quantity: 2 })];
    expect(f.ratearPartesIfood(itens, new Map()).itens).toEqual([{ id: 'a', item_price: 36.99, opcionais: 0, opcoesMovidas: [] }]);
  });
});

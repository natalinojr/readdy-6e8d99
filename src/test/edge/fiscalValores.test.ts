// @vitest-environment node
// fiscal-write/valores.ts: preço de cada item na NFC-e (vProd) × desconto × outras despesas.
// Casos reais de produção: nota série 2 nº 3 (delivery com combo, 15/09/2026) e nº 4 (totem com
// opcional pago, 17/09/2026).
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const VALORES_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/fiscal-write/valores.ts')).href;

type Pedido = { id: string; origin_type: string | null; subtotal: number | null; total_amount: number | null; discount_amount: number | null; service_fee_amount: number | null; tip_amount: number | null; delivery_fee: number | null };
type Item = { id: string; order_id: string; item_price: number | null; quantity: number | null; opcionais: number };
type Valores = { unit: number[]; gross: number[]; grossTotal: number; discount: number; extras: number; discPerItem: number[]; expectedTotal: number };
type Mod = { calcularValores: (p: Pedido[], i: Item[]) => Valores; round2: (n: number) => number };

const load = () => import(/* @vite-ignore */ VALORES_PATH) as Promise<Mod>;
const pedido = (p: Partial<Pedido> & { id: string }): Pedido => ({ origin_type: 'cashier', subtotal: null, total_amount: null, discount_amount: 0, service_fee_amount: 0, tip_amount: 0, delivery_fee: 0, ...p });
const fecha = (m: Mod, v: Valores) => m.round2(v.grossTotal - v.discount + v.extras);

describe('fiscal-write › calcularValores', () => {
  it('delivery com combo (item_price 0, valor nas opções) + taxa: nota nº 3', async () => {
    const m = await load();
    const v = m.calcularValores(
      [pedido({ id: 'o', origin_type: 'delivery', subtotal: 95, total_amount: 103.5, delivery_fee: 8.5 })],
      [
        { id: 'combo', order_id: 'o', item_price: 0, quantity: 1, opcionais: 57 },
        { id: 'nachos', order_id: 'o', item_price: 38, quantity: 1, opcionais: 0 },
      ],
    );
    expect(v.unit).toEqual([57, 38]);
    expect(v.grossTotal).toBe(95);
    expect(v.discount).toBe(0);
    expect(v.extras).toBe(8.5); // só a taxa de entrega (onde ela vai = decisão do dono)
    expect(fecha(m, v)).toBe(103.5);
  });

  it('delivery com adicional pago (homologação nº 30)', async () => {
    const m = await load();
    const v = m.calcularValores(
      [pedido({ id: 'o', origin_type: 'delivery', subtotal: 148, total_amount: 155.5, delivery_fee: 7.5 })],
      [
        { id: 'a', order_id: 'o', item_price: 105, quantity: 1, opcionais: 0 },
        { id: 'b', order_id: 'o', item_price: 40, quantity: 1, opcionais: 3 },
      ],
    );
    expect(v.unit).toEqual([105, 43]);
    expect(v.extras).toBe(7.5);
    expect(v.discount).toBe(0);
  });

  it('totem: item_price já inclui o opcional — não soma em dobro (nota nº 4)', async () => {
    const m = await load();
    const v = m.calcularValores(
      [pedido({ id: 'o', origin_type: 'self_service', subtotal: 124.9, total_amount: 124.9 })],
      [
        { id: 'a', order_id: 'o', item_price: 28.9, quantity: 1, opcionais: 3 },
        { id: 'b', order_id: 'o', item_price: 21, quantity: 1, opcionais: 3 },
        { id: 'c', order_id: 'o', item_price: 35, quantity: 1, opcionais: 0 },
        { id: 'd', order_id: 'o', item_price: 40, quantity: 1, opcionais: 0 },
      ],
    );
    expect(v.unit).toEqual([28.9, 21, 35, 40]);
    expect(v.discount).toBe(0);
    expect(v.extras).toBe(0);
  });

  it('grupo misto (delivery + caixa) decide por pedido, com quantidade > 1', async () => {
    const m = await load();
    const v = m.calcularValores(
      [
        pedido({ id: 'd', origin_type: 'delivery', subtotal: 50, total_amount: 55, delivery_fee: 5 }),
        pedido({ id: 'c', origin_type: 'cashier', subtotal: 26, total_amount: 26 }),
      ],
      [
        { id: 'd1', order_id: 'd', item_price: 20, quantity: 2, opcionais: 5 },
        { id: 'c1', order_id: 'c', item_price: 13, quantity: 2, opcionais: 2 },
      ],
    );
    expect(v.unit).toEqual([25, 13]);
    expect(v.gross).toEqual([50, 26]);
    expect(fecha(m, v)).toBe(81);
  });

  it('desconto + taxa de serviço: rateio fecha no centavo', async () => {
    const m = await load();
    const v = m.calcularValores(
      [pedido({ id: 'o', subtotal: 100, total_amount: 100, discount_amount: 10, service_fee_amount: 10 })],
      [
        { id: 'a', order_id: 'o', item_price: 33.33, quantity: 1, opcionais: 0 },
        { id: 'b', order_id: 'o', item_price: 33.33, quantity: 1, opcionais: 0 },
        { id: 'c', order_id: 'o', item_price: 33.34, quantity: 1, opcionais: 0 },
      ],
    );
    expect(m.round2(v.discPerItem.reduce((s, d) => s + d, 0))).toBe(v.discount);
    expect(v.discount).toBe(10);
    expect(v.extras).toBe(10);
    expect(fecha(m, v)).toBe(100);
  });

  it('subtotal ausente: cai na regra do canal', async () => {
    const m = await load();
    const del = m.calcularValores([pedido({ id: 'o', origin_type: 'delivery', total_amount: 30 })], [{ id: 'a', order_id: 'o', item_price: 27, quantity: 1, opcionais: 3 }]);
    expect(del.unit).toEqual([30]);
    const tot = m.calcularValores([pedido({ id: 'o', origin_type: 'self_service', total_amount: 30 })], [{ id: 'a', order_id: 'o', item_price: 30, quantity: 1, opcionais: 3 }]);
    expect(tot.unit).toEqual([30]);
    expect(tot.discount).toBe(0);
  });
});

describe('fiscal-write › rateio de desconto com arredondamento', () => {
  it('desconto de 0,15 em 10 itens de 1,00 fecha exatamente (não distribui a mais)', async () => {
    const m = await load();
    const itens: Item[] = Array.from({ length: 10 }, (_, k) => ({ id: `i${k}`, order_id: 'o', item_price: 1, quantity: 1, opcionais: 0 }));
    const v = m.calcularValores([pedido({ id: 'o', subtotal: 10, total_amount: 9.85, discount_amount: 0.15 })], itens);
    const somaDesc = m.round2(v.discPerItem.reduce((a, b) => a + b, 0));
    expect(somaDesc).toBe(m.round2(v.discount));
    expect(v.discPerItem.every((d) => d >= 0 && d <= 1)).toBe(true);
    expect(fecha(m, v)).toBe(9.85);
  });
});

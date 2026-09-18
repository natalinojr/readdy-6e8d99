// Valores da NFC-e (vProd / vDesc / vOutro por item) — lógica pura, sem banco.
// Usado pela fiscal-write e testado em src/test/edge/fiscalValores.test.ts.
//
// Regra do preço unitário: o valor do item na nota = preço efetivo da unidade (item +
// opcionais pagos; combo com o próprio preço) × quantidade.
// Os canais NÃO gravam `order_items.item_price` do mesmo jeito (conferido em produção, 09/2026):
//   - caixa, garçom/mesa, QR e totem: item_price JÁ inclui os opcionais;
//   - delivery: item_price é só a base; os opcionais (e o valor do combo "monte o seu",
//     que nasce com item_price 0) ficam em order_item_options.additional_price.
// Em vez de confiar no canal, cada pedido é conferido contra `orders.subtotal`: a soma que bate
// decide. Só se nenhuma bater cai no canal (delivery soma opcionais, o resto não).
//
// Taxa de serviço, gorjeta e TAXA DE ENTREGA vão em "outras despesas" (vOutro) do 1º item,
// como sempre foi. Onde a taxa de entrega deve ir (vFrete × vOutro) é decisão pendente do dono.

export interface PedidoValores {
  id: string;
  origin_type: string | null;
  subtotal: number | null;
  total_amount: number | null;
  discount_amount: number | null;
  service_fee_amount: number | null;
  tip_amount: number | null;
  delivery_fee: number | null;
}

export interface ItemValores {
  id: string;
  order_id: string;
  item_price: number | null;
  quantity: number | null;
  /** Σ additional_price das opções do item, por unidade. */
  opcionais: number;
}

export interface ValoresNota {
  unit: number[];
  gross: number[];
  grossTotal: number;
  discount: number;
  extras: number;
  discPerItem: number[];
  expectedTotal: number;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** true = somar os opcionais ao item_price para chegar no preço da unidade. */
export function somarOpcionais(pedido: PedidoValores, itens: ItemValores[]): boolean {
  const temOpcionalPago = itens.some((i) => Math.abs(i.opcionais) >= 0.005);
  if (!temOpcionalPago) return false;
  const base = round2(itens.reduce((s, i) => s + Number(i.item_price ?? 0) * Number(i.quantity ?? 1), 0));
  const comOpcionais = round2(itens.reduce((s, i) => s + (Number(i.item_price ?? 0) + i.opcionais) * Number(i.quantity ?? 1), 0));
  const sub = pedido.subtotal == null ? null : round2(Number(pedido.subtotal));
  if (sub != null) {
    const bateBase = Math.abs(sub - base) < 0.01;
    const bateOpc = Math.abs(sub - comOpcionais) < 0.01;
    if (bateOpc && !bateBase) return true;
    if (bateBase && !bateOpc) return false;
  }
  return pedido.origin_type === 'delivery';
}

export function calcularValores(pedidos: PedidoValores[], itens: ItemValores[]): ValoresNota {
  const expectedTotal = round2(pedidos.reduce((s, o) => s + Number(o.total_amount ?? 0), 0));

  const somaPorPedido = new Map<string, boolean>();
  for (const p of pedidos) somaPorPedido.set(p.id, somarOpcionais(p, itens.filter((i) => i.order_id === p.id)));

  const unit = itens.map((i) => round2(Number(i.item_price ?? 0) + (somaPorPedido.get(i.order_id) ? i.opcionais : 0)));
  const gross = itens.map((i, idx) => round2(unit[idx] * Number(i.quantity ?? 1)));
  const grossTotal = round2(gross.reduce((s, v) => s + v, 0));
  let discount = round2(pedidos.reduce((s, o) => s + Number(o.discount_amount ?? 0), 0));
  let extras = round2(pedidos.reduce((s, o) => s + Number(o.service_fee_amount ?? 0) + Number(o.tip_amount ?? 0) + Number(o.delivery_fee ?? 0), 0));

  // A nota tem que fechar exatamente no valor pago: diferença de arredondamento ou de regra
  // (cupom, cortesia parcial) entra como desconto (ou "outras despesas").
  const diff = round2(grossTotal - discount + extras - expectedTotal);
  if (Math.abs(diff) >= 0.01) {
    if (diff > 0) discount = round2(discount + diff);
    else extras = round2(extras - diff);
  }

  // Desconto rateado proporcionalmente; o último item absorve o arredondamento.
  const discPerItem: number[] = [];
  if (grossTotal > 0 && discount < grossTotal) {
    let distributed = 0;
    for (let i = 0; i < itens.length; i++) {
      let d = i === itens.length - 1 ? round2(discount - distributed) : round2(discount * (gross[i] / grossTotal));
      if (d > gross[i]) d = gross[i];
      if (d < 0) d = 0;
      discPerItem.push(d);
      distributed = round2(distributed + d);
    }
    // Se o último não coube inteiro, redistribui o resto nos anteriores.
    let rest = round2(discount - distributed);
    for (let i = 0; rest > 0 && i < itens.length; i++) {
      const room = round2(gross[i] - discPerItem[i]);
      const add = Math.min(room, rest);
      discPerItem[i] = round2(discPerItem[i] + add);
      rest = round2(rest - add);
    }
    // Arredondamento distribuiu desconto a mais (ex.: 0,15 em 10 itens de 1,00): tira o excesso
    // dos itens com maior desconto, senão a soma não fecha no valor pago e a SEFAZ rejeita.
    const order = discPerItem.map((_, i) => i).sort((a, b) => discPerItem[b] - discPerItem[a]);
    for (let k = 0; rest < 0 && k < order.length; k++) {
      const i = order[k];
      const sub = Math.min(discPerItem[i], -rest);
      discPerItem[i] = round2(discPerItem[i] - sub);
      rest = round2(rest + sub);
    }
  } else {
    for (let i = 0; i < itens.length; i++) discPerItem.push(0);
  }

  return { unit, gross, grossTotal, discount, extras, discPerItem, expectedTotal };
}

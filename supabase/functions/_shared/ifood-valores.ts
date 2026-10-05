// Valor da venda de um pedido do iFood (IFOOD-PEDIDOS-FUNIL.md, peças 5 e 6) — lógica pura, sem banco.
// Usado pelo funil (ifood-shipping/funnel.ts → orders.total_amount) e pela NFC-e (fiscal-write).
// Testado em src/test/edge/ifoodValores.test.ts.
//
// Regra (decisão do dono 27/09, "do jeito certo contabilmente"):
//   venda = itens (preço do iFood) + entrega feita pela LOJA − desconto bancado pela LOJA.
// - Desconto da loja = patrocínio MERCHANT ("Incentivo da Loja") e CHAIN ("Incentivo da Rede"). O que o iFood (IFOOD)
//   ou a indústria (EXTERNAL) bancam não é desconto da loja: volta no repasse.
// - Entrega grátis bancada pela loja (benefício com target DELIVERY_FEE) só abate quando a LOJA entrega (a taxa está na
//   venda). Com entregador do iFood a taxa é do iFood e não entra na venda; a "entrega grátis" que a loja patrocina é
//   custo cobrado pelo iFood no repasse, não desconto da mercadoria (pedido real #1631, Paranaguá, 05/10/2026:
//   itens 31,49, item −5,00 da loja, entrega 6,99 grátis bancada pela loja, entregador iFood → venda 26,49).
// - Taxa de serviço do iFood (additionalFees) é do iFood: não entra.

export interface ValorIfood {
  subtotal: number;
  /** Taxa de entrega que fica com a loja (entrega pela loja); 0 com entregador do iFood, retirada ou no local. */
  taxaLoja: number;
  /** Desconto bancado pela loja/rede. */
  descLoja: number;
  /** Venda: subtotal + taxaLoja − descLoja (nunca negativa). */
  valorVenda: number;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;
const DA_LOJA = new Set(['MERCHANT', 'CHAIN']);

/** `o` = linha de ifood_orders (ou o pedido do iFood): order_type, delivered_by, total, benefits. */
export function valorVendaIfood(o: { order_type?: unknown; delivered_by?: unknown; total?: any; benefits?: unknown }): ValorIfood {
  const t = o.total ?? {};
  const subtotal = r2(num(t.subTotal));
  const entregaLoja = String(o.order_type ?? 'DELIVERY') === 'DELIVERY' && o.delivered_by === 'MERCHANT';
  const taxaLoja = entregaLoja ? r2(num(t.deliveryFee)) : 0;
  let descLoja = 0;
  for (const b of Array.isArray(o.benefits) ? o.benefits : []) {
    if (String(b?.target ?? '') === 'DELIVERY_FEE' && !(taxaLoja > 0)) continue;
    for (const s of Array.isArray(b?.sponsorshipValues) ? b.sponsorshipValues : []) {
      if (DA_LOJA.has(String(s?.name ?? ''))) descLoja += num(s.value);
    }
  }
  descLoja = r2(descLoja);
  return { subtotal, taxaLoja, descLoja, valorVenda: r2(Math.max(0, subtotal + taxaLoja - descLoja)) };
}

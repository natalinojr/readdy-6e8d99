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

export interface PagamentoNota { code: string; label: string; paid: number; troco: number }

/**
 * Pedido do iFood: o que não passou pelo caixa (pago no app, ou o cupom que o iFood banca no cobrado pela loja) vem
 * pelo repasse do iFood → linha tPag 99 "iFood - online" (pedido do dono, 05/10/2026) com a diferença até o valor da
 * venda. Pago a mais (ex.: taxa de serviço do iFood cobrada em dinheiro) fica para o ajuste geral da nota.
 */
export function completarPagamentoIfood(pagamentos: PagamentoNota[], valorVenda: number): PagamentoNota[] {
  const out = pagamentos.map((p) => ({ ...p }));
  const falta = round2(valorVenda - out.reduce((s, p) => s + p.paid - p.troco, 0));
  if (falta >= 0.01) {
    const cur = out.find((p) => p.code === '99' && p.label === 'iFood - online');
    if (cur) cur.paid = round2(cur.paid + falta);
    else out.push({ code: '99', label: 'iFood - online', paid: falta, troco: 0 });
  }
  return out;
}

// ── Partes da "ficha do iFood" na nota (dono, 05/10: dividir o preço entre comida e bebida) ──────────────────
// O funil grava as partes da ficha montada como linhas a R$ 0 com notes "parte de <origem>" (ifood-shipping/funnel.ts):
// <origem> é o nome do produto do iFood (parte da ficha do produto) ou o nome do complemento (parte da ficha do
// complemento, cujo preço está nos opcionais do produto). Na nota cada parte leva a sua fatia do preço — bebida com ST
// sai na própria linha (NCM/CEST/CSOSN da bebida), senão o ICMS dela seria pago de novo no Simples.
// - Parte de complemento: leva o preço do complemento (exato), tirado dos opcionais da linha do produto.
// - Parte do produto: o preço-base do produto é dividido pelo preço de cardápio do ERPOS (produto × partes).
// - Parte sem preço de referência (ou grupo sem nenhum): fica fora da nota (o valor continua no produto).
// O total nunca muda; centavos de arredondamento ficam no produto.

export interface ItemParte {
  id: string; order_id: string; item_id: string | null; item_name: string; item_price: number; quantity: number;
  notes: string | null;
  /** Opcionais da linha: nome e preço por unidade do item. */
  opcoes: { nome: string; preco: number }[];
}
export interface ItemRateado { id: string; item_price: number; opcionais: number; opcoesMovidas: string[] }

const PARTE = /^parte de (.+)$/i;

export function ratearPartesIfood(itens: ItemParte[], precoCardapio: Map<string, number>): { itens: ItemRateado[]; foraDaNota: string[] } {
  const r = new Map<string, ItemRateado>();
  for (const i of itens) r.set(i.id, { id: i.id, item_price: Number(i.item_price ?? 0), opcionais: round2(i.opcoes.reduce((s, o) => s + Number(o.preco ?? 0), 0)), opcoesMovidas: [] });
  const ref = (i: ItemParte) => (i.item_id ? Number(precoCardapio.get(i.item_id) ?? 0) : 0) * Number(i.quantity ?? 1);
  const partes = itens.filter((i) => PARTE.test(String(i.notes ?? '').trim()) && Math.abs(Number(i.item_price ?? 0)) < 0.005);
  const principais = itens.filter((i) => !partes.includes(i));
  const comValor = new Set<string>();

  // Dá `total` às partes pelo peso (preço de cardápio × qtd); devolve o que foi dado (preço unitário em centavos).
  const dar = (ps: ItemParte[], total: number, pesoTotal: number): number => {
    let dado = 0;
    for (const p of ps) {
      const w = ref(p);
      if (!(w > 0) || !(pesoTotal > 0)) continue;
      const q = Math.max(1, Number(p.quantity ?? 1));
      const unit = round2((total * w / pesoTotal) / q);
      if (!(unit > 0)) continue;
      r.get(p.id)!.item_price = unit;
      dado = round2(dado + unit * q);
      comValor.add(p.id);
    }
    return dado;
  };

  const grupos = new Map<string, ItemParte[]>(); // `${order_id}|${origem}`
  for (const p of partes) {
    const k = `${p.order_id}|${String(p.notes).trim().match(PARTE)![1].trim().toLowerCase()}`;
    grupos.set(k, [...(grupos.get(k) ?? []), p]);
  }
  for (const [k, ps] of grupos) {
    const [orderId, origem] = [k.slice(0, k.indexOf('|')), k.slice(k.indexOf('|') + 1)];
    const doPedido = principais.filter((i) => i.order_id === orderId);
    // 1) Complemento: linhas do produto que têm a opção <origem>.
    const comOpcao = doPedido.filter((i) => i.opcoes.some((o) => o.nome.trim().toLowerCase() === origem));
    if (comOpcao.length) {
      let total = 0;
      for (const l of comOpcao) {
        const preco = round2(l.opcoes.filter((o) => o.nome.trim().toLowerCase() === origem).reduce((s, o) => s + Number(o.preco ?? 0), 0));
        total = round2(total + preco * Number(l.quantity ?? 1));
      }
      const peso = ps.reduce((s, p) => s + ref(p), 0);
      const pesoUsado = peso > 0 ? peso : ps.length; // sem preço de cardápio: divide igual entre as partes
      const dado = peso > 0 ? dar(ps, total, peso) : (() => {
        let d = 0;
        for (const p of ps) { const q = Math.max(1, Number(p.quantity ?? 1)); const unit = round2(total / pesoUsado / q); if (unit > 0) { r.get(p.id)!.item_price = unit; d = round2(d + unit * q); comValor.add(p.id); } }
        return d;
      })();
      if (dado > 0) {
        // Tira dos opcionais das linhas do produto, na proporção do que cada uma tinha da opção.
        let falta = dado;
        comOpcao.forEach((l, idx) => {
          const q = Math.max(1, Number(l.quantity ?? 1));
          const preco = round2(l.opcoes.filter((o) => o.nome.trim().toLowerCase() === origem).reduce((s, o) => s + Number(o.preco ?? 0), 0));
          const tirar = idx === comOpcao.length - 1 ? falta : Math.min(falta, round2(preco * q * dado / total));
          const rl = r.get(l.id)!;
          rl.opcionais = round2(rl.opcionais - tirar / q);
          if (rl.opcionais < 0) { rl.item_price = round2(rl.item_price + rl.opcionais); rl.opcionais = 0; }
          rl.opcoesMovidas.push(origem);
          falta = round2(falta - tirar);
        });
      }
      continue;
    }
    // 2) Produto: linhas principais com o nome <origem> (item_name) — o preço-base é dividido pelo cardápio.
    const prods = doPedido.filter((i) => String(i.item_name ?? '').trim().toLowerCase() === origem);
    if (!prods.length) continue;
    const base = round2(prods.reduce((s, l) => s + Number(l.item_price ?? 0) * Number(l.quantity ?? 1), 0));
    const pesoProd = prods.reduce((s, l) => s + ref(l), 0);
    const pesoPartes = ps.reduce((s, p) => s + ref(p), 0);
    if (!(base > 0) || !(pesoPartes > 0)) continue;
    // Produto sem preço de cardápio próprio (ficha só de partes): tudo vai para as partes.
    const dado = dar(ps, base, pesoProd + pesoPartes);
    let falta = dado;
    prods.forEach((l, idx) => {
      const q = Math.max(1, Number(l.quantity ?? 1));
      const lb = Number(l.item_price ?? 0) * q;
      const tirar = idx === prods.length - 1 ? falta : round2(dado * lb / base);
      r.get(l.id)!.item_price = round2((lb - tirar) / q);
      falta = round2(falta - tirar);
    });
  }
  const fora = partes.filter((p) => !comValor.has(p.id)).map((p) => p.id);
  return { itens: itens.filter((i) => !fora.includes(i.id)).map((i) => r.get(i.id)!), foraDaNota: fora };
}

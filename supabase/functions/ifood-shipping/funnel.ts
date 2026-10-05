// Funil do iFood (IFOOD-PEDIDOS-FUNIL.md, etapa 3): monta o pedido do ERPOS a partir do pedido do iFood.
// Funções puras (testadas em src/test/edge/ifoodFunnel.test.ts); a gravação fica no index.ts.
//
// Regras:
// - Preço = o do iFood (a venda de fato), nunca o do cardápio do ERPOS.
// - Item/complemento só liga ao cardápio por vínculo confirmado (ifood_item_links); sem vínculo entra com o nome do
//   iFood, sem baixa de estoque. Complemento ligado a opção → order_item_options.option_id (baixa pela ficha da opção);
//   ligado a item/combo → vira uma linha de item (baixa pela ficha do item); "sem_estoque" → só texto.
// - Plataforma: entrega pelo motoboy da loja = 'propria' (entra no Gestor de Entregas e no acerto); entregador do iFood
//   = 'ifood' (fora do quadro); retirada/consumo no local = 'retirada'. A origem iFood fica em orders.ifood_order_id.
// - Ficha do iFood montada (ifood_ficha_linhas, 2026-10-05) vale mais que a ligação simples: o produto entra com o
//   1º item da ficha com quantidade 1 (se houver); os outros itens viram linhas a R$ 0 ("parte de <produto>", aparecem
//   na cozinha e baixam pela ficha do item); os insumos (embalagem, sachê…) e item com quantidade quebrada saem em
//   `insumos` — o index.ts baixa ligado ao pedido quando ele entra na cozinha e estorna se o iFood cancelar.
// - Repasse (pago): tudo online, ou cobrado pelo entregador do iFood — o dinheiro vem pelo repasse do iFood e o pedido
//   fica fora das somas de venda (orders.ifood_repasse). Cobrado pela loja (motoboy, balcão, mesa) = venda da loja, não
//   pago até o caixa receber; total = o que o cliente paga (já com o desconto que o iFood banca).

import { valorVendaIfood } from '../_shared/ifood-valores.ts';

export interface IfoodLink {
  level: 'item' | 'complemento'; name_key: string; group_key: string; ifood_id: string | null; external_code: string | null;
  target_kind: 'item' | 'combo' | 'option' | 'sem_estoque'; menu_item_id: string | null; combo_id: string | null; option_id: string | null;
}
export interface MenuInfo { skip_kds: boolean; station_id: string | null; name?: string }
export interface FichaLinha {
  level: 'item' | 'complemento'; name_key: string; group_key: string; kind: 'item' | 'insumo';
  menu_item_id: string | null; ingredient_id: string | null; quantity: number; unit: string | null; ordem?: number;
}
/** Baixa solta ligada ao pedido: insumo (na unidade da ficha) ou item do cardápio com quantidade quebrada. */
export interface InsumoSolto { ingredient_id: string | null; menu_item_id: string | null; quantity: number; unit: string | null; origem: string }

/** Igual a public.fn_ifood_norm: minúsculo, sem espaço sobrando. */
export const normIfood = (s: unknown) => String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/** Casa o produto do iFood com o vínculo: código externo → id do catálogo → nome (+ grupo no complemento). */
export function acharVinculo(links: IfoodLink[], level: 'item' | 'complemento', p: { name?: unknown; groupName?: unknown; id?: unknown; externalCode?: unknown }): IfoodLink | null {
  const doNivel = links.filter((l) => l.level === level);
  const ext = String(p.externalCode ?? '').trim();
  const id = String(p.id ?? '').trim();
  const nk = normIfood(p.name);
  const gk = level === 'item' ? '' : normIfood(p.groupName);
  return (ext && doNivel.find((l) => l.external_code === ext))
    || (id && doNivel.find((l) => l.ifood_id === id))
    || doNivel.find((l) => l.name_key === nk && l.group_key === gk)
    || null;
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const r2 = (v: number) => Math.round(v * 100) / 100;
const brl = (v: number) => 'R$ ' + v.toFixed(2).replace('.', ',');
const inteiro = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;

/** Linhas da ficha do produto (pela chave do vínculo, se achou um; senão pelo nome/grupo do iFood). */
function fichaDo(fichas: FichaLinha[], level: 'item' | 'complemento', lk: IfoodLink | null, p: { name?: unknown; groupName?: unknown }): FichaLinha[] {
  const nk = lk?.name_key ?? normIfood(p.name);
  const gk = lk?.group_key ?? (level === 'item' ? '' : normIfood(p.groupName));
  return fichas.filter((f) => f.level === level && f.name_key === nk && f.group_key === gk)
    .sort((a, b) => num(a.ordem) - num(b.ordem));
}

export interface ItemErpos {
  item_id: string | null; combo_id: string | null; item_name: string; item_price: number; quantity: number;
  station_id: string | null; skip_kds: boolean; notes: string | null;
  options: { option_id: string | null; option_name: string; group_name: string; additional_price: number }[];
  observations: { text: string; is_checked: boolean }[];
}

export interface PedidoErpos {
  order: Record<string, unknown>;
  items: ItemErpos[];
  pago: boolean; // = ifood_repasse
  paymentLabel: string;
  semVinculo: string[];
  insumos: InsumoSolto[];
}

function endereco(a: any): string | null {
  if (!a) return null;
  const partes = [
    [a.streetName, a.streetNumber].filter(Boolean).join(', '),
    a.complement, a.neighborhood, a.reference ? `Ref.: ${a.reference}` : null,
  ].filter((x) => x && String(x).trim());
  return partes.length ? partes.join(' - ') : (a.formattedAddress ?? null);
}

/** Pedido do iFood (linha de ifood_orders com raw/total/payments) + itens (ifood_order_items) → pedido do ERPOS. */
export function montarPedidoErpos(o: any, itens: any[], links: IfoodLink[], menu: Map<string, MenuInfo>, fichas: FichaLinha[] = []): PedidoErpos {
  const tipo = String(o.order_type ?? 'DELIVERY');
  const loja = o.delivered_by === 'MERCHANT';
  const entrega = tipo === 'DELIVERY';
  const plataforma = !entrega ? 'retirada' : loja ? 'propria' : 'ifood';
  const semVinculo: string[] = [];
  const insumos: InsumoSolto[] = [];

  // Itens da ficha viram linhas a R$ 0 (quantidade inteira) ou baixa solta (quantidade quebrada); insumos = baixa solta.
  const linhaParte = (menuItemId: string, q: number, origem: string): ItemErpos | null => {
    if (!inteiro(q)) { insumos.push({ ingredient_id: null, menu_item_id: menuItemId, quantity: q, unit: null, origem }); return null; }
    const mi = menu.get(menuItemId);
    return {
      item_id: menuItemId, combo_id: null, item_name: mi?.name ?? 'Item do cardápio', item_price: 0, quantity: Math.round(q),
      station_id: mi?.station_id ?? null, skip_kds: mi?.skip_kds ?? false, notes: `parte de ${origem}`, options: [], observations: [],
    };
  };
  const insumosDa = (ficha: FichaLinha[], vezes: number, origem: string) => {
    for (const f of ficha) {
      if (f.kind === 'insumo' && f.ingredient_id) insumos.push({ ingredient_id: f.ingredient_id, menu_item_id: null, quantity: num(f.quantity) * vezes, unit: f.unit ?? null, origem });
    }
  };

  const items: ItemErpos[] = [];
  for (const it of [...itens].sort((a, b) => num(a.idx) - num(b.idx))) {
    const qtd = Math.max(1, Math.round(num(it.quantity) || 1));
    const lk = acharVinculo(links, 'item', { name: it.name, id: it.catalog_item_id, externalCode: it.external_code });
    const ficha = fichaDo(fichas, 'item', lk, it);
    if (!lk && !ficha.length) semVinculo.push(String(it.name));
    const nomeIfood = String(it.name ?? 'Item do iFood');
    // Com ficha: o produto vira o 1º item dela com quantidade 1; os demais itens e os insumos vêm abaixo.
    const fichaItens = ficha.filter((f) => f.kind === 'item' && f.menu_item_id);
    const doProduto = ficha.length ? fichaItens.find((f) => num(f.quantity) === 1) ?? null : null;
    const itemId = ficha.length ? doProduto?.menu_item_id ?? null : lk?.target_kind === 'item' ? lk.menu_item_id : null;
    const info = itemId ? menu.get(itemId) : undefined;
    const principal: ItemErpos = {
      item_id: itemId, combo_id: !ficha.length && lk?.target_kind === 'combo' ? lk.combo_id : null,
      item_name: nomeIfood, item_price: r2(num(it.unit_price)), quantity: qtd,
      station_id: info?.station_id ?? null, skip_kds: info?.skip_kds ?? false,
      notes: null, options: [], observations: it.observations ? [{ text: String(it.observations), is_checked: false }] : [],
    };
    const extras: ItemErpos[] = [];
    for (const f of fichaItens) {
      if (f === doProduto) continue;
      const parte = linhaParte(f.menu_item_id as string, num(f.quantity) * qtd, nomeIfood);
      if (parte) extras.push(parte);
    }
    insumosDa(ficha, qtd, nomeIfood);
    // Produto sem item próprio cujas partes não passam pela cozinha (ex.: só bebidas): também não passa.
    if (ficha.length && !itemId && extras.length && extras.every((e) => e.skip_kds)) principal.skip_kds = true;
    const complementos: any[] = [];
    for (const op of Array.isArray(it.options) ? it.options : []) {
      complementos.push(op);
      for (const cu of Array.isArray(op.customizations) ? op.customizations : []) complementos.push({ ...cu, _de: op.name });
    }
    for (const op of complementos) {
      const opQtd = Math.max(1, num(op.quantity) || 1);
      const precoUnit = num(op.price) || num(op.unitPrice) * opQtd; // por unidade do item principal
      const clk = acharVinculo(links, 'complemento', op);
      const cficha = fichaDo(fichas, 'complemento', clk, op);
      if (!clk && !cficha.length) semVinculo.push(`${op.name} (${op.groupName ?? 'complemento'})`);
      if (cficha.length) {
        // Complemento com ficha: fica como texto no produto (com o preço); itens viram linhas a R$ 0, insumos baixa solta.
        for (const f of cficha) {
          if (f.kind !== 'item' || !f.menu_item_id) continue;
          const parte = linhaParte(f.menu_item_id, num(f.quantity) * qtd * opQtd, String(op.name));
          if (parte) extras.push(parte);
        }
        insumosDa(cficha, qtd * opQtd, String(op.name));
      } else if (clk && (clk.target_kind === 'item' || clk.target_kind === 'combo')) {
        const cid = clk.target_kind === 'item' ? clk.menu_item_id : null;
        const ci = cid ? menu.get(cid) : undefined;
        extras.push({
          item_id: cid, combo_id: clk.target_kind === 'combo' ? clk.combo_id : null,
          item_name: String(op.name), item_price: r2(num(op.unitPrice) || precoUnit / opQtd), quantity: Math.round(qtd * opQtd),
          station_id: ci?.station_id ?? null, skip_kds: ci?.skip_kds ?? false,
          notes: `Complemento de ${principal.item_name}`, options: [], observations: [],
        });
        continue;
      }
      // "2x Bacon": uma linha por unidade (a baixa de estoque é por linha de opção × quantidade do item).
      const n = Math.max(1, Math.round(opQtd));
      for (let k = 0; k < n; k++) {
        principal.options.push({
          option_id: !cficha.length && clk?.target_kind === 'option' ? clk.option_id : null,
          option_name: String(op.name),
          group_name: String(op.groupName ?? op._de ?? ''),
          additional_price: r2(precoUnit / n),
        });
      }
    }
    items.push(principal, ...extras);
  }

  // Venda = itens + entrega da loja − desconto bancado pela loja (regra única com a NFC-e: _shared/ifood-valores.ts).
  const { subtotal, taxaLoja: taxa, descLoja } = valorVendaIfood(o);
  const metodos: any[] = Array.isArray(o.payments?.methods) ? o.payments.methods : [];
  const offline = metodos.filter((m) => m.type === 'OFFLINE');
  // Só o entregador do iFood cobra por conta do iFood; retirada/mesa/motoboy da loja = a loja recebe.
  const pago = offline.length === 0 || o.delivered_by === 'IFOOD';
  // Repasse: venda pelo preço do iFood menos o desconto da loja. Cobrado pela loja: o que o cliente paga (soma das
  // formas de pagamento) — o cupom que o iFood banca vem no repasse, não na gaveta.
  const pagoCliente = r2(metodos.reduce((a, m) => a + num(m.value), 0));
  const total = pago || pagoCliente <= 0 ? r2(Math.max(0, subtotal + taxa - descLoja)) : pagoCliente;
  const descIfood = pago ? 0 : r2(Math.max(0, subtotal + taxa - descLoja - total));
  const PAG: Record<string, string> = { CREDIT: 'Crédito', DEBIT: 'Débito', CASH: 'Dinheiro', PIX: 'Pix', MEAL_VOUCHER: 'Vale-refeição', FOOD_VOUCHER: 'Vale-alimentação' };
  const cobrar = offline.map((m) => `${PAG[m.method] ?? m.method} ${brl(num(m.value))}${m.cash?.changeFor ? ` (troco para ${brl(num(m.cash.changeFor))})` : ''}`).join(' + ');
  const paymentLabel = pago ? 'iFood (pago no app)' : `Cobrar na entrega: ${cobrar}`;

  const display = o.display_id ? `#${o.display_id}` : '';
  const comoSai = tipo === 'TAKEOUT' ? 'Retirada no balcão' : tipo === 'DINE_IN' ? 'Consumo no local' : tipo === 'INDOOR' ? 'No salão' : loja ? 'Entrega pela loja' : 'Entregador iFood';
  const agendado = o.order_timing === 'SCHEDULED' && o.schedule?.deliveryDateTimeStart
    ? `AGENDADO para ${new Date(o.schedule.deliveryDateTimeStart).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : null;
  const notas = [
    `Pedido iFood ${display} · ${comoSai}`,
    agendado,
    o.pickup_code ? `Código de coleta: ${o.pickup_code}` : null,
    pago ? 'Pago no app do iFood' : `COBRAR NA ENTREGA: ${cobrar}`,
    descIfood > 0 ? `Desconto bancado pelo iFood: ${brl(descIfood)} (vem no repasse)` : null,
    o.delivery_observations ? `Obs. da entrega: ${o.delivery_observations}` : null,
    o.extra_info ? String(o.extra_info) : null,
    semVinculo.length ? `Sem vínculo com o cardápio (sem baixa de estoque): ${semVinculo.join(', ')}` : null,
  ].filter(Boolean).join(' | ');

  const nome = String(o.customer_name ?? 'Cliente iFood').trim() || 'Cliente iFood';
  const ender = entrega ? endereco(o.address) : null;
  return {
    order: {
      origin_type: 'delivery', destination_type: 'delivery',
      destination_name: `iFood ${display} ${nome}`.replace(/\s+/g, ' ').trim() + ` - ${ender ?? comoSai}`,
      destination_phone: null, delivery_address: ender, delivery_fee: taxa, delivery_platform: plataforma,
      discount_amount: r2(descLoja + descIfood), service_fee_amount: pago ? 0 : r2(Math.max(0, total - (subtotal + taxa - descLoja))), subtotal, total_amount: total,
      customer_cpf: o.customer_document && /^\d{11}(\d{3})?$/.test(String(o.customer_document).replace(/\D/g, '')) ? String(o.customer_document).replace(/\D/g, '') : null,
      notes: notas,
    },
    items, pago, paymentLabel, semVinculo, insumos,
  };
}

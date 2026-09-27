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
// - Pago: tudo online, ou cobrado pelo entregador do iFood. Cobrar na entrega com motoboy da loja = não pago.

export interface IfoodLink {
  level: 'item' | 'complemento'; name_key: string; group_key: string; ifood_id: string | null; external_code: string | null;
  target_kind: 'item' | 'combo' | 'option' | 'sem_estoque'; menu_item_id: string | null; combo_id: string | null; option_id: string | null;
}
export interface MenuInfo { skip_kds: boolean; station_id: string | null }

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

export interface ItemErpos {
  item_id: string | null; combo_id: string | null; item_name: string; item_price: number; quantity: number;
  station_id: string | null; skip_kds: boolean; notes: string | null;
  options: { option_id: string | null; option_name: string; group_name: string; additional_price: number }[];
  observations: { text: string; is_checked: boolean }[];
}

export interface PedidoErpos {
  order: Record<string, unknown>;
  items: ItemErpos[];
  pago: boolean;
  paymentLabel: string;
  semVinculo: string[];
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
export function montarPedidoErpos(o: any, itens: any[], links: IfoodLink[], menu: Map<string, MenuInfo>): PedidoErpos {
  const tipo = String(o.order_type ?? 'DELIVERY');
  const loja = o.delivered_by === 'MERCHANT';
  const entrega = tipo === 'DELIVERY';
  const plataforma = !entrega ? 'retirada' : loja ? 'propria' : 'ifood';
  const semVinculo: string[] = [];

  const items: ItemErpos[] = [];
  for (const it of [...itens].sort((a, b) => num(a.idx) - num(b.idx))) {
    const qtd = Math.max(1, Math.round(num(it.quantity) || 1));
    const lk = acharVinculo(links, 'item', { name: it.name, id: it.catalog_item_id, externalCode: it.external_code });
    if (!lk) semVinculo.push(String(it.name));
    const itemId = lk?.target_kind === 'item' ? lk.menu_item_id : null;
    const info = itemId ? menu.get(itemId) : undefined;
    const principal: ItemErpos = {
      item_id: itemId, combo_id: lk?.target_kind === 'combo' ? lk.combo_id : null,
      item_name: String(it.name ?? 'Item do iFood'), item_price: r2(num(it.unit_price)), quantity: qtd,
      station_id: info?.station_id ?? null, skip_kds: info?.skip_kds ?? false,
      notes: null, options: [], observations: it.observations ? [{ text: String(it.observations), is_checked: false }] : [],
    };
    const extras: ItemErpos[] = [];
    const complementos: any[] = [];
    for (const op of Array.isArray(it.options) ? it.options : []) {
      complementos.push(op);
      for (const cu of Array.isArray(op.customizations) ? op.customizations : []) complementos.push({ ...cu, _de: op.name });
    }
    for (const op of complementos) {
      const opQtd = Math.max(1, num(op.quantity) || 1);
      const precoUnit = num(op.price) || num(op.unitPrice) * opQtd; // por unidade do item principal
      const clk = acharVinculo(links, 'complemento', op);
      if (!clk) semVinculo.push(`${op.name} (${op.groupName ?? 'complemento'})`);
      if (clk && (clk.target_kind === 'item' || clk.target_kind === 'combo')) {
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
      principal.options.push({
        option_id: clk?.target_kind === 'option' ? clk.option_id : null,
        option_name: opQtd > 1 ? `${opQtd}x ${op.name}` : String(op.name),
        group_name: String(op.groupName ?? op._de ?? ''),
        additional_price: r2(precoUnit),
      });
    }
    items.push(principal, ...extras);
  }

  const t = o.total ?? {};
  const subtotal = r2(num(t.subTotal));
  const taxa = entrega && loja ? r2(num(t.deliveryFee)) : 0;
  // Desconto que a LOJA paga (cupom da loja); o que o iFood banca não é desconto da loja.
  const descLoja = r2((Array.isArray(o.benefits) ? o.benefits : []).reduce((s: number, b: any) =>
    s + (Array.isArray(b.sponsorshipValues) ? b.sponsorshipValues : []).filter((x: any) => x.name === 'MERCHANT').reduce((a: number, x: any) => a + num(x.value), 0), 0));
  const total = r2(Math.max(0, subtotal + taxa - descLoja));

  const metodos: any[] = Array.isArray(o.payments?.methods) ? o.payments.methods : [];
  const offline = metodos.filter((m) => m.type === 'OFFLINE');
  const pago = offline.length === 0 || !loja;
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
      discount_amount: descLoja, service_fee_amount: 0, subtotal, total_amount: total,
      customer_cpf: o.customer_document && /^\d{11}(\d{3})?$/.test(String(o.customer_document).replace(/\D/g, '')) ? String(o.customer_document).replace(/\D/g, '') : null,
      notes: notas,
    },
    items, pago, paymentLabel, semVinculo,
  };
}

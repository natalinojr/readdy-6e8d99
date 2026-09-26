// Regras puras do iFood Entrega (sem Supabase nem rede) — testadas em src/test/edge/ifoodShipping.test.ts.
// A loja de teste do iFood não gera eventos de entrega (FAQ do portal), então o consumo dos eventos é
// validado com os exemplos da documentação.
// deno-lint-ignore-file no-explicit-any

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
export const cut = (s: unknown, n: number) => String(s ?? '').trim().slice(0, n);
export const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

export const ACTIVE = ['requested', 'allocated', 'going_to_origin', 'arrived_origin', 'in_transit', 'cancel_requested'];
export const TERMINAL = ['concluded', 'cancelled', 'failed'];

/** "41999998888" / "5541999998888" → { areaCode: '41', number: '999998888' } (null se não der). */
export function splitPhone(raw: unknown) {
  let d = onlyDigits(raw);
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 10 || d.length === 11) return { areaCode: d.slice(0, 2), number: d.slice(2) };
  return null;
}

/** "Pagamento: Dinheiro | Troco para R$ 50,00" (orders.notes) → sugestão de pagamento na entrega. */
export function paymentFromNotes(notes: string | null, isPaid: boolean, total: number) {
  if (isPaid) return { kind: 'paid' as const };
  const n = norm(notes ?? '');
  const m = /pagamento:\s*([^|]+)/.exec(n)?.[1]?.trim() ?? '';
  if (/pix|online|pago/.test(m)) return { kind: 'paid' as const };
  if (/dinheiro/.test(m)) {
    const t = /troco para r?\$?\s*([\d.,]+)/.exec(n)?.[1];
    const changeFor = t ? Number(t.replace(/\./g, '').replace(',', '.')) : null;
    return { kind: 'CASH' as const, changeFor: changeFor && changeFor > total ? changeFor : null };
  }
  if (/debito/.test(m)) return { kind: 'DEBIT' as const };
  if (/credito|cartao/.test(m)) return { kind: 'CREDIT' as const };
  return { kind: 'unknown' as const, label: m || null };
}

/**
 * Itens no formato do iFood. A soma tem que bater com (total − taxa de entrega) — senão o iFood recusa
 * (PaymentTotalInvalid). Com desconto/voucher ou arredondamento que não bate, manda uma linha só com o
 * valor do pedido (o entregador não confere itens).
 */
export function buildItems(order: { id: string; number: unknown; total_amount: unknown; delivery_fee: unknown },
  rows: { id: string; item_name: unknown; item_price: unknown; quantity: unknown }[]) {
  const itemsTotal = round2(Number(order.total_amount ?? 0) - Number(order.delivery_fee ?? 0));
  const items = rows.map((i) => {
    const qty = Math.max(1, Math.round(Number(i.quantity ?? 1)));
    const unit = round2(Number(i.item_price ?? 0));
    const price = round2(unit * qty);
    return { id: i.id, name: cut(i.item_name || 'Item', 50), quantity: qty, unitPrice: unit, price, optionsPrice: 0, totalPrice: price };
  });
  const soma = round2(items.reduce((s, i) => s + i.totalPrice, 0));
  if (items.length > 0 && Math.abs(soma - itemsTotal) < 0.005) return { items, itemsTotal };
  const numero = String(order.number ?? '').replace(/\D/g, '').slice(-4) || String(order.number ?? '');
  return { items: [{ id: order.id, name: cut(`Pedido #${numero}`, 50), quantity: 1, unitPrice: itemsTotal, price: itemsTotal, optionsPrice: 0, totalPrice: itemsTotal }], itemsTotal };
}

/**
 * Endereço do texto do pedido (orders.delivery_address), quando o cliente não tem endereço cadastrado.
 * Formato do delivery: "Rua X 123 (compl) - Bairro - Cidade (Ref: ...)".
 */
export function parseEnderecoPedido(txt: string | null | undefined) {
  let t = String(txt ?? '').trim();
  const ref = /\(Ref:\s*([^)]*)\)/i.exec(t)?.[1]?.trim() ?? '';
  t = t.replace(/\(Ref:[^)]*\)/i, '').trim();
  const partes = t.split(/\s+-\s+/).map((x) => x.trim()).filter(Boolean);
  let rua = partes[0] ?? '';
  const complement = /\(([^)]*)\)/.exec(rua)?.[1]?.trim() ?? '';
  rua = rua.replace(/\([^)]*\)/, '').replace(/,\s*$/, '').trim();
  const m = /^(.*?)[,\s]+(\d+[A-Za-z]?|s\/?n)$/i.exec(rua);
  return {
    street: (m ? m[1] : rua).replace(/,\s*$/, '').trim(),
    number: m ? m[2] : '',
    complement,
    neighborhood: partes[1] ?? '',
    city: partes[2] ?? '',
    reference: ref,
  };
}

// ── Eventos ──────────────────────────────────────────────────────────────────
export const CODE_ALIAS: Record<string, string> = {
  PLC: 'PLACED', CFM: 'CONFIRMED', CAN: 'CANCELLED', CON: 'CONCLUDED', DSP: 'DISPATCHED',
  ADR: 'ASSIGN_DRIVER', GTO: 'GOING_TO_ORIGIN', AAO: 'ARRIVED_AT_ORIGIN', AAD: 'ARRIVED_AT_DESTINATION',
  CAR: 'CANCELLATION_REQUESTED', CARF: 'CANCELLATION_REQUEST_FAILED',
  RDS: 'REQUEST_DRIVER_SUCCESS', RDF: 'REQUEST_DRIVER_FAILED',
};
export const eventName = (e: any) => String(e?.fullCode || CODE_ALIAS[String(e?.code ?? '')] || e?.code || '').toUpperCase();

export function metaCode(meta: any, keys: string[]) {
  if (!meta || typeof meta !== 'object') return null;
  for (const k of keys) if (meta[k] != null && String(meta[k]).trim()) return String(meta[k]).trim();
  return null;
}
export function pickDriver(meta: any) {
  if (!meta || typeof meta !== 'object') return null;
  const name = meta.workerName ?? meta.driverName ?? null;
  const phone = meta.workerPhone ?? meta.driverPhone ?? null;
  const vehicle = meta.workerVehicleType ?? meta.vehicleType ?? null;
  const photo = meta.workerPhotoUrl ?? null;
  return name || phone ? { name, phone, vehicle, photo } : null;
}

export type OrderSignal = 'a_caminho_loja' | 'coletou' | 'entregou' | 'liberar';
export interface EventPlan {
  upd: Record<string, unknown>;          // campos de ifood_shipping_orders
  order?: OrderSignal;                   // o que fazer no pedido do ERPOS
  note?: string;                         // "problema" registrado no pedido (ao liberar)
  confirm?: boolean;                     // PLACED: confirmar o pedido no iFood
}

/**
 * Decide o efeito de um evento numa entrega. `s` = linha atual de ifood_shipping_orders.
 * Entrega encerrada não é reaberta: evento atrasado/fora de ordem só entra na linha do tempo.
 * Evento que "volta" o status (ex.: ASSIGN_DRIVER depois de DISPATCHED) não rebaixa a entrega.
 */
export function planEvent(s: { status: string; timeline?: Record<string, string> | null; driver?: any }, e: any): EventPlan {
  const name = eventName(e);
  const at = e?.createdAt ? new Date(e.createdAt).toISOString() : new Date().toISOString();
  const meta = e?.metadata ?? null;
  const tl = { ...(s.timeline ?? {}) };
  if (!tl[name]) tl[name] = at;
  const upd: Record<string, unknown> = { last_event: name, timeline: tl };
  const pickup = metaCode(meta, ['pickupCode', 'PICKUP_CODE', 'pickup_code']);
  if (pickup) upd.pickup_code = pickup;
  const driver = pickDriver(meta);
  if (driver) upd.driver = { ...(s.driver ?? {}), ...Object.fromEntries(Object.entries(driver).filter(([, v]) => v != null)) };

  if (TERMINAL.includes(s.status)) return { upd };

  const rank: Record<string, number> = { requested: 0, allocated: 1, going_to_origin: 2, arrived_origin: 3, in_transit: 4 };
  const advance = (to: string) => { if ((rank[to] ?? -1) > (rank[s.status] ?? -1)) upd.status = to; };
  const clearAddr = () => { upd.address_change = null; upd.address_change_deadline = null; };

  switch (name) {
    case 'PLACED':
      return { upd, confirm: true };
    case 'REQUEST_DRIVER_SUCCESS': case 'ASSIGN_DRIVER':
      advance('allocated');
      return { upd, order: (rank[s.status] ?? 0) < rank.in_transit ? 'a_caminho_loja' : undefined };
    case 'GOING_TO_ORIGIN':
      advance('going_to_origin');
      return { upd, order: (rank[s.status] ?? 0) < rank.in_transit ? 'a_caminho_loja' : undefined };
    case 'ARRIVED_AT_ORIGIN':
      advance('arrived_origin');
      return { upd };
    case 'DISPATCHED': case 'DELIVERY_IN_TRANSIT': case 'COLLECTED': case 'ARRIVED_AT_DESTINATION':
      advance('in_transit');
      return { upd, order: 'coletou' };
    case 'CONCLUDED': case 'DELIVERY_CONCLUDED':
      upd.status = 'concluded'; clearAddr();
      return { upd, order: 'entregou' };
    case 'REQUEST_DRIVER_FAILED': case 'CANCELLED': case 'DELIVERY_CANCELLED': {
      upd.status = name === 'REQUEST_DRIVER_FAILED' ? 'failed' : 'cancelled';
      const motivo = metaCode(meta, ['CANCEL_CODE_DESCRIPTION', 'CANCELLATION_REASON', 'reason', 'REASON', 'cancellationReason', 'description', 'message']);
      if (motivo) upd.cancel_reason = cut(motivo, 300);
      clearAddr();
      const nota = (name === 'REQUEST_DRIVER_FAILED' ? 'iFood não conseguiu um entregador' : 'Entrega iFood cancelada')
        + (motivo ? `: ${cut(motivo, 200)}` : '') + ' — chame outro entregador.';
      return { upd, order: 'liberar', note: nota };
    }
    case 'CANCELLATION_REQUESTED':
      upd.status = 'cancel_requested';
      return { upd };
    case 'CANCELLATION_REQUEST_FAILED':
      upd.status = tl.DISPATCHED || tl.DELIVERY_IN_TRANSIT || tl.COLLECTED ? 'in_transit'
        : tl.ARRIVED_AT_ORIGIN ? 'arrived_origin'
        : tl.GOING_TO_ORIGIN ? 'going_to_origin'
        : (tl.ASSIGN_DRIVER || tl.REQUEST_DRIVER_SUCCESS) ? 'allocated' : 'requested';
      upd.error = 'O iFood recusou o cancelamento (o entregador provavelmente já saiu).';
      return { upd };
    case 'DELIVERY_DROP_CODE_REQUESTED': {
      const code = metaCode(meta, ['CODE', 'code', 'dropCode']);
      if (code) upd.drop_code = code;
      return { upd };
    }
    case 'DELIVERY_ADDRESS_CHANGE_REQUESTED':
      upd.address_change = meta ?? {};
      upd.address_change_deadline = new Date(new Date(at).getTime() + 15 * 60_000).toISOString();
      return { upd };
    case 'DELIVERY_ADDRESS_CHANGE_ACCEPTED': case 'DELIVERY_ADDRESS_CHANGE_DENIED': case 'DELIVERY_ADDRESS_CHANGE_USER_CONFIRMED':
      clearAddr();
      return { upd };
    default:
      return { upd };
  }
}

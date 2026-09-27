// Delivery Fase 4 — pedido do iFood entregue pelo MOTOBOY DA LOJA (order_type DELIVERY + delivered_by MERCHANT)
// dentro do funil do ERPOS. Usado pela delivery-write (Gestor de Entregas) e pela motoboy-signal (portal).
//
// O pedido continua em ifood_orders (não vira `orders`: o iFood já entra no financeiro pela conciliação).
// Nas listas ele aparece com id "ifood:<uuid>" e fonte 'ifood'. "Entregue" = entregue_at preenchido.
// Só entra no funil com o modo "operar" (ifood_pdv_config.order_mode — decisão do dono 2026-09-27: só vale se cada
// passo avisar o iFood): "coletou" despacha no iFood e "entregou" valida o código de entrega (o iFood conclui sozinho).
// Modo só leitura: nada muda — a loja segue o iFood pelo app dele.
// deno-lint-ignore-file no-explicit-any

export const IFOOD_PREFIXO = "ifood:";
export const ehIdIfood = (id: string) => id.startsWith(IFOOD_PREFIXO);
export const rowIdIfood = (id: string) => id.slice(IFOOD_PREFIXO.length);

const RECENTE_MS = 3 * 60 * 60 * 1000; // entregues nas últimas 3 h continuam visíveis (igual aos pedidos da loja)
const JANELA_MS = 24 * 60 * 60 * 1000; // pedido do iFood mais velho que isso não entra no funil

export const COLUNAS_IFOOD = "id, tenant_id, display_id, status, order_type, delivered_by, ordered_at, created_at, customer_name, address, total, payments, delivery_observations, pickup_code, motoboy_driver_id, motoboy_status, motoboy_note, motoboy_problems, motoboy_timeline, motoboy_updated_at, delivery_notes, out_for_delivery_at, entregue_at, delivery_code_ok, delivery_code_fails, delivery_lat, delivery_lng, delivery_fee, concluded_at, timeline";

/** Status do iFood → fase do funil do ERPOS (mesmos valores de orders.status). */
export function statusFunilIfood(o: any): "new" | "preparing" | "ready" | "delivered" {
  if (o.entregue_at) return "delivered";
  switch (o.status) {
    case "preparing": return "preparing";
    case "ready": case "dispatched": return "ready";
    case "concluded": return "delivered";
    default: return "new"; // placed / confirmed
  }
}

export function enderecoIfood(a: any): string {
  if (!a) return "";
  const partes = [a.formattedAddress ?? [a.streetName, a.streetNumber].filter(Boolean).join(", "), a.neighborhood, a.complement]
    .map((x) => String(x ?? "").trim()).filter(Boolean);
  const ref = String(a.reference ?? "").trim();
  return partes.join(" - ") + (ref ? ` (ref.: ${ref})` : "");
}

const moeda = (v: number) => "R$ " + v.toFixed(2).replace(".", ",");
const NOME_METODO: Record<string, string> = { CASH: "Dinheiro", CREDIT: "Crédito", DEBIT: "Débito", MEAL_VOUCHER: "Vale-refeição", FOOD_VOUCHER: "Vale-alimentação", PIX: "Pix" };

/** Pago no app ou cobrar na entrega (o que o motoboy precisa saber). */
export function pagamentoIfood(p: any): { pago: boolean; texto: string } {
  const pendente = Number(p?.pending ?? 0);
  if (!p || pendente <= 0) return { pago: true, texto: "Pago no app do iFood — não cobrar" };
  const off = (Array.isArray(p.methods) ? p.methods : []).filter((m: any) => m?.type === "OFFLINE" || m?.prepaid === false);
  const desc = off.map((m: any) => {
    const troco = Number(m?.cash?.changeFor ?? 0);
    return `${NOME_METODO[m?.method] ?? m?.method ?? "Cobrar"} ${moeda(Number(m?.value ?? 0))}` +
      (troco > Number(m?.value ?? 0) ? ` (troco para ${moeda(troco)})` : "") + (m?.card?.brand ? ` · ${m.card.brand}` : "");
  }).join(" + ");
  return { pago: false, texto: `Cobrar na entrega: ${desc || moeda(pendente)}` };
}

/** Pedidos do iFood com entrega da loja que entram no funil agora (abertos + entregues recentes). */
export async function listarIfoodEntrega(admin: any, tenantId: string): Promise<any[]> {
  const desde = new Date(Date.now() - JANELA_MS).toISOString();
  const { data } = await admin.from("ifood_orders").select(COLUNAS_IFOOD)
    .eq("tenant_id", tenantId).eq("order_type", "DELIVERY").eq("delivered_by", "MERCHANT")
    .neq("status", "cancelled").gte("ordered_at", desde).order("ordered_at", { ascending: true });
  const agora = Date.now();
  return ((data ?? []) as any[]).filter((o) => {
    if (statusFunilIfood(o) !== "delivered") return true;
    const ref = o.entregue_at ?? o.concluded_at ?? o.motoboy_updated_at;
    return !!ref && agora - new Date(ref).getTime() <= RECENTE_MS;
  });
}

/** Linha do iFood no formato das listas (Gestor e portal usam os mesmos nomes de campo dos pedidos da loja). */
export function cartaoIfood(o: any, operar: boolean) {
  const pg = pagamentoIfood(o.payments);
  return {
    id: IFOOD_PREFIXO + o.id,
    fonte: "ifood",
    number: String(o.display_id ?? ""),
    cliente: String(o.customer_name ?? "Cliente iFood").trim() || "Cliente iFood",
    telefone: "",
    endereco: enderecoIfood(o.address),
    total: Number(o.total?.orderAmount ?? 0),
    taxa: Number(o.delivery_fee ?? o.total?.deliveryFee ?? 0),
    status: statusFunilIfood(o),
    motoboy_status: o.motoboy_status ?? null,
    motoboy_note: o.motoboy_note ?? null,
    problemas: Array.isArray(o.motoboy_problems) ? o.motoboy_problems : [],
    delivery_notes: Array.isArray(o.delivery_notes) ? o.delivery_notes : [],
    driver_id: o.motoboy_driver_id ?? null,
    created_at: o.ordered_at ?? o.created_at,
    motoboy_updated_at: o.motoboy_updated_at ?? null,
    out_for_delivery_at: o.out_for_delivery_at ?? null,
    delivery_sla_min: null,
    motoboy_timeline: (o.motoboy_timeline && typeof o.motoboy_timeline === "object") ? o.motoboy_timeline : {},
    pago: pg.pago,
    pagamento: pg.texto,
    lat: o.delivery_lat != null ? Number(o.delivery_lat) : null,
    lng: o.delivery_lng != null ? Number(o.delivery_lng) : null,
    ifood_status: o.status,
    ifood_operar: operar,
    ifood_codigo_ok: !!o.delivery_code_ok,
  };
}

export async function modoOperar(admin: any, tenantId: string): Promise<boolean> {
  const { data } = await admin.from("ifood_pdv_config").select("order_mode, order_enabled").eq("tenant_id", tenantId).maybeSingle();
  return !!data?.order_enabled && data?.order_mode === "operate";
}

/** Fases da cozinha a partir dos eventos do iFood (mesmo formato do pedido da loja). */
export function cozinhaIfood(o: any) {
  const tl = (o.timeline ?? {}) as Record<string, string>;
  return {
    status: statusFunilIfood(o),
    novo_at: o.ordered_at ?? tl.PLACED ?? o.created_at ?? null,
    preparo_at: tl.PREPARATION_STARTED ?? tl.SEPARATION_STARTED ?? null,
    pronto_at: tl.READY_TO_PICKUP ?? tl.SEPARATION_ENDED ?? null,
  };
}

export async function itensIfood(admin: any, rowId: string) {
  const { data } = await admin.from("ifood_order_items").select("name, quantity, total_price, observations, options").eq("order_row_id", rowId).order("idx");
  return ((data ?? []) as any[]).map((i) => ({
    nome: String(i.name ?? "") + ((Array.isArray(i.options) && i.options.length)
      ? " (" + i.options.map((op: any) => `${op.quantity && op.quantity > 1 ? op.quantity + "x " : ""}${op.name}`).join(", ") + ")" : ""),
    quantidade: Number(i.quantity ?? 1),
    qtd: Number(i.quantity ?? 1),
    preco: Number(i.total_price ?? 0),
    obs: i.observations ?? null,
  }));
}

export async function carregarIfood(admin: any, rowId: string, tenantId?: string | null) {
  let q = admin.from("ifood_orders").select(COLUNAS_IFOOD).eq("id", rowId);
  if (tenantId) q = q.eq("tenant_id", tenantId);
  const { data } = await q.maybeSingle();
  if (!data || data.order_type !== "DELIVERY" || data.delivered_by !== "MERCHANT") return null;
  return data;
}

/** Ação no iFood pela edge ifood-shipping (dona da conexão/token), chamada interna. */
async function acaoNoIfood(tenantId: string, rowId: string, op: string, extra: Record<string, unknown> = {}): Promise<{ ok: boolean; data: any; erro?: string }> {
  const url = (Deno.env.get("SUPABASE_URL") ?? "") + "/functions/v1/ifood-shipping";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const key = Deno.env.get("FISCAL_INTERNAL_KEY") ?? "";
  if (!key) return { ok: false, data: null, erro: "Integração com o iFood indisponível agora." };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${anon}`, apikey: anon, "x-internal-key": key },
      body: JSON.stringify({ action: "order_action", tenant_id: tenantId, order_row_id: rowId, op, ...extra }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || d?.success === false || d?.error) return { ok: false, data: d, erro: String(d?.error ?? d?.message ?? `iFood respondeu ${r.status}`) };
    return { ok: true, data: d };
  } catch (e) {
    return { ok: false, data: null, erro: "Sem resposta do iFood: " + String((e as Error)?.message ?? e) };
  }
}

const SEQ = ["a_caminho_loja", "coletou", "entregou"];
const MAX_FALHAS_CODIGO = 5;

/**
 * Sinal do funil num pedido do iFood. `porLoja` = Gestor (ignora a trava de dono). Fora do modo "operar" nada anda.
 * "entregou" exige o código de entrega (motoboy E Gestor): é a prova de entrega que conclui no iFood e libera o acerto.
 * Retorna { ok, error?, message? } no mesmo estilo das duas edges.
 */
export async function sinalIfood(admin: any, p: {
  rowId: string; tenantId?: string | null; signal: string; driverId?: string | null; porLoja: boolean;
  motivo?: string | null; code?: string | null; autor?: string | null;
}): Promise<{ ok: boolean; error?: string; message?: string }> {
  const o = await carregarIfood(admin, p.rowId, p.tenantId);
  if (!o) return { ok: false, error: "not_found" };
  if (o.status === "cancelled") return { ok: false, error: "cancelado", message: "Este pedido foi cancelado no iFood." };
  // Loja voltou para "só leitura": o funil do ERPOS não mexe mais em pedido do iFood (nem por link antigo).
  const operar = await modoOperar(admin, o.tenant_id);
  if (!operar) return { ok: false, error: "so_leitura", message: "Os pedidos do iFood desta loja estão em modo só leitura." };
  const signal = p.signal;
  const driverId = (p.driverId ?? "").trim() || null;

  if (!p.porLoja) {
    if (!driverId) return { ok: false, error: "driver_id obrigatorio" };
    const { data: drv } = await admin.from("delivery_drivers").select("id, is_active").eq("id", driverId).eq("tenant_id", o.tenant_id).maybeSingle();
    if (!drv || drv.is_active === false) return { ok: false, error: "driver_invalido" };
    if (o.motoboy_driver_id && o.motoboy_driver_id !== driverId) return { ok: false, error: "assumido_por_outro" };
  }

  const nowIso = new Date().toISOString();

  // Avisa o iFood ANTES de gravar: se o iFood recusar, o funil não anda (as duas pontas ficam iguais).
  if (signal === "coletou" && ["placed", "confirmed", "preparing", "ready"].includes(o.status)) {
    const r = await acaoNoIfood(o.tenant_id, o.id, "dispatch");
    if (!r.ok) return { ok: false, error: "ifood", message: `O iFood não aceitou o despacho: ${r.erro}` };
  }
  let codigoOk = !!o.delivery_code_ok;
  if (signal === "entregou" && !codigoOk && o.status !== "concluded") {
    // Chute do código (portal é público): 5 erros travam o pedido até o Gestor liberar o entregador.
    if (Number(o.delivery_code_fails ?? 0) >= MAX_FALHAS_CODIGO) {
      return { ok: false, error: "codigo_bloqueado", message: "Código errado muitas vezes. A loja precisa liberar o entregador no Gestor de Entregas." };
    }
    const code = String(p.code ?? "").replace(/\s/g, "");
    if (!code) return { ok: false, error: "codigo_obrigatorio", message: "Peça ao cliente o código de entrega (aparece no app do iFood)." };
    const r = await acaoNoIfood(o.tenant_id, o.id, "verify_code", { code });
    if (!r.ok) return { ok: false, error: "ifood", message: `Não deu para validar o código: ${r.erro}` };
    if (r.data?.valid !== true) {
      const falhas = Number(o.delivery_code_fails ?? 0) + 1;
      await admin.from("ifood_orders").update({ delivery_code_fails: falhas, updated_at: nowIso }).eq("id", o.id);
      const resta = MAX_FALHAS_CODIGO - falhas;
      return { ok: false, error: "codigo_invalido", message: resta > 0
        ? `Código de entrega inválido. Confira com o cliente (${resta} tentativa${resta > 1 ? "s" : ""}).`
        : "Código errado muitas vezes. A loja precisa liberar o entregador no Gestor de Entregas." };
    }
    codigoOk = true;
  }

  const tl = { ...((o.motoboy_timeline as Record<string, string>) ?? {}) };
  if (!tl[signal]) tl[signal] = nowIso;
  const motivo = signal === "problema" ? String(p.motivo ?? "").slice(0, 500) : null;
  const upd: Record<string, unknown> = {
    motoboy_status: signal, motoboy_note: motivo, motoboy_updated_at: nowIso, motoboy_timeline: tl, updated_at: nowIso,
  };
  if (signal === "problema") {
    const probs = Array.isArray(o.motoboy_problems) ? o.motoboy_problems : [];
    upd.motoboy_problems = [...probs, { at: nowIso, text: motivo ?? "", by: p.porLoja ? "loja" : "motoboy", autor: p.autor ?? null }];
  }
  if (driverId && !p.porLoja) upd.motoboy_driver_id = driverId;
  if (signal === "coletou") upd.out_for_delivery_at = nowIso;
  if (signal === "entregou") {
    upd.entregue_at = nowIso;
    upd.out_for_delivery_at = o.out_for_delivery_at ?? nowIso;
    if (codigoOk) upd.delivery_code_ok = true;
  }
  const { error } = await admin.from("ifood_orders").update(upd).eq("id", o.id);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Gestor: libera o entregador e volta UMA fase (mesma regra dos pedidos da loja). Não desfaz nada no iFood. */
export async function liberarIfood(admin: any, rowId: string, tenantId: string): Promise<{ ok: boolean; error?: string }> {
  const o = await carregarIfood(admin, rowId, tenantId);
  if (!o) return { ok: false, error: "Pedido não encontrado nesta loja." };
  const atual = (o.motoboy_status as string | null) ?? null;
  const novo = atual === "problema" ? "a_caminho_loja" : (() => { const i = SEQ.indexOf(atual ?? ""); return i <= 0 ? null : SEQ[i - 1]; })();
  const oldTl = (o.motoboy_timeline as Record<string, string>) ?? {};
  const novoIdx = novo ? SEQ.indexOf(novo) : -1;
  const novaTl: Record<string, string> = {};
  SEQ.forEach((ph, i) => { if (i <= novoIdx && oldTl[ph]) novaTl[ph] = oldTl[ph]; });
  const nowIso = new Date().toISOString();
  const upd: Record<string, unknown> = {
    motoboy_driver_id: null, motoboy_status: novo, motoboy_note: null, motoboy_timeline: novaTl,
    motoboy_updated_at: nowIso, updated_at: nowIso, entregue_at: null, delivery_code_fails: 0,
  };
  if (novo !== "coletou") upd.out_for_delivery_at = null;
  const { error } = await admin.from("ifood_orders").update(upd).eq("id", o.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function notaIfood(admin: any, rowId: string, tenantId: string, kind: string, text: string, autor: string | null) {
  const o = await carregarIfood(admin, rowId, tenantId);
  if (!o) return { ok: false, error: "Pedido não encontrado nesta loja." };
  const nowIso = new Date().toISOString();
  const notas = Array.isArray(o.delivery_notes) ? o.delivery_notes : [];
  const { error } = await admin.from("ifood_orders").update({ delivery_notes: [...notas, { at: nowIso, kind, text, autor }], updated_at: nowIso }).eq("id", o.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

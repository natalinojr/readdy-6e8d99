// ── online-payments ──────────────────────────────────────────────────────────
// Pagamento pelo celular do cliente via Pix dinâmico do Mercado Pago. Atende MESA
// numerada (conta da sessão, várias pessoas), FILA POR SENHA (QR universal, sem
// mesa — a conta é do participante) e DELIVERY (pedido único, autenticado pelo
// client_request_id gerado no aparelho do cliente). Uma função só, três "portas":
//   • cliente (sem JWT; participant_id + access_token, ou order_id + order_token no delivery):
//       public_status, get_bill, create_pix, get_pix_status, cancel_pix
//   • staff (JWT + membership em user_tenants):
//       get_config, save_config (admin/manager), confirm_manual (admin/manager)
//   • webhook do Mercado Pago:  POST ?webhook=1&tenant_id=<uuid>
// A ÚNICA coisa que marca um pedido como pago é a resposta do provedor
// (webhook ou reconciliação GET /v1/payments/{id}) — nunca o clique do cliente.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";

type Admin = ReturnType<typeof createClient>;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
const log = (level: string, scope: string, msg: string, extra?: unknown) =>
  console.log(JSON.stringify({ level, scope: `online-payments/${scope}`, msg, ...(extra ? { extra } : {}) }));

const MP_API = "https://api.mercadopago.com";
const PIX_EXPIRATION_MIN = 15;
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
function isValidCpfCnpj(d: string): boolean {
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false;
    const calc = (len: number) => { let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * (len + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r; };
    return calc(9) === Number(d[9]) && calc(10) === Number(d[10]);
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false;
    const calc = (len: number) => { const w = len === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < len; i++) s += Number(d[i]) * w[i]; const r = s % 11; return r < 2 ? 0 : 11 - r; };
    return calc(12) === Number(d[12]) && calc(13) === Number(d[13]);
  }
  return false;
}

// ── Mercado Pago client ──────────────────────────────────────────────────────
async function mpFetch(token: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${MP_API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = text ? JSON.parse(text) : {}; } catch { body = { raw: text }; }
  return { ok: res.ok, status: res.status, body };
}

// MP exige "yyyy-MM-dd'T'HH:mm:ss.SSSXXX" com offset; Brasil = -03:00 (sem horário de verão).
function mpDate(d: Date): string {
  const local = new Date(d.getTime() - 3 * 60 * 60 * 1000);
  return local.toISOString().replace("Z", "-03:00");
}

async function hmacSha256Hex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Config da loja ───────────────────────────────────────────────────────────
async function loadConfig(admin: Admin, tenantId: string) {
  const { data } = await admin.from("fin_payment_provider_config")
    .select("id, access_token, public_key, webhook_secret, is_active, account_id, account_label, last_test_at, updated_at")
    .eq("tenant_id", tenantId).eq("provider", "mercadopago").maybeSingle();
  return data as {
    id: string; access_token: string | null; public_key: string | null; webhook_secret: string | null; is_active: boolean;
    account_id: string | null; account_label: string | null; last_test_at: string | null; updated_at: string;
  } | null;
}
const isEnabled = (cfg: Awaited<ReturnType<typeof loadConfig>>) => Boolean(cfg && cfg.is_active && cfg.access_token);

// ── Auth ─────────────────────────────────────────────────────────────────────
// `allowClosed`: a sessão da mesa fecha sozinha (trigger fn_check_table_session_auto_close)
// no instante em que o último pedido vira pago — inclusive por causa DESTE pagamento. Consultar
// o status/comprovante do próprio Pix tem que continuar funcionando depois disso; só criar
// cobrança nova exige mesa aberta.
async function requireParticipant(admin: Admin, body: Record<string, unknown>, opts: { allowClosed?: boolean } = {}) {
  const participantId = String(body.participant_id ?? "");
  const accessToken = String(body.access_token ?? "");
  if (!participantId || !accessToken) return { error: json({ error: "participant_id e access_token são obrigatórios" }, 400) };
  const { data: p } = await admin.from("table_session_participants")
    .select("id, name, tenant_id, table_session_id, access_token, deleted_at")
    .eq("id", participantId).maybeSingle();
  if (!p || p.deleted_at || String(p.access_token) !== accessToken) return { error: json({ error: "Identificação inválida" }, 403) };

  // Fila por senha (QR universal): não existe mesa — a conta é do participante.
  if (!p.table_session_id) {
    return { error: null, participant: p, session: null, tenantId: p.tenant_id as string, tableSessionId: null as string | null, tableId: null as string | null, orderId: null as string | null };
  }

  const { data: sess } = await admin.from("table_sessions").select("id, status, table_id, session_id, tenant_id")
    .eq("id", p.table_session_id).maybeSingle();
  if (!sess) return { error: json({ error: "mesa_encerrada", message: "Esta mesa já foi encerrada" }, 409) };
  if (sess.status !== "open" && !opts.allowClosed) return { error: json({ error: "mesa_encerrada", message: "Esta mesa já foi encerrada" }, 409) };
  return { error: null, participant: p, session: sess, tenantId: sess.tenant_id as string, tableSessionId: sess.id as string | null, tableId: sess.table_id as string | null, orderId: null as string | null };
}

// Cliente do DELIVERY: não tem senha nem mesa. A prova de posse do pedido é o
// `client_request_id` que o próprio app gerou ao criar o pedido (uuid que fica no
// aparelho) — sem ele ninguém consulta nem cobra o pedido de outra pessoa.
async function requireDeliveryOrder(admin: Admin, body: Record<string, unknown>) {
  const orderId = String(body.order_id ?? "");
  const token = String(body.order_token ?? "");
  if (!orderId || !token) return { error: json({ error: "order_id e order_token são obrigatórios" }, 400) };
  const { data: o } = await admin.from("orders").select("id, tenant_id, number, client_request_id, origin_type, status, destination_name")
    .eq("id", orderId).maybeSingle();
  if (!o || String(o.client_request_id ?? "") !== token || o.origin_type !== "delivery") return { error: json({ error: "Pedido não encontrado" }, 403) };
  if (o.status === "cancelled") return { error: json({ error: "pedido_cancelado", message: "Este pedido foi cancelado" }, 409) };
  const customerName = String(o.destination_name ?? "").split(/\s+[-–—]\s+/)[0].trim() || "Cliente";
  return {
    error: null, participant: null, session: null, tenantId: o.tenant_id as string,
    tableSessionId: null as string | null, tableId: null as string | null,
    orderId: o.id as string, orderNumber: (o.number as string) ?? null, customerName,
  };
}

// Quem está pagando: senha/mesa (participant_id + access_token) ou delivery (order_id + order_token).
function resolveCustomer(admin: Admin, body: Record<string, unknown>, opts: { allowClosed?: boolean } = {}) {
  return body.order_token ? requireDeliveryOrder(admin, body) : requireParticipant(admin, body, opts);
}

// Filtra fin_pix_payments pelo dono: participante (mesa/senha) ou pedido (delivery).
// deno-lint-ignore no-explicit-any
const ownerFilter = (q: any, ctx: { participant: { id: string } | null; orderId: string | null }) =>
  ctx.participant ? q.eq("participant_id", ctx.participant.id) : q.eq("order_id", ctx.orderId);

async function requireMember(req: Request, admin: Admin, tenantId: string) {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return { error: json({ error: "Não autenticado" }, 401) };
  const { data: u, error } = await admin.auth.getUser(token);
  if (error || !u?.user) return { error: json({ error: "Sessão inválida" }, 401) };
  const { data: m } = await admin.from("user_tenants").select("role").eq("user_id", u.user.id).eq("tenant_id", tenantId).limit(1).maybeSingle();
  if (!m) return { error: json({ error: "Sem acesso a esta loja" }, 403) };
  return { error: null, userId: u.user.id, role: String(m.role ?? "") };
}
const isManager = (role: string) => role === "admin" || role === "manager";

// ── Conta da mesa ────────────────────────────────────────────────────────────
type BillOrder = {
  id: string; number: string | null; participant_id: string | null; participant_name: string | null;
  status: string; total_amount: number; paid_amount: number; remaining: number; is_paid: boolean; created_at: string;
  paid_at: string | null; locked: boolean; items: { name: string; quantity: number; price: number }[];
};

// Conta da MESA (todos os pedidos da sessão) ou da SENHA (só os do participante,
// quando o QR universal opera em fila e não há mesa nenhuma).
// Escopos: MESA (todos os pedidos da sessão), SENHA (só os do participante) ou
// PEDIDO ÚNICO (delivery — `orderId`).
async function loadBill(admin: Admin, scopeRef: { tableSessionId: string | null; participantId: string | null; orderId?: string | null }, viewerParticipantId: string | null): Promise<BillOrder[]> {
  const { tableSessionId } = scopeRef;
  const base = admin.from("orders")
    .select("id, number, participant_id, status, total_amount, is_paid, is_draft, is_training, created_at, paid_at, order_items(item_name, quantity, item_price, status)");
  const { data: orders } = await (tableSessionId
    ? base.eq("table_session_id", tableSessionId)
    : scopeRef.orderId
      ? base.eq("id", scopeRef.orderId)
      : base.eq("participant_id", scopeRef.participantId ?? "")
  ).neq("status", "cancelled").order("created_at", { ascending: true });
  // Rascunho fica de fora da conta de MESA/SENHA (carrinho nao enviado). No escopo de
  // PEDIDO UNICO (delivery) o rascunho e' justamente o pedido "segurado" esperando o Pix.
  const rows = (orders ?? []).filter((o: Record<string, unknown>) => !o.is_training && (scopeRef.orderId ? true : !o.is_draft));
  if (rows.length === 0) return [];
  const ids = rows.map((o: { id: string }) => o.id);

  const pendingPixQuery = admin.from("fin_pix_payments").select("id, participant_id, allocation, expires_at")
    .eq("status", "pending").gt("expires_at", new Date().toISOString());
  const [{ data: pays }, { data: parts }, { data: pendingPix }] = await Promise.all([
    admin.from("payments").select("order_id, amount").in("order_id", ids).eq("is_refunded", false),
    tableSessionId
      ? admin.from("table_session_participants").select("id, name").eq("table_session_id", tableSessionId)
      : scopeRef.participantId
        ? admin.from("table_session_participants").select("id, name").eq("id", scopeRef.participantId)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    tableSessionId
      ? pendingPixQuery.eq("table_session_id", tableSessionId)
      : scopeRef.orderId
        ? pendingPixQuery.eq("order_id", scopeRef.orderId)
        : pendingPixQuery.eq("participant_id", scopeRef.participantId ?? ""),
  ]);
  const paidBy: Record<string, number> = {};
  for (const p of pays ?? []) paidBy[p.order_id] = (paidBy[p.order_id] ?? 0) + Number(p.amount ?? 0);
  const nameOf: Record<string, string> = {};
  for (const p of parts ?? []) nameOf[p.id] = p.name;
  // Pedidos com Pix pendente de OUTRO participante ficam travados (evita duas pessoas pagando o mesmo).
  const locked = new Set<string>();
  for (const px of pendingPix ?? []) {
    if (viewerParticipantId && px.participant_id === viewerParticipantId) continue;
    for (const a of (px.allocation as { order_id: string }[] | null) ?? []) locked.add(a.order_id);
  }

  return rows.map((o: Record<string, unknown>) => {
    const total = round2(Number(o.total_amount ?? 0));
    const paid = round2(paidBy[o.id as string] ?? 0);
    const remaining = round2(Math.max(0, total - paid));
    const items = ((o.order_items as Record<string, unknown>[]) ?? [])
      .filter((it) => it.status !== "cancelled")
      .map((it) => ({ name: String(it.item_name ?? ""), quantity: Number(it.quantity ?? 1), price: Number(it.item_price ?? 0) }));
    return {
      id: o.id as string, number: (o.number as string) ?? null, participant_id: (o.participant_id as string) ?? null,
      participant_name: o.participant_id ? (nameOf[o.participant_id as string] ?? null) : null,
      status: String(o.status), total_amount: total, paid_amount: paid, remaining,
      is_paid: Boolean(o.is_paid) || (total > 0 && remaining <= 0), created_at: String(o.created_at),
      paid_at: (o.paid_at as string) ?? null,
      locked: locked.has(o.id as string), items,
    };
  });
}

const pixPublic = (px: Record<string, unknown>) => ({
  id: px.id, status: px.status, amount: Number(px.amount ?? 0), scope: px.scope,
  qr_code: px.emv_payload, qr_code_base64: px.qr_code_base64, ticket_url: px.ticket_url,
  expires_at: px.expires_at, confirmed_at: px.confirmed_at, created_at: px.created_at,
  allocation: px.allocation, error: px.error ?? null,
});

// ── Liquidação: o que o caixa faria ao receber o dinheiro ────────────────────
// Idempotente: reivindica a linha com update condicional (pending → confirmed);
// quem perder a corrida (webhook × polling) sai sem fazer nada.
async function settlePix(admin: Admin, pixId: string, providerPayload: unknown, note?: string) {
  const now = new Date().toISOString();
  const { data: claimed } = await admin.from("fin_pix_payments")
    .update({ status: "confirmed", confirmed_at: now, updated_at: now, raw_provider: providerPayload ?? null, ...(note ? { error: note } : {}) })
    .eq("id", pixId).eq("status", "pending").select("*").maybeSingle();
  if (!claimed) { log("INFO", "settle", "já liquidado ou não pendente", { pixId }); return { already: true }; }

  const tenantId = claimed.tenant_id as string;
  const allocation = ((claimed.allocation as { order_id: string; amount: number }[]) ?? []).filter((a) => Number(a.amount) > 0);
  const errors: string[] = [];

  const { data: pms } = await admin.from("payment_methods").select("id, name, days_to_receive, fee_percentage")
    .eq("tenant_id", tenantId).eq("type", "pix").eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true });
  const pm = (pms ?? []).find((m: { name: string }) => /^pix$/i.test(String(m.name).trim())) ?? (pms ?? [])[0];
  if (!pm) {
    await admin.from("fin_pix_payments").update({ error: "Loja sem forma de pagamento do tipo PIX ativa — pagamento recebido mas não lançado", settled_at: now }).eq("id", pixId);
    log("ERROR", "settle", "sem payment_method pix", { pixId, tenantId });
    return { already: false, errors: ["no_pix_method"] };
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const internalKey = Deno.env.get("FISCAL_INTERNAL_KEY") ?? "";
  const { data: fs } = await admin.from("fiscal_settings").select("enabled").eq("tenant_id", tenantId).maybeSingle();
  const fiscalOn = Boolean(fs?.enabled) && Boolean(internalKey);
  const groupId = allocation.length > 1 ? pixId : null;
  const todayBR = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const paymentIds: string[] = [];
  const fiscalJobs: Promise<unknown>[] = [];

  for (const a of allocation) {
    const amount = round2(Number(a.amount));
    const { data: paymentId, error: payErr } = await admin.rpc("fn_record_payment_bypass", {
      p_order_id: a.order_id, p_tenant_id: tenantId, p_cash_register_id: null, p_payment_method_id: pm.id,
      p_amount: amount, p_change_amount: 0, p_operator_name: "Cliente • Pix online", p_origin_type: "qr_online", p_payment_group_id: groupId,
    });
    if (payErr || !paymentId) {
      errors.push(`pedido ${a.order_id.slice(0, 8)}: ${payErr?.message ?? "caixa não encontrado (fn_record_payment_bypass devolveu null)"}`);
      continue;
    }
    paymentIds.push(String(paymentId));

    // Fica pago quando Σ pagamentos ≥ total (mesma regra do order-write › record_payment)
    const { data: o } = await admin.from("orders").select("id, number, total_amount, is_paid, origin_type, status").eq("id", a.order_id).maybeSingle();
    const { data: allPays } = await admin.from("payments").select("amount").eq("order_id", a.order_id).eq("is_refunded", false);
    const totalPaid = (allPays ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount), 0);
    const total = Number(o?.total_amount ?? 0);
    if (o && !o.is_paid && (total === 0 || totalPaid >= total - 0.005)) {
      await admin.from("orders").update({ is_paid: true, paid_at: now, paid_by_pdv: "qr_online", updated_at: now }).eq("id", a.order_id);
      // Delivery "PIX pelo app" ficou como rascunho esperando este momento: libera pra cozinha
      // (status new + tickets + WhatsApp) antes de qualquer outra coisa.
      if (o.origin_type === "delivery" && o.status === "draft") {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/delivery-write`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey, "x-internal-key": internalKey },
            body: JSON.stringify({ action: "release_held_order", tenant_id: tenantId, order_id: a.order_id }),
          });
          log(r.ok ? "INFO" : "WARN", "release", "pedido de delivery liberado pra cozinha", { order: a.order_id, http: r.status, body: (await r.text().catch(() => "")).slice(0, 200) });
        } catch (e) { log("WARN", "release", "release_held_order falhou", { order: a.order_id, error: String(e) }); }
      }
      if (fiscalOn) {
        fiscalJobs.push(fetch(`${supabaseUrl}/functions/v1/fiscal-write`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey, "x-internal-key": internalKey },
          // Vários pedidos no mesmo Pix = pagamento em grupo = UMA NFC-e (a fiscal-write espera o grupo completar).
          body: JSON.stringify(groupId
            ? { action: "emit", tenant_id: tenantId, source_type: "payment_group", source_id: groupId, group_size: allocation.length, trigger: "online_payment" }
            : { action: "emit", tenant_id: tenantId, source_type: "order", source_id: a.order_id, trigger: "online_payment" }),
        }).then(async (r) => log("INFO", "fiscal", "emit", { order: a.order_id, http: r.status, body: (await r.text().catch(() => "")).slice(0, 200) }))
          .catch((e) => log("WARN", "fiscal", "falhou", { order: a.order_id, error: String(e) })));
      }
    }

    // Fluxo de caixa + roteamento bancário (espelho do order-write; Pix é D+0)
    try {
      const desc = `Venda ${o?.number ?? a.order_id.slice(0, 8)} (${pm.name} online)`;
      if (Number(pm.days_to_receive ?? 0) === 0) {
        const { data: exists } = await admin.from("fin_cash_flow").select("id").eq("tenant_id", tenantId).eq("reference_id", String(paymentId)).eq("origin", "auto_sale").maybeSingle();
        if (!exists) {
          await admin.from("fin_cash_flow").insert({ tenant_id: tenantId, type: "income", amount, description: desc, category: "Vendas", origin: "auto_sale", reference_id: String(paymentId), date: todayBR, payment_method_id: pm.id });
        }
        const { data: routing } = await admin.from("fin_income_routing").select("bank_account_id").eq("tenant_id", tenantId).eq("source_type", "payment_method").eq("source_id", pm.id).eq("is_active", true).maybeSingle();
        if (routing?.bank_account_id) {
          await admin.rpc("fn_bank_credit", { p_bank_account_id: routing.bank_account_id, p_amount: amount, p_description: desc, p_reference_type: "sale", p_reference_id: a.order_id, p_transaction_date: todayBR });
        }
      }
    } catch (e) { log("WARN", "settle", "fin_cash_flow/routing falhou (non-blocking)", { error: String(e) }); }
  }

  await admin.from("fin_pix_payments").update({
    payment_ids: paymentIds, settled_at: now, updated_at: now,
    ...(errors.length ? { error: errors.join(" | ") } : {}),
  }).eq("id", pixId);

  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  const all = Promise.allSettled(fiscalJobs);
  if (rt && typeof rt.waitUntil === "function") rt.waitUntil(all); else await all;

  log(errors.length ? "WARN" : "INFO", "settle", "liquidado", { pixId, payments: paymentIds.length, errors });
  return { already: false, errors };
}

// Consulta o provedor e aplica o resultado na nossa linha. Usado pelo webhook,
// pelo polling do cliente e pela confirmação manual do gerente.
async function reconcilePix(admin: Admin, token: string, px: Record<string, unknown>) {
  if (px.status !== "pending" || !px.provider_payment_id) return { status: px.status as string };
  const r = await mpFetch(token, `/v1/payments/${px.provider_payment_id}`);
  if (!r.ok) { log("WARN", "reconcile", "GET payment falhou", { http: r.status, body: r.body }); return { status: "pending", provider_error: r.status }; }
  const mpStatus = String(r.body.status ?? "");
  const now = new Date().toISOString();
  if (mpStatus === "approved") {
    const expected = round2(Number(px.amount ?? 0));
    const got = round2(Number(r.body.transaction_amount ?? 0));
    if (Math.abs(expected - got) > 0.01) {
      log("ERROR", "reconcile", "valor divergente", { pixId: px.id, expected, got });
      await admin.from("fin_pix_payments").update({ error: `Valor pago (${got}) difere do cobrado (${expected})`, updated_at: now }).eq("id", px.id);
    }
    await settlePix(admin, String(px.id), r.body);
    return { status: "confirmed" };
  }
  if (["cancelled", "rejected", "refunded", "charged_back"].includes(mpStatus)) {
    const st = mpStatus === "cancelled" ? "cancelled" : "expired";
    await admin.from("fin_pix_payments").update({ status: st, raw_provider: r.body, updated_at: now }).eq("id", px.id).eq("status", "pending");
    return { status: st };
  }
  return { status: "pending" };
}

async function expireIfNeeded(admin: Admin, px: Record<string, unknown>) {
  if (px.status === "pending" && px.expires_at && new Date(String(px.expires_at)) < new Date()) {
    await admin.from("fin_pix_payments").update({ status: "expired", updated_at: new Date().toISOString() }).eq("id", px.id).eq("status", "pending");
    return { ...px, status: "expired" };
  }
  return px;
}

// ── Webhook do Mercado Pago ──────────────────────────────────────────────────
async function handleWebhook(req: Request, admin: Admin, url: URL) {
  const tenantId = url.searchParams.get("tenant_id") ?? "";
  const dataIdQuery = url.searchParams.get("data.id") ?? "";
  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { body = {}; }
  const type = String(body.type ?? url.searchParams.get("type") ?? "");
  const dataId = String((body.data as { id?: string } | undefined)?.id ?? dataIdQuery ?? "");
  log("INFO", "webhook", "recebido", { tenantId, type, action: body.action, dataId });
  if (!tenantId || type !== "payment" || !dataId) return json({ ok: true, ignored: true });

  const cfg = await loadConfig(admin, tenantId);
  if (!cfg?.access_token) return json({ ok: true, ignored: "no_config" });

  // Assinatura (x-signature: ts=...,v1=...) — manifesto id:{data.id};request-id:{x-request-id};ts:{ts};
  if (cfg.webhook_secret) {
    const sig = req.headers.get("x-signature") ?? "";
    const reqId = req.headers.get("x-request-id") ?? "";
    const parts = Object.fromEntries(sig.split(",").map((p) => p.trim().split("=", 2) as [string, string]));
    const idForManifest = /^[a-z0-9]+$/i.test(dataIdQuery) ? dataIdQuery.toLowerCase() : dataIdQuery;
    const manifest = `id:${idForManifest};request-id:${reqId};ts:${parts.ts ?? ""};`;
    const expected = await hmacSha256Hex(cfg.webhook_secret, manifest);
    if (!parts.v1 || expected !== parts.v1) {
      log("WARN", "webhook", "assinatura inválida", { tenantId, dataId });
      // Mesmo assim NÃO confiamos no corpo: só o GET no provedor decide. Rejeita pra não gastar chamada.
      return json({ ok: false, error: "invalid_signature" }, 401);
    }
  }

  const { data: px } = await admin.from("fin_pix_payments").select("*")
    .eq("provider", "mercadopago").eq("provider_payment_id", dataId).eq("tenant_id", tenantId).maybeSingle();
  if (!px) {
    // Pode ter chegado antes de gravarmos o provider_payment_id: tenta pelo external_reference.
    const r = await mpFetch(cfg.access_token, `/v1/payments/${dataId}`);
    const ref = String(r.body?.external_reference ?? "");
    const { data: px2 } = ref ? await admin.from("fin_pix_payments").select("*").eq("id", ref).eq("tenant_id", tenantId).maybeSingle() : { data: null };
    if (!px2) return json({ ok: true, ignored: "unknown_payment" });
    if (!px2.provider_payment_id) await admin.from("fin_pix_payments").update({ provider_payment_id: dataId }).eq("id", px2.id);
    const res = await reconcilePix(admin, cfg.access_token, { ...px2, provider_payment_id: dataId });
    return json({ ok: true, ...res });
  }
  const res = await reconcilePix(admin, cfg.access_token, px);
  return json({ ok: true, ...res });
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const url = new URL(req.url);

  try {
    if (url.searchParams.get("webhook") === "1") return await handleWebhook(req, admin, url);

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const action = String(body.action ?? "");
    if (!action) return json({ error: "action is required" }, 400);

    // ── Cliente ──────────────────────────────────────────────────────────────
    if (action === "public_status") {
      const tenantId = String(body.tenant_id ?? "");
      if (!tenantId) return json({ error: "tenant_id is required" }, 400);
      const cfg = await loadConfig(admin, tenantId);
      return json({ enabled: isEnabled(cfg) });
    }

    if (action === "get_bill") {
      const auth = await resolveCustomer(admin, body, { allowClosed: true });
      if (auth.error) return auth.error;
      const { participant, session, tenantId: billTenantId, tableSessionId } = auth;
      const cfg = await loadConfig(admin, billTenantId!);
      const orders = await loadBill(admin, { tableSessionId: tableSessionId ?? null, participantId: participant?.id ?? null, orderId: auth.orderId }, participant?.id ?? null);
      const { data: pending } = await ownerFilter(admin.from("fin_pix_payments").select("*"), auth).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      const px = pending ? await expireIfNeeded(admin, pending) : null;
      // Comprovante recente: o cliente pode ter voltado do app do banco depois da mesa fechar
      const { data: lastOk } = await ownerFilter(admin.from("fin_pix_payments").select("*"), auth).eq("status", "confirmed")
        .gt("confirmed_at", new Date(Date.now() - 60 * 60 * 1000).toISOString())
        .order("confirmed_at", { ascending: false }).limit(1).maybeSingle();
      // Extrato do que já foi pago — inclui o que o caixa recebeu (dinheiro/cartão),
      // não só os Pix deste app. Pagamento de vários pedidos de uma vez (payment_group_id)
      // vira UMA linha somada, senão o cliente vê o mesmo Pix repetido por pedido.
      const orderIds = orders.map((o) => o.id);
      const { data: pagos } = orderIds.length > 0
        ? await admin.from("payments").select("id, order_id, amount, created_at, payment_method_id, payment_group_id")
            .in("order_id", orderIds).eq("is_refunded", false).order("created_at", { ascending: false })
        : { data: [] as Record<string, unknown>[] };
      const methodIds = [...new Set((pagos ?? []).map((p) => p.payment_method_id).filter(Boolean))] as string[];
      const { data: methods } = methodIds.length > 0
        ? await admin.from("payment_methods").select("id, name").in("id", methodIds)
        : { data: [] as { id: string; name: string }[] };
      const methodName: Record<string, string> = {};
      for (const m of methods ?? []) methodName[m.id] = m.name;
      const grouped = new Map<string, { id: string; amount: number; at: string; method: string; orders: string[] }>();
      for (const p of pagos ?? []) {
        const key = (p.payment_group_id as string) ?? (p.id as string);
        const numero = orders.find((o) => o.id === p.order_id)?.number ?? null;
        const g = grouped.get(key);
        if (g) {
          g.amount = round2(g.amount + Number(p.amount ?? 0));
          if (numero) g.orders.push(numero);
        } else {
          grouped.set(key, {
            id: key, amount: round2(Number(p.amount ?? 0)), at: String(p.created_at),
            method: methodName[p.payment_method_id as string] ?? "Pagamento",
            orders: numero ? [numero] : [],
          });
        }
      }
      const paymentsHistory = [...grouped.values()].sort((a, b) => (a.at < b.at ? 1 : -1));

      const { data: tbl } = auth.tableId ? await admin.from("tables").select("number").eq("id", auth.tableId).maybeSingle() : { data: null };
      // CPF já informado em algum pedido desta conta: o front usa para pré-preencher o campo.
      const { data: cpfRow } = orderIds.length > 0
        ? await admin.from("orders").select("customer_cpf").in("id", orderIds).not("customer_cpf", "is", null).limit(1).maybeSingle()
        : { data: null };
      return json({
        enabled: isEnabled(cfg), table_number: tbl?.number ?? null,
        customer_cpf: (cpfRow?.customer_cpf as string | null) ?? null,
        participant: participant ? { id: participant.id, name: participant.name } : { id: auth.orderId, name: auth.customerName ?? "" },
        mode: tableSessionId ? "table" : auth.orderId ? "delivery" : "queue",
        payments_history: paymentsHistory,
        session_closed: session ? session.status !== "open" : false,
        orders, pending_pix: px && px.status === "pending" ? pixPublic(px) : null,
        last_pix: lastOk ? pixPublic(lastOk) : null,
      });
    }

    if (action === "create_pix") {
      const auth = await resolveCustomer(admin, body);
      if (auth.error) return auth.error;
      const { participant, tenantId: pixTenantId, tableSessionId } = auth;
      const tenantId = pixTenantId!;
      const cfg = await loadConfig(admin, tenantId);
      if (!isEnabled(cfg)) return json({ error: "Pagamento online não está disponível nesta loja" }, 422);
      // Na fila por senha só existe a própria conta — "mesa inteira" não faz sentido.
      const scope = (tableSessionId && body.scope === "all") ? "all" : "mine";

      // CPF/CNPJ na nota (opcional): validado ANTES de calcular a conta, para o cliente
      // receber o erro de digitação mesmo quando não há nada pendente para cobrar.
      const cpfNota = String(body.customer_cpf ?? "").replace(/\D/g, "");
      if (cpfNota && !isValidCpfCnpj(cpfNota)) return json({ error: "invalid_cpf", message: "CPF/CNPJ inválido. Confira os dígitos ou deixe em branco." }, 422);

      const orders = await loadBill(admin, { tableSessionId: tableSessionId ?? null, participantId: participant?.id ?? null, orderId: auth.orderId }, participant?.id ?? null);
      // Sem participante (delivery) a conta é o próprio pedido — tudo é "meu".
      const isMine = (o: BillOrder) => scope === "all" || !participant || o.participant_id === participant.id;
      const target = orders.filter((o) => o.remaining > 0 && !o.locked && isMine(o));
      if (orders.some((o) => o.remaining > 0 && o.locked && isMine(o))) {
        return json({ error: "orders_locked", message: "Outra pessoa da mesa está pagando parte desses pedidos. Aguarde alguns minutos e tente de novo." }, 409);
      }
      const amount = round2(target.reduce((s, o) => s + o.remaining, 0));
      if (target.length === 0 || amount < 0.01) return json({ error: "nothing_to_pay", message: "Não há nada pendente para pagar." }, 422);

      // Guarda o CPF nos pedidos que este Pix vai pagar: a fiscal-write lê orders.customer_cpf
      // ao emitir a NFC-e quando o pagamento confirmar.
      if (cpfNota) {
        const { error: cpfErr } = await admin.from("orders").update({ customer_cpf: cpfNota })
          .in("id", target.map((o) => o.id)).eq("tenant_id", tenantId);
        if (cpfErr) log("ERROR", "create_pix", "não gravou o CPF na nota", { error: cpfErr.message, orders: target.length });
        else log("INFO", "create_pix", "CPF na nota gravado", { orders: target.length });
      }

      // Um Pix pendente por participante: cancela o anterior (aqui e no provedor)
      const { data: olds } = await ownerFilter(admin.from("fin_pix_payments").select("id, provider_payment_id"), auth).eq("status", "pending");
      for (const old of olds ?? []) {
        await admin.from("fin_pix_payments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", old.id);
        if (old.provider_payment_id) mpFetch(cfg!.access_token!, `/v1/payments/${old.provider_payment_id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }).catch(() => {});
      }

      const expiresAt = new Date(Date.now() + PIX_EXPIRATION_MIN * 60 * 1000);
      const allocation = target.map((o) => ({ order_id: o.id, amount: o.remaining, number: o.number }));
      // O id nasce aqui (chave de idempotência + external_reference); a linha só é gravada como
      // "pending" DEPOIS do provedor aceitar — assim uma recusa não deixa Pix fantasma travando pedidos.
      const pixId = crypto.randomUUID();
      const baseRow = {
        id: pixId, tenant_id: tenantId, provider: "mercadopago", txid: `MP${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        amount, expires_at: expiresAt.toISOString(),
        table_session_id: tableSessionId ?? null, participant_id: participant?.id ?? null, scope, allocation,
        order_id: allocation.length === 1 ? allocation[0].order_id : null,
        pix_key: "mercadopago", pix_key_type: "provider", beneficiary_name: cfg!.account_label ?? "Mercado Pago", city: "-",
      };

      const { data: tbl } = auth.tableId ? await admin.from("tables").select("number").eq("id", auth.tableId).maybeSingle() : { data: null };
      const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
      const alvoLabel = tbl?.number != null ? `Mesa ${tbl.number}` : participant ? `Senha ${participant.access_token ?? ""}`.trim() : `Delivery ${auth.orderNumber ?? ""}`.trim();
      const nameParts = String(participant?.name ?? auth.customerName ?? "Cliente").trim().split(/\s+/);
      const payerKey = participant?.id ?? auth.orderId;
      const mp = await mpFetch(cfg!.access_token!, "/v1/payments", {
        method: "POST",
        headers: { "X-Idempotency-Key": pixId },
        body: JSON.stringify({
          transaction_amount: amount,
          description: `${tenant?.name ?? "Restaurante"} · ${alvoLabel} · ${allocation.length} pedido(s)`,
          payment_method_id: "pix",
          payer: { email: `${payerKey}@cliente.erpos.app`, first_name: nameParts[0] || "Cliente", last_name: nameParts.slice(1).join(" ") || "Cliente" },
          external_reference: pixId,
          notification_url: `${supabaseUrl}/functions/v1/online-payments?webhook=1&tenant_id=${tenantId}`,
          date_of_expiration: mpDate(expiresAt),
          metadata: { erpos_pix_id: pixId, table_session_id: tableSessionId ?? null, participant_id: participant?.id ?? null, order_id: auth.orderId ?? null, tenant_id: tenantId },
        }),
      });
      if (!mp.ok) {
        const msg = String((mp.body as { message?: string }).message ?? JSON.stringify(mp.body).slice(0, 300));
        await admin.from("fin_pix_payments").insert({ ...baseRow, status: "failed", emv_payload: "", error: `MP ${mp.status}: ${msg}`, raw_provider: mp.body });
        log("ERROR", "create_pix", "MP recusou", { http: mp.status, body: mp.body });
        return json({ error: "provider_error", message: "Não foi possível gerar o Pix agora. Tente novamente ou pague no caixa.", detail: msg }, 502);
      }
      const td = ((mp.body.point_of_interaction as Record<string, unknown> | undefined)?.transaction_data ?? {}) as Record<string, string>;
      const { data: row, error: insErr } = await admin.from("fin_pix_payments").insert({
        ...baseRow, status: "pending",
        provider_payment_id: String(mp.body.id), emv_payload: td.qr_code ?? "", qr_code_base64: td.qr_code_base64 ?? null, ticket_url: td.ticket_url ?? null,
        raw_provider: { id: mp.body.id, status: mp.body.status, date_of_expiration: mp.body.date_of_expiration },
      }).select("*").single();
      if (insErr || !row) {
        // Cobrança existe no provedor mas não aqui: cancela lá pra não receber dinheiro sem rastro.
        mpFetch(cfg!.access_token!, `/v1/payments/${mp.body.id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }).catch(() => {});
        throw insErr ?? new Error("insert fin_pix_payments falhou");
      }
      log("INFO", "create_pix", "criado", { pixId, mpId: mp.body.id, amount, scope, orders: allocation.length });
      return json({ pix: pixPublic(row) });
    }

    if (action === "get_pix_status") {
      const auth = await resolveCustomer(admin, body, { allowClosed: true });
      if (auth.error) return auth.error;
      const pixId = String(body.pix_payment_id ?? "");
      const { data: px0 } = await ownerFilter(admin.from("fin_pix_payments").select("*").eq("id", pixId), auth).maybeSingle();
      if (!px0) return json({ error: "Pagamento não encontrado" }, 404);
      let px = await expireIfNeeded(admin, px0);
      if (px.status === "pending" && body.reconcile) {
        const cfg = await loadConfig(admin, auth.tenantId!);
        if (cfg?.access_token) {
          await reconcilePix(admin, cfg.access_token, px);
          const { data: fresh } = await admin.from("fin_pix_payments").select("*").eq("id", pixId).maybeSingle();
          if (fresh) px = fresh;
        }
      }
      return json({ pix: pixPublic(px) });
    }

    // O cliente lembrou do CPF depois de gerar o Pix (o campo some quando o QR aparece):
    // grava nos pedidos daquele Pix enquanto ele não foi liquidado.
    if (action === "set_cpf") {
      const auth = await resolveCustomer(admin, body, { allowClosed: true });
      if (auth.error) return auth.error;
      const cpf = String(body.customer_cpf ?? "").replace(/\D/g, "");
      if (cpf && !isValidCpfCnpj(cpf)) return json({ error: "invalid_cpf", message: "CPF/CNPJ inválido. Confira os dígitos ou deixe em branco." }, 422);
      const pixId = String(body.pix_payment_id ?? "");
      const { data: px } = await ownerFilter(admin.from("fin_pix_payments").select("id, status, allocation, settled_at").eq("id", pixId), auth).maybeSingle();
      if (!px) return json({ error: "Pagamento não encontrado" }, 404);
      if (px.settled_at) return json({ error: "already_settled", message: "Este pagamento já foi finalizado e a nota já saiu." }, 409);
      const ids = (((px.allocation as { order_id: string }[] | null) ?? []).map((a) => a.order_id)).filter(Boolean);
      if (ids.length === 0) return json({ error: "Nada para atualizar" }, 422);
      const { error: upErr } = await admin.from("orders").update({ customer_cpf: cpf || null }).in("id", ids).eq("tenant_id", auth.tenantId!);
      if (upErr) { log("ERROR", "set_cpf", "falhou", { error: upErr.message }); return json({ error: "update_failed", message: upErr.message }, 500); }
      log("INFO", "set_cpf", "CPF na nota atualizado", { pixId, orders: ids.length, informado: Boolean(cpf) });
      return json({ ok: true, customer_cpf: cpf || null });
    }

    if (action === "cancel_pix") {
      const auth = await resolveCustomer(admin, body, { allowClosed: true });
      if (auth.error) return auth.error;
      const pixId = String(body.pix_payment_id ?? "");
      const { data: px } = await ownerFilter(admin.from("fin_pix_payments").select("id, status, provider_payment_id").eq("id", pixId), auth).maybeSingle();
      if (!px) return json({ error: "Pagamento não encontrado" }, 404);
      if (px.status !== "pending") return json({ ok: true, status: px.status });
      await admin.from("fin_pix_payments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", pixId).eq("status", "pending");
      const cfg = await loadConfig(admin, auth.tenantId!);
      if (cfg?.access_token && px.provider_payment_id) mpFetch(cfg.access_token, `/v1/payments/${px.provider_payment_id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) }).catch(() => {});
      return json({ ok: true, status: "cancelled" });
    }

    // ── Staff ────────────────────────────────────────────────────────────────
    const tenantId = String(body.tenant_id ?? "");
    if (!tenantId) return json({ error: "tenant_id is required" }, 400);
    const member = await requireMember(req, admin, tenantId);
    if (member.error) return member.error;
    const webhookUrl = `${supabaseUrl}/functions/v1/online-payments?webhook=1&tenant_id=${tenantId}`;

    if (action === "get_config") {
      const cfg = await loadConfig(admin, tenantId);
      return json({
        configured: Boolean(cfg?.access_token), is_active: Boolean(cfg?.is_active), has_webhook_secret: Boolean(cfg?.webhook_secret),
        access_token_hint: cfg?.access_token ? `…${cfg.access_token.slice(-6)}` : null, public_key: cfg?.public_key ?? null,
        account_id: cfg?.account_id ?? null, account_label: cfg?.account_label ?? null, last_test_at: cfg?.last_test_at ?? null, webhook_url: webhookUrl,
      });
    }

    if (action === "save_config") {
      if (!isManager(member.role)) return json({ error: "Somente administrador ou gerente" }, 403);
      const cfg = await loadConfig(admin, tenantId);
      const patch: Record<string, unknown> = { tenant_id: tenantId, provider: "mercadopago", updated_at: new Date().toISOString() };
      const newToken = typeof body.access_token === "string" && body.access_token.trim() ? body.access_token.trim() : null;
      const token = newToken ?? cfg?.access_token ?? null;
      if (typeof body.webhook_secret === "string") patch.webhook_secret = body.webhook_secret.trim() || null;
      if (typeof body.public_key === "string") patch.public_key = body.public_key.trim() || null;
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (newToken) {
        // Valida o token na hora: GET /users/me devolve a conta dona do token.
        const me = await mpFetch(newToken, "/users/me");
        if (!me.ok) return json({ error: "Token inválido no Mercado Pago", detail: (me.body as { message?: string }).message ?? me.status }, 422);
        patch.access_token = newToken;
        patch.account_id = String(me.body.id ?? "");
        patch.account_label = [me.body.nickname, me.body.email].filter(Boolean).join(" · ");
        patch.last_test_at = new Date().toISOString();
      }
      if (patch.is_active === true && !token) return json({ error: "Informe o Access Token antes de ativar" }, 422);
      const { error } = await admin.from("fin_payment_provider_config").upsert(patch, { onConflict: "tenant_id,provider" });
      if (error) throw error;
      const fresh = await loadConfig(admin, tenantId);
      return json({ ok: true, is_active: Boolean(fresh?.is_active), account_label: fresh?.account_label ?? null, account_id: fresh?.account_id ?? null, webhook_url: webhookUrl });
    }

    if (action === "test_config") {
      const cfg = await loadConfig(admin, tenantId);
      if (!cfg?.access_token) return json({ ok: false, error: "Token não configurado" }, 422);
      const me = await mpFetch(cfg.access_token, "/users/me");
      if (!me.ok) return json({ ok: false, error: "Token recusado pelo Mercado Pago", detail: me.status }, 200);
      await admin.from("fin_payment_provider_config").update({ last_test_at: new Date().toISOString(), account_id: String(me.body.id ?? ""), account_label: [me.body.nickname, me.body.email].filter(Boolean).join(" · ") }).eq("id", cfg.id);
      return json({ ok: true, account_id: me.body.id, account_label: [me.body.nickname, me.body.email].filter(Boolean).join(" · ") });
    }

    if (action === "list_session_pix") {
      const sessionId = String(body.table_session_id ?? "");
      const { data } = await admin.from("fin_pix_payments").select("*").eq("tenant_id", tenantId)
        .eq("table_session_id", sessionId).order("created_at", { ascending: false });
      return json({ data: (data ?? []).map(pixPublic) });
    }

    if (action === "confirm_manual") {
      // Gerente viu o dinheiro na conta e o webhook não chegou: primeiro reconcilia no
      // provedor; só liquida "na força" (force) com perfil admin, e fica auditado em `error`.
      if (!isManager(member.role)) return json({ error: "Somente administrador ou gerente" }, 403);
      const pixId = String(body.pix_payment_id ?? "");
      const { data: px } = await admin.from("fin_pix_payments").select("*").eq("id", pixId).eq("tenant_id", tenantId).maybeSingle();
      if (!px) return json({ error: "Pagamento não encontrado" }, 404);
      if (px.status !== "pending") return json({ ok: true, status: px.status });
      const cfg = await loadConfig(admin, tenantId);
      if (cfg?.access_token && px.provider_payment_id) {
        const r = await reconcilePix(admin, cfg.access_token, px);
        if (r.status === "confirmed") return json({ ok: true, status: "confirmed", via: "provider" });
      }
      if (body.force !== true) return json({ ok: false, status: "pending", message: "O Mercado Pago ainda não confirmou este pagamento." });
      if (member.role !== "admin") return json({ error: "Forçar confirmação exige perfil administrador" }, 403);
      const r = await settlePix(admin, pixId, { manual: true, by: member.userId }, `Confirmado manualmente (sem aprovação do provedor) por ${member.userId}`);
      return json({ ok: true, status: "confirmed", via: "manual", errors: r.errors ?? [] });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err) {
    log("ERROR", "handler", "unexpected", { error: String(err) });
    return json({ error: "internal_error", message: String(err) }, 500);
  }
});

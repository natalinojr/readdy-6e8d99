// ── online-payments ──────────────────────────────────────────────────────────
// Pagamento pelo celular do cliente via Mercado Pago: Pix dinâmico (API de Payments) e
// cartão de CRÉDITO à vista (API de Orders, token do Card Payment Brick). Atende MESA
// numerada (conta da sessão, várias pessoas), FILA POR SENHA (QR universal, sem
// mesa — a conta é do participante) e DELIVERY (pedido único, autenticado pelo
// client_request_id gerado no aparelho do cliente). Uma função só, três "portas":
//   • cliente (sem JWT; participant_id + access_token, ou order_id + order_token no delivery):
//       public_status, get_bill, create_pix, create_card, get_pix_status, cancel_pix
//   • staff (JWT + membership em user_tenants):
//       get_config, save_config (admin/manager), confirm_manual (admin/manager)
//   • webhook do Mercado Pago:  POST ?webhook=1&tenant_id=<uuid>  (tópicos payment e order)
// A ÚNICA coisa que marca um pedido como pago é a resposta do provedor
// (webhook ou reconciliação GET /v1/payments/{id} | /v1/orders/{id}) — nunca o clique do cliente.
// Cobrança de cartão = linha em fin_pix_payments com method 'credit_card' e provider_payment_id
// = id da order (ORD…); `ticket_url` guarda a URL do desafio do banco (3DS) enquanto pendente.
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
// O banco dá 40 min para o cliente concluir o desafio (3DS); a nossa linha só expira depois
// disso — e mesmo expirada, uma aprovação tardia do MP ainda liquida (ver reconcileOrder).
const CARD_EXPIRATION_MIN = 45;
const isCardRow = (px: Record<string, unknown>) => String(px.method ?? "pix") !== "pix";
// Motivos de recusa do cartão em português. A API de Payments usa "cc_rejected_<motivo>" e a de
// Orders pode vir sem o prefixo ("insufficient_amount") — compara sem ele. O resto cai no genérico.
const CARD_REJECT_PT: Record<string, string> = {
  insufficient_amount: "Saldo ou limite insuficiente.",
  bad_filled_security_code: "Código de segurança (CVV) incorreto.",
  bad_filled_date: "Data de validade incorreta.",
  bad_filled_card_number: "Número do cartão incorreto.",
  bad_filled_other: "Confira os dados do cartão.",
  call_for_authorize: "O banco pediu autorização: ligue para o banco ou use outro cartão.",
  card_disabled: "Cartão bloqueado ou inativo. Fale com o banco ou use outro cartão.",
  duplicated_payment: "Pagamento repetido: já existe um pagamento igual há pouco.",
  high_risk: "Pagamento recusado por segurança. Use outro cartão ou pague com Pix.",
  max_attempts: "Tentativas demais com este cartão. Use outro cartão ou pague com Pix.",
  blacklist: "Cartão não aceito. Use outro cartão ou pague com Pix.",
  "3ds_challenge": "A confirmação do banco não foi concluída.",
  card_type_not_allowed: "Este tipo de cartão não é aceito. Use um cartão de crédito.",
  other_reason: "O banco recusou o pagamento. Use outro cartão ou pague com Pix.",
};
const rejectKey = (detail: string | null | undefined) => String(detail ?? "").toLowerCase().replace(/^cc_rejected_/, "");
const isCardRejectDetail = (detail: string | null | undefined) => /^cc_rejected_/i.test(String(detail ?? "")) || rejectKey(detail) in CARD_REJECT_PT;
const cardRejectMessage = (detail: string | null | undefined) =>
  CARD_REJECT_PT[rejectKey(detail)] ?? "O pagamento não foi aprovado. Confira os dados, use outro cartão ou pague com Pix.";
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
// fin_pix_payments.method → payment_methods.type da loja (decide tPag da NFC-e, taxa e prazo).
const METHOD_LABEL: Record<string, string> = { pix: "PIX", credit_card: "Cartão de Crédito", debit_card: "Cartão de Débito" };
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
  const { data, error } = await admin.from("fin_payment_provider_config")
    .select("id, access_token, public_key, webhook_secret, is_active, account_id, account_label, last_test_at, updated_at, card_enabled, card_fee_percentage, card_days_to_receive, card_bank_account_id, pix_fee_percentage")
    .eq("tenant_id", tenantId).eq("provider", "mercadopago").maybeSingle();
  // Erro de leitura NÃO pode virar "loja sem config": o webhook responderia 200 e o MP não reenviaria.
  if (error) throw new Error(`fin_payment_provider_config: ${error.message}`);
  return data as {
    id: string; access_token: string | null; public_key: string | null; webhook_secret: string | null; is_active: boolean;
    account_id: string | null; account_label: string | null; last_test_at: string | null; updated_at: string;
    card_enabled: boolean | null; card_fee_percentage: number | null; card_days_to_receive: number | null; card_bank_account_id: string | null;
    pix_fee_percentage: number | null;
  } | null;
}
const isEnabled = (cfg: Awaited<ReturnType<typeof loadConfig>>) => Boolean(cfg && cfg.is_active && cfg.access_token);
// Cartão pelo app: além do Pix ligado, precisa da chave pública (o formulário do cartão roda no navegador).
const isCardEnabled = (cfg: Awaited<ReturnType<typeof loadConfig>>) => isEnabled(cfg) && Boolean(cfg!.card_enabled && cfg!.public_key);

// Cancela a cobrança no provedor (best-effort). Pix: PUT /v1/payments; cartão: POST /v1/orders/{id}/cancel
// (só vale enquanto a order espera o desafio do banco — depois disso o MP recusa, e tudo bem).
function cancelAtProvider(token: string, px: { provider_payment_id?: unknown; method?: unknown }) {
  const id = String(px.provider_payment_id ?? "");
  if (!id) return Promise.resolve();
  const p = isCardRow(px as Record<string, unknown>)
    ? mpFetch(token, `/v1/orders/${id}/cancel`, { method: "POST", headers: { "X-Idempotency-Key": crypto.randomUUID() } })
    : mpFetch(token, `/v1/payments/${id}`, { method: "PUT", body: JSON.stringify({ status: "cancelled" }) });
  return p.then(() => {}).catch(() => {});
}

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
// Alternativa: `order_phone` = telefone do cliente (mesma confiança do histórico/acompanhar,
// que já expõem o pedido por telefone). Cobre o aparelho que perdeu a chave.
async function requireDeliveryOrder(admin: Admin, body: Record<string, unknown>) {
  const orderId = String(body.order_id ?? "");
  const token = String(body.order_token ?? "");
  const phone = String(body.order_phone ?? "").replace(/\D/g, "");
  if (!orderId || (!token && !phone)) return { error: json({ error: "order_id e order_token (ou order_phone) são obrigatórios" }, 400) };
  const { data: o } = await admin.from("orders").select("id, tenant_id, number, client_request_id, origin_type, status, destination_name, destination_phone")
    .eq("id", orderId).maybeSingle();
  const tokenOk = !!token && String(o?.client_request_id ?? "") === token;
  const phoneOk = !!phone && phone.length >= 10 && String(o?.destination_phone ?? "").replace(/\D/g, "") === phone;
  if (!o || !(tokenOk || phoneOk) || o.origin_type !== "delivery") return { error: json({ error: "Pedido não encontrado" }, 403) };
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
  return (body.order_token || body.order_phone) ? requireDeliveryOrder(admin, body) : requireParticipant(admin, body, opts);
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
  // Rascunho fica de fora da conta da MESA (carrinho nao enviado). No escopo de PEDIDO UNICO
  // (delivery) e na SENHA (QR universal com "paga antes de ir pra cozinha") o rascunho e'
  // justamente o pedido "segurado" esperando o pagamento.
  const heldCounts = Boolean(scopeRef.orderId) || (!tableSessionId && Boolean(scopeRef.participantId));
  const rows = (orders ?? []).filter((o: Record<string, unknown>) => !o.is_training && (heldCounts ? true : !o.is_draft));
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
    // Delivery: a conta é UM pedido de UM cliente — a cobrança pendente é dele mesmo (ex.: abriu o Pix
    // e trocou para o cartão). Travar aqui zerava o valor do cartão ("R$ 0,00") e o create_card
    // recusava com "outra pessoa da mesa está pagando". A cobrança antiga é cancelada no create_*.
    if (scopeRef.orderId && !tableSessionId) continue;
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
  method: px.method ?? "pix", card_brand: px.card_brand ?? null, card_last4: px.card_last4 ?? null,
  status_detail: px.provider_status_detail ?? null,
  // Cartão recusado: motivo já traduzido para o cliente.
  reject_message: isCardRow(px) && px.status === "failed" ? cardRejectMessage(px.provider_status_detail as string | null) : null,
});

// ── Financeiro da venda (espelho do order-write › record_payment) ───────────
// D+0 (Pix, débito): entrada no fluxo de caixa + crédito na conta roteada + taxa da forma
// de pagamento. A prazo (crédito D+30): só o recebível — a entrada e a taxa entram quando
// ele é baixado (financial-write › receive_installment, BUG-43). Mantenha em sincronia com
// o order-write: o DRE trata venda do caixa e venda online do mesmo jeito.
type SalePm = { id: string; name: string; days_to_receive: number | null; fee_percentage: number | null };
async function postSaleFinance(admin: Admin, s: {
  tenantId: string; pm: SalePm; paymentId: string; orderId: string; orderNumber: string | null;
  amount: number; todayBR: string; channel: string;
  // Cartão online do MP: o dinheiro cai no saldo do Mercado Pago, não na conta da maquininha.
  // undefined = roteamento da forma de pagamento (Pix/maquininha, como sempre); null = não credita
  // banco nenhum; uuid = credita nessa conta. `receivableFee` grava a taxa no próprio recebível.
  bankAccountId?: string | null; receivableFee?: number | null;
  // Rótulo da despesa de taxa (maquininha × Mercado Pago online).
  feeLabel?: string;
}) {
  const ref = s.orderNumber ?? s.orderId.slice(0, 8);
  const desc = `Venda ${ref} (${s.pm.name} ${s.channel})`;
  const days = Number(s.pm.days_to_receive ?? 0);
  if (days > 0) {
    // Sem checagem de duplicado: o settle só roda uma vez por cobrança (claim pending → confirmed).
    const due = new Date(`${s.todayBR}T12:00:00Z`);
    due.setUTCDate(due.getUTCDate() + days);
    const { error } = await admin.from("fin_receivable_installments").insert({
      tenant_id: s.tenantId, order_id: s.orderId, installment_number: 1, total_installments: 1, amount: s.amount,
      due_date: due.toISOString().slice(0, 10), status: "pending", payment_method_name: s.pm.name, order_number: s.orderNumber,
      ...(s.receivableFee != null ? { fee_percentage: s.receivableFee } : {}),
    });
    if (error) throw new Error(`recebível: ${error.message}`);
    return;
  }
  const { data: exists } = await admin.from("fin_cash_flow").select("id").eq("tenant_id", s.tenantId).eq("reference_id", s.paymentId).eq("origin", "auto_sale").maybeSingle();
  if (!exists) {
    await admin.from("fin_cash_flow").insert({ tenant_id: s.tenantId, type: "income", amount: s.amount, description: desc, category: "Vendas", origin: "auto_sale", reference_id: s.paymentId, date: s.todayBR, payment_method_id: s.pm.id });
  }
  let bankAccountId: string | null = null;
  if (s.bankAccountId === undefined) {
    const { data: routing } = await admin.from("fin_income_routing").select("bank_account_id").eq("tenant_id", s.tenantId).eq("source_type", "payment_method").eq("source_id", s.pm.id).eq("is_active", true).maybeSingle();
    bankAccountId = routing?.bank_account_id ?? null;
  } else bankAccountId = s.bankAccountId;
  if (bankAccountId) {
    await admin.rpc("fn_bank_credit", { p_bank_account_id: bankAccountId, p_amount: s.amount, p_description: desc, p_reference_type: "sale", p_reference_id: s.orderId, p_transaction_date: s.todayBR });
  }
  const feePercent = Number(s.pm.fee_percentage ?? 0);
  const fee = round2(s.amount * feePercent / 100);
  if (fee > 0) {
    const { data: feeExists } = await admin.from("fin_cash_flow").select("id").eq("tenant_id", s.tenantId).eq("reference_id", s.paymentId).eq("origin", "auto_card_fee").maybeSingle();
    if (!feeExists) {
      await admin.from("fin_cash_flow").insert({ tenant_id: s.tenantId, type: "expense", amount: fee, description: `${s.feeLabel ?? "Taxa maquininha"} — ${s.pm.name} (${feePercent}%) — Venda ${ref}`, category: "Taxas de Cartao", origin: "auto_card_fee", reference_id: s.paymentId, date: s.todayBR });
    }
  }
}

// Pagamento pelo app que chegou para pedido já pago/cancelado: o dinheiro está no Mercado Pago e
// precisa voltar ao cliente. Aviso (conversa "Avisos") para cada admin/gerente da loja — sem isso o
// erro ficaria só em fin_pix_payments.error, que nenhuma tela mostra.
async function avisarPagoEmDobro(admin: Admin, tenantId: string, pixId: string, providerId: string | null,
  itens: { order_id: string; number: string | null; amount: number; motivo: string }[]) {
  try {
    const [{ data: membros }, { data: t }] = await Promise.all([
      admin.from("user_tenants").select("user_id, role").eq("tenant_id", tenantId).in("role", ["admin", "manager"]),
      admin.from("tenants").select("name").eq("id", tenantId).maybeSingle(),
    ]);
    const total = round2(itens.reduce((s, i) => s + i.amount, 0));
    const valor = `R$ ${total.toFixed(2).replace(".", ",")}`;
    const rows = [...new Set((membros ?? []).map((m: { user_id: string }) => m.user_id))].map((uid) => ({
      user_id: uid, tenant_id: tenantId, kind: "pago_em_dobro", ref: pixId,
      resumo: `Pagamento pelo app em dobro — estornar ${valor} ao cliente no Mercado Pago`,
      painel: {
        s: t?.name ?? "", t: "Estornar no Mercado Pago",
        kpi: { p: { l: "Recebido a mais", v: valor } },
        lin: [{ t: "O que aconteceu", i: [
          ...itens.map((i) => ({ l: `Pedido ${i.number ?? i.order_id.slice(0, 8)}`, v: `já estava ${i.motivo}` })),
          ...(providerId ? [{ l: "No Mercado Pago", v: providerId }] : []),
        ] }],
      },
    }));
    if (rows.length) await admin.from("avisos").insert(rows);
  } catch (e) { log("ERROR", "settle", "aviso de pago em dobro falhou", { pixId, error: String(e) }); }
}

// ── Liquidação: o que o caixa faria ao receber o dinheiro ────────────────────
// Idempotente: reivindica a linha com update condicional (pending → confirmed);
// quem perder a corrida (webhook × polling) sai sem fazer nada. `fromStatuses`: a cobrança
// aprovada depois de expirar/cancelar aqui é reivindicada no MESMO update (sem janela de corrida).
async function settlePix(admin: Admin, pixId: string, providerPayload: unknown, note?: string, fromStatuses: string[] = ["pending"]) {
  const now = new Date().toISOString();
  // Tudo que pode falhar por leitura (config do cartão online) vem ANTES do claim: depois dele, um
  // erro deixaria a cobrança "confirmada" sem pagamento lançado e sem como o webhook refazer.
  const { data: pre } = await admin.from("fin_pix_payments").select("tenant_id, provider, method").eq("id", pixId).maybeSingle();
  if (!pre) { log("WARN", "settle", "cobrança não encontrada", { pixId }); return { already: true }; }
  const method = String(pre.method ?? "pix");
  const isOnlineMp = pre.provider === "mercadopago";
  const isOnlineCard = method !== "pix" && isOnlineMp;
  const cfgMp = isOnlineMp ? await loadConfig(admin, String(pre.tenant_id)) : null;

  const { data: claimed } = await admin.from("fin_pix_payments")
    .update({ status: "confirmed", confirmed_at: now, updated_at: now, raw_provider: providerPayload ?? null, ...(note ? { error: note } : {}) })
    .eq("id", pixId).in("status", fromStatuses).select("*").maybeSingle();
  if (!claimed) { log("INFO", "settle", "já liquidado ou não pendente", { pixId }); return { already: true }; }

  const tenantId = claimed.tenant_id as string;
  const allocation = ((claimed.allocation as { order_id: string; amount: number }[]) ?? []).filter((a) => Number(a.amount) > 0);
  const errors: string[] = [];

  // Forma de pagamento da loja pelo TIPO do que o provedor recebeu (Pix, ou crédito/débito
  // na maquininha). Sem a coluna `method` (linhas antigas), é Pix.
  const { data: pms } = await admin.from("payment_methods").select("id, name, days_to_receive, fee_percentage")
    .eq("tenant_id", tenantId).eq("type", method).eq("is_active", true).is("deleted_at", null).order("sort_order", { ascending: true });
  const pmBase = ((method === "pix" ? (pms ?? []).find((m: { name: string }) => /^pix$/i.test(String(m.name).trim())) : null) ?? (pms ?? [])[0]) as SalePm | undefined;
  if (!pmBase) {
    await admin.from("fin_pix_payments").update({ error: `Loja sem forma de pagamento ativa do tipo ${METHOD_LABEL[method] ?? method} — pagamento recebido mas não lançado`, settled_at: now }).eq("id", pixId);
    log("ERROR", "settle", "sem payment_method do tipo", { pixId, tenantId, method });
    return { already: false, errors: [`no_${method}_method`] };
  }
  // Cartão ONLINE do Mercado Pago: mesma forma "Cartão de Crédito" da loja (tPag, relatórios por tipo),
  // mas com a taxa e o prazo do cartão online, que não são os da maquininha (configurados no MP da loja).
  // O dinheiro fica no saldo do MP — só credita banco se a loja apontou a conta do Mercado Pago no
  // financeiro (nunca a conta da maquininha); a taxa vai junto do recebível.
  let pm: SalePm = pmBase;
  let cardBank: string | null | undefined = undefined;
  if (isOnlineCard) {
    pm = {
      ...pmBase,
      fee_percentage: cfgMp?.card_fee_percentage != null ? Number(cfgMp.card_fee_percentage) : pmBase.fee_percentage,
      days_to_receive: cfgMp?.card_days_to_receive != null ? Number(cfgMp.card_days_to_receive) : pmBase.days_to_receive,
    };
    cardBank = cfgMp?.card_bank_account_id ?? null;
  } else if (method === "pix" && isOnlineMp && cfgMp?.pix_fee_percentage != null) {
    // Pix pelo app (Checkout do MP) tem taxa; o Pix direto na conta da loja, não. Mesma forma "PIX".
    pm = { ...pmBase, fee_percentage: Number(cfgMp.pix_fee_percentage) };
  }
  const operatorName = method === "pix" ? "Cliente • Pix online" : isOnlineCard ? "Cliente • Cartão online" : "Cliente • Cartão na maquininha";
  const releaseLabel = method === "pix" ? "PIX pelo app (PAGO)" : "Cartão de crédito pelo app (PAGO)";

  // Pedido que já foi pago por outro caminho (caixa recebeu, outro Pix/cartão) ou cancelado enquanto
  // esta cobrança esperava: não lança pagamento em dobro — avisa para estornar. Separado ANTES de
  // lançar qualquer coisa: o grupo da NFC-e (payment_group_id + group_size) só conta o que entra.
  const lancar: { order_id: string; amount: number }[] = [];
  const dobro: { order_id: string; number: string | null; amount: number; motivo: string }[] = [];
  for (const a of allocation) {
    const amount = round2(Number(a.amount));
    const { data: o0 } = await admin.from("orders").select("number, status, total_amount").eq("id", a.order_id).maybeSingle();
    const { data: pays0 } = await admin.from("payments").select("amount").eq("order_id", a.order_id).eq("is_refunded", false);
    const pago0 = (pays0 ?? []).reduce((s: number, p: { amount: number }) => s + Number(p.amount ?? 0), 0);
    const total0 = Number(o0?.total_amount ?? 0);
    if (!o0 || o0.status === "cancelled" || (total0 > 0 && pago0 >= total0 - 0.005)) {
      const motivo = !o0 || o0.status === "cancelled" ? "cancelado" : "pago";
      dobro.push({ order_id: a.order_id, number: (o0?.number as string) ?? null, amount, motivo });
      errors.push(`PAGO EM DOBRO — pedido ${o0?.number ?? a.order_id.slice(0, 8)} já estava ${motivo}: R$ ${amount.toFixed(2)} recebido no Mercado Pago, estornar ao cliente`);
    } else lancar.push({ order_id: a.order_id, amount });
  }
  if (dobro.length) {
    log("ERROR", "settle", "pagamento pelo app em pedido já pago/cancelado — estornar", { pixId, provider: claimed.provider_payment_id, dobro });
    await avisarPagoEmDobro(admin, tenantId, pixId, (claimed.provider_payment_id as string) ?? null, dobro);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const internalKey = Deno.env.get("FISCAL_INTERNAL_KEY") ?? "";
  const { data: fs } = await admin.from("fiscal_settings").select("enabled").eq("tenant_id", tenantId).maybeSingle();
  const fiscalOn = Boolean(fs?.enabled) && Boolean(internalKey);
  const groupId = lancar.length > 1 ? pixId : null;
  const todayBR = new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);
  const paymentIds: string[] = [];
  const fiscalJobs: Promise<unknown>[] = [];

  for (const a of lancar) {
    const amount = round2(Number(a.amount));
    const { data: paymentId, error: payErr } = await admin.rpc("fn_record_payment_bypass", {
      p_order_id: a.order_id, p_tenant_id: tenantId, p_cash_register_id: null, p_payment_method_id: pm.id,
      p_amount: amount, p_change_amount: 0, p_operator_name: operatorName, p_origin_type: "qr_online", p_payment_group_id: groupId,
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
      // Pedido "segurado até pagar" ficou como rascunho esperando este momento: libera pra cozinha
      // (status new + tickets) antes de qualquer outra coisa. Delivery (Pix/cartão pelo app) pelo
      // delivery-write (também manda o WhatsApp); QR universal com "paga antes" pelo mesa-write.
      const releaseFn = o.status !== "draft" ? null
        : o.origin_type === "delivery" ? "delivery-write"
        : o.origin_type === "self_service" ? "mesa-write" : null;
      if (releaseFn) {
        try {
          const r = await fetch(`${supabaseUrl}/functions/v1/${releaseFn}`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey, "x-internal-key": internalKey },
            body: JSON.stringify({ action: "release_held_order", tenant_id: tenantId, order_id: a.order_id, payment_label: releaseLabel }),
          });
          log(r.ok ? "INFO" : "WARN", "release", "pedido segurado liberado pra cozinha", { order: a.order_id, fn: releaseFn, http: r.status, body: (await r.text().catch(() => "")).slice(0, 200) });
        } catch (e) { log("WARN", "release", "release_held_order falhou", { order: a.order_id, fn: releaseFn, error: String(e) }); }
      }
      if (fiscalOn) {
        fiscalJobs.push(fetch(`${supabaseUrl}/functions/v1/fiscal-write`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${anonKey}`, apikey: anonKey, "x-internal-key": internalKey },
          // Vários pedidos no mesmo pagamento = grupo = UMA NFC-e (a fiscal-write espera o grupo completar).
          body: JSON.stringify(groupId
            ? { action: "emit", tenant_id: tenantId, source_type: "payment_group", source_id: groupId, group_size: lancar.length, trigger: "online_payment" }
            : { action: "emit", tenant_id: tenantId, source_type: "order", source_id: a.order_id, trigger: "online_payment" }),
        }).then(async (r) => log("INFO", "fiscal", "emit", { order: a.order_id, http: r.status, body: (await r.text().catch(() => "")).slice(0, 200) }))
          .catch((e) => log("WARN", "fiscal", "falhou", { order: a.order_id, error: String(e) })));
      }
    }

    // Fluxo de caixa / recebível + taxa (mesma regra do caixa — ver postSaleFinance)
    try {
      await postSaleFinance(admin, {
        tenantId, pm, paymentId: String(paymentId), orderId: a.order_id, orderNumber: (o?.number as string) ?? null,
        amount, todayBR, channel: method === "pix" || isOnlineCard ? "online" : "maquininha",
        ...(isOnlineCard ? { bankAccountId: cardBank, receivableFee: pm.fee_percentage } : {}),
        ...(isOnlineMp ? { feeLabel: "Taxa Mercado Pago" } : {}),
      });
    } catch (e) { log("WARN", "settle", "financeiro da venda falhou (non-blocking)", { error: String(e) }); }
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
// pelo polling do cliente e pela confirmação manual do gerente. Aceita também a linha
// expirada/cancelada aqui: o cliente pode ter pago no último segundo (o polling expira antes do
// webhook chegar) — dinheiro recebido não pode ficar sem pedido pago.
async function reconcilePix(admin: Admin, token: string, px: Record<string, unknown>) {
  if (!["pending", "expired", "cancelled"].includes(String(px.status)) || !px.provider_payment_id) return { status: px.status as string };
  const r = await mpFetch(token, `/v1/payments/${px.provider_payment_id}`);
  if (!r.ok) { log("WARN", "reconcile", "GET payment falhou", { http: r.status, body: r.body }); return { status: String(px.status), provider_error: r.status }; }
  const mpStatus = String(r.body.status ?? "");
  const now = new Date().toISOString();
  if (mpStatus === "approved") {
    const expected = round2(Number(px.amount ?? 0));
    const got = round2(Number(r.body.transaction_amount ?? 0));
    if (Math.abs(expected - got) > 0.01) {
      log("ERROR", "reconcile", "valor divergente", { pixId: px.id, expected, got });
      await admin.from("fin_pix_payments").update({ error: `Valor pago (${got}) difere do cobrado (${expected})`, updated_at: now }).eq("id", px.id);
    }
    if (px.status !== "pending") log("WARN", "reconcile", "Pix aprovado depois de expirar/cancelar aqui — lançando", { pixId: px.id, local: px.status });
    await settlePix(admin, String(px.id), r.body, undefined, ["pending", "expired", "cancelled"]);
    return { status: "confirmed" };
  }
  if (["cancelled", "rejected", "refunded", "charged_back"].includes(mpStatus)) {
    const st = mpStatus === "cancelled" ? "cancelled" : "expired";
    await admin.from("fin_pix_payments").update({ status: st, raw_provider: r.body, updated_at: now }).eq("id", px.id).eq("status", "pending");
    return { status: st };
  }
  return { status: String(px.status) === "pending" ? "pending" : String(px.status) };
}

// Cartão (API de Orders): aplica o estado da order na nossa linha. Usado na criação (resposta
// síncrona), no webhook "order", no polling do cliente e na confirmação manual.
// deno-lint-ignore no-explicit-any
async function applyOrderResult(admin: Admin, px: Record<string, unknown>, order: Record<string, any>) {
  const st = String(order?.status ?? "");
  const pay = (order?.transactions?.payments ?? [])[0] ?? {};
  const detail = String(pay?.status_detail ?? order?.status_detail ?? "") || null;
  const now = new Date().toISOString();
  const open = ["pending", "expired"];
  if (st === "processed") {
    const expected = round2(Number(px.amount ?? 0));
    const got = round2(Number(order.total_amount ?? pay.amount ?? 0));
    await admin.from("fin_pix_payments").update({
      provider_status_detail: detail, card_brand: pay?.payment_method?.id ?? px.card_brand ?? null, updated_at: now,
      ...(Math.abs(expected - got) > 0.01 ? { error: `Valor aprovado (${got}) difere do cobrado (${expected})` } : {}),
    }).eq("id", px.id);
    if (Math.abs(expected - got) > 0.01) log("ERROR", "reconcile_order", "valor divergente", { chargeId: px.id, expected, got });
    // Expirou/cancelou/falhou aqui mas o banco aprovou (desafio concluído no limite, cliente desistiu no
    // mesmo instante, ou a resposta do POST se perdeu): o dinheiro entrou, então liquida mesmo assim.
    // Pedido que entretanto foi pago por outro caminho vira aviso "PAGO EM DOBRO" no settle.
    if (px.status !== "pending") log("WARN", "reconcile_order", "aprovado depois de sair de pendente aqui — lançando", { chargeId: px.id, local: px.status });
    await settlePix(admin, String(px.id), order, undefined, ["pending", "expired", "cancelled", "failed"]);
    return { status: "confirmed", status_detail: detail };
  }
  if (st === "action_required") {
    const url = pay?.payment_method?.transaction_security?.url ?? null;
    await admin.from("fin_pix_payments").update({ provider_status_detail: detail, ...(url ? { ticket_url: url } : {}), updated_at: now })
      .eq("id", px.id).in("status", open);
    return { status: "pending", status_detail: detail, challenge_url: url };
  }
  if (["failed", "canceled", "expired", "refunded", "charged_back"].includes(st)) {
    const local = st === "failed" ? "failed" : st === "canceled" ? "cancelled" : "expired";
    // Palavra final do MP: a varredura para de reconsultar (inclusive linha já cancelada aqui).
    await admin.from("fin_pix_payments").update({ provider_final: true, provider_status_detail: detail, updated_at: now }).eq("id", px.id);
    await admin.from("fin_pix_payments").update({ status: local, raw_provider: order, updated_at: now })
      .eq("id", px.id).in("status", open);
    return { status: local, status_detail: detail };
  }
  return { status: "pending", status_detail: detail }; // created / processing
}

async function reconcileOrder(admin: Admin, token: string, px: Record<string, unknown>) {
  // Aceita também a linha expirada/cancelada localmente: aprovação tardia do MP não pode virar dinheiro sem pedido pago.
  if (!["pending", "expired", "cancelled", "failed"].includes(String(px.status)) || !px.provider_payment_id) return { status: px.status as string };
  const r = await mpFetch(token, `/v1/orders/${px.provider_payment_id}`);
  if (!r.ok) { log("WARN", "reconcile_order", "GET order falhou", { http: r.status, body: r.body }); return { status: String(px.status), provider_error: r.status }; }
  return applyOrderResult(admin, px, r.body);
}

// Pix → API de Payments; cartão → API de Orders.
const reconcileCharge = (admin: Admin, token: string, px: Record<string, unknown>) =>
  isCardRow(px) ? reconcileOrder(admin, token, px) : reconcilePix(admin, token, px);

// Cancela cobranças pendentes conferindo antes no MP (a cobrança pode ter sido paga agora há pouco,
// com o webhook atrasado) e, no cartão, depois também (o MP só cancela enquanto espera o desafio do
// banco). Devolve true se alguma delas acabou paga — aí ela foi liquidada e não se cobra de novo.
async function cancelChargesChecking(admin: Admin, token: string, rows: Record<string, unknown>[]) {
  let algumaPaga = false;
  for (const old of rows) {
    const r = await reconcileCharge(admin, token, old);
    if (r.status === "confirmed") { algumaPaga = true; continue; }
    if (r.status !== "pending") continue;
    await admin.from("fin_pix_payments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", old.id).eq("status", "pending");
    await cancelAtProvider(token, old);
    if (isCardRow(old)) {
      const r2 = await reconcileOrder(admin, token, { ...old, status: "cancelled" });
      if (r2.status === "confirmed") algumaPaga = true;
    }
  }
  return algumaPaga;
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
  // payment = Pix (API de Payments); order = cartão (API de Orders, tópico "Order (Mercado Pago)" no painel).
  if (!tenantId || (type !== "payment" && type !== "order") || !dataId) return json({ ok: true, ignored: true });

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

  // Uma aplicação do MP tem UMA URL de webhook no painel (a de uma loja só). Se outra loja usa a mesma
  // conta, a cobrança é achada pelo id (único por provedor) e reconciliada com o token da loja DONA da linha.
  const tokenOf = async (rowTenant: string) => rowTenant === tenantId ? cfg.access_token! : ((await loadConfig(admin, rowTenant))?.access_token ?? null);
  const { data: px } = await admin.from("fin_pix_payments").select("*")
    .eq("provider", "mercadopago").eq("provider_payment_id", dataId).maybeSingle();
  if (!px) {
    // Pode ter chegado antes de gravarmos o provider_payment_id: tenta pelo external_reference.
    const r = await mpFetch(cfg.access_token, type === "order" ? `/v1/orders/${dataId}` : `/v1/payments/${dataId}`);
    // Sem conseguir ler o MP agora, 500: o MP reenvia (200 aqui encerraria a única pista da cobrança).
    if (!r.ok && (r.status >= 500 || r.status === 429)) return json({ ok: false, error: "provider_unavailable" }, 500);
    const ref = String(r.body?.external_reference ?? "");
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ref);
    const { data: px2 } = isUuid ? await admin.from("fin_pix_payments").select("*").eq("id", ref).eq("provider", "mercadopago").maybeSingle() : { data: null };
    if (!px2) {
      if (isUuid) log("ERROR", "webhook", "cobrança do MP sem linha aqui — conferir no painel do MP", { tenantId, dataId, ref, type });
      return json({ ok: true, ignored: "unknown_payment" });
    }
    // Tópico tem que bater com o tipo da cobrança: id de pagamento (tópico payment) numa linha de cartão
    // quebraria o GET /v1/orders para sempre.
    if ((type === "order") !== isCardRow(px2)) return json({ ok: true, ignored: "topic_mismatch" });
    if (!px2.provider_payment_id) await admin.from("fin_pix_payments").update({ provider_payment_id: dataId }).eq("id", px2.id);
    const tk2 = await tokenOf(String(px2.tenant_id));
    if (!tk2) return json({ ok: true, ignored: "no_config" });
    const res = await reconcileCharge(admin, tk2, { ...px2, provider_payment_id: dataId });
    return json({ ok: true, ...res });
  }
  const tk = await tokenOf(String(px.tenant_id));
  if (!tk) return json({ ok: true, ignored: "no_config" });
  const res = await reconcileCharge(admin, tk, px);
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
      // public_key é pública por definição (vai no navegador para o formulário do cartão).
      return json({ enabled: isEnabled(cfg), card_enabled: isCardEnabled(cfg), public_key: isCardEnabled(cfg) ? cfg!.public_key : null });
    }

    if (action === "get_bill") {
      const auth = await resolveCustomer(admin, body, { allowClosed: true });
      if (auth.error) return auth.error;
      const { participant, session, tenantId: billTenantId, tableSessionId } = auth;
      const cfg = await loadConfig(admin, billTenantId!);
      const orders = await loadBill(admin, { tableSessionId: tableSessionId ?? null, participantId: participant?.id ?? null, orderId: auth.orderId }, participant?.id ?? null);
      // Pix pendente (o painel do Pix retoma o QR) e cartão pendente (desafio do banco em andamento)
      // vêm separados: um não pode ser retomado como se fosse o outro.
      const { data: pendings } = await ownerFilter(admin.from("fin_pix_payments").select("*"), auth).eq("status", "pending")
        .order("created_at", { ascending: false }).limit(5);
      const pending = (pendings ?? []).find((r: Record<string, unknown>) => !isCardRow(r)) ?? null;
      const pendingCard0 = (pendings ?? []).find((r: Record<string, unknown>) => isCardRow(r)) ?? null;
      const px = pending ? await expireIfNeeded(admin, pending) : null;
      const pxCard = pendingCard0 ? await expireIfNeeded(admin, pendingCard0) : null;
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
        card_enabled: isCardEnabled(cfg), public_key: isCardEnabled(cfg) ? cfg!.public_key : null,
        pending_card: pxCard && pxCard.status === "pending" ? pixPublic(pxCard) : null,
        customer_cpf: (cpfRow?.customer_cpf as string | null) ?? null,
        participant: participant ? { id: participant.id, name: participant.name } : { id: auth.orderId, name: auth.customerName ?? "" },
        mode: tableSessionId ? "table" : auth.orderId ? "delivery" : "queue",
        payments_history: paymentsHistory,
        session_closed: session ? session.status !== "open" : false,
        orders, pending_pix: px && px.status === "pending" ? pixPublic(px) : null,
        last_pix: lastOk ? pixPublic(lastOk) : null,
      });
    }

    if (action === "create_pix" || action === "create_card") {
      const isCard = action === "create_card";
      const auth = await resolveCustomer(admin, body);
      if (auth.error) return auth.error;
      const { participant, tenantId: pixTenantId, tableSessionId } = auth;
      const tenantId = pixTenantId!;
      const cfg = await loadConfig(admin, tenantId);
      if (!isEnabled(cfg)) return json({ error: "Pagamento online não está disponível nesta loja" }, 422);
      if (isCard && !isCardEnabled(cfg)) return json({ error: "card_disabled", message: "Pagamento com cartão não está disponível nesta loja." }, 422);
      // Na fila por senha só existe a própria conta — "mesa inteira" não faz sentido.
      const scope = (tableSessionId && body.scope === "all") ? "all" : "mine";

      // Cartão: token de uso único do Card Payment Brick (os dados do cartão nunca passam por aqui).
      // Só CRÉDITO e só À VISTA (decisão do dono, 2026-10-03): débito/pré-pago recusados aqui também,
      // não só no formulário.
      const cardToken = String(body.card_token ?? "").trim();
      const cardBrand = String(body.payment_method_id ?? "").trim().toLowerCase();
      const cardType = String(body.payment_type ?? "credit_card").trim();
      if (isCard) {
        if (!cardToken || !/^[a-z_]{2,20}$/.test(cardBrand)) return json({ error: "invalid_card", message: "Dados do cartão incompletos. Preencha de novo." }, 400);
        if (cardType !== "credit_card" || cardBrand.startsWith("deb")) return json({ error: "card_type_not_allowed", message: "Aceitamos só cartão de crédito. Para pagar no débito, use o Pix." }, 422);
        // Sem a forma "Cartão de Crédito" ativa a venda não teria onde ser lançada: não cobra.
        const { count: pmCount } = await admin.from("payment_methods").select("id", { count: "exact", head: true })
          .eq("tenant_id", tenantId).eq("type", "credit_card").eq("is_active", true).is("deleted_at", null);
        if (!pmCount) { log("ERROR", "create_card", "loja sem forma credit_card ativa", { tenantId }); return json({ error: "card_disabled", message: "Pagamento com cartão indisponível nesta loja no momento. Use o Pix." }, 422); }
        // Freio contra teste de cartão roubado (endpoint público): recusas demais do mesmo cliente
        // ou da loja num intervalo curto bloqueiam o cartão por um tempo — o Pix continua.
        const desde30 = new Date(Date.now() - 30 * 60 * 1000).toISOString();
        const desde10 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
        const [{ count: falhasCliente }, { count: falhasLoja }] = await Promise.all([
          ownerFilter(admin.from("fin_pix_payments").select("id", { count: "exact", head: true }), auth)
            .eq("method", "credit_card").eq("status", "failed").gt("created_at", desde30),
          admin.from("fin_pix_payments").select("id", { count: "exact", head: true })
            .eq("tenant_id", tenantId).eq("method", "credit_card").eq("status", "failed").gt("created_at", desde10),
        ]);
        if ((falhasCliente ?? 0) >= 5 || (falhasLoja ?? 0) >= 15) {
          log("WARN", "create_card", "freio de tentativas acionado", { tenantId, falhasCliente, falhasLoja });
          return json({ error: "too_many_attempts", message: "Muitas tentativas com cartão recusadas. Pague com Pix ou tente de novo mais tarde." }, 429);
        }
      }

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
      if (isCard && amount < 1) return json({ error: "min_amount", message: "Pagamento com cartão a partir de R$ 1,00. Use o Pix." }, 422);

      // Guarda o CPF nos pedidos que este pagamento vai quitar: a fiscal-write lê orders.customer_cpf
      // ao emitir a NFC-e quando o pagamento confirmar.
      if (cpfNota) {
        const { error: cpfErr } = await admin.from("orders").update({ customer_cpf: cpfNota })
          .in("id", target.map((o) => o.id)).eq("tenant_id", tenantId);
        if (cpfErr) log("ERROR", action, "não gravou o CPF na nota", { error: cpfErr.message, orders: target.length });
        else log("INFO", action, "CPF na nota gravado", { orders: target.length });
      }

      // Uma cobrança pendente por participante/pedido. Cartão com outra cobrança de cartão em andamento
      // (POST ainda no ar ou desafio do banco aberto) é recusado: o app cancela antes ("Usar outro cartão"),
      // senão um duplo envio cobraria duas vezes.
      const { data: olds } = await ownerFilter(admin.from("fin_pix_payments").select("*"), auth).eq("status", "pending");
      if (isCard && (olds ?? []).some((r: Record<string, unknown>) => isCardRow(r))) {
        return json({ error: "card_in_progress", message: "Já existe um pagamento com cartão em andamento. Aguarde a resposta ou toque em \"Usar outro cartão\"." }, 409);
      }
      // A anterior pode ter sido paga agora há pouco (webhook atrasado): confere no MP antes de cancelar.
      // Se pagou, liquida e não cobra de novo. Trocar de Pix para cartão (e vice-versa) passa por aqui.
      if (await cancelChargesChecking(admin, cfg!.access_token!, olds ?? [])) {
        return json({ error: "nothing_to_pay", message: "Seu pagamento anterior acabou de ser confirmado." }, 422);
      }

      const expiresAt = new Date(Date.now() + (isCard ? CARD_EXPIRATION_MIN : PIX_EXPIRATION_MIN) * 60 * 1000);
      const allocation = target.map((o) => ({ order_id: o.id, amount: o.remaining, number: o.number }));
      // O id nasce aqui (chave de idempotência + external_reference). Pix: a linha só é gravada como
      // "pending" DEPOIS do provedor aceitar — assim uma recusa não deixa Pix fantasma travando pedidos.
      // Cartão: grava ANTES (o MP cobra dentro do próprio POST; sem linha, uma resposta perdida
      // viraria dinheiro sem rastro — o webhook acha a linha pelo external_reference).
      const pixId = crypto.randomUUID();
      const baseRow = {
        id: pixId, tenant_id: tenantId, provider: "mercadopago", txid: `MP${isCard ? "C" : ""}${Date.now()}${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
        amount, expires_at: expiresAt.toISOString(),
        table_session_id: tableSessionId ?? null, participant_id: participant?.id ?? null, scope, allocation,
        order_id: allocation.length === 1 ? allocation[0].order_id : null,
        pix_key: "mercadopago", pix_key_type: "provider", beneficiary_name: cfg!.account_label ?? "Mercado Pago", city: "-",
        ...(isCard ? {
          method: "credit_card", installments: 1, card_brand: cardBrand,
          card_last4: /^\d{4}$/.test(String(body.card_last4 ?? "")) ? String(body.card_last4) : null,
        } : {}),
      };

      const { data: tbl } = auth.tableId ? await admin.from("tables").select("number").eq("id", auth.tableId).maybeSingle() : { data: null };
      const { data: tenant } = await admin.from("tenants").select("name").eq("id", tenantId).maybeSingle();
      const alvoLabel = tbl?.number != null ? `Mesa ${tbl.number}` : participant ? `Senha ${participant.access_token ?? ""}`.trim() : `Delivery ${auth.orderNumber ?? ""}`.trim();
      const nameParts = String(participant?.name ?? auth.customerName ?? "Cliente").trim().split(/\s+/);
      const payerKey = participant?.id ?? auth.orderId;

      if (isCard) {
        // ── Cartão: API de Orders, processamento automático (a resposta já traz o resultado) ──
        const payerIn = (body.payer ?? {}) as { email?: unknown; identification?: { type?: unknown; number?: unknown } };
        const email = String(payerIn.email ?? "").trim();
        const docNum = String(payerIn.identification?.number ?? "").replace(/\D/g, "");
        const docType = String(payerIn.identification?.type ?? (docNum.length === 14 ? "CNPJ" : "CPF")).toUpperCase();
        const payer: Record<string, unknown> = {
          email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : `${payerKey}@cliente.erpos.app`,
          first_name: nameParts[0] || "Cliente", last_name: nameParts.slice(1).join(" ") || "Cliente",
          ...(docNum && isValidCpfCnpj(docNum) ? { identification: { type: docType === "CNPJ" ? "CNPJ" : "CPF", number: docNum } } : {}),
        };
        const deviceId = String(body.device_id ?? "").trim().slice(0, 200);
        const orderBody = (with3ds: boolean) => JSON.stringify({
          type: "online", processing_mode: "automatic", external_reference: pixId,
          total_amount: amount.toFixed(2), payer,
          // 3DS quando o MP vê risco: com o desafio do banco, a contestação de cartão roubado
          // vai para a bandeira, não para a loja (liability shift).
          ...(with3ds ? { config: { online: { transaction_security: { validation: "on_fraud_risk", liability_shift: "required" } } } } : {}),
          transactions: { payments: [{ amount: amount.toFixed(2), payment_method: { id: cardBrand, type: "credit_card", token: cardToken, installments: 1 } }] },
        });
        const headers = (key: string) => ({ "X-Idempotency-Key": key, ...(deviceId ? { "X-meli-session-id": deviceId } : {}) });

        const { data: row0, error: ins0 } = await admin.from("fin_pix_payments").insert({ ...baseRow, status: "pending", emv_payload: "" }).select("*").single();
        if (ins0 || !row0) throw ins0 ?? new Error("insert fin_pix_payments falhou"); // nada foi cobrado ainda

        // Resposta perdida/indefinida: a linha fica pendente — o webhook "order" (pelo external_reference),
        // a varredura e o polling do app resolvem. Nunca marcar como recusado sem o MP dizer.
        const semResposta = async (motivo: string, extra?: unknown) => {
          await admin.from("fin_pix_payments").update({ error: `Sem resposta definitiva do MP (${motivo}) — aguardando confirmação`, raw_provider: extra ?? null, updated_at: new Date().toISOString() }).eq("id", pixId);
          log("ERROR", "create_card", "resposta indefinida do MP — cobrança fica pendente", { chargeId: pixId, motivo });
          const { data: f } = await admin.from("fin_pix_payments").select("*").eq("id", pixId).maybeSingle();
          return json({ pix: pixPublic(f ?? row0), challenge_url: null });
        };

        let mp: Awaited<ReturnType<typeof mpFetch>>;
        try {
          mp = await mpFetch(cfg!.access_token!, "/v1/orders", { method: "POST", headers: headers(pixId), body: orderBody(true) });
          if (!mp.ok && mp.status === 400 && JSON.stringify(mp.body).includes("transaction_security")) {
            // Conta sem 3DS liberado: o MP recusa a requisição inteira (nada foi cobrado). Tenta sem.
            log("WARN", "create_card", "MP recusou o 3DS; tentando sem", { body: mp.body });
            mp = await mpFetch(cfg!.access_token!, "/v1/orders", { method: "POST", headers: headers(crypto.randomUUID()), body: orderBody(false) });
          }
        } catch (e) {
          return await semResposta(String(e));
        }
        // deno-lint-ignore no-explicit-any
        const b = mp.body as Record<string, any>;
        // Recusa do cartão pode vir com HTTP de erro e a order dentro de `data` (ou na raiz).
        // deno-lint-ignore no-explicit-any
        const ord: Record<string, any> | null = b?.id ? b : b?.data?.id ? b.data : null;
        const errDetail = String(b?.errors?.[0]?.details?.[0] ?? b?.errors?.[0]?.code ?? b?.message ?? "");
        if (!ord) {
          if (mp.status >= 500 || mp.status === 0) return await semResposta(`HTTP ${mp.status}`, b);
          // 4xx sem order = o MP recusou a requisição (nada cobrado): validação ou recusa do cartão.
          const msg = errDetail || JSON.stringify(b).slice(0, 300);
          const rejected = isCardRejectDetail(errDetail) || mp.status === 402;
          await admin.from("fin_pix_payments").update({ status: "failed", error: `MP ${mp.status}: ${msg}`, raw_provider: b, provider_status_detail: errDetail || null, updated_at: new Date().toISOString() }).eq("id", pixId).eq("status", "pending");
          log("ERROR", "create_card", "MP recusou a requisição", { http: mp.status, body: b });
          return json({ error: rejected ? "card_rejected" : "provider_error", message: rejected ? cardRejectMessage(errDetail) : "Não foi possível processar o cartão agora. Tente de novo ou pague com Pix.", detail: msg }, rejected ? 422 : 502);
        }
        await admin.from("fin_pix_payments").update({ provider_payment_id: String(ord.id), raw_provider: { id: ord.id, status: ord.status, status_detail: ord.status_detail } }).eq("id", pixId);
        const res = await applyOrderResult(admin, { ...row0, provider_payment_id: String(ord.id) }, ord);
        const { data: fresh } = await admin.from("fin_pix_payments").select("*").eq("id", pixId).maybeSingle();
        log("INFO", "create_card", "processado", { chargeId: pixId, order: ord.id, status: res.status, detail: res.status_detail, amount, orders: allocation.length });
        return json({ pix: pixPublic(fresh ?? row0), challenge_url: (res as { challenge_url?: string | null }).challenge_url ?? null });
      }

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
      // Expirado aqui ainda é consultado: o cliente pode ter pago no limite (Pix) ou concluído o desafio (cartão).
      if ((px.status === "pending" || px.status === "expired") && body.reconcile) {
        const cfg = await loadConfig(admin, auth.tenantId!);
        if (cfg?.access_token) {
          await reconcileCharge(admin, cfg.access_token, px);
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
      const { data: px } = await ownerFilter(admin.from("fin_pix_payments").select("*").eq("id", pixId), auth).maybeSingle();
      if (!px) return json({ error: "Pagamento não encontrado" }, 404);
      if (px.status !== "pending") return json({ ok: true, status: px.status });
      await admin.from("fin_pix_payments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", pixId).eq("status", "pending");
      const cfg = await loadConfig(admin, auth.tenantId!);
      if (cfg?.access_token) {
        await cancelAtProvider(cfg.access_token, px);
        // Cartão: o MP só cancela enquanto espera o desafio do banco. Se aprovou no mesmo instante,
        // a consulta traz a linha de volta e lança o pagamento (ver applyOrderResult).
        if (isCardRow(px)) {
          const r = await reconcileOrder(admin, cfg.access_token, { ...px, status: "cancelled" });
          if (r.status === "confirmed") return json({ ok: true, status: "confirmed" });
        }
      }
      return json({ ok: true, status: "cancelled" });
    }

    // ── Cliente desiste do pedido que ainda não pagou (delivery, pedido segurado) ──
    // Só rascunho (fora da cozinha) e sem pagamento lançado. Antes, confere no MP as cobranças
    // pendentes: se alguma acabou de ser paga, liquida e o pedido NÃO é cancelado.
    if (action === "cancel_held_order") {
      const auth = await resolveCustomer(admin, body, { allowClosed: true });
      if (auth.error) return auth.error;
      if (!auth.orderId) return json({ error: "so_delivery", message: "Só dá para cancelar assim um pedido do delivery." }, 400);
      const tenantId = auth.tenantId!;
      const { data: o } = await admin.from("orders").select("id, status, is_draft, is_paid")
        .eq("id", auth.orderId).eq("tenant_id", tenantId).maybeSingle();
      if (!o) return json({ error: "Pedido não encontrado" }, 404);
      if (o.status !== "draft" && !o.is_draft) {
        return json({ error: "ja_na_cozinha", message: "Este pedido já foi para a cozinha. Para cancelar, fale com a loja." }, 409);
      }
      const { data: pagos } = await admin.from("payments").select("id").eq("order_id", o.id).eq("is_refunded", false).limit(1);
      if (o.is_paid || (pagos ?? []).length > 0) return json({ error: "pedido_pago", message: "Este pedido já foi pago. Fale com a loja." }, 409);

      const { data: pend } = await ownerFilter(admin.from("fin_pix_payments").select("*"), auth).eq("status", "pending");
      if ((pend ?? []).length > 0) {
        const cfg = await loadConfig(admin, tenantId);
        let pago = false;
        if (cfg?.access_token) pago = await cancelChargesChecking(admin, cfg.access_token, pend ?? []);
        else for (const r of pend ?? []) await admin.from("fin_pix_payments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "pending");
        if (pago) return json({ error: "pedido_pago", message: "Seu pagamento acabou de ser confirmado — o pedido foi para a cozinha." }, 409);
      }

      const agora = new Date().toISOString();
      // Só cancela se continuar segurado (o pagamento pode ter liberado o pedido neste meio-tempo)
      const { data: cancelados, error: upErr } = await admin.from("orders")
        .update({ status: "cancelled", cancel_reason: "Cancelado pelo cliente antes de pagar (app)", cancelled_at: agora, updated_at: agora })
        .eq("id", o.id).eq("tenant_id", tenantId).or("status.eq.draft,is_draft.eq.true").eq("is_paid", false)
        .select("id");
      if (upErr) throw upErr;
      if (!cancelados || cancelados.length === 0) {
        return json({ error: "pedido_pago", message: "Seu pagamento acabou de ser confirmado — o pedido foi para a cozinha." }, 409);
      }
      await admin.from("order_items").update({ status: "cancelled" }).eq("order_id", o.id).neq("status", "cancelled");
      log("INFO", "cancel_held_order", "pedido segurado cancelado pelo cliente", { orderId: o.id, cobrancas: (pend ?? []).length });
      return json({ ok: true });
    }

    // ── Varredura (cron fn_online_card_sweep, chave interna) ──────────────────
    // Cartão cujo resultado não chegou por nenhum caminho (aba fechada no meio do desafio do banco,
    // order em análise, webhook "Order" fora do ar): reconsulta no MP as cobranças de cartão em
    // aberto das últimas 48 h. Aprovado → liquida (pedido segurado vai pra cozinha).
    if (action === "sweep_cards") {
      const internalKey = Deno.env.get("FISCAL_INTERNAL_KEY") ?? "";
      if (!internalKey || req.headers.get("x-internal-key") !== internalKey) return json({ error: "Unauthorized" }, 401);
      const desde = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      // Inclui cancelada/expirada só do NOSSO lado (o MP ainda pode aprovar) até o MP dar a palavra final
      // (provider_final). Pendentes primeiro.
      const { data: rows } = await admin.from("fin_pix_payments").select("*")
        .eq("provider", "mercadopago").eq("method", "credit_card").in("status", ["pending", "expired", "cancelled"])
        .eq("provider_final", false).not("provider_payment_id", "is", null).gt("created_at", desde)
        .order("status", { ascending: false }).order("created_at", { ascending: true }).limit(50);
      const tokens = new Map<string, string | null>();
      let confirmados = 0;
      for (const r of rows ?? []) {
        const t = String(r.tenant_id);
        if (!tokens.has(t)) tokens.set(t, (await loadConfig(admin, t))?.access_token ?? null);
        const tk = tokens.get(t);
        if (!tk) continue;
        const r2 = await reconcileOrder(admin, tk, r);
        if (r2.status === "confirmed") confirmados++;
      }
      // Resposta do POST perdida (sem id da order): só o webhook acha pelo external_reference. Fica no log.
      const { data: orfas } = await admin.from("fin_pix_payments").select("id, tenant_id, amount, created_at")
        .eq("provider", "mercadopago").eq("method", "credit_card").eq("status", "pending").is("provider_payment_id", null)
        .gt("created_at", desde).lt("created_at", new Date(Date.now() - 5 * 60 * 1000).toISOString()).limit(20);
      if ((orfas ?? []).length) log("ERROR", "sweep_cards", "cobrança de cartão sem resposta do MP há mais de 5 min — conferir no painel do MP", { orfas });
      return json({ ok: true, checked: (rows ?? []).length, confirmed: confirmados, sem_resposta: (orfas ?? []).length });
    }

    // ── Staff ────────────────────────────────────────────────────────────────
    const tenantId = String(body.tenant_id ?? "");
    if (!tenantId) return json({ error: "tenant_id is required" }, 400);
    const member = await requireMember(req, admin, tenantId);
    if (member.error) return member.error;
    const webhookUrl = `${supabaseUrl}/functions/v1/online-payments?webhook=1&tenant_id=${tenantId}`;

    // PDV: o cliente da senha desistiu de pagar pelo celular e veio ao caixa. Antes de receber, cancela
    // as cobranças online pendentes do pedido — conferindo no MP se alguma já foi paga (paid: true).
    if (action === "cancel_order_charges") {
      const orderId = String(body.order_id ?? "");
      if (!orderId) return json({ error: "order_id obrigatório" }, 400);
      const cfg = await loadConfig(admin, tenantId);
      const { data: pend } = await admin.from("fin_pix_payments").select("*")
        .eq("tenant_id", tenantId).eq("provider", "mercadopago").eq("status", "pending");
      const alvo = (pend ?? []).filter((r: Record<string, unknown>) => r.order_id === orderId
        || ((r.allocation as { order_id: string }[] | null) ?? []).some((a) => a.order_id === orderId));
      let pago = false;
      if (cfg?.access_token) pago = await cancelChargesChecking(admin, cfg.access_token, alvo);
      else for (const r of alvo) await admin.from("fin_pix_payments").update({ status: "cancelled", updated_at: new Date().toISOString() }).eq("id", r.id).eq("status", "pending");
      log("INFO", "cancel_order_charges", "cobranças do pedido canceladas pelo caixa", { orderId, n: alvo.length, pago, by: member.userId });
      return json({ ok: true, paid: pago, cancelled: alvo.length });
    }

    if (action === "get_config") {
      const cfg = await loadConfig(admin, tenantId);
      return json({
        configured: Boolean(cfg?.access_token), is_active: Boolean(cfg?.is_active), has_webhook_secret: Boolean(cfg?.webhook_secret),
        access_token_hint: cfg?.access_token ? `…${cfg.access_token.slice(-6)}` : null, public_key: cfg?.public_key ?? null,
        account_id: cfg?.account_id ?? null, account_label: cfg?.account_label ?? null, last_test_at: cfg?.last_test_at ?? null, webhook_url: webhookUrl,
        card_enabled: Boolean(cfg?.card_enabled), card_fee_percentage: cfg?.card_fee_percentage ?? null, card_days_to_receive: cfg?.card_days_to_receive ?? null,
        card_bank_account_id: cfg?.card_bank_account_id ?? null, pix_fee_percentage: cfg?.pix_fee_percentage ?? null,
      });
    }

    if (action === "save_config") {
      if (!isManager(member.role)) return json({ error: "Somente administrador ou gerente" }, 403);
      const cfg = await loadConfig(admin, tenantId);
      const patch: Record<string, unknown> = { tenant_id: tenantId, provider: "mercadopago", updated_at: new Date().toISOString() };
      const newToken = typeof body.access_token === "string" && body.access_token.trim() ? body.access_token.trim() : null;
      const token = newToken ?? cfg?.access_token ?? null;
      if (typeof body.webhook_secret === "string") patch.webhook_secret = body.webhook_secret.trim() || null;
      if (typeof body.public_key === "string") {
        const pk = body.public_key.trim();
        // Chave pública de PRODUÇÃO (APP_USR-…); a de teste (TEST-…) não cobra de verdade.
        if (pk && !/^(APP_USR|TEST)-[0-9a-f-]{20,}$/i.test(pk)) return json({ error: "Chave pública inválida. Copie a Public Key de Credenciais de produção (começa com APP_USR-)." }, 422);
        patch.public_key = pk || null;
      }
      if (typeof body.is_active === "boolean") patch.is_active = body.is_active;
      if (typeof body.card_enabled === "boolean") patch.card_enabled = body.card_enabled;
      const LIMITE_MSG: Record<string, string> = {
        card_fee_percentage: "Taxa do cartão deve ficar entre 0 e 20%",
        card_days_to_receive: "Prazo do cartão deve ficar entre 0 e 60 dias",
        pix_fee_percentage: "Taxa do Pix deve ficar entre 0 e 10%",
      };
      for (const [k, max] of [["card_fee_percentage", 20], ["card_days_to_receive", 60], ["pix_fee_percentage", 10]] as const) {
        if (body[k] === null || body[k] === "") patch[k] = null;
        else if (body[k] !== undefined) {
          const n = Number(body[k]);
          if (!Number.isFinite(n) || n < 0 || n > max) return json({ error: LIMITE_MSG[k] }, 422);
          patch[k] = k === "card_days_to_receive" ? Math.round(n) : n;
        }
      }
      // Conta do Mercado Pago no financeiro (onde o dinheiro do cartão online cai). Vazio = não credita banco.
      if (body.card_bank_account_id === null || body.card_bank_account_id === "") patch.card_bank_account_id = null;
      else if (typeof body.card_bank_account_id === "string") {
        const { data: conta } = await admin.from("fin_bank_accounts").select("id").eq("id", body.card_bank_account_id).eq("tenant_id", tenantId).maybeSingle();
        if (!conta) return json({ error: "Conta bancária não encontrada nesta loja" }, 422);
        patch.card_bank_account_id = conta.id;
      }
      const pkFinal = patch.public_key !== undefined ? patch.public_key : cfg?.public_key;
      if (patch.card_enabled === true && !pkFinal) return json({ error: "Informe a Public Key antes de ligar o cartão" }, 422);
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
      return json({ ok: true, is_active: Boolean(fresh?.is_active), card_enabled: Boolean(fresh?.card_enabled), account_label: fresh?.account_label ?? null, account_id: fresh?.account_id ?? null, webhook_url: webhookUrl });
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
      // Cartão expirado/cancelado/recusado aqui ainda pode ter sido aprovado no MP (desafio no limite,
      // resposta perdida): o gerente consegue reconsultar. "Na força" continua só para pendente.
      const reconsulta = px.status === "pending" || (isCardRow(px) && ["expired", "cancelled", "failed"].includes(String(px.status)));
      if (!reconsulta) return json({ ok: true, status: px.status });
      const cfg = await loadConfig(admin, tenantId);
      if (cfg?.access_token && px.provider_payment_id) {
        const r = await reconcileCharge(admin, cfg.access_token, px);
        if (r.status === "confirmed") return json({ ok: true, status: "confirmed", via: "provider" });
      }
      if (px.status !== "pending") return json({ ok: false, status: px.status, message: "O Mercado Pago não aprovou este pagamento." });
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

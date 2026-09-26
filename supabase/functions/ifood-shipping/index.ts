// ifood-shipping — iFood Entregas (módulo Shipping, "Sob Demanda") para pedidos de delivery do ERPOS.
//
// App do iFood SEPARADO do financeiro: "ERPOS PDV" (categoria PDV, distribuído), com Client ID/Secret
// e autorizações próprias (ifood_pdv_config / ifood_pdv_auths). Doc: IFOOD-SHIPPING.md (raiz do repo).
//
// Fluxo de um pedido: prepare (monta o formulário a partir do pedido) → quote (cotação; ~24 h) →
// create (registra o pedido no iFood e aloca o entregador; 202 assíncrono) → eventos pelo polling
// (a cada 30 s, cron ifood-shipping-poll) atualizam status, código de entrega e o pedido do ERPOS.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_config                                      qualquer pessoa da loja (sem segredos)
//   save_config    { client_id, client_secret? }    admin/gerente
//   set_options    { homologation_mode?, shipping_enabled?, default_prep_min?, shipping_merchant_id? }
//   request_user_code / confirm_authorization { authorization_code } / delete_config   admin/gerente
//   prepare        { order_id }                     formulário pré-preenchido (endereço, telefone, itens, pagamento)
//   quote          { order_id, lat, lng }           GET shipping/v1.0/merchants/{m}/deliveryAvailabilities
//   create         { order_id, quote_id, customer, address, payment, prep_min }
//   cancel_reasons { shipping_id }                  motivos dinâmicos (proibido fixar no código — homologação)
//   cancel         { shipping_id, code, reason }
//   address_change { shipping_id, accept }          aceitar/recusar troca de endereço pedida pelo cliente (15 min)
//   tracking       { shipping_id }                  posição do entregador + safe delivery score
//   poll                                            busca eventos agora (tela)
//   poll_all                                        (interno) cron a cada 30 s
//
// Autenticação: JWT do usuário (vínculo em user_tenants) OU header x-internal-key = FISCAL_INTERNAL_KEY.
// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { isContabilidadeRole, isManagerRole } from '../_shared/tenant-auth.ts';
import { ACTIVE, buildItems as buildItemsPure, cut, eventName, norm, onlyDigits, paymentFromNotes, planEvent, round2, splitPhone, type OrderSignal } from './core.ts';

type Admin = SupabaseClient;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const errResp = (msg: string, status = 400, extra: Record<string, unknown> = {}) => json({ success: false, error: msg, ...extra }, status);
const log = (level: string, action: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, fn: 'ifood-shipping', action, msg, ...extra }));

const API = 'https://merchant-api.ifood.com.br';

// ── API do iFood ─────────────────────────────────────────────────────────────
// Backoff exponencial com jitter em 429/5xx (1s, 2s, 4s, 8s; respeita Retry-After) e header de
// homologação quando ligado — ambos exigidos nos critérios de homologação do Shipping.
// Só repete o que é seguro repetir (GET, token, acknowledgment): POST que chama/cancela entregador vai
// uma vez só — um 5xx pode ter sido aceito do lado do iFood e repetir chamaria dois entregadores.
// Falha de rede vira status 0 (resposta incerta).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function ifoodFetch(path: string, init: RequestInit, homolog: boolean, maxAttempts = 4) {
  const headers = new Headers(init.headers);
  if (homolog) headers.set('x-request-homologation', 'true');
  for (let attempt = 0; ; attempt++) {
    let r: Response;
    try { r = await fetch(API + path, { ...init, headers, signal: AbortSignal.timeout(20_000) }); }
    catch (e) {
      if (attempt < maxAttempts - 1) { await sleep(Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 300); continue; }
      return { ok: false, status: 0, data: null, raw: String((e as Error)?.message ?? e) };
    }
    if ((r.status === 429 || r.status >= 500) && attempt < maxAttempts - 1) {
      const ra = Number(r.headers.get('retry-after'));
      log('WARN', 'http', 'retentativa', { path, status: r.status, attempt });
      await sleep(ra > 0 ? Math.min(ra * 1000, 15_000) : Math.min(8000, 1000 * 2 ** attempt) + Math.random() * 300);
      continue;
    }
    const raw = r.status === 204 ? '' : await r.text();
    let data: any = null;
    try { data = raw ? JSON.parse(raw) : null; } catch { /* texto */ }
    return { ok: r.ok, status: r.status, data, raw };
  }
}
const ifoodForm = (path: string, form: Record<string, string>, homolog = false) =>
  ifoodFetch(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form).toString() }, homolog);
function apiError(r: { status: number; data: any; raw: string }, what: string) {
  const d = r.data?.error?.message ?? r.data?.message ?? r.data?.error_description ?? r.data?.error ?? r.raw;
  const code = r.data?.error?.code ?? r.data?.code ?? null;
  return `${what}: iFood respondeu ${r.status}${code ? ' (' + code + ')' : ''}${d ? ' — ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 220) : ''}`;
}
const errCode = (r: { data: any }) => String(r.data?.error?.code ?? r.data?.code ?? '');

// Mensagens em português para os códigos de erro da cotação/registro (doc "Pedidos fora da plataforma").
const ERROS: Record<string, string> = {
  BadRequestMerchant: 'A loja está indisponível no iFood (confira se está aberta no Gestor de Pedidos).',
  DeliveryDistanceTooHigh: 'Endereço longe demais para o iFood Entrega (mais de ~10 km).',
  OffOpeningHours: 'O iFood Entrega está fora do horário de operação agora.',
  OriginNotFound: 'A loja não está cadastrada na área de logística do iFood.',
  ServiceAreaMismatch: 'Esse endereço fica fora da área atendida pelo iFood Entrega.',
  HighDemand: 'Muita demanda no iFood agora — tente de novo em alguns minutos.',
  MerchantStatusAvailability: 'A conta da loja no iFood tem pendências (fale com o suporte do iFood).',
  InvalidPaymentMethods: 'Forma de pagamento não aceita pelo entregador do iFood.',
  PaymentMethodNotFound: 'Forma de pagamento não aceita pelo entregador do iFood.',
  PaymentTotalInvalid: 'O valor do pagamento não bate com itens + taxa de entrega.',
  NRELimitExceeded: 'Limite de entregas simultâneas atingido — espere uma terminar.',
  UnavailableFleet: 'Sem entregadores disponíveis agora — tente de novo em alguns minutos.',
  MerchantEasyDeliveryDisabled: 'O iFood Entrega (Sob Demanda) não está ativo para esta loja no iFood.',
  BadRequestCustomer: 'Nome ou telefone do cliente inválido para o iFood.',
};
const msgErro = (r: { status: number; data: any; raw: string }, what: string) => ERROS[errCode(r)] ?? apiError(r, what);

// ── Token (renova 5 min antes de vencer; 401 força renovação) ────────────────
async function getToken(admin: Admin, cfg: any, auth: any): Promise<string> {
  if (auth.access_token && auth.token_expires_at && new Date(auth.token_expires_at).getTime() - Date.now() > 5 * 60_000) return auth.access_token;
  // App centralizado (app de teste "C" do iFood, já liberado na loja de teste): client_credentials, sem código.
  const centralized = cfg.app_type === 'centralized';
  if (!centralized && !auth.refresh_token) throw new Error('A loja precisa autorizar de novo o app ERPOS PDV no Portal do Parceiro.');
  const r = await ifoodForm('/authentication/v1.0/oauth/token', centralized
    ? { grantType: 'client_credentials', clientId: cfg.client_id, clientSecret: cfg.client_secret }
    : { grantType: 'refresh_token', clientId: cfg.client_id, clientSecret: cfg.client_secret, refreshToken: auth.refresh_token },
    cfg.homologation_mode === true);
  if (!r.ok || !r.data?.accessToken) throw new Error(apiError(r, 'Renovar acesso'));
  const upd = {
    access_token: r.data.accessToken,
    refresh_token: r.data.refreshToken ?? auth.refresh_token,
    token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  await admin.from('ifood_pdv_auths').update(upd).eq('id', auth.id);
  Object.assign(auth, upd);
  return upd.access_token;
}

// Contexto de chamada da loja: config + a autorização mais recente que enxerga a loja do iFood escolhida.
type Ctx = { cfg: any; auth: any; merchantId: string };
async function loadCtx(admin: Admin, cfg: any): Promise<Ctx | null> {
  if (!cfg?.client_id || !cfg.client_secret || !cfg.shipping_merchant_id) return null;
  const { data: auths } = await admin.from('ifood_pdv_auths').select('*').eq('tenant_id', cfg.tenant_id).order('authorized_at', { ascending: false });
  const auth = (auths ?? []).find((a) => (a.merchants ?? []).some((m: any) => m.id === cfg.shipping_merchant_id));
  return auth ? { cfg, auth, merchantId: cfg.shipping_merchant_id } : null;
}
async function call(admin: Admin, c: Ctx, method: 'GET' | 'POST', path: string, body?: unknown, extraHeaders: Record<string, string> = {}, retry = method === 'GET') {
  const run = async () => ifoodFetch(path, {
    method,
    headers: { Authorization: `Bearer ${await getToken(admin, c.cfg, c.auth)}`, Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...extraHeaders },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  }, c.cfg.homologation_mode === true, retry ? 4 : 1);
  let r = await run();
  if (r.status === 401) { c.auth.token_expires_at = null; r = await run(); }
  return r;
}

// ── Montagem do pedido ───────────────────────────────────────────────────────
// CEP pela rua (ViaCEP: /ws/UF/Cidade/Logradouro/json). Várias faixas → a do bairro do pedido.
async function lookupCep(uf: string, city: string, street: string, bairro: string): Promise<string | null> {
  const rua = street.replace(/^(rua|r\.|avenida|av\.?|travessa|tv\.?|alameda|al\.?)\s+/i, '').trim();
  if (!uf || !city || rua.length < 3) return null;
  try {
    const url = `https://viacep.com.br/ws/${encodeURIComponent(uf)}/${encodeURIComponent(city)}/${encodeURIComponent(rua)}/json/`;
    const r = await fetch(url, { signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const list = await r.json();
    if (!Array.isArray(list) || list.length === 0) return null;
    const b = norm(bairro);
    const hit = (b && list.find((x: any) => norm(String(x.bairro ?? '')) === b)) || list[0];
    return onlyDigits(hit?.cep) || null;
  } catch { return null; }
}

async function loadOrder(admin: Admin, tenantId: string, orderId: string) {
  const { data: o } = await admin.from('orders')
    .select('id, number, status, origin_type, destination_name, destination_phone, delivery_address, delivery_fee, subtotal, discount_amount, total_amount, is_paid, notes, delivery_lat, delivery_lng, customer_id, delivery_platform, motoboy_driver_id')
    .eq('id', orderId).eq('tenant_id', tenantId).maybeSingle();
  return o;
}

async function buildItems(admin: Admin, o: any) {
  const { data: its } = await admin.from('order_items').select('id, item_name, item_price, quantity').eq('order_id', o.id).neq('status', 'cancelled');
  return buildItemsPure(o, its ?? []);
}

// ── Eventos (polling + acknowledgment + dedup) ───────────────────────────────
// Atualiza o pedido do ERPOS como o motoboy-signal faz (a tela de entregas lê motoboy_status/timeline).
// `obs` vira uma observação no pedido (ex.: pagamento recebido pelo entregador do iFood).
async function syncOrder(admin: Admin, orderId: string, signal: OrderSignal, nota?: string, obs?: string) {
  const nowIso = new Date().toISOString();
  const { data: cur } = await admin.from('orders').select('status, motoboy_status, motoboy_timeline, motoboy_problems, delivery_notes').eq('id', orderId).maybeSingle();
  if (!cur || cur.status === 'cancelled') return;
  const upd: Record<string, unknown> = { motoboy_updated_at: nowIso, updated_at: nowIso };
  if (signal === 'liberar') {
    if (cur.status === 'delivered') return;
    upd.motoboy_status = null;
    const probs = Array.isArray(cur.motoboy_problems) ? cur.motoboy_problems : [];
    // Evento reaplicado (falha depois desta gravação) não repete a nota.
    if (nota && !probs.some((p: any) => p?.autor === 'iFood Entrega' && p?.text === nota)) upd.motoboy_problems = [...probs, { at: nowIso, text: nota, by: 'loja', autor: 'iFood Entrega' }];
  } else {
    const tl = (cur.motoboy_timeline as Record<string, string> | null) ?? {};
    if (!tl[signal]) tl[signal] = nowIso;
    upd.motoboy_status = signal;
    upd.motoboy_timeline = tl;
    if (signal === 'coletou') upd.out_for_delivery_at = nowIso;
    if (signal === 'entregou') { upd.status = 'delivered'; upd.out_for_delivery_at = tl.coletou ?? nowIso; }
  }
  const notas = Array.isArray(cur.delivery_notes) ? cur.delivery_notes : [];
  if (obs && !notas.some((n: any) => n?.autor === 'iFood Entrega' && n?.text === obs)) upd.delivery_notes = [...notas, { at: nowIso, kind: 'observacao', text: obs, autor: 'iFood Entrega' }];
  const { error } = await admin.from('orders').update(upd).eq('id', orderId);
  if (error) throw new Error('Atualizar pedido: ' + error.message);
  if (signal === 'entregou') {
    await admin.from('order_items').update({ status: 'delivered' }).eq('order_id', orderId).neq('status', 'cancelled');
    await admin.from('order_items').update({ delivered_at: nowIso }).eq('order_id', orderId).neq('status', 'cancelled').is('delivered_at', null);
    const { data: its } = await admin.from('order_items').select('id').eq('order_id', orderId).neq('status', 'cancelled');
    const ids = (its ?? []).map((i: { id: string }) => i.id);
    if (ids.length) {
      await admin.from('order_item_units').update({ status: 'delivered', delivered_at: nowIso }).in('order_item_id', ids).is('delivered_at', null);
      await admin.from('order_item_parts').update({ status: 'delivered', delivered_at: nowIso }).in('order_item_id', ids).is('delivered_at', null).neq('status', 'cancelled');
    }
  }
}

async function applyEvent(admin: Admin, c: Ctx | null, e: any) {
  const ifoodOrderId = String(e.orderId ?? '');
  if (!ifoodOrderId) return;
  const { data: s } = await admin.from('ifood_shipping_orders').select('*').eq('ifood_order_id', ifoodOrderId).maybeSingle();
  if (!s) return; // pedido que não saiu daqui (ex.: pedido da plataforma) — só fica no log
  const plan = planEvent(s, e);
  // Pedido Sob Demanda nasce com PLACED; confirma (os dados foram validados antes de enviar). Sem o módulo
  // de pedidos o iFood pode recusar — fica no log.
  if (plan.confirm && c) {
    const r = await call(admin, c, 'POST', `/order/v1.0/orders/${ifoodOrderId}/confirm`, undefined, { 'idempotency-key': `confirm-${ifoodOrderId}` });
    if (!r.ok && r.status !== 409) log('WARN', 'event', 'confirmar pedido', { ifoodOrderId, status: r.status, body: r.raw.slice(0, 200) });
  }
  // Cobrado na entrega pelo entregador do iFood: o dinheiro entra no REPASSE do iFood, não na gaveta.
  const obs = plan.order === 'entregou' && s.payment
    ? 'Pagamento recebido pelo entregador do iFood (entra no repasse do iFood, não no caixa) — registre como "iFood Entrega".'
    : undefined;
  if (plan.order) await syncOrder(admin, s.order_id, plan.order, plan.note, obs);
  const { error } = await admin.from('ifood_shipping_orders').update({ ...plan.upd, updated_at: new Date().toISOString() }).eq('id', s.id);
  if (error) throw new Error('Atualizar entrega: ' + error.message);
  // Sem mudança no pedido (troca de endereço, código, chegou na loja): acorda as telas mesmo assim (orders-ping).
  if (!plan.order) await admin.from('orders').update({ updated_at: new Date().toISOString() }).eq('id', s.order_id);
}

// Uma rodada de polling da loja: busca, grava (dedup pelo id), aplica e confirma (acknowledgment).
// Status do polling na config: grava só quando muda (ou a cada 5 min) — o cron roda a cada 30 s.
async function markPoll(admin: Admin, cfg: any, error: string | null) {
  const fails = error ? Number(cfg.poll_fail_count ?? 0) + 1 : 0;
  const velho = !cfg.last_poll_at || Date.now() - new Date(cfg.last_poll_at).getTime() > 5 * 60_000;
  if (!velho && (cfg.last_poll_error ?? null) === error && Number(cfg.poll_fail_count ?? 0) === fails) return;
  await admin.from('ifood_pdv_config').update({ last_poll_at: new Date().toISOString(), last_poll_error: error, poll_fail_count: fails }).eq('id', cfg.id);
  if (fails > 5) log('ERROR', 'poll', 'falhas consecutivas de polling', { tenant: cfg.tenant_id, fails, error });
}

async function pollTenant(admin: Admin, cfg: any) {
  const c = await loadCtx(admin, cfg);
  if (!c) {
    const msg = 'Sem autorização da loja do iFood escolhida (autorize de novo o app ERPOS PDV).';
    await markPoll(admin, cfg, msg);
    return { error: msg };
  }
  const r = await call(admin, c, 'GET', '/events/v1.0/events:polling', undefined, { 'x-polling-merchants': c.merchantId });
  if (r.status === 204 || (r.ok && !Array.isArray(r.data))) {
    await markPoll(admin, cfg, null);
    return { events: 0 };
  }
  if (!r.ok) {
    const msg = apiError(r, 'Polling de eventos');
    await markPoll(admin, cfg, msg);
    return { error: msg };
  }
  const events = (r.data as any[]).filter((e) => e?.id);
  const ids = events.map((e) => String(e.id));
  const { data: seen } = ids.length ? await admin.from('ifood_pdv_events').select('event_id, processed_at').in('event_id', ids) : { data: [] };
  const done = new Set((seen ?? []).filter((x) => x.processed_at).map((x) => x.event_id));
  // Ordem cronológica: ASSIGN antes de DISPATCHED antes de CONCLUDED.
  events.sort((a, b) => String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? '')));
  let applied = 0;
  const ackIds: string[] = [];
  for (const e of events) {
    const id = String(e.id);
    if (done.has(id)) { ackIds.push(id); continue; } // duplicado (já processado numa rodada anterior)
    await admin.from('ifood_pdv_events').upsert({
      event_id: id, tenant_id: cfg.tenant_id, merchant_id: e.merchantId ?? c.merchantId, ifood_order_id: e.orderId ?? null,
      code: e.code ?? null, full_code: e.fullCode ?? null, sales_channel: e.salesChannel ?? null, metadata: e.metadata ?? null,
      event_at: e.createdAt ?? null,
    }, { onConflict: 'event_id', ignoreDuplicates: true });
    try {
      await applyEvent(admin, c, e); applied++;
      await admin.from('ifood_pdv_events').update({ processed_at: new Date().toISOString(), error: null }).eq('event_id', id);
      ackIds.push(id);
    } catch (err) {
      // Não confirma ao iFood: o evento volta no próximo polling e é reaplicado.
      const error = String((err as Error)?.message ?? err).slice(0, 300);
      log('ERROR', 'event', 'falha ao aplicar', { id, error });
      await admin.from('ifood_pdv_events').update({ error }).eq('event_id', id);
    }
    log('INFO', 'event', eventName(e), { id, orderId: e.orderId ?? null });
  }
  // Acknowledgment dos processados e dos duplicados — senão o iFood reenvia.
  if (ackIds.length) {
    const ack = await call(admin, c, 'POST', '/events/v1.0/events/acknowledgment', ackIds.map((id) => ({ id })), {}, true);
    if (ack.ok) await admin.from('ifood_pdv_events').update({ acked_at: new Date().toISOString() }).in('event_id', ackIds);
    else log('ERROR', 'ack', 'acknowledgment falhou', { status: ack.status, body: ack.raw.slice(0, 200) });
  }
  await markPoll(admin, cfg, null);
  return { events: events.length, applied };
}

function safeConfig(cfg: any, auths: any[]) {
  if (!cfg) return null;
  const merchants = new Map<string, string>();
  for (const a of auths) for (const m of a.merchants ?? []) merchants.set(m.id, m.name);
  return {
    client_id: cfg.client_id ?? null, has_secret: !!cfg.client_secret, app_type: cfg.app_type === 'centralized' ? 'centralized' : 'distributed',
    homologation_mode: cfg.homologation_mode === true, shipping_enabled: cfg.shipping_enabled === true,
    default_prep_min: cfg.default_prep_min ?? 15,
    shipping_merchant_id: cfg.shipping_merchant_id ?? null, shipping_merchant_name: cfg.shipping_merchant_name ?? null,
    user_code: cfg.user_code && cfg.user_code_expires_at && new Date(cfg.user_code_expires_at) > new Date() ? cfg.user_code : null,
    verification_url: cfg.verification_url ?? null,
    merchants: [...merchants.entries()].map(([id, name]) => ({ id, name })),
    authorized: auths.length > 0,
    last_poll_at: cfg.last_poll_at ?? null, last_poll_error: cfg.last_poll_error ?? null, poll_fail_count: cfg.poll_fail_count ?? 0,
  };
}

// ── Handler ──────────────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errResp('Method not allowed', 405);

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const internal = !!internalKey && req.headers.get('x-internal-key') === internalKey;
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    if (action === 'poll_all') {
      if (!internal) return errResp('Unauthorized', 401);
      const { data: lojas } = await admin.from('ifood_pdv_config').select('*').eq('shipping_enabled', true).not('client_id', 'is', null);
      const out = [];
      for (const cfg of lojas ?? []) {
        // Entrega "ativa" há mais de 6 h sem notícia não segura o polling (mesma regra do cron no banco).
        const { count } = await admin.from('ifood_shipping_orders').select('id', { count: 'exact', head: true })
          .eq('tenant_id', cfg.tenant_id).in('status', ACTIVE).gt('updated_at', new Date(Date.now() - 6 * 3600_000).toISOString());
        const homolog = cfg.homologation_mode && cfg.homologation_until && new Date(cfg.homologation_until) > new Date();
        if (!homolog && !(count ?? 0)) continue;
        try { out.push({ tenant_id: cfg.tenant_id, ...(await pollTenant(admin, cfg)) }); }
        catch (e) { out.push({ tenant_id: cfg.tenant_id, error: String((e as Error)?.message ?? e) }); }
      }
      // Log dos eventos: 30 dias (critério de homologação) + folga.
      if (Math.random() < 1 / 120) await admin.from('ifood_pdv_events').delete().lt('received_at', new Date(Date.now() - 35 * 86400_000).toISOString());
      return json({ success: true, results: out });
    }

    // ── Demais ações: pessoa da loja (ou interno com tenant_id) ──
    const requested: string | null = body.tenant_id ?? null;
    let tenantId: string;
    let userId: string | null = null;
    let role = 'admin';
    if (internal) {
      if (!requested) return errResp('tenant_id required');
      tenantId = requested;
    } else {
      if (!token) return errResp('Unauthorized', 401);
      const { data: u, error: uErr } = await admin.auth.getUser(token);
      if (uErr || !u?.user) return errResp('Unauthorized', 401);
      userId = u.user.id;
      const { data: rows } = await admin.from('user_tenants').select('tenant_id, role').eq('user_id', userId);
      const match = requested ? (rows ?? []).find((r) => r.tenant_id === requested) : ((rows ?? []).length === 1 ? rows![0] : null);
      if (!match) return errResp('Sem acesso a esta loja', 403);
      tenantId = match.tenant_id;
      role = String(match.role ?? '');
    }
    const isManager = internal || isManagerRole(role);
    const { data: cfg } = await admin.from('ifood_pdv_config').select('*').eq('tenant_id', tenantId).maybeSingle();
    const listAuths = async () => (await admin.from('ifood_pdv_auths').select('id, merchants, authorized_at').eq('tenant_id', tenantId).order('authorized_at', { ascending: false })).data ?? [];

    if (action === 'get_config') return json({ success: true, config: safeConfig(cfg, cfg ? await listAuths() : []), can_edit: isManager });

    // ── Entregas (qualquer pessoa da loja: quem despacha é o caixa/expedição) ──
    const getShipping = async () => {
      const { data: s } = await admin.from('ifood_shipping_orders').select('*').eq('id', String(body.shipping_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      return s;
    };
    const needCtx = async () => {
      if (!cfg?.shipping_enabled) throw new Error('O iFood Entrega não está ligado nesta loja (Gestor de Entregas › iFood Entrega).');
      const c = await loadCtx(admin, cfg);
      if (!c) throw new Error('Falta autorizar a loja do iFood no app ERPOS PDV (Gestor de Entregas › iFood Entrega).');
      return c;
    };

    if (action === 'prepare') {
      const o = await loadOrder(admin, tenantId, String(body.order_id ?? ''));
      if (!o) return errResp('Pedido não encontrado.');
      const { data: loja } = await admin.from('tenants').select('city, state, zip_code').eq('id', tenantId).maybeSingle();
      // Endereço estruturado: o cadastrado do cliente mais perto do pino do pedido (ou o padrão).
      let addr: any = null;
      if (o.customer_id) {
        const { data: as } = await admin.from('delivery_customer_addresses').select('street, number, complement, reference_point, bairro, lat, lng, is_default').eq('customer_id', o.customer_id).eq('tenant_id', tenantId);
        const list = as ?? [];
        const dist = (a: any) => (a.lat != null && o.delivery_lat != null) ? Math.hypot(Number(a.lat) - Number(o.delivery_lat), Number(a.lng) - Number(o.delivery_lng)) : Infinity;
        const byPin = [...list].sort((a, b) => dist(a) - dist(b))[0];
        const byText = list.find((a: any) => a.street && String(o.delivery_address ?? '').toLowerCase().includes(String(a.street).toLowerCase()));
        addr = (byPin && dist(byPin) < 0.002 ? byPin : null) ?? byText ?? list.find((a: any) => a.is_default) ?? null;
      }
      const city = String(loja?.city ?? '').trim();
      const state = String(loja?.state ?? '').trim().toUpperCase().slice(0, 2);
      const street = String(addr?.street ?? '').trim();
      const bairro = String(addr?.bairro ?? '').trim();
      const cep = street ? await lookupCep(state, city, street, bairro) : null;
      const phone = splitPhone(o.destination_phone);
      const { itemsTotal } = await buildItems(admin, o);
      const total = round2(Number(o.total_amount ?? 0));
      const { data: ship } = await admin.from('ifood_shipping_orders').select('*').eq('order_id', o.id).order('created_at', { ascending: false }).limit(1).maybeSingle();
      return json({
        success: true,
        order: { id: o.id, number: o.number, status: o.status, total, delivery_fee: round2(Number(o.delivery_fee ?? 0)), items_total: itemsTotal, address_text: o.delivery_address ?? '' },
        customer: { name: cut(String(o.destination_name ?? '').split(/\s+[-–—]\s+/)[0] || 'Cliente', 50), area_code: phone?.areaCode ?? '', number: phone?.number ?? '' },
        address: {
          street_name: street, street_number: String(addr?.number ?? '').trim(), complement: String(addr?.complement ?? '').trim(),
          reference: String(addr?.reference_point ?? '').trim(), neighborhood: bairro, city, state, postal_code: cep ?? '',
          lat: o.delivery_lat != null ? Number(o.delivery_lat) : (addr?.lat != null ? Number(addr.lat) : null),
          lng: o.delivery_lng != null ? Number(o.delivery_lng) : (addr?.lng != null ? Number(addr.lng) : null),
        },
        payment: paymentFromNotes(o.notes ?? null, !!o.is_paid, total),
        prep_min: cfg?.default_prep_min ?? 15,
        shipping: ship ?? null,
        ready: !!cfg?.shipping_enabled && !!(await loadCtx(admin, cfg ?? {})),
      });
    }

    if (action === 'quote') {
      const c = await needCtx();
      const lat = Number(body.lat), lng = Number(body.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) return errResp('O pedido não tem a localização (pino) do cliente. Marque o endereço no mapa.');
      const r = await call(admin, c, 'GET', `/shipping/v1.0/merchants/${c.merchantId}/deliveryAvailabilities?latitude=${lat}&longitude=${lng}`);
      if (!r.ok) return errResp(msgErro(r, 'Cotação'), 200, { code: errCode(r) || null });
      return json({ success: true, quote: r.data });
    }

    if (action === 'create') {
      // Chamar entregador gera custo: contabilidade (só leitura) não chama.
      if (isContabilidadeRole(role)) return errResp('Seu perfil não pode chamar entregador.', 403);
      const c = await needCtx();
      const o = await loadOrder(admin, tenantId, String(body.order_id ?? ''));
      if (!o) return errResp('Pedido não encontrado.');
      if (o.origin_type !== 'delivery') return errResp('Só pedidos de delivery podem ir pelo iFood Entrega.');
      if (['cancelled', 'delivered', 'draft'].includes(String(o.status))) return errResp('Esse pedido não está em andamento.');
      if (o.motoboy_driver_id) return errResp('Um entregador da loja já pegou este pedido — libere-o antes de chamar o iFood.');

      const cu = body.customer ?? {}, ad = body.address ?? {}, pay = body.payment ?? {};
      const name = cut(cu.name, 50);
      const area = onlyDigits(cu.area_code), num = onlyDigits(cu.number);
      if (!name) return errResp('Informe o nome do cliente.');
      if (area.length !== 2 || num.length < 7 || num.length > 9) return errResp('Telefone do cliente inválido (DDD com 2 dígitos + número). O entregador pede ao cliente os 4 últimos dígitos.');
      const cep = onlyDigits(ad.postal_code);
      const lat = Number(ad.lat), lng = Number(ad.lng);
      const faltando = [
        cep.length !== 8 && 'CEP (8 dígitos)', !String(ad.street_name ?? '').trim() && 'rua', !String(ad.street_number ?? '').trim() && 'número',
        !String(ad.neighborhood ?? '').trim() && 'bairro', !String(ad.city ?? '').trim() && 'cidade', String(ad.state ?? '').trim().length !== 2 && 'UF',
        (!Number.isFinite(lat) || !Number.isFinite(lng)) && 'localização',
      ].filter(Boolean);
      if (faltando.length) return errResp('Complete o endereço: ' + faltando.join(', ') + '.');
      const quoteId = String(body.quote_id ?? '').trim();
      if (!quoteId) return errResp('Faça a cotação antes de chamar o entregador.');

      const { items, itemsTotal } = await buildItems(admin, o);
      const merchantFee = round2(Number(o.delivery_fee ?? 0));
      const total = round2(itemsTotal + merchantFee);
      // Pagamento na entrega (entregador do iFood cobra) ou já pago (online → sem o objeto payments).
      let payments: any = undefined;
      const kind = String(pay.kind ?? '');
      if (kind === 'CASH') {
        const changeFor = Number(pay.change_for ?? 0);
        payments = { methods: [{ method: 'CASH', type: 'OFFLINE', value: total, ...(changeFor > total ? { cash: { changeFor: round2(changeFor) } } : {}) }] };
      } else if (kind === 'CREDIT' || kind === 'DEBIT') {
        const brand = String(pay.brand ?? '').trim();
        if (!brand) return errResp('Escolha a bandeira do cartão.');
        payments = { methods: [{ method: kind, type: 'OFFLINE', value: total, card: { brand } }] };
      } else if (kind !== 'paid') return errResp('Escolha como o cliente paga: já pago, dinheiro ou cartão na entrega.');

      const prepMin = Math.max(0, Math.min(120, Math.round(Number(body.prep_min ?? cfg.default_prep_min ?? 15))));
      const address = {
        postalCode: cep, streetNumber: cut(ad.street_number, 10), streetName: cut(ad.street_name, 50),
        ...(String(ad.complement ?? '').trim() ? { complement: cut(ad.complement, 50) } : {}),
        ...(String(ad.reference ?? '').trim() ? { reference: cut(ad.reference, 70) } : {}),
        neighborhood: cut(ad.neighborhood, 50), city: cut(ad.city, 50), state: cut(ad.state, 2).toUpperCase(), country: 'BR',
        coordinates: { latitude: lat, longitude: lng },
      };
      const payload: Record<string, unknown> = {
        customer: { name, phone: { countryCode: '55', areaCode: area, number: num, type: 'CUSTOMER' } },
        delivery: { merchantFee, quoteId, preparationTime: prepMin * 60, deliveryAddress: address },
        items,
        displayId: cut(String(o.number ?? '').replace(/\W/g, '').slice(-4), 4),
        ...(payments ? { payments } : {}),
      };
      // 1º reserva a linha: o índice único (1 entrega ativa por pedido) trava dois cliques/duas abas ANTES
      // de ir ao iFood — senão o 2º chamaria outro entregador e ficaria sem linha para acompanhar/cancelar.
      // O custo (ifood_fee) vem da cotação que a tela mostrou; é informativo (não entra no financeiro).
      const quote = body.quote ?? null;
      // Reserva que ficou para trás (a função caiu entre reservar e ouvir o iFood) não trava o pedido.
      await admin.from('ifood_shipping_orders').update({ status: 'failed', error: 'Reserva sem resposta do iFood — confira no Gestor de Pedidos do iFood.', updated_at: new Date().toISOString() })
        .eq('order_id', o.id).eq('status', 'requested').is('ifood_order_id', null).lt('created_at', new Date(Date.now() - 4 * 60_000).toISOString());
      // Entrega "ativa" sem notícia há 6 h (o polling já parou de olhar): encerra para não travar o pedido.
      await admin.from('ifood_shipping_orders').update({ status: 'failed', uncertain: true, error: 'Sem notícia do iFood há mais de 6 h — confira no Gestor de Pedidos do iFood.', updated_at: new Date().toISOString() })
        .eq('order_id', o.id).in('status', ACTIVE).lt('updated_at', new Date(Date.now() - 6 * 3600_000).toISOString());
      const { data: row, error: resErr } = await admin.from('ifood_shipping_orders').insert({
        tenant_id: tenantId, order_id: o.id, merchant_id: c.merchantId,
        quote_id: quoteId, quote, ifood_fee: quote?.quote?.netValue != null ? round2(Number(quote.quote.netValue)) : null,
        merchant_fee: merchantFee, status: 'requested', address, payment: payments ?? null, prep_min: prepMin, created_by: userId,
        timeline: { REGISTERED: new Date().toISOString() },
      }).select('*').single();
      if (resErr) {
        if (resErr.code === '23505') return errResp('Esse pedido já tem uma entrega iFood em andamento.');
        return errResp('Reservar a entrega: ' + resErr.message, 500);
      }
      // POST vai uma vez só (sem retentativa): 5xx/queda de rede pode ter sido aceito do lado do iFood.
      const r = await call(admin, c, 'POST', `/shipping/v1.0/merchants/${c.merchantId}/orders`, payload, { 'idempotency-key': `create-${o.id}-${quoteId}` });
      const now = new Date().toISOString();
      if (!r.ok || !r.data?.id) {
        const incerto = r.status === 0 || r.status >= 500;
        const msg = incerto
          ? 'O iFood não respondeu direito — pode ter chamado o entregador. Confira no Gestor de Pedidos do iFood antes de chamar de novo.'
          : msgErro(r, 'Chamar entregador');
        log(incerto ? 'ERROR' : 'WARN', 'create', incerto ? 'resposta incerta' : 'recusado', { order: o.id, status: r.status, body: r.raw.slice(0, 300) });
        await admin.from('ifood_shipping_orders').update({ status: 'failed', error: msg, uncertain: incerto, updated_at: now }).eq('id', row.id);
        return errResp(msg, 200, { code: errCode(r) || null, uncertain: incerto });
      }
      const { data: ok, error } = await admin.from('ifood_shipping_orders').update({
        ifood_order_id: String(r.data.id), tracking_url: r.data.trackingUrl ?? null, status: 'requested', error: null, uncertain: false, updated_at: now,
      }).eq('id', row.id).select('*').single();
      if (error) {
        // O iFood já aceitou: não perder o id (sem ele não há como cancelar pelo ERPOS).
        log('ERROR', 'create', 'gravar entrega', { order: o.id, ifood: r.data.id, error: error.message });
        return errResp(`O iFood aceitou (pedido ${r.data.id}), mas não consegui gravar aqui: ${error.message}`, 500);
      }
      await admin.from('orders').update({ updated_at: now }).eq('id', o.id); // acorda as telas (orders-ping)
      log('INFO', 'create', 'ok', { order: o.id, ifood: r.data.id, tenantId });
      return json({ success: true, shipping: ok });
    }

    if (action === 'cancel_reasons') {
      const c = await needCtx();
      const s = await getShipping();
      if (!s?.ifood_order_id) return errResp('Entrega não encontrada.');
      const r = await call(admin, c, 'GET', `/shipping/v1.0/orders/${s.ifood_order_id}/cancellationReasons`);
      if (r.status === 204) return json({ success: true, reasons: [], can_cancel: false });
      if (!r.ok) return errResp(apiError(r, 'Motivos de cancelamento'));
      return json({ success: true, can_cancel: true, reasons: (Array.isArray(r.data) ? r.data : []).map((x: any) => ({ code: String(x.cancelCodeId ?? x.code), description: String(x.description ?? '') })) });
    }

    if (action === 'cancel') {
      if (isContabilidadeRole(role)) return errResp('Seu perfil não pode cancelar entrega.', 403);
      const c = await needCtx();
      const s = await getShipping();
      if (!s?.ifood_order_id) return errResp('Entrega não encontrada.');
      const code = Number(body.code);
      const reason = cut(body.reason, 250) || 'Cancelado pela loja';
      if (!Number.isFinite(code)) return errResp('Escolha o motivo do cancelamento.');
      const r = await call(admin, c, 'POST', `/shipping/v1.0/orders/${s.ifood_order_id}/cancel`, { reason, cancellationCode: code }, { 'idempotency-key': `cancel-${s.id}-${code}` });
      if (!r.ok) return errResp(apiError(r, 'Cancelar'));
      await admin.from('ifood_shipping_orders').update({ status: 'cancel_requested', cancel_reason: reason, error: null, updated_at: new Date().toISOString() }).eq('id', s.id);
      return json({ success: true, message: 'Cancelamento pedido ao iFood. A confirmação chega em alguns segundos.' });
    }

    if (action === 'address_change') {
      if (isContabilidadeRole(role)) return errResp('Seu perfil não pode responder a troca de endereço.', 403);
      const c = await needCtx();
      const s = await getShipping();
      if (!s?.ifood_order_id) return errResp('Entrega não encontrada.');
      const accept = body.accept === true;
      const r = await call(admin, c, 'POST', `/shipping/v1.0/orders/${s.ifood_order_id}/${accept ? 'acceptDeliveryAddressChange' : 'denyDeliveryAddressChange'}`, undefined, { 'idempotency-key': `addr-${s.id}-${accept ? 'a' : 'd'}-${s.address_change_deadline ?? ''}` });
      if (!r.ok) return errResp(apiError(r, accept ? 'Aceitar endereço' : 'Recusar endereço'));
      await admin.from('ifood_shipping_orders').update({ address_change: null, address_change_deadline: null, updated_at: new Date().toISOString() }).eq('id', s.id);
      return json({ success: true });
    }

    if (action === 'tracking') {
      const c = await needCtx();
      const s = await getShipping();
      if (!s?.ifood_order_id) return errResp('Entrega não encontrada.');
      const [t, sd] = await Promise.all([
        call(admin, c, 'GET', `/shipping/v1.0/orders/${s.ifood_order_id}/tracking`),
        call(admin, c, 'GET', `/shipping/v1.0/orders/${s.ifood_order_id}/safeDelivery`),
      ]);
      const score = sd.ok ? String(sd.data?.score ?? '') || null : null;
      if (score && score !== s.safe_score) await admin.from('ifood_shipping_orders').update({ safe_score: score }).eq('id', s.id);
      return json({ success: true, tracking: t.ok ? t.data : null, safe: sd.ok ? sd.data : null });
    }

    if (action === 'poll') {
      if (!cfg?.shipping_enabled) return json({ success: true, skipped: true });
      return json({ success: true, ...(await pollTenant(admin, cfg)) });
    }

    // ── Configuração (admin/gerente) ──
    if (!isManager) return errResp('Apenas admin/gerente', 403);

    const temAtivas = async () => {
      const { count } = await admin.from('ifood_shipping_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ACTIVE);
      return (count ?? 0) > 0;
    };
    const MSG_ATIVAS = 'Há entregas iFood em andamento — espere terminarem antes de mudar isso (senão ninguém acompanha).';

    if (action === 'save_config') {
      const clientId = String(body.client_id ?? '').trim();
      const clientSecret = String(body.client_secret ?? '').trim();
      if (!clientId) return errResp('Informe o Client ID do app ERPOS PDV.');
      if (!clientSecret && !cfg?.client_secret) return errResp('Informe o Client Secret do app ERPOS PDV.');
      const changedApp = cfg && cfg.client_id !== clientId;
      if (changedApp && await temAtivas()) return errResp(MSG_ATIVAS);
      const appType = body.app_type === 'centralized' ? 'centralized' : 'distributed';
      const row: Record<string, unknown> = { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret || cfg?.client_secret, app_type: appType, updated_at: new Date().toISOString() };
      if (!cfg) row.created_by = userId;
      if (changedApp) Object.assign(row, { user_code: null, auth_verifier_secret: null, shipping_merchant_id: null, shipping_merchant_name: null, shipping_enabled: false });
      const { error } = await admin.from('ifood_pdv_config').upsert(row, { onConflict: 'tenant_id' });
      if (error) return errResp('Salvar: ' + error.message, 500);
      if (changedApp) await admin.from('ifood_pdv_auths').delete().eq('tenant_id', tenantId);
      return json({ success: true });
    }

    if (action === 'set_options') {
      if (!cfg) return errResp('Salve primeiro as credenciais.');
      const upd: Record<string, unknown> = { updated_at: new Date().toISOString() };
      // Homologação liga por 24 h (polling contínuo); depois o cron para sozinho se ninguém desligar.
      if (typeof body.homologation_mode === 'boolean') {
        upd.homologation_mode = body.homologation_mode;
        upd.homologation_until = body.homologation_mode ? new Date(Date.now() + 24 * 3600_000).toISOString() : null;
      }
      if (body.default_prep_min !== undefined) upd.default_prep_min = Math.max(0, Math.min(120, Math.round(Number(body.default_prep_min) || 0)));
      if (body.shipping_merchant_id !== undefined) {
        const id = String(body.shipping_merchant_id ?? '').trim();
        const m = (await listAuths()).flatMap((a: any) => a.merchants ?? []).find((x: any) => x.id === id);
        if (id && !m) return errResp('Essa loja do iFood ainda não autorizou o app ERPOS PDV.');
        if (id !== (cfg.shipping_merchant_id ?? '') && await temAtivas()) return errResp(MSG_ATIVAS);
        upd.shipping_merchant_id = id || null; upd.shipping_merchant_name = m?.name ?? null;
      }
      if (typeof body.shipping_enabled === 'boolean') {
        if (body.shipping_enabled && !(upd.shipping_merchant_id ?? cfg.shipping_merchant_id)) return errResp('Escolha a loja do iFood que vai despachar as entregas.');
        if (!body.shipping_enabled && cfg.shipping_enabled && await temAtivas()) return errResp(MSG_ATIVAS);
        upd.shipping_enabled = body.shipping_enabled;
      }
      const { error } = await admin.from('ifood_pdv_config').update(upd).eq('id', cfg.id);
      if (error) return errResp('Salvar: ' + error.message, 500);
      return json({ success: true });
    }

    // App centralizado: token por client_credentials e a lista das lojas que o app enxerga (sem código).
    if (action === 'connect_centralized') {
      if (!cfg?.client_id || !cfg.client_secret || cfg.app_type !== 'centralized') return errResp('Salve antes as credenciais de um app centralizado.');
      const r = await ifoodForm('/authentication/v1.0/oauth/token', { grantType: 'client_credentials', clientId: cfg.client_id, clientSecret: cfg.client_secret }, cfg.homologation_mode === true);
      if (!r.ok || !r.data?.accessToken) return errResp(apiError(r, 'Conectar'));
      const access = r.data.accessToken as string;
      const m = await ifoodFetch('/merchant/v1.0/merchants', { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } }, cfg.homologation_mode === true);
      if (!m.ok) return errResp(apiError(m, 'Listar lojas'));
      const merchants = (Array.isArray(m.data) ? m.data : []).map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.corporateName ?? x.id) }));
      const now = new Date().toISOString();
      await admin.from('ifood_pdv_auths').delete().eq('tenant_id', tenantId);
      const { error: aErr } = await admin.from('ifood_pdv_auths').insert({
        tenant_id: tenantId, access_token: access, refresh_token: null,
        token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
        merchants, authorized_at: now, updated_at: now,
      });
      if (aErr) return errResp('Gravar autorização: ' + aErr.message, 500);
      const upd: Record<string, unknown> = { updated_at: now };
      if (!cfg.shipping_merchant_id && merchants.length === 1) Object.assign(upd, { shipping_merchant_id: merchants[0].id, shipping_merchant_name: merchants[0].name });
      await admin.from('ifood_pdv_config').update(upd).eq('id', cfg.id);
      return json({ success: true, merchants });
    }

    if (action === 'request_user_code') {
      if (!cfg?.client_id) return errResp('Salve primeiro o Client ID e o Client Secret.');
      const r = await ifoodForm('/authentication/v1.0/oauth/userCode', { clientId: cfg.client_id }, cfg.homologation_mode === true);
      if (!r.ok || !r.data?.userCode) return errResp(apiError(r, 'Gerar código'));
      await admin.from('ifood_pdv_config').update({
        user_code: r.data.userCode, auth_verifier_secret: r.data.authorizationCodeVerifier,
        verification_url: r.data.verificationUrlComplete ?? r.data.verificationUrl ?? null,
        user_code_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 600) * 1000).toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', cfg.id);
      return json({ success: true, user_code: r.data.userCode, verification_url: r.data.verificationUrlComplete ?? r.data.verificationUrl ?? null });
    }

    if (action === 'confirm_authorization') {
      const code = String(body.authorization_code ?? '').trim();
      if (!cfg?.client_id || !cfg.client_secret) return errResp('Salve primeiro as credenciais.');
      if (!cfg.auth_verifier_secret) return errResp('Gere o código de vínculo antes.');
      if (!code) return errResp('Cole o código de autorização que o Portal do Parceiro mostrou.');
      const r = await ifoodForm('/authentication/v1.0/oauth/token', {
        grantType: 'authorization_code', clientId: cfg.client_id, clientSecret: cfg.client_secret,
        authorizationCode: code, authorizationCodeVerifier: cfg.auth_verifier_secret,
      }, cfg.homologation_mode === true);
      if (!r.ok || !r.data?.accessToken) return errResp(apiError(r, 'Autorizar'));
      const access = r.data.accessToken as string;
      const m = await ifoodFetch('/merchant/v1.0/merchants', { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } }, cfg.homologation_mode === true);
      const merchants = (Array.isArray(m.data) ? m.data : []).map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.corporateName ?? x.id) }));
      const now = new Date().toISOString();
      const { error: aErr } = await admin.from('ifood_pdv_auths').insert({
        tenant_id: tenantId, access_token: access, refresh_token: r.data.refreshToken ?? null,
        token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
        merchants, authorized_at: now, updated_at: now,
      });
      if (aErr) return errResp('Gravar autorização: ' + aErr.message, 500);
      const upd: Record<string, unknown> = { user_code: null, auth_verifier_secret: null, updated_at: now };
      // Uma loja só na autorização e nenhuma escolhida ainda → já fica escolhida.
      if (!cfg.shipping_merchant_id && merchants.length === 1) Object.assign(upd, { shipping_merchant_id: merchants[0].id, shipping_merchant_name: merchants[0].name });
      await admin.from('ifood_pdv_config').update(upd).eq('id', cfg.id);
      return json({ success: true, merchants });
    }

    if (action === 'delete_config') {
      const { count } = await admin.from('ifood_shipping_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ACTIVE);
      if ((count ?? 0) > 0) return errResp('Há entregas iFood em andamento — espere terminarem antes de desconectar.');
      await admin.from('ifood_pdv_auths').delete().eq('tenant_id', tenantId);
      await admin.from('ifood_pdv_config').delete().eq('tenant_id', tenantId);
      return json({ success: true });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (e) {
    log('ERROR', action, 'falha', { error: String((e as Error)?.stack ?? e) });
    return errResp(String((e as Error)?.message ?? e), 500);
  }
});

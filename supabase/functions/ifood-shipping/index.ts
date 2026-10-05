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
//   save_config    { client_id, client_secret? }    admin/gerente — só app PRÓPRIO (teste); sem isso a loja usa
//                                                   o app ERPOS PDV do sistema (secrets IFOOD_PDV_CLIENT_ID/SECRET)
//   use_system_app                                  volta a loja para o app do sistema
//   set_options    { homologation_mode?, shipping_enabled?, default_prep_min?, shipping_merchant_id? }
//   request_user_code / confirm_authorization { authorization_code } / delete_config   admin/gerente
//   refresh_merchants                                renova o acesso e relê as lojas de cada autorização   admin/gerente
//   prepare        { order_id }                     formulário pré-preenchido (endereço, telefone, itens, pagamento)
//   quote          { order_id, lat, lng }           GET shipping/v1.0/merchants/{m}/deliveryAvailabilities
//   create         { order_id, quote_id, customer, address, payment, prep_min }
//   cancel_reasons { shipping_id }                  motivos dinâmicos (proibido fixar no código — homologação)
//   cancel         { shipping_id, code, reason }
//   address_change { shipping_id, accept }          aceitar/recusar troca de endereço pedida pelo cliente (15 min)
//   tracking       { shipping_id }                  posição do entregador + safe delivery score
//   analytics_kpis { merchant_id, de?, ate?, homologacao? }  indicadores D-1 (módulo Analytics; admin/gerente/contabilidade)
//   poll                                            busca eventos agora (tela)
//   poll_all                                        (interno) cron a cada 30 s
//
// Autenticação: JWT do usuário (vínculo em user_tenants) OU header x-internal-key = FISCAL_INTERNAL_KEY.
// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { isContabilidadeRole, isManagerRole } from '../_shared/tenant-auth.ts';
import { ACTIVE, buildItems as buildItemsPure, cut, eventName, norm, onlyDigits, parseEnderecoPedido, paymentFromNotes, planEvent, round2, splitPhone, type OrderSignal } from './core.ts';
import { orderEventName, orderItemsFromDetails, orderRowFromDetails, planOrderEvent } from './order.ts';
import { montarPedidoErpos, type IfoodLink, type MenuInfo } from './funnel.ts';
import { consultaKpis, corpoHomologacao, mensagemErroKpis, periodoKpis, resumirLinhas, validarCorpoKpis } from './analytics.ts';
import { deductStockForOrderItem } from '../_shared/stock.ts';

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

// App ERPOS PDV (distribuído): Client ID/Secret são do SISTEMA, nos secrets da função (2026-09-26).
// Toda loja usa este app e só autoriza no Portal do Parceiro; credencial própria na config (app de teste) tem prioridade.
const SYSTEM_APP = { id: (Deno.env.get('IFOOD_PDV_CLIENT_ID') ?? '').trim(), secret: (Deno.env.get('IFOOD_PDV_CLIENT_SECRET') ?? '').trim() };
const hasSystemApp = () => Boolean(SYSTEM_APP.id && SYSTEM_APP.secret);
function withSystemApp(cfg: any) {
  if (!cfg || cfg.client_id || !hasSystemApp()) return cfg;
  return { ...cfg, client_id: SYSTEM_APP.id, client_secret: SYSTEM_APP.secret, app_type: 'distributed' };
}

// ── API do iFood ─────────────────────────────────────────────────────────────
// Backoff exponencial com jitter em 429/5xx (1s, 2s, 4s, 8s; respeita Retry-After) e header de
// homologação quando ligado — ambos exigidos nos critérios de homologação do Shipping.
// Só repete o que é seguro repetir (GET, token, acknowledgment): POST que chama/cancela entregador vai
// uma vez só — um 5xx pode ter sido aceito do lado do iFood e repetir chamaria dois entregadores.
// Falha de rede vira status 0 (resposta incerta).
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** GET /merchants paginado (page/size, critério de homologação do Merchant): segue até vir página incompleta. */
async function listarLojas(access: string, homolog: boolean) {
  const size = 100;
  const merchants: { id: string; name: string }[] = [];
  for (let page = 1; page <= 20; page++) {
    const m = await ifoodFetch(`/merchant/v1.0/merchants?page=${page}&size=${size}`, { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' } }, homolog);
    if (!m.ok) return { ...m, merchants };
    const lote = Array.isArray(m.data) ? m.data : [];
    merchants.push(...lote.map((x: any) => ({ id: String(x.id), name: String(x.name ?? x.corporateName ?? x.id) })));
    if (lote.length < size) break;
  }
  return { ok: true, status: 200, data: null, raw: '', merchants };
}

/**
 * Lojas que a autorização libera, sem o módulo Merchant: o polling de eventos (módulo Order) responde 403 com
 * `unauthorizedMerchants` para loja não autorizada. 05/10: app erpos-pdv em produção só com Order/Events liberados
 * (Merchant/Review/Shipping esperando o chamado) → /merchants vinha [] e /merchants/{id} 403. Candidatas = lojas do
 * iFood desta loja do ERPOS no financeiro. Polling sem ack não consome evento (o iFood entrega de novo).
 */
async function lojasPorEventos(access: string, homolog: boolean, candidatas: { id: string; name: string }[]) {
  let ids = [...new Set(candidatas.map((c) => c.id))];
  for (let i = 0; i < 3 && ids.length; i++) {
    const r = await ifoodFetch('/events/v1.0/events:polling', { headers: { Authorization: `Bearer ${access}`, Accept: 'application/json', 'x-polling-merchants': ids.join(',') } }, homolog);
    if (r.ok) return candidatas.filter((c) => ids.includes(c.id));
    const negadas: string[] = r.status === 403 ? (r.data?.error?.unauthorizedMerchants ?? r.data?.unauthorizedMerchants ?? []).map(String) : [];
    if (!negadas.length) return [];
    ids = ids.filter((id) => !negadas.includes(id));
  }
  return [];
}

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
  return cfg?.shipping_merchant_id ? ctxFor(admin, cfg, cfg.shipping_merchant_id) : null;
}
// Mesma regra para qualquer loja do iFood desta loja do ERPOS (pedidos podem vir de várias).
async function ctxFor(admin: Admin, cfg: any, merchantId: string): Promise<Ctx | null> {
  if (!cfg?.client_id || !cfg.client_secret || !merchantId) return null;
  const { data: auths } = await admin.from('ifood_pdv_auths').select('*').eq('tenant_id', cfg.tenant_id).order('authorized_at', { ascending: false });
  const auth = (auths ?? []).find((a) => (a.merchants ?? []).some((m: any) => m.id === merchantId));
  return auth ? { cfg, auth, merchantId } : null;
}
// Lojas do iFood que o polling desta loja do ERPOS acompanha.
function pollMerchants(cfg: any): string[] {
  const set = new Set<string>();
  if (cfg?.shipping_enabled && cfg.shipping_merchant_id) set.add(cfg.shipping_merchant_id);
  if (cfg?.order_enabled) for (const m of cfg.order_merchant_ids ?? []) if (m) set.add(String(m));
  return [...set];
}
async function call(admin: Admin, c: Ctx, method: 'GET' | 'POST' | 'PUT' | 'DELETE', path: string, body?: unknown, extraHeaders: Record<string, string> = {}, retry = method === 'GET') {
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

// ── Pagamento cobrado pelo entregador do iFood (decisão do dono, 2026-09-26) ──
// O cliente paga ao entregador do iFood (dinheiro/cartão na maquininha dele) e o valor volta no
// REPASSE do iFood — não na gaveta. Ao concluir, o pedido é pago com a forma "iFood Entrega"
// (type 'other' → fora da gaveta; NFC-e tPag 99 com a descrição "iFood Entrega"; a receber em
// days_to_receive dias). Mesmo caminho do "Pix pelo app" (online-payments › settlePix).
// Devolve true se o pagamento ficou registrado (ou já estava).
async function settleIfoodPayment(admin: Admin, s: any): Promise<boolean> {
  const tenantId = s.tenant_id as string;
  const orderId = s.order_id as string;
  const amount = round2(Number(s.payment?.methods?.[0]?.value ?? 0));
  if (!(amount > 0)) return false;

  // Forma de pagamento da loja (cria na 1ª vez).
  const { data: pms } = await admin.from('payment_methods').select('id, name, days_to_receive, fee_percentage')
    .eq('tenant_id', tenantId).eq('type', 'other').is('deleted_at', null).ilike('name', 'ifood entrega');
  let pm = (pms ?? [])[0] as { id: string; name: string; days_to_receive: number | null; fee_percentage: number | null } | undefined;
  if (!pm) {
    const { data: novo, error } = await admin.from('payment_methods').insert({
      tenant_id: tenantId, name: 'iFood Entrega', type: 'other', is_active: true, fee_percentage: 0,
      requires_change: false, sort_order: 90, days_to_receive: 7, fiscal_code: '99',
    }).select('id, name, days_to_receive, fee_percentage').single();
    if (error || !novo) { log('ERROR', 'settle', 'criar forma iFood Entrega', { tenantId, error: error?.message }); return false; }
    pm = novo;
  }

  // Idempotente: evento reaplicado não paga duas vezes.
  const { data: ja } = await admin.from('payments').select('id').eq('order_id', orderId).eq('payment_method_id', pm.id).eq('is_refunded', false).limit(1);
  if (ja?.length) return true;

  const { data: paymentId, error: payErr } = await admin.rpc('fn_record_payment_bypass', {
    p_order_id: orderId, p_tenant_id: tenantId, p_cash_register_id: null, p_payment_method_id: pm.id,
    p_amount: amount, p_change_amount: 0, p_operator_name: 'Entregador iFood', p_origin_type: 'ifood_shipping', p_payment_group_id: null,
  });
  if (payErr || !paymentId) {
    // Sem caixa aberto na sessão do pedido: fica a observação para o caixa dar baixa à mão.
    log('WARN', 'settle', 'pagamento não registrado', { orderId, error: payErr?.message ?? 'sem caixa aberto' });
    return false;
  }

  const now = new Date().toISOString();
  const { data: o } = await admin.from('orders').select('number, total_amount, is_paid').eq('id', orderId).maybeSingle();
  const { data: allPays } = await admin.from('payments').select('amount').eq('order_id', orderId).eq('is_refunded', false);
  const totalPaid = (allPays ?? []).reduce((acc: number, p: { amount: number }) => acc + Number(p.amount), 0);
  const total = Number(o?.total_amount ?? 0);
  if (o && !o.is_paid && (total === 0 || totalPaid >= total - 0.005)) {
    await admin.from('orders').update({ is_paid: true, paid_at: now, paid_by_pdv: 'ifood_shipping', updated_at: now }).eq('id', orderId);
    // NFC-e automática (a fiscal-write decide se emite; delivery = nota por pedido).
    const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
    const { data: fs } = await admin.from('fiscal_settings').select('enabled').eq('tenant_id', tenantId).maybeSingle();
    if (fs?.enabled && internalKey) {
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
      try {
        const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/fiscal-write`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${anonKey}`, apikey: anonKey, 'x-internal-key': internalKey },
          body: JSON.stringify({ action: 'emit', tenant_id: tenantId, source_type: 'order', source_id: orderId, trigger: 'ifood_shipping' }),
        });
        log('INFO', 'fiscal', 'emit', { orderId, http: r.status, body: (await r.text().catch(() => '')).slice(0, 200) });
      } catch (e) { log('WARN', 'fiscal', 'falhou', { orderId, error: String(e) }); }
    }
  }

  // Financeiro (espelho do online-payments › postSaleFinance): com prazo = a receber do iFood.
  try {
    const todayBR = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const numero = (o?.number as string) ?? null;
    const days = Number(pm.days_to_receive ?? 0);
    if (days > 0) {
      const { data: rec } = await admin.from('fin_receivable_installments').select('id').eq('tenant_id', tenantId).eq('order_id', orderId).eq('payment_method_name', pm.name).limit(1);
      if (!rec?.length) {
        const due = new Date(`${todayBR}T12:00:00Z`);
        due.setUTCDate(due.getUTCDate() + days);
        await admin.from('fin_receivable_installments').insert({
          tenant_id: tenantId, order_id: orderId, installment_number: 1, total_installments: 1, amount,
          due_date: due.toISOString().slice(0, 10), status: 'pending', payment_method_name: pm.name, order_number: numero,
        });
      }
    } else {
      const { data: flow } = await admin.from('fin_cash_flow').select('id').eq('tenant_id', tenantId).eq('reference_id', String(paymentId)).eq('origin', 'auto_sale').maybeSingle();
      if (!flow) await admin.from('fin_cash_flow').insert({ tenant_id: tenantId, type: 'income', amount, description: `Venda ${numero ?? orderId.slice(0, 8)} (${pm.name})`, category: 'Vendas', origin: 'auto_sale', reference_id: String(paymentId), date: todayBR, payment_method_id: pm.id });
    }
  } catch (e) { log('WARN', 'settle', 'financeiro da venda falhou (não bloqueia)', { orderId, error: String(e) }); }
  log('INFO', 'settle', 'pago como iFood Entrega', { orderId, amount });
  return true;
}

// ── Pedidos do iFood (módulo Order; modo só leitura por padrão) ──────────────
// Grava o pedido e os itens (GET /orders/{id}) — base do CMV por pedido e da baixa de estoque.
async function fetchOrderDetails(admin: Admin, c: Ctx, row: any, ifoodOrderId: string) {
  const r = await call(admin, c, 'GET', `/order/v1.0/orders/${ifoodOrderId}`);
  if (!r.ok || !r.data) throw new Error(apiError(r, 'Detalhe do pedido'));
  const now = new Date().toISOString();
  const { error } = await admin.from('ifood_orders').update({ ...orderRowFromDetails(r.data), details_at: now, updated_at: now }).eq('id', row.id);
  if (error) throw new Error('Gravar pedido: ' + error.message);
  const itens = orderItemsFromDetails(r.data).map((i: any) => ({ ...i, tenant_id: row.tenant_id, order_row_id: row.id }));
  await admin.from('ifood_order_items').delete().eq('order_row_id', row.id);
  if (itens.length) {
    const { error: iErr } = await admin.from('ifood_order_items').insert(itens);
    if (iErr) throw new Error('Gravar itens: ' + iErr.message);
  }
}

async function applyOrderEvent(admin: Admin, c: Ctx, e: any) {
  const ifoodOrderId = String(e.orderId ?? '');
  const { data: cur } = await admin.from('ifood_orders').select('*').eq('ifood_order_id', ifoodOrderId).maybeSingle();
  const plan = planOrderEvent(cur, e);
  const now = new Date().toISOString();
  let row = cur;
  if (!row) {
    const { data: ins, error } = await admin.from('ifood_orders').upsert({
      tenant_id: c.cfg.tenant_id, merchant_id: String(e.merchantId ?? c.merchantId), ifood_order_id: ifoodOrderId,
      sales_channel: e.salesChannel ?? null, ...plan.upd, updated_at: now,
    }, { onConflict: 'ifood_order_id' }).select('*').single();
    if (error) throw new Error('Gravar pedido: ' + error.message);
    row = ins;
  } else {
    const { error } = await admin.from('ifood_orders').update({ ...plan.upd, updated_at: now }).eq('id', row.id);
    if (error) throw new Error('Atualizar pedido: ' + error.message);
  }
  if (plan.fetchDetails) await fetchOrderDetails(admin, c, row, ifoodOrderId);
  if (funnelOn(c.cfg) || row.order_id) await funnelAfterEvent(admin, c, row.id);
}

// ── Funil do iFood (IFOOD-PEDIDOS-FUNIL.md, etapas 3/4) ─────────────────────────────────────────────────────────
// order_mode 'funnel': o pedido do iFood vira pedido do ERPOS (cozinha, entregas, estoque) e cada mudança de status
// volta ao iFood pela fila ifood_order_outbox (gatilho no banco) enviada a cada polling.
const funnelOn = (cfg: any) => cfg?.order_mode === 'funnel';
const OUTBOX_PATH: Record<string, string> = { start: 'startPreparation', ready: 'readyToPickup', dispatch: 'dispatch' };

async function funnelErro(admin: Admin, rowId: string, msg: string | null) {
  await admin.from('ifood_orders').update({ funnel_error: msg, updated_at: new Date().toISOString() }).eq('id', rowId);
}

/** Libera o pedido retido (rascunho → cozinha, tickets, estoque dos itens sem preparo) pelo delivery-write. */
async function liberarPedidoErpos(tenantId: string, orderId: string, label: string) {
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const r = await fetch(`${Deno.env.get('SUPABASE_URL')}/functions/v1/delivery-write`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': Deno.env.get('FISCAL_INTERNAL_KEY') ?? '', apikey: anon, Authorization: `Bearer ${anon}` },
    body: JSON.stringify({ action: 'release_held_order', tenant_id: tenantId, order_id: orderId, payment_label: label }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error('Liberar pedido na cozinha: ' + (j.error ?? `HTTP ${r.status}`));
}

/** Aceite (automático ou pelo botão): cozinha + confirmar no iFood. Idempotente. */
async function aceitarPedidoFunil(admin: Admin, c: Ctx, row: any): Promise<string | null> {
  if (!row.order_id) return 'Pedido ainda não entrou no ERPOS.';
  const { data: o } = await admin.from('orders').select('id, status, is_draft, notes').eq('id', row.order_id).maybeSingle();
  if (!o) return 'Pedido do ERPOS não encontrado.';
  if (o.is_draft || o.status === 'draft') {
    // Retido numa sessão que já fechou: leva para o caixa aberto (sem caixa aberto não entra na cozinha).
    const { data: oSess } = await admin.from('orders').select('session_id').eq('id', o.id).maybeSingle();
    const { data: sOk } = oSess?.session_id ? await admin.from('sessions').select('status').eq('id', oSess.session_id).maybeSingle() : { data: null };
    if (sOk?.status !== 'open') {
      const { data: aberta } = await admin.from('sessions').select('id').eq('tenant_id', row.tenant_id).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
      if (!aberta) { const m = 'Sem caixa aberto no ERPOS: abra o caixa para o pedido entrar na cozinha.'; await funnelErro(admin, row.id, m); return m; }
      await admin.from('orders').update({ session_id: aberta.id, updated_at: new Date().toISOString() }).eq('id', o.id);
    }
    const notas = String(o.notes ?? '');
    const cobrar = notas.match(/COBRAR NA ENTREGA: ([^|]+)/i)?.[1]?.trim();
    await liberarPedidoErpos(row.tenant_id, o.id, cobrar ? `Cobrar na entrega: ${cobrar}` : 'iFood (pago no app)');
    // Pedido só com itens sem preparo (ex.: bebidas) não passa pela cozinha: já está pronto.
    const { data: its } = await admin.from('order_items').select('skip_kds').eq('order_id', o.id).neq('status', 'cancelled');
    if ((its ?? []).length && (its ?? []).every((i: any) => i.skip_kds)) {
      await admin.from('ifood_order_outbox').upsert(['start', 'ready'].map((op) => ({ tenant_id: row.tenant_id, order_id: o.id, ifood_order_id: row.ifood_order_id, op })), { onConflict: 'ifood_order_id,op', ignoreDuplicates: true });
    }
  }
  if (row.status === 'placed') {
    const r = await call(admin, c, 'POST', `/order/v1.0/orders/${row.ifood_order_id}/confirm`, undefined, { 'idempotency-key': `confirm-${row.ifood_order_id}` });
    if (!r.ok && r.status !== 409) { const m = apiError(r, 'Confirmar no iFood'); await funnelErro(admin, row.id, m); return m; }
  }
  await funnelErro(admin, row.id, null);
  return null;
}

/** Cria o pedido do ERPOS (rascunho) a partir do pedido do iFood; aceite automático se a loja escolheu. */
async function criarPedidoFunil(admin: Admin, c: Ctx, row: any): Promise<void> {
  const cfg = c.cfg;
  if (row.order_id || !row.details_at || ['cancelled', 'concluded'].includes(row.status)) return;
  if (cfg.funnel_since && new Date(row.created_at) < new Date(cfg.funnel_since)) return;
  const tenantId = cfg.tenant_id;
  const { data: sess } = await admin.from('sessions').select('id').eq('tenant_id', tenantId).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle();
  if (!sess) { await funnelErro(admin, row.id, 'Sem caixa aberto no ERPOS: abra o caixa para o pedido entrar na cozinha.'); return; }

  const [{ data: itens }, { data: links }] = await Promise.all([
    admin.from('ifood_order_items').select('*').eq('order_row_id', row.id),
    admin.from('ifood_item_links').select('level, name_key, group_key, ifood_id, external_code, target_kind, menu_item_id, combo_id, option_id').eq('tenant_id', tenantId),
  ]);
  const itemIds = [...new Set(((links ?? []) as IfoodLink[]).map((l) => l.menu_item_id).filter(Boolean))] as string[];
  const menu = new Map<string, MenuInfo>();
  if (itemIds.length) {
    const { data: mis } = await admin.from('menu_items').select('id, skip_kds, category_id').in('id', itemIds);
    const catIds = [...new Set((mis ?? []).map((m: any) => m.category_id).filter(Boolean))];
    const { data: cats } = catIds.length ? await admin.from('menu_categories').select('id, station_id').in('id', catIds) : { data: [] };
    const est = new Map((cats ?? []).map((k: any) => [k.id, k.station_id ?? null]));
    for (const m of (mis ?? []) as any[]) menu.set(m.id, { skip_kds: !!m.skip_kds, station_id: (est.get(m.category_id) as string | null) ?? null });
  }
  const p = montarPedidoErpos(row, itens ?? [], (links ?? []) as IfoodLink[], menu);

  const { data: numRows } = await admin.rpc('fn_next_tenant_order_number', { p_tenant_id: tenantId });
  const numero = (Array.isArray(numRows) ? numRows[0]?.number : (numRows as any)?.number) ?? `I${Date.now()}`;
  const { data: cr, error: cErr } = await admin.rpc('fn_create_order_bypass', {
    order_data: { tenant_id: tenantId, session_id: sess.id, number: numero, status: 'draft', is_draft: true, is_training: false, client_request_id: row.ifood_order_id, ...p.order },
  });
  if (cErr || !cr?.id) throw new Error('Criar pedido no ERPOS: ' + (cErr?.message ?? 'sem id'));
  const orderId = cr.id as string;
  const now = new Date().toISOString();
  const { error: uErr } = await admin.from('orders').update({
    ifood_order_id: row.ifood_order_id, ifood_repasse: p.pago, is_paid: p.pago, paid_at: p.pago ? now : null,
    delivery_lat: row.delivery_lat ?? null, delivery_lng: row.delivery_lng ?? null, updated_at: now,
  }).eq('id', orderId);
  if (uErr) throw new Error('Marcar pedido do iFood: ' + uErr.message);
  // Evento repetido depois de uma falha no meio: não duplica itens.
  const { count } = await admin.from('order_items').select('id', { count: 'exact', head: true }).eq('order_id', orderId);
  if (!count) {
    const { error: iErr } = await admin.rpc('fn_create_order_items_bypass', { p_order_id: orderId, p_tenant_id: tenantId, p_items: p.items });
    if (iErr) throw new Error('Criar itens no ERPOS: ' + iErr.message);
  }
  await admin.from('ifood_orders').update({ order_id: orderId, funnel_error: null, funnel_at: now, updated_at: now }).eq('id', row.id);
  log('INFO', 'funnel', 'pedido criado no ERPOS', { ifood: row.ifood_order_id, order: orderId, numero, semVinculo: p.semVinculo.length, tenantId });
  if (cfg.order_auto_confirm !== false) await aceiteAutomatico(admin, c, { ...row, order_id: orderId });
}

/** Agendado: fica retido (fora da cozinha) até perto do horário — preparo padrão + 20 min antes do início da janela. */
function agendadoLonge(cfg: any, row: any): boolean {
  const ini = row.order_timing === 'SCHEDULED' ? row.schedule?.deliveryDateTimeStart : null;
  if (!ini) return false;
  const antes = (Number(cfg.default_prep_min ?? 15) + 20) * 60_000;
  return new Date(ini).getTime() - antes > Date.now();
}

/** Aceite automático: agendado longe só confirma no iFood (a varredura libera na hora); erro fica em funnel_error. */
async function aceiteAutomatico(admin: Admin, c: Ctx, row: any) {
  try {
    if (agendadoLonge(c.cfg, row)) {
      if (row.status === 'placed') {
        const r = await call(admin, c, 'POST', `/order/v1.0/orders/${row.ifood_order_id}/confirm`, undefined, { 'idempotency-key': `confirm-${row.ifood_order_id}` });
        if (!r.ok && r.status !== 409) { await funnelErro(admin, row.id, apiError(r, 'Confirmar no iFood')); return; }
      }
      await funnelErro(admin, row.id, null);
      return;
    }
    const erro = await aceitarPedidoFunil(admin, c, row);
    if (erro) log('WARN', 'funnel', 'aceite automático', { ifood: row.ifood_order_id, erro });
  } catch (e) {
    const m = String((e as Error)?.message ?? e).slice(0, 300);
    log('ERROR', 'funnel', 'aceite automático', { ifood: row.ifood_order_id, error: m });
    await funnelErro(admin, row.id, m);
  }
}

/** Depois de cada evento do pedido: cria no ERPOS, repassa cancelamento ou conclusão. */
async function funnelAfterEvent(admin: Admin, c: Ctx, rowId: string) {
  const { data: row } = await admin.from('ifood_orders').select('*').eq('id', rowId).maybeSingle();
  if (!row) return;
  if (row.status === 'cancelled') {
    if (row.order_id) {
      const { error } = await admin.rpc('fn_ifood_cancel_erpos_order', { p_order_id: row.order_id, p_reason: `iFood: ${row.cancel_reason ?? 'cancelado'}` });
      if (error) throw new Error('Cancelar pedido no ERPOS: ' + error.message);
    }
    return;
  }
  if (row.status === 'concluded' && row.order_id) {
    const { data: o } = await admin.from('orders').select('id, status, session_id').eq('id', row.order_id).maybeSingle();
    if (o && !['delivered', 'cancelled'].includes(o.status)) {
      // Concluído sem ter passado pela cozinha (ex.: agendado/aceite pendente): conclui sem imprimir nada.
      // Baixa do que a cozinha não marcou pronto (idempotente por item) e conclui.
      const { data: sess } = o.session_id ? await admin.from('sessions').select('opened_by').eq('id', o.session_id).maybeSingle() : { data: null };
      const { data: its } = await admin.from('order_items').select('id').eq('order_id', o.id).neq('status', 'cancelled');
      if (sess?.opened_by) for (const it of (its ?? []) as any[]) {
        try { await deductStockForOrderItem(admin, row.tenant_id, o.id, it.id, sess.opened_by); } catch (e) { log('WARN', 'funnel', 'baixa de estoque', { item: it.id, error: String(e) }); }
      }
      await admin.from('order_items').update({ status: 'delivered', delivered_at: new Date().toISOString() }).eq('order_id', o.id).in('status', ['new', 'preparing', 'ready']);
      await admin.from('orders').update({ status: 'delivered', is_draft: false, updated_at: new Date().toISOString() }).eq('id', o.id);
    }
    return;
  }
  if (!row.order_id && funnelOn(c.cfg)) await criarPedidoFunil(admin, c, row);
}

/** A cada polling da loja no funil: pedidos que não entraram (ex.: caixa fechado), confirmações pendentes e avisos. */
async function funnelSweep(admin: Admin, cfg: any) {
  const desde = new Date(Date.now() - 6 * 3600_000).toISOString();
  const { data: pend } = await admin.from('ifood_orders').select('*').eq('tenant_id', cfg.tenant_id)
    .in('status', ['placed', 'confirmed', 'preparing', 'ready']).gt('created_at', desde).not('details_at', 'is', null).limit(30);
  for (const row of (pend ?? []) as any[]) {
    const c = await ctxFor(admin, cfg, row.merchant_id);
    if (!c) continue;
    try {
      if (!row.order_id) { if (funnelOn(cfg)) await criarPedidoFunil(admin, c, row); }
      else {
        const { data: o } = await admin.from('orders').select('is_draft, status').eq('id', row.order_id).maybeSingle();
        if (!o || o.status === 'cancelled') continue;
        // Retido: aceite automático que falhou ou agendado que chegou a hora (aceite manual pendente não mexe).
        if (o.is_draft) { if (cfg.order_auto_confirm !== false && funnelOn(cfg)) await aceiteAutomatico(admin, c, row); }
        // Na cozinha mas a confirmação no iFood falhou: tenta de novo.
        else if (row.status === 'placed') await aceitarPedidoFunil(admin, c, row);
      }
    } catch (e) {
      const m = String((e as Error)?.message ?? e).slice(0, 300);
      log('ERROR', 'funnel', 'varredura', { ifood: row.ifood_order_id, error: m });
      await funnelErro(admin, row.id, m);
    }
  }
  const { data: fila } = await admin.from('ifood_order_outbox').select('*').eq('tenant_id', cfg.tenant_id).eq('status', 'pending').order('created_at').limit(30);
  // Mesma transação gera 'ready' e 'dispatch' com o mesmo created_at: ordem fixa preparo → pronto → saiu.
  const PESO: Record<string, number> = { start: 0, ready: 1, dispatch: 2 };
  const ordenada = ((fila ?? []) as any[]).sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)) || PESO[a.op] - PESO[b.op]);
  for (const f of ordenada) {
    const { data: row } = await admin.from('ifood_orders').select('merchant_id, status').eq('ifood_order_id', f.ifood_order_id).maybeSingle();
    if (!row || ['cancelled', 'concluded'].includes(row.status)) {
      await admin.from('ifood_order_outbox').update({ status: 'skipped', last_error: `pedido ${row?.status ?? 'sumiu'}` }).eq('id', f.id);
      continue;
    }
    // Ainda não confirmado no iFood: espera (mandar preparo/pronto antes do confirm dá erro e o aviso se perderia).
    if (row.status === 'placed') continue;
    const c = await ctxFor(admin, cfg, row.merchant_id);
    if (!c) continue;
    const r = await call(admin, c, 'POST', `/order/v1.0/orders/${f.ifood_order_id}/${OUTBOX_PATH[f.op]}`, undefined, { 'idempotency-key': `${f.op}-${f.ifood_order_id}` });
    const tentativas = Number(f.attempts ?? 0) + 1;
    if (r.ok || r.status === 409) {
      await admin.from('ifood_order_outbox').update({ status: 'sent', attempts: tentativas, sent_at: new Date().toISOString(), last_error: r.ok ? null : '409 (já estava nesse status)' }).eq('id', f.id);
      log('INFO', 'funnel', 'aviso enviado', { op: f.op, ifood: f.ifood_order_id });
    } else {
      const fim = (r.status >= 400 && r.status < 500 && r.status !== 429) || tentativas >= 6;
      await admin.from('ifood_order_outbox').update({ status: fim ? 'failed' : 'pending', attempts: tentativas, last_error: apiError(r, OUTBOX_PATH[f.op]).slice(0, 300) }).eq('id', f.id);
      log(fim ? 'ERROR' : 'WARN', 'funnel', 'aviso ao iFood falhou', { op: f.op, ifood: f.ifood_order_id, status: r.status });
    }
  }
}

async function applyEvent(admin: Admin, c: Ctx | null, e: any) {
  const ifoodOrderId = String(e.orderId ?? '');
  if (!ifoodOrderId) return;
  const { data: s } = await admin.from('ifood_shipping_orders').select('*').eq('ifood_order_id', ifoodOrderId).maybeSingle();
  if (!s) {
    // Pedido do iFood (não é entrega chamada daqui): módulo Order, se ligado para esta loja do iFood.
    const cfg = c?.cfg;
    const merchant = String(e.merchantId ?? c?.merchantId ?? '');
    if (c && cfg?.order_enabled && (cfg.order_merchant_ids ?? []).includes(merchant) && String(e.salesChannel ?? '') !== 'POS') {
      await applyOrderEvent(admin, { ...c, merchantId: merchant }, e);
    }
    return;
  }
  const plan = planEvent(s, e);
  // Pedido Sob Demanda nasce com PLACED; confirma (os dados foram validados antes de enviar). Sem o módulo
  // de pedidos o iFood pode recusar — fica no log.
  if (plan.confirm && c) {
    const r = await call(admin, c, 'POST', `/order/v1.0/orders/${ifoodOrderId}/confirm`, undefined, { 'idempotency-key': `confirm-${ifoodOrderId}` });
    if (!r.ok && r.status !== 409) log('WARN', 'event', 'confirmar pedido', { ifoodOrderId, status: r.status, body: r.raw.slice(0, 200) });
  }
  // Cobrado na entrega pelo entregador do iFood: paga o pedido como "iFood Entrega" (a receber do
  // iFood, fora da gaveta). Sem caixa aberto não dá para registrar — fica o aviso para o caixa.
  let obs: string | undefined;
  if (plan.order === 'entregou' && s.payment) {
    let pago = false;
    try { pago = await settleIfoodPayment(admin, s); }
    catch (err) { log('ERROR', 'settle', 'falhou', { order: s.order_id, error: String((err as Error)?.message ?? err) }); }
    obs = pago
      ? 'Pago ao entregador do iFood — lançado como "iFood Entrega" (a receber no repasse do iFood, fora da gaveta).'
      : 'Pagamento recebido pelo entregador do iFood (entra no repasse do iFood, não no caixa) — não consegui lançar sozinho: dê baixa como "iFood Entrega".';
  }
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
  // Um polling por loja por vez (cron de 30 s + botão Atualizar): dois ao mesmo tempo duplicavam itens e tickets.
  const ate = new Date(Date.now() + 90_000).toISOString();
  const { data: trava } = await admin.from('ifood_pdv_config').update({ polling_lock_until: ate }).eq('id', cfg.id)
    .or(`polling_lock_until.is.null,polling_lock_until.lt.${new Date().toISOString()}`).select('id');
  if (!trava?.length) return { skipped: 'polling em andamento' };
  try { return await pollTenantSemTrava(admin, cfg); }
  finally { await admin.from('ifood_pdv_config').update({ polling_lock_until: null }).eq('id', cfg.id); }
}

async function pollTenantSemTrava(admin: Admin, cfg: any) {
  // Lojas do iFood acompanhadas (entrega + pedidos), agrupadas pela autorização que as enxerga:
  // o header x-polling-merchants só aceita lojas que o token daquela autorização pode ler.
  const grupos = new Map<string, { c: Ctx; ids: string[] }>();
  const semAuth: string[] = [];
  for (const m of pollMerchants(cfg)) {
    const c = await ctxFor(admin, cfg, m);
    if (!c) { semAuth.push(m); continue; }
    const g = grupos.get(c.auth.id) ?? { c, ids: [] };
    g.ids.push(m);
    grupos.set(c.auth.id, g);
  }
  if (grupos.size === 0) {
    const msg = 'Sem autorização da loja do iFood escolhida (autorize de novo o app ERPOS PDV).';
    await markPoll(admin, cfg, msg);
    return { error: msg };
  }
  let events = 0, applied = 0;
  const erros: string[] = [];
  for (const g of grupos.values()) {
    const r = await pollGroup(admin, cfg, g.c, g.ids);
    events += r.events ?? 0; applied += r.applied ?? 0;
    if (r.error) erros.push(r.error);
  }
  if (semAuth.length) erros.push(`${semAuth.length} loja(s) do iFood sem autorização`);
  if (funnelOn(cfg) || cfg.order_enabled) {
    try { await funnelSweep(admin, cfg); }
    catch (e) { erros.push('Funil: ' + String((e as Error)?.message ?? e).slice(0, 200)); }
  }
  await markPoll(admin, cfg, erros.length ? erros.join(' | ').slice(0, 500) : null);
  return { events, applied, ...(erros.length ? { error: erros.join(' | ') } : {}) };
}

async function pollGroup(admin: Admin, cfg: any, c: Ctx, merchantIds: string[]): Promise<{ events?: number; applied?: number; error?: string }> {
  const r = await call(admin, c, 'GET', '/events/v1.0/events:polling', undefined, { 'x-polling-merchants': merchantIds.join(',') });
  if (r.status === 204 || (r.ok && !Array.isArray(r.data))) return { events: 0 };
  if (!r.ok) return { error: apiError(r, 'Polling de eventos') };
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
  return { events: events.length, applied };
}

function safeConfig(cfg: any, auths: any[]) {
  if (!cfg) return null;
  const merchants = new Map<string, string>();
  for (const a of auths) for (const m of a.merchants ?? []) merchants.set(m.id, m.name);
  return {
    client_id: cfg.client_id ?? null, has_secret: !!cfg.client_secret,
    system_app: !!cfg.client_id && cfg.client_id === SYSTEM_APP.id, app_type: cfg.app_type === 'centralized' ? 'centralized' : 'distributed',
    homologation_mode: cfg.homologation_mode === true, shipping_enabled: cfg.shipping_enabled === true,
    default_prep_min: cfg.default_prep_min ?? 15,
    shipping_merchant_id: cfg.shipping_merchant_id ?? null, shipping_merchant_name: cfg.shipping_merchant_name ?? null,
    user_code: cfg.user_code && cfg.user_code_expires_at && new Date(cfg.user_code_expires_at) > new Date() ? cfg.user_code : null,
    verification_url: cfg.verification_url ?? null,
    merchants: [...merchants.entries()].map(([id, name]) => ({ id, name })),
    authorized: auths.length > 0,
    last_poll_at: cfg.last_poll_at ?? null, last_poll_error: cfg.last_poll_error ?? null, poll_fail_count: cfg.poll_fail_count ?? 0,
    order_enabled: cfg.order_enabled === true,
    order_mode: cfg.order_mode === 'operate' || cfg.order_mode === 'funnel' ? cfg.order_mode : 'read_only',
    order_auto_confirm: cfg.order_auto_confirm !== false,
    order_merchant_ids: cfg.order_merchant_ids ?? [],
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
      const { data: lojas } = await admin.from('ifood_pdv_config').select('*').or('shipping_enabled.eq.true,order_enabled.eq.true');
      const out = [];
      for (const cfg of (lojas ?? []).map(withSystemApp).filter((c) => c.client_id)) {
        // Pedidos do iFood ligados: acompanha sempre (pedido chega a qualquer hora do expediente).
        if (cfg.order_enabled && (cfg.order_merchant_ids ?? []).length) {
          try { out.push({ tenant_id: cfg.tenant_id, ...(await pollTenant(admin, cfg)) }); }
          catch (e) { out.push({ tenant_id: cfg.tenant_id, error: String((e as Error)?.message ?? e) }); }
          continue;
        }
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
    const { data: cfgRow } = await admin.from('ifood_pdv_config').select('*').eq('tenant_id', tenantId).maybeSingle();
    const cfg = withSystemApp(cfgRow);
    const listAuths = async () => (await admin.from('ifood_pdv_auths').select('id, merchants, authorized_at').eq('tenant_id', tenantId).order('authorized_at', { ascending: false })).data ?? [];

    // A autorização traz TODAS as lojas do login do Portal do Parceiro. Loja do iFood que já é de outra loja do ERPOS
    // (no financeiro — fin_ifood_merchants — ou ligada lá em pedidos/entregas) não pode ser ligada aqui: os dois
    // tenants disputariam os mesmos eventos (ack) e o pedido seria contado em dobro.
    const lojasDeOutra = async (ids: string[]): Promise<Map<string, string>> => {
      const out = new Map<string, string>();
      const alvo = [...new Set(ids.filter(Boolean))];
      if (!alvo.length) return out;
      const [{ data: fin }, { data: pdv }] = await Promise.all([
        admin.from('fin_ifood_merchants').select('tenant_id, merchant_id').in('merchant_id', alvo).neq('tenant_id', tenantId),
        admin.from('ifood_pdv_config').select('tenant_id, shipping_merchant_id, order_enabled, order_merchant_ids').neq('tenant_id', tenantId),
      ]);
      const deTenant = new Map<string, string>();
      for (const f of fin ?? []) deTenant.set(String(f.merchant_id), f.tenant_id);
      for (const p of pdv ?? []) for (const id of alvo) {
        if (p.shipping_merchant_id === id || (p.order_enabled && (p.order_merchant_ids ?? []).includes(id))) deTenant.set(id, p.tenant_id);
      }
      if (!deTenant.size) return out;
      const { data: ts } = await admin.from('tenants').select('id, name').in('id', [...new Set(deTenant.values())]);
      const nome = new Map((ts ?? []).map((t: any) => [t.id, t.name as string]));
      for (const [id, t] of deTenant) out.set(id, nome.get(t) ?? 'outra loja');
      return out;
    };

    // Lojas da autorização: /merchants (módulo Merchant) e, se vier vazio ou negado, as lojas do iFood desta loja do
    // ERPOS no financeiro conferidas pelo polling de eventos (módulo Order).
    const lojasDaAutorizacao = async (access: string, homolog: boolean) => {
      const m = await listarLojas(access, homolog);
      if (m.ok && m.merchants.length) return m;
      const { data: fin } = await admin.from('fin_ifood_merchants').select('merchant_id, name').eq('tenant_id', tenantId);
      const cand = (fin ?? []).map((f: any) => ({ id: String(f.merchant_id), name: String(f.name ?? f.merchant_id) }));
      const merchants = cand.length ? await lojasPorEventos(access, homolog, cand) : [];
      return merchants.length ? { ok: true, status: 200, data: null, raw: '', merchants } : m;
    };

    if (action === 'get_config') {
      // Loja sem config ainda: com o app do sistema, a tela já mostra "Gerar código".
      const shown = cfg ?? withSystemApp({ tenant_id: tenantId });
      const config = safeConfig(shown, cfg ? await listAuths() : []);
      if (config?.merchants.length) {
        const outra = await lojasDeOutra(config.merchants.map((m) => m.id));
        config.merchants = config.merchants.map((m) => ({ ...m, outra_loja: outra.get(m.id) ?? null }));
      }
      return json({ success: true, config, can_edit: isManager, system_app_available: hasSystemApp() });
    }

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
      // Sem endereço cadastrado do cliente: lê do texto do pedido.
      const txt = parseEnderecoPedido(o.delivery_address);
      if (!addr) addr = { street: txt.street, number: txt.number, complement: txt.complement, reference_point: txt.reference, bairro: txt.neighborhood };
      const city = txt.city || String(loja?.city ?? '').trim(); // a cidade do texto vem da config do delivery
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
      const r = await call(admin, c, 'POST', `/shipping/v1.0/orders/${s.ifood_order_id}/cancel`, { reason, cancellationCode: String(code) }, { 'idempotency-key': `cancel-${s.id}-${code}` });
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

    // Evento de EXEMPLO (a loja de teste do iFood não aloca entregador nem gera DISPATCHED/CONCLUDED —
    // FAQ do portal manda usar os eventos da doc). Só chamada interna e só com o modo homologação ligado.
    if (action === 'simulate_event') {
      if (!internal) return errResp('Unauthorized', 401);
      if (!cfg?.homologation_mode) return errResp('Só com o modo homologação ligado.');
      const { data: s } = await admin.from('ifood_shipping_orders').select('ifood_order_id').eq('id', String(body.shipping_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      if (!s?.ifood_order_id) return errResp('Entrega não encontrada.');
      const ev = { id: `sim-${crypto.randomUUID()}`, fullCode: String(body.full_code ?? ''), orderId: s.ifood_order_id, createdAt: new Date().toISOString(), metadata: body.metadata ?? null, salesChannel: 'POS' };
      await admin.from('ifood_pdv_events').insert({ event_id: ev.id, tenant_id: tenantId, ifood_order_id: ev.orderId, full_code: ev.fullCode, sales_channel: 'POS', metadata: ev.metadata, event_at: ev.createdAt, error: 'simulado' });
      await applyEvent(admin, await loadCtx(admin, cfg), ev);
      await admin.from('ifood_pdv_events').update({ processed_at: new Date().toISOString() }).eq('event_id', ev.id);
      const { data: depois } = await admin.from('ifood_shipping_orders').select('status, last_event').eq('ifood_order_id', s.ifood_order_id).maybeSingle();
      return json({ success: true, shipping: depois });
    }

    // Endereço/coordenadas da loja do iFood que despacha (Merchant API) — conferência na configuração.
    if (action === 'merchant_info') {
      const c = await needCtx();
      const r = await call(admin, c, 'GET', `/merchant/v1.0/merchants/${c.merchantId}`);
      if (!r.ok) return errResp(apiError(r, 'Dados da loja'));
      const a = r.data?.address ?? {};
      return json({ success: true, merchant: { id: c.merchantId, name: r.data?.name ?? null, address: a, lat: a.latitude ?? null, lng: a.longitude ?? null } });
    }

    if (action === 'poll') {
      if (!cfg?.shipping_enabled) return json({ success: true, skipped: true });
      return json({ success: true, ...(await pollTenant(admin, cfg)) });
    }

    // ── Pedidos do iFood (módulo Order) ──
    const getIfoodOrder = async () => {
      const { data: o } = await admin.from('ifood_orders').select('*').eq('id', String(body.order_row_id ?? '')).eq('tenant_id', tenantId).maybeSingle();
      return o;
    };
    if (action === 'order_refresh') {
      const o = await getIfoodOrder();
      if (!o) return errResp('Pedido não encontrado.');
      const c = await ctxFor(admin, cfg, o.merchant_id);
      if (!c) return errResp('Loja do iFood sem autorização no app ERPOS PDV.');
      await fetchOrderDetails(admin, c, o, o.ifood_order_id);
      return json({ success: true });
    }
    // Operar o pedido pelo ERPOS (confirmar, preparo, pronto, despachar, cancelar): só no modo "operar" —
    // em produção a loja opera pelo Gestor de Pedidos do iFood (modo só leitura).
    if (action === 'order_action' || action === 'order_cancel_reasons') {
      // Funil: a cozinha/entregas do ERPOS avisam o iFood sozinhas; pela tela ficam aceitar, cancelar, negociação e código.
      const funil = cfg?.order_mode === 'funnel';
      const opFunil = ['accept', 'cancel', 'dispute_accept', 'dispute_reject', 'verify_code'];
      if (cfg?.order_mode !== 'operate' && !(funil && (action === 'order_cancel_reasons' || opFunil.includes(String(body.op ?? ''))))) {
        return errResp(funil ? 'No funil, preparo/pronto/despacho são avisados ao iFood pela cozinha e pelo Gestor de Entregas.' : 'Pedidos do iFood em modo só leitura: a loja opera pelo Gestor de Pedidos do iFood.');
      }
      if (isContabilidadeRole(role)) return errResp('Seu perfil não pode operar pedidos.', 403);
      const o = await getIfoodOrder();
      if (!o) return errResp('Pedido não encontrado.');
      const c = await ctxFor(admin, cfg, o.merchant_id);
      if (!c) return errResp('Loja do iFood sem autorização no app ERPOS PDV.');
      if (action === 'order_cancel_reasons') {
        const r = await call(admin, c, 'GET', `/order/v1.0/orders/${o.ifood_order_id}/cancellationReasons`);
        if (r.status === 204) return json({ success: true, reasons: [] });
        if (!r.ok) return errResp(apiError(r, 'Motivos de cancelamento'));
        const lista = Array.isArray(r.data) ? r.data : (r.data?.reasons ?? []);
        return json({ success: true, reasons: lista.map((x: any) => ({ code: String(x.cancelCodeId ?? x.code), description: String(x.description ?? '') })) });
      }
      const op = String(body.op ?? '');
      if (funil && op === 'cancel' && !isManager && !/caix|cashier/i.test(String(role ?? ''))) {
        return errResp('Cancelar pedido do iFood (tem multa e pesa na loja): só supervisor, admin ou caixa.', 403);
      }
      // Funil com aceite manual: libera o pedido na cozinha do ERPOS e confirma no iFood.
      if (op === 'accept') {
        if (!funil) return errResp('Aceitar só existe no funil.');
        const erro = await aceitarPedidoFunil(admin, c, o);
        if (erro) return errResp(erro);
        log('INFO', 'order_action', 'accept', { order: o.ifood_order_id, tenantId });
        return json({ success: true, message: 'Pedido aceito: foi para a cozinha e o iFood foi avisado.' });
      }
      // Plataforma de Negociação (HANDSHAKE_DISPUTE): cliente pede cancelamento/reembolso e a loja aceita ou recusa
      // antes de expirar (senão vale o timeoutAction do iFood). Critério de homologação do Order.
      if (op === 'dispute_accept' || op === 'dispute_reject') {
        const disputeId = String(o.dispute?.disputeId ?? o.dispute?.id ?? '').trim();
        if (!disputeId) return errResp('Este pedido não tem negociação aberta.');
        if (o.dispute?.settled || o.dispute?.answered) return errResp('Essa negociação já foi respondida.');
        const aceitar = op === 'dispute_accept';
        const motivo = String(body.reason ?? '').trim().slice(0, 250);
        if (!aceitar && !motivo) return errResp('Escreva o motivo da recusa.');
        const r = await call(admin, c, 'POST', `/order/v1.0/disputes/${encodeURIComponent(disputeId)}/${aceitar ? 'accept' : 'reject'}`,
          aceitar ? undefined : { reason: motivo }, { 'idempotency-key': `${op}-${disputeId}` });
        if (!r.ok) return errResp(apiError(r, 'Negociação'));
        await admin.from('ifood_orders').update({ dispute: { ...o.dispute, answered: aceitar ? 'accept' : 'reject', answered_at: new Date().toISOString() }, updated_at: new Date().toISOString() }).eq('id', o.id);
        log('INFO', 'order_action', op, { order: o.ifood_order_id, disputeId, tenantId });
        return json({ success: true, message: aceitar ? 'Pedido do cliente aceito — o iFood confirma no próximo polling.' : 'Pedido do cliente recusado.' });
      }
      // Entrega pela loja (delivered_by MERCHANT): o motoboy digita o código que o cliente vê no app do iFood;
      // código válido → o iFood conclui o pedido sozinho (evento CONCLUDED). Doc: Order › verifyDeliveryCode.
      if (op === 'verify_code') {
        const code = String(body.code ?? '').replace(/\s/g, '').slice(0, 12);
        if (!code) return errResp('Informe o código de entrega.');
        const r = await call(admin, c, 'POST', `/order/v1.0/orders/${o.ifood_order_id}/verifyDeliveryCode`, { code });
        if (!r.ok) return errResp(apiError(r, 'Código de entrega'));
        // Só vale com confirmação EXPLÍCITA do iFood (doc: { "valid": true }); resposta em outro formato = não confirmado.
        const valid = r.data?.valid === true || r.data?.success === true;
        if (!valid) log('WARN', 'order_action', 'verify_code não confirmado', { order: o.ifood_order_id, resposta: r.data, tenantId });
        if (valid) await admin.from('ifood_orders').update({ delivery_code_ok: true, updated_at: new Date().toISOString() }).eq('id', o.id);
        log('INFO', 'order_action', 'verify_code', { order: o.ifood_order_id, valid, tenantId });
        return json({ success: true, valid });
      }
      const paths: Record<string, string> = { confirm: 'confirm', start: 'startPreparation', ready: 'readyToPickup', dispatch: 'dispatch', cancel: 'requestCancellation' };
      if (!paths[op]) return errResp('Ação inválida.');
      let payload: unknown = undefined;
      if (op === 'cancel') {
        const code = String(body.code ?? '').trim();
        if (!code) return errResp('Escolha o motivo do cancelamento.');
        // A doc mostra só { reason }, mas a API exige cancellationCode (400 InvalidParameter sem ele — teste 2026-09-26).
        payload = { reason: String(body.reason ?? '').trim().slice(0, 250) || code, cancellationCode: code };
      }
      const r = await call(admin, c, 'POST', `/order/v1.0/orders/${o.ifood_order_id}/${paths[op]}`, payload, { 'idempotency-key': `${op}-${o.ifood_order_id}` });
      if (!r.ok) return errResp(apiError(r, 'iFood'));
      if (op === 'cancel') await admin.from('ifood_orders').update({ cancel_requested: true, updated_at: new Date().toISOString() }).eq('id', o.id);
      log('INFO', 'order_action', op, { order: o.ifood_order_id, tenantId });
      return json({ success: true, message: 'Enviado ao iFood — a confirmação chega no próximo polling (até 30 s).' });
    }

    // ── Loja no iFood (módulo Merchant) e avaliações (módulo Review) ──
    // Qualquer loja do iFood autorizada nesta loja do ERPOS; mudar pausa/horário/responder = admin/gerente.
    const merchantCtx = async () => {
      const m = String(body.merchant_id ?? '').trim();
      if (!m) throw new Error('Escolha a loja do iFood.');
      const c = await ctxFor(admin, cfg, m);
      if (!c) throw new Error('Essa loja do iFood não autorizou o app ERPOS PDV.');
      return c;
    };
    const ok = (r: { status: number; ok: boolean }) => r.ok || r.status === 204;

    if (action === 'merchant_overview') {
      const c = await merchantCtx();
      const base = `/merchant/v1.0/merchants/${c.merchantId}`;
      const [det, st, pausas, horas] = await Promise.all([
        call(admin, c, 'GET', base), call(admin, c, 'GET', `${base}/status`),
        call(admin, c, 'GET', `${base}/interruptions`), call(admin, c, 'GET', `${base}/opening-hours`),
      ]);
      return json({
        success: true,
        merchant: det.ok ? det.data : null,
        status: st.ok ? st.data : null,
        interruptions: pausas.status === 204 ? [] : (pausas.ok ? pausas.data : null),
        opening_hours: horas.ok ? horas.data : null,
        errors: [det, st, pausas, horas].filter((r) => !ok(r)).map((r) => apiError(r, 'iFood')),
      });
    }

    if (action === 'merchant_pause_create' || action === 'merchant_pause_delete' || action === 'merchant_hours_save') {
      if (!isManager) return errResp('Só admin ou supervisor altera a loja no iFood.', 403);
      const c = await merchantCtx();
      const base = `/merchant/v1.0/merchants/${c.merchantId}`;
      if (action === 'merchant_pause_create') {
        const min = Math.round(Number(body.minutes));
        if (!Number.isFinite(min) || min < 1 || min > 7 * 24 * 60) return errResp('Duração da pausa entre 1 minuto e 7 dias.');
        const description = cut(body.description, 255) || 'Pausa pela loja';
        const start = new Date(Date.now() + 5_000);
        const end = new Date(start.getTime() + min * 60_000);
        const r = await call(admin, c, 'POST', `${base}/interruptions`, { description, start: start.toISOString(), end: end.toISOString() });
        if (r.status === 409) return errResp('Já existe uma pausa nesse horário — remova a atual antes.');
        if (!r.ok) return errResp(apiError(r, 'Criar pausa'));
        log('INFO', 'merchant', 'pausa criada', { merchant: c.merchantId, min, tenantId });
        return json({ success: true, interruption: r.data });
      }
      if (action === 'merchant_pause_delete') {
        const id = String(body.interruption_id ?? '').trim();
        if (!id) return errResp('Pausa não informada.');
        const r = await call(admin, c, 'DELETE', `${base}/interruptions/${encodeURIComponent(id)}`);
        if (!ok(r)) return errResp(apiError(r, 'Remover pausa'));
        log('INFO', 'merchant', 'pausa removida', { merchant: c.merchantId, id, tenantId });
        return json({ success: true });
      }
      // Horários: substituição completa (PUT). Valida antes de enviar (o iFood recusa sobreposição com 400).
      const DIAS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];
      const shifts = (Array.isArray(body.shifts) ? body.shifts : []).map((x: any) => ({
        dayOfWeek: String(x.dayOfWeek ?? '').toUpperCase(), start: String(x.start ?? ''), duration: Math.round(Number(x.duration)),
      }));
      if (shifts.length === 0) return errResp('Informe ao menos um turno.');
      for (const sh of shifts) {
        if (!DIAS.includes(sh.dayOfWeek) || !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(sh.start) || !(sh.duration > 0) || sh.duration > 24 * 60) return errResp('Turno inválido: confira dia, hora de abertura e duração.');
        if (sh.start.length === 5) sh.start += ':00';
      }
      const minutos = (h: string) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5));
      for (const d of DIAS) {
        const doDia = shifts.filter((x: any) => x.dayOfWeek === d).map((x: any) => [minutos(x.start), minutos(x.start) + x.duration]).sort((a: number[], b: number[]) => a[0] - b[0]);
        for (let i = 1; i < doDia.length; i++) if (doDia[i][0] < doDia[i - 1][1]) return errResp('Há turnos sobrepostos no mesmo dia.');
      }
      const r = await call(admin, c, 'PUT', `${base}/opening-hours`, { storeId: c.merchantId, shifts });
      if (!r.ok) return errResp(apiError(r, 'Salvar horários'));
      log('INFO', 'merchant', 'horários salvos', { merchant: c.merchantId, turnos: shifts.length, tenantId });
      return json({ success: true, opening_hours: r.data });
    }

    if (action === 'reviews_list' || action === 'review_get' || action === 'reviews_summary') {
      const c = await merchantCtx();
      const base = `/review/v2.0/merchants/${c.merchantId}`;
      if (action === 'reviews_summary') {
        const r = await call(admin, c, 'GET', `${base}/summary`);
        // Loja sem nenhuma avaliação: o iFood responde 404 "Summary not found" (teste 2026-09-26).
        if (r.status === 404) return json({ success: true, summary: { totalReviewsCount: 0, validReviewsCount: 0, score: null } });
        if (!r.ok) return errResp(apiError(r, 'Resumo das avaliações'));
        return json({ success: true, summary: r.data });
      }
      if (action === 'review_get') {
        const id = String(body.review_id ?? '').trim();
        const r = await call(admin, c, 'GET', `${base}/reviews/${encodeURIComponent(id)}`);
        if (r.status === 404) return errResp('Avaliação não encontrada.');
        if (!r.ok) return errResp(apiError(r, 'Avaliação'));
        return json({ success: true, review: r.data });
      }
      const page = Math.max(1, Math.round(Number(body.page ?? 1)) || 1);
      const pageSize = Math.min(50, Math.max(1, Math.round(Number(body.page_size ?? 20)) || 20));
      const q = new URLSearchParams({ page: String(page), pageSize: String(pageSize), addCount: 'true' });
      const iso = (v: unknown, fim: boolean) => (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T${fim ? '23:59:59' : '00:00:00'}Z` : null);
      const df = iso(body.date_from, false), dt = iso(body.date_to, true);
      if (df) q.set('dateFrom', df);
      if (dt) q.set('dateTo', dt);
      const r = await call(admin, c, 'GET', `${base}/reviews?${q}`);
      if (!r.ok) return errResp(apiError(r, 'Avaliações'));
      return json({ success: true, ...(r.data ?? {}) });
    }

    // ── Indicadores (módulo Analytics): KPIs D-1 agregados, só leitura. Admin/gerente/contabilidade (faturamento).
    // POST é leitura → repete com backoff em 429/5xx como os GET. `homologacao` = corpo do exemplo da doc
    // (o payload devolvido é o que o wizard de homologação do Devportal pede).
    if (action === 'analytics_kpis') {
      if (!isManager && !isContabilidadeRole(role)) return errResp('Só admin, supervisor ou contabilidade vê os indicadores do iFood.', 403);
      const c = await merchantCtx();
      const per = periodoKpis(body.de, body.ate);
      if ('erro' in per) return errResp(per.erro as string);
      const path = `/analytics/v1.0/merchants/${c.merchantId}/orders/kpis`;
      const kpis = async (corpo: any) => {
        const inval = validarCorpoKpis(corpo);
        if (inval) throw new Error(inval);
        const r = await call(admin, c, 'POST', path, corpo, {}, true);
        log(r.ok ? 'INFO' : 'WARN', 'analytics', 'kpis', { merchant: c.merchantId, status: r.status, tenantId, homolog: c.cfg.homologation_mode === true });
        if (!r.ok) {
          const det = r.data?.error?.message ?? r.data?.message ?? (typeof r.data?.error === 'string' ? r.data.error : '') ?? '';
          throw Object.assign(new Error(mensagemErroKpis(r.status, String(det || '').trim())), { status: r.status });
        }
        return r.data ?? {};
      };
      const periodo = { de: per.de, ate: per.ate, dias: per.dias, ajustado: per.ajustado, homologacao: c.cfg.homologation_mode === true };
      try {
        if (body.homologacao === true) {
          const corpo = corpoHomologacao(per.gte, per.lte);
          const resp = await kpis(corpo);
          return json({ success: true, periodo, request: { method: 'POST', url: 'https://merchant-api.ifood.com.br' + path, headers: c.cfg.homologation_mode === true ? { 'x-request-homologation': 'true' } : {}, body: corpo }, response: resp });
        }
        // Todas as páginas (currentPage/totalPages; até 20 × 1000 linhas). Linha com a mesma combinação de chaves
        // já vista é descartada (proteção contra página repetida — não somar duas vezes).
        const linhas: any[] = [];
        const vistas = new Set<string>();
        let paginas = 1, totalItems: number | null = null;
        for (let page = 1; page <= 20; page++) {
          const r = await kpis(consultaKpis(per.gte, per.lte, page));
          for (const l of Array.isArray(r.data) ? r.data : []) {
            const chave = JSON.stringify(l?.groupByKey?.value ?? l);
            if (vistas.has(chave)) continue;
            vistas.add(chave); linhas.push(l);
          }
          paginas = Math.max(1, Number(r.totalPages ?? 1));
          totalItems = Number.isFinite(Number(r.totalItems)) ? Number(r.totalItems) : totalItems;
          if (page >= paginas) break;
        }
        return json({ success: true, periodo, resumo: resumirLinhas(linhas), linhas: linhas.length, total_items: totalItems, paginas });
      } catch (e) {
        return errResp((e as Error).message, 400, { http_status: (e as any).status ?? null });
      }
    }

    if (action === 'review_answer') {
      if (!isManager) return errResp('Só admin ou supervisor responde avaliações.', 403);
      const c = await merchantCtx();
      const id = String(body.review_id ?? '').trim();
      const text = String(body.text ?? '').trim();
      if (text.length < 10 || text.length > 300) return errResp('A resposta precisa ter de 10 a 300 caracteres.');
      const r = await call(admin, c, 'POST', `/review/v2.0/merchants/${c.merchantId}/reviews/${encodeURIComponent(id)}/answers`, { text });
      if (r.status === 409 || r.status === 422) return errResp('Essa avaliação já foi respondida ou não aceita resposta.');
      if (!r.ok) return errResp(apiError(r, 'Responder'));
      log('INFO', 'review', 'respondida', { merchant: c.merchantId, id, tenantId });
      return json({ success: true, answer: r.data });
    }

    // ── Configuração (admin/gerente) ──
    if (!isManager) return errResp('Apenas admin/supervisor', 403);

    const temAtivas = async () => {
      const { count } = await admin.from('ifood_shipping_orders').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).in('status', ACTIVE);
      return (count ?? 0) > 0;
    };
    const MSG_ATIVAS = 'Há entregas iFood em andamento — espere terminarem antes de mudar isso (senão ninguém acompanha).';

    if (action === 'save_config') {
      const clientId = String(body.client_id ?? '').trim();
      const clientSecret = String(body.client_secret ?? '').trim();
      if (!clientId) return errResp('Informe o Client ID do app ERPOS PDV.');
      if (!clientSecret && !(cfgRow?.client_id === clientId && cfgRow?.client_secret)) return errResp('Informe o Client Secret do app ERPOS PDV.');
      const changedApp = cfg && cfg.client_id !== clientId;
      if (changedApp && await temAtivas()) return errResp(MSG_ATIVAS);
      const appType = body.app_type === 'centralized' ? 'centralized' : 'distributed';
      const row: Record<string, unknown> = { tenant_id: tenantId, client_id: clientId, client_secret: clientSecret || cfgRow?.client_secret, app_type: appType, updated_at: new Date().toISOString() };
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
        const dona = id ? (await lojasDeOutra([id])).get(id) : undefined;
        if (dona) return errResp(`A loja do iFood "${m?.name ?? id}" é da loja "${dona}" no ERPOS — escolha uma loja do iFood desta loja.`);
        if (id !== (cfg.shipping_merchant_id ?? '') && await temAtivas()) return errResp(MSG_ATIVAS);
        upd.shipping_merchant_id = id || null; upd.shipping_merchant_name = m?.name ?? null;
      }
      if (typeof body.order_enabled === 'boolean') upd.order_enabled = body.order_enabled;
      if (body.order_mode === 'read_only' || body.order_mode === 'operate' || body.order_mode === 'funnel') {
        upd.order_mode = body.order_mode;
        // Só entram no funil os pedidos a partir de agora (os anteriores já foram atendidos pelo tablet do iFood).
        if (body.order_mode === 'funnel' && cfg.order_mode !== 'funnel') upd.funnel_since = new Date().toISOString();
      }
      if (typeof body.order_auto_confirm === 'boolean') upd.order_auto_confirm = body.order_auto_confirm;
      let aviso: string | null = null;
      const pedidosLigados = (upd.order_enabled ?? cfg.order_enabled) === true;
      if (Array.isArray(body.order_merchant_ids) || (pedidosLigados && typeof body.order_enabled === 'boolean')) {
        const ok = new Map<string, string>((await listAuths()).flatMap((a: any) => (a.merchants ?? []).map((m: any) => [m.id, m.name])));
        const pedidos: string[] = Array.isArray(body.order_merchant_ids) ? body.order_merchant_ids.map(String) : (cfg.order_merchant_ids ?? []);
        let ids = pedidos.filter((id) => ok.has(id));
        const outra = await lojasDeOutra(ids);
        if (outra.size) {
          aviso = 'Não ligado aqui (é de outra loja do ERPOS): ' + [...outra].map(([id, dona]) => `${ok.get(id)} → ${dona}`).join('; ') + '.';
          ids = ids.filter((id) => !outra.has(id));
        }
        upd.order_merchant_ids = ids;
      }
      if (typeof body.shipping_enabled === 'boolean') {
        if (body.shipping_enabled && !(upd.shipping_merchant_id ?? cfg.shipping_merchant_id)) return errResp('Escolha a loja do iFood que vai despachar as entregas.');
        if (!body.shipping_enabled && cfg.shipping_enabled && await temAtivas()) return errResp(MSG_ATIVAS);
        upd.shipping_enabled = body.shipping_enabled;
      }
      const { error } = await admin.from('ifood_pdv_config').update(upd).eq('id', cfg.id);
      if (error) return errResp('Salvar: ' + error.message, 500);
      return json({ success: true, aviso });
    }

    // App centralizado: token por client_credentials e a lista das lojas que o app enxerga (sem código).
    if (action === 'connect_centralized') {
      if (!cfg?.client_id || !cfg.client_secret || cfg.app_type !== 'centralized') return errResp('Salve antes as credenciais de um app centralizado.');
      const r = await ifoodForm('/authentication/v1.0/oauth/token', { grantType: 'client_credentials', clientId: cfg.client_id, clientSecret: cfg.client_secret }, cfg.homologation_mode === true);
      if (!r.ok || !r.data?.accessToken) return errResp(apiError(r, 'Conectar'));
      const access = r.data.accessToken as string;
      const m = await listarLojas(access, cfg.homologation_mode === true);
      if (!m.ok) return errResp(apiError(m, 'Listar lojas'));
      const merchants = m.merchants;
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

    // Volta para o app ERPOS PDV do sistema (apaga a credencial própria; autorizações de outro app caem).
    if (action === 'use_system_app') {
      if (!hasSystemApp()) return errResp('O app ERPOS PDV do sistema não está configurado no servidor.');
      if (!cfgRow) return json({ success: true });
      const changedApp = cfgRow.client_id && cfgRow.client_id !== SYSTEM_APP.id;
      if (changedApp && await temAtivas()) return errResp(MSG_ATIVAS);
      const upd: Record<string, unknown> = { client_id: null, client_secret: null, app_type: 'distributed', updated_at: new Date().toISOString() };
      if (changedApp) Object.assign(upd, { user_code: null, auth_verifier_secret: null, shipping_merchant_id: null, shipping_merchant_name: null, shipping_enabled: false, homologation_mode: false, homologation_until: null });
      const { error } = await admin.from('ifood_pdv_config').update(upd).eq('id', cfgRow.id);
      if (error) return errResp('Salvar: ' + error.message, 500);
      if (changedApp) await admin.from('ifood_pdv_auths').delete().eq('tenant_id', tenantId);
      return json({ success: true });
    }

    if (action === 'request_user_code') {
      const rc = cfg ?? withSystemApp({ tenant_id: tenantId });
      if (!rc?.client_id) return errResp('Salve primeiro o Client ID e o Client Secret.');
      // 1ª vez da loja com o app do sistema: cria a config (o código fica guardado nela).
      if (!rc.id) {
        const { data: novo, error } = await admin.from('ifood_pdv_config')
          .insert({ tenant_id: tenantId, app_type: 'distributed', created_by: userId, updated_at: new Date().toISOString() }).select('id').single();
        if (error) return errResp('Salvar: ' + error.message, 500);
        rc.id = novo.id;
      }
      const r = await ifoodForm('/authentication/v1.0/oauth/userCode', { clientId: rc.client_id }, rc.homologation_mode === true);
      if (!r.ok || !r.data?.userCode) return errResp(apiError(r, 'Gerar código'));
      await admin.from('ifood_pdv_config').update({
        user_code: r.data.userCode, auth_verifier_secret: r.data.authorizationCodeVerifier,
        verification_url: r.data.verificationUrlComplete ?? r.data.verificationUrl ?? null,
        user_code_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 600) * 1000).toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', rc.id);
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
      const { merchants } = await lojasDaAutorizacao(access, cfg.homologation_mode === true);
      const now = new Date().toISOString();
      const { error: aErr } = await admin.from('ifood_pdv_auths').insert({
        tenant_id: tenantId, access_token: access, refresh_token: r.data.refreshToken ?? null,
        token_expires_at: new Date(Date.now() + Number(r.data.expiresIn ?? 21600) * 1000).toISOString(),
        merchants, authorized_at: now, updated_at: now,
      });
      if (aErr) return errResp('Gravar autorização: ' + aErr.message, 500);
      const upd: Record<string, unknown> = { user_code: null, auth_verifier_secret: null, updated_at: now };
      // Uma loja só na autorização e nenhuma escolhida ainda → já fica escolhida.
      if (!cfg.shipping_merchant_id && merchants.length === 1 && !(await lojasDeOutra([merchants[0].id])).size) Object.assign(upd, { shipping_merchant_id: merchants[0].id, shipping_merchant_name: merchants[0].name });
      await admin.from('ifood_pdv_config').update(upd).eq('id', cfg.id);
      const aviso = merchants.length ? null
        : 'O iFood aceitou o código, mas não liberou nenhuma loja para o ERPOS PDV. No Portal do Parceiro, confira em Apps se o ERPOS PDV ficou ativo na loja certa e conclua todas as etapas; depois clique em "Autorizar outra loja" e repita.';
      return json({ success: true, merchants, aviso });
    }

    // Renova o acesso de cada autorização e relê as lojas que ela enxerga (loja liberada depois, ou autorização que
    // voltou sem nenhuma loja — 05/10 Paranaguá: Apps do portal mostrava o ERPOS PDV nas 3 lojas e /merchants vinha []).
    if (action === 'refresh_merchants') {
      if (!cfg?.client_id) return errResp('App do iFood não configurado.');
      const auths = (await admin.from('ifood_pdv_auths').select('*').eq('tenant_id', tenantId)).data ?? [];
      if (!auths.length) return errResp('A loja ainda não autorizou o app ERPOS PDV.');
      let total = 0;
      for (const a of auths) {
        a.token_expires_at = null; // força renovar
        const access = await getToken(admin, cfg, a);
        const m = await lojasDaAutorizacao(access, cfg.homologation_mode === true);
        if (!m.ok && m.status !== 403) return errResp(apiError(m, 'Listar lojas'));
        await admin.from('ifood_pdv_auths').update({ merchants: m.merchants, updated_at: new Date().toISOString() }).eq('id', a.id);
        total += m.merchants.length;
      }
      return json({ success: true, total, aviso: total ? null : 'O iFood ainda não libera nenhuma loja para o ERPOS PDV com essa autorização. Gere um código novo ("Autorizar outra loja") e autorize de novo no Portal do Parceiro.' });
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

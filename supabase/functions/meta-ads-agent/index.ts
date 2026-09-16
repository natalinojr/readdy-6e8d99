// meta-ads-agent — Gestor de tráfego pago (IA) do módulo Tráfego Pago. 2026-09-16.
//
// O que faz: todo dia (cron 08h30 BRT) ou a pedido ("Rodar agora" / assistente), lê os
// números da conta de anúncios (via meta-ads-insights, 7 e 30 dias), cruza com o ERPOS
// (pedidos, mais vendidos, área de entrega, WhatsApp), aplica as REGRAS DE MERCADO
// (stop-loss por custo/resultado, fadiga de criativo por frequência/CTR, escala +20% a cada
// 72h, proteção da fase de aprendizado, tetos diário e mensal) e pede à IA que revise e
// escreva o resumo. O resultado vira uma rodada (meta_agent_runs) e uma lista de ações
// (meta_agent_actions). No modo "sugerir" tudo espera o dono aprovar; no modo "autônomo"
// as ações seguras (pausar/reativar/ajustar orçamento dentro dos limites) executam na hora
// e criar campanha nova só se `autonomia_criar` estiver ligado.
//
// Ações (body.action):
//   get_settings   {tenant_id}                        → config + conexão + permissões do token + páginas
//   save_settings  {tenant_id, settings}   (admin)    → grava config
//   run            {tenant_id}                        → roda o agente agora (uma loja)
//   run_all        {}                      (interno)  → cron: todas as lojas com enabled=true
//   list_runs      {tenant_id, limit?}
//   list_actions   {tenant_id, status?, limit?}
//   decide         {tenant_id, action_id, decision:'aprovar'|'rejeitar'} (admin) → executa se aprovar
//
// Segurança: service role + verify_jwt=false → membro da loja checado aqui (JWT) ou
// x-internal-key = FISCAL_INTERNAL_KEY (cron). O token da Meta nunca sai desta função.
// Segredos: ANTHROPIC_API_KEY, FISCAL_INTERNAL_KEY, (opcional) APP_PUBLIC_URL.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const GRAPH = 'https://graph.facebook.com/v20.0';
// Decisão de gestão de verba: uma vez por dia por loja, vale o modelo mais capaz.
const MODEL = 'claude-opus-5';
const APP_URL_DEFAULT = 'https://erpos.vercel.app';

type Row = Record<string, unknown>;
type Json = Record<string, unknown>;

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const log = (level: 'INFO' | 'WARN' | 'ERROR', msg: string, extra?: unknown) =>
  console.log(`[meta-ads-agent] ${level} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 1500) : ''}`);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const round2 = (v: number) => Math.round(v * 100) / 100;
const hoursAgo = (iso: string | null | undefined) => (iso ? (Date.now() - Date.parse(iso)) / 3_600_000 : Infinity);

// ─── Auth ────────────────────────────────────────────────────────────────────
async function requireMember(req: Request, admin: SupabaseClient, tenantId: string, adminOnly = false) {
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: json({ success: false, error: 'Não autenticado' }, 401) };
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { error: json({ success: false, error: 'Sessão inválida' }, 401) };
  const { data: membership, error: memErr } = await admin
    .from('user_tenants').select('role').eq('user_id', userData.user.id).eq('tenant_id', tenantId).limit(1).maybeSingle();
  if (memErr) return { error: json({ success: false, error: memErr.message }, 500) };
  if (!membership) return { error: json({ success: false, error: 'Sem acesso a esta loja' }, 403) };
  if (adminOnly && membership.role !== 'admin') return { error: json({ success: false, error: 'Só o admin da loja pode fazer isso' }, 403) };
  const name = String(userData.user.user_metadata?.name ?? userData.user.user_metadata?.full_name ?? userData.user.email ?? '');
  return { error: null, userId: userData.user.id, name, role: String(membership.role ?? '') };
}

// ─── Settings ────────────────────────────────────────────────────────────────
const DEFAULT_SETTINGS = {
  enabled: false, mode: 'sugerir', autonomia_criar: false, objetivo: 'whatsapp',
  daily_budget_cap: 30, monthly_budget_cap: 900, target_cpr: null as number | null, target_roas: 2, max_frequency: 3,
  page_id: null as string | null, page_name: null as string | null, whatsapp_number: null as string | null, destination_url: null as string | null,
  radius_km: null as number | null, age_min: 18, age_max: 65, store_context: null as string | null, active_hours: [] as number[],
  last_run_at: null as string | null, autopilot_since: null as string | null,
};
type Settings = typeof DEFAULT_SETTINGS;

async function loadSettings(admin: SupabaseClient, tenantId: string): Promise<Settings> {
  const { data } = await admin.from('meta_agent_settings').select('*').eq('tenant_id', tenantId).maybeSingle();
  return { ...DEFAULT_SETTINGS, ...((data ?? {}) as Partial<Settings>) };
}

function sanitizeSettings(input: Row): Partial<Settings> {
  const out: Row = {};
  const bool = (k: string) => { if (k in input) out[k] = input[k] === true; };
  const num = (k: string, min: number, max: number, nullable = false) => {
    if (!(k in input)) return;
    if ((input[k] === null || input[k] === '') && nullable) { out[k] = null; return; }
    const v = Number(input[k]); if (Number.isFinite(v)) out[k] = Math.min(max, Math.max(min, v));
  };
  const str = (k: string, max = 300) => { if (k in input) out[k] = input[k] ? String(input[k]).trim().slice(0, max) || null : null; };
  bool('enabled'); bool('autonomia_criar');
  if (['sugerir', 'autonomo'].includes(String(input.mode))) out.mode = String(input.mode);
  if (['whatsapp', 'trafego', 'vendas'].includes(String(input.objetivo))) out.objetivo = String(input.objetivo);
  num('daily_budget_cap', 5, 100000); num('monthly_budget_cap', 30, 3000000);
  num('target_cpr', 0.5, 10000, true); num('target_roas', 0.5, 100, true); num('max_frequency', 1, 20);
  num('radius_km', 1, 80, true); num('age_min', 18, 65); num('age_max', 18, 65);
  str('page_id', 40); str('page_name', 200); str('destination_url', 500); str('store_context', 2000);
  if ('whatsapp_number' in input) out.whatsapp_number = String(input.whatsapp_number ?? '').replace(/\D/g, '') || null;
  if (Array.isArray(input.active_hours)) out.active_hours = input.active_hours.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
  if (typeof out.age_min === 'number' && typeof out.age_max === 'number' && out.age_min > out.age_max) out.age_max = out.age_min;
  return out as Partial<Settings>;
}

// ─── Meta Graph helpers ──────────────────────────────────────────────────────
async function graphPost(path: string, params: Row, token: string): Promise<{ ok: boolean; body: Row }> {
  const form = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) form.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  form.set('access_token', token);
  const resp = await fetch(`${GRAPH}/${path}`, { method: 'POST', body: form });
  const body = await resp.json().catch(() => ({})) as Row;
  if (!resp.ok) log('WARN', `graph POST ${path} ${resp.status}`, body);
  return { ok: resp.ok, body };
}
async function graphGet(path: string, token: string): Promise<Row | null> {
  const sep = path.includes('?') ? '&' : '?';
  const resp = await fetch(`${GRAPH}/${path}${sep}access_token=${encodeURIComponent(token)}`);
  const body = await resp.json().catch(() => ({})) as Row;
  if (!resp.ok) { log('WARN', `graph GET ${path.split('?')[0]} ${resp.status}`, body); return null; }
  return body;
}
const graphErr = (body: Row) => String(((body.error ?? {}) as Row).error_user_msg ?? ((body.error ?? {}) as Row).message ?? 'Erro da Meta');

async function tokenCapabilities(token: string) {
  const [perms, pages] = await Promise.all([graphGet('me/permissions', token), graphGet('me/accounts?fields=id,name,instagram_business_account&limit=50', token)]);
  const granted = new Set(((perms?.data ?? []) as Row[]).filter((p) => p.status === 'granted').map((p) => String(p.permission)));
  return {
    ads_management: granted.has('ads_management'),
    pages_manage_ads: granted.has('pages_manage_ads'),
    pages_show_list: granted.has('pages_show_list'),
    business_management: granted.has('business_management'),
    granted: [...granted],
    pages: ((pages?.data ?? []) as Row[]).map((p) => ({ id: String(p.id), name: String(p.name ?? ''), instagram_id: p.instagram_business_account ? String((p.instagram_business_account as Row).id) : null })),
  };
}

// ─── Coleta de dados ─────────────────────────────────────────────────────────
type Insights = Row & { ok: boolean; totals?: Row; campaigns?: Row[]; adsets?: Row[]; ads?: Row[]; daily?: Row[]; account?: Row; breakdowns?: Row; erpos_orders?: Row; delivery_area?: Row };

async function fetchInsights(tenantId: string, datePreset: string): Promise<Insights | null> {
  const key = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
  const anon = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const url = `${Deno.env.get('SUPABASE_URL')}/functions/v1/meta-ads-insights`;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': key, apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ tenant_id: tenantId, date_preset: datePreset }),
    });
    const body = await resp.json().catch(() => null) as Insights | null;
    if (!body?.ok) { log('WARN', `insights ${datePreset} falhou`, body); return body; }
    return body;
  } catch (e) { log('ERROR', 'insights fetch', String(e)); return null; }
}

async function erposContext(admin: SupabaseClient, tenantId: string) {
  const since = new Date(Date.now() - 30 * 86400000).toISOString();
  const [{ data: tenant }, { data: ss }, { data: orders }, { data: items }] = await Promise.all([
    admin.from('tenants').select('name, slug, city, state, phone').eq('id', tenantId).maybeSingle(),
    admin.from('system_settings').select('delivery_config, delivery_city, app_public_url').eq('tenant_id', tenantId).maybeSingle(),
    admin.from('orders').select('id, total_amount, created_at, delivery_platform, delivery_source, status').eq('tenant_id', tenantId)
      .eq('origin_type', 'delivery').eq('is_training', false).gte('created_at', since).limit(5000),
    admin.from('menu_items').select('id, name, description, price, photo_url, is_featured, is_active, is_combo').eq('tenant_id', tenantId)
      .eq('is_active', true).is('deleted_at', null).limit(500),
  ]);
  const dc = ((ss?.delivery_config ?? {}) as Row);
  const validOrders = ((orders ?? []) as Row[]).filter((o) => !String(o.status ?? '').toLowerCase().includes('cancel'));
  const ids = new Set(validOrders.map((o) => String(o.id)));
  // Mais vendidos (30 dias) a partir dos itens dos pedidos de delivery.
  const top = new Map<string, { name: string; qty: number; revenue: number }>();
  if (ids.size) {
    const { data: oi } = await admin.from('order_items').select('item_id, item_name, item_price, quantity, order_id').eq('tenant_id', tenantId).gte('created_at', since).limit(20000);
    for (const r of (oi ?? []) as Row[]) {
      if (!ids.has(String(r.order_id))) continue;
      const k = String(r.item_id ?? r.item_name); const cur = top.get(k) ?? { name: String(r.item_name ?? ''), qty: 0, revenue: 0 };
      cur.qty += n(r.quantity); cur.revenue += n(r.quantity) * n(r.item_price); top.set(k, cur);
    }
  }
  const menu = ((items ?? []) as Row[]);
  const byId = new Map(menu.map((m) => [String(m.id), m]));
  const bestSellers = [...top.entries()].sort((a, b) => b[1].qty - a[1].qty).slice(0, 12).map(([id, v]) => ({
    item_id: id, name: v.name, qty_30d: v.qty, revenue_30d: round2(v.revenue),
    price: n(byId.get(id)?.price), photo_url: byId.get(id)?.photo_url ? String(byId.get(id)!.photo_url) : null,
    description: byId.get(id)?.description ? String(byId.get(id)!.description).slice(0, 160) : null,
  }));
  const featured = menu.filter((m) => m.is_featured && m.photo_url).slice(0, 8).map((m) => ({
    item_id: String(m.id), name: String(m.name), price: n(m.price), photo_url: String(m.photo_url), description: m.description ? String(m.description).slice(0, 160) : null,
  }));
  const withPhoto = menu.filter((m) => m.photo_url).length;
  const byPlatform: Record<string, { count: number; revenue: number }> = {};
  const hourly = Array.from({ length: 24 }, () => 0);
  const weekday = Array.from({ length: 7 }, () => 0);
  for (const o of validOrders) {
    const p = String(o.delivery_platform ?? 'outro'); byPlatform[p] = byPlatform[p] ?? { count: 0, revenue: 0 };
    byPlatform[p].count += 1; byPlatform[p].revenue += n(o.total_amount);
    const d = new Date(Date.parse(String(o.created_at)) - 3 * 3600000); hourly[d.getUTCHours()] += 1; weekday[d.getUTCDay()] += 1;
  }
  const total = validOrders.reduce((a, o) => a + n(o.total_amount), 0);
  const loc = dc.store_location as Row | undefined;
  const slug = tenant?.slug ? String(tenant.slug) : null;
  const base = (ss?.app_public_url ? String(ss.app_public_url) : (Deno.env.get('APP_PUBLIC_URL') || APP_URL_DEFAULT)).replace(/\/$/, '');
  return {
    store: { name: tenant?.name ? String(tenant.name) : 'Loja', city: tenant?.city ? String(tenant.city) : (ss?.delivery_city ? String(ss.delivery_city) : null), state: tenant?.state ?? null, phone: tenant?.phone ?? null, slug },
    whatsapp_loja: dc.whatsapp_loja ? String(dc.whatsapp_loja).replace(/\D/g, '') : null,
    store_location: loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' ? { lat: loc.lat as number, lng: loc.lng as number } : null,
    delivery_url: slug ? `${base}/${slug}-delivery` : null,
    orders_30d: { count: validOrders.length, revenue: round2(total), ticket: validOrders.length ? round2(total / validOrders.length) : 0, by_platform: byPlatform, hourly, weekday },
    best_sellers: bestSellers, featured, menu_items_with_photo: withPhoto,
  };
}
type Ctx = Awaited<ReturnType<typeof erposContext>>;

// ─── Regras de mercado (determinísticas) ─────────────────────────────────────
type Candidate = {
  kind: 'pause' | 'resume' | 'set_budget' | 'create_campaign' | 'rotate_creative' | 'alert';
  level: 'account' | 'campaign' | 'adset' | 'ad';
  target_id: string | null; target_name: string | null;
  params: Json; reason: string; expected_impact?: string; risk: 'baixo' | 'medio' | 'alto';
  rule: string;
};

function resultOf(r: Row): number {
  const res = r.result as Row | undefined;
  return n(res?.value ?? r.purchases ?? 0);
}
const spend = (r: Row) => n(r.spend);
const ctrOf = (r: Row) => n(r.link_ctr ?? r.ctr);
const isActive = (r: Row) => String(r.status ?? '') === 'ACTIVE';
const inLearning = (r: Row) => String(((r.learning ?? {}) as Row).status ?? '').toUpperCase() === 'LEARNING';

function rules(i7: Insights, i30: Insights | null, s: Settings, ctx: Ctx, recent: Row[], tokenExpiresAt: string | null): { candidates: Candidate[]; alerts: string[]; facts: Json } {
  const c: Candidate[] = []; const alerts: string[] = [];
  const acct = (i7.account ?? {}) as Row;
  const ads = (i7.ads ?? []) as Row[]; const adsets = (i7.adsets ?? []) as Row[]; const camps = (i7.campaigns ?? []) as Row[];
  const totals7 = (i7.totals ?? {}) as Row;
  const cooldown = (kind: string, id: string | null, hours: number) =>
    recent.some((a) => a.target_id === id && ['executada', 'aprovada', 'sugerida'].includes(String(a.status)) && (kind === '*' || a.kind === kind) && hoursAgo(String(a.created_at)) < hours);

  // Conta
  if (n(acct.status) && n(acct.status) !== 1) alerts.push(`Conta de anúncios com status ${acct.status} (motivo ${acct.disable_reason ?? '-'}): anúncios não rodam até resolver no Gerenciador.`);
  if (tokenExpiresAt && (Date.parse(tokenExpiresAt) - Date.now()) < 10 * 86400000) alerts.push(`Conexão com a Meta vence em ${Math.max(0, Math.round((Date.parse(tokenExpiresAt) - Date.now()) / 86400000))} dias: reconectar em Tráfego Pago.`);

  // Gasto do mês × teto mensal
  const monthStart = new Date(); monthStart.setUTCDate(1);
  const ms = monthStart.toISOString().slice(0, 10);
  const monthSpend = ((i30?.daily ?? i7.daily ?? []) as Row[]).filter((d) => String(d.date) >= ms).reduce((a, d) => a + spend(d), 0);
  const activeAdsets = adsets.filter(isActive);
  const dailyBudgets = activeAdsets.reduce((a, r) => a + n(r.daily_budget), 0)
    + camps.filter(isActive).reduce((a, r) => a + n(r.daily_budget), 0); // CBO: orçamento fica na campanha
  if (monthSpend >= s.monthly_budget_cap) {
    for (const cp of camps.filter(isActive)) c.push({ kind: 'pause', level: 'campaign', target_id: String(cp.campaign_id), target_name: String(cp.campaign), params: {}, risk: 'alto', rule: 'teto_mensal',
      reason: `Gasto do mês (R$ ${round2(monthSpend)}) atingiu o teto mensal de R$ ${s.monthly_budget_cap}.`, expected_impact: 'Zera o gasto até o mês virar ou o teto subir.' });
  } else if (monthSpend >= s.monthly_budget_cap * 0.85) alerts.push(`Gasto do mês em R$ ${round2(monthSpend)} (${Math.round(monthSpend / s.monthly_budget_cap * 100)}% do teto de R$ ${s.monthly_budget_cap}).`);
  if (dailyBudgets > s.daily_budget_cap * 1.05) alerts.push(`Orçamentos diários ativos somam R$ ${round2(dailyBudgets)}, acima do teto diário de R$ ${s.daily_budget_cap}.`);

  const targetCpr = s.target_cpr ?? (ctx.orders_30d.ticket ? round2(ctx.orders_30d.ticket * 0.3) : 15); // regra prática: ≤ 30% do ticket
  const minSpendJudge = Math.max(30, 3 * targetCpr);

  // Anúncios: stop-loss, CTR fraco
  for (const ad of ads.filter(isActive)) {
    const adset = adsets.find((a) => a.adset_id === ad.adset_id);
    if (adset && inLearning(adset)) continue; // não mexe em conjunto aprendendo
    const sp = spend(ad); const res = resultOf(ad); const cpr = res ? sp / res : null;
    const siblings = ads.filter((o) => o.adset_id === ad.adset_id && isActive(o) && o.ad_id !== ad.ad_id).length;
    if (cooldown('*', String(ad.ad_id), 48)) continue;
    if (sp >= minSpendJudge && res === 0) {
      c.push({ kind: 'pause', level: 'ad', target_id: String(ad.ad_id), target_name: String(ad.ad), params: {}, risk: 'baixo', rule: 'stop_loss_zero',
        reason: `R$ ${round2(sp)} gastos em 7 dias sem nenhum resultado (meta: até R$ ${targetCpr} por resultado).`, expected_impact: `Economiza ~R$ ${round2(sp / 7)}/dia sem perder resultado.` });
      continue;
    }
    if (cpr !== null && cpr > 2 * targetCpr && sp >= 2 * targetCpr) {
      c.push({ kind: 'pause', level: 'ad', target_id: String(ad.ad_id), target_name: String(ad.ad), params: {}, risk: 'baixo', rule: 'stop_loss_cpr',
        reason: `Custo por resultado R$ ${round2(cpr)} = ${(cpr / targetCpr).toFixed(1)}x a meta (R$ ${targetCpr}) com R$ ${round2(sp)} gastos.`, expected_impact: 'Redireciona a verba para os anúncios que convertem.' });
      continue;
    }
    if (n(ad.impressions) >= 2000 && ctrOf(ad) < 0.8 && sp >= 30 && siblings > 0) {
      c.push({ kind: 'pause', level: 'ad', target_id: String(ad.ad_id), target_name: String(ad.ad), params: {}, risk: 'baixo', rule: 'ctr_fraco',
        reason: `CTR no link ${ctrOf(ad).toFixed(2)}% após ${n(ad.impressions)} impressões (bom para comida em raio: ≥ 1,5%). Há ${siblings} outro(s) anúncio(s) ativo(s) no conjunto.`, expected_impact: 'Concentra a entrega nos criativos que chamam atenção.' });
    }
  }

  // Conjuntos: fadiga, escalar, desescalar
  const freqAccount = n(totals7.frequency);
  for (const as of adsets.filter(isActive)) {
    const sp = spend(as); const res = resultOf(as); const cpr = res ? sp / res : null; const roas = n(as.roas);
    const freq = n(as.frequency) || freqAccount;
    const activeAds = ads.filter((o) => o.adset_id === as.adset_id && isActive(o)).length;
    const budget = n(as.daily_budget);
    if (freq > s.max_frequency && sp >= 30) {
      if (!cooldown('rotate_creative', String(as.adset_id), 7 * 24)) c.push({ kind: 'rotate_creative', level: 'adset', target_id: String(as.adset_id), target_name: String(as.adset), params: { frequency: round2(freq), active_ads: activeAds }, risk: 'baixo', rule: 'fadiga',
        reason: `Frequência ${freq.toFixed(1)}x em 7 dias (limite ${s.max_frequency}x): o mesmo público já viu demais. ${activeAds} anúncio(s) ativo(s).`, expected_impact: 'Criativo novo (vídeo 15-30 s do prato, legenda) costuma recuperar CTR e baixar CPM.' });
    }
    if (inLearning(as) || !budget || cooldown('set_budget', String(as.adset_id), 72)) continue;
    const winning = (s.objetivo === 'vendas' && roas >= (s.target_roas ?? 2)) || (cpr !== null && cpr <= 0.7 * targetCpr);
    const losing = sp >= 100 && ((s.objetivo === 'vendas' && roas > 0 && roas < 0.5 * (s.target_roas ?? 2)) || (cpr !== null && cpr > 1.5 * targetCpr));
    if (winning && sp >= 3 * targetCpr && res >= 5) {
      const novo = round2(Math.min(budget * 1.2, Math.max(budget, s.daily_budget_cap - (dailyBudgets - budget))));
      if (novo > budget + 0.5) c.push({ kind: 'set_budget', level: 'adset', target_id: String(as.adset_id), target_name: String(as.adset), params: { daily_budget: novo, previous: budget }, risk: 'medio', rule: 'escalar',
        reason: `Conjunto rendendo: ${res} resultados a R$ ${cpr !== null ? round2(cpr) : '-'} cada${roas ? `, ROAS ${roas.toFixed(2)}x` : ''}. Escalar +20% (limite de mercado para não reiniciar o aprendizado).`, expected_impact: `+~${Math.max(1, Math.round(res * 0.2))} resultados/semana pelo mesmo custo unitário.` });
      else alerts.push(`Conjunto "${as.adset}" mereceria escalar, mas o teto diário (R$ ${s.daily_budget_cap}) não deixa.`);
    } else if (losing) {
      const novo = round2(Math.max(5, budget * 0.8));
      c.push({ kind: 'set_budget', level: 'adset', target_id: String(as.adset_id), target_name: String(as.adset), params: { daily_budget: novo, previous: budget }, risk: 'medio', rule: 'desescalar',
        reason: `Conjunto abaixo da meta com R$ ${round2(sp)} gastos: ${cpr !== null ? `R$ ${round2(cpr)} por resultado` : 'sem resultado'}${roas ? `, ROAS ${roas.toFixed(2)}x` : ''}. Reduzir 20%.`, expected_impact: 'Limita a perda enquanto o criativo/segmentação é revisto.' });
    }
  }

  // Nenhuma campanha ativa → propor campanha nova (a IA escreve o texto; aqui só o esqueleto)
  const anyActive = camps.some(isActive);
  const canCreate = !!(s.page_id && ctx.store_location && (s.objetivo === 'whatsapp' ? (s.whatsapp_number || ctx.whatsapp_loja) : (s.destination_url || ctx.delivery_url)));
  if (!anyActive && !cooldown('create_campaign', null, 72)) {
    if (canCreate) c.push({ kind: 'create_campaign', level: 'campaign', target_id: null, target_name: null, risk: 'alto', rule: 'sem_campanha',
      params: { objetivo: s.objetivo, daily_budget: round2(Math.min(s.daily_budget_cap, Math.max(10, s.daily_budget_cap))), radius_km: s.radius_km ?? Math.min(8, Math.max(3, n((i7.delivery_area as Row | undefined)?.max_km) || 5)) },
      reason: 'Nenhuma campanha ativa na conta. Sem anúncio rodando não entra pedido pago.', expected_impact: 'Voltar a gerar pedidos pelo canal próprio (custo por pedido esperado R$ 5-20).' });
    else alerts.push(`Nenhuma campanha ativa e faltam dados para criar uma: ${[!s.page_id && 'página do Facebook', !ctx.store_location && 'pin da loja (Config. Delivery)', s.objetivo === 'whatsapp' && !(s.whatsapp_number || ctx.whatsapp_loja) && 'número do WhatsApp', s.objetivo !== 'whatsapp' && !(s.destination_url || ctx.delivery_url) && 'link do delivery'].filter(Boolean).join(', ')}.`);
  }

  // Problemas que a própria Meta aponta
  for (const x of [...camps, ...adsets, ...ads]) for (const t of ((x.issues ?? []) as string[]).slice(0, 2)) alerts.push(`${String(x.ad ?? x.adset ?? x.campaign)}: ${t}`);

  return { candidates: c, alerts: alerts.slice(0, 12), facts: { month_spend: round2(monthSpend), daily_budgets_active: round2(dailyBudgets), target_cpr: targetCpr, min_spend_judge: minSpendJudge, frequency_7d: round2(freqAccount) } };
}

// ─── IA: revisão + resumo + redação de campanha ──────────────────────────────
const SYSTEM = `Você é o gestor de tráfego pago de um restaurante/delivery no Brasil, integrado ao ERPOS. Fala português do Brasil, direto, sem jargão. Suas decisões seguem as práticas de mercado para food/delivery local:
- Objetivo certo: WhatsApp (conversas) ou Vendas (pixel) para delivery próprio; Tráfego só sem pixel. Raio de 3-8 km (área real de entrega). Idade mínima 18 (álcool: sempre 18+, sem apelo a excesso).
- Fase de aprendizado: 50 resultados em 7 dias; mudança de orçamento > 20%, segmentação ou lance reinicia. Não mexer em conjunto aprendendo. Escalar no máximo +20% a cada 72 h.
- Julgar por custo por resultado com gasto mínimo (≥ 3x a meta), nunca por 1 dia. CTR bom para comida em raio: ≥ 1,5%; < 0,8% = criativo fraco. Frequência > 3 em 7 dias = fadiga → criativo novo.
- Criativo que funciona: comida nos 3 primeiros segundos, vídeo 15-30 s vertical, foto real do prato, legenda curta com preço/oferta e chamada clara ("Peça pelo WhatsApp", "Peça agora"). Anunciar nos horários de fome (almoço 10-13h, jantar 17-21h).
- Verba: respeite SEMPRE os tetos diário e mensal. Custo por pedido saudável: R$ 5-20 (≤ 30% do ticket).
Você recebe os números (7 e 30 dias), o contexto do ERPOS e as ações candidatas geradas por regras. Sua tarefa: (1) revisar as candidatas — manter, ajustar o texto/valor ou descartar, com motivo; (2) acrescentar ações que as regras não pegaram, só se houver evidência nos números; (3) para create_campaign, escrever o anúncio completo (nome da campanha, texto principal ≤ 125 caracteres, título ≤ 40, escolher a foto do cardápio pelo photo_url dos mais vendidos/destaques); (4) escrever o resumo para o dono (o que está acontecendo, o que fez/sugere, o que ele precisa fazer, em ≤ 8 frases) e uma nota de saúde 0-100.
Nunca invente ids: use apenas ad_id/adset_id/campaign_id presentes nos dados. Nunca proponha orçamento acima do teto. Sem campanha ativa e sem dados para criar, diga o que falta.`;

const OUTPUT_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['summary', 'health_score', 'alerts', 'actions'],
  properties: {
    summary: { type: 'string' },
    health_score: { type: 'integer' },
    alerts: { type: 'array', items: { type: 'string' } },
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['kind', 'level', 'target_id', 'target_name', 'reason', 'expected_impact', 'risk', 'params'],
        properties: {
          kind: { type: 'string', enum: ['pause', 'resume', 'set_budget', 'create_campaign', 'rotate_creative'] },
          level: { type: 'string', enum: ['account', 'campaign', 'adset', 'ad'] },
          target_id: { type: ['string', 'null'] },
          target_name: { type: ['string', 'null'] },
          reason: { type: 'string' },
          expected_impact: { type: 'string' },
          risk: { type: 'string', enum: ['baixo', 'medio', 'alto'] },
          params: {
            type: 'object', additionalProperties: false,
            required: ['daily_budget', 'campaign_name', 'primary_text', 'headline', 'description', 'cta', 'photo_url', 'item_name', 'radius_km', 'objetivo'],
            properties: {
              daily_budget: { type: ['number', 'null'] },
              campaign_name: { type: ['string', 'null'] },
              primary_text: { type: ['string', 'null'] },
              headline: { type: ['string', 'null'] },
              description: { type: ['string', 'null'] },
              cta: { type: ['string', 'null'] },
              photo_url: { type: ['string', 'null'] },
              item_name: { type: ['string', 'null'] },
              radius_km: { type: ['number', 'null'] },
              objetivo: { type: ['string', 'null'] },
            },
          },
        },
      },
    },
  },
};

function compact(i: Insights | null, label: string) {
  if (!i?.ok) return { label, ok: false };
  const slimRow = (r: Row) => ({
    id: r.ad_id ?? r.adset_id ?? r.campaign_id, name: r.ad ?? r.adset ?? r.campaign, campaign: r.campaign, adset: r.adset, status: r.status, objective: r.objective, optimization_goal: r.optimization_goal,
    daily_budget: r.daily_budget, lifetime_budget: r.lifetime_budget, learning: (r.learning as Row | undefined)?.status, spend: r.spend, impressions: r.impressions, reach: r.reach, frequency: r.frequency,
    link_clicks: r.link_clicks, link_ctr: r.link_ctr, cpc: r.cost_per_link_click, cpm: r.cpm, result: r.result, purchases: r.purchases, purchase_value: r.purchase_value, roas: r.roas,
    rankings: r.rankings, targeting: r.targeting, area_check: r.area_check, issues: r.issues, creative: r.creative ? { title: (r.creative as Row).title, body: String((r.creative as Row).body ?? '').slice(0, 200), cta: (r.creative as Row).cta, link: (r.creative as Row).link } : undefined,
  });
  const bd = (i.breakdowns ?? {}) as Row;
  return {
    label, range: i.range, totals: i.totals, account: i.account, campaigns: (i.campaigns ?? []).map(slimRow), adsets: (i.adsets ?? []).map(slimRow), ads: (i.ads ?? []).map(slimRow),
    daily: (i.daily ?? []).map((d) => ({ date: d.date, spend: d.spend, link_clicks: d.link_clicks, purchases: d.purchases, purchase_value: d.purchase_value })),
    by_hour: ((bd.hourly ?? []) as Row[]).map((h) => ({ hour: h.hour, spend: h.spend, link_clicks: h.link_clicks, purchases: h.purchases })),
    by_age_gender: ((bd.age_gender ?? []) as Row[]).map((h) => ({ age: h.age, gender: h.gender, spend: h.spend, link_clicks: h.link_clicks, purchases: h.purchases })),
    by_placement: ((bd.placement ?? []) as Row[]).map((h) => ({ platform: h.platform, position: h.position, spend: h.spend, link_clicks: h.link_clicks, purchases: h.purchases })),
    erpos_orders: i.erpos_orders, delivery_area: i.delivery_area,
  };
}

async function askModel(payload: Json): Promise<{ out: Row; model: string; usage: Row | null }> {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) throw new Error('IA não configurada (falta ANTHROPIC_API_KEY).');
  const client = new Anthropic({ apiKey });
  // deno-lint-ignore no-explicit-any
  const response: any = await client.messages.create({
    model: MODEL, max_tokens: 8000,
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
    messages: [{ role: 'user', content: `Dados da loja e da conta de anúncios (JSON):\n${JSON.stringify(payload)}` }],
  // deno-lint-ignore no-explicit-any
  } as any);
  if (response.stop_reason === 'refusal') throw new Error('A IA recusou analisar estes dados.');
  if (response.stop_reason === 'max_tokens') throw new Error('Resposta da IA ficou longa demais.');
  const text = (response.content ?? []).filter((b: Row) => b.type === 'text').map((b: Row) => String(b.text)).join('');
  return { out: JSON.parse(text) as Row, model: String(response.model), usage: (response.usage ?? null) as Row | null };
}

// ─── Execução na Meta ────────────────────────────────────────────────────────
type ExecResult = { ok: boolean; result: Json; error?: string };

function whatsappLink(num: string, text: string) { return `https://api.whatsapp.com/send?phone=${num}&text=${encodeURIComponent(text)}`; }

async function createCampaign(token: string, adAccountId: string, s: Settings, ctx: Ctx, p: Row): Promise<ExecResult> {
  const objetivo = String(p.objetivo ?? s.objetivo);
  const loc = ctx.store_location;
  if (!s.page_id) return { ok: false, result: {}, error: 'Página do Facebook não configurada no agente.' };
  if (!loc) return { ok: false, result: {}, error: 'Pin da loja não configurado (Config. Delivery › localização).' };
  const wa = s.whatsapp_number || ctx.whatsapp_loja;
  const siteUrl = (s.destination_url || ctx.delivery_url || '').trim();
  if (objetivo === 'whatsapp' && !wa) return { ok: false, result: {}, error: 'Número do WhatsApp não configurado.' };
  if (objetivo !== 'whatsapp' && !siteUrl) return { ok: false, result: {}, error: 'Link do delivery não configurado.' };
  const budget = Math.min(n(p.daily_budget) || 10, s.daily_budget_cap);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = String(p.campaign_name || `ERPOS · ${objetivo} · ${stamp}`).slice(0, 100);
  const radius = Math.min(80, Math.max(1, n(p.radius_km) || s.radius_km || 5));

  const objective = objetivo === 'vendas' ? 'OUTCOME_SALES' : objetivo === 'trafego' ? 'OUTCOME_TRAFFIC' : 'OUTCOME_ENGAGEMENT';
  const camp = await graphPost(`${adAccountId}/campaigns`, { name, objective, status: 'PAUSED', special_ad_categories: [], buying_type: 'AUCTION' }, token);
  if (!camp.ok) return { ok: false, result: { step: 'campaign' }, error: graphErr(camp.body) };
  const campaignId = String(camp.body.id);

  const targeting: Json = {
    geo_locations: { custom_locations: [{ latitude: loc.lat, longitude: loc.lng, radius, distance_unit: 'kilometer' }], location_types: ['home', 'recent'] },
    age_min: Math.max(18, s.age_min), age_max: s.age_max,
    publisher_platforms: ['facebook', 'instagram'],
    facebook_positions: ['feed', 'story', 'video_feeds', 'marketplace'],
    instagram_positions: ['stream', 'story', 'reels', 'explore'],
  };
  const adset: Json = {
    name: `${name} · raio ${radius} km`, campaign_id: campaignId, status: 'PAUSED',
    daily_budget: Math.round(budget * 100), billing_event: 'IMPRESSIONS', bid_strategy: 'LOWEST_COST_WITHOUT_CAP', targeting,
    start_time: new Date().toISOString(),
  };
  const utm = `utm_source=meta&utm_medium=paid&utm_campaign=${encodeURIComponent(name.replace(/\s+/g, '_').toLowerCase())}`;
  const link = siteUrl ? `${siteUrl}${siteUrl.includes('?') ? '&' : '?'}${utm}` : '';
  if (objetivo === 'whatsapp') {
    Object.assign(adset, { optimization_goal: 'CONVERSATIONS', destination_type: 'WHATSAPP', promoted_object: { page_id: s.page_id, whatsapp_phone_number: wa } });
  } else if (objetivo === 'trafego') {
    Object.assign(adset, { optimization_goal: 'LANDING_PAGE_VIEWS', destination_type: 'WEBSITE', promoted_object: { page_id: s.page_id } });
  } else {
    // Vendas: precisa de pixel com evento Purchase no cardápio. Sem pixel configurado, a Meta recusa — cai em tráfego.
    Object.assign(adset, { optimization_goal: 'LANDING_PAGE_VIEWS', destination_type: 'WEBSITE', promoted_object: { page_id: s.page_id } });
  }
  const as = await graphPost(`${adAccountId}/adsets`, adset, token);
  if (!as.ok) return { ok: false, result: { step: 'adset', campaign_id: campaignId }, error: graphErr(as.body) };
  const adsetId = String(as.body.id);

  const primary = String(p.primary_text || `${ctx.store.name}: peça agora e receba em casa.`).slice(0, 300);
  const headline = String(p.headline || ctx.store.name).slice(0, 60);
  const photo = p.photo_url ? String(p.photo_url) : (ctx.featured[0]?.photo_url ?? ctx.best_sellers.find((b) => b.photo_url)?.photo_url ?? null);
  if (!photo) return { ok: false, result: { step: 'creative', campaign_id: campaignId, adset_id: adsetId }, error: 'Nenhum item do cardápio tem foto para o anúncio.' };
  const cta = objetivo === 'whatsapp' ? 'WHATSAPP_MESSAGE' : (['ORDER_NOW', 'SHOP_NOW', 'LEARN_MORE'].includes(String(p.cta)) ? String(p.cta) : 'ORDER_NOW');
  const linkData: Json = { message: primary, name: headline, description: p.description ? String(p.description).slice(0, 90) : undefined, picture: photo };
  if (objetivo === 'whatsapp') {
    linkData.link = whatsappLink(wa!, `Oi! Vi o anúncio do ${ctx.store.name} e quero pedir.`);
    linkData.call_to_action = { type: 'WHATSAPP_MESSAGE', value: { app_destination: 'WHATSAPP' } };
    linkData.page_welcome_message = ({ type: 'VISUAL_EDITOR', version: 2, landing_screen_type: 'welcome_message', media_type: 'text', text_format: { customer_action_type: 'ice_breakers', message: { text: `Olá! Bem-vindo ao ${ctx.store.name}. O que você gostaria de pedir?`, ice_breakers: [{ title: 'Quero ver o cardápio' }, { title: 'Quero fazer um pedido' }, { title: 'Tem promoção hoje?' }] } } });
  } else {
    linkData.link = link;
    linkData.call_to_action = { type: cta, value: { link } };
  }
  const creative = await graphPost(`${adAccountId}/adcreatives`, { name: `${name} · criativo`, object_story_spec: { page_id: s.page_id, link_data: linkData } }, token);
  if (!creative.ok) return { ok: false, result: { step: 'creative', campaign_id: campaignId, adset_id: adsetId }, error: graphErr(creative.body) };
  const creativeId = String(creative.body.id);
  const ad = await graphPost(`${adAccountId}/ads`, { name: `${name} · ${String(p.item_name || 'anúncio').slice(0, 40)}`, adset_id: adsetId, creative: { creative_id: creativeId }, status: 'PAUSED' }, token);
  if (!ad.ok) return { ok: false, result: { step: 'ad', campaign_id: campaignId, adset_id: adsetId, creative_id: creativeId }, error: graphErr(ad.body) };
  const adId = String(ad.body.id);
  // Tudo criado pausado; ativa em ordem (campanha por último) para não entregar antes de existir anúncio.
  for (const id of [adId, adsetId, campaignId]) {
    const r = await graphPost(id, { status: 'ACTIVE' }, token);
    if (!r.ok) return { ok: false, result: { campaign_id: campaignId, adset_id: adsetId, creative_id: creativeId, ad_id: adId, activated_until: id }, error: `Criado, mas não ativou: ${graphErr(r.body)}` };
  }
  return { ok: true, result: { campaign_id: campaignId, adset_id: adsetId, creative_id: creativeId, ad_id: adId, daily_budget: budget, radius_km: radius, objective, link: linkData.link, photo } };
}

async function executeAction(admin: SupabaseClient, tenantId: string, action: Row, s: Settings): Promise<ExecResult> {
  const { data: conn } = await admin.from('meta_ad_connections').select('access_token, ad_account_id').eq('tenant_id', tenantId).maybeSingle();
  if (!conn?.access_token || !conn.ad_account_id) return { ok: false, result: {}, error: 'Loja não conectada à Meta.' };
  const token = String(conn.access_token); const acct = String(conn.ad_account_id);
  const p = (action.params ?? {}) as Row; const id = action.target_id ? String(action.target_id) : '';
  const kind = String(action.kind);
  if (kind === 'pause' || kind === 'resume') {
    if (!/^\d{5,30}$/.test(id)) return { ok: false, result: {}, error: 'Alvo inválido.' };
    const r = await graphPost(id, { status: kind === 'pause' ? 'PAUSED' : 'ACTIVE' }, token);
    return r.ok ? { ok: true, result: { status: kind === 'pause' ? 'PAUSED' : 'ACTIVE' } } : { ok: false, result: r.body, error: graphErr(r.body) };
  }
  if (kind === 'set_budget') {
    if (!/^\d{5,30}$/.test(id)) return { ok: false, result: {}, error: 'Alvo inválido.' };
    const val = Math.min(n(p.daily_budget), s.daily_budget_cap);
    if (val < 5) return { ok: false, result: {}, error: 'Orçamento diário mínimo é R$ 5.' };
    const r = await graphPost(id, { daily_budget: Math.round(val * 100) }, token);
    return r.ok ? { ok: true, result: { daily_budget: val } } : { ok: false, result: r.body, error: graphErr(r.body) };
  }
  if (kind === 'create_campaign') {
    const ctx = await erposContext(admin, tenantId);
    return createCampaign(token, acct, s, ctx, p);
  }
  if (kind === 'rotate_creative' || kind === 'alert') return { ok: true, result: { note: 'Registrado para o dono providenciar.' } };
  return { ok: false, result: {}, error: `Ação desconhecida: ${kind}` };
}

// ─── Rodada completa de uma loja ─────────────────────────────────────────────
async function runForTenant(admin: SupabaseClient, tenantId: string, trigger: 'manual' | 'cron' | 'assistente', force = false) {
  const s = await loadSettings(admin, tenantId);
  if (!s.enabled && !force) return { skipped: true, reason: 'Agente desligado nesta loja.' };
  const { data: conn } = await admin.from('meta_ad_connections').select('ad_account_id, token_expires_at').eq('tenant_id', tenantId).maybeSingle();
  if (!conn?.ad_account_id) return { skipped: true, reason: 'Loja não conectada à Meta.' };

  const { data: run } = await admin.from('meta_agent_runs').insert({ tenant_id: tenantId, trigger, status: 'running' }).select('id').single();
  const runId = String(run?.id);
  try {
    // Sugestões antigas viram "expirada": a rodada de hoje gera as atuais.
    await admin.from('meta_agent_actions').update({ status: 'expirada' }).eq('tenant_id', tenantId).eq('status', 'sugerida')
      .lt('created_at', new Date(Date.now() - 3 * 86400000).toISOString());

    const [i7, i30, ctx, { data: recent }] = await Promise.all([
      fetchInsights(tenantId, 'last_7d'), fetchInsights(tenantId, 'last_30d'), erposContext(admin, tenantId),
      admin.from('meta_agent_actions').select('kind, target_id, status, created_at, params').eq('tenant_id', tenantId)
        .gte('created_at', new Date(Date.now() - 14 * 86400000).toISOString()).limit(200),
    ]);
    if (!i7?.ok) throw new Error(`Não consegui ler a conta de anúncios: ${String((i7 as Row | null)?.error ?? 'sem resposta')}`);

    const { candidates, alerts, facts } = rules(i7, i30, s, ctx, (recent ?? []) as Row[], conn.token_expires_at ? String(conn.token_expires_at) : null);
    const payload: Json = {
      hoje: new Date().toISOString().slice(0, 10), configuracao: { ...s, store_context: s.store_context },
      fatos: facts, alertas_regras: alerts, candidatas_regras: candidates,
      loja: { ...ctx, orders_30d: ctx.orders_30d, best_sellers: ctx.best_sellers, featured: ctx.featured },
      ultimos_7_dias: compact(i7, '7d'), ultimos_30_dias: compact(i30, '30d'),
      acoes_recentes: (recent ?? []).map((a: Row) => ({ kind: a.kind, target_id: a.target_id, status: a.status, created_at: a.created_at })),
    };
    const ai = await askModel(payload);

    // Guardrails pós-modelo: só alvos existentes, orçamento dentro do teto, mudanças ±20%, sem duplicar alvo.
    const known = new Map<string, { level: string; name: string; budget: number }>();
    for (const r of (i7.campaigns ?? []) as Row[]) known.set(String(r.campaign_id), { level: 'campaign', name: String(r.campaign), budget: n(r.daily_budget) });
    for (const r of (i7.adsets ?? []) as Row[]) known.set(String(r.adset_id), { level: 'adset', name: String(r.adset), budget: n(r.daily_budget) });
    for (const r of (i7.ads ?? []) as Row[]) known.set(String(r.ad_id), { level: 'ad', name: String(r.ad), budget: 0 });
    const seen = new Set<string>();
    const final: Row[] = [];
    for (const raw of ((ai.out.actions ?? []) as Row[])) {
      const kind = String(raw.kind); const tid = raw.target_id ? String(raw.target_id) : null;
      const p = ((raw.params ?? {}) as Row);
      const params: Json = {};
      if (kind === 'create_campaign') {
        if (tid) continue;
        if (!candidates.some((c) => c.kind === 'create_campaign')) continue; // IA não cria campanha por conta própria sem a regra "sem campanha ativa"
        Object.assign(params, { objetivo: ['whatsapp', 'trafego', 'vendas'].includes(String(p.objetivo)) ? p.objetivo : s.objetivo, daily_budget: Math.min(n(p.daily_budget) || s.daily_budget_cap, s.daily_budget_cap), campaign_name: p.campaign_name, primary_text: p.primary_text, headline: p.headline, description: p.description, cta: p.cta, photo_url: p.photo_url, item_name: p.item_name, radius_km: p.radius_km });
      } else {
        if (!tid || !known.has(tid) || seen.has(tid)) continue;
        const k = known.get(tid)!;
        if (kind === 'set_budget') {
          if (k.level !== 'adset' && k.level !== 'campaign') continue;
          const cur = k.budget; if (!cur) continue;
          const want = n(p.daily_budget); if (!want) continue;
          params.previous = cur; params.daily_budget = round2(Math.min(s.daily_budget_cap, Math.max(cur * 0.8, Math.min(cur * 1.2, want))));
          if (Math.abs(n(params.daily_budget) - cur) < 0.5) continue;
        }
        if (kind === 'rotate_creative') Object.assign(params, { frequency: p.frequency ?? null });
        seen.add(tid);
      }
      final.push({
        tenant_id: tenantId, run_id: runId, kind, level: String(raw.level ?? (tid ? known.get(tid)!.level : 'campaign')), target_id: tid,
        target_name: tid ? known.get(tid)!.name : (params.campaign_name ?? null), params, reason: String(raw.reason ?? '').slice(0, 600),
        expected_impact: String(raw.expected_impact ?? '').slice(0, 300), risk: ['baixo', 'medio', 'alto'].includes(String(raw.risk)) ? String(raw.risk) : 'medio',
      });
    }
    // Teto mensal é trava dura: entra mesmo que a IA tenha descartado.
    for (const c of candidates.filter((x) => x.rule === 'teto_mensal')) if (!seen.has(String(c.target_id))) { seen.add(String(c.target_id)); final.push({ tenant_id: tenantId, run_id: runId, kind: c.kind, level: c.level, target_id: c.target_id, target_name: c.target_name, params: c.params, reason: c.reason, expected_impact: c.expected_impact ?? null, risk: c.risk }); }

    // Modo autônomo: executa o que é seguro; criar campanha só com autonomia_criar.
    let executed = 0;
    const autoOk = (a: Row) => s.mode === 'autonomo' && (a.kind === 'pause' || a.kind === 'resume' || a.kind === 'set_budget' || (a.kind === 'create_campaign' && s.autonomia_criar));
    for (const a of final) {
      if (autoOk(a)) {
        const r = await executeAction(admin, tenantId, a, s);
        Object.assign(a, { auto: true, status: r.ok ? 'executada' : 'falhou', executed_at: new Date().toISOString(), result: r.result, error: r.error ?? null, decided_by_name: 'Agente (autônomo)', decided_at: new Date().toISOString() });
        if (r.ok) executed += 1;
      }
    }
    if (final.length) { const { error } = await admin.from('meta_agent_actions').insert(final); if (error) log('ERROR', 'insert actions', error.message); }

    const allAlerts = [...new Set([...(ai.out.alerts as string[] ?? []), ...alerts])].slice(0, 15);
    await admin.from('meta_agent_runs').update({
      status: 'done', finished_at: new Date().toISOString(), summary: String(ai.out.summary ?? ''), health_score: Math.max(0, Math.min(100, Math.round(n(ai.out.health_score)))),
      alerts: allAlerts, snapshot: { fatos: facts, totals_7d: i7.totals ?? null, totals_30d: i30?.totals ?? null, account: i7.account ?? null, erpos_orders_7d: i7.erpos_orders ?? null, orders_30d: ctx.orders_30d, candidatas: candidates.map((c) => ({ rule: c.rule, kind: c.kind, target: c.target_name })) },
      model: ai.model, usage: ai.usage, actions_total: final.length, actions_executed: executed,
    }).eq('id', runId);
    await admin.from('meta_agent_settings').upsert({ tenant_id: tenantId, last_run_at: new Date().toISOString(), updated_at: new Date().toISOString() }, { onConflict: 'tenant_id' });
    log('INFO', 'rodada ok', { tenantId, actions: final.length, executed, usage: ai.usage });
    return { skipped: false, run_id: runId, summary: ai.out.summary, health_score: ai.out.health_score, alerts: allAlerts, actions: final.length, executed };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', 'rodada falhou', { tenantId, msg });
    await admin.from('meta_agent_runs').update({ status: 'error', finished_at: new Date().toISOString(), error: msg.slice(0, 1000) }).eq('id', runId);
    return { skipped: false, run_id: runId, error: msg };
  }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? '');
    const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
    const internal = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

    if (action === 'run_all') {
      if (!internal) return json({ success: false, error: 'Só interno' }, 403);
      const { data: rows } = await admin.from('meta_agent_settings').select('tenant_id').eq('enabled', true);
      const out: Row[] = [];
      for (const r of (rows ?? []) as Row[]) out.push({ tenant_id: r.tenant_id, ...(await runForTenant(admin, String(r.tenant_id), 'cron')) });
      return json({ success: true, runs: out });
    }

    const tenantId = String(body.tenant_id ?? '');
    if (!tenantId) return json({ success: false, error: 'tenant_id é obrigatório' }, 400);
    const auth = internal ? { error: null, userId: null, name: 'Assistente', role: 'admin' } : await requireMember(req, admin, tenantId, ['save_settings', 'decide'].includes(action));
    if (auth.error) return auth.error;

    if (action === 'get_settings') {
      const [settings, { data: conn }, { count: pending }, { data: lastRun }] = await Promise.all([
        loadSettings(admin, tenantId),
        admin.from('meta_ad_connections').select('access_token, ad_account_id, ad_account_name, token_expires_at').eq('tenant_id', tenantId).maybeSingle(),
        admin.from('meta_agent_actions').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('status', 'sugerida'),
        admin.from('meta_agent_runs').select('id, status, started_at, finished_at, summary, health_score, alerts, actions_total, actions_executed, error, trigger').eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      const caps = conn?.access_token ? await tokenCapabilities(String(conn.access_token)) : null;
      const ctx = await erposContext(admin, tenantId);
      return json({
        success: true, settings, pending: pending ?? 0, last_run: lastRun ?? null,
        connection: conn ? { ad_account_id: conn.ad_account_id, ad_account_name: conn.ad_account_name, token_expires_at: conn.token_expires_at } : null,
        capabilities: caps,
        erpos: { store: ctx.store, whatsapp_loja: ctx.whatsapp_loja, store_location: ctx.store_location, delivery_url: ctx.delivery_url, menu_items_with_photo: ctx.menu_items_with_photo, best_sellers: ctx.best_sellers.slice(0, 5), orders_30d: { count: ctx.orders_30d.count, revenue: ctx.orders_30d.revenue, ticket: ctx.orders_30d.ticket } },
      });
    }

    if (action === 'save_settings') {
      const patch = sanitizeSettings((body.settings ?? {}) as Row);
      const cur = await loadSettings(admin, tenantId);
      const next: Row = { ...patch, tenant_id: tenantId, updated_at: new Date().toISOString(), updated_by_user_id: auth.userId };
      if (patch.mode === 'autonomo' && cur.mode !== 'autonomo') next.autopilot_since = new Date().toISOString();
      if (patch.mode === 'sugerir') next.autopilot_since = null;
      const { error } = await admin.from('meta_agent_settings').upsert(next, { onConflict: 'tenant_id' });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, settings: await loadSettings(admin, tenantId) });
    }

    if (action === 'run') {
      const r = await runForTenant(admin, tenantId, internal ? 'assistente' : 'manual', true);
      return json({ success: !('error' in r && r.error), ...r });
    }

    if (action === 'list_runs') {
      const { data, error } = await admin.from('meta_agent_runs').select('id, trigger, status, started_at, finished_at, summary, health_score, alerts, actions_total, actions_executed, error, model, usage')
        .eq('tenant_id', tenantId).order('started_at', { ascending: false }).limit(Math.min(50, n(body.limit) || 15));
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, runs: data ?? [] });
    }

    if (action === 'list_actions') {
      let q = admin.from('meta_agent_actions').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(Math.min(200, n(body.limit) || 60));
      if (body.status) q = q.eq('status', String(body.status));
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, actions: data ?? [] });
    }

    if (action === 'decide') {
      const actionId = String(body.action_id ?? ''); const decision = String(body.decision ?? '');
      if (!actionId || !['aprovar', 'rejeitar'].includes(decision)) return json({ success: false, error: 'action_id e decision (aprovar|rejeitar) são obrigatórios' }, 400);
      const { data: a } = await admin.from('meta_agent_actions').select('*').eq('id', actionId).eq('tenant_id', tenantId).maybeSingle();
      if (!a) return json({ success: false, error: 'Ação não encontrada' }, 404);
      if (a.status !== 'sugerida') return json({ success: false, error: `Ação já está "${a.status}"` }, 409);
      const who = { decided_by_user_id: auth.userId, decided_by_name: auth.name || 'Dono', decided_at: new Date().toISOString() };
      if (decision === 'rejeitar') {
        await admin.from('meta_agent_actions').update({ status: 'rejeitada', ...who }).eq('id', actionId);
        return json({ success: true, status: 'rejeitada' });
      }
      const s = await loadSettings(admin, tenantId);
      const r = await executeAction(admin, tenantId, a as Row, s);
      const status = r.ok ? 'executada' : 'falhou';
      await admin.from('meta_agent_actions').update({ status, ...who, executed_at: new Date().toISOString(), result: r.result, error: r.error ?? null }).eq('id', actionId);
      return json({ success: r.ok, status, result: r.result, error: r.error ?? null });
    }

    return json({ success: false, error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    log('ERROR', 'handler', String(err));
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

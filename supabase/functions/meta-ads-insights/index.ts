import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

const GRAPH_VERSION = 'v20.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`

const ALLOWED_DATE_PRESETS = new Set([
  'today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d',
  'this_week_mon_today', 'last_week_mon_sun', 'this_month', 'last_month', 'maximum',
])

type Row = Record<string, unknown>
type MetaAction = { action_type?: string; value?: string }
type Act = { type: string; value: number }

function simplifyActions(actions: unknown): Act[] {
  if (!Array.isArray(actions)) return []
  return (actions as MetaAction[])
    .map((a) => ({ type: String(a.action_type ?? ''), value: Number(a.value ?? 0) }))
    .filter((a) => a.type && a.value > 0)
}

// Pega o PRIMEIRO tipo presente da lista (ordem = preferência). A Meta devolve o mesmo evento em
// vários recortes (purchase / omni_purchase / offsite_conversion.fb_pixel_purchase...): somar tudo
// conta em dobro. "purchase" é o agregado que o Gerenciador de Anúncios mostra como "Compras".
function pickAction(list: Act[], types: string[]): number {
  for (const t of types) {
    const f = list.find((a) => a.type === t)
    if (f) return f.value
  }
  return 0
}

// Campos "de vídeo" e "outbound" vêm como lista de {action_type, value} com um item só.
function firstValue(v: unknown): number {
  const list = simplifyActions(v)
  return list.length ? list[0].value : 0
}

// Valores monetários de objetos (orçamento, saldo) vêm em centavos, como string.
function centavos(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n / 100 : null
}

const PURCHASE = ['purchase', 'omni_purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase']
const ADD_TO_CART = ['add_to_cart', 'omni_add_to_cart', 'offsite_conversion.fb_pixel_add_to_cart']
const INITIATE_CHECKOUT = ['initiate_checkout', 'omni_initiated_checkout', 'offsite_conversion.fb_pixel_initiate_checkout']
const VIEW_CONTENT = ['view_content', 'omni_view_content', 'offsite_conversion.fb_pixel_view_content']
const LANDING = ['landing_page_view']
const LINK = ['link_click']
const LEAD = ['lead', 'onsite_conversion.lead_grouped', 'offsite_conversion.fb_pixel_lead']
const CONVERSATION = ['onsite_conversion.messaging_conversation_started_7d', 'onsite_conversion.total_messaging_connection']
const ENGAGEMENT = ['post_engagement']
const VIDEO = ['video_view']
const APP_INSTALL = ['omni_app_install', 'app_install', 'mobile_app_install']

// "Resultado" igual ao Gerenciador de Anúncios: depende da meta de otimização do conjunto
// (optimization_goal) ou, sem ela, do objetivo da campanha. Pra conversão de site assumimos COMPRA:
// o pixel do delivery do ERPOS dispara Purchase, e é isso que as campanhas de venda otimizam.
function resultFor(
  goal: unknown, objective: unknown, acts: Act[], m: { reach: number; impressions: number },
): { type: string; value: number } {
  const g = String(goal ?? '').toUpperCase()
  const o = String(objective ?? '').toUpperCase()
  const pick = (types: string[]) => ({ type: types[0], value: pickAction(acts, types) })

  if (g === 'OFFSITE_CONVERSIONS' || g === 'VALUE' || /SALES|CONVERSIONS|CATALOG/.test(o)) return pick(PURCHASE)
  if (g === 'LANDING_PAGE_VIEWS') return pick(LANDING)
  if (g === 'LINK_CLICKS' || /TRAFFIC|LINK_CLICKS/.test(o)) return pick(LINK)
  if (g === 'CONVERSATIONS' || g === 'REPLIES' || /MESSAGES/.test(o)) return pick(CONVERSATION)
  if (/LEAD/.test(g) || /LEAD/.test(o)) return pick(LEAD)
  if (g === 'APP_INSTALLS' || /APP/.test(o)) return pick(APP_INSTALL)
  if (g === 'THRUPLAY' || /VIDEO/.test(o)) return pick(VIDEO)
  if (g === 'REACH' || g === 'IMPRESSIONS' || g === 'AD_RECALL_LIFT' || /AWARENESS|REACH/.test(o)) {
    return { type: 'reach', value: m.reach }
  }
  if (g === 'POST_ENGAGEMENT' || /ENGAGEMENT/.test(o)) return pick(ENGAGEMENT)
  if (g === 'PAGE_LIKES') return { type: 'like', value: pickAction(acts, ['like']) }

  // Sem pista: se houve compra, é compra; senão cliques no link.
  const p = pickAction(acts, PURCHASE)
  if (p > 0) return { type: 'purchase', value: p }
  return pick(LINK)
}

// Métricas comuns a conta / campanha / conjunto / anúncio / dia / quebra, a partir de uma linha do insights.
function metrics(row: Row) {
  const acts = simplifyActions(row.actions)
  const vals = simplifyActions(row.action_values)
  const spend = Number(row.spend ?? 0)
  const impressions = Number(row.impressions ?? 0)
  const reach = Number(row.reach ?? 0)
  const purchases = pickAction(acts, PURCHASE)
  const purchaseValue = pickAction(vals, PURCHASE)
  return {
    spend,
    impressions,
    reach,
    frequency: Number(row.frequency ?? 0),
    clicks: Number(row.clicks ?? 0),
    link_clicks: Number(row.inline_link_clicks ?? 0),
    cpc: Number(row.cpc ?? 0),
    ctr: Number(row.ctr ?? 0),
    cpm: Number(row.cpm ?? 0),
    // CTR/CPC sobre cliques no LINK — é o critério que o Gerenciador de Anúncios e o Reportei
    // mostram. Os campos `ctr`/`cpc` acima são sobre TODOS os cliques (curtida, comentário,
    // clique no perfil), o que dá CTR maior e CPC menor. Guardamos os dois.
    link_ctr: Number(row.inline_link_click_ctr ?? 0),
    cost_per_link_click: Number(row.cost_per_inline_link_click ?? 0),
    // Pessoas distintas e cliques que saem da Meta de fato — medida mais honesta de tráfego.
    unique_clicks: Number(row.unique_clicks ?? 0),
    unique_ctr: Number(row.unique_ctr ?? 0),
    cost_per_unique_click: Number(row.cost_per_unique_click ?? 0),
    unique_link_clicks: Number(row.unique_inline_link_clicks ?? 0),
    outbound_clicks: firstValue(row.outbound_clicks),
    outbound_ctr: firstValue(row.outbound_clicks_ctr),
    purchases,
    purchase_value: purchaseValue,
    roas: spend > 0 ? purchaseValue / spend : 0,
    cost_per_purchase: purchases > 0 ? spend / purchases : 0,
    landing_page_views: pickAction(acts, LANDING),
    view_content: pickAction(acts, VIEW_CONTENT),
    add_to_cart: pickAction(acts, ADD_TO_CART),
    initiate_checkout: pickAction(acts, INITIATE_CHECKOUT),
    leads: pickAction(acts, LEAD),
    conversations: pickAction(acts, CONVERSATION),
    result: resultFor(row.optimization_goal, row.objective, acts, { reach, impressions }),
    results: acts,
    // Custo por cada tipo de ação, já calculado pela Meta.
    cost_per: simplifyActions(row.cost_per_action_type),
  }
}

// Só no nível de anúncio: notas de qualidade (comparação com concorrentes) e retenção de vídeo.
function adExtras(row: Row) {
  const plays = firstValue(row.video_play_actions)
  return {
    rankings: {
      quality: row.quality_ranking ? String(row.quality_ranking) : null,
      engagement: row.engagement_rate_ranking ? String(row.engagement_rate_ranking) : null,
      conversion: row.conversion_rate_ranking ? String(row.conversion_rate_ranking) : null,
    },
    video: plays > 0
      ? {
        plays,
        p25: firstValue(row.video_p25_watched_actions),
        p50: firstValue(row.video_p50_watched_actions),
        p75: firstValue(row.video_p75_watched_actions),
        p100: firstValue(row.video_p100_watched_actions),
        thruplay: firstValue(row.video_thruplay_watched_actions),
        avg_seconds: firstValue(row.video_avg_time_watched_actions),
      }
      : null,
  }
}

// Métricas enxutas pra quebras (posicionamento, idade/gênero, hora, aparelho, região, peça) e pro período anterior.
function slim(row: Row) {
  const m = metrics(row)
  return {
    spend: m.spend,
    impressions: m.impressions,
    reach: m.reach,
    clicks: m.clicks,
    link_clicks: m.link_clicks,
    purchases: m.purchases,
    purchase_value: m.purchase_value,
    roas: m.roas,
    cost_per_purchase: m.cost_per_purchase,
    cpc: m.cpc,
    ctr: m.ctr,
    link_ctr: m.link_ctr,
    cost_per_link_click: m.cost_per_link_click,
    frequency: m.frequency,
    cpm: m.cpm,
    landing_page_views: m.landing_page_views,
    add_to_cart: m.add_to_cart,
    initiate_checkout: m.initiate_checkout,
  }
}

async function graphRows(url: string, label: string): Promise<{ ok: boolean; rows: Row[]; status: number; body: unknown }> {
  try {
    const resp = await fetch(url)
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      console.warn(`[meta-ads-insights] ${label} error:`, resp.status, JSON.stringify(body).slice(0, 300))
      return { ok: false, rows: [], status: resp.status, body }
    }
    return { ok: true, rows: Array.isArray((body as Row).data) ? (body as Row).data as Row[] : [], status: resp.status, body }
  } catch (e) {
    console.warn(`[meta-ads-insights] ${label} exception:`, e)
    return { ok: false, rows: [], status: 0, body: null }
  }
}

// GET de um objeto só (conta, post...). Devolve null em erro — nunca derruba o relatório.
async function graphObject(url: string, label: string): Promise<Row | null> {
  try {
    const resp = await fetch(url)
    const body = await resp.json().catch(() => ({}))
    if (!resp.ok) {
      console.warn(`[meta-ads-insights] ${label} error:`, resp.status, JSON.stringify(body).slice(0, 300))
      return null
    }
    return body as Row
  } catch (e) {
    console.warn(`[meta-ads-insights] ${label} exception:`, e)
    return null
  }
}

// GET /?ids=a,b,c&fields=... em lotes de 50. À prova de falha: se der erro, devolve o que conseguiu.
async function fetchObjects(ids: string[], fields: string, token: string, label = 'objects'): Promise<Record<string, Row>> {
  const out: Record<string, Row> = {}
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50)
    try {
      const resp = await fetch(`${GRAPH}/?ids=${chunk.join(',')}&fields=${encodeURIComponent(fields)}&access_token=${token}`)
      const body = await resp.json().catch(() => ({}))
      if (resp.ok && body && typeof body === 'object') {
        for (const [id, obj] of Object.entries(body as Record<string, Row>)) out[id] = obj
      } else {
        console.warn(`[meta-ads-insights] ${label} lookup failed:`, resp.status, JSON.stringify(body).slice(0, 300))
      }
    } catch (e) {
      console.warn(`[meta-ads-insights] ${label} lookup exception:`, e)
    }
  }
  return out
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// Hora local (America/Sao_Paulo) de um timestamp — pro histograma de pedidos por hora.
const hourFmt = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/Sao_Paulo' })
function localHour(ts: string): number {
  const h = Number(hourFmt.format(new Date(ts)))
  return Number.isFinite(h) ? h % 24 : 0
}

// Distância em km entre dois pontos (fórmula de haversine) — pra comparar o pin do anúncio com a loja.
function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371
  const toRad = (x: number) => (x * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.ceil((p / 100) * s.length) - 1))
  return s[idx]
}

// Resumo legível da segmentação do conjunto (targeting da Meta é um objeto grande e irregular).
type Loc = { type: string; name: string; radius_km: number | null; lat: number | null; lng: number | null }
function summarizeTargeting(t: unknown) {
  const tg = (t && typeof t === 'object' ? t : {}) as Row
  const geo = (tg.geo_locations && typeof tg.geo_locations === 'object' ? tg.geo_locations : {}) as Row
  const toKm = (radius: unknown, unit: unknown) => {
    const r = Number(radius)
    if (!Number.isFinite(r) || r <= 0) return null
    return String(unit ?? 'kilometer').toLowerCase().startsWith('mile') ? r * 1.609344 : r
  }
  const locations: Loc[] = []
  for (const c of (Array.isArray(geo.custom_locations) ? geo.custom_locations : []) as Row[]) {
    locations.push({
      type: 'pin',
      name: String(c.name ?? c.address_string ?? 'Pin no mapa'),
      radius_km: toKm(c.radius, c.distance_unit),
      lat: Number.isFinite(Number(c.latitude)) ? Number(c.latitude) : null,
      lng: Number.isFinite(Number(c.longitude)) ? Number(c.longitude) : null,
    })
  }
  for (const c of (Array.isArray(geo.cities) ? geo.cities : []) as Row[]) {
    locations.push({ type: 'cidade', name: String(c.name ?? c.key ?? ''), radius_km: toKm(c.radius, c.distance_unit), lat: null, lng: null })
  }
  for (const c of (Array.isArray(geo.regions) ? geo.regions : []) as Row[]) {
    locations.push({ type: 'estado', name: String(c.name ?? c.key ?? ''), radius_km: null, lat: null, lng: null })
  }
  for (const c of (Array.isArray(geo.zips) ? geo.zips : []) as Row[]) {
    locations.push({ type: 'cep', name: String(c.name ?? c.key ?? ''), radius_km: null, lat: null, lng: null })
  }
  for (const c of (Array.isArray(geo.countries) ? geo.countries : []) as unknown[]) {
    locations.push({ type: 'país', name: String(c), radius_km: null, lat: null, lng: null })
  }

  const names = (list: unknown): string[] =>
    (Array.isArray(list) ? list : []).map((x) => String((x as Row)?.name ?? '')).filter(Boolean)
  const interests = new Set<string>(names(tg.interests))
  const behaviors = new Set<string>(names(tg.behaviors))
  for (const spec of (Array.isArray(tg.flexible_spec) ? tg.flexible_spec : []) as Row[]) {
    names(spec.interests).forEach((n) => interests.add(n))
    names(spec.behaviors).forEach((n) => behaviors.add(n))
  }
  const genders = Array.isArray(tg.genders) ? (tg.genders as number[]) : []
  const automation = (tg.targeting_automation && typeof tg.targeting_automation === 'object' ? tg.targeting_automation : {}) as Row

  return {
    age_min: Number(tg.age_min ?? 0) || null,
    age_max: Number(tg.age_max ?? 0) || null,
    genders: genders.length === 0 || genders.length === 2 ? 'todos' : genders[0] === 1 ? 'homens' : 'mulheres',
    locations,
    location_types: Array.isArray(geo.location_types) ? (geo.location_types as string[]) : [],
    interests: Array.from(interests).slice(0, 15),
    behaviors: Array.from(behaviors).slice(0, 10),
    custom_audiences: names(tg.custom_audiences),
    excluded_audiences: names(tg.excluded_custom_audiences),
    advantage_audience: Number(automation.advantage_audience ?? 0) === 1,
    publisher_platforms: Array.isArray(tg.publisher_platforms) ? (tg.publisher_platforms as string[]) : [],
  }
}

function issuesText(v: unknown): string[] {
  return (Array.isArray(v) ? v : [])
    .map((i) => String((i as Row)?.error_summary ?? (i as Row)?.error_message ?? ''))
    .filter(Boolean)
}
function recsText(v: unknown): Array<{ title: string; message: string; code: number | null }> {
  return (Array.isArray(v) ? v : []).map((r) => ({
    title: String((r as Row)?.title ?? ''),
    message: String((r as Row)?.message ?? ''),
    code: Number.isFinite(Number((r as Row)?.code)) ? Number((r as Row)?.code) : null,
  })).filter((r) => r.title || r.message)
}

// Pedidos REAIS do delivery do ERPOS no período: (a) os que chegaram por link com utm_source da Meta
// (instagram/facebook/fb/ig/meta...) — cruza a atribuição da Meta com o que entrou de fato no caixa;
// (b) histograma por hora de TODOS os pedidos do delivery; (c) distâncias de entrega (p90 e máxima),
// pra comparar com o raio dos anúncios.
async function erposOrders(admin: ReturnType<typeof createClient>, tenantId: string, since: string, until: string) {
  const { data, error } = await admin
    .from('orders')
    .select('total_amount, delivery_source, status, created_at, delivery_distance_km')
    .eq('tenant_id', tenantId)
    .eq('origin_type', 'delivery')
    .in('delivery_platform', ['propria', 'retirada'])
    .eq('is_training', false)
    .gte('created_at', `${since}T00:00:00-03:00`)
    .lte('created_at', `${until}T23:59:59-03:00`)
    .limit(10000)
  if (error) {
    console.warn('[meta-ads-insights] orders lookup error:', error.message)
    return null
  }
  const isMeta = (s: string) => /^(fb|ig|meta|face|insta)/.test(s)
  const bySource: Record<string, { count: number; revenue: number }> = {}
  const hourly: number[] = Array.from({ length: 24 }, () => 0)
  const dists: number[] = []
  let count = 0
  let revenue = 0
  let totalCount = 0
  let totalRevenue = 0
  for (const o of (data ?? []) as Array<{ total_amount: unknown; delivery_source: unknown; status: unknown; created_at: string; delivery_distance_km: unknown }>) {
    if (String(o.status ?? '').toLowerCase().includes('cancel')) continue
    const v = Number(o.total_amount ?? 0)
    totalCount += 1
    totalRevenue += v
    hourly[localHour(o.created_at)] += 1
    const km = Number(o.delivery_distance_km)
    if (Number.isFinite(km) && km > 0) dists.push(km)
    const src = String(o.delivery_source ?? '').trim().toLowerCase()
    if (!src || !isMeta(src)) continue
    count += 1
    revenue += v
    bySource[src] = bySource[src] ?? { count: 0, revenue: 0 }
    bySource[src].count += 1
    bySource[src].revenue += v
  }
  return {
    count, revenue, by_source: bySource, since, until,
    total_count: totalCount, total_revenue: totalRevenue, hourly,
    km_p90: percentile(dists, 90), km_max: dists.length ? Math.max(...dists) : null, km_amostra: dists.length,
  }
}

// Área de entrega configurada no ERPOS: pin da loja + faixas de km (system_settings.delivery_config).
async function deliveryArea(admin: ReturnType<typeof createClient>, tenantId: string) {
  const [{ data: ss }, { count }] = await Promise.all([
    admin.from('system_settings').select('delivery_config, delivery_city').eq('tenant_id', tenantId).maybeSingle(),
    admin.from('delivery_neighborhoods').select('id', { count: 'exact', head: true }).eq('tenant_id', tenantId).eq('is_active', true),
  ])
  const dc = ((ss?.delivery_config ?? {}) as Row)
  const tiers = (Array.isArray(dc.delivery_fee_tiers) ? dc.delivery_fee_tiers : []) as Row[]
  const maxKm = tiers.map((t) => Number(t.ate_km) || 0).filter((k) => k > 0).reduce((a, b) => Math.max(a, b), 0) || null
  const loc = dc.store_location as Row | undefined
  const store = loc && typeof loc.lat === 'number' && typeof loc.lng === 'number' ? { lat: loc.lat as number, lng: loc.lng as number } : null
  return { max_km: maxKm, store, city: ss?.delivery_city ? String(ss.delivery_city) : null, neighborhoods: count ?? 0 }
}

// Sessão válida + usuário membro DESTA loja. A função roda com service role e é publicada sem
// verify_jwt no gateway, então a checagem tem que ser aqui — senão qualquer um com a anon key
// leria as métricas de qualquer tenant só trocando o tenant_id do body.
async function requireMember(req: Request, admin: ReturnType<typeof createClient>, tenantId: string) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { error: json({ ok: false, error: 'Não autenticado' }, 401) }
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return { error: json({ ok: false, error: 'Sessão inválida' }, 401) }
  const { data: membership, error: memErr } = await admin
    .from('user_tenants')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle()
  if (memErr) return { error: json({ ok: false, error: memErr.message }, 500) }
  if (!membership) return { error: json({ ok: false, error: 'Sem acesso a esta loja' }, 403) }
  return { error: null, userId: userData.user.id, role: String(membership.role ?? '') }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── Dois caminhos de acesso ───────────────────────────────────────────────
    // (1) share_token: link público SOMENTE LEITURA. A loja e o período saem DA
    //     LINHA DO BANCO; tenant_id/date_preset/time_range do body são ignorados.
    //     Se viessem do navegador, bastaria trocar o tenant_id para ver outra loja.
    // (2) sem token: sessão do app, validando que o usuário é membro da loja.
    const shareToken = typeof body.share_token === 'string' ? body.share_token.trim() : ''
    let tenantId: string
    let share: Row | null = null
    let includeErpos = true
    let storeName: string | null = null

    if (shareToken) {
      if (!/^[a-f0-9]{32,64}$/.test(shareToken)) {
        return json({ ok: false, share_invalid: true, error: 'Link inválido.' }, 200)
      }
      const { data: row, error: shareErr } = await admin
        .from('trafego_pago_shares')
        .select('tenant_id, label, date_preset, range_since, range_until, include_erpos_orders, expires_at, revoked_at, created_by_name, view_count')
        .eq('token', shareToken)
        .maybeSingle()
      if (shareErr) {
        console.error('[meta-ads-insights] share lookup error:', shareErr)
        return json({ ok: false, error: shareErr.message }, 500)
      }
      if (!row) return json({ ok: false, share_invalid: true, error: 'Link inválido ou removido.' }, 200)
      if (row.revoked_at) return json({ ok: false, share_revoked: true, error: 'Este link foi revogado pela loja.' }, 200)
      if (row.expires_at && Date.parse(String(row.expires_at)) < Date.now()) {
        return json({ ok: false, share_expired: true, error: 'Este link expirou.' }, 200)
      }
      share = row as Row
      tenantId = String(row.tenant_id)
      includeErpos = row.include_erpos_orders === true

      const { data: t } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle()
      storeName = t?.name ? String(t.name) : null

      // Contador de acessos (não bloqueia a resposta se falhar).
      await admin
        .from('trafego_pago_shares')
        .update({ view_count: Number(row.view_count ?? 0) + 1, last_viewed_at: new Date().toISOString() })
        .eq('token', shareToken)
        .then(undefined, (e: unknown) => console.warn('[meta-ads-insights] view_count:', e))
    } else {
      tenantId = body.tenant_id || body.active_tenant_id
      if (!tenantId) return json({ ok: false, error: 'tenant_id é obrigatório' }, 400)
      const auth = await requireMember(req, admin, String(tenantId))
      if (auth.error) return auth.error
    }

    // Busca o token + conta de anúncios da loja (token nunca sai daqui)
    const { data: conn, error: connErr } = await admin
      .from('meta_ad_connections')
      .select('access_token, ad_account_id, ad_account_name')
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (connErr) {
      console.error('[meta-ads-insights] connection lookup error:', connErr)
      return json({ ok: false, error: connErr.message }, 500)
    }
    if (!conn || !conn.access_token) {
      return json({ ok: false, not_connected: true, error: 'Loja não conectada ao Meta' }, 200)
    }
    if (!conn.ad_account_id) {
      return json({ ok: false, no_account: true, error: 'Nenhuma conta de anúncios selecionada' }, 200)
    }

    // Com share_token o período vem congelado do banco; sem ele, do body.
    const periodSource = share
      ? {
        date_preset: share.date_preset,
        time_range: share.range_since && share.range_until
          ? { since: share.range_since, until: share.range_until }
          : undefined,
      }
      : { date_preset: body.date_preset, time_range: body.time_range }

    const requested = String(periodSource.date_preset ?? 'last_7d')
    let datePreset = ALLOWED_DATE_PRESETS.has(requested) ? requested : 'last_7d'

    // Período personalizado: time_range = { since, until } (YYYY-MM-DD, since ≤ until, ≤ 366 dias).
    // Se vier inválido, ignora e cai no preset — nunca devolve erro por causa de data.
    let period = `date_preset=${datePreset}`
    const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
    const tr = periodSource.time_range as { since?: unknown; until?: unknown } | undefined
    if (tr && typeof tr === 'object') {
      const s = String(tr.since ?? '')
      const u = String(tr.until ?? '')
      const span = ISO_DATE.test(s) && ISO_DATE.test(u)
        ? (Date.parse(`${u}T00:00:00Z`) - Date.parse(`${s}T00:00:00Z`)) / 86400000
        : NaN
      if (Number.isFinite(span) && span >= 0 && span <= 366) {
        period = `time_range=${encodeURIComponent(JSON.stringify({ since: s, until: u }))}`
        datePreset = 'custom'
      } else {
        console.warn('[meta-ads-insights] time_range inválido, usando preset:', JSON.stringify(tr).slice(0, 100))
      }
    }

    const common = [
      'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks',
      'cpc', 'ctr', 'cpm', 'inline_link_click_ctr', 'cost_per_inline_link_click',
      'unique_clicks', 'unique_ctr', 'cost_per_unique_click', 'unique_inline_link_clicks',
      'outbound_clicks', 'outbound_clicks_ctr', 'cost_per_action_type',
      'actions', 'action_values',
    ]
    const campaignFields = ['campaign_id', 'campaign_name', 'objective', ...common].join(',')
    const adsetFields = ['campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'objective', 'optimization_goal', ...common].join(',')
    // Notas de qualidade e retenção de vídeo só existem no nível de anúncio.
    const adFields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'objective', 'optimization_goal', ...common,
      'quality_ranking', 'engagement_rate_ranking', 'conversion_rate_ranking',
      'video_play_actions', 'video_p25_watched_actions', 'video_p50_watched_actions',
      'video_p75_watched_actions', 'video_p100_watched_actions', 'video_thruplay_watched_actions',
      'video_avg_time_watched_actions',
    ].join(',')
    const dailyFields = ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions', 'action_values'].join(',')
    // Quebras não aceitam reach/frequency nem métricas "unique" em todas as combinações — só o essencial.
    const breakdownFields = [
      'spend', 'impressions', 'clicks', 'inline_link_clicks', 'cpc', 'ctr',
      'inline_link_click_ctr', 'cost_per_inline_link_click', 'actions', 'action_values',
    ].join(',')
    // frequency_value é a distribuição de quantas vezes cada pessoa viu: precisa de reach.
    const frequencyFields = ['spend', 'impressions', 'reach', 'actions', 'action_values'].join(',')
    // Totais NO NÍVEL DA CONTA (sem level, sem time_increment). Necessário porque ALCANCE é
    // deduplicado por consulta: somar o alcance das campanhas conta a mesma pessoa várias vezes
    // e infla o total (e por consequência subestima a frequência). Só esta consulta dá o número
    // real do período — é o mesmo que o Gerenciador de Anúncios e o Reportei mostram.
    const totalsFields = common.join(',')

    const base = `${GRAPH}/${conn.ad_account_id}/insights`
    const token = encodeURIComponent(conn.access_token)
    const bd = (breakdown: string, fields = breakdownFields) =>
      graphRows(`${base}?fields=${fields}&breakdowns=${breakdown}&${period}&limit=200&access_token=${token}`, `bd:${breakdown}`)

    // Consultas em paralelo: totais, campanha, conjunto, anúncio, dia, e as quebras.
    const [
      acct, camp, adsetQ, ad, day,
      placement, ageGender, hourly, devicePlatform, impressionDevice, region, frequencyValue,
      assetImage, assetTitle, assetBody, assetCta,
      accountInfo, audiences, area,
    ] = await Promise.all([
      graphRows(`${base}?fields=${totalsFields}&${period}&access_token=${token}`, 'account_totals'),
      graphRows(`${base}?level=campaign&fields=${campaignFields}&${period}&limit=200&access_token=${token}`, 'campaign'),
      graphRows(`${base}?level=adset&fields=${adsetFields}&${period}&limit=300&access_token=${token}`, 'adset'),
      graphRows(`${base}?level=ad&fields=${adFields}&${period}&limit=500&access_token=${token}`, 'ad'),
      graphRows(`${base}?fields=${dailyFields}&${period}&time_increment=1&limit=500&access_token=${token}`, 'daily'),
      bd('publisher_platform,platform_position'),
      bd('age,gender'),
      bd('hourly_stats_aggregated_by_advertiser_time_zone'),
      bd('device_platform'),
      bd('impression_device'),
      bd('country,region'),
      bd('frequency_value', frequencyFields),
      bd('image_asset'),
      bd('title_asset'),
      bd('body_asset'),
      bd('call_to_action_asset'),
      graphObject(
        `${GRAPH}/${conn.ad_account_id}?fields=name,currency,account_status,disable_reason,amount_spent,balance,spend_cap,timezone_name,funding_source_details&access_token=${token}`,
        'account',
      ),
      graphRows(
        `${GRAPH}/${conn.ad_account_id}/customaudiences?fields=name,subtype,approximate_count_lower_bound,approximate_count_upper_bound,delivery_status,operation_status,time_updated&limit=50&access_token=${token}`,
        'audiences',
      ),
      deliveryArea(admin, String(tenantId)),
    ])

    if (!camp.ok) {
      console.error('[meta-ads-insights] Meta error:', camp.status, camp.body)
      return json({ ok: false, status: camp.status, error: (camp.body as Row | null)?.error ?? camp.body }, 502)
    }

    const campRows = camp.rows
    const adsetRows = adsetQ.rows
    const adRows = ad.rows
    const dailyRows = day.rows
    // Totais reais do período (alcance/frequência corretos). Null = a consulta falhou e o front
    // cai em somar as campanhas, com alcance aproximado.
    const accountTotals = acct.rows[0] ? metrics(acct.rows[0]) : null

    // Objetos (fora do insights): status, orçamento, aprendizado, segmentação, criativo, problemas.
    // "recommendations" vai num lote separado: se a Meta recusar o campo, o essencial não cai junto.
    const adIds = adRows.map((r) => String(r.ad_id ?? ''))
    const adsetIds = adsetRows.map((r) => String(r.adset_id ?? ''))
    const campIds = campRows.map((r) => String(r.campaign_id ?? ''))
    const [adObjs, adsetObjs, campObjs, adRecs, adsetRecs, campRecs] = await Promise.all([
      fetchObjects(adIds, 'effective_status,issues_info,creative{thumbnail_url,image_url,body,title,call_to_action_type,effective_object_story_id,video_id,object_story_spec}', token, 'ads'),
      fetchObjects(adsetIds, 'effective_status,daily_budget,lifetime_budget,budget_remaining,bid_strategy,bid_amount,start_time,end_time,learning_stage_info,targeting,issues_info,optimization_goal,billing_event', token, 'adsets'),
      fetchObjects(campIds, 'effective_status,daily_budget,lifetime_budget,budget_remaining,bid_strategy,start_time,stop_time,issues_info,special_ad_categories', token, 'campaigns'),
      fetchObjects(adIds, 'recommendations', token, 'ad_recs'),
      fetchObjects(adsetIds, 'recommendations', token, 'adset_recs'),
      fetchObjects(campIds, 'recommendations', token, 'camp_recs'),
    ])

    const campaigns = campRows.map((row) => {
      const id = String(row.campaign_id ?? '')
      const o = campObjs[id] ?? {}
      return {
        campaign_id: id,
        campaign: String(row.campaign_name ?? '(sem nome)'),
        objective: row.objective ? String(row.objective) : null,
        status: o.effective_status ? String(o.effective_status) : null,
        daily_budget: centavos(o.daily_budget),
        lifetime_budget: centavos(o.lifetime_budget),
        budget_remaining: centavos(o.budget_remaining),
        bid_strategy: o.bid_strategy ? String(o.bid_strategy) : null,
        start_time: o.start_time ? String(o.start_time) : null,
        stop_time: o.stop_time ? String(o.stop_time) : null,
        issues: issuesText(o.issues_info),
        recommendations: recsText(campRecs[id]?.recommendations),
        ...metrics(row),
      }
    })

    const storePin = area.store
    const adsets = adsetRows.map((row) => {
      const id = String(row.adset_id ?? '')
      const o = adsetObjs[id] ?? {}
      const learning = (o.learning_stage_info && typeof o.learning_stage_info === 'object' ? o.learning_stage_info : null) as Row | null
      const targeting = summarizeTargeting(o.targeting)
      // Cruzamento com a área de entrega: pra cada pin com raio, distância do pin até a loja e
      // quanto o raio passa do limite de entrega configurado no ERPOS.
      const areaCheck = targeting.locations
        .filter((l) => l.radius_km !== null)
        .map((l) => {
          const distStore = storePin && l.lat !== null && l.lng !== null ? haversineKm(storePin.lat, storePin.lng, l.lat, l.lng) : null
          const alcance = l.radius_km !== null && distStore !== null ? l.radius_km + distStore : l.radius_km
          const excede = area.max_km !== null && alcance !== null ? Math.max(0, alcance - area.max_km) : null
          return { name: l.name, type: l.type, radius_km: l.radius_km, dist_store_km: distStore, alcance_km: alcance, excede_km: excede }
        })
      return {
        adset_id: id,
        adset: String(row.adset_name ?? '(sem nome)'),
        campaign_id: String(row.campaign_id ?? ''),
        campaign: String(row.campaign_name ?? ''),
        objective: row.objective ? String(row.objective) : null,
        optimization_goal: row.optimization_goal ? String(row.optimization_goal) : (o.optimization_goal ? String(o.optimization_goal) : null),
        status: o.effective_status ? String(o.effective_status) : null,
        daily_budget: centavos(o.daily_budget),
        lifetime_budget: centavos(o.lifetime_budget),
        budget_remaining: centavos(o.budget_remaining),
        bid_strategy: o.bid_strategy ? String(o.bid_strategy) : null,
        bid_amount: centavos(o.bid_amount),
        billing_event: o.billing_event ? String(o.billing_event) : null,
        start_time: o.start_time ? String(o.start_time) : null,
        end_time: o.end_time ? String(o.end_time) : null,
        learning: learning
          ? {
            status: String(learning.status ?? ''),
            conversions: Number(learning.conversions ?? 0),
            last_edit: learning.last_sig_edit_ts ? new Date(Number(learning.last_sig_edit_ts) * 1000).toISOString() : null,
          }
          : null,
        targeting,
        area_check: areaCheck,
        issues: issuesText(o.issues_info),
        recommendations: recsText(adsetRecs[id]?.recommendations),
        ...metrics(row),
      }
    })

    const ads = adRows.map((row) => {
      const id = String(row.ad_id ?? '')
      const o = adObjs[id] ?? {}
      const creative = (o.creative && typeof o.creative === 'object' ? o.creative : {}) as Row
      const spec = (creative.object_story_spec && typeof creative.object_story_spec === 'object' ? creative.object_story_spec : {}) as Row
      const linkData = (spec.link_data && typeof spec.link_data === 'object' ? spec.link_data : {}) as Row
      const videoData = (spec.video_data && typeof spec.video_data === 'object' ? spec.video_data : {}) as Row
      const cta = (linkData.call_to_action ?? videoData.call_to_action) as Row | undefined
      return {
        ad_id: id,
        ad: String(row.ad_name ?? '(sem nome)'),
        adset_id: String(row.adset_id ?? ''),
        adset: String(row.adset_name ?? ''),
        campaign_id: String(row.campaign_id ?? ''),
        campaign: String(row.campaign_name ?? ''),
        objective: row.objective ? String(row.objective) : null,
        optimization_goal: row.optimization_goal ? String(row.optimization_goal) : null,
        status: o.effective_status ? String(o.effective_status) : null,
        thumbnail_url: creative.thumbnail_url ? String(creative.thumbnail_url) : null,
        creative: {
          title: String(creative.title ?? linkData.name ?? videoData.title ?? ''),
          body: String(creative.body ?? linkData.message ?? videoData.message ?? ''),
          description: String(linkData.description ?? ''),
          cta: String(creative.call_to_action_type ?? cta?.type ?? ''),
          link: String(linkData.link ?? ''),
          image_url: creative.image_url ? String(creative.image_url) : null,
          video_id: creative.video_id ? String(creative.video_id) : (videoData.video_id ? String(videoData.video_id) : null),
          story_id: creative.effective_object_story_id ? String(creative.effective_object_story_id) : null,
        },
        issues: issuesText(o.issues_info),
        recommendations: recsText(adRecs[id]?.recommendations),
        ...metrics(row),
        ...adExtras(row),
      }
    })

    // Comentários das publicações impulsionadas (top 8 anúncios por gasto). O token de anúncios
    // normalmente NÃO tem permissão de página: aí a Meta responde erro 10/200/100 e a tela explica
    // o que falta (pages_show_list + pages_read_engagement na configuração de login).
    let comments: { available: boolean; reason: string | null; by_ad: Record<string, { total: number; latest: Array<{ message: string; from: string; created_time: string; likes: number }> }> } =
      { available: true, reason: null, by_ad: {} }
    const topAds = [...ads].filter((a) => a.creative.story_id && a.spend > 0).sort((a, b) => b.spend - a.spend).slice(0, 8)
    if (topAds.length) {
      const results = await Promise.all(topAds.map(async (a) => {
        const url = `${GRAPH}/${a.creative.story_id}/comments?fields=message,created_time,from{name},like_count&summary=total_count&order=reverse_chronological&limit=5&access_token=${token}`
        try {
          const resp = await fetch(url)
          const b = await resp.json().catch(() => ({})) as Row
          if (!resp.ok) {
            const err = (b.error ?? {}) as Row
            return { ad_id: a.ad_id, error: Number(err.code ?? resp.status), message: String(err.message ?? '') }
          }
          const data = Array.isArray(b.data) ? b.data as Row[] : []
          const summary = (b.summary ?? {}) as Row
          return {
            ad_id: a.ad_id,
            total: Number(summary.total_count ?? data.length),
            latest: data.map((c) => ({
              message: String(c.message ?? ''),
              from: String(((c.from ?? {}) as Row).name ?? 'Alguém'),
              created_time: String(c.created_time ?? ''),
              likes: Number(c.like_count ?? 0),
            })),
          }
        } catch (e) {
          return { ad_id: a.ad_id, error: 0, message: String(e) }
        }
      }))
      const permErr = results.find((r) => 'error' in r && [10, 200, 100, 190].includes(Number(r.error)))
      if (permErr && results.every((r) => 'error' in r)) {
        comments = { available: false, reason: 'permission', by_ad: {} }
        console.warn('[meta-ads-insights] comments unavailable:', (permErr as { message: string }).message)
      } else {
        for (const r of results) if (!('error' in r)) comments.by_ad[r.ad_id] = { total: r.total, latest: r.latest }
      }
    }

    const daily = dailyRows
      .map((row) => {
        const m = metrics(row)
        return {
          date: String(row.date_start ?? ''),
          spend: m.spend,
          impressions: m.impressions,
          reach: m.reach,
          clicks: m.clicks,
          link_clicks: m.link_clicks,
          purchases: m.purchases,
          purchase_value: m.purchase_value,
          // Compatibilidade com o front antigo (linha "Resultados" do gráfico) — hoje = compras.
          results: m.purchases,
        }
      })
      .sort((a, b) => a.date.localeCompare(b.date))

    const byPlacement = placement.rows.map((row) => ({
      platform: String(row.publisher_platform ?? ''),
      position: String(row.platform_position ?? ''),
      ...slim(row),
    }))
    const byAgeGender = ageGender.rows.map((row) => ({
      age: String(row.age ?? ''),
      gender: String(row.gender ?? ''),
      ...slim(row),
    }))
    const byHour = hourly.rows.map((row) => ({
      // "13:00:00 - 13:59:59" → 13
      hour: Number(String(row.hourly_stats_aggregated_by_advertiser_time_zone ?? '0').slice(0, 2)) || 0,
      ...slim(row),
    })).sort((a, b) => a.hour - b.hour)
    const byDevicePlatform = devicePlatform.rows.map((row) => ({ device: String(row.device_platform ?? ''), ...slim(row) }))
    const byImpressionDevice = impressionDevice.rows.map((row) => ({ device: String(row.impression_device ?? ''), ...slim(row) }))
    const byRegion = region.rows.map((row) => ({ country: String(row.country ?? ''), region: String(row.region ?? ''), ...slim(row) }))
    const byFrequency = frequencyValue.rows.map((row) => ({
      ...slim(row),
      bucket: String(row.frequency_value ?? ''),
    }))
    const assetLabel = (row: Row, key: string): { label: string; url: string | null } => {
      const a = (row[key] && typeof row[key] === 'object' ? row[key] : {}) as Row
      return {
        label: String(a.text ?? a.name ?? a.type ?? a.hash ?? a.id ?? '(sem nome)').slice(0, 140),
        url: a.url ? String(a.url) : null,
      }
    }
    const assets = {
      image: assetImage.rows.map((row) => ({ ...assetLabel(row, 'image_asset'), ...slim(row) })),
      title: assetTitle.rows.map((row) => ({ ...assetLabel(row, 'title_asset'), ...slim(row) })),
      body: assetBody.rows.map((row) => ({ ...assetLabel(row, 'body_asset'), ...slim(row) })),
      cta: assetCta.rows.map((row) => ({ ...assetLabel(row, 'call_to_action_asset'), ...slim(row) })),
    }

    const account = accountInfo
      ? {
        name: accountInfo.name ? String(accountInfo.name) : null,
        currency: accountInfo.currency ? String(accountInfo.currency) : null,
        status: Number(accountInfo.account_status ?? 0),
        disable_reason: Number(accountInfo.disable_reason ?? 0),
        amount_spent: centavos(accountInfo.amount_spent),
        balance: centavos(accountInfo.balance),
        spend_cap: centavos(accountInfo.spend_cap),
        timezone: accountInfo.timezone_name ? String(accountInfo.timezone_name) : null,
        funding: ((accountInfo.funding_source_details ?? {}) as Row).display_string
          ? String(((accountInfo.funding_source_details ?? {}) as Row).display_string)
          : null,
      }
      : null

    const audienceList = audiences.rows.map((r) => ({
      id: String(r.id ?? ''),
      name: String(r.name ?? ''),
      subtype: String(r.subtype ?? ''),
      size_low: Number(r.approximate_count_lower_bound ?? 0) || null,
      size_high: Number(r.approximate_count_upper_bound ?? 0) || null,
      delivery_status: String(((r.delivery_status ?? {}) as Row).description ?? ''),
      updated: r.time_updated ? new Date(Number(r.time_updated) * 1000).toISOString() : null,
    }))

    // Período efetivo (a Meta devolve date_start/date_stop em toda linha): menor início, maior fim.
    const allRows = [...acct.rows, ...campRows, ...dailyRows]
    const starts = allRows.map((r) => String(r.date_start ?? '')).filter(Boolean).sort()
    const stops = allRows.map((r) => String(r.date_stop ?? '')).filter(Boolean).sort()
    const since = starts[0] ?? ''
    const until = stops[stops.length - 1] ?? ''
    const range = since && until ? { since, until } : null

    // Período anterior de mesmo tamanho (totais da conta) — pros deltas dos KPIs. Não faz sentido em "maximum".
    let previous: (ReturnType<typeof slim> & { since: string; until: string }) | null = null
    if (range && datePreset !== 'maximum') {
      const days = Math.round((Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000) + 1
      const prevSince = addDays(since, -days)
      const prevUntil = addDays(since, -1)
      const trPrev = encodeURIComponent(JSON.stringify({ since: prevSince, until: prevUntil }))
      const prev = await graphRows(`${base}?fields=${totalsFields}&time_range=${trPrev}&access_token=${token}`, 'previous')
      const row = prev.rows[0]
      previous = { ...slim(row ?? {}), since: prevSince, until: prevUntil }
    }

    // No link público, o cruzamento com pedidos do ERPOS (faturamento real) só vai
    // se quem gerou o link marcou a opção. A área de entrega (raio) vai sempre: é só km.
    const orders = range && includeErpos ? await erposOrders(admin, String(tenantId), since, until) : null

    return json({
      ok: true,
      date_preset: datePreset,
      range,
      // Só no link público: cabeçalho de leitura (a tela do app já sabe a loja).
      share: share
        ? {
          store_name: storeName,
          label: share.label ?? null,
          created_by_name: share.created_by_name ?? null,
          expires_at: share.expires_at ?? null,
        }
        : null,
      ad_account_id: conn.ad_account_id,
      ad_account_name: conn.ad_account_name,
      account,
      count: campaigns.length,
      totals: accountTotals,
      campaigns,
      adsets,
      ads,
      daily,
      previous,
      breakdowns: {
        placement: byPlacement,
        age_gender: byAgeGender,
        hourly: byHour,
        device_platform: byDevicePlatform,
        impression_device: byImpressionDevice,
        region: byRegion,
        frequency: byFrequency,
        assets,
      },
      audiences: audienceList,
      delivery_area: {
        max_km: area.max_km,
        store: area.store,
        city: area.city,
        neighborhoods: area.neighborhoods,
        km_p90: orders?.km_p90 ?? null,
        km_max: orders?.km_max ?? null,
        km_amostra: orders?.km_amostra ?? 0,
      },
      comments,
      erpos_orders: orders,
    })
  } catch (err) {
    console.error('[meta-ads-insights] Error:', err)
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

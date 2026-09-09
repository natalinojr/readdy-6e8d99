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

// Métricas comuns a campanha / anúncio / dia / quebra, a partir de uma linha do insights.
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
  }
}

// Métricas enxutas pra quebras (posicionamento, idade/gênero, hora) e pro período anterior.
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

// GET /?ids=a,b,c&fields=... em lotes de 50 (status e miniatura dos anúncios / status das campanhas).
// À prova de falha: se der erro, devolve o que conseguiu — o relatório sai sem status/miniatura.
async function fetchObjects(ids: string[], fields: string, token: string): Promise<Record<string, Row>> {
  const out: Record<string, Row> = {}
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50)
    try {
      const resp = await fetch(`${GRAPH}/?ids=${chunk.join(',')}&fields=${fields}&access_token=${token}`)
      const body = await resp.json().catch(() => ({}))
      if (resp.ok && body && typeof body === 'object') {
        for (const [id, obj] of Object.entries(body as Record<string, Row>)) out[id] = obj
      } else {
        console.warn('[meta-ads-insights] objects lookup failed:', resp.status, JSON.stringify(body).slice(0, 300))
      }
    } catch (e) {
      console.warn('[meta-ads-insights] objects lookup exception:', e)
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

// Pedidos REAIS do delivery do ERPOS no período: (a) os que chegaram por link com utm_source da Meta
// (instagram/facebook/fb/ig/meta...) — cruza a atribuição da Meta com o que entrou de fato no caixa;
// (b) histograma por hora de TODOS os pedidos do delivery — pra cruzar com a hora das compras dos anúncios.
async function erposOrders(admin: ReturnType<typeof createClient>, tenantId: string, since: string, until: string) {
  const { data, error } = await admin
    .from('orders')
    .select('total_amount, delivery_source, status, created_at')
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
  let count = 0
  let revenue = 0
  let totalCount = 0
  let totalRevenue = 0
  for (const o of (data ?? []) as Array<{ total_amount: unknown; delivery_source: unknown; status: unknown; created_at: string }>) {
    if (String(o.status ?? '').toLowerCase().includes('cancel')) continue
    const v = Number(o.total_amount ?? 0)
    totalCount += 1
    totalRevenue += v
    hourly[localHour(o.created_at)] += 1
    const src = String(o.delivery_source ?? '').trim().toLowerCase()
    if (!src || !isMeta(src)) continue
    count += 1
    revenue += v
    bySource[src] = bySource[src] ?? { count: 0, revenue: 0 }
    bySource[src].count += 1
    bySource[src].revenue += v
  }
  return { count, revenue, by_source: bySource, since, until, total_count: totalCount, total_revenue: totalRevenue, hourly }
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
      'actions', 'action_values',
    ]
    const campaignFields = ['campaign_id', 'campaign_name', 'objective', ...common].join(',')
    const adFields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'objective', 'optimization_goal', ...common,
    ].join(',')
    const dailyFields = ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions', 'action_values'].join(',')
    // Quebras não aceitam reach/frequency em todas as combinações — ficam só com o essencial.
    const breakdownFields = [
      'spend', 'impressions', 'clicks', 'inline_link_clicks', 'cpc', 'ctr',
      'inline_link_click_ctr', 'cost_per_inline_link_click', 'actions', 'action_values',
    ].join(',')
    // Totais NO NÍVEL DA CONTA (sem level, sem time_increment). Necessário porque ALCANCE é
    // deduplicado por consulta: somar o alcance das campanhas conta a mesma pessoa várias vezes
    // e infla o total (e por consequência subestima a frequência). Só esta consulta dá o número
    // real do período — é o mesmo que o Gerenciador de Anúncios e o Reportei mostram.
    const totalsFields = common.join(',')

    const base = `${GRAPH}/${conn.ad_account_id}/insights`
    const token = encodeURIComponent(conn.access_token)

    // Sete consultas em paralelo: totais da conta, campanha, anúncio, dia, posicionamento,
    // idade/gênero, hora do dia.
    const [acct, camp, ad, day, placement, ageGender, hourly] = await Promise.all([
      graphRows(`${base}?fields=${totalsFields}&${period}&access_token=${token}`, 'account_totals'),
      graphRows(`${base}?level=campaign&fields=${campaignFields}&${period}&limit=200&access_token=${token}`, 'campaign'),
      graphRows(`${base}?level=ad&fields=${adFields}&${period}&limit=500&access_token=${token}`, 'ad'),
      graphRows(`${base}?fields=${dailyFields}&${period}&time_increment=1&limit=500&access_token=${token}`, 'daily'),
      graphRows(`${base}?fields=${breakdownFields}&breakdowns=publisher_platform,platform_position&${period}&limit=200&access_token=${token}`, 'placement'),
      graphRows(`${base}?fields=${breakdownFields}&breakdowns=age,gender&${period}&limit=200&access_token=${token}`, 'age_gender'),
      graphRows(`${base}?fields=${breakdownFields}&breakdowns=hourly_stats_aggregated_by_advertiser_time_zone&${period}&limit=200&access_token=${token}`, 'hourly'),
    ])

    if (!camp.ok) {
      console.error('[meta-ads-insights] Meta error:', camp.status, camp.body)
      return json({ ok: false, status: camp.status, error: (camp.body as Row | null)?.error ?? camp.body }, 502)
    }

    const campRows = camp.rows
    const adRows = ad.rows
    const dailyRows = day.rows
    // Totais reais do período (alcance/frequência corretos). Null = a consulta falhou e o front
    // cai em somar as campanhas, com alcance aproximado.
    const accountTotals = acct.rows[0] ? metrics(acct.rows[0]) : null

    // Status (ativo/pausado) + miniatura do criativo — lookup em lote, tolerante a falha.
    const [adObjs, campObjs] = await Promise.all([
      fetchObjects(adRows.map((r) => String(r.ad_id ?? '')), 'effective_status,creative{thumbnail_url}', token),
      fetchObjects(campRows.map((r) => String(r.campaign_id ?? '')), 'effective_status', token),
    ])

    const campaigns = campRows.map((row) => {
      const id = String(row.campaign_id ?? '')
      return {
        campaign_id: id,
        campaign: String(row.campaign_name ?? '(sem nome)'),
        objective: row.objective ? String(row.objective) : null,
        status: campObjs[id]?.effective_status ? String(campObjs[id].effective_status) : null,
        ...metrics(row),
      }
    })

    const ads = adRows.map((row) => {
      const id = String(row.ad_id ?? '')
      const obj = adObjs[id]
      const creative = (obj?.creative ?? null) as { thumbnail_url?: string } | null
      return {
        ad_id: id,
        ad: String(row.ad_name ?? '(sem nome)'),
        adset_id: String(row.adset_id ?? ''),
        adset: String(row.adset_name ?? ''),
        campaign_id: String(row.campaign_id ?? ''),
        campaign: String(row.campaign_name ?? ''),
        objective: row.objective ? String(row.objective) : null,
        optimization_goal: row.optimization_goal ? String(row.optimization_goal) : null,
        status: obj?.effective_status ? String(obj.effective_status) : null,
        thumbnail_url: creative?.thumbnail_url ?? null,
        ...metrics(row),
      }
    })

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
      const tr = encodeURIComponent(JSON.stringify({ since: prevSince, until: prevUntil }))
      const prev = await graphRows(`${base}?fields=${totalsFields}&time_range=${tr}&access_token=${token}`, 'previous')
      const row = prev.rows[0]
      previous = { ...slim(row ?? {}), since: prevSince, until: prevUntil }
    }

    // No link público, o cruzamento com pedidos do ERPOS (faturamento real) só vai
    // se quem gerou o link marcou a opção.
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
      count: campaigns.length,
      totals: accountTotals,
      campaigns,
      ads,
      daily,
      previous,
      breakdowns: { placement: byPlacement, age_gender: byAgeGender, hourly: byHour },
      erpos_orders: orders,
    })
  } catch (err) {
    console.error('[meta-ads-insights] Error:', err)
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

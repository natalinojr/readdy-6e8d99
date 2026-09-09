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

// Métricas comuns a campanha / anúncio / dia, a partir de uma linha do insights.
function metrics(row: Record<string, unknown>) {
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

// GET /?ids=a,b,c&fields=... em lotes de 50 (status e miniatura dos anúncios / status das campanhas).
// À prova de falha: se der erro, devolve o que conseguiu — o relatório sai sem status/miniatura.
async function fetchObjects(ids: string[], fields: string, token: string): Promise<Record<string, Record<string, unknown>>> {
  const out: Record<string, Record<string, unknown>> = {}
  const uniq = Array.from(new Set(ids.filter(Boolean)))
  for (let i = 0; i < uniq.length; i += 50) {
    const chunk = uniq.slice(i, i + 50)
    try {
      const resp = await fetch(`${GRAPH}/?ids=${chunk.join(',')}&fields=${fields}&access_token=${token}`)
      const body = await resp.json().catch(() => ({}))
      if (resp.ok && body && typeof body === 'object') {
        for (const [id, obj] of Object.entries(body as Record<string, Record<string, unknown>>)) out[id] = obj
      } else {
        console.warn('[meta-ads-insights] objects lookup failed:', resp.status, JSON.stringify(body).slice(0, 300))
      }
    } catch (e) {
      console.warn('[meta-ads-insights] objects lookup exception:', e)
    }
  }
  return out
}

// Pedidos REAIS do delivery do ERPOS no mesmo período, que chegaram por link com utm_source da Meta
// (instagram/facebook/fb/ig/meta...). Cruza a atribuição da Meta com o que entrou de fato no caixa.
async function erposOrdersFromMeta(
  admin: ReturnType<typeof createClient>, tenantId: string, since: string, until: string,
) {
  const { data, error } = await admin
    .from('orders')
    .select('total_amount, delivery_source, status')
    .eq('tenant_id', tenantId)
    .eq('origin_type', 'delivery')
    .in('delivery_platform', ['propria', 'retirada'])
    .eq('is_training', false)
    .not('delivery_source', 'is', null)
    .gte('created_at', `${since}T00:00:00-03:00`)
    .lte('created_at', `${until}T23:59:59-03:00`)
    .limit(5000)
  if (error) {
    console.warn('[meta-ads-insights] orders lookup error:', error.message)
    return null
  }
  const isMeta = (s: string) => /^(fb|ig|meta|face|insta)/.test(s)
  const bySource: Record<string, { count: number; revenue: number }> = {}
  let count = 0
  let revenue = 0
  for (const o of (data ?? []) as Array<{ total_amount: unknown; delivery_source: unknown; status: unknown }>) {
    const src = String(o.delivery_source ?? '').trim().toLowerCase()
    if (!src || !isMeta(src)) continue
    if (String(o.status ?? '').toLowerCase().includes('cancel')) continue
    const v = Number(o.total_amount ?? 0)
    count += 1
    revenue += v
    bySource[src] = bySource[src] ?? { count: 0, revenue: 0 }
    bySource[src].count += 1
    bySource[src].revenue += v
  }
  return { count, revenue, by_source: bySource, since, until }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const tenantId = body.tenant_id || body.active_tenant_id
    if (!tenantId) return json({ ok: false, error: 'tenant_id é obrigatório' }, 400)

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

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

    const requested = String(body.date_preset ?? 'last_7d')
    const datePreset = ALLOWED_DATE_PRESETS.has(requested) ? requested : 'last_7d'

    const common = [
      'spend', 'impressions', 'reach', 'frequency', 'clicks', 'inline_link_clicks',
      'cpc', 'ctr', 'cpm', 'actions', 'action_values',
    ]
    const campaignFields = ['campaign_id', 'campaign_name', 'objective', ...common].join(',')
    const adFields = [
      'campaign_id', 'campaign_name', 'adset_id', 'adset_name', 'ad_id', 'ad_name',
      'objective', 'optimization_goal', ...common,
    ].join(',')
    const dailyFields = ['spend', 'impressions', 'reach', 'clicks', 'inline_link_clicks', 'actions', 'action_values'].join(',')

    const base = `${GRAPH}/${conn.ad_account_id}/insights`
    const token = encodeURIComponent(conn.access_token)

    // Três consultas em paralelo:
    //  1) por campanha (tabela);  2) por anúncio (detalhe);  3) por dia (série pros gráficos).
    const campaignUrl =
      `${base}?level=campaign&fields=${campaignFields}&date_preset=${datePreset}&limit=200&access_token=${token}`
    const adUrl =
      `${base}?level=ad&fields=${adFields}&date_preset=${datePreset}&limit=500&access_token=${token}`
    const dailyUrl =
      `${base}?fields=${dailyFields}&date_preset=${datePreset}&time_increment=1&limit=500&access_token=${token}`

    const [campResp, adResp, dailyResp] = await Promise.all([fetch(campaignUrl), fetch(adUrl), fetch(dailyUrl)])
    const campBody = await campResp.json().catch(() => ({}))
    const adBody = await adResp.json().catch(() => ({}))
    const dailyBody = await dailyResp.json().catch(() => ({}))

    if (!campResp.ok) {
      console.error('[meta-ads-insights] Meta error:', campResp.status, campBody)
      return json({ ok: false, status: campResp.status, error: campBody?.error ?? campBody }, 502)
    }
    if (!adResp.ok) console.warn('[meta-ads-insights] ad-level error:', adResp.status, JSON.stringify(adBody).slice(0, 300))

    const campRows: Record<string, unknown>[] = Array.isArray(campBody.data) ? campBody.data : []
    const adRows: Record<string, unknown>[] = Array.isArray(adBody.data) ? adBody.data : []
    const dailyRows: Record<string, unknown>[] = Array.isArray(dailyBody.data) ? dailyBody.data : []

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

    // Período efetivo (a Meta devolve date_start/date_stop em toda linha): menor início, maior fim.
    const allRows = [...campRows, ...dailyRows]
    const starts = allRows.map((r) => String(r.date_start ?? '')).filter(Boolean).sort()
    const stops = allRows.map((r) => String(r.date_stop ?? '')).filter(Boolean).sort()
    const since = starts[0] ?? ''
    const until = stops[stops.length - 1] ?? ''
    const range = since && until ? { since, until } : null

    const erposOrders = range ? await erposOrdersFromMeta(admin, String(tenantId), since, until) : null

    return json({
      ok: true,
      date_preset: datePreset,
      range,
      ad_account_id: conn.ad_account_id,
      ad_account_name: conn.ad_account_name,
      count: campaigns.length,
      campaigns,
      ads,
      daily,
      erpos_orders: erposOrders,
    })
  } catch (err) {
    console.error('[meta-ads-insights] Error:', err)
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

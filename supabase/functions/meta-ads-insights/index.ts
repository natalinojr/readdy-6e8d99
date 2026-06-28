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

const ALLOWED_DATE_PRESETS = new Set([
  'today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d',
  'this_week_mon_today', 'last_week_mon_sun', 'this_month', 'last_month', 'maximum',
])

type MetaAction = { action_type?: string; value?: string }

function simplifyActions(actions: unknown): Array<{ type: string; value: number }> {
  if (!Array.isArray(actions)) return []
  return (actions as MetaAction[])
    .map((a) => ({ type: String(a.action_type ?? ''), value: Number(a.value ?? 0) }))
    .filter((a) => a.type && a.value > 0)
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

    const fields = [
      'campaign_name', 'spend', 'impressions', 'reach',
      'clicks', 'cpc', 'ctr', 'actions',
    ].join(',')

    const url =
      `https://graph.facebook.com/${GRAPH_VERSION}/${conn.ad_account_id}/insights` +
      `?level=campaign&fields=${fields}&date_preset=${datePreset}` +
      `&access_token=${encodeURIComponent(conn.access_token)}`

    const response = await fetch(url)
    const responseBody = await response.json().catch(() => ({}))

    if (!response.ok) {
      console.error('[meta-ads-insights] Meta error:', response.status, responseBody)
      return json(
        {
          ok: false,
          status: response.status,
          error: responseBody?.error ?? responseBody,
        },
        502,
      )
    }

    const rows = Array.isArray(responseBody.data) ? responseBody.data : []

    const campaigns = rows.map((row: Record<string, unknown>) => ({
      campaign: String(row.campaign_name ?? '(sem nome)'),
      spend: Number(row.spend ?? 0),
      impressions: Number(row.impressions ?? 0),
      reach: Number(row.reach ?? 0),
      clicks: Number(row.clicks ?? 0),
      cpc: Number(row.cpc ?? 0),
      ctr: Number(row.ctr ?? 0),
      results: simplifyActions(row.actions),
    }))

    return json({
      ok: true,
      date_preset: datePreset,
      ad_account_id: conn.ad_account_id,
      ad_account_name: conn.ad_account_name,
      count: campaigns.length,
      campaigns,
    })
  } catch (err) {
    console.error('[meta-ads-insights] Error:', err)
    return json({ ok: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

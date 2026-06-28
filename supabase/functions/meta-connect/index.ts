import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const GRAPH = 'https://graph.facebook.com/v20.0'

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function requiredEnv(name: string): string {
  const value = Deno.env.get(name)?.trim()
  if (!value) throw new Error(`Missing env var: ${name}`)
  return value
}

interface AdAccount { id: string; name: string }

function parseAccounts(raw: unknown): AdAccount[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map((a: Record<string, unknown>) => ({
      id: String(a.id ?? ''),
      name: String(a.name ?? a.id ?? ''),
    }))
    .filter((a) => a.id)
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const appId = requiredEnv('META_APP_ID')

    // ── config: o frontend pega o app_id (público) pra montar a URL de login ──
    if (action === 'config') {
      return json({ success: true, app_id: appId })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── status: estado da conexão da loja (NUNCA devolve o token) ──
    if (action === 'status') {
      const tenantId = body.tenant_id
      if (!tenantId) return json({ success: false, error: 'tenant_id é obrigatório' }, 400)

      const { data, error } = await admin
        .from('meta_ad_connections')
        .select('ad_account_id, ad_account_name, token_expires_at, available_accounts, connected_by_name, updated_at')
        .eq('tenant_id', tenantId)
        .maybeSingle()

      if (error) {
        console.error('[meta-connect] status error:', error)
        return json({ success: false, error: error.message }, 500)
      }
      return json({ success: true, connection: data ?? null })
    }

    // ── exchange: troca o code OAuth por token e guarda a conexão ──
    if (action === 'exchange') {
      const { tenant_id, code, redirect_uri, connected_by_user_id, connected_by_name } = body
      if (!tenant_id || !code || !redirect_uri) {
        return json({ success: false, error: 'tenant_id, code e redirect_uri são obrigatórios' }, 400)
      }
      const appSecret = requiredEnv('META_APP_SECRET')

      // 1) code → token de curta duração
      const shortUrl =
        `${GRAPH}/oauth/access_token?client_id=${appId}` +
        `&redirect_uri=${encodeURIComponent(redirect_uri)}` +
        `&client_secret=${appSecret}&code=${encodeURIComponent(code)}`
      const shortResp = await fetch(shortUrl)
      const shortBody = await shortResp.json().catch(() => ({}))
      if (!shortResp.ok || !shortBody.access_token) {
        console.error('[meta-connect] short token error:', shortResp.status, shortBody)
        return json({ success: false, error: shortBody?.error ?? 'Falha ao trocar o código de autorização' }, 502)
      }

      // 2) curta → longa duração (~60 dias)
      const longUrl =
        `${GRAPH}/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}` +
        `&client_secret=${appSecret}&fb_exchange_token=${shortBody.access_token}`
      const longResp = await fetch(longUrl)
      const longBody = await longResp.json().catch(() => ({}))

      const token = String(longBody.access_token ?? shortBody.access_token)
      const expiresIn = Number(longBody.expires_in ?? shortBody.expires_in ?? 0)
      const expiresAt = expiresIn > 0 ? new Date(Date.now() + expiresIn * 1000).toISOString() : null

      // 3) lista as contas de anúncios que esse token alcança
      const acctsUrl =
        `${GRAPH}/me/adaccounts?fields=account_id,name,account_status&limit=200` +
        `&access_token=${encodeURIComponent(token)}`
      const acctsResp = await fetch(acctsUrl)
      const acctsBody = await acctsResp.json().catch(() => ({}))
      const accounts = parseAccounts(acctsBody.data)
      const selected = accounts[0] ?? null

      // 4) salva a conexão (uma por loja)
      const { error } = await admin
        .from('meta_ad_connections')
        .upsert(
          {
            tenant_id,
            ad_account_id: selected?.id ?? null,
            ad_account_name: selected?.name ?? null,
            access_token: token,
            token_expires_at: expiresAt,
            available_accounts: accounts,
            connected_by_user_id: connected_by_user_id ?? null,
            connected_by_name: connected_by_name ?? null,
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'tenant_id' },
        )

      if (error) {
        console.error('[meta-connect] upsert error:', error)
        return json({ success: false, error: error.message }, 500)
      }

      return json({
        success: true,
        connection: {
          ad_account_id: selected?.id ?? null,
          ad_account_name: selected?.name ?? null,
          available_accounts: accounts,
          token_expires_at: expiresAt,
        },
      })
    }

    // ── select_account: troca qual conta de anúncios a loja acompanha ──
    if (action === 'select_account') {
      const { tenant_id, ad_account_id } = body
      if (!tenant_id || !ad_account_id) {
        return json({ success: false, error: 'tenant_id e ad_account_id são obrigatórios' }, 400)
      }
      const { data: conn } = await admin
        .from('meta_ad_connections')
        .select('available_accounts')
        .eq('tenant_id', tenant_id)
        .maybeSingle()

      const accounts = parseAccounts(conn?.available_accounts)
      const found = accounts.find((a) => a.id === ad_account_id)
      if (!found) return json({ success: false, error: 'Conta de anúncios não disponível nesta conexão' }, 400)

      const { error } = await admin
        .from('meta_ad_connections')
        .update({ ad_account_id: found.id, ad_account_name: found.name, updated_at: new Date().toISOString() })
        .eq('tenant_id', tenant_id)

      if (error) return json({ success: false, error: error.message }, 500)
      return json({ success: true })
    }

    // ── disconnect: remove a conexão da loja ──
    if (action === 'disconnect') {
      const { tenant_id } = body
      if (!tenant_id) return json({ success: false, error: 'tenant_id é obrigatório' }, 400)
      const { error } = await admin.from('meta_ad_connections').delete().eq('tenant_id', tenant_id)
      if (error) return json({ success: false, error: error.message }, 500)
      return json({ success: true })
    }

    return json({ success: false, error: `Ação inválida: ${action}` }, 400)
  } catch (err) {
    console.error('[meta-connect] Erro:', err)
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

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

const ALLOWED_DATE_PRESETS = new Set([
  'today', 'yesterday', 'last_3d', 'last_7d', 'last_14d', 'last_30d',
  'this_week_mon_today', 'last_week_mon_sun', 'this_month', 'last_month', 'maximum',
])
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Token do link público: 32 bytes aleatórios em hex (64 chars). Mesmo formato do
// claim_token do voucher, validado com /^[a-f0-9]{32,64}$/ na meta-ads-insights.
function newShareToken(): string {
  const b = new Uint8Array(32)
  crypto.getRandomValues(b)
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
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

// Sessão válida + usuário membro DESTA loja (admin quando `adminOnly`). A função roda com service
// role e é publicada sem verify_jwt no gateway, então a checagem tem que ser aqui — senão qualquer
// um com a anon key trocaria a conta ou desconectaria a Meta de qualquer tenant pelo tenant_id.
async function requireMember(
  req: Request, admin: ReturnType<typeof createClient>, tenantId: string, adminOnly = false,
) {
  const authHeader = req.headers.get('Authorization') || ''
  const token = authHeader.replace(/^Bearer\s+/i, '').trim()
  if (!token) return { error: json({ success: false, error: 'Não autenticado' }, 401) }
  const { data: userData, error: userErr } = await admin.auth.getUser(token)
  if (userErr || !userData?.user) return { error: json({ success: false, error: 'Sessão inválida' }, 401) }
  const { data: membership, error: memErr } = await admin
    .from('user_tenants')
    .select('role')
    .eq('user_id', userData.user.id)
    .eq('tenant_id', tenantId)
    .limit(1)
    .maybeSingle()
  if (memErr) return { error: json({ success: false, error: memErr.message }, 500) }
  if (!membership) return { error: json({ success: false, error: 'Sem acesso a esta loja' }, 403) }
  if (adminOnly && membership.role !== 'admin') {
    return { error: json({ success: false, error: 'Sem permissão de admin para esta loja' }, 403) }
  }
  return { error: null, userId: userData.user.id }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const action = String(body.action ?? '')
    const appId = requiredEnv('META_APP_ID')

    // ── config: o frontend pega o app_id + config_id (públicos) pra montar a URL de login ──
    if (action === 'config') {
      return json({
        success: true,
        app_id: appId,
        config_id: Deno.env.get('META_LOGIN_CONFIG_ID')?.trim() || null,
      })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // ── status: estado da conexão da loja (NUNCA devolve o token) ──
    if (action === 'status') {
      const tenantId = body.tenant_id
      if (!tenantId) return json({ success: false, error: 'tenant_id é obrigatório' }, 400)
      const auth = await requireMember(req, admin, String(tenantId))
      if (auth.error) return auth.error

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
        console.error('[meta-connect] exchange faltando campos:', { has_tenant: !!tenant_id, has_code: !!code, has_redirect: !!redirect_uri })
        return json({ success: false, error: 'tenant_id, code e redirect_uri são obrigatórios' }, 400)
      }
      const auth = await requireMember(req, admin, String(tenant_id))
      if (auth.error) return auth.error
      console.log('[meta-connect] exchange início | tenant:', tenant_id, '| redirect:', redirect_uri)
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
      console.log(
        '[meta-connect] adaccounts | status:', acctsResp.status,
        '| count:', accounts.length,
        '| raw:', JSON.stringify(acctsBody).slice(0, 600),
      )

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
            connected_by_user_id: auth.userId ?? connected_by_user_id ?? null,
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
      const auth = await requireMember(req, admin, String(tenant_id))
      if (auth.error) return auth.error
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
      const auth = await requireMember(req, admin, String(tenant_id), true)
      if (auth.error) return auth.error
      const { error } = await admin.from('meta_ad_connections').delete().eq('tenant_id', tenant_id)
      if (error) return json({ success: false, error: error.message }, 500)
      return json({ success: true })
    }

    // ── ad_preview: HTML (iframe) do anúncio como ele aparece no Feed/Stories/Reels ──
    // Sob demanda, um anúncio por vez: a Meta cobra rate limit e o HTML é pesado.
    if (action === 'ad_preview') {
      const { tenant_id, ad_id, ad_format } = body
      if (!tenant_id || !/^\d{5,30}$/.test(String(ad_id ?? ''))) {
        return json({ success: false, error: 'tenant_id e ad_id são obrigatórios' }, 400)
      }
      const auth = await requireMember(req, admin, String(tenant_id))
      if (auth.error) return auth.error

      const { data: conn } = await admin
        .from('meta_ad_connections')
        .select('access_token')
        .eq('tenant_id', tenant_id)
        .maybeSingle()
      if (!conn?.access_token) return json({ success: false, error: 'Loja não conectada à Meta' }, 200)

      const formats = new Set([
        'MOBILE_FEED_STANDARD', 'DESKTOP_FEED_STANDARD', 'INSTAGRAM_STANDARD',
        'INSTAGRAM_STORY', 'INSTAGRAM_REELS', 'FACEBOOK_STORY_MOBILE', 'FACEBOOK_REELS_MOBILE',
      ])
      const fmt = formats.has(String(ad_format)) ? String(ad_format) : 'MOBILE_FEED_STANDARD'
      const resp = await fetch(
        `${GRAPH}/${ad_id}/previews?ad_format=${fmt}&access_token=${encodeURIComponent(conn.access_token)}`,
      )
      const previewBody = await resp.json().catch(() => ({}))
      if (!resp.ok) {
        console.warn('[meta-connect] ad_preview error:', resp.status, JSON.stringify(previewBody).slice(0, 300))
        return json({ success: false, error: previewBody?.error?.message ?? 'A Meta não devolveu a prévia.' }, 200)
      }
      const html = Array.isArray(previewBody.data) && previewBody.data[0]?.body ? String(previewBody.data[0].body) : ''
      return json({ success: true, format: fmt, html })
    }

    // ── create_share: gera um link público SOMENTE LEITURA do relatório ──
    // Exige ADMIN da loja: o link abre uma porta sem login, então não fica a cargo
    // de qualquer usuário com acesso ao relatório.
    if (action === 'create_share') {
      const { tenant_id, date_preset, time_range, include_erpos_orders, label, expires_in_days } = body
      if (!tenant_id) return json({ success: false, error: 'tenant_id é obrigatório' }, 400)
      const auth = await requireMember(req, admin, String(tenant_id), true)
      if (auth.error) return auth.error

      // Período CONGELADO no link. Valida aqui pra não gravar algo que a Meta recusaria depois.
      let preset: string | null = null
      let since: string | null = null
      let until: string | null = null
      const tr = time_range as { since?: unknown; until?: unknown } | undefined
      if (tr && typeof tr === 'object' && ISO_DATE.test(String(tr.since ?? '')) && ISO_DATE.test(String(tr.until ?? ''))) {
        since = String(tr.since)
        until = String(tr.until)
        const span = (Date.parse(`${until}T00:00:00Z`) - Date.parse(`${since}T00:00:00Z`)) / 86400000
        if (!(span >= 0 && span <= 366)) {
          return json({ success: false, error: 'Período inválido (a data final deve ser depois da inicial, no máximo 366 dias).' }, 400)
        }
      } else {
        const p = String(date_preset ?? 'last_30d')
        if (!ALLOWED_DATE_PRESETS.has(p)) return json({ success: false, error: 'Período inválido.' }, 400)
        preset = p
      }

      const days = Math.min(Math.max(Number(expires_in_days ?? 30) || 30, 1), 365)
      const token = newShareToken()
      const { error } = await admin.from('trafego_pago_shares').insert({
        tenant_id,
        token,
        label: typeof label === 'string' && label.trim() ? label.trim().slice(0, 80) : null,
        date_preset: preset,
        range_since: since,
        range_until: until,
        include_erpos_orders: include_erpos_orders === true,
        created_by_user_id: auth.userId ?? null,
        created_by_name: typeof body.created_by_name === 'string' ? body.created_by_name.slice(0, 80) : null,
        expires_at: new Date(Date.now() + days * 86400000).toISOString(),
      })
      if (error) {
        console.error('[meta-connect] create_share error:', error)
        return json({ success: false, error: error.message }, 500)
      }
      return json({ success: true, token, expires_in_days: days })
    }

    // ── list_shares: links ativos da loja ──
    if (action === 'list_shares') {
      const { tenant_id } = body
      if (!tenant_id) return json({ success: false, error: 'tenant_id é obrigatório' }, 400)
      const auth = await requireMember(req, admin, String(tenant_id))
      if (auth.error) return auth.error

      const { data, error } = await admin
        .from('trafego_pago_shares')
        .select('id, token, label, date_preset, range_since, range_until, include_erpos_orders, created_at, created_by_name, expires_at, view_count, last_viewed_at')
        .eq('tenant_id', tenant_id)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })
        .limit(50)
      if (error) return json({ success: false, error: error.message }, 500)
      return json({ success: true, shares: data ?? [] })
    }

    // ── revoke_share: derruba um link na hora ──
    if (action === 'revoke_share') {
      const { tenant_id, id } = body
      if (!tenant_id || !id) return json({ success: false, error: 'tenant_id e id são obrigatórios' }, 400)
      const auth = await requireMember(req, admin, String(tenant_id), true)
      if (auth.error) return auth.error

      // Filtra por tenant_id também: admin de uma loja não revoga link de outra.
      const { error } = await admin
        .from('trafego_pago_shares')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .eq('tenant_id', tenant_id)
      if (error) return json({ success: false, error: error.message }, 500)
      return json({ success: true })
    }

    return json({ success: false, error: `Ação inválida: ${action}` }, 400)
  } catch (err) {
    console.error('[meta-connect] Erro:', err)
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500)
  }
})

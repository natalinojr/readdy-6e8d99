// ms-graph — conexão das Tarefas com OneDrive/SharePoint (Microsoft Graph).
// Ver BRIEFING-ONEDRIVE-TAREFAS.md. Publicada SEM verify_jwt: a sessão é conferida aqui.
// Ações: config · exchange · status · disconnect · browse
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import {
  authorizeUrl, exchangeCode, graphFetch, GraphError, idTokenClaims, MS_SCOPES, msConfig, MsReconnectError, tipoConta,
} from '../_shared/ms-graph.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// Só páginas do próprio ERPOS podem receber o código do login (o redirect também
// precisa estar cadastrado no app da Microsoft; isto é uma segunda trava).
function redirectPermitido(uri: string): boolean {
  try {
    const u = new URL(uri);
    if (u.pathname !== '/tarefas') return false;
    if (u.protocol === 'https:' && (u.hostname === 'erpos.vercel.app')) return true;
    return u.protocol === 'http:' && u.hostname === 'localhost';
  } catch {
    return false;
  }
}

// Ids da Graph: letras, números e ! , - _ . (ids de site vêm como "host,guid,guid").
const ID_OK = /^[A-Za-z0-9!,\-_.]{1,300}$/;

interface Item {
  id: string; name: string; tipo: 'pasta' | 'arquivo'; tamanho: number | null;
  filhos: number | null; web_url: string | null; alterado_em: string | null; alterado_por: string | null;
}

function mapItem(i: Record<string, any>): Item {
  return {
    id: i.id,
    name: i.name,
    tipo: i.folder ? 'pasta' : 'arquivo',
    tamanho: typeof i.size === 'number' ? i.size : null,
    filhos: i.folder?.childCount ?? null,
    web_url: i.webUrl ?? null,
    alterado_em: i.lastModifiedDateTime ?? null,
    alterado_por: i.lastModifiedBy?.user?.displayName ?? null,
  };
}

async function conexaoPessoal(admin: ReturnType<typeof createClient>, userId: string): Promise<boolean> {
  const { data } = await admin.from('ms_graph_connections').select('account_kind').eq('user_id', userId).maybeSingle();
  return data?.account_kind === 'pessoal';
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const admin = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  try {
    // ── Sessão + acesso ao módulo Tarefas (loja OU módulo liberado por pessoa) ──
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return json({ success: false, error: 'Não autenticado' }, 401);
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return json({ success: false, error: 'Sessão inválida' }, 401);
    const userId = u.user.id;
    const { count } = await admin.from('user_tenants').select('tenant_id', { count: 'exact', head: true }).eq('user_id', userId);
    if (!count) {
      const { data: tem } = await admin.rpc('fn_user_tem_tarefas', { p_user_id: userId });
      if (!tem) return json({ success: false, error: 'Sem acesso ao módulo Tarefas' }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action ?? '');
    const cfg = msConfig();

    // ── config: URL de login (o state vem da tela, que confere na volta) ──
    if (action === 'config') {
      if (!cfg.configured) return json({ success: false, error: 'Integração com a Microsoft ainda não configurada (falta registrar o app).' });
      const redirectUri = String(body.redirect_uri ?? '');
      const state = String(body.state ?? '');
      if (!redirectPermitido(redirectUri)) return json({ success: false, error: 'Endereço de retorno não permitido.' }, 400);
      if (!/^[a-z0-9]{16,64}$/.test(state)) return json({ success: false, error: 'state inválido' }, 400);
      return json({ success: true, url: authorizeUrl(redirectUri, state, tipoConta(body.tipo)) });
    }

    // ── status: conta conectada (NUNCA devolve token) ──
    if (action === 'status') {
      const { data } = await admin
        .from('ms_graph_connections')
        .select('ms_user_email, ms_user_name, account_kind, needs_reconnect, last_error, connected_at')
        .eq('user_id', userId)
        .maybeSingle();
      return json({ success: true, configured: cfg.configured, connection: data ?? null });
    }

    // ── exchange: código do login → tokens guardados ──
    if (action === 'exchange') {
      if (!cfg.configured) return json({ success: false, error: 'Integração com a Microsoft ainda não configurada.' });
      const code = String(body.code ?? '');
      const redirectUri = String(body.redirect_uri ?? '');
      if (!code || !redirectPermitido(redirectUri)) return json({ success: false, error: 'Dados do login inválidos.' }, 400);

      const tipo = tipoConta(body.tipo);
      const t = await exchangeCode(code, redirectUri, tipo);
      if (!t.access_token || !t.refresh_token) {
        console.error('[ms-graph] exchange falhou:', t.error, t.error_description?.slice(0, 300));
        return json({ success: false, error: t.error_description?.split('\r\n')[0] ?? 'A Microsoft não concluiu o login.' });
      }
      const claims = idTokenClaims(t.id_token);
      const me = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
        headers: { Authorization: `Bearer ${t.access_token}` },
      }).then((r) => r.json()).catch(() => ({}));

      const row = {
        user_id: userId,
        ms_tenant_id: claims.tid ?? null,
        ms_user_id: me.id ?? claims.oid ?? null,
        ms_user_email: me.mail ?? me.userPrincipalName ?? claims.preferred_username ?? null,
        ms_user_name: me.displayName ?? claims.name ?? null,
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        token_expires_at: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
        account_kind: tipo,
        scopes: t.scope ?? MS_SCOPES[tipo],
        needs_reconnect: false,
        last_error: null,
        connected_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      const { error } = await admin.from('ms_graph_connections').upsert(row, { onConflict: 'user_id' });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, connection: { ms_user_email: row.ms_user_email, ms_user_name: row.ms_user_name, account_kind: tipo, needs_reconnect: false } });
    }

    // ── disconnect: apaga os tokens (as pastas na nuvem ficam intactas) ──
    if (action === 'disconnect') {
      const { error } = await admin.from('ms_graph_connections').delete().eq('user_id', userId);
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true });
    }

    // ── browse: navegar na nuvem da conta conectada ──
    //   {}                       → "Meu OneDrive" + sites do SharePoint
    //   {site_id}                → bibliotecas do site
    //   {drive_id, item_id?}     → conteúdo da pasta (raiz se sem item_id)
    if (action === 'browse') {
      const siteId = body.site_id ? String(body.site_id) : null;
      const driveId = body.drive_id ? String(body.drive_id) : null;
      const itemId = body.item_id ? String(body.item_id) : null;
      for (const v of [siteId, driveId, itemId]) if (v && !ID_OK.test(v)) return json({ success: false, error: 'id inválido' }, 400);

      if (driveId) {
        const base = `/drives/${encodeURIComponent(driveId)}/items/${itemId ? encodeURIComponent(itemId) : 'root'}`;
        const sel = 'id,name,size,folder,file,webUrl,lastModifiedDateTime,lastModifiedBy,parentReference';
        const [pasta, filhos] = await Promise.all([
          graphFetch(admin, userId, `${base}?$select=${sel}`),
          graphFetch(admin, userId, `${base}/children?$select=${sel}&$top=500`),
        ]);
        const itens = (filhos?.value ?? []).map(mapItem)
          .sort((a: Item, b: Item) => (a.tipo === b.tipo ? a.name.localeCompare(b.name, 'pt-BR') : a.tipo === 'pasta' ? -1 : 1));
        return json({
          success: true,
          pasta: { ...mapItem(pasta), drive_id: driveId, parent_id: pasta?.parentReference?.id ?? null, raiz: !itemId || !pasta?.parentReference?.id },
          itens,
          mais: !!filhos?.['@odata.nextLink'],
        });
      }

      if (siteId) {
        const r = await graphFetch(admin, userId, `/sites/${encodeURIComponent(siteId)}/drives?$select=id,name,webUrl,driveType`);
        return json({ success: true, bibliotecas: (r?.value ?? []).map((d: any) => ({ id: d.id, name: d.name, web_url: d.webUrl })) });
      }

      const [meuDrive, sites] = await Promise.all([
        graphFetch(admin, userId, '/me/drive?$select=id,name,webUrl,quota').catch(() => null),
        // Conta pessoal não tem SharePoint: a busca de sites nem é tentada.
        conexaoPessoal(admin, userId).then((pessoal) => pessoal ? { value: [] }
          : graphFetch(admin, userId, '/sites?search=*&$select=id,displayName,webUrl&$top=100').catch(() => ({ value: [] }))),
      ]);
      return json({
        success: true,
        meu_drive: meuDrive ? {
          id: meuDrive.id, name: 'Meu OneDrive', web_url: meuDrive.webUrl,
          usado: meuDrive.quota?.used ?? null, total: meuDrive.quota?.total ?? null,
        } : null,
        sites: (sites?.value ?? [])
          .map((s: any) => ({ id: s.id, name: s.displayName, web_url: s.webUrl }))
          .sort((a: any, b: any) => String(a.name).localeCompare(String(b.name), 'pt-BR')),
      });
    }

    return json({ success: false, error: `Ação inválida: ${action}` }, 400);
  } catch (err) {
    if (err instanceof MsReconnectError) return json({ success: false, reconectar: true, error: err.message });
    if (err instanceof GraphError) {
      console.warn('[ms-graph] Graph', err.status, err.code, err.message);
      const msg = err.status === 404 ? 'Pasta não encontrada (pode ter sido apagada ou movida).'
        : err.status === 403 ? 'A conta conectada não tem acesso a isso.'
        : err.message;
      return json({ success: false, error: msg });
    }
    console.error('[ms-graph] erro:', err);
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

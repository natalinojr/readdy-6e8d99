// send-push — assinaturas e envio de notificações push (ver ESTUDO-TAREFAS-MOBILE.md).
//
// Ações:
//   public_key  (sem auth)      → chave VAPID pública, para o navegador se inscrever
//   subscribe   (JWT do user)   → grava a assinatura deste aparelho
//   unsubscribe (JWT do user)   → remove a assinatura deste aparelho
//   test        (JWT do user)   → envia um push de teste para o próprio usuário
//   send        (service role)  → envia para uma lista de usuários (usado pelo task-write)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { enviarPush, type Subscription } from './webpush.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const vapid = {
    publicKey: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
    privateKey: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
    subject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  };

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'corpo inválido' }, 400);
  }
  const action = String(body.action ?? '');

  // A chave pública é pública por definição — não exige autenticação.
  if (action === 'public_key') {
    if (!vapid.publicKey) return json({ error: 'VAPID não configurado' }, 500);
    return json({ success: true, public_key: vapid.publicKey });
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  const bearer = authHeader.replace(/^Bearer\s+/i, '');

  /** Busca as assinaturas e dispara, limpando as que morreram. */
  const despachar = async (
    userIds: string[],
    tenantId: string | null,
    payload: Record<string, unknown>,
  ) => {
    let q = admin.from('push_subscriptions').select('*').in('user_id', userIds);
    if (tenantId) q = q.eq('tenant_id', tenantId);
    const { data: subs, error } = await q;
    if (error) return { enviados: 0, falhas: 0, erro: error.message };
    if (!subs?.length) return { enviados: 0, falhas: 0 };

    const texto = JSON.stringify(payload);
    let enviados = 0;
    let falhas = 0;
    const expiradas: string[] = [];

    await Promise.all(
      subs.map(async (s: Record<string, unknown>) => {
        const sub: Subscription = {
          endpoint: s.endpoint as string,
          p256dh: s.p256dh as string,
          auth: s.auth as string,
        };
        const r = await enviarPush(sub, texto, vapid);
        if (r.ok) {
          enviados++;
          await admin.from('push_subscriptions')
            .update({ last_success_at: new Date().toISOString(), failure_count: 0 })
            .eq('id', s.id as string);
        } else {
          falhas++;
          console.error('[send-push] falha', r.status, r.erro);
          if (r.expirada) {
            // Aparelho desinstalou/limpou dados: a assinatura não volta mais.
            expiradas.push(s.id as string);
          } else {
            await admin.from('push_subscriptions')
              .update({ failure_count: ((s.failure_count as number) ?? 0) + 1 })
              .eq('id', s.id as string);
          }
        }
      }),
    );

    if (expiradas.length) {
      await admin.from('push_subscriptions').delete().in('id', expiradas);
    }
    return { enviados, falhas, removidas: expiradas.length };
  };

  // ── Chamada interna (task-write) com a service role ──
  if (action === 'send') {
    if (!serviceRoleKey || bearer !== serviceRoleKey) return json({ error: 'unauthorized' }, 401);
    const userIds = (body.user_ids as string[]) ?? [];
    if (!userIds.length) return json({ success: true, enviados: 0 });
    const r = await despachar(userIds, (body.tenant_id as string) ?? null, (body.payload as Record<string, unknown>) ?? {});
    return json({ success: true, ...r });
  }

  // ── Demais ações: usuário autenticado ──
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user }, error: userError } = await userClient.auth.getUser();
  if (userError || !user) return json({ error: 'Unauthorized' }, 401);

  // Confirma a loja pela membership — nunca confia no corpo da requisição
  const { data: tenantRows } = await admin
    .from('user_tenants').select('tenant_id').eq('user_id', user.id);
  if (!tenantRows?.length) return json({ error: 'sem loja vinculada' }, 403);
  const pedido = body.active_tenant_id as string | undefined;
  const tenantId = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === pedido)?.tenant_id
    ?? tenantRows[0].tenant_id;

  switch (action) {
    case 'subscribe': {
      const sub = body.subscription as { endpoint?: string; keys?: { p256dh?: string; auth?: string } } | undefined;
      if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
        return json({ error: 'assinatura inválida' }, 400);
      }
      // endpoint é único: reinscrever o mesmo aparelho atualiza a linha
      const { error } = await admin.from('push_subscriptions').upsert({
        tenant_id: tenantId,
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
        failure_count: 0,
      }, { onConflict: 'endpoint' });
      if (error) return json({ error: error.message }, 500);
      return json({ success: true });
    }

    case 'unsubscribe': {
      const endpoint = body.endpoint as string | undefined;
      if (!endpoint) return json({ error: 'endpoint é obrigatório' }, 400);
      await admin.from('push_subscriptions').delete()
        .eq('endpoint', endpoint).eq('user_id', user.id);
      return json({ success: true });
    }

    case 'test': {
      const r = await despachar([user.id], tenantId, {
        titulo: 'Notificações ativadas',
        corpo: 'É assim que os avisos das suas tarefas vão aparecer.',
        url: '/tarefas',
      });
      return json({ success: true, ...r });
    }

    default:
      return json({ error: `ação desconhecida: ${action}` }, 400);
  }
});

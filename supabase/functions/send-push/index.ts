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
// App Android (Capacitor): aparelho inscrito com endpoint "fcm:<token>" recebe pelo Firebase.
import { enviarFcm, fcmConfig } from './fcm.ts';
// Aprovar/Recusar pelo aviso (2026-10-05): token assinado por pessoa+pedido, decidido na Edge acao-push.
import { assinarAcao, chaveDaAcao, TIPOS_PDV_PELO_AVISO } from '../_shared/push-acao.ts';

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
  // App Android: só oferece a notificação nativa quando o Firebase já está configurado
  // (sem google-services.json no APK + FIREBASE_SERVICE_ACCOUNT aqui, o registro falharia).
  if (action === 'fcm_status') {
    return json({ success: true, configured: !!fcmConfig() });
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
        const r = sub.endpoint.startsWith('fcm:')
          // App Android (FCM) não tem botões na notificação: sem `acoes` (os dados viram texto no FCM).
          ? await enviarFcm(sub.endpoint.slice(4), Object.fromEntries(Object.entries(payload).filter(([k]) => k !== 'acoes' && k !== 'acao_url')))
          : await enviarPush(sub, texto, vapid);
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
  // Sem loja: quem só tem acesso a um módulo sem loja (Contratação, Tarefas pelo Admin Master)
  // também recebe aviso — a assinatura fica com tenant_id nulo (2026-09-16). Antes respondia
  // "sem loja vinculada" e o entrevistador que não trabalha em loja nunca era avisado.
  let tenantId: string | null = null;
  if (tenantRows?.length) {
    const pedido = body.active_tenant_id as string | undefined;
    tenantId = tenantRows.find((r: { tenant_id: string }) => r.tenant_id === pedido)?.tenant_id
      ?? tenantRows[0].tenant_id;
  } else {
    const { data: modulos } = await admin.from('user_module_access').select('module').eq('user_id', user.id).limit(1);
    if (!modulos?.length) return json({ error: 'sem loja nem módulo liberado' }, 403);
  }

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

    // Caixa pediu aprovação (desconto/cancelamento) no PDV (2026-10-03, tela Hoje): avisa no celular
    // quem aprova NAQUELA loja — antes só apitava para quem estava com o app aberto. Vai para a
    // supervisão e o gerente; o admin só recebe se nenhum deles tem o aviso ligado no aparelho.
    // Quem chama precisa ser quem pediu, da loja do pedido, e só vale para pedido pendente de até 2 minutos.
    case 'aprovacao_pdv': {
      const id = String(body.approval_id ?? '');
      if (!id) return json({ error: 'approval_id é obrigatório' }, 400);
      const { data: req } = await admin.from('pdv_approval_requests')
        .select('id, tenant_id, tipo, status, payload, requested_by, requested_by_name, created_at').eq('id', id).maybeSingle();
      if (!req) return json({ error: 'pedido não encontrado' }, 404);
      if (!(tenantRows ?? []).some((r: { tenant_id: string }) => r.tenant_id === req.tenant_id)) return json({ error: 'sem acesso' }, 403);
      // Só quem fez o pedido avisa, e uma vez (logo depois de pedir) — ninguém repete o toque nos gerentes.
      if (req.requested_by && req.requested_by !== user.id) return json({ error: 'sem acesso' }, 403);
      if (req.status !== 'pendente' || Date.now() - Date.parse(String(req.created_at)) > 2 * 60_000) {
        return json({ success: true, enviados: 0, motivo: 'pedido já decidido ou antigo' });
      }
      const { data: equipe } = await admin.from('user_tenants').select('user_id, role')
        .eq('tenant_id', req.tenant_id).in('role', ['admin', 'manager', 'supervisor']);
      const membros = ((equipe ?? []) as Array<{ user_id: string; role: string }>).filter((m) => m.user_id !== user.id);
      const perto = membros.filter((m) => m.role !== 'admin').map((m) => m.user_id);
      const { data: comAviso } = perto.length
        ? await admin.from('push_subscriptions').select('user_id').in('user_id', perto).limit(1)
        : { data: [] as Array<{ user_id: string }> };
      const destino = comAviso?.length ? perto : membros.map((m) => m.user_id);
      if (!destino.length) return json({ success: true, enviados: 0 });
      // O texto é o mesmo do cartão da Hoje (pendência 'aprovacao' criada pelo gatilho do pedido).
      const { data: pend } = await admin.from('pendencias').select('titulo').eq('kind', 'aprovacao').eq('ref', id).maybeSingle();
      const p = (req.payload ?? {}) as Record<string, unknown>;
      const tipo = req.tipo === 'cancelamento' ? 'Cancelamento' : req.tipo === 'desconto' ? 'Desconto' : 'Problema no item';
      const corpo = String(pend?.titulo ?? `${tipo}: ${String(p.itemNome ?? p.mesaNome ?? '')} — ${String(req.requested_by_name ?? 'caixa')} pede aprovação`);
      const base = { titulo: 'Pedido de aprovação no caixa', corpo: corpo.slice(0, 200), url: '/hoje', tag: `aprovacao-${id}` };
      // Desconto e cancelamento: botões Aprovar/Recusar no próprio aviso. O token é PESSOAL (um por destinatário,
      // 15 min) — quem não pôde ser assinado (sem segredo) recebe o aviso comum, que abre o app.
      let chave: CryptoKey | null = null;
      if (TIPOS_PDV_PELO_AVISO.includes(String(req.tipo))) {
        try { chave = await chaveDaAcao(Deno.env.get('PUSH_ACAO_SECRET') || serviceRoleKey); } catch { chave = null; }
      }
      const parciais = await Promise.all(destino.map(async (uid) => {
        if (!chave) return despachar([uid], null, base);
        const [aprovar, recusar] = await Promise.all([
          assinarAcao({ k: 'pdv', id, u: uid, a: 'aprovar' }, chave),
          assinarAcao({ k: 'pdv', id, u: uid, a: 'recusar' }, chave),
        ]);
        return despachar([uid], null, {
          ...base, requireInteraction: true,
          // Destinatário: o service worker só mostra os botões se quem está logado no aparelho é esta pessoa
          // (tablet compartilhado em que outra pessoa ativou os avisos e saiu → aviso sem botões).
          para: uid,
          acao_url: `${supabaseUrl}/functions/v1/acao-push`,
          acoes: [{ id: 'aprovar', titulo: 'Aprovar', token: aprovar }, { id: 'recusar', titulo: 'Recusar', token: recusar }],
        });
      }));
      const r = parciais.reduce((t, x) => ({ enviados: t.enviados + (x.enviados ?? 0), falhas: t.falhas + (x.falhas ?? 0) }), { enviados: 0, falhas: 0 });
      return json({ success: true, ...r });
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

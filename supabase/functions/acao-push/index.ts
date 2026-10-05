// acao-push — decide pedido do PDV (desconto/cancelamento) pelo botão "Aprovar"/"Recusar" do aviso no
// celular (2026-10-05). Quem chama é o service worker do aparelho, SEM sessão: a credencial é o token
// assinado que o send-push pôs no payload cifrado do push (_shared/push-acao.ts) — ele diz quem é a
// pessoa, qual pedido e qual decisão, e vale 15 min. verify_jwt = false (o SW não tem JWT).
//
// O que NÃO passa por aqui: pedido de pagamento do /receber (precisa de classificação, valor, motivo da
// recusa e, no Pix para chave/fornecedor novo, do PIN no app) e "problema no item". O toque abre o app.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { chaveDaAcao, verificarAcao, avaliarDecisaoPdv } from '../_shared/push-acao.ts';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
// Sempre 200 com { ok, codigo, mensagem }: o service worker mostra a mensagem na notificação.
const resp = (corpo: { ok: boolean; codigo?: string; mensagem: string }, status = 200) =>
  new Response(JSON.stringify(corpo), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve({ verify_jwt: false }, async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (req.method !== 'POST') return resp({ ok: false, codigo: 'metodo', mensagem: 'Método inválido' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const segredo = Deno.env.get('PUSH_ACAO_SECRET') || service;
  if (!supabaseUrl || !service) return resp({ ok: false, codigo: 'config', mensagem: 'Servidor mal configurado' }, 500);

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return resp({ ok: false, codigo: 'invalido', mensagem: 'Pedido inválido' }, 400); }

  const t = await verificarAcao(body.token, await chaveDaAcao(segredo));
  if (!t.ok) {
    return resp({
      ok: false, codigo: t.motivo,
      mensagem: t.motivo === 'expirado' ? 'O aviso expirou (15 min). Abra o app para decidir.' : 'Aviso inválido. Abra o app para decidir.',
    }, t.motivo === 'expirado' ? 410 : 401);
  }
  const { id, u: userId, a: acao } = t.carga;

  const admin = createClient(supabaseUrl, service, { auth: { autoRefreshToken: false, persistSession: false } });
  try {
    const { data: pedido } = await admin.from('pdv_approval_requests')
      .select('id, tenant_id, tipo, status, requested_by, resolved_by_name').eq('id', id).maybeSingle();
    if (!pedido) return resp({ ok: false, codigo: 'nao_achei', mensagem: 'Pedido não encontrado.' }, 404);

    // O papel é conferido AGORA (a pessoa pode ter saído da loja ou mudado de cargo depois do aviso).
    const [{ data: vinc }, { data: usuario }] = await Promise.all([
      admin.from('user_tenants').select('role').eq('user_id', userId).eq('tenant_id', pedido.tenant_id).maybeSingle(),
      admin.from('users').select('name, is_active, deleted_at').eq('id', userId).maybeSingle(),
    ]);
    const ativo = !!usuario && usuario.is_active !== false && !usuario.deleted_at;
    const av = avaliarDecisaoPdv({ pedido, userId, papel: ativo && vinc?.role ? String(vinc.role) : null });
    if (!av.ok) return resp({ ok: false, codigo: av.codigo, mensagem: av.mensagem }, av.codigo === 'sem_acesso' ? 403 : 200);

    // Decide só se continua pendente (o .eq garante que duas decisões juntas não passam as duas).
    const nome = String(usuario?.name ?? '').trim() || 'Supervisor';
    const { data: upd, error } = await admin.from('pdv_approval_requests').update({
      status: acao === 'aprovar' ? 'aprovado' : 'rejeitado',
      resolved_by: userId, resolved_by_name: nome, resolved_at: new Date().toISOString(),
    }).eq('id', id).eq('status', 'pendente').select('id');
    if (error) throw new Error(error.message);
    if (!upd?.length) return resp({ ok: false, codigo: 'ja_decidido', mensagem: 'Outra pessoa decidiu primeiro.' });

    return resp({ ok: true, mensagem: acao === 'aprovar' ? 'Aprovado.' : 'Recusado.' });
  } catch (e) {
    console.error('[acao-push]', e instanceof Error ? e.message : e);
    return resp({ ok: false, codigo: 'erro', mensagem: 'Não consegui decidir. Abra o app.' }, 500);
  }
});

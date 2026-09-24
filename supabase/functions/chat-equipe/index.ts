// chat-equipe — conversa entre pessoas da mesma loja, dentro do chat do ERPOS (dono, 2026-09-23).
// Tabelas: chat_threads / chat_participants / chat_messages (migração 20260923200000_chat_equipe).
// O front lê as mensagens novas pelo Realtime (RLS por participante); tudo que GRAVA passa aqui.
//
// Ações (POST JSON, JWT do usuário):
//   colegas   { tenant_id }                 → pessoas da loja (sem você e sem login de tablet)
//   abrir     { tenant_id, user_id }        → conversa com essa pessoa (cria se não existir)
//   conversas {}                            → suas conversas: a outra pessoa, última mensagem, não lidas
//                                             (e marca como ENTREGUE o que os outros mandaram)
//   mensagens { thread_id, before_id? | after_id? | around_id? } → 60 por vez, da mais antiga para a
//                                             mais nova; around_id = a janela em volta de uma mensagem
//                                             (resultado da pesquisa), has_newer = tem mais novas depois
//   buscar    { thread_id, q }              → até 50 mensagens da conversa com esse texto (mais novas primeiro)
//   enviar    { thread_id, text, client_id, reply_to? } → grava e avisa no celular de quem recebe
//   lido      { thread_id, id }             → marca lido até esse id
//
// Vistos como no WhatsApp (2026-09-24): ✓ gravada · ✓✓ cinza entregue (o app da pessoa buscou) ·
// ✓✓ azul lida. reply_to = id da mensagem respondida (mesma conversa); a citação volta em `resposta`.
//
// Uma conversa por PAR de pessoas EM CADA LOJA (tenant_id + direct_key, 2026-09-24): quem trabalha
// junto na Vila e em Paranaguá tem duas conversas, uma por loja — antes era uma só e misturava.
// Só dá para começar com quem é da loja, e só na loja onde os dois estão.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const fail = (msg: string, status = 400) => json({ success: false, error: msg }, status);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'chat-equipe', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Login de tablet/totem é aparelho, não pessoa: fica fora da lista.
const PAPEIS_FORA = ['tablet'];

type Pessoa = { id: string; nome: string; foto: string | null };
const nomeDe = (u: { name?: string | null; nickname?: string | null } | null | undefined) =>
  String(u?.nickname || u?.name || 'Sem nome');

async function lojasDe(admin: SupabaseClient, userId: string): Promise<string[]> {
  const { data } = await admin.from('user_tenants').select('tenant_id').eq('user_id', userId);
  return (data ?? []).map((r) => String(r.tenant_id));
}

async function pessoas(admin: SupabaseClient, ids: string[]): Promise<Map<string, Pessoa>> {
  const m = new Map<string, Pessoa>();
  if (!ids.length) return m;
  const { data } = await admin.from('users').select('id, name, nickname, photo_url').in('id', ids);
  for (const u of data ?? []) m.set(String(u.id), { id: String(u.id), nome: nomeDe(u), foto: u.photo_url ?? null });
  return m;
}

async function participa(admin: SupabaseClient, threadId: string, userId: string) {
  const { data } = await admin.from('chat_participants').select('last_read_id, last_delivered_id')
    .eq('thread_id', threadId).eq('user_id', userId).maybeSingle();
  return data;
}

const CAMPOS_MSG = 'id, sender_id, body, created_at, reply_to_id';
// Citação da mensagem respondida (quem mandou e o começo do texto), numa consulta só.
// deno-lint-ignore no-explicit-any
async function comCitacao(admin: SupabaseClient, msgs: any[]) {
  const ids = [...new Set(msgs.map((m) => m.reply_to_id).filter(Boolean).map(Number))];
  if (!ids.length) return msgs.map((m) => ({ ...m, resposta: null }));
  const { data } = await admin.from('chat_messages').select('id, sender_id, body').in('id', ids);
  const por = new Map((data ?? []).map((r) => [Number(r.id), { id: Number(r.id), sender_id: String(r.sender_id), body: String(r.body).slice(0, 200) }]));
  return msgs.map((m) => ({ ...m, resposta: m.reply_to_id ? (por.get(Number(m.reply_to_id)) ?? null) : null }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return fail('Unauthorized', 401);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { return fail('JSON inválido'); }
  const action = String(body.action ?? '');
  const eu = user.id;

  try {
    if (action === 'colegas') {
      const tenantId = String(body.tenant_id ?? '');
      if (!UUID.test(tenantId)) return fail('Loja não informada.');
      if (!(await lojasDe(admin, eu)).includes(tenantId)) return fail('Sem acesso a essa loja.', 403);
      const { data, error } = await admin.from('user_tenants').select('user_id, role, users(id, name, nickname, photo_url, is_active, deleted_at)')
        .eq('tenant_id', tenantId).neq('user_id', eu);
      if (error) throw new Error(error.message);
      const lista = (data ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((r: any) => r.users && !r.users.deleted_at && r.users.is_active !== false && !PAPEIS_FORA.includes(String(r.role)))
        // deno-lint-ignore no-explicit-any
        .map((r: any) => ({ id: String(r.user_id), nome: nomeDe(r.users), foto: r.users.photo_url ?? null, papel: String(r.role) }))
        .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
      return json({ success: true, data: { colegas: lista } });
    }

    if (action === 'abrir') {
      const tenantId = String(body.tenant_id ?? '');
      const outro = String(body.user_id ?? '');
      if (!UUID.test(tenantId) || !UUID.test(outro) || outro === eu) return fail('Pessoa inválida.');
      if (!(await lojasDe(admin, eu)).includes(tenantId)) return fail('Sem acesso a essa loja.', 403);
      if (!(await lojasDe(admin, outro)).includes(tenantId)) return fail('Essa pessoa não é da loja.', 403);
      const chave = [eu, outro].sort().join(':');
      let { data: t } = await admin.from('chat_threads').select('id').eq('tenant_id', tenantId).eq('direct_key', chave).maybeSingle();
      if (!t) {
        const ins = await admin.from('chat_threads').insert({ tenant_id: tenantId, kind: 'direct', direct_key: chave, created_by: eu })
          .select('id').single();
        if (ins.error) {
          // Os dois abriram ao mesmo tempo: a outra chamada criou primeiro.
          const again = await admin.from('chat_threads').select('id').eq('tenant_id', tenantId).eq('direct_key', chave).maybeSingle();
          if (!again.data) throw new Error(ins.error.message);
          t = again.data;
        } else {
          t = ins.data;
          const p = await admin.from('chat_participants').insert([{ thread_id: t.id, user_id: eu }, { thread_id: t.id, user_id: outro }]);
          if (p.error) throw new Error(p.error.message);
        }
      }
      const gente = await pessoas(admin, [outro]);
      return json({ success: true, data: { thread_id: String(t!.id), pessoa: gente.get(outro) ?? { id: outro, nome: 'Sem nome', foto: null } } });
    }

    if (action === 'conversas') {
      // O app buscou a lista: o que os outros mandaram chegou no aparelho (✓✓ cinza para eles).
      await admin.rpc('fn_chat_marcar_entregue', { p_user: eu });
      const { data: minhas, error } = await admin.from('chat_participants').select('thread_id, last_read_id').eq('user_id', eu);
      if (error) throw new Error(error.message);
      const ids = (minhas ?? []).map((m) => String(m.thread_id));
      if (!ids.length) return json({ success: true, data: { conversas: [], nao_lidas: 0 } });
      const [threads, outros] = await Promise.all([
        admin.from('chat_threads').select('id, tenant_id, last_message_at, created_at, tenants(name)').in('id', ids),
        admin.from('chat_participants').select('thread_id, user_id, last_read_id, last_delivered_id').in('thread_id', ids).neq('user_id', eu),
      ]);
      const gente = await pessoas(admin, [...new Set((outros.data ?? []).map((o) => String(o.user_id)))]);
      const lidoPorMim = new Map((minhas ?? []).map((m) => [String(m.thread_id), Number(m.last_read_id)]));
      const conversas = await Promise.all((threads.data ?? []).map(async (t) => {
        const tid = String(t.id);
        const [ult, novas] = await Promise.all([
          admin.from('chat_messages').select('id, sender_id, body, created_at').eq('thread_id', tid).order('id', { ascending: false }).limit(1),
          admin.from('chat_messages').select('id', { count: 'exact', head: true }).eq('thread_id', tid)
            .neq('sender_id', eu).gt('id', lidoPorMim.get(tid) ?? 0),
        ]);
        const o = (outros.data ?? []).find((x) => String(x.thread_id) === tid);
        const u = (ult.data ?? [])[0];
        return {
          thread_id: tid,
          tenant_id: String(t.tenant_id),
          // deno-lint-ignore no-explicit-any
          loja: String((t as any).tenants?.name ?? ''),
          pessoa: o ? (gente.get(String(o.user_id)) ?? { id: String(o.user_id), nome: 'Sem nome', foto: null }) : null,
          // Até onde a outra pessoa leu: o "✓✓" das suas mensagens.
          lido_pelo_outro: o ? Number(o.last_read_id) : 0,
          entregue_ao_outro: o ? Math.max(Number(o.last_delivered_id), Number(o.last_read_id)) : 0,
          nao_lidas: novas.count ?? 0,
          ultima: u ? { id: Number(u.id), minha: String(u.sender_id) === eu, texto: String(u.body).slice(0, 140), created_at: u.created_at } : null,
          quando: String(t.last_message_at ?? t.created_at),
        };
      }));
      conversas.sort((a, b) => b.quando.localeCompare(a.quando));
      return json({ success: true, data: { conversas, nao_lidas: conversas.reduce((s, c) => s + c.nao_lidas, 0) } });
    }

    if (action === 'mensagens') {
      const tid = String(body.thread_id ?? '');
      if (!UUID.test(tid) || !(await participa(admin, tid, eu))) return fail('Conversa não encontrada.', 404);
      // deno-lint-ignore no-explicit-any
      let data: any[] = [];
      let hasMore = false;
      let hasNewer = false;
      if (body.around_id) {
        // Pesquisa (2026-09-24): 30 antes (com ela) e 30 depois da mensagem encontrada.
        const id = Number(body.around_id);
        const [antes, depois] = await Promise.all([
          admin.from('chat_messages').select(CAMPOS_MSG).eq('thread_id', tid).lte('id', id).order('id', { ascending: false }).limit(30),
          admin.from('chat_messages').select(CAMPOS_MSG).eq('thread_id', tid).gt('id', id).order('id', { ascending: true }).limit(30),
        ]);
        if (antes.error || depois.error) throw new Error((antes.error ?? depois.error)!.message);
        data = [...(antes.data ?? []).reverse(), ...(depois.data ?? [])];
        hasMore = (antes.data ?? []).length === 30;
        hasNewer = (depois.data ?? []).length === 30;
      } else if (body.after_id) {
        const r = await admin.from('chat_messages').select(CAMPOS_MSG).eq('thread_id', tid).gt('id', Number(body.after_id))
          .order('id', { ascending: true }).limit(60);
        if (r.error) throw new Error(r.error.message);
        data = r.data ?? [];
        hasNewer = data.length === 60;
      } else {
        let q = admin.from('chat_messages').select(CAMPOS_MSG).eq('thread_id', tid);
        if (body.before_id) q = q.lt('id', Number(body.before_id));
        const r = await q.order('id', { ascending: false }).limit(60);
        if (r.error) throw new Error(r.error.message);
        data = (r.data ?? []).reverse();
        hasMore = data.length === 60;
      }
      await admin.rpc('fn_chat_marcar_entregue', { p_user: eu });
      const { data: o } = await admin.from('chat_participants').select('last_read_id, last_delivered_id').eq('thread_id', tid).neq('user_id', eu).limit(1);
      const lido = Number(o?.[0]?.last_read_id ?? 0);
      return json({ success: true, data: {
        mensagens: await comCitacao(admin, data),
        has_more: hasMore,
        has_newer: hasNewer,
        lido_pelo_outro: lido,
        entregue_ao_outro: Math.max(lido, Number(o?.[0]?.last_delivered_id ?? 0)),
      } });
    }

    if (action === 'buscar') {
      const tid = String(body.thread_id ?? '');
      const termo = String(body.q ?? '').trim().slice(0, 100);
      if (termo.length < 2) return json({ success: true, data: { resultados: [] } });
      if (!UUID.test(tid) || !(await participa(admin, tid, eu))) return fail('Conversa não encontrada.', 404);
      // Sem acento e sem maiúscula, % e _ como texto: fn_chat_buscar (unaccent).
      const { data, error } = await admin.rpc('fn_chat_buscar', { p_thread: tid, p_q: termo });
      if (error) throw new Error(error.message);
      return json({ success: true, data: { resultados: data ?? [] } });
    }

    if (action === 'enviar') {
      const tid = String(body.thread_id ?? '');
      const texto = String(body.text ?? '').trim().slice(0, 4000);
      const clientId = UUID.test(String(body.client_id ?? '')) ? String(body.client_id) : null;
      if (!texto) return fail('Mensagem vazia.');
      if (!UUID.test(tid) || !(await participa(admin, tid, eu))) return fail('Conversa não encontrada.', 404);
      // Resposta a uma mensagem: só da mesma conversa.
      let replyTo: number | null = null;
      if (body.reply_to) {
        const { data: orig } = await admin.from('chat_messages').select('id').eq('id', Number(body.reply_to)).eq('thread_id', tid).maybeSingle();
        if (!orig) return fail('A mensagem respondida não é desta conversa.');
        replyTo = Number(orig.id);
      }
      // Reenvio (rede caiu depois de gravar): devolve a que já está lá, sem duplicar nem avisar de novo.
      if (clientId) {
        const { data: ja } = await admin.from('chat_messages').select(CAMPOS_MSG).eq('thread_id', tid).eq('client_id', clientId).maybeSingle();
        if (ja) return json({ success: true, data: { mensagem: (await comCitacao(admin, [ja]))[0] } });
      }
      const { data: msg, error } = await admin.from('chat_messages').insert({ thread_id: tid, sender_id: eu, body: texto, client_id: clientId, reply_to_id: replyTo })
        .select(CAMPOS_MSG).single();
      if (error) throw new Error(error.message);
      await Promise.all([
        admin.from('chat_threads').update({ last_message_at: msg.created_at }).eq('id', tid),
        // Quem escreve já leu tudo até a própria mensagem.
        admin.from('chat_participants').update({ last_read_id: msg.id }).eq('thread_id', tid).eq('user_id', eu),
      ]);
      // Aviso no celular de quem recebe. Falha aqui não desfaz a mensagem.
      try {
        const { data: outros } = await admin.from('chat_participants').select('user_id').eq('thread_id', tid).neq('user_id', eu);
        const destino = (outros ?? []).map((o) => String(o.user_id));
        if (destino.length) {
          const { data: t } = await admin.from('chat_threads').select('tenant_id').eq('id', tid).maybeSingle();
          const eus = await pessoas(admin, [eu]);
          await fetch(`${supabaseUrl}/functions/v1/send-push`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
            body: JSON.stringify({
              action: 'send', user_ids: destino, tenant_id: t?.tenant_id ?? null,
              payload: { titulo: eus.get(eu)?.nome ?? 'Mensagem nova', corpo: texto.slice(0, 180), url: `/modulos?conversa=${tid}` },
            }),
          });
        }
      } catch (e) {
        log('WARN', 'push falhou', { error: errMsg(e) });
      }
      return json({ success: true, data: { mensagem: (await comCitacao(admin, [msg]))[0] } });
    }

    if (action === 'lido') {
      const tid = String(body.thread_id ?? '');
      const id = Number(body.id ?? 0);
      if (!UUID.test(tid) || !id) return fail('Dados incompletos.');
      const p = await participa(admin, tid, eu);
      if (!p) return fail('Conversa não encontrada.', 404);
      if (id > Number(p.last_read_id)) {
        // Lida também conta como entregue.
        await admin.from('chat_participants').update({ last_read_id: id, last_delivered_id: Math.max(id, Number(p.last_delivered_id ?? 0)) })
          .eq('thread_id', tid).eq('user_id', eu);
      }
      return json({ success: true, data: { last_read_id: Math.max(id, Number(p.last_read_id)) } });
    }

    return fail('Ação desconhecida.');
  } catch (e) {
    log('ERROR', 'falha', { action, error: errMsg(e) });
    return fail(errMsg(e), 500);
  }
});

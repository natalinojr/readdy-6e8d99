// assistente-app — chat do assistente DENTRO do ERPOS (2026-09-15). Projeto PESSOAL do dono;
// ver assistente/README.md › "Chat no ERPOS".
//
// Mesma conversa do Telegram: o histórico é o do chat do dono no Telegram (asst_messages.chat_id
// = 'tg:<id>'), só muda o canal ('app'). Falou no celular pelo Telegram, continua aqui, e vice-versa.
//
// Ações (POST JSON, JWT do dono — e-mail + asst_settings.owner_user_id):
//   history   { after_id?, before_id? }            → mensagens da conversa (60 por vez)
//   send      { text?, attachment?, audio?, contexto? }
//             attachment = { base64, media_type } (foto/PDF) · audio = { base64, media_type } (→ Whisper)
//             contexto = { rota, titulo, loja, tela?, item? } — a tela aberta vai junto para o
//             assistente; tela/item = o que está visível e o registro apontado (assistenteFoco.ts)
//   payments  {}                                   → pagamentos do Inter em aberto/recentes (cartões)
//   pay       { id, op: 'ok'|'no'|'st', pin? }     → Pagar (com PIN) / Cancelar / Ver status
//   unread    {}                                   → quantas mensagens ele mandou e você não viu
//   topics    {}                                   → lista de conversas: por assunto, a última
//                                                    mensagem, a hora e as não lidas
//   seen      { id, topic?, group_jid? }           → marca visto até esse id (no assunto, no grupo, ou geral)
//   items_pending {}                               → itens de fornecedor sem classificação CMV × despesa
//                                                    (lojas onde o dono é admin/gerente) + categorias
//   item_classify { tenant_id, ids, classe, dre_category_id?, merchandise_category_id? }
//                                                  → classifica pelo chat (fn_item_classify com o JWT do dono)
//   history/topics aceitam group_jid: conversa de um GRUPO do WhatsApp (asst_messages.group_jid)
//   Caixa de pendências no chat (2026-09-18):
//   pendencia_pagar { id }                         → prepara de novo o pedido do grupo (ou o pagamento parado) e devolve os cartões
//   pendencia_recusar { id }                       → "não vou pagar": cancela os Pix preparados e recusa o pedido
//   contas_sem_dre { tenant_id }                   → contas sem categoria DRE + categorias da loja
//   pendencias_pagamento_info { ids }              → por pendência de pagamento: para quem vai e se a mercadoria já chegou
//   conta_dre     { tenant_id, bill_id, dre_category_id } → classifica a conta (só se ainda estiver sem)
//   pedido_origem { id }                           → mensagem (asst_messages.id) que gerou o pedido do grupo
//
// O PIN é o mesmo do Telegram (asst_settings.pay_pin, hash com o id do chat do Telegram) e nunca
// vai ao modelo nem ao histórico. Mesmo bloqueio: 3 erros → 15 minutos.
//
// Publicada com --no-verify-jwt: a checagem do dono é feita aqui dentro.
// Secrets: ASSISTENTE_INTERNAL_KEY (brain/telegram), FISCAL_INTERNAL_KEY (inter-bank), WHISPER_URL, WHISPER_API_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { lerGuia } from '../_shared/guias.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const OWNER_EMAIL = 'natalinojr.engel@gmail.com';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const fail = (msg: string, status = 400) => json({ success: false, error: msg }, status);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'assistente-app', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const fiscalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
const whisperUrl = (Deno.env.get('WHISPER_URL') ?? '').replace(/\/$/, '');
const whisperKey = Deno.env.get('WHISPER_API_KEY') ?? '';
// Mesmo vocabulário do assistente-telegram (sem isso "Paranaguá" vira "parar na água").
const WHISPER_PROMPT = 'Conversa com o Natalino, dono dos restaurantes El Patrón em Paranaguá (PR), lojas Vila Leste e Paranaguá. ERPOS, cardápio, fornecedor, conta a pagar, DRE, CMV, estoque, insumo, Pix, Inter, Stone, iFood, delivery, motoboy, hambúrguer, pastel.';
const FILE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf'];
const MAX_B64 = 14 * 1024 * 1024; // ~10 MB de arquivo
// Assuntos (abas do chat): asst_messages.topic. A conversa é uma só; a aba filtra e, ao escrever
// numa aba, a mensagem já nasce com o assunto.
const TOPICS = ['geral', 'pagamentos', 'curriculos', 'compras', 'avisos'];

const PIN_LOCK_MS = 15 * 60_000;
const PAY_TTL_MS = 30 * 60_000;
const PAY_OPEN = ['draft', 'awaiting_pin', 'sending', 'sent', 'pending_approval', 'approved', 'scheduled'];
const PAY_STATUS: Record<string, string> = {
  draft: 'aguardando você tocar em Pagar', awaiting_pin: 'esperando o PIN', sending: 'enviando ao Inter', sent: 'enviado ao Inter',
  pending_approval: 'aguardando sua aprovação no app do Inter', approved: 'aprovado, processando', scheduled: 'agendado no Inter',
  paid: 'pago', cancelled: 'cancelado', rejected: 'recusado pelo Inter', failed: 'não foi enviado', expired: 'expirado',
};
const nowIso = () => new Date().toISOString();
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
// Igual ao assistente-telegram (pinHash): o sal é o id do chat do Telegram do dono.
const pinHash = (pin: string, tgChatId: number) => sha256hex(`erpos-pay:${tgChatId}:${pin}`);

// deno-lint-ignore no-explicit-any
async function getSetting(admin: SupabaseClient, key: string): Promise<any> {
  const { data } = await admin.from('asst_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(admin: SupabaseClient, key: string, value: unknown) {
  await admin.from('asst_settings').upsert({ key, value, updated_at: nowIso() });
}

// "Já vi até aqui" do chat do ERPOS (asst_settings.app_last_seen). Com a lista de conversas o
// marcador virou POR ASSUNTO (2026-09-16): abrir Financeiro não pode marcar como lido um aviso de
// currículo que chegou antes. `id` continua sendo o piso global — é o que existia antes, e o que
// vale para assunto sem marca própria.
// deno-lint-ignore no-explicit-any
function vistosDe(v: any): (topic: string) => number {
  const base = Number(v?.id ?? 0);
  const t = (v?.topics ?? {}) as Record<string, number>;
  return (topic: string) => Math.max(base, Number(t[topic] ?? 0));
}
// Conversa por GRUPO do WhatsApp (2026-09-17): a mensagem de um grupo conta como lida se foi vista no
// assunto dela OU na conversa do grupo (chave 'g:<jid>' em app_last_seen.topics).
const GRUPO_JID = /^[\w.-]+@g\.us$/;
const chaveGrupo = (jid: string) => `g:${jid}`;
// deno-lint-ignore no-explicit-any
const vistoDaMsg = (visto: (k: string) => number, r: any): number =>
  Math.max(visto(String(r.topic ?? 'geral')), r.group_jid ? visto(chaveGrupo(String(r.group_jid))) : 0);
// Resposta silenciosa (dono, 2026-09-24): o brain grava "NO_REPLY" quando decide não responder —
// "ok"/"valeu" do dono e, principalmente, a triagem automática dos grupos ("[Sistema] Mensagem no
// grupo … que parece pedido de pagamento") quando não era pedido. No chat isso virava um balão
// "NO_REPLY" e a última mensagem da conversa, no lugar do painel do fechamento. Fica no banco (o
// modelo usa o histórico), mas o chat não mostra: nem o silêncio, nem a triagem que deu em nada.
const SILENCIO = 'NO_REPLY';
// deno-lint-ignore no-explicit-any
const ehSilencio = (r: any) => r.role === 'assistant' && String(r.content ?? '').trim() === SILENCIO;
/** Linhas em ordem CRESCENTE de id. Tira os silêncios e a triagem automática que os gerou. */
function semSilencio<T extends { role: string; content: unknown; created_at?: string }>(rows: T[]): T[] {
  const fora = new Set<number>();
  rows.forEach((r, i) => {
    if (!ehSilencio(r)) return;
    fora.add(i);
    // A pergunta é a última mensagem do dono antes dela (um aviso do cron pode ter caído no meio).
    for (let j = i - 1; j >= 0; j--) {
      if (rows[j].role !== 'user') continue;
      const perto = !r.created_at || !rows[j].created_at || Date.parse(r.created_at) - Date.parse(rows[j].created_at!) < 5 * 60_000;
      if (perto && String(rows[j].content ?? '').startsWith('[Sistema]')) fora.add(j);
      break;
    }
  });
  return rows.filter((_, i) => !fora.has(i));
}
// deno-lint-ignore no-explicit-any
const pisoDosVistos = (v: any): number => {
  const base = Number(v?.id ?? 0);
  const t = Object.values((v?.topics ?? {}) as Record<string, number>).map(Number);
  return t.length ? Math.min(base, ...t) : base;
};

// deno-lint-ignore no-explicit-any
async function callEdge(fn: string, key: string, body: Record<string, unknown>): Promise<{ status: number; out: any }> {
  const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': key }, body: JSON.stringify(body),
  });
  return { status: r.status, out: await r.json().catch(() => ({})) };
}
// deno-lint-ignore no-explicit-any
async function callInter(action: string, body: Record<string, unknown>): Promise<any> {
  const { status, out } = await callEdge('inter-bank', fiscalKey, { action, ...body });
  if (status >= 400 || out?.success === false) throw new Error(String(out?.error ?? `inter-bank HTTP ${status}`));
  return out;
}

async function transcribe(b64: string, mime: string): Promise<string> {
  if (!whisperUrl || !whisperKey) throw new Error('Transcrição de áudio não configurada (WHISPER_URL).');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const form = new FormData();
  const ext = mime.includes('webm') ? 'webm' : mime.includes('mp4') || mime.includes('m4a') ? 'm4a' : 'ogg';
  form.append('audio_file', new Blob([bytes], { type: mime }), `audio.${ext}`);
  const r = await fetch(`${whisperUrl}/asr?task=transcribe&language=pt&output=json&encode=true&initial_prompt=${encodeURIComponent(WHISPER_PROMPT)}`, {
    method: 'POST', headers: { 'X-Api-Key': whisperKey }, body: form,
  });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return String((await r.json())?.text ?? '').trim();
}

// Cartão do pagamento para a tela (chave mascarada: o cartão não precisa dela inteira).
// deno-lint-ignore no-explicit-any
function payCard(p: any) {
  const key = p.pix_copia_e_cola ? 'copia e cola da guia' : String(p.pix_key ?? '');
  const masked = !p.pix_copia_e_cola && key.length > 8 ? `${key.slice(0, 4)}…${key.slice(-4)}` : key;
  const expired = p.status === 'draft' && Date.now() - new Date(p.created_at).getTime() > PAY_TTL_MS;
  const status = expired ? 'expired' : String(p.status);
  return {
    id: p.id, kind: p.kind, amount: Number(p.amount), beneficiary_name: p.beneficiary_name ?? null,
    pix_key: p.kind === 'pix' ? masked : null, due_date: p.due_date ?? null, description: p.description ?? null,
    face_value: p.face_value == null ? null : Number(p.face_value),
    status, status_label: PAY_STATUS[status] ?? status, error: p.error ?? null,
    created_at: p.created_at, paid_at: p.paid_at ?? null, has_bill: !!p.bill_id,
    recebido: null as boolean | null, recebido_em: null as string | null,
  };
}

// Mercadoria já chegou? (dono, 2026-09-18: "informar se o produto já foi recebido"). Pagamento →
// conta a pagar (reference_type 'purchase') → compra.delivery_confirmed_at. Sem compra ligada
// (Pix avulso, serviço) fica null e o cartão não diz nada.
// deno-lint-ignore no-explicit-any
async function payCards(admin: SupabaseClient, rows: any[]) {
  const cards = rows.map(payCard);
  const billIds = [...new Set(rows.map((r) => r.bill_id).filter(Boolean).map(String))];
  if (!billIds.length) return cards;
  const { data: bills } = await admin.from('fin_accounts_payable').select('id, reference_type, reference_id').in('id', billIds);
  const compraDaConta = new Map((bills ?? []).filter((b) => b.reference_type === 'purchase' && b.reference_id).map((b) => [String(b.id), String(b.reference_id)]));
  const compraIds = [...new Set(compraDaConta.values())];
  if (!compraIds.length) return cards;
  const { data: compras } = await admin.from('fin_purchases').select('id, delivery_confirmed_at').in('id', compraIds);
  const recebida = new Map((compras ?? []).map((c) => [String(c.id), (c.delivery_confirmed_at as string | null) ?? null]));
  return cards.map((c, i) => {
    const compra = rows[i].bill_id ? compraDaConta.get(String(rows[i].bill_id)) : undefined;
    if (!compra || !recebida.has(compra)) return c;
    const em = recebida.get(compra) ?? null;
    return { ...c, recebido: !!em, recebido_em: em };
  });
}
const payCard1 = async (admin: SupabaseClient, row: unknown) => (await payCards(admin, [row]))[0];

// Admin/gerente da loja (mesma régua do items_pending): o dono resolve pendência de qualquer loja dele.
async function ehGestor(admin: SupabaseClient, userId: string, tenantId: string): Promise<boolean> {
  if (!tenantId) return false;
  const { data } = await admin.from('user_tenants').select('tenant_id').eq('user_id', userId).eq('tenant_id', tenantId)
    .in('role', ['admin', 'manager']).maybeSingle();
  return !!data;
}

// Classificou pelo chat: a pendência agregada da loja recontada na hora (o cron faria no próximo
// tick). Mesmos textos do assistente-cron › syncPendenciasClassificacao.
async function syncPendenciaContagem(admin: SupabaseClient, tenantId: string, kind: 'item_sem_classe' | 'conta_sem_dre') {
  let n = 0;
  if (kind === 'item_sem_classe') {
    const { count } = await admin.from('fin_item_classifications').select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId).is('classe', null);
    n = count ?? 0;
  } else {
    const { data } = await admin.from('fin_accounts_payable').select('reference_type')
      .eq('tenant_id', tenantId).is('dre_category_id', null).neq('status', 'cancelled').limit(1000);
    n = (data ?? []).filter((c) => !['purchase', 'hr_payroll'].includes(String(c.reference_type ?? ''))).length;
  }
  if (n === 0) {
    await admin.rpc('fn_pendencia_resolver_ref', { p_tenant: tenantId, p_kind: kind, p_ref: 'pendentes', p_motivo: 'tudo classificado' });
    return;
  }
  await admin.rpc('fn_pendencia_upsert', kind === 'item_sem_classe'
    ? {
      p_tenant: tenantId, p_kind: kind, p_ref: 'pendentes',
      p_titulo: `${n} ${n === 1 ? 'item sem classificação' : 'itens sem classificação'} (CMV × despesa)`,
      p_detalhe: 'Enquanto não forem classificados, entram no CMV e a DRE sai errada.',
      p_payload: { total: n }, p_rota: '/financeiro?tab=itens',
      p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
    }
    : {
      p_tenant: tenantId, p_kind: kind, p_ref: 'pendentes',
      p_titulo: `${n} ${n === 1 ? 'conta sem categoria' : 'contas sem categoria'} na DRE`,
      p_detalhe: 'Conta sem categoria não recebe baixa pelo assistente e fica de fora da DRE.',
      p_payload: { total: n }, p_rota: '/financeiro?tab=pagar',
      p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'app', p_reabrir: true,
    });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  // ── Só o dono ──
  const authHeader = req.headers.get('Authorization') ?? '';
  const userClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { autoRefreshToken: false, persistSession: false } });
  const { data: { user } } = await userClient.auth.getUser();
  if (!user) return fail('Unauthorized', 401);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: settings } = await admin.from('asst_settings').select('key, value').in('key', ['owner_user_id', 'telegram_allowed_ids']);
  const cfg = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));
  if (user.email?.toLowerCase() !== OWNER_EMAIL || user.id !== cfg.owner_user_id) return fail('Acesso restrito ao dono', 403);
  // Chat privado do Telegram: id do chat = id do usuário. É a chave da conversa compartilhada.
  const tgId = Number((Array.isArray(cfg.telegram_allowed_ids) ? cfg.telegram_allowed_ids : [])[0]);
  if (!tgId) return fail('Telegram do dono não configurado (asst_settings.telegram_allowed_ids).', 500);
  const chatKey = `tg:${tgId}`;

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { return fail('JSON inválido'); }
  const action = String(body.action ?? '');

  try {
    if (action === 'history') {
      let q = admin.from('asst_messages').select('id, role, content, channel, created_at, topic, group_jid').eq('chat_id', chatKey);
      if (GRUPO_JID.test(String(body.group_jid ?? ''))) q = q.eq('group_jid', String(body.group_jid)); // conversa do grupo
      else if (TOPICS.includes(String(body.topic)) ) q = q.eq('topic', String(body.topic)); // aba; sem topic = tudo
      if (body.after_id) q = q.gt('id', Number(body.after_id)).order('id', { ascending: true }).limit(100);
      else {
        if (body.before_id) q = q.lt('id', Number(body.before_id));
        q = q.order('id', { ascending: false }).limit(60);
      }
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      const rows = semSilencio(body.after_id ? (data ?? []) : (data ?? []).reverse());
      return json({ success: true, data: { messages: rows, has_more: !body.after_id && (data ?? []).length === 60 } });
    }

    if (action === 'send') {
      let text = String(body.text ?? '').trim().slice(0, 8000);
      // deno-lint-ignore no-explicit-any
      const att: any = body.attachment?.base64 ? body.attachment : null;
      if (att) {
        if (!FILE_TYPES.includes(String(att.media_type))) return fail('Esse tipo de arquivo eu não leio. Mande foto ou PDF.');
        if (String(att.base64).length > MAX_B64) return fail('Arquivo grande demais (máx. ~10 MB).');
      }
      let transcricao: string | null = null;
      if (body.audio?.base64) {
        if (String(body.audio.base64).length > MAX_B64) return fail('Áudio grande demais.');
        transcricao = await transcribe(String(body.audio.base64), String(body.audio.media_type ?? 'audio/webm'));
        if (!transcricao) return fail('Não consegui entender o áudio. Pode repetir ou mandar em texto?');
        text = `[Áudio] ${transcricao}${text ? `\n${text}` : ''}`;
      }
      if (!text && !att) return fail('Mensagem vazia.');
      // Tela aberta no ERPOS: vai junto para o assistente entender "essa conta", "esse candidato".
      // Desde 2026-09-16 vem em três níveis (src/lib/assistenteFoco.ts): a rota, o que a tela
      // mostra (filtros, totais) e o registro que o dono apontou pelo botão "perguntar sobre".
      const c = body.contexto ?? {};
      const tela = [c.titulo ? String(c.titulo).slice(0, 80) : null, c.rota ? String(c.rota).slice(0, 200) : null].filter(Boolean).join(' — ');
      const linhaFoco = (rotulo: string, f: unknown): string => {
        // deno-lint-ignore no-explicit-any
        const x: any = f;
        if (!x || typeof x !== 'object' || !x.titulo) return '';
        const partes = [String(x.titulo).slice(0, 200)];
        if (x.id) partes.push(`id ${String(x.id).slice(0, 60)}`);
        if (x.dados) partes.push(String(x.dados).slice(0, 700));
        return `\n${rotulo}: ${partes.join(' · ')}`;
      };
      const prefixo = tela || c.loja
        ? `[Pelo ERPOS${tela ? ` · tela: ${tela}` : ''}${c.loja ? ` · loja aberta: ${String(c.loja).slice(0, 60)}` : ''}${linhaFoco('Na tela', c.tela)}${linhaFoco('Ele apontou', c.item)}]\n`
        : '';
      const started = Date.now();
      const { status, out } = await callEdge('assistente-brain', internalKey, {
        text: `${prefixo}${text}`.trim(), chat_id: chatKey, channel: 'app',
        ...(TOPICS.includes(String(body.topic)) ? { topic: String(body.topic) } : {}),
        // Perguntou dentro da conversa de um grupo: pergunta e resposta ficam nesse grupo (2026-09-19).
        ...(GRUPO_JID.test(String(body.group_jid ?? '')) ? { group_jid: String(body.group_jid) } : {}),
        ...(att ? { attachment: { base64: String(att.base64), media_type: String(att.media_type) } } : {}),
      });
      if (status >= 400 || !out?.reply) {
        const e = String(out?.error ?? `HTTP ${status}`);
        log('ERROR', 'brain', { status, error: e.slice(0, 300) });
        if (/credit balance/i.test(e)) return fail('Os créditos da API da Anthropic acabaram. Recarregue em console.anthropic.com › Billing.', 502);
        return fail(`Deu erro do meu lado: ${e.slice(0, 200)}`, 502);
      }
      log('INFO', 'respondido', { ms: Date.now() - started, tools: (out.tool_calls ?? []).map((t: { name: string }) => t.name), actions: (out.actions ?? []).map((a: { type: string }) => a.type) });
      // NO_REPLY é o modo silencioso da triagem de grupo. No chat ele aparecia como "nenhuma
      // resposta" (aconteceu com um áudio em 2026-09-15): aqui a conversa sempre responde algo.
      const reply = String(out.reply) === 'NO_REPLY' ? 'Ok 👍' : String(out.reply);
      return json({ success: true, data: { reply, actions: Array.isArray(out.actions) ? out.actions : [], tool_calls: out.tool_calls ?? [], transcricao } });
    }

    // ── Badge do botão fechado (2026-09-16) ──
    // Consulta leve: o app chama de 45 em 45 s com o chat FECHADO, então não devolve mensagem
    // nenhuma — só quantas ele mandou depois da última que o dono viu, o assunto e uma prévia.
    // Conta só role='assistant': o que ele fala sozinho (cron, conciliação, avisos) é a novidade;
    // o que o próprio dono escreveu no Telegram, não.
    if (action === 'unread') {
      const marca = await getSetting(admin, 'app_last_seen');
      const visto = vistosDe(marca);
      const { data, error } = await admin.from('asst_messages').select('id, content, topic, group_jid')
        .eq('chat_id', chatKey).eq('role', 'assistant').neq('content', SILENCIO).gt('id', pisoDosVistos(marca))
        .order('id', { ascending: false }).limit(60);
      if (error) throw new Error(error.message);
      // O piso é o menor dos assuntos: filtra aqui o que já foi lido no assunto (ou no grupo) de cada uma.
      const rows = (data ?? []).filter((r) => Number(r.id) > vistoDaMsg(visto, r));
      const topics = [...new Set(rows.map((r) => String(r.topic ?? 'geral')))];
      const ultima = rows[0];
      return json({ success: true, data: {
        count: rows.length,
        last_id: ultima ? Number(ultima.id) : pisoDosVistos(marca),
        // Assunto só quando é um só: com mensagens de assuntos diferentes o chat abre em "Tudo".
        topic: topics.length === 1 && TOPICS.includes(topics[0]) ? topics[0] : null,
        previa: ultima ? String(ultima.content).replace(/^\[[^\]]*\]\s*/, '').slice(0, 140) : null,
      } });
    }

    // ── Lista de conversas (2026-09-16) ──
    // A conversa continua UMA só; a lista é a mesma ideia das abas, com cara de WhatsApp: por
    // assunto, a última mensagem, a hora e quantas ele mandou que você ainda não viu.
    if (action === 'topics') {
      const marca = await getSetting(admin, 'app_last_seen');
      const visto = vistosDe(marca);
      const ultimas = await Promise.all(TOPICS.map(async (t) => {
        const { data } = await admin.from('asst_messages').select('id, role, content, created_at, topic')
          .eq('chat_id', chatKey).eq('topic', t).order('id', { ascending: false }).limit(8);
        return semSilencio((data ?? []).reverse()).pop() ?? null;
      }));
      // Não lidas por assunto: uma consulta só, teto de 200 (acima disso o número já não ajuda).
      const { data: novas } = await admin.from('asst_messages').select('id, topic, group_jid')
        .eq('chat_id', chatKey).eq('role', 'assistant').neq('content', SILENCIO).gt('id', pisoDosVistos(marca)).limit(200);
      const porTopico = new Map<string, number>();
      const porGrupo = new Map<string, number>();
      for (const n of novas ?? []) {
        if (Number(n.id) <= vistoDaMsg(visto, n)) continue;
        const t = String(n.topic ?? 'geral');
        porTopico.set(t, (porTopico.get(t) ?? 0) + 1);
        if (n.group_jid) porGrupo.set(String(n.group_jid), (porGrupo.get(String(n.group_jid)) ?? 0) + 1);
      }
      // Conversas de grupo: cada grupo do WhatsApp com mensagem na conversa (2026-09-17).
      const { data: recentes } = await admin.from('asst_messages').select('group_jid')
        .eq('chat_id', chatKey).not('group_jid', 'is', null).order('id', { ascending: false }).limit(300);
      const jids = [...new Set((recentes ?? []).map((r) => String(r.group_jid)))].slice(0, 20);
      const { data: nomes } = jids.length ? await admin.from('asst_groups').select('group_jid, name').in('group_jid', jids) : { data: [] };
      const grupos = await Promise.all(jids.map(async (jid) => {
        const { data: ult } = await admin.from('asst_messages').select('role, content, created_at')
          .eq('chat_id', chatKey).eq('group_jid', jid).order('id', { ascending: false }).limit(8);
        const u = semSilencio((ult ?? []).reverse()).pop();
        return {
          group_jid: jid,
          name: (nomes ?? []).find((n) => n.group_jid === jid)?.name ?? 'Grupo do WhatsApp',
          unread: porGrupo.get(jid) ?? 0,
          last: u ? { role: u.role, content: String(u.content).replace(/^\[[^\]]*\]\s*/, '').slice(0, 120), created_at: u.created_at } : null,
        };
      }));
      return json({ success: true, data: {
        groups: grupos,
        topics: TOPICS.map((t, i) => ({
          topic: t,
          unread: porTopico.get(t) ?? 0,
          last: ultimas[i] ? {
            role: ultimas[i].role,
            // Prévia sem os marcadores internos ("[Pelo ERPOS…]", "[Áudio]", "[Pagamento…]").
            content: String(ultimas[i].content).replace(/^\[[^\]]*\]\s*/, '').slice(0, 120),
            created_at: ultimas[i].created_at,
          } : null,
        })),
      } });
    }

    if (action === 'seen') {
      const id = Number(body.id ?? 0);
      if (!id) return fail('id obrigatório.');
      const marca = (await getSetting(admin, 'app_last_seen')) ?? {};
      const grupo = GRUPO_JID.test(String(body.group_jid ?? '')) ? chaveGrupo(String(body.group_jid)) : null;
      const topic = grupo ?? (TOPICS.includes(String(body.topic)) ? String(body.topic) : null);
      const topics: Record<string, number> = { ...((marca.topics ?? {}) as Record<string, number>) };
      let base = Number(marca.id ?? 0);
      if (topic) {
        // Leu UM assunto: só ele anda. Assim abrir Financeiro não apaga o aviso de currículo.
        topics[topic] = Math.max(Number(topics[topic] ?? 0), id);
      } else if (id > base) {
        // Leu a conversa inteira ("Todas as mensagens"): o piso global sobe e as marcas por
        // assunto viram redundantes.
        base = id;
        for (const t of Object.keys(topics)) if (topics[t] <= base) delete topics[t];
      }
      await setSetting(admin, 'app_last_seen', { id: base, topics, at: nowIso() });
      return json({ success: true, data: { last_seen_id: base, topics } });
    }

    if (action === 'payments') {
      // Só os que ainda esperam decisão ou estão em andamento — o cartão no chat é para AGIR.
      // Concluído (pago/cancelado/recusado) fica só na conversa; antes voltava por 24 h e o
      // rodapé do chat ficava entulhado de "pago" (2026-09-16).
      const { data, error } = await admin.from('fin_inter_payments').select('*').eq('chat_id', chatKey)
        .in('status', PAY_OPEN)
        .gte('created_at', new Date(Date.now() - 7 * 86400_000).toISOString())
        .order('created_at', { ascending: false }).limit(20);
      if (error) throw new Error(error.message);
      return json({ success: true, data: { payments: await payCards(admin, data ?? []) } });
    }

    if (action === 'pay') {
      const id = String(body.id ?? '');
      const op = String(body.op ?? '');
      const { data: p } = await admin.from('fin_inter_payments').select('*').eq('id', id).eq('chat_id', chatKey).maybeSingle();
      if (!p) return fail('Pagamento não encontrado.', 404);

      if (op === 'no') {
        const out = await callInter('cancel_payment', { tenant_id: p.tenant_id, payment_id: p.id });
        await admin.from('asst_messages').insert({ channel: 'app', chat_id: chatKey, role: 'assistant', content: `[Pagamento ${p.kind} de ${brl(p.amount)}${p.beneficiary_name ? ` para ${p.beneficiary_name}` : ''}: cancelado pelo ERPOS] id ${p.id}` });
        return json({ success: true, data: { payment: await payCard1(admin, { ...p, ...out.payment }) } });
      }
      if (op === 'st') {
        const out = await callInter('payment_status', { tenant_id: p.tenant_id, payment_id: p.id });
        return json({ success: true, data: { payment: await payCard1(admin, { ...p, ...out.payment }) } });
      }
      // "Preparar de novo" no cartão (2026-09-22): o Telegram tinha o botão e o chat não — pedido
      // recusado/expirado ficava sem saída. Mesmo caminho do Telegram: inter-bank › reprepare_payment
      // (pedido NOVO, revalida tudo; boleto vencido sai recalculado com multa e juros).
      if (op === 're') {
        if (!['expired', 'failed', 'rejected'].includes(p.status)) return fail(`Esse já está: ${PAY_STATUS[p.status] ?? p.status}.`);
        const out = await callInter('reprepare_payment', { tenant_id: p.tenant_id, payment_id: p.id });
        const novo = out.payment;
        if (novo.chat_id !== chatKey) await admin.from('fin_inter_payments').update({ chat_id: chatKey }).eq('id', novo.id);
        return json({ success: true, data: { payment: await payCard1(admin, { ...novo, chat_id: chatKey }) } });
      }
      if (op !== 'ok') return fail('Opção inválida.');

      if (!['draft', 'awaiting_pin'].includes(p.status)) return fail(`Esse já está: ${PAY_STATUS[p.status] ?? p.status}.`);
      if (Date.now() - new Date(p.created_at).getTime() > PAY_TTL_MS) {
        await admin.from('fin_inter_payments').update({ status: 'expired', updated_at: nowIso() }).eq('id', p.id).in('status', ['draft', 'awaiting_pin']);
        return fail('Esse pedido expirou (30 minutos). Me peça de novo.');
      }
      // ── PIN (mesma regra do Telegram) ──
      const pin = String(body.pin ?? '').trim();
      const s = (await getSetting(admin, 'pay_pin')) ?? {};
      if (!s.hash) return fail('Você ainda não tem PIN de pagamento. Crie no Telegram mandando /pin.');
      if (s.locked_until && new Date(s.locked_until).getTime() > Date.now()) {
        return fail(`PIN bloqueado até ${new Date(s.locked_until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} por tentativas erradas.`, 423);
      }
      if (!/^\d{4,8}$/.test(pin) || (await pinHash(pin, tgId)) !== s.hash) {
        const fails = Number(s.fails ?? 0) + 1;
        const locked = fails >= 3 ? new Date(Date.now() + PIN_LOCK_MS).toISOString() : null;
        await setSetting(admin, 'pay_pin', { ...s, fails: locked ? 0 : fails, locked_until: locked });
        log('WARN', 'PIN de pagamento errado (ERPOS)', { fails, locked: !!locked });
        return fail(locked ? 'PIN errado 3 vezes. Bloqueado por 15 minutos.' : `PIN errado (${fails}/3).`, 401);
      }
      if (s.fails) await setSetting(admin, 'pay_pin', { ...s, fails: 0, locked_until: null });

      // execute_payment faz o claim atômico (draft/awaiting_pin → sending): dois toques não pagam 2×.
      // deno-lint-ignore no-explicit-any
      let pago: any = p;
      try {
        const out = await callInter('execute_payment', { tenant_id: p.tenant_id, payment_id: p.id });
        pago = { ...p, ...out.payment };
      } catch (e) {
        const { data: cur } = await admin.from('fin_inter_payments').select('*').eq('id', p.id).maybeSingle();
        pago = { ...(cur ?? p), error: cur?.error ?? errMsg(e) };
        if (!cur) pago.status = 'failed';
      }
      // Pago na hora (raro: normalmente fica aguardando a aprovação no app do Inter e o
      // assistente-cron › pay_watch cuida do resto): comprovante no grupo + baixa já agora.
      if (pago.status === 'paid') {
        await callEdge('assistente-telegram', internalKey, { action: 'send_receipt', payment_id: p.id }).catch(() => null);
        if (pago.bill_id || pago.dre_category_id) await callEdge('assistente-brain', internalKey, { action: 'baixa_conciliada', payment_id: p.id }).catch(() => null);
      }
      await admin.from('asst_messages').insert({ channel: 'app', chat_id: chatKey, role: 'assistant', content: `[Pagamento ${pago.kind} de ${brl(pago.amount)}${pago.beneficiary_name ? ` para ${pago.beneficiary_name}` : ''}: ${PAY_STATUS[pago.status] ?? pago.status}${pago.error ? ` (${pago.error})` : ''} — pelo ERPOS] id ${p.id}` });
      log('INFO', 'pagamento pelo ERPOS', { id: p.id, status: pago.status });
      return json({ success: true, data: { payment: await payCard1(admin, pago) } });
    }

    // Pendência "pagamento pedido no grupo" → cartões de pagamento prontos para o PIN (2026-09-18).
    // A caixa de pendências mora no chat: o botão Pagar da pendência cai aqui. Rascunho vencido
    // (30 min) ou falhado vira pedido NOVO pelo inter-bank › reprepare_payment (revalida tudo);
    // rascunho ainda válido e pagamento em andamento voltam como estão.
    // "Não vou pagar" na caixa de pendências (dono, 2026-09-20): fechar a pendência não bastava —
    // os Pix já preparados continuavam no rodapé do chat esperando o toque em Pagar. Aqui os
    // pagamentos ligados à pendência são CANCELADOS no Inter e o pedido do grupo vira 'recusado'.
    if (action === 'pendencia_recusar') {
      const { data: pend } = await admin.from('pendencias').select('id, tenant_id, kind, ref, payload').eq('id', String(body.id ?? '')).maybeSingle();
      if (!pend) return fail('Pendência não encontrada.', 404);
      if (!(await ehGestor(admin, user.id, String(pend.tenant_id)))) return fail('Sem acesso a essa loja.', 403);
      if (!['pagamento_grupo', 'pagamento_pendente'].includes(pend.kind)) return json({ success: true, data: { cancelados: 0 } });
      // deno-lint-ignore no-explicit-any
      const pl = (pend.payload ?? {}) as any;
      let q = admin.from('fin_inter_payments').select('*').eq('tenant_id', pend.tenant_id).in('status', PAY_OPEN);
      q = pend.kind === 'pagamento_grupo' ? q.eq('group_request_id', Number(pend.ref))
        : q.in('id', [String(pend.ref), ...(Array.isArray(pl.pagamentos) ? pl.pagamentos.map(String) : [])]);
      const { data: abertos } = await q;
      const erros: string[] = [];
      let cancelados = 0;
      for (const p of abertos ?? []) {
        try {
          await callInter('cancel_payment', { tenant_id: p.tenant_id, payment_id: p.id });
          await admin.from('asst_messages').insert({
            channel: 'app', chat_id: chatKey, role: 'assistant', topic: 'pagamentos',
            content: `[Pagamento ${p.kind} de ${brl(p.amount)}${p.beneficiary_name ? ` para ${p.beneficiary_name}` : ''}: cancelado pelo ERPOS] id ${p.id}`,
          });
          cancelados++;
        } catch (e) { erros.push(`${brl(p.amount)}: ${e instanceof Error ? e.message : String(e)}`.slice(0, 160)); }
      }
      if (pend.kind === 'pagamento_grupo') {
        await admin.from('asst_group_requests').update({ status: 'recusado', updated_at: new Date().toISOString() }).eq('id', Number(pend.ref));
      }
      log('INFO', 'pendência recusada', { pendencia: pend.id, cancelados, erros: erros.length });
      return json({ success: true, data: { cancelados, erros } });
    }

    if (action === 'pendencia_pagar') {
      const { data: pend } = await admin.from('pendencias').select('id, tenant_id, kind, ref, status').eq('id', String(body.id ?? '')).maybeSingle();
      if (!pend || !['pagamento_grupo', 'pagamento_pendente'].includes(pend.kind)) return fail('Pendência de pagamento não encontrada.', 404);
      if (!['aberta', 'vista'].includes(pend.status)) return fail('Essa pendência já foi fechada.');
      if (!(await ehGestor(admin, user.id, String(pend.tenant_id)))) return fail('Sem acesso a essa loja.', 403);
      // deno-lint-ignore no-explicit-any
      let todos: any[] = [];
      if (pend.kind === 'pagamento_grupo') {
        const { data: lista } = await admin.from('fin_inter_payments').select('*')
          .eq('tenant_id', pend.tenant_id).eq('group_request_id', Number(pend.ref)).order('created_at');
        todos = lista ?? [];
      } else {
        // Pagamento parado (2026-09-18): a pendência aponta o pedido original; segue a cadeia do
        // "preparar de novo" (replaced_by) até o mais novo.
        let id: string | null = String(pend.ref);
        const vistos = new Set<string>();
        while (id && !vistos.has(id)) {
          vistos.add(id);
          const { data: p } = await admin.from('fin_inter_payments').select('*').eq('id', id).eq('tenant_id', pend.tenant_id).maybeSingle();
          if (!p) break;
          todos = [p];
          id = p.replaced_by && p.replaced_by !== p.id ? String(p.replaced_by) : null;
        }
      }
      // Preparado de novo antes: o antigo aponta para o substituto (replaced_by) e sai da conta —
      // só as "pontas" valem. replaced_by = o próprio id é um preparo interrompido: o antigo vale.
      const pontas = todos.filter((p) => !p.replaced_by || p.replaced_by === p.id);
      // deno-lint-ignore no-explicit-any
      const cards: any[] = [];
      const erros: string[] = [];
      for (const p of pontas) {
        if (['paid', 'cancelled'].includes(p.status)) continue;
        let atual = p;
        const vencido = ['draft', 'awaiting_pin'].includes(p.status) && Date.now() - new Date(p.created_at).getTime() > PAY_TTL_MS;
        if (vencido) {
          await admin.from('fin_inter_payments').update({ status: 'expired', updated_at: nowIso() }).eq('id', p.id).in('status', ['draft', 'awaiting_pin']);
          atual = { ...p, status: 'expired' };
        }
        if (['expired', 'failed', 'rejected'].includes(atual.status)) {
          try {
            const out = await callInter('reprepare_payment', { tenant_id: p.tenant_id, payment_id: p.id });
            atual = out.payment;
            await admin.from('fin_inter_payments').update({ chat_id: chatKey }).eq('id', atual.id);
          } catch (e) { erros.push(`${brl(p.amount)}${p.beneficiary_name ? ` para ${p.beneficiary_name}` : ''}: ${errMsg(e)}`); continue; }
        } else if (p.chat_id !== chatKey) {
          await admin.from('fin_inter_payments').update({ chat_id: chatKey }).eq('id', p.id);
        }
        cards.push(await payCard1(admin, atual));
      }
      if (!cards.length) {
        return fail(erros.length ? `Não consegui preparar: ${erros.join(' · ')}` : 'Esse pedido não tem pagamento preparado (o assistente não leu valor/chave). Peça pelo chat.');
      }
      log('INFO', 'pendência → pagamentos', { pendencia: pend.id, cards: cards.length, erros: erros.length });
      return json({ success: true, data: { payments: cards, erros } });
    }

    // Classificação de itens (CMV × despesa) direto no chat (2026-09-16): o aviso do assistente-cron
    // traz um cartão com os pendentes. Mesma regra da tela Financeiro › Classificação de Itens.
    if (action === 'items_pending') {
      const { data: lojas, error: lErr } = await admin.from('user_tenants').select('tenant_id, role, tenants(name)')
        .eq('user_id', user.id).in('role', ['admin', 'manager']);
      if (lErr) throw new Error(lErr.message);
      // deno-lint-ignore no-explicit-any
      const ids = ((lojas ?? []) as any[]).map((l) => String(l.tenant_id));
      if (!ids.length) return json({ success: true, data: { tenants: [] } });
      const [itens, cats, mercs] = await Promise.all([
        admin.from('fin_item_classifications')
          .select('id, tenant_id, description, supplier_name, unit_label, last_unit_price, suggested_classe, suggested_dre_category_id, suggestion_reason, merchandise_category_id, is_service, created_at')
          .in('tenant_id', ids).is('classe', null).order('created_at', { ascending: false }).limit(300),
        admin.from('fin_dre_categories').select('id, tenant_id, name, group_type').in('tenant_id', ids)
          .is('deleted_at', null).eq('is_active', true).not('group_type', 'in', '(revenue,tax,cost)').order('name'),
        admin.from('fin_merchandise_categories').select('id, tenant_id, name').in('tenant_id', ids).eq('is_active', true).order('name'),
      ]);
      if (itens.error) throw new Error(itens.error.message);
      // deno-lint-ignore no-explicit-any
      const tenants = ((lojas ?? []) as any[]).map((l) => {
        const tid = String(l.tenant_id);
        return {
          id: tid, name: String(l.tenants?.name ?? tid),
          items: (itens.data ?? []).filter((i) => i.tenant_id === tid),
          dre_categories: (cats.data ?? []).filter((c) => c.tenant_id === tid).map((c) => ({ id: c.id, name: c.name, group_type: c.group_type })),
          merchandise_categories: (mercs.data ?? []).filter((m) => m.tenant_id === tid).map((m) => ({ id: m.id, name: m.name })),
        };
      }).filter((t) => t.items.length).sort((a, b) => a.name.localeCompare(b.name));
      return json({ success: true, data: { tenants } });
    }

    if (action === 'item_classify') {
      const classe = String(body.classe ?? '');
      const ids = Array.isArray(body.ids) ? body.ids.map(String).slice(0, 200) : [];
      if (!body.tenant_id || !ids.length || !['cmv', 'despesa'].includes(classe)) return fail('Dados incompletos para classificar.');
      // Com o JWT do dono: fn_item_classify confere admin/gerente da loja e reaplica nas compras lançadas.
      const { data, error } = await userClient.rpc('fn_item_classify', {
        p_tenant: String(body.tenant_id), p_ids: ids, p_classe: classe,
        p_dre_category_id: body.dre_category_id ? String(body.dre_category_id) : null,
        p_merchandise_category_id: classe === 'cmv' && body.merchandise_category_id ? String(body.merchandise_category_id) : null,
      });
      if (error) return fail(error.message);
      log('INFO', 'item classificado pelo chat', { tenant: body.tenant_id, n: ids.length, classe });
      await syncPendenciaContagem(admin, String(body.tenant_id), 'item_sem_classe').catch(() => null);
      return json({ success: true, data });
    }

    // ── Caixa de pendências no chat (2026-09-18): resolver ali mesmo ──────────────────────────
    // Contas sem categoria na DRE: mesmo filtro do assistente-cron (conta_sem_dre) e da enquete.
    // Cartão da pendência de pagamento (dono, 2026-09-18): em destaque PARA QUEM vai e se a mercadoria
    // já foi recebida. Destinatário: o do pagamento preparado; sem pagamento, o que a leitura da foto
    // extraiu. Recebimento: compra ligada ao pagamento (conta → compra); sem ela, compra da loja com o
    // mesmo valor (±R$ 0,01), fornecedor parecido e data perto do pedido. Sem compra achada: null.
    if (action === 'pendencias_pagamento_info') {
      const ids = (Array.isArray(body.ids) ? body.ids : []).map(String).slice(0, 100);
      if (!ids.length) return json({ success: true, data: { info: {} } });
      const { data: pends } = await admin.from('pendencias').select('id, tenant_id, kind, ref, payload, criada_em')
        .in('id', ids).in('kind', ['pagamento_grupo', 'pagamento_pendente']);
      const gestor = new Map<string, boolean>();
      // deno-lint-ignore no-explicit-any
      const info: Record<string, any> = {};
      const norm = (t: unknown) => String(t ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').trim();
      const palavra = (t: unknown) => norm(t).split(/\s+/).find((w) => w.length >= 4 && !['ltda', 'comercio', 'distribuidora', 'alimentos'].includes(w)) ?? null;
      for (const pd of pends ?? []) {
        const tid = String(pd.tenant_id);
        if (!gestor.has(tid)) gestor.set(tid, await ehGestor(admin, user.id, tid));
        if (!gestor.get(tid)) continue;
        // deno-lint-ignore no-explicit-any
        const pl = (pd.payload ?? {}) as any;
        const ext = pl.extraido ?? {};
        const payIds: string[] = pd.kind === 'pagamento_pendente' ? [String(pd.ref)] : (Array.isArray(pl.pagamentos) ? pl.pagamentos.map(String) : []);
        // deno-lint-ignore no-explicit-any
        let pays: any[] = [];
        if (payIds.length) {
          const { data } = await admin.from('fin_inter_payments').select('id, kind, amount, beneficiary_name, bill_id, description').in('id', payIds);
          pays = data ?? [];
        }
        const valor = Number(pays[0]?.amount ?? ext.valor ?? 0) || null;
        // Guia de imposto/encargo (DAS, DARF, FGTS — 2026-09-18): quem recebe é o órgão e não há compra.
        // Lida do texto do pedido do grupo (mesma leitura do assistente) ou da conta lançada pela guia.
        let guia: string | null = null;
        let paraGuia: string | null = null;
        const gTxt = pd.kind === 'pagamento_grupo'
          ? (await admin.from('asst_group_requests').select('data').eq('id', Number(pd.ref)).maybeSingle()).data?.data?.extraido?.texto ?? ext.texto ?? ''
          : '';
        const g = gTxt ? lerGuia(String(gTxt), ext.linha_digitavel ?? null) : null;
        if (g) {
          const comp = g.competencia ? ` ${g.competencia.slice(5, 7)}/${g.competencia.slice(0, 4)}` : '';
          paraGuia = `${g.fornecedor} — ${g.titulo}${comp}`;
          guia = `${g.encargo_folha ? 'Encargo da folha' : 'Guia de imposto'} — não é compra${g.vencimento ? ` · vence ${g.vencimento.split('-').reverse().join('/')}` : ''}`;
        } else {
          const bid = pays.map((x) => x.bill_id).filter(Boolean)[0];
          if (bid) {
            const { data: b } = await admin.from('fin_accounts_payable').select('description, supplier, boleto_origem, reference_type').eq('id', bid).maybeSingle();
            if (b?.boleto_origem === 'guia') {
              paraGuia = `${b.supplier ?? ''} — ${String(b.description).replace(/ — competência/, '')}`;
              guia = `${b.reference_type === 'hr_payroll' ? 'Encargo da folha' : 'Guia de imposto'} — não é compra`;
            }
          }
        }
        const para = paraGuia ?? pays.map((x) => x.beneficiary_name).filter(Boolean)[0] ?? ext.beneficiario ?? null;
        // Compra: pela conta do pagamento; senão por valor + fornecedor + data
        let compra: { id: string; delivery_confirmed_at: string | null; supplier: string | null } | null = null;
        const billId = pays.map((x) => x.bill_id).filter(Boolean)[0];
        if (billId) {
          const { data: b } = await admin.from('fin_accounts_payable').select('reference_type, reference_id').eq('id', billId).maybeSingle();
          if (b?.reference_type === 'purchase' && b.reference_id) {
            const { data: c } = await admin.from('fin_purchases').select('id, delivery_confirmed_at, supplier').eq('id', b.reference_id).maybeSingle();
            compra = c ?? null;
          }
        }
        if (!compra && valor && !guia) {
          const base = new Date(pd.criada_em).getTime();
          const { data: cs } = await admin.from('fin_purchases').select('id, delivery_confirmed_at, supplier, purchase_date')
            .eq('tenant_id', tid).gte('total_amount', valor - 0.01).lte('total_amount', valor + 0.01)
            .gte('purchase_date', new Date(base - 20 * 86400_000).toISOString().slice(0, 10))
            .lte('purchase_date', new Date(base + 5 * 86400_000).toISOString().slice(0, 10)).limit(5);
          const w = palavra(para);
          const achadas = (cs ?? []).filter((c) => !w || norm(c.supplier).includes(w));
          if (achadas.length === 1) compra = achadas[0];
        }
        info[pd.id] = {
          para, valor, tipo: pays[0]?.kind ?? ext.tipo ?? null,
          compra_lancada: !!compra, guia,
          recebido: compra ? !!compra.delivery_confirmed_at : null,
          recebido_em: compra?.delivery_confirmed_at ?? null,
        };
      }
      return json({ success: true, data: { info } });
    }

    if (action === 'contas_sem_dre') {
      const tenantId = String(body.tenant_id ?? '');
      if (!(await ehGestor(admin, user.id, tenantId))) return fail('Sem acesso a essa loja.', 403);
      const [contas, cats] = await Promise.all([
        admin.from('fin_accounts_payable')
          .select('id, description, amount, due_date, supplier, category, reference_type')
          .eq('tenant_id', tenantId).is('dre_category_id', null).neq('status', 'cancelled')
          .order('due_date', { ascending: true }).limit(100),
        // Receita e imposto a DRE não subtrai como despesa (mesma recusa do pay_bill).
        admin.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId)
          .is('deleted_at', null).eq('is_active', true).not('group_type', 'in', '(revenue,tax)').order('name'),
      ]);
      if (contas.error) throw new Error(contas.error.message);
      const lista = (contas.data ?? []).filter((c) => !['purchase', 'hr_payroll'].includes(String(c.reference_type ?? '')));
      return json({ success: true, data: { contas: lista, categorias: cats.data ?? [] } });
    }

    if (action === 'conta_dre') {
      const tenantId = String(body.tenant_id ?? '');
      const billId = String(body.bill_id ?? '');
      const catId = String(body.dre_category_id ?? '');
      if (!tenantId || !billId || !catId) return fail('Dados incompletos para classificar.');
      if (!(await ehGestor(admin, user.id, tenantId))) return fail('Sem acesso a essa loja.', 403);
      const { data: cat } = await admin.from('fin_dre_categories').select('id, name, group_type')
        .eq('id', catId).eq('tenant_id', tenantId).is('deleted_at', null).maybeSingle();
      if (!cat || ['revenue', 'tax'].includes(String(cat.group_type))) return fail('Categoria inválida para despesa.');
      // `is null`: se alguém classificou pela tela ou pela enquete nesse meio-tempo, não sobrescreve.
      const { data: feito, error } = await admin.from('fin_accounts_payable').update({ dre_category_id: catId })
        .eq('id', billId).eq('tenant_id', tenantId).is('dre_category_id', null).select('id');
      if (error) return fail(error.message);
      log('INFO', 'conta classificada na DRE pelo chat', { tenant: tenantId, bill: billId, cat: cat.name });
      await syncPendenciaContagem(admin, tenantId, 'conta_sem_dre').catch(() => null);
      return json({ success: true, data: { ok: true, ja: !feito?.length } });
    }

    // Pedido de pagamento do grupo que não virou pagamento (faltou dado): a mensagem que o gerou,
    // na conversa do grupo no chat. O gatilho gravado pelo brain traz "solicitacao_grupo_id = N".
    if (action === 'pedido_origem') {
      const { data: pend } = await admin.from('pendencias').select('kind, ref, tenant_id').eq('id', String(body.id ?? '')).maybeSingle();
      if (!pend || pend.kind !== 'pagamento_grupo') return fail('Pendência não encontrada.', 404);
      if (!(await ehGestor(admin, user.id, String(pend.tenant_id)))) return fail('Sem acesso a essa loja.', 403);
      const { data: rq } = await admin.from('asst_group_requests').select('id, group_jid').eq('id', Number(pend.ref)).maybeSingle();
      if (!rq) return fail('Pedido do grupo não encontrado.', 404);
      const { data: m } = await admin.from('asst_messages').select('id').eq('chat_id', chatKey).eq('role', 'user')
        .eq('group_jid', rq.group_jid).like('content', `%solicitacao_grupo_id = ${rq.id}%`).order('id').limit(1).maybeSingle();
      return json({ success: true, data: { group_jid: rq.group_jid, message_id: m?.id ?? null } });
    }

    return fail('Ação desconhecida.');
  } catch (e) {
    log('ERROR', 'falha', { action, error: errMsg(e) });
    return fail(errMsg(e), 500);
  }
});

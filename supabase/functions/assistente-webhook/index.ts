// assistente-webhook — ponte entre o WhatsApp (Evolution API na VPS) e o
// assistente-brain. Projeto PESSOAL do dono; ver assistente/README.md.
//
// Evolution → POST aqui (eventos MESSAGES_UPSERT e MESSAGES_UPDATE, header x-internal-key).
// Feedback nativo: reação 👀/✅/⚠️/❌/👍 na mensagem do dono, "digitando…", enquete
// (menu de decisão), localização e cartão de contato pedidos pelo brain (actions).
// Só responde a chats listados em asst_settings.allowed_chat_ids; qualquer
// outro remetente é ignorado em silêncio (o JID fica no log para cadastro).
// Responde 200 imediatamente e processa em background (EdgeRuntime.waitUntil)
// para a Evolution não repetir o webhook por timeout.
//
// Mídia: áudio → transcrito pelo Whisper na VPS (sem custo por minuto) e vai ao
// brain como texto "[Áudio] ..."; foto/PDF → vão ao brain como anexo (Claude lê).
// Mensagem encaminhada ganha o prefixo "[Encaminhada]".
//
// Grupos (2026-09-12): foto e PDF também são LIDOS (brain › ler_midia) e o conteúdo
// fica em asst_group_messages; quando a mensagem é pedido de pagamento, a triagem
// prepara o pagamento no Inter e avisa o dono no Telegram (ver triarPagamento).
//
// Secrets: ASSISTENTE_INTERNAL_KEY, EVOLUTION_URL, EVOLUTION_API_KEY,
//          EVOLUTION_INSTANCE (padrão "assistente"), WHISPER_URL, WHISPER_API_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'assistente-webhook', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const evoUrl = (Deno.env.get('EVOLUTION_URL') ?? '').replace(/\/$/, '');
const evoKey = Deno.env.get('EVOLUTION_API_KEY') ?? '';
const evoInstance = Deno.env.get('EVOLUTION_INSTANCE') || 'assistente';
const whisperUrl = (Deno.env.get('WHISPER_URL') ?? '').replace(/\/$/, '');
const whisperKey = Deno.env.get('WHISPER_API_KEY') ?? '';

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
// Vocabulário para o Whisper (initial_prompt): sem isso "Paranaguá" virou "parar na água" (2026-09-12).
const WHISPER_PROMPT = 'Conversa sobre os restaurantes El Patrón em Paranaguá (PR), lojas Vila Leste e Paranaguá. Natalino, ERPOS, cardápio, fornecedor, conta a pagar, estoque, insumo, Pix, iFood, delivery, motoboy, hambúrguer, pastel, freezer, entrega.';

async function evo(path: string, body: unknown) {
  const r = await fetch(`${evoUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: evoKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Evolution ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json().catch(() => ({}));
}

// deno-lint-ignore no-explicit-any
const sendText = (number: string, text: string): Promise<any> => evo(`/message/sendText/${evoInstance}`, { number, text });
// Resposta CITANDO a mensagem do dono (2026-09-20): ele manda várias notas seguidas e as respostas
// chegavam soltas — não dava para saber de qual nota o assistente estava falando. Sem a chave da
// mensagem (ou se a citação falhar), manda solto como antes.
// deno-lint-ignore no-explicit-any
async function sendReply(number: string, text: string, key: MsgKey | null, trecho = ''): Promise<any> {
  if (!key) return sendText(number, text);
  try {
    return await evo(`/message/sendText/${evoInstance}`, { number, text, quoted: { key, message: { conversation: trecho.slice(0, 200) } } });
  } catch (e) {
    log('WARN', 'citar mensagem falhou; mandando solto', { error: errMsg(e) });
    return sendText(number, text);
  }
}

// ── Recursos nativos do WhatsApp (feedback sem gastar tokens) ──
type MsgKey = { remoteJid: string; fromMe: boolean; id: string };
// Reação na mensagem do dono: 👀 recebi / ✅ respondi / ⚠️ respondi com falha / ❌ erro / 👍 sem resposta. '' remove.
const react = (key: MsgKey, emoji: string) =>
  evo(`/message/sendReaction/${evoInstance}`, { key, reaction: emoji }).catch((e) => log('WARN', 'sendReaction falhou', { error: errMsg(e) }));
// "digitando…"/"gravando…" por até `ms` (a Evolution segura a requisição pelo tempo
// todo, então NUNCA aguardar: dispara e segue). Some sozinho quando a resposta sai.
const presence = (number: string, kind: 'composing' | 'recording', ms: number) => {
  evo(`/chat/sendPresence/${evoInstance}`, { number, presence: kind, delay: ms }).catch(() => {});
};
// Edita uma mensagem NOSSA já enviada (usado no modo "⏳ → resposta", opcional).
const editText = (number: string, key: MsgKey, text: string) =>
  evo(`/chat/updateMessage/${evoInstance}`, { number, key, text });

// Ações que o brain pediu (enquete, localização, contato) — vão DEPOIS do texto.
// deno-lint-ignore no-explicit-any
async function runActions(admin: SupabaseClient, number: string, chatId: string, actions: any[]) {
  for (const a of Array.isArray(actions) ? actions : []) {
    try {
      if (a.type === 'poll') {
        const out = await evo(`/message/sendPoll/${evoInstance}`, { number, name: a.question, selectableCount: a.selectable ?? 1, values: a.options });
        const id = out?.key?.id ? String(out.key.id) : null;
        if (id) await admin.from('asst_polls').insert({ message_id: id, chat_id: chatId, question: String(a.question), options: a.options });
        else log('WARN', 'sendPoll sem key.id', { out: JSON.stringify(out).slice(0, 300) });
      } else if (a.type === 'location') {
        await evo(`/message/sendLocation/${evoInstance}`, { number, name: a.name, address: a.address ?? '', latitude: a.lat, longitude: a.lng });
      } else if (a.type === 'contact') {
        await evo(`/message/sendContact/${evoInstance}`, { number, contact: [{ fullName: a.name, wuid: a.phone, phoneNumber: `+${a.phone}`, ...(a.org ? { organization: a.org } : {}) }] });
      }
    } catch (e) {
      log('WARN', 'ação falhou', { type: a?.type, error: errMsg(e) });
      await sendText(number, `Não consegui enviar ${a?.type === 'poll' ? 'a enquete' : a?.type === 'location' ? 'a localização' : 'o contato'} (${errMsg(e).slice(0, 120)}).`).catch(() => {});
    }
  }
}

// Debounce: no WhatsApp é comum mandar 2–3 mensagens seguidas. Cada mensagem entra
// em asst_inbox e espera DEBOUNCE_MS; se chegou outra depois dela, sai (a mais nova
// responde por todas). A última pega todas as pendentes e manda juntas ao brain:
// 1 chamada ao Claude e 1 resposta coerente em vez de 3. Devolve também as chaves
// das mensagens do lote (para a reação final em todas).
const DEBOUNCE_MS = 3000;
async function debounce(admin: SupabaseClient, chatId: string, text: string, key: MsgKey | null): Promise<{ text: string; keys: MsgKey[] } | null> {
  const { data: row, error } = await admin.from('asst_inbox').insert({ chat_id: chatId, text, message_key: key }).select('id').single();
  if (error || !row) return { text, keys: key ? [key] : [] }; // sem fila: responde só esta
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const { data: newer } = await admin.from('asst_inbox').select('id')
    .eq('chat_id', chatId).is('processed_at', null).gt('id', row.id).limit(1);
  if (newer?.length) return null;
  const { data: batch } = await admin.from('asst_inbox').update({ processed_at: new Date().toISOString() })
    .eq('chat_id', chatId).is('processed_at', null).select('id, text, message_key');
  if (!batch?.length) return null;
  const sorted = batch.sort((a, b) => Number(a.id) - Number(b.id));
  return { text: sorted.map((b) => String(b.text)).join('\n'), keys: sorted.map((b) => b.message_key as MsgKey | null).filter((k): k is MsgKey => !!k?.id) };
}

// Voto em enquete: a Evolution manda MESSAGES_UPDATE com pollUpdates (opções + votantes)
// depois de decifrar. Achamos a enquete em asst_polls pela chave da mensagem e
// transformamos em texto para o brain ("[Enquete "X"] Resposta: Y").
// deno-lint-ignore no-explicit-any
async function pollVoteText(admin: SupabaseClient, data: any): Promise<{ text: string; chatId: string; kind: string | null; ref: any; chosen: string[] } | null> {
  const pollId = String(data?.key?.id ?? data?.keyId ?? data?.pollCreationMessageKey?.id ?? '');
  // deno-lint-ignore no-explicit-any
  const updates: any[] = Array.isArray(data?.pollUpdates) ? data.pollUpdates : Array.isArray(data?.message?.pollUpdates) ? data.message.pollUpdates : [];
  if (!pollId || !updates.length) return null;
  const { data: poll } = await admin.from('asst_polls').select('message_id, chat_id, question, options, kind, ref').eq('message_id', pollId).maybeSingle();
  if (!poll) return null;
  const chosen = updates.filter((u) => Array.isArray(u?.voters) ? u.voters.length > 0 : !!u?.name).map((u) => String(u.name)).filter(Boolean);
  if (!chosen.length) return null; // desmarcou tudo
  await admin.from('asst_polls').update({ answered_at: new Date().toISOString(), answer: chosen }).eq('message_id', pollId);
  return { text: `[Enquete "${poll.question}"] Resposta: ${chosen.join(', ')}`, chatId: String(poll.chat_id), kind: poll.kind ?? null, ref: poll.ref ?? null, chosen };
}

// Enquete do sistema "qual a classificação DRE desta conta?" (asst_polls.kind =
// 'dre_category', enviada pelo assistente-cron). O voto grava direto na conta, sem
// passar pelo modelo. Grupo sem categoria → reaproveita/cria a categoria raiz com o
// nome do grupo (mesma regra do pay_bill e do catálogo de compras).
// deno-lint-ignore no-explicit-any
async function handleDreVote(admin: SupabaseClient, ref: any, chosen: string[]): Promise<string> {
  // deno-lint-ignore no-explicit-any
  const opt = (Array.isArray(ref?.options) ? ref.options : []).find((o: any) => o?.label === chosen[0]);
  if (!opt) return 'Não entendi a opção dessa enquete; classifica no sistema, por favor.';
  return applyDreChoice(admin, ref, opt);
}

// Pergunta DRE em TEXTO (a enquete foi abandonada: o voto não chegava). Interpreta a
// resposta do dono: número da lista, "Grupo" ou "Grupo Categoria nova", nome exato de
// uma categoria, ou "pular". Devolve null se o texto não parece resposta.
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
// deno-lint-ignore no-explicit-any
function dreAnswer(text: string, ref: any): any | null {
  const t = text.trim();
  const n = semAcento(t);
  if (/^(pular|pula|depois|nao sei|eu classifico|no sistema)\b/.test(n)) return { skip: true };
  // deno-lint-ignore no-explicit-any
  const options: any[] = Array.isArray(ref?.options) ? ref.options : [];
  const num = n.match(/^(?:opcao |op |n )?(\d{1,2})\.?$/);
  if (num) return options.find((o) => Number(o.n) === Number(num[1])) ?? { invalid: true };
  const exata = options.find((o) => semAcento(String(o.label)) === n || semAcento(String(o.label).split('›').pop() ?? '') === n);
  if (exata) return exata;
  // deno-lint-ignore no-explicit-any
  const groups: any[] = (Array.isArray(ref?.groups) ? ref.groups : []).slice().sort((a: any, b: any) => String(b.label).length - String(a.label).length);
  for (const g of groups) {
    const gl = semAcento(String(g.label));
    if (n === gl) return { group: g.key, name: g.label, label: g.label };
    if (n.startsWith(gl + ' ')) {
      const nome = t.split(/\s+/).slice(gl.split(' ').length).join(' ').replace(/^[›>:\-–]+/, '').trim();
      if (!nome) return { group: g.key, name: g.label, label: g.label };
      const nomeFmt = nome.charAt(0).toUpperCase() + nome.slice(1);
      return { group: g.key, name: nomeFmt, label: `${g.label} › ${nomeFmt}` };
    }
  }
  return null;
}

// Pergunta DRE aberta a que esta mensagem responde: a citada (reply) ou, sem citação,
// a única em aberto — e aí só se o texto parece resposta.
// deno-lint-ignore no-explicit-any
async function tryDreAnswer(admin: SupabaseClient, number: string, chatId: string, text: string, stanzaId: string | null, msgKey: MsgKey | null): Promise<boolean> {
  if (!text) return false;
  const q = admin.from('asst_polls').select('message_id, ref').eq('kind', 'dre_category').is('answered_at', null);
  const { data: rows } = stanzaId ? await q.eq('message_id', stanzaId) : await q.order('created_at', { ascending: false }).limit(2);
  if (!rows?.length || (!stanzaId && rows.length > 1)) return false;
  const row = rows[0];
  const opt = dreAnswer(text, row.ref);
  if (!opt && !stanzaId) return false; // sem citação e não parece resposta → conversa normal
  if (!opt || opt.invalid) {
    await sendText(number, `Não entendi. Responde com o *número* da lista, com o grupo + nome de uma categoria nova (ex.: _Despesas fixas Consultoria_) ou "pular".`).catch(() => {});
    if (msgKey) react(msgKey, '❓');
    return true;
  }
  await admin.from('asst_polls').update({ answered_at: new Date().toISOString(), answer: [text] }).eq('message_id', row.message_id);
  const reply = await applyDreChoice(admin, row.ref, opt).catch((e) => { log('ERROR', 'resposta DRE', { error: errMsg(e) }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; });
  await sendText(number, reply).catch(() => {});
  if (msgKey) react(msgKey, reply.startsWith('✅') ? '✅' : '👍');
  await admin.from('asst_messages').insert([
    { channel: 'whatsapp', chat_id: chatId, role: 'user', content: text },
    { channel: 'cron', chat_id: chatId, role: 'assistant', content: reply },
  ]);
  // Próxima pergunta já (sem esperar o tick do cron)
  fetch(`${supabaseUrl}/functions/v1/assistente-cron`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({ run: 'dre_classify' }),
  }).catch((e) => log('WARN', 'próxima pergunta DRE', { error: errMsg(e) }));
  return true;
}

// deno-lint-ignore no-explicit-any
async function applyDreChoice(admin: SupabaseClient, ref: any, opt: any): Promise<string> {
  const tenantId = String(ref?.tenant_id ?? '');
  const billId = String(ref?.bill_id ?? '');
  if (!tenantId || !billId) return 'Não achei a conta dessa pergunta; classifica no sistema, por favor.';
  const { data: bill } = await admin.from('fin_accounts_payable').select('id, description, amount, dre_category_id')
    .eq('id', billId).eq('tenant_id', tenantId).maybeSingle();
  if (!bill) return 'Essa conta não existe mais no sistema.';
  const desc = `${bill.description} (${Number(bill.amount).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })})`;
  if (opt.skip) return `Ok, fica pra você classificar no sistema: ${desc}.`;
  if (bill.dre_category_id) return `Essa conta já tinha sido classificada no sistema: ${desc}.`;

  let catId: string | null = opt.category_id ?? null;
  if (!catId && opt.group) {
    const nome = String(opt.name ?? opt.label).trim();
    const { data: cats } = await admin.from('fin_dre_categories').select('id, name').eq('tenant_id', tenantId).eq('group_type', opt.group);
    catId = (cats ?? []).find((c) => String(c.name).trim().toLowerCase() === nome.toLowerCase())?.id ?? null;
    if (!catId) {
      const { data: nova, error } = await admin.from('fin_dre_categories')
        .insert({ tenant_id: tenantId, name: nome, group_type: opt.group, sort_order: 0, is_active: true }).select('id').single();
      if (error || !nova) { log('ERROR', 'criar categoria DRE falhou', { tenantId, error: error?.message }); return 'Não consegui criar a categoria; classifica no sistema, por favor.'; }
      catId = nova.id;
    }
  }
  const { error } = await admin.from('fin_accounts_payable').update({ dre_category_id: catId })
    .eq('id', billId).eq('tenant_id', tenantId).is('dre_category_id', null);
  if (error) { log('ERROR', 'classificar conta falhou', { billId, error: error.message }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; }
  return `✅ Classificada em *${opt.label}*: ${desc}.`;
}

// deno-lint-ignore no-explicit-any
async function evoGet(path: string): Promise<any> {
  const r = await fetch(`${evoUrl}${path}`, { headers: { apikey: evoKey } });
  if (!r.ok) throw new Error(`Evolution ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json().catch(() => ({}));
}

// ── Leitura de mídia de grupo e triagem de pedido de pagamento (2026-09-12) ──
// Antes, foto/PDF de grupo viravam só "[Foto]" e o assistente não sabia o que havia
// na imagem. Agora a mídia é baixada e LIDA pelo brain (action 'ler_midia'): o
// conteúdo vai para asst_group_messages.content/extracted. Quando a mensagem é um
// PEDIDO DE PAGAMENTO (boleto, Pix), a triagem chama o brain em modo
// 'triagem_grupo', que prepara o pagamento no Inter e avisa o dono no Telegram com
// os botões Pagar/Cancelar — PIN e aprovação no app do Inter continuam valendo.
// Liga/desliga em asst_settings.group_watch { read_media, pay_requests, max_per_day }.
const GROUP_WATCH_DEFAULTS = { read_media: true, pay_requests: true, max_per_day: 30 };
// Pré-filtro barato: só chama o modelo quando o texto cheira a pedido de pagamento.
const PAY_HINT = /\bpag(a|ar|ue|uei|amento|amentos)\b|\bboleto|\bpix\b|linha digit|c[óo]digo de barras|copia e cola|transfer[êe]ncia|\bdep[óo]sit|vencimento|\bvence(u|ndo)?\b|\bfatura|cobran[çc]a|\bquita/i;
const DOC_READABLE = (mime: string | null) => mime === 'application/pdf' || IMAGE_TYPES.includes(String(mime ?? ''));

// deno-lint-ignore no-explicit-any
async function brainCall(body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify(body),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
  return out;
}

// Foto/PDF → { tipo_documento, resumo, texto, pagamento }. Erro aqui nunca derruba
// a gravação da mensagem: sem leitura, a mensagem fica como era antes ("[Foto]").
// deno-lint-ignore no-explicit-any
async function lerMidia(b64: string, mime: string | null, legenda: string, contexto: string, chatId: string): Promise<any | null> {
  const out = await brainCall({
    action: 'ler_midia', attachment: { base64: b64, media_type: mime ?? 'image/jpeg' },
    legenda, contexto, chat_id: chatId, channel: 'grupo',
  });
  return out?.lido ?? null;
}

// Destino do aviso ao dono. Pagamento com botões só existe no Telegram, então ele
// tem preferência; sem Telegram, avisa no WhatsApp (o brain recusa preparar_pagamento
// e responde dizendo que precisa ser pelo Telegram).
// deno-lint-ignore no-explicit-any
function ownerChatOf(cfg: Record<string, any>): string | null {
  const tg = cfg.telegram_owner_chat_id ? `tg:${cfg.telegram_owner_chat_id}` : null;
  const wa = typeof cfg.owner_chat_id === 'string' && cfg.owner_chat_id ? cfg.owner_chat_id : null;
  return tg ?? wa;
}

// Entrega o aviso (texto + ações, inclusive o cartão de pagamento com botões).
// No Telegram quem monta o cartão é o assistente-telegram (action 'deliver').
// deno-lint-ignore no-explicit-any
async function avisarDono(admin: SupabaseClient, ownerChat: string, reply: string, actions: any[], extra: Record<string, unknown> = {}) {
  if (ownerChat.startsWith('tg:')) {
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'deliver', chat_key: ownerChat, text: reply, actions, ...extra }),
    });
    if (!r.ok) throw new Error(`assistente-telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  const number = ownerChat.replace(/@.*$/, '');
  await sendText(number, reply);
  await runActions(admin, number, ownerChat, actions);
}

// ── Caixa de pendências (2026-09-18) ────────────────────────────────────────
// O rascunho do Inter expira em 30 min (segurança: um toque no dia seguinte não pode
// disparar um Pix velho), e o cartão do Telegram rola para cima. Antes disso, um pedido
// não atendido não deixava rastro em lugar nenhum — caso real: pedido às 21h, ninguém
// pagou, e no dia seguinte não havia onde ver que existia. Agora toda triagem abre uma
// linha em `pendencias`, que só sai de lá por ação do dono ou pelo pagamento concluído.
//
// asst_groups não tem tenant_id (o grupo é do WhatsApp, não da loja), então a loja vem
// do pagamento preparado; sem pagamento (triagem incompleta ou que quebrou) cai na loja
// padrão do assistente.
// deno-lint-ignore no-explicit-any
async function pendenciaTenant(admin: SupabaseClient, cfg: Record<string, any>, paymentIds: string[]): Promise<string | null> {
  if (paymentIds.length) {
    const { data } = await admin.from('fin_inter_payments').select('tenant_id').in('id', paymentIds).limit(1);
    if (data?.length) return String(data[0].tenant_id);
  }
  // Loja do Inter ANTES da loja padrão do assistente: é para lá que o pagamento iria
  // (assistente-brain › interTenant faz a mesma escolha). Com a ordem invertida, um pedido
  // que a triagem não conseguiu preparar caía na caixa de uma loja e o mesmo pedido, se
  // preparado, na de outra — visto em produção: grupo "EP MALL", pagamento em Paranaguá.
  const { data: inter } = await admin.from('fin_inter_config').select('tenant_id').eq('is_active', true).limit(1);
  if (inter?.length) return String(inter[0].tenant_id);
  const padrao = String(cfg.default_tenant_id ?? '');
  if (padrao) return padrao;
  const watched = Array.isArray(cfg.watched_tenant_ids) ? cfg.watched_tenant_ids.map(String) : [];
  return watched.length ? watched[0] : null;
}

// null/'' viram 0 no Number(), e "R$ 0,00" no título seria pior que não mostrar valor nenhum.
const brlPend = (n: unknown) => {
  if (n === null || n === undefined || n === '') return null;
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) : null;
};

// Nunca deixa a triagem cair por causa da pendência: o pedido do grupo é o que importa.
// deno-lint-ignore no-explicit-any
async function abrirPendenciaPagamento(
  admin: SupabaseClient, cfg: Record<string, any>, reqId: number, g: any,
  msg: { sender: string | null; extracted: any }, detalhe: string | null, paymentIds: string[],
) {
  try {
    const tenant = await pendenciaTenant(admin, cfg, paymentIds);
    if (!tenant) { log('WARN', 'pendência sem loja para atribuir', { pedido: reqId }); return; }
    // Mesma cobrança em duas mensagens (2026-09-18: foto do boleto + "a fatura da claro 👆"): o
    // inter-bank devolve o rascunho que já existe, ligado ao pedido da 1ª mensagem. Esse pedido já
    // tem a pendência dele — uma segunda seria dois botões "Pagar" para a mesma conta.
    if (paymentIds.length) {
      const { data: donos } = await admin.from('fin_inter_payments').select('id, group_request_id').in('id', paymentIds);
      const deOutro = (donos ?? []).filter((x) => x.group_request_id != null && Number(x.group_request_id) !== reqId);
      if (deOutro.length === paymentIds.length) {
        log('INFO', 'pendência não aberta: mesmo pagamento de outro pedido', { pedido: reqId, de: deOutro[0].group_request_id });
        return;
      }
    }
    // Sem pagamento preparado nem sempre é "falta fazer" (dono, 2026-09-18). Não vira pendência:
    //  - o que a leitura diz que NÃO é pedido (cupom pago em dinheiro, comprovante);
    //  - o que já tem conta a pagar em aberto com o mesmo valor (nota de recebimento de mercadoria
    //    com fatura para daqui a 15 dias): quem cobra é Contas a pagar, pelo vencimento.
    if (!paymentIds.length) {
      const pg = msg.extracted?.pagamento ?? null;
      if (pg && pg.e_solicitacao === false) { log('INFO', 'pendência não aberta: não era pedido', { pedido: reqId }); return; }
      const valor = Number(pg?.valor ?? 0);
      if (valor > 0) {
        let q = admin.from('fin_accounts_payable').select('id').eq('tenant_id', tenant)
          .not('status', 'in', '(paid,cancelled)').gte('amount', valor - 0.01).lte('amount', valor + 0.01);
        if (/^\d{4}-\d{2}-\d{2}/.test(String(pg?.vencimento ?? ''))) q = q.eq('due_date', String(pg.vencimento).slice(0, 10));
        const { data: conta } = await q.limit(1);
        if (conta?.length) { log('INFO', 'pendência não aberta: conta a pagar já lançada', { pedido: reqId, conta: conta[0].id }); return; }
      }
    }
    const valor = brlPend(msg.extracted?.pagamento?.valor);
    const quem = msg.sender ? ` (${msg.sender})` : '';
    const { error } = await admin.rpc('fn_pendencia_upsert', {
      p_tenant: tenant,
      p_kind: 'pagamento_grupo',
      p_ref: String(reqId),
      p_titulo: `Pagamento pedido no grupo ${g.name ?? 'sem nome'}${quem}${valor ? ` — ${valor}` : ''}`,
      p_detalhe: detalhe ? detalhe.slice(0, 500) : null,
      p_payload: { group_jid: g.group_jid, group_name: g.name, sender: msg.sender, pagamentos: paymentIds, extraido: msg.extracted?.pagamento ?? null },
      p_rota: '/assistente',
      p_urgencia: 'alta',
      p_acao_requerida: true,
      p_origem: 'triagem_grupo',
    });
    if (error) log('WARN', 'abrir pendência de pagamento', { pedido: reqId, error: error.message });
  } catch (e) { log('WARN', 'abrir pendência de pagamento', { pedido: reqId, error: errMsg(e) }); }
}

// ── Recebimento pela foto da nota (2026-09-18) ─────────────────────────────
// Fluxo da loja: o fornecedor emite a NF-e para transportar (ela chega sozinha em Notas de entrada)
// e, quando a mercadoria chega, a loja tira foto da nota no grupo. A foto é a CONFIRMAÇÃO de que
// chegou — o que chegou está no XML. Acha a nota: 1º pela chave de acesso lida na foto; senão pelo
// número + valor total (nota dos últimos 60 dias).
// deno-lint-ignore no-explicit-any
async function notaDaFoto(admin: SupabaseClient, content: string, extracted: any): Promise<{ id: string; tenant_id: string } | null> {
  const texto = `${content}\n${String(extracted?.texto ?? '')}`;
  const chaves = [...texto.matchAll(/(?:\d[\s.]?){43}\d/g)].map((m) => m[0].replace(/\D/g, '')).filter((c) => c.length === 44);
  for (const chave of [...new Set(chaves)]) {
    const { data } = await admin.from('fiscal_inbound_documents').select('id, tenant_id').eq('chave', chave).maybeSingle();
    if (data) return { id: String(data.id), tenant_id: String(data.tenant_id) };
  }
  if (!/DANFE|NF-?e|nota fiscal/i.test(texto)) return null;
  const num = texto.match(/(?:DANFE|NF-?e)\s*(?:n[º°o.]*|n[úu]mero)?\s*:?\s*(\d{1,3}(?:\.\d{3})+|\d{3,9})/i)?.[1];
  const numero = num ? Number(num.replace(/\D/g, '')) : NaN;
  const vTxt = texto.match(/VALOR TOTAL DA NOTA\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1];
  const valor = vTxt ? Number(vTxt.replace(/\./g, '').replace(',', '.')) : Number(extracted?.pagamento?.valor ?? NaN);
  if (!Number.isFinite(numero) || !(valor > 0)) return null;
  const { data: cands } = await admin.from('fiscal_inbound_documents').select('id, tenant_id, valor_total')
    .eq('numero', numero).gte('emitted_at', new Date(Date.now() - 60 * 86400_000).toISOString());
  const hit = (cands ?? []).filter((c) => Math.abs(Number(c.valor_total) - valor) <= 0.02);
  return hit.length === 1 ? { id: String(hit[0].id), tenant_id: String(hit[0].tenant_id) } : null;
}

// DACTE cujo tomador do serviço não é nenhuma das lojas → CNPJ do tomador; senão null.
async function freteDeOutroTomador(admin: SupabaseClient, content: string): Promise<string | null> {
  if (!/DACTE|Conhecimento de Transporte/i.test(content)) return null;
  const m = content.match(/Tomador(?: do Servi[çc]o)?\s*:?\s*([\d./-]{14,20})/i);
  const tomador = m ? m[1].replace(/\D/g, '') : '';
  if (tomador.length !== 14) return null;
  const { data: lojas } = await admin.from('tenants').select('cnpj');
  const nossos = new Set((lojas ?? []).map((t) => String(t.cnpj ?? '').replace(/\D/g, '')).filter(Boolean));
  return nossos.has(tomador) ? null : tomador.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5');
}

// deno-lint-ignore no-explicit-any
async function recebimentoPorNota(admin: SupabaseClient, cfg: Record<string, any>, g: any | null, msg: { messageId: string | null; sender: string | null; content: string; extracted: any; sentAt: string }, nota: { id: string; tenant_id: string }) {
  // Sem grupo (nota que o dono encaminhou no WhatsApp): não existe pedido de grupo para registrar.
  const { data: req, error } = g ? await admin.from('asst_group_requests').insert({
    message_id: msg.messageId, group_jid: g.group_jid, group_name: g.name, sender_name: msg.sender,
    kind: 'compra', status: 'novo', data: { texto: msg.content, extraido: msg.extracted, sent_at: msg.sentAt, nota_entrada_id: nota.id },
  }).select('id').maybeSingle() : { data: null, error: null };
  if (g && (error || !req)) { if (error && !/duplicate|unique/i.test(error.message)) log('WARN', 'gravar recebimento', { error: error.message }); return; }
  // deno-lint-ignore no-explicit-any
  let r: any = null;
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'recebimento_nota', document_id: nota.id, origem: g ? `foto da nota no grupo ${g.name ?? ''}`.trim() : 'nota encaminhada pelo dono no WhatsApp' }),
    });
    r = await resp.json().catch(() => null);
  } catch (e) { r = { ok: false, erro: errMsg(e) }; }
  const brlN = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const venc = (Array.isArray(r?.parcelas) ? r.parcelas : []).map((p: { vencimento?: string; valor?: number }) => `${String(p.vencimento ?? '').split('-').reverse().join('/')} (${brlN(p.valor)})`).join(', ');
  const cab = `📦 *Recebimento — ${r?.fornecedor ?? 'nota'}* (NF ${r?.numero ?? '?'}, ${brlN(r?.total)}) — ${g ? `${msg.sender ?? 'loja'} no grupo ${g.name ?? ''}` : 'nota que você encaminhou'}`;
  const linhas: string[] = [cab];
  if (!r?.ok) linhas.push(`⚠️ Não consegui lançar pela nota: ${r?.erro ?? 'erro'}. Lance em Notas de entrada.`);
  else if (r.despesa) linhas.push('A nota já estava lançada como despesa.');
  else {
    linhas.push(r.lancou ? `Compra lançada pelo XML da nota (${r.itens} itens, com frete e impostos).` : 'A compra dessa nota já estava lançada.');
    linhas.push(r.confirmou ? '✅ Recebimento confirmado: o estoque entrou.' : r.ja_recebida ? 'O recebimento já tinha sido confirmado.' : `⚠️ Recebimento não confirmado: ${r.erro_recebimento ?? 'erro'}.`);
    if (r.sem_insumo?.length) linhas.push(`Sem insumo ligado (não entram no estoque): ${r.sem_insumo.slice(0, 6).join('; ')}${r.sem_insumo.length > 6 ? '…' : ''}`);
    if (venc) linhas.push(`Boleto em Contas a pagar: ${venc}.`);
  }
  if (req) await admin.from('asst_group_requests').update({ status: r?.ok ? 'lancado' : 'erro', reply: linhas.join('\n').slice(0, 2000), updated_at: new Date().toISOString() }).eq('id', req.id);
  const ownerChat = ownerChatOf(cfg);
  if (ownerChat?.startsWith('tg:')) {
    await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'deliver', chat_key: ownerChat, save: true, topic: 'compras', text: linhas.join('\n'),
        actions: [{ type: 'abrir', label: 'Ver a compra', rota: '/financeiro?tab=compras' }] }),
    }).catch((e) => log('WARN', 'aviso de recebimento', { error: errMsg(e) }));
  }
  log('INFO', 'recebimento pela nota', { group: g?.name ?? 'encaminhada', doc: nota.id, ok: !!r?.ok, lancou: r?.lancou, confirmou: r?.confirmou });
}

// ── Nota encaminhada pelo dono no WhatsApp (2026-09-20) ─────────────────────
// O assistente só lê o grupo do financeiro desde que entrou nele: as notas anteriores ficaram de fora.
// Agora o dono escreve "compras" (abre 1 h de recebimento, igual aos currículos) e vai encaminhando as
// fotos/PDFs; cada arquivo entra pelo MESMO caminho do grupo — nota que já está em Notas de entrada vira
// RECEBIMENTO (compra pelo XML, estoque), cupom/nota lida vira ENTRADA DE COMPRA. "pronto" encerra.
const COMPRA_ABRE = /^(compras?|notas?( de compra| fiscais| fiscal)?|vou (te )?mandar (as )?(notas?|compras?|cupons?))[\s!.,]*$/i;
const COMPRA_LEGENDA = /\b(compra|nota|cupom|nfe|nf-e)\b/i;

async function compraIntake(admin: SupabaseClient): Promise<{ until: string; count: number } | null> {
  const { data } = await admin.from('asst_settings').select('value').eq('key', 'wa_compra_intake').maybeSingle();
  // deno-lint-ignore no-explicit-any
  const v: any = data?.value;
  return v?.until && new Date(v.until).getTime() > Date.now() ? { until: String(v.until), count: Number(v.count ?? 0) } : null;
}
async function compraIntakeSet(admin: SupabaseClient, count: number) {
  await admin.from('asst_settings').upsert({
    key: 'wa_compra_intake', value: { until: new Date(Date.now() + 60 * 60_000).toISOString(), count },
    updated_at: new Date().toISOString(),
  });
}

// Conferência de duplicidade antes de lançar (dono, 2026-09-20): nota encaminhada pode já ter sido
// lançada pelo grupo, pelo XML da SEFAZ ou na mão. Regra: mesmo número de documento, ou mesmo valor
// com data até 3 dias de distância. Achou → NÃO lança; avisa e espera "lançar mesmo assim".
const NUM_NOTA = /(?:n[º°o.]?\s*|n[úu]mero\s*:?\s*|NFC?-?e\s*n?[º°o.]?\s*|cupom\s*(?:fiscal)?\s*n?[º°o.]?\s*)(\d{3,9})/i;
const DATA_BR = /(\d{2})\/(\d{2})\/(\d{4})/;

// deno-lint-ignore no-explicit-any
function dadosDaNota(content: string, extracted: any): { valor: number | null; dia: string | null; numero: string | null } {
  const texto = `${content}\n${String(extracted?.texto ?? '')}`;
  const somaItens = (Array.isArray(extracted?.itens) ? extracted.itens : [])
    .reduce((a: number, i: { valor_total?: number }) => a + Number(i?.valor_total ?? 0), 0);
  const totalTxt = texto.match(/(?:VALOR\s+TOTAL(?:\s+DA\s+NOTA)?|TOTAL\s+A?\s*PAGAR|VALOR\s+A\s+PAGAR|\bTOTAL\b)\s*:?\s*(?:R\$\s*)?([\d.]+,\d{2})/i)?.[1];
  const valor = totalTxt ? Number(totalTxt.replace(/\./g, '').replace(',', '.'))
    : Number(extracted?.pagamento?.valor ?? NaN) || (somaItens > 0 ? Number(somaItens.toFixed(2)) : NaN);
  const d = texto.match(DATA_BR);
  return {
    valor: Number.isFinite(valor) && valor > 0 ? valor : null,
    dia: d ? `${d[3]}-${d[2]}-${d[1]}` : null,
    numero: texto.match(NUM_NOTA)?.[1] ?? null,
  };
}

async function compraDuplicada(admin: SupabaseClient, d: { valor: number | null; dia: string | null; numero: string | null }) {
  const fmt = (r: Record<string, unknown>) =>
    `${String(r.supplier ?? 'fornecedor')} — ${Number(r.total_amount ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} em ${String(r.purchase_date ?? '').split('-').reverse().join('/')}${r.invoice_number ? ` (nota ${r.invoice_number})` : ''}`;
  if (d.numero) {
    // Número sozinho repete entre fornecedores ("nota 257"): com valor lido, ele também tem que bater.
    let q = admin.from('fin_purchases').select('id, supplier, total_amount, purchase_date, invoice_number').eq('invoice_number', d.numero);
    if (d.valor) q = q.gte('total_amount', d.valor - 0.02).lte('total_amount', d.valor + 0.02);
    const { data } = await q.limit(1);
    if (data?.length) return { texto: fmt(data[0]), por: d.valor ? 'mesmo número e valor' : 'número da nota' };
  }
  if (d.valor) {
    const base = d.dia ?? new Date().toISOString().slice(0, 10);
    const dias = (n: number) => new Date(Date.parse(`${base}T12:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
    const { data } = await admin.from('fin_purchases').select('id, supplier, total_amount, purchase_date, invoice_number')
      .gte('total_amount', d.valor - 0.02).lte('total_amount', d.valor + 0.02)
      .gte('purchase_date', dias(-3)).lte('purchase_date', dias(3)).limit(1);
    if (data?.length) return { texto: fmt(data[0]), por: 'mesmo valor e data próxima' };
  }
  return null;
}

// deno-lint-ignore no-explicit-any
async function notaEncaminhada(admin: SupabaseClient, cfg: Record<string, any>, replyTo: string, msgKey: MsgKey | null, data: any, p: Parsed, forcar = false): Promise<boolean> {
  if (msgKey) react(msgKey, '👀');
  const mime = String(p.mime ?? (p.kind === 'image' ? 'image/jpeg' : '')).split(';')[0].toLowerCase();
  if (!DOC_READABLE(mime)) { await sendReply(replyTo, 'Esse arquivo eu não consigo ler. Manda foto ou PDF da nota.', msgKey, citacao).catch(() => {}); return true; }
  const b64 = await mediaBase64(data).catch(() => null);
  if (!b64) { await sendReply(replyTo, 'Não consegui baixar o arquivo. Manda de novo?', msgKey, citacao).catch(() => {}); return true; }
  const legenda = String(p.text ?? '').trim();
  // deno-lint-ignore no-explicit-any
  let extracted: any = null;
  try {
    extracted = await lerMidia(b64, mime, legenda, 'Nota/cupom de compra que o DONO encaminhou no WhatsApp (compra antiga, fora do grupo).', 'dono:compras');
  } catch (e) { log('WARN', 'ler nota encaminhada', { error: errMsg(e) }); }
  if (!extracted) { await sendReply(replyTo, 'Não consegui ler essa imagem. Tenta uma foto mais nítida ou o PDF.', msgKey, citacao).catch(() => {}); return true; }
  const content = [`[Nota encaminhada por você]${legenda ? ` ${legenda}` : ''}`, String(extracted.resumo ?? '').trim(), String(extracted.texto ?? '').trim()].filter(Boolean).join('\n');
  const citacao = String(extracted.resumo ?? legenda ?? '').trim(); // trecho que aparece na citação
  const ownerChat = ownerChatOf(cfg);

  // 1) Já está em Notas de entrada (XML da SEFAZ): recebimento + compra pelo XML, como a foto no grupo.
  const nota = await notaDaFoto(admin, content, extracted).catch((e) => { log('WARN', 'procurar nota encaminhada', { error: errMsg(e) }); return null; });
  if (nota) {
    await recebimentoPorNota(admin, cfg, null, { messageId: msgKey?.id ?? null, sender: 'você', content, extracted, sentAt: new Date().toISOString() }, nota);
    await sendReply(replyTo, 'Achei essa nota nas Notas de entrada: lancei a compra pelo XML e confirmei o recebimento. O detalhe está no chat.', msgKey, citacao).catch(() => {});
    if (msgKey) react(msgKey, '✅');
    return true;
  }

  // 2) Cupom/nota lida com itens: entrada de compra (mesmas regras do grupo).
  const temItens = ['nota_fiscal', 'cupom', 'pedido'].includes(String(extracted.tipo_documento ?? '')) && Array.isArray(extracted.itens) && extracted.itens.length > 0;
  if (!temItens) {
    await sendReply(replyTo, 'Isso não parece nota ou cupom de compra — não lancei nada. Se for pagamento, me fala o que é.', msgKey, citacao).catch(() => {});
    return true;
  }
  // Já lançada? Só lança depois do "lançar mesmo assim" (a nota fica guardada por 1 h).
  const dados = dadosDaNota(content, extracted);
  const dup = forcar ? null : await compraDuplicada(admin, dados).catch((e) => { log('WARN', 'conferir duplicidade', { error: errMsg(e) }); return null; });

  const prompt = [
    '[Sistema] Nota/cupom de compra que o DONO encaminhou no WhatsApp (compra ANTIGA, que não passou pelo grupo).',
    `<nota_encaminhada quando="${new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}">`,
    content.replace(/<\/?nota_encaminhada[^>]*>/gi, '').slice(0, 3000),
    '</nota_encaminhada>',
    `Leitura automática do arquivo: ${JSON.stringify(extracted).slice(0, 12000)}`,
    'Siga as regras de ENTRADA DE COMPRA PELO GRUPO. Use a DATA DA NOTA (não a de hoje).',
    forcar ? 'O dono JÁ FOI AVISADO de que parecia repetida e confirmou: pode lançar.' : '',
  ].filter(Boolean).join('\n');
  if (dup) {
    await admin.from('asst_settings').upsert({
      key: 'wa_compra_pendente',
      value: { prompt, resumo: `${dados.valor ? brlPend(dados.valor) : 'sem valor lido'}${dados.numero ? ` · nota ${dados.numero}` : ''}`, until: new Date(Date.now() + 60 * 60_000).toISOString() },
      updated_at: new Date().toISOString(),
    });
    await sendReply(replyTo, `⚠️ Essa compra parece JÁ LANÇADA (${dup.por}):\n${dup.texto}\n\nNão lancei. Se for outra compra mesmo, responda "lançar mesmo assim".`, msgKey, citacao).catch(() => {});
    if (msgKey) react(msgKey, '⚠️');
    return true;
  }
  await lancarCompraPendente(admin, cfg, replyTo, msgKey, prompt, citacao);
  return true;
}

// Manda a nota para o brain lançar (entrada de compra) e devolve a resposta no WhatsApp e no chat.
// Usada logo depois de ler a nota e também no "lançar mesmo assim" (nota segurada pela duplicidade).
// deno-lint-ignore no-explicit-any
async function lancarCompraPendente(admin: SupabaseClient, cfg: Record<string, any>, replyTo: string, msgKey: MsgKey | null, prompt: string, citacao = '') {
  const ownerChat = ownerChatOf(cfg);
  try {
    const out = await brainCall({ text: prompt, chat_id: ownerChat ?? '', channel: ownerChat?.startsWith('tg:') ? 'telegram' : 'whatsapp', modo: 'entrada_compra_grupo' });
    const reply = String(out?.reply ?? '').trim();
    if (ownerChat && reply && reply !== 'NO_REPLY') {
      await avisarDono(admin, ownerChat, reply, Array.isArray(out?.actions) ? out.actions : [], { save: true, topic: 'compras' }).catch((e) => log('WARN', 'avisar dono da nota encaminhada', { error: errMsg(e) }));
    }
    await sendReply(replyTo, reply && reply !== 'NO_REPLY' ? reply.slice(0, 900) : 'Recebi a nota, mas não consegui lançar sozinho. Dá uma olhada em Compras.', msgKey, citacao).catch(() => {});
    if (msgKey) react(msgKey, '✅');
  } catch (e) {
    log('ERROR', 'lançar nota encaminhada', { error: errMsg(e) });
    await sendReply(replyTo, 'Deu erro para lançar essa nota. Tenta de novo daqui a pouco.', msgKey, citacao).catch(() => {});
  }
}

// Triagem: mensagem de grupo que parece pedido de pagamento → brain (modo
// 'triagem_grupo') → pagamento preparado + aviso ao dono. Uma linha por mensagem em
// asst_group_requests (message_id único), então reenvio do webhook não prepara 2×.
// deno-lint-ignore no-explicit-any
// tipo 'compra' (2026-09-13): cupom/nota de compra postado SEM pedido de pagamento (ex.: "chegou",
// mercado pago em dinheiro) → o brain (modo 'entrada_compra_grupo') lança a compra e avisa o dono.
async function triarPagamento(admin: SupabaseClient, cfg: Record<string, any>, g: any, msg: { messageId: string | null; sender: string | null; content: string; extracted: any; sentAt: string; legenda?: string }, tipo: 'pagamento' | 'compra' = 'pagamento') {
  const conf = { ...GROUP_WATCH_DEFAULTS, ...(cfg.group_watch && typeof cfg.group_watch === 'object' ? cfg.group_watch : {}) };
  if (tipo === 'pagamento' && conf.pay_requests === false) return;
  if (tipo === 'compra' && conf.purchase_entries === false) return;
  const ownerChat = ownerChatOf(cfg);
  if (!ownerChat) { log('WARN', 'pedido de pagamento sem destino', { group: g.name }); return; }
  // Trava de custo: no máximo N triagens por dia (mensagem de grupo é de terceiros).
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin.from('asst_group_requests').select('id', { count: 'exact', head: true }).gte('created_at', desde);
  if ((count ?? 0) >= Number(conf.max_per_day ?? 30)) { log('WARN', 'limite diário de triagem atingido', { count }); return; }
  // message_id único: se já existe, outra execução já cuidou deste pedido.
  const { data: req, error } = await admin.from('asst_group_requests').insert({
    message_id: msg.messageId, group_jid: g.group_jid, group_name: g.name, sender_name: msg.sender,
    kind: tipo, status: 'novo', data: { texto: msg.content, extraido: msg.extracted, sent_at: msg.sentAt },
  }).select('id').maybeSingle();
  if (error || !req) { if (error && !/duplicate|unique/i.test(error.message)) log('WARN', 'gravar solicitação', { error: error.message }); return; }

  // Guia do mês (DAS / DARF INSS / FGTS Digital) lida e CONFERIDA (dígitos/CRC): lança sem modelo
  // (2026-09-18). Antes as três guias chegaram juntas, o modelo errou dígitos, misturou uma na
  // resposta da outra e o DAS que só vence dia 21 virou pendência. Vence depois = só guarda (sem
  // pendência: o pagamento é preparado sozinho no dia); vence hoje = prepara e abre pendência.
  if (tipo === 'pagamento' && msg.extracted?.guia?.completa) {
    try {
      const r = await brainCall({ action: 'guia', guia: msg.extracted.guia, origem: `grupo ${g.name ?? ''}`.trim(), chat_id: ownerChat, solicitacao_grupo_id: req.id });
      const texto = `${String(r?.texto ?? 'Guia processada.')}\n_(${msg.sender ?? 'alguém'} no grupo ${g.name ?? ''})_${r?.payment_id ? '\n\n👉 *Ainda não foi pago:* toque em *Pagar* no cartão abaixo.' : ''}`;
      await avisarDono(admin, ownerChat, texto, r?.payment_id ? [{ type: 'payment', id: String(r.payment_id) }] : [], { save: true, topic: 'pagamentos' });
      await admin.from('asst_group_requests').update({
        status: r?.payment_id ? 'preparado' : r?.ok ? 'guardado' : 'erro', payment_id: r?.payment_id ?? null,
        reply: texto.slice(0, 2000), notified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }).eq('id', req.id);
      if (r?.payment_id || !r?.ok) {
        await abrirPendenciaPagamento(admin, cfg, req.id, g, msg, r?.payment_id ? texto : `Não consegui preparar sozinho: ${texto}`, r?.payment_id ? [String(r.payment_id)] : []);
      }
      log('INFO', 'guia do grupo', { group: g.name, tipo: msg.extracted.guia.tipo, ok: !!r?.ok, pagamento: r?.payment_id ?? null });
      return;
    } catch (e) {
      // Falhou o caminho da guia: segue a triagem de sempre (o modelo tem lancar_guia).
      log('WARN', 'guia do grupo falhou; segue triagem', { group: g.name, error: errMsg(e) });
    }
  }

  // Conteúdo de terceiros vai DELIMITADO (e sem forjar a própria tag nem os atributos):
  // é dado, nunca ordem.
  const limpo = msg.content.replace(/<\/?mensagem_do_grupo[^>]*>/gi, '').slice(0, 3000);
  const attr = (v: string) => v.replace(/["<>]/g, ' ').slice(0, 80);
  const quando = new Date(msg.sentAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const prompt = [
    tipo === 'compra'
      ? `[Sistema] Cupom/nota de compra postado no grupo "${attr(String(g.name ?? ''))}" sem pedido de pagamento (entrada de compra automática).`
      : `[Sistema] Mensagem no grupo "${attr(String(g.name ?? ''))}" que parece pedido de pagamento (triagem automática). solicitacao_grupo_id = ${req.id}`,
    `<mensagem_do_grupo grupo="${attr(String(g.name ?? ''))}" autor="${attr(msg.sender ?? 'desconhecido')}" quando="${quando}">`,
    limpo,
    '</mensagem_do_grupo>',
    msg.extracted ? `Leitura automática do arquivo anexado: ${JSON.stringify(msg.extracted).slice(0, 12000)}` : '',
    tipo === 'compra' ? 'Siga as regras de ENTRADA DE COMPRA PELO GRUPO.' : 'Siga as regras de TRIAGEM AUTOMÁTICA DE GRUPO.',
  ].filter(Boolean).join('\n');

  // Mesma conferência da nota encaminhada (dono, 2026-09-20): cupom do grupo que já virou compra
  // (pelo XML da SEFAZ, por outro grupo ou na mão) não entra de novo — só avisa.
  if (tipo === 'compra') {
    const jaTem = await compraDuplicada(admin, dadosDaNota(msg.content, msg.extracted)).catch((e) => { log('WARN', 'conferir duplicidade do grupo', { error: errMsg(e) }); return null; });
    if (jaTem) {
      const aviso = `⚠️ Cupom/nota do grupo *${g.name ?? ''}* parece JÁ LANÇADO (${jaTem.por}):\n${jaTem.texto}\nNão lancei de novo.`;
      await admin.from('asst_group_requests').update({ status: 'ignorado', reply: aviso.slice(0, 2000), updated_at: new Date().toISOString() }).eq('id', req.id);
      await avisarDono(admin, ownerChat, aviso, [{ type: 'abrir', label: 'Ver compras', rota: '/financeiro?tab=compras' }], { save: true, topic: 'compras' })
        .catch((e) => log('WARN', 'avisar duplicidade do grupo', { error: errMsg(e) }));
      log('INFO', 'compra do grupo já lançada', { group: g.name });
      return;
    }
  }

  // Fila (2026-09-23): um documento por vez. Vários postados juntos iam ao assistente em paralelo,
  // cada um sem ver o outro — buscas repetidas, custo dobrado e respostas "Não entendi".
  await admin.from('asst_group_requests').update({
    status: 'fila', data: { texto: msg.content, extraido: msg.extracted, sent_at: msg.sentAt, legenda: msg.legenda ?? null, prompt }, updated_at: new Date().toISOString(),
  }).eq('id', req.id);
  await processarFilaGrupo(admin, cfg);
}

// Trabalhador da fila: pega o próximo (fn_asst_fila_proximo só entrega se ninguém estiver
// processando) até esvaziar. Passou de ~60 s, chama outra execução para continuar (limite da Edge).
// deno-lint-ignore no-explicit-any
async function processarFilaGrupo(admin: SupabaseClient, cfg: Record<string, any>) {
  const inicio = Date.now();
  while (Date.now() - inicio < 60_000) {
    const { data: id, error } = await admin.rpc('fn_asst_fila_proximo');
    if (error) { log('ERROR', 'fila do grupo: próximo', { error: error.message }); return; }
    if (!id) return;
    const { data: rq } = await admin.from('asst_group_requests').select('id, message_id, group_jid, group_name, sender_name, kind, data').eq('id', Number(id)).maybeSingle();
    if (!rq) continue;
    const g = { group_jid: rq.group_jid, name: rq.group_name };
    const msg = { messageId: rq.message_id, sender: rq.sender_name, content: String(rq.data?.texto ?? ''), extracted: rq.data?.extraido ?? null, sentAt: String(rq.data?.sent_at ?? new Date().toISOString()), legenda: String(rq.data?.legenda ?? '') };
    const tipo: 'pagamento' | 'compra' = rq.kind === 'compra' ? 'compra' : 'pagamento';
    await executarTriagem(admin, cfg, g, msg, tipo, { id: Number(rq.id) }, String(rq.data?.prompt ?? ''))
      .catch((e) => log('ERROR', 'fila do grupo: item', { id: rq.id, error: errMsg(e) }));
    // Segurança: se a execução não gravou um status final, não deixa o item preso em 'processando'.
    await admin.from('asst_group_requests').update({ status: 'erro', error: 'terminou sem status', updated_at: new Date().toISOString() }).eq('id', rq.id).eq('status', 'processando');
  }
  // Sobrou tempo curto: continua noutra execução (o próximo pega a partir de onde parou).
  const p = fetch(`${supabaseUrl}/functions/v1/assistente-webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` }, body: JSON.stringify({ action: 'processar_fila' }),
  }).catch((e) => log('WARN', 'fila do grupo: continuar', { error: errMsg(e) }));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
}

// Legenda de quem postou o cupom que muda a regra "postou sem pedir pagamento = dinheiro": forma de
// pagamento, outra loja, devolução. Nesses casos quem decide é o modelo.
const LEGENDA_DECIDE = /cart[aã]o|cr[eé]dito|d[eé]bito|\bpix\b|boleto|\bpag(ar|a|ue|uei|ou)\b|fiado|\bprazo\b|outra loja|devolu|troca/i;
// deno-lint-ignore no-explicit-any
async function tentarDireto(admin: SupabaseClient, cfg: Record<string, any>, g: any, msg: { messageId: string | null; sender: string | null; content: string; extracted: any; sentAt: string; legenda?: string }, tipo: 'pagamento' | 'compra', reqId: number, ownerChat: string): Promise<boolean> {
  if (!msg.extracted) return false;
  if (tipo === 'compra' && LEGENDA_DECIDE.test(msg.legenda ?? '')) return false;
  const { data: gr } = await admin.from('asst_groups').select('tenant_id').eq('group_jid', g.group_jid).maybeSingle();
  if (!gr?.tenant_id) return false;
  const out = await brainCall({
    action: tipo === 'compra' ? 'compra_direta' : 'pagamento_direto', tenant_id: gr.tenant_id, lido: msg.extracted,
    grupo: g.name, group_jid: g.group_jid, autor: msg.sender, chat_id: ownerChat, solicitacao_grupo_id: reqId,
  });
  if (!out?.feito) { log('INFO', 'caminho direto não serve; segue o modelo', { tipo, motivo: out?.motivo ?? null }); return false; }
  // deno-lint-ignore no-explicit-any
  const actions: any[] = Array.isArray(out.actions) ? out.actions : [];
  const texto = String(out.texto ?? '');
  await avisarDono(admin, ownerChat, texto, actions); // o brain já gravou a mensagem na conversa
  const pid = actions.find((a) => a?.type === 'payment')?.id ?? null;
  const agora = new Date().toISOString();
  await admin.from('asst_group_requests').update({
    status: tipo === 'compra' ? 'lancado' : out.guardado ? 'guardado' : 'preparado', payment_id: pid, reply: texto.slice(0, 2000), notified_at: agora, updated_at: agora,
  }).eq('id', reqId);
  // Boleto guardado (vence depois do prazo de "quando pedir para pagar"): quem cobra é o
  // assistente-cron no dia — sem pendência agora.
  if (tipo === 'pagamento' && !out.guardado) await abrirPendenciaPagamento(admin, cfg, reqId, g, msg, texto, pid ? [String(pid)] : []);
  log('INFO', 'documento do grupo resolvido sem o modelo', { tipo, group: g.name });
  return true;
}

// deno-lint-ignore no-explicit-any
async function executarTriagem(admin: SupabaseClient, cfg: Record<string, any>, g: any, msg: { messageId: string | null; sender: string | null; content: string; extracted: any; sentAt: string; legenda?: string }, tipo: 'pagamento' | 'compra', req: { id: number }, prompt: string) {
  const ownerChat = ownerChatOf(cfg);
  if (!ownerChat) { await admin.from('asst_group_requests').update({ status: 'erro', error: 'sem destino', updated_at: new Date().toISOString() }).eq('id', req.id); return; }
  // Caminho sem modelo (2026-09-24): cupom de "chegou" legível e boleto com conta já lançada. O que
  // não fechar (ou qualquer erro) segue para o modelo como antes.
  const direto = await tentarDireto(admin, cfg, g, msg, tipo, req.id, ownerChat)
    .catch((e) => { log('WARN', 'caminho direto falhou; segue o modelo', { tipo, error: errMsg(e) }); return false; });
  if (direto) return;
  try {
    const out = await brainCall({ text: prompt, chat_id: ownerChat, channel: ownerChat.startsWith('tg:') ? 'telegram' : 'whatsapp', modo: tipo === 'compra' ? 'entrada_compra_grupo' : 'triagem_grupo', group_jid: g.group_jid });
    const reply = String(out?.reply ?? '').trim();
    // deno-lint-ignore no-explicit-any
    const actions: any[] = Array.isArray(out?.actions) ? out.actions : [];
    const pagamento = actions.find((a) => a?.type === 'payment');
    if (!reply || reply === 'NO_REPLY') {
      await admin.from('asst_group_requests').update({ status: 'ignorado', updated_at: new Date().toISOString() }).eq('id', req.id);
      log('INFO', 'triagem: não era pedido de pagamento', { group: g.name });
      return;
    }
    // TODOS os pagamentos da mensagem apontam para o pedido (2026-09-16). Antes só o 1º era ligado
    // (payment_id abaixo) e o 2º Pix da mesma mensagem ficava sem comprovante no grupo.
    const ids = actions.filter((a) => a?.type === 'payment' && a?.id).map((a) => String(a.id));
    // Pagamento que já é de OUTRO pedido (mesma cobrança em duas mensagens): o cartão dele já foi
    // enviado com o pedido original — não manda um segundo "Pagar" para a mesma conta.
    let jaDeOutro = new Set<string>();
    if (ids.length) {
      const { data: donos } = await admin.from('fin_inter_payments').select('id, group_request_id').in('id', ids);
      jaDeOutro = new Set((donos ?? []).filter((x) => x.group_request_id != null && Number(x.group_request_id) !== req.id).map((x) => String(x.id)));
    }
    await avisarDono(admin, ownerChat, reply, actions.filter((a) => !(a?.type === 'payment' && jaDeOutro.has(String(a.id)))));
    if (ids.length) {
      await admin.from('fin_inter_payments').update({ group_request_id: req.id }).in('id', ids).is('group_request_id', null)
        .then(({ error: e }) => { if (e) log('WARN', 'ligar pagamentos ao pedido', { error: e.message }); });
      // Diárias de freelancer registradas antes do vínculo acima: ficam sabendo de qual pedido vieram.
      await admin.from('hr_freelancer_shifts').update({ group_request_id: req.id }).in('payment_id', ids).is('group_request_id', null)
        .then(({ error: e }) => { if (e) log('WARN', 'ligar diárias ao pedido', { error: e.message }); });
    }
    // 'guardado' vem do brain (preparar_pagamento guardou o boleto que vence depois do prazo).
    const { data: atual } = await admin.from('asst_group_requests').select('status').eq('id', req.id).maybeSingle();
    const guardado = !pagamento && atual?.status === 'guardado';
    await admin.from('asst_group_requests').update({
      status: pagamento ? 'preparado' : guardado ? 'guardado' : 'incompleto', payment_id: pagamento ? String(pagamento.id) : null,
      reply: reply.slice(0, 2000), notified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    // Pedido de pagamento entra na caixa de pendências, preparado ou não: o cartão do
    // Telegram expira em 30 min, a pendência não. Fecha sozinha quando o Inter confirmar
    // (trigger trg_pendencia_pagamento_grupo). Compra lançada não gera pendência: já acabou.
    if (tipo === 'pagamento' && !guardado) {
      await abrirPendenciaPagamento(admin, cfg, req.id, g, msg,
        pagamento ? reply : `Não consegui preparar sozinho: ${reply}`, ids);
    }
    log('INFO', 'triagem de pagamento', { group: g.name, sender: msg.sender, preparado: !!pagamento });
  } catch (e) {
    await admin.from('asst_group_requests').update({ status: 'erro', error: errMsg(e).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', req.id);
    log('ERROR', 'triagem de pagamento falhou', { group: g.name, error: errMsg(e) });
    // Triagem quebrada é justamente quando a pendência mais importa: não há cartão no
    // Telegram para tocar, então a caixa é o único lugar onde o pedido sobrevive.
    if (tipo === 'pagamento') {
      await abrirPendenciaPagamento(admin, cfg, req.id, g, msg, `A triagem falhou: ${errMsg(e).slice(0, 300)}`, []);
    }
    // O dono precisa saber que chegou um pedido mesmo quando a triagem quebra.
    await avisarDono(admin, ownerChat, `Chegou um pedido de pagamento no grupo *${g.name}*${msg.sender ? ` (${msg.sender})` : ''} e eu não consegui preparar: ${errMsg(e).slice(0, 160)}. Dá uma olhada lá.`, []).catch(() => {});
  }
}

// ── Dias de freelancer pelo grupo (2026-09-16) ──
// Pagamento de freelancer sem os dias → o assistente perguntou no grupo. A resposta ("trabalhou dia
// 15 e 16") não tem cara de pedido de pagamento e nunca chegava ao assistente. Enquanto o grupo
// tiver diária aguardando os dias, mensagem com cara de data vai para o brain (modo
// 'dias_freelancer'). Filtro barato antes, para não chamar o modelo a cada conversa do grupo.
// "Anotado ✅ Marcelle e Joziane: 15/09." — só com os pagamentos que ESTAVAM pendentes e agora têm dia.
// deno-lint-ignore no-explicit-any
async function confirmarDiasNoGrupo(admin: SupabaseClient, g: any, respostaId: string, paymentIds: string[]) {
  const { data } = await admin.from('hr_freelancer_shifts').select('work_date, hr_freelancers(name)')
    .in('payment_id', paymentIds).eq('status', 'registrada');
  if (!data?.length) return; // nada foi registrado: não confirma nada
  const porPessoa = new Map<string, Set<string>>();
  for (const s of data) {
    // deno-lint-ignore no-explicit-any
    const nome = String((s as any).hr_freelancers?.name ?? 'freelancer').split(/\s+/)[0];
    const dia = String(s.work_date ?? '');
    if (!dia) continue;
    const [, mm, dd] = dia.split('-');
    porPessoa.set(nome, (porPessoa.get(nome) ?? new Set()).add(`${dd}/${mm}`));
  }
  // Agrupa quem trabalhou nos mesmos dias: "Marcelle e Joziane: 15/09".
  const grupos = new Map<string, string[]>();
  for (const [nome, dias] of porPessoa) {
    const k = [...dias].sort().join(', ');
    grupos.set(k, [...(grupos.get(k) ?? []), nome]);
  }
  const juntar = (n: string[]) => (n.length > 1 ? `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}` : n[0]);
  const linhas = [...grupos].map(([dias, nomes]) => `${juntar(nomes)}: ${dias}`);
  const texto = `Anotado ✅ ${linhas.join(' · ')}. Obrigado!`;
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'group_send', group_jid: g.group_jid, quoted_message_id: respostaId, text: texto }),
    });
    if (!r.ok) log('WARN', 'confirmar dias no grupo', { status: r.status });
  } catch (e) { log('WARN', 'confirmar dias no grupo', { error: errMsg(e) }); }
}

const DIA_HINT = /\b(dia|dias|ontem|hoje|anteontem|segunda|ter[çc]a|quarta|quinta|sexta|s[áa]bado|domingo|fim de semana|\d{1,2}\s*\/\s*\d{1,2}|\d{1,2}\s+e\s+\d{1,2})\b/i;
// deno-lint-ignore no-explicit-any
async function triarDiasFreelancer(admin: SupabaseClient, cfg: Record<string, any>, g: any, msg: { messageId: string | null; sender: string | null; content: string; sentAt: string }): Promise<boolean> {
  if (!DIA_HINT.test(msg.content)) return false;
  const ownerChat = ownerChatOf(cfg);
  if (!ownerChat) return false;
  const desde = new Date(Date.now() - 14 * 86400_000).toISOString();
  const { data: reqs } = await admin.from('asst_group_requests').select('id').eq('group_jid', g.group_jid).gte('created_at', desde);
  const reqIds = (reqs ?? []).map((r) => r.id);
  if (!reqIds.length) return false;
  const { data: pend } = await admin.from('hr_freelancer_shifts')
    .select('payment_id, amount, group_request_id, hr_freelancers(name)')
    .in('group_request_id', reqIds).eq('status', 'aguardando_dias').limit(20);
  if (!pend?.length) return false;

  const limpo = msg.content.replace(/<\/?mensagem_do_grupo[^>]*>/gi, '').slice(0, 1500);
  const attr = (v: string) => v.replace(/["<>]/g, ' ').slice(0, 80);
  const quando = new Date(msg.sentAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const lista = pend.map((p) => {
    // deno-lint-ignore no-explicit-any
    const nome = (p as any).hr_freelancers?.name ?? 'freelancer';
    return `- ${nome}: pagamento_id ${p.payment_id}, R$ ${Number(p.amount).toFixed(2)}, pedido ${p.group_request_id}`;
  }).join('\n');
  const prompt = [
    `[Sistema] Mensagem no grupo "${attr(String(g.name ?? ''))}", que tem freelancer aguardando os dias trabalhados.`,
    `Aguardando os dias:\n${lista}`,
    `<mensagem_do_grupo grupo="${attr(String(g.name ?? ''))}" autor="${attr(msg.sender ?? 'desconhecido')}" quando="${quando}">`,
    limpo,
    '</mensagem_do_grupo>',
    'Siga as regras de DIAS DE FREELANCER PELO GRUPO.',
  ].join('\n');
  try {
    const out = await brainCall({ text: prompt, chat_id: ownerChat, channel: ownerChat.startsWith('tg:') ? 'telegram' : 'whatsapp', modo: 'dias_freelancer', group_jid: g.group_jid });
    const reply = String(out?.reply ?? '').trim();
    if (!reply || reply === 'NO_REPLY') return false;
    await avisarDono(admin, ownerChat, reply, Array.isArray(out?.actions) ? out.actions : []);
    // Responde no grupo a mensagem com os dias (pedido do dono, 2026-09-16). Texto montado pelo CÓDIGO
    // a partir do que foi GRAVADO — nunca confirma o que não registrou, e o modelo não escreve aqui.
    if (msg.messageId) await confirmarDiasNoGrupo(admin, g, msg.messageId, pend.map((p) => String(p.payment_id)));
    log('INFO', 'dias de freelancer pelo grupo', { group: g.name });
    return true;
  } catch (e) {
    log('WARN', 'dias de freelancer pelo grupo falhou', { group: g.name, error: errMsg(e) });
    return false;
  }
}

// Demanda que chega pelo WhatsApp: vai para o brain NO CHAT DO TELEGRAM/ERPOS (mesmo histórico e
// mesmas ferramentas) e a RESPOSTA VOLTA NO WHATSAPP, citando a mensagem (dono, 2026-09-20 — antes
// a resposta saía no Telegram e ele ficava sem retorno onde tinha perguntado). Reações continuam:
// 👀 recebi · ✅ respondi · ❌ falhou.
async function relayToTelegram(
  // deno-lint-ignore no-explicit-any
  admin: SupabaseClient, cfg: Record<string, any>, waChatId: string, number: string, msgKey: MsgKey | null, data: any, p: Parsed,
) {
  const tg = cfg.telegram_owner_chat_id ? `tg:${cfg.telegram_owner_chat_id}` : null;
  if (!tg) { await sendText(number, 'Não tenho o seu Telegram configurado para repassar. Fala comigo por lá.').catch(() => {}); return; }
  if (p.inner?.pollUpdateMessage) return;
  if (msgKey) react(msgKey, '👀');
  let text = String(p.text ?? '').trim();
  // deno-lint-ignore no-explicit-any
  let attachment: any = null;
  try {
    if (p.kind === 'audio') {
      const b64 = await mediaBase64(data);
      const t = b64 ? await transcribe(b64, p.mime ?? 'audio/ogg') : '';
      text = t ? `[Áudio] ${t}` : '[Áudio que não consegui transcrever]';
    } else if (p.kind === 'image' || (p.kind === 'document' && (p.mime === 'application/pdf' || IMAGE_TYPES.includes(p.mime ?? '')))) {
      const b64 = await mediaBase64(data);
      if (!b64) throw new Error('não consegui baixar o arquivo');
      attachment = { base64: b64, media_type: p.kind === 'image' ? (p.mime ?? 'image/jpeg') : p.mime };
    } else if (p.kind === 'video' || p.kind === 'document' || p.kind === 'other') {
      const nome = String(p.inner?.documentMessage?.fileName ?? '').trim();
      text = [text, `[${p.kind === 'video' ? 'Vídeo' : `Arquivo${nome ? ` "${nome}"` : ''}`} que eu não consigo abrir]`].filter(Boolean).join('\n');
    }
  } catch (e) {
    log('WARN', 'repasse ao Telegram: preparar mídia', { error: errMsg(e) });
    text = [text, '(não consegui baixar o anexo)'].filter(Boolean).join('\n');
  }
  if (!text && !attachment) return;
  // Mensagens seguidas (encaminhar várias de uma vez) viram uma só.
  if (!attachment) {
    const merged = await debounce(admin, waChatId, text, msgKey);
    if (merged === null) { if (msgKey) react(msgKey, '✅'); return; }
    text = merged.text;
  }
  const prefixo = p.forwarded ? '[Encaminhada pelo WhatsApp]' : '[Pelo WhatsApp]';
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ text: `${prefixo} ${text}`.trim(), chat_id: tg, channel: 'telegram', attachment }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out?.reply) throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
    const reply = String(out.reply);
    const actions = Array.isArray(out.actions) ? out.actions : [];
    // A resposta volta ONDE ele perguntou: no WhatsApp, citando a mensagem dele (dono, 2026-09-20:
    // "falei com o assistente no whats e ele me respondeu no telegram"). A conversa continua sendo a
    // mesma (o brain grava no chat do Telegram/ERPOS), só a entrega muda de canal.
    if (reply !== 'NO_REPLY') {
      await sendReply(number, reply, msgKey, text.slice(0, 200));
    }
    // Enquete/localização/contato que o modelo pediu saem aqui mesmo, no WhatsApp.
    if (actions.length) await runActions(admin, number, tg, actions).catch((e) => log('WARN', 'ações no WhatsApp', { error: errMsg(e) }));
    if (msgKey) react(msgKey, '✅');
    log('INFO', 'demanda do WhatsApp respondida no WhatsApp', { kind: p.kind, forwarded: p.forwarded });
  } catch (e) {
    log('ERROR', 'responder no WhatsApp falhou', { error: errMsg(e) });
    if (msgKey) react(msgKey, '❌');
    await sendReply(number, 'Não consegui responder agora. Tenta de novo em instantes.', msgKey).catch(() => {});
  }
}

// Currículos pelo WhatsApp (2026-09-13): o dono recebe currículos no WhatsApp e só ENCAMINHA para
// o número do assistente — aqui só RECEBE (hiring-cv-scan › intake) e confirma numa linha; todo o
// resto (triagem, vaga, conversa) é no Telegram. Se o modo de currículos do Telegram estiver ligado
// (asst_settings.hiring_intake), usa a mesma empresa/vaga.
// deno-lint-ignore no-explicit-any
// Resultado: 'ok' salvo · 'dup' repetido (avisado, não salvo) · 'not_cv' não é currículo (quem chamou
// repassa ao Telegram) · 'erro' falhou (avisado).
async function cvFromWhatsApp(admin: SupabaseClient, number: string, msgKey: MsgKey | null, data: any, p: Parsed): Promise<'ok' | 'dup' | 'not_cv' | 'erro'> {
  if (msgKey) react(msgKey, '👀');
  const fileName = String(p.inner?.documentMessage?.fileName ?? '').trim() || null;
  const { data: st } = await admin.from('asst_settings').select('value').eq('key', 'hiring_intake').maybeSingle();
  // deno-lint-ignore no-explicit-any
  const alvo: any = st?.value?.until && new Date(st.value.until).getTime() > Date.now() ? st.value : {};
  let entrada: Record<string, unknown>;
  if (p.kind === 'text') {
    entrada = { text: String(p.text ?? '').trim() };
  } else {
    const mime = String(p.mime ?? (p.kind === 'image' ? 'image/jpeg' : '')).split(';')[0].toLowerCase();
    if (mime !== 'application/pdf' && !IMAGE_TYPES.includes(mime)) return 'not_cv';
    const b64 = await mediaBase64(data).catch(() => null);
    if (!b64) {
      await sendText(number, 'Não consegui baixar esse arquivo. Manda de novo?').catch(() => {});
      if (msgKey) react(msgKey, '😱');
      return 'erro';
    }
    entrada = { file_base64: b64, media_type: mime, file_name: fileName };
  }
  // deno-lint-ignore no-explicit-any
  let out: any = {};
  let ok = false;
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/hiring-cv-scan`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'intake', company_id: alvo.company_id ?? null, job_id: alvo.job_id ?? null, ...entrada }),
    });
    out = await r.json().catch(() => ({}));
    ok = r.ok && !!out?.success;
    out._status = r.status;
  } catch (e) { out = { error: errMsg(e) }; }
  if (!ok) {
    // Repetido: avisa e não salva (regra do dono, 2026-09-14)
    if (out?._status === 409 || out?.duplicate) {
      await sendText(number, `⚠️ ${out?.error ?? 'Currículo repetido: não salvei de novo.'}`).catch(() => {});
      if (msgKey) react(msgKey, '🔁');
      return 'dup';
    }
    // Não é currículo (demanda, print, conversa…): quem chamou repassa ao Telegram
    if (out?._status === 422) return 'not_cv';
    log('WARN', 'currículo (WhatsApp) não salvo', { error: out?.error ?? null });
    await sendText(number, `❌ Não salvei ${fileName ? `"${fileName}"` : 'esse currículo'}: ${out?.error ?? 'erro desconhecido'}`).catch(() => {});
    if (msgKey) react(msgKey, '🤔');
    return 'erro';
  }
  const c = out.candidate ?? {};
  const destino = [out.company_name, out.job_title ? `vaga ${out.job_title}` : null].filter(Boolean).join(' › ');
  const confirmacao = `✅ Currículo salvo: *${c.full_name ?? 'candidato'}*${c.desired_role ? ` — ${c.desired_role}` : ''}${destino ? ` (${destino})` : ''}${out.duplicate ? `\n⚠️ Parece repetido: já existe ${out.duplicate}.` : ''}`;
  await sendText(number, confirmacao).catch(() => {});
  if (msgKey) react(msgKey, '👍');
  // Cópia no Telegram (canal principal): em 2026-09-14 a confirmação pelo WhatsApp não chegou e o dono
  // achou que nada tinha acontecido. Lá também dá para seguir ("coloca na vaga X").
  try {
    const { data: tgId } = await admin.from('asst_settings').select('value').eq('key', 'telegram_owner_chat_id').maybeSingle();
    if (tgId?.value) {
      await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        // save/topic: entra no histórico também, na aba Currículos do chat do ERPOS.
        body: JSON.stringify({ action: 'deliver', chat_key: `tg:${tgId.value}`, text: `📲 ${confirmacao}${fileName ? `\n_${fileName}_` : ''}\nSe quiser, me diga a vaga que eu inscrevo.`, save: true, topic: 'curriculos' }),
      });
    }
  } catch (e) { log('WARN', 'cópia da confirmação no Telegram falhou', { error: errMsg(e) }); }
  log('INFO', 'currículo salvo (WhatsApp)', { candidate: c.id ?? null, job: alvo.job_id ?? null });
  return 'ok';
}

// ── Canais públicos (links wa.me com código; atendimento na edge canal-publico) ──
const PUBLIC_CODE_RE = /\b([A-Z]{2,4}-[A-Z0-9]{4})\b/i; // mesmo formato do canal-publico

// O atendimento público (candidatura + agendamento) só passa por ESTE número quando wa_public.transport
// é 'evolution'. Desde 2026-09-15 ele roda na API oficial (whatsapp-cloud, outro número): aqui ficam só
// os grupos e o dono. Voltar para a Evolution = UPDATE em asst_settings.wa_public, sem deploy.
async function publicOnEvolution(admin: SupabaseClient): Promise<boolean> {
  const { data } = await admin.from('asst_settings').select('value').eq('key', 'wa_public').maybeSingle();
  return (data?.value as Record<string, unknown> | null)?.transport !== 'cloud';
}

// Dono testando um link: mensagem com o código de um canal existente, ou teste aberto (< 30 min).
// deno-lint-ignore no-explicit-any
async function ownerTestingPublic(admin: SupabaseClient, chatId: string, data: any): Promise<boolean> {
  const p = parseMessage(data.message);
  const code = String(p.text ?? '').match(PUBLIC_CODE_RE)?.[1]?.toUpperCase();
  if (code) {
    const { data: ch } = await admin.from('bot_channels').select('id').eq('code', code).maybeSingle();
    if (ch) return true;
  }
  const { data: conv } = await admin.from('bot_conversations').select('id').eq('contact_jid', chatId).eq('is_test', true).eq('status', 'aberta')
    .gt('last_message_at', new Date(Date.now() - 30 * 60_000).toISOString()).limit(1).maybeSingle();
  return !!conv;
}

// Recibo do WhatsApp (entregue / lida) da última mensagem do agendamento a cada candidato
// (hiring_scheduling_sessions.last_out_msg_id) → painel Contratação › Agendamentos.
// deno-lint-ignore no-explicit-any
async function hiringReceipts(items: any[]) {
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  for (const it of items) {
    if (it?.fromMe === false || it?.key?.fromMe === false) continue; // só recibos das NOSSAS mensagens
    const id = String(it?.keyId ?? it?.key?.id ?? '');
    const st = String(it?.status ?? it?.update?.status ?? '').toUpperCase();
    if (!id || !st) continue;
    const now = new Date().toISOString();
    if (['DELIVERY_ACK', 'READ', 'PLAYED', '3', '4', '5'].includes(st)) {
      await admin.from('hiring_scheduling_sessions').update({ delivered_at: now }).eq('last_out_msg_id', id).is('delivered_at', null);
    }
    if (['READ', 'PLAYED', '4', '5'].includes(st)) {
      await admin.from('hiring_scheduling_sessions').update({ read_at: now }).eq('last_out_msg_id', id).is('read_at', null);
    }
  }
}

// Agendamento de entrevista: texto (ou áudio transcrito) de quem não é o dono vai primeiro ao
// hiring-scheduler; devolve true se era conversa de agendamento ou resposta de entrevistador.
// deno-lint-ignore no-explicit-any
async function toHiringScheduler(number: string, data: any, replyTo?: string): Promise<boolean> {
  const p = parseMessage(data.message);
  if (p.inner?.pollUpdateMessage || p.inner?.reactionMessage || p.inner?.protocolMessage) return false;
  let text = String(p.text ?? '').trim();
  if (p.kind === 'audio') {
    const b64 = await mediaBase64(data);
    text = b64 ? `[Áudio] ${await transcribe(b64, p.mime ?? 'audio/ogg')}`.trim() : '';
  }
  if (!text || text === '[Áudio]') return false; // mídia sem texto (currículo) segue para o canal público
  const r = await fetch(`${supabaseUrl}/functions/v1/hiring-scheduler`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    // reply_to = JID de origem (@lid): o scheduler responde nele e guarda na sessão (ver handle()).
    body: JSON.stringify({ action: 'inbound', number, reply_to: replyTo || null, text, name: data.pushName ?? null }),
  });
  const out = await r.json().catch(() => ({}));
  return r.ok && out?.handled === true;
}

// ── @lid (2026-09-14) ──
// Depois de um repareamento o WhatsApp só entrega (texto e reação) no @lid do contato, mas o evento da
// Evolution chega aqui só com o telefone em remoteJid/remoteJidAlt e addressingMode 'lid'. O @lid real
// fica gravado na Evolution: pega pelo findMessages (id da mensagem) e guarda em wa_lid_map.
async function saveLid(admin: SupabaseClient, phone: string, lid: string) {
  if (!/^\d{10,15}$/.test(phone) || !lid.endsWith('@lid')) return;
  await admin.from('wa_lid_map').upsert({ phone, lid, updated_at: new Date().toISOString() }, { onConflict: 'phone' });
}
// deno-lint-ignore no-explicit-any
async function resolveLid(admin: SupabaseClient, key: any, number: string): Promise<string | null> {
  const direto = [key?.remoteJid, key?.remoteJidAlt, key?.senderLid].map((x) => String(x ?? '')).find((x) => x.endsWith('@lid'));
  if (direto) { await saveLid(admin, number, direto); return direto; }
  if (key?.addressingMode !== 'lid') return null;
  const { data: cached } = await admin.from('wa_lid_map').select('lid').eq('phone', number).maybeSingle();
  if (cached?.lid) return String(cached.lid);
  if (!key?.id) return null;
  for (let i = 0; i < 3; i++) {
    // deno-lint-ignore no-explicit-any
    const out: any = await evo(`/chat/findMessages/${evoInstance}`, { where: { key: { id: String(key.id) } }, limit: 1 }).catch(() => null);
    const k = out?.messages?.records?.[0]?.key ?? null;
    const lid = [k?.remoteJid, k?.remoteJidAlt].map((x) => String(x ?? '')).find((x) => x.endsWith('@lid'));
    if (lid) { await saveLid(admin, number, lid); return lid; }
    await new Promise((r) => setTimeout(r, 700)); // a Evolution pode ainda não ter gravado a mensagem
  }
  log('WARN', 'addressingMode lid sem @lid encontrado', { number });
  return null;
}

// Prepara a mensagem (áudio transcrito, PDF/foto em base64) e entrega ao canal-publico.
// deno-lint-ignore no-explicit-any
async function toPublicChannel(chatId: string, number: string, msgKey: MsgKey | null, data: any, isOwner: boolean, replyTo?: string) {
  const dest = replyTo || number; // responder no JID de origem (@lid), ver handle()
  const p = parseMessage(data.message);
  if (p.inner?.pollUpdateMessage || p.inner?.reactionMessage || p.inner?.protocolMessage) return;
  let text = String(p.text ?? '').trim();
  let file: { base64: string; mime: string; name: string | null } | null = null;
  try {
    if (p.kind === 'audio') {
      const b64 = await mediaBase64(data);
      const t = b64 ? await transcribe(b64, p.mime ?? 'audio/ogg') : '';
      text = t ? `[Áudio] ${t}` : '';
      if (!t) { await sendText(dest, 'Não consegui ouvir o áudio 😕 Pode escrever?').catch(() => {}); return; }
    } else if (p.kind === 'image' || p.kind === 'document') {
      const mime = String(p.mime ?? (p.kind === 'image' ? 'image/jpeg' : '')).split(';')[0].toLowerCase();
      const name = String(p.inner?.documentMessage?.fileName ?? '').trim() || null;
      // PDF, foto e Word .docx (o canal-publico extrai o texto do .docx).
      const isDocx = mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || /\.docx$/i.test(name ?? '');
      if (mime === 'application/pdf' || IMAGE_TYPES.includes(mime) || isDocx) {
        const b64 = await mediaBase64(data);
        if (!b64) { await sendText(dest, 'Não consegui baixar esse arquivo. Pode mandar de novo?').catch(() => {}); return; }
        file = { base64: b64, mime: isDocx ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' : mime, name };
      } else {
        file = null; // tipo que não lemos (.doc antigo etc.): o canal-publico responde pedindo PDF/foto/Word
        text = text || `[Arquivo${name ? ` "${name}"` : ''}]`;
      }
    }
  } catch (e) {
    log('WARN', 'canal público: preparar mídia', { error: errMsg(e) });
  }
  const r = await fetch(`${supabaseUrl}/functions/v1/canal-publico`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({ action: 'incoming', chat_id: chatId, number, reply_to: dest, name: data.pushName ?? null, kind: p.kind, text, file, key: msgKey, is_owner: isOwner }),
  }).catch((e) => { log('ERROR', 'canal-publico inacessível', { error: errMsg(e) }); return null; });
  if (r && !r.ok) log('ERROR', 'canal-publico recusou', { status: r.status, body: (await r.text()).slice(0, 200) });
}

// Grupos: o assistente SÓ LÊ — guarda a mensagem em asst_group_messages e nunca
// responde no grupo. Na primeira mensagem de um grupo busca nome e participantes;
// a leitura só liga sozinha se o dono estiver no grupo (qualquer pessoa pode
// adicionar o número do assistente num grupo). Liga/desliga na tela Assistente.
// deno-lint-ignore no-explicit-any
async function handleGroup(admin: SupabaseClient, data: any, allowed: string[], cfg: Record<string, any> = {}) {
  const groupJid = String(data.key.remoteJid);
  const ownerNums = allowed.map((a) => a.replace(/@.*$/, ''));
  let { data: g } = await admin.from('asst_groups').select('group_jid, name, is_enabled, task_list_id, read_media').eq('group_jid', groupJid).maybeSingle();
  if (!g) {
    let name: string = groupJid;
    let ownerIn = false;
    try {
      const info = await evoGet(`/group/findGroupInfos/${evoInstance}?groupJid=${encodeURIComponent(groupJid)}`);
      name = String(info?.subject ?? groupJid);
      // deno-lint-ignore no-explicit-any
      const parts: any[] = Array.isArray(info?.participants) ? info.participants : [];
      ownerIn = parts.some((p) => [p.id, p.phoneNumber, p.jid].filter(Boolean)
        .map((x) => String(x).replace(/@.*$/, '')).some((n) => ownerNums.includes(n)));
    } catch (e) {
      log('WARN', 'findGroupInfos falhou', { groupJid, error: errMsg(e) });
    }
    await admin.from('asst_groups').upsert({ group_jid: groupJid, name, is_enabled: ownerIn }, { onConflict: 'group_jid', ignoreDuplicates: true });
    g = { group_jid: groupJid, name, is_enabled: ownerIn, task_list_id: null, read_media: true };
    log('INFO', 'grupo novo', { groupJid, name, is_enabled: ownerIn });
  }
  if (!g.is_enabled) return;

  const conf = { ...GROUP_WATCH_DEFAULTS, ...(cfg.group_watch && typeof cfg.group_watch === 'object' ? cfg.group_watch : {}) };
  if (g.read_media === false) conf.read_media = false; // grupo de obra: foto/PDF sem IA (custo)
  const p = parseMessage(data.message);
  // Reação: só o 📌 interessa (vira item na caixa da pasta de tarefas do grupo). O resto é ignorado.
  if (p.inner?.reactionMessage) {
    if (g.task_list_id) await pinParaTarefa(admin, g, data).catch((e) => log('ERROR', '📌 para tarefa', { groupJid, error: errMsg(e) }));
    return;
  }
  const legenda = p.text ? p.text.trim() : '';
  let content = legenda;
  let baseText = legenda;          // o que a pessoa escreveu/falou (sem a leitura da mídia)
  // deno-lint-ignore no-explicit-any
  let extracted: any = null;
  const sender = data.pushName ? String(data.pushName) : null;
  if (p.kind === 'audio') {
    try {
      const b64 = await mediaBase64(data);
      const t = b64 ? await transcribe(b64, p.mime ?? 'audio/ogg') : '';
      content = t ? `[Áudio] ${t}` : '[Áudio não transcrito]';
      baseText = t || '';
    } catch (e) {
      log('WARN', 'transcrição de grupo falhou', { groupJid, error: errMsg(e) });
      content = '[Áudio não transcrito]';
    }
  } else if (p.kind === 'image' || p.kind === 'document') {
    const rotulo = p.kind === 'image' ? '[Foto]' : '[Arquivo]';
    content = `${rotulo}${legenda ? ` ${legenda}` : ''}`;
    // Foto e PDF são LIDOS (o resto — planilha, áudio de vídeo, zip — continua só rótulo).
    if (conf.read_media !== false && DOC_READABLE(p.mime ?? (p.kind === 'image' ? 'image/jpeg' : null))) {
      try {
        const b64 = await mediaBase64(data);
        if (!b64) throw new Error('não consegui baixar o arquivo');
        extracted = await lerMidia(b64, p.mime ?? 'image/jpeg', legenda, `Mensagem do grupo "${g.name}"${sender ? `, mandada por ${sender}` : ''}.`, `grupo:${groupJid}`);
        const resumo = String(extracted?.resumo ?? '').trim();
        const texto = String(extracted?.texto ?? '').trim();
        if (resumo) content = `${content}\n${resumo}${texto ? `\nTexto do arquivo: ${texto}` : ''}`;
      } catch (e) {
        log('WARN', 'leitura de mídia de grupo falhou', { groupJid, kind: p.kind, error: errMsg(e) });
        content = `${content}\n(não consegui ler o arquivo)`;
      }
    }
  } else if (p.kind === 'video') content = `[Vídeo]${content ? ` ${content}` : ''}`;
  if (!content) return;
  if (p.forwarded) content = `[Encaminhada] ${content}`;

  const ts = Number(data.messageTimestamp);
  const sentAt = ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  const messageId = data.key.id ? String(data.key.id) : null;
  const linha = {
    message_id: messageId,
    group_jid: groupJid,
    sender_jid: String(data.key.participantAlt ?? data.key.participant ?? '') || null,
    sender_name: sender,
    content: content.slice(0, 4000),
    kind: p.kind,
    sent_at: sentAt,
  };
  const gravar = (row: Record<string, unknown>) =>
    admin.from('asst_group_messages').upsert(row, { onConflict: 'message_id', ignoreDuplicates: true }).select('id');
  let { data: gravada, error: erroGravar } = await gravar({ ...linha, media_mime: p.mime ?? null, extracted });
  if (erroGravar) {
    // Migração 20260912160000 ainda não aplicada: grava sem as colunas novas em vez
    // de perder a mensagem do grupo.
    log('WARN', 'gravar mensagem de grupo com mídia falhou; tentando sem as colunas novas', { groupJid, error: erroGravar.message });
    const r = await gravar(linha);
    if (r.error) { log('ERROR', 'gravar mensagem de grupo', { groupJid, error: r.error.message }); return; }
    gravada = r.data;
  }
  // Mensagem repetida (webhook reenviado): já foi tratada, não triar de novo.
  if (messageId && !gravada?.length) return;

  // Resposta com os dias de um freelancer que ficou pendente? Tratada, não é pedido novo.
  if (await triarDiasFreelancer(admin, cfg, g, { messageId, sender, content, sentAt })) return;

  // Foto de NF-e que JÁ está em Notas de entrada = "a mercadoria chegou" (dono, 2026-09-18). A compra
  // sai do XML (não da leitura da foto, que errou itens e preços da B&P) e o recebimento é confirmado.
  // Só quando a legenda não pede pagamento — pedido explícito segue a triagem de sempre.
  if (extracted && !PAY_HINT.test(baseText)) {
    const nota = await notaDaFoto(admin, content, extracted).catch((e) => { log('WARN', 'procurar nota da foto', { error: errMsg(e) }); return null; });
    if (nota) { await recebimentoPorNota(admin, cfg, g, { messageId, sender, content, extracted, sentAt }, nota); return; }
  }
  // Frete (DACTE) cobrado de OUTRO tomador — ex.: o fornecedor paga a transportadora (CIF). Não é
  // pagamento nosso: a Expresso São Miguel da B&P virou pendência de R$ 75,59 (2026-09-18).
  const freteDeOutro = await freteDeOutroTomador(admin, content).catch(() => null);
  if (freteDeOutro) {
    const ownerChat = ownerChatOf(cfg);
    log('INFO', 'frete de outro tomador: não é pagamento nosso', { group: g.name, tomador: freteDeOutro });
    if (ownerChat?.startsWith('tg:')) {
      await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ action: 'deliver', chat_key: ownerChat, save: true, topic: 'compras',
          text: `🚚 Conhecimento de frete postado no grupo *${g.name ?? ''}*: quem paga é o tomador do serviço (CNPJ ${freteDeOutro}), não a loja — não virou pagamento.` }),
      }).catch((e) => log('WARN', 'aviso de frete de outro tomador', { error: errMsg(e) }));
    }
    return;
  }

  // Pedido de pagamento? A leitura da mídia manda quando existe; senão, o texto.
  const pedido = extracted?.pagamento
    ? extracted.pagamento.e_solicitacao === true
    : PAY_HINT.test(baseText);
  if (pedido) { await triarPagamento(admin, cfg, g, { messageId, sender, content, extracted, sentAt, legenda: baseText }); return; }
  // Cupom/nota de compra sem pedido de pagamento ("chegou", mercado pago em dinheiro): dar entrada em Compras.
  const compra = !!extracted && ['nota_fiscal', 'cupom', 'pedido'].includes(String(extracted.tipo_documento ?? ''))
    && Array.isArray(extracted.itens) && extracted.itens.length > 0;
  if (compra) await triarPagamento(admin, cfg, g, { messageId, sender, content, extracted, sentAt, legenda: baseText }, 'compra');
}

// ── 📌 no grupo → caixa da pasta de tarefas (2026-09-24, pedido do dono) ──
// Alguém reage 📌 numa mensagem de um grupo ligado a uma pasta (asst_groups.task_list_id): a mensagem
// vai para task_whatsapp_items e quem edita a pasta decide na tela (tarefa nova, anotação ou descarta).
// Sem IA: o texto é o que já foi gravado do grupo (áudio já transcrito pelo Whisper). Foto/PDF/áudio/
// vídeo são salvos no Storage AGORA — o WhatsApp apaga a mídia do servidor depois de um tempo.
// Tirar o 📌 (ou trocar por outro emoji) antes de alguém decidir tira da caixa. O assistente reage 📥
// quando pega a mensagem e ✅ quando ela vira tarefa (task-write › group_react).
const PIN_EMOJI = '📌';
const PIN_MIDIA_MAX = 25 * 1024 * 1024;
const PIN_CAIXA_MAX = 200; // pendentes por pasta: acima disso o 📌 é ignorado (grupo com gente de fora)
const PIN_EXT: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif', 'application/pdf': 'pdf',
  'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/mp4': 'm4a', 'video/mp4': 'mp4',
};
const reagirNoGrupo = (key: Record<string, unknown>, emoji: string) =>
  evo(`/message/sendReaction/${evoInstance}`, { key, reaction: emoji }).catch((e) => log('WARN', 'sendReaction no grupo falhou', { error: errMsg(e) }));

// deno-lint-ignore no-explicit-any
async function pinParaTarefa(admin: SupabaseClient, g: { group_jid: string; name: string | null; task_list_id: string | null }, data: any) {
  const reacao = parseMessage(data.message).inner?.reactionMessage ?? {};
  const emoji = String(reacao.text ?? '').replace(/️/g, '').trim();
  const alvo = reacao.key ?? {};
  const alvoId = String(alvo.id ?? '');
  if (!alvoId || alvo.fromMe || !g.task_list_id) return; // reação em mensagem do próprio assistente: fora
  const quemJid = String(data.key?.participantAlt ?? data.key?.participant ?? '') || null;
  const quem = data.pushName ? String(data.pushName) : null;
  const chave = { remoteJid: g.group_jid, fromMe: false, id: alvoId, ...(alvo.participant ? { participant: String(alvo.participant) } : {}) };

  const { data: existe } = await admin.from('task_whatsapp_items')
    .select('id, status, pinned_by_jid, media_path').eq('message_id', alvoId).maybeSingle();

  if (emoji !== PIN_EMOJI) {
    // Reação removida chega com texto vazio. Só quem marcou tira, e só enquanto ninguém decidiu
    // (sem saber quem marcou, só pela tela).
    if (existe?.status === 'pendente' && quemJid && existe.pinned_by_jid === quemJid) {
      const { data: apagado } = await admin.from('task_whatsapp_items').delete().eq('id', existe.id).eq('status', 'pendente').select('id');
      if (apagado?.length) {
        if (existe.media_path) await admin.storage.from('task-attachments').remove([existe.media_path]);
        await reagirNoGrupo(chave, '');
        log('INFO', '📌 retirado', { group: g.name, message_id: alvoId });
      }
    }
    return;
  }
  if (existe && existe.status !== 'descartado') return; // já está na caixa ou já foi resolvido
  const { count } = await admin.from('task_whatsapp_items').select('id', { count: 'exact', head: true })
    .eq('list_id', g.task_list_id).eq('status', 'pendente');
  if ((count ?? 0) >= PIN_CAIXA_MAX) { log('WARN', '📌 ignorado: caixa da pasta cheia', { group: g.name }); return; }

  // A mensagem marcada: a que já foi gravada do grupo; se não houver (chegou antes de ligar o grupo
  // ou o webhook falhou), busca na Evolution.
  const { data: gravada } = await admin.from('asst_group_messages')
    .select('content, kind, sender_name, sender_jid, media_mime, sent_at').eq('message_id', alvoId).maybeSingle();
  // deno-lint-ignore no-explicit-any
  let bruta: any = null;
  if (!gravada) {
    // deno-lint-ignore no-explicit-any
    const out: any = await evo(`/chat/findMessages/${evoInstance}`, { where: { key: { id: alvoId } }, limit: 1 }).catch(() => null);
    bruta = out?.messages?.records?.[0] ?? null;
    if (!bruta) { log('WARN', '📌 em mensagem que não achei', { group: g.name, message_id: alvoId }); return; }
  }
  const pb = bruta ? parseMessage(bruta.message) : null;
  const kind = String(gravada?.kind ?? pb?.kind ?? 'other');
  let content: string = String(gravada?.content ?? pb?.text ?? '').trim();
  const mime = String(gravada?.media_mime ?? pb?.mime ?? '').split(';')[0].toLowerCase() || null;
  const nomeArquivo = String(pb?.inner?.documentMessage?.fileName ?? '').trim()
    || (content.match(/^\[Arquivo\]\s*(\S+\.\w{2,5})/)?.[1] ?? '') || null;

  // Mídia: baixa e guarda. Áudio que não estava gravado ainda é transcrito aqui.
  let mediaPath: string | null = null;
  let mediaSize: number | null = null;
  if (['image', 'document', 'audio', 'video'].includes(kind)) {
    const b64 = await mediaBase64(bruta ?? { key: chave }).catch(() => null);
    if (b64) {
      if (kind === 'audio' && !gravada) {
        const t = await transcribe(b64, mime ?? 'audio/ogg').catch(() => '');
        content = t ? `[Áudio] ${t}` : '[Áudio não transcrito]';
      }
      const bytes = Uint8Array.from(atob(b64.replace(/^data:[^;]+;base64,/, '')), (c) => c.charCodeAt(0));
      if (bytes.length <= PIN_MIDIA_MAX) {
        const ext = PIN_EXT[mime ?? ''] ?? (nomeArquivo?.match(/\.(\w{2,5})$/)?.[1] ?? 'bin');
        const path = `whatsapp/${g.task_list_id}/${alvoId.replace(/[^A-Za-z0-9_-]/g, '')}.${ext}`;
        const { error: upErr } = await admin.storage.from('task-attachments')
          .upload(path, bytes, { contentType: mime ?? 'application/octet-stream', upsert: true });
        if (upErr) log('WARN', '📌: salvar mídia falhou', { error: upErr.message });
        else { mediaPath = path; mediaSize = bytes.length; }
      } else {
        log('INFO', '📌: mídia grande demais, fica só o texto', { bytes: bytes.length });
        content = [content, '(arquivo grande demais para guardar — veja no WhatsApp)'].filter(Boolean).join('\n');
      }
    } else {
      log('WARN', '📌: mídia não disponível na Evolution', { message_id: alvoId });
      content = [content, '(o arquivo não estava mais disponível no WhatsApp)'].filter(Boolean).join('\n');
    }
  }
  if (!content && !mediaPath) { log('INFO', '📌 em mensagem vazia', { message_id: alvoId }); return; }

  const ts = Number(bruta?.messageTimestamp);
  const item = {
    list_id: g.task_list_id,
    group_jid: g.group_jid,
    group_name: g.name,
    message_id: alvoId,
    sender_name: gravada?.sender_name ?? (bruta?.pushName ? String(bruta.pushName) : null),
    sender_jid: gravada?.sender_jid ?? (String(bruta?.key?.participantAlt ?? bruta?.key?.participant ?? '') || null),
    kind,
    content: content.slice(0, 4000) || null,
    sent_at: gravada?.sent_at ?? (ts > 0 ? new Date(ts * 1000).toISOString() : null),
    media_path: mediaPath,
    media_mime: mediaPath ? mime : null,
    media_name: mediaPath ? nomeArquivo : null,
    media_size: mediaSize,
    pinned_by_name: quem,
    pinned_by_jid: quemJid,
    pinned_at: new Date().toISOString(),
    status: 'pendente',
    task_id: null, decided_by: null, decided_at: null,
  };
  const { error } = await admin.from('task_whatsapp_items').upsert(item, { onConflict: 'message_id' });
  if (error) throw new Error(error.message);
  await reagirNoGrupo(chave, '📥');
  log('INFO', '📌 na caixa da pasta', { group: g.name, list_id: g.task_list_id, kind });

  // Aviso para quem pode decidir (dono da pasta + quem tem "editar"). Falha aqui não desfaz nada.
  try {
    const { data: eds } = await admin.rpc('fn_task_list_editores', { p_list_id: g.task_list_id });
    // deno-lint-ignore no-explicit-any
    const ids = [...new Set(((eds ?? []) as any[]).map((r) => String(r.user_id ?? r)).filter(Boolean))];
    if (ids.length) {
      await fetch(`${supabaseUrl}/functions/v1/send-push`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          action: 'send', user_ids: ids, tenant_id: null,
          payload: {
            titulo: `📌 ${g.name ?? 'Grupo do WhatsApp'}`,
            corpo: `${quem ?? 'Alguém'} marcou: ${(content || '[arquivo]').replace(/\s+/g, ' ').slice(0, 120)}`,
            url: `/tarefas?pasta=${g.task_list_id}&caixa=1`,
          },
        }),
      });
    }
  } catch (e) {
    log('WARN', '📌: aviso push falhou', { error: errMsg(e) });
  }
}

// deno-lint-ignore no-explicit-any
type Parsed = { kind: 'text' | 'audio' | 'image' | 'document' | 'video' | 'other'; text: string | null; mime: string | null; forwarded: boolean; inner: any };

// Desembrulha as mensagens do Baileys (efêmera / visualização única) e
// classifica. O texto útil é a mensagem ou a legenda da mídia.
// deno-lint-ignore no-explicit-any
function parseMessage(msg: any): Parsed {
  let m = msg ?? {};
  for (let i = 0; i < 3; i++) {
    const inner = m.ephemeralMessage?.message ?? m.viewOnceMessage?.message ?? m.viewOnceMessageV2?.message ?? m.documentWithCaptionMessage?.message;
    if (!inner) break;
    m = inner;
  }
  // deno-lint-ignore no-explicit-any
  const ctxOf = (x: any) => x?.contextInfo ?? {};
  if (typeof m.conversation === 'string' && m.conversation.trim()) return { kind: 'text', text: m.conversation, mime: null, forwarded: false, inner: m };
  if (m.extendedTextMessage?.text) return { kind: 'text', text: m.extendedTextMessage.text, mime: null, forwarded: !!ctxOf(m.extendedTextMessage).isForwarded, inner: m };
  if (m.audioMessage) return { kind: 'audio', text: null, mime: m.audioMessage.mimetype ?? 'audio/ogg', forwarded: !!ctxOf(m.audioMessage).isForwarded, inner: m };
  if (m.imageMessage) return { kind: 'image', text: m.imageMessage.caption || null, mime: m.imageMessage.mimetype ?? 'image/jpeg', forwarded: !!ctxOf(m.imageMessage).isForwarded, inner: m };
  if (m.documentMessage) return { kind: 'document', text: m.documentMessage.caption || null, mime: m.documentMessage.mimetype ?? null, forwarded: !!ctxOf(m.documentMessage).isForwarded, inner: m };
  if (m.videoMessage) return { kind: 'video', text: m.videoMessage.caption || null, mime: null, forwarded: false, inner: m };
  return { kind: 'other', text: null, mime: null, forwarded: false, inner: m };
}

// Base64 da mídia: vem no próprio webhook (webhookBase64=true); se não vier,
// pede para a Evolution baixar e decifrar.
// deno-lint-ignore no-explicit-any
async function mediaBase64(data: any): Promise<string | null> {
  const direct = data?.message?.base64 ?? data?.base64;
  if (typeof direct === 'string' && direct.length > 0) return direct;
  try {
    const out = await evo(`/chat/getBase64FromMediaMessage/${evoInstance}`, { message: { key: data.key }, convertToMp4: false });
    return typeof out?.base64 === 'string' ? out.base64 : null;
  } catch (e) {
    log('WARN', 'getBase64FromMediaMessage falhou', { error: errMsg(e) });
    return null;
  }
}

// ── Importar histórico de grupo (arquivo "Exportar conversa" do WhatsApp) ──
// O WhatsApp não entrega a um participante novo as mensagens anteriores à entrada
// dele no grupo, então o único jeito de o assistente ver o passado é o dono exportar
// a conversa no celular (Grupo › ⋮ › Mais › Exportar conversa › Sem mídia) e mandar
// o .txt aqui. Formatos: Android "12/09/2026 10:31 - Nome: msg" e iPhone
// "[12/09/2026, 10:31:05] Nome: msg". Linhas sem data continuam a mensagem anterior.
type ImportedMsg = { sent_at: string; sender: string; content: string; kind: string };
function parseWhatsAppExport(raw: string): ImportedMsg[] {
  const clean = raw.replace(/^﻿/, '').replace(/[‎‏‪-‮]/g, '');
  const head = /^\[?(\d{1,2})\/(\d{1,2})\/(\d{2,4}),?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([ap]\.?\s?m\.?)?\]?\s*(?:[-–]\s*)?(.*)$/i;
  const out: ImportedMsg[] = [];
  for (const line of clean.split(/\r?\n/)) {
    const m = head.exec(line);
    if (!m) { if (out.length && line.trim()) out[out.length - 1].content += `\n${line}`; continue; }
    const [, d, mo, yRaw, hRaw, mi, s, ampm, rest] = m;
    const y = yRaw.length === 2 ? 2000 + Number(yRaw) : Number(yRaw);
    let h = Number(hRaw);
    if (ampm) { const pm = /p/i.test(ampm); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
    const pad = (n: number | string) => String(n).padStart(2, '0');
    const sent_at = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${s ?? '00'}-03:00`;
    if (Number.isNaN(Date.parse(sent_at))) continue;
    const sep = /^([^:]{1,80}?):\s(.*)$/s.exec(rest);
    if (!sep) continue; // linha de sistema ("Fulano entrou", "criou o grupo"...)
    let content = sep[2].trim();
    let kind = 'text';
    if (/^<(mídia|media|arquivo de mídia) (oculta|omitted|oculto)>$/i.test(content) || /\((arquivo anexado|file attached)\)$/i.test(content)) { kind = 'media'; content = '[Mídia]'; }
    if (/^(mensagem apagada|você apagou esta mensagem|this message was deleted)/i.test(content)) continue;
    out.push({ sent_at, sender: sep[1].trim(), content, kind });
  }
  return out;
}
// Hash curto e determinístico (FNV-1a) para message_id: reimportar o mesmo arquivo não duplica.
function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0') + s.length.toString(16);
}
// deno-lint-ignore no-explicit-any
async function importGroupExport(admin: SupabaseClient, number: string, data: any, p: Parsed, msgKey: MsgKey | null, allowed: string[]) {
  const fileName = String(p.inner?.documentMessage?.fileName ?? '');
  const caption = (p.text ?? '').trim();
  // Grupo: pela legenda, senão pelo nome do arquivo ("Conversa do WhatsApp com X.txt").
  const fromFile = fileName.replace(/\.txt$/i, '').replace(/^(conversa do whatsapp com|whatsapp chat with|chat do whatsapp com)\s+/i, '').trim();
  const hint = caption || fromFile;
  const { data: groups } = await admin.from('asst_groups').select('group_jid, name, is_enabled');
  // deno-lint-ignore no-explicit-any
  let known: any[] = groups ?? [];
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const pick = (list: typeof known, h: string) => {
    const k = norm(h);
    const exact = list.filter((g) => norm(String(g.name ?? '')) === k);
    if (exact.length === 1) return exact[0];
    const part = list.filter((g) => k && (norm(String(g.name ?? '')).includes(k) || k.includes(norm(String(g.name ?? '')))));
    return part.length === 1 ? part[0] : null;
  };
  let g = hint ? pick(known, hint) : null;
  if (!g && hint) {
    // Ainda não chegou mensagem do grupo desde a entrada do assistente: procura na Evolution.
    try {
      const all = await evoGet(`/group/fetchAllGroups/${evoInstance}?getParticipants=false`);
      // deno-lint-ignore no-explicit-any
      const cand = (Array.isArray(all) ? all : []).map((x: any) => ({ group_jid: String(x.id), name: String(x.subject ?? x.id), is_enabled: true }));
      const hit = pick(cand, hint);
      if (hit) {
        await admin.from('asst_groups').upsert(hit, { onConflict: 'group_jid', ignoreDuplicates: true });
        g = hit;
      }
    } catch (e) { log('WARN', 'fetchAllGroups falhou', { error: errMsg(e) }); }
  }
  if (!g) {
    await sendText(number, `Recebi o arquivo${fileName ? ` "${fileName}"` : ''}, mas não sei de qual grupo é. Manda de novo com o nome do grupo na legenda${known.length ? ` (acompanho: ${known.map((x) => x.name).join(', ')})` : ''}.`);
    if (msgKey) await react(msgKey, '❓');
    return;
  }
  const b64 = await mediaBase64(data);
  if (!b64) throw new Error('não consegui baixar o arquivo');
  const bytes = Uint8Array.from(atob(b64.replace(/^data:[^;]+;base64,/, '')), (c) => c.charCodeAt(0));
  const msgs = parseWhatsAppExport(new TextDecoder('utf-8').decode(bytes));
  if (!msgs.length) {
    await sendText(number, 'Não achei mensagens nesse arquivo. É o .txt do "Exportar conversa" do WhatsApp? (no iPhone vem em .zip: descompacta e manda o _chat.txt)');
    if (msgKey) await react(msgKey, '❓');
    return;
  }
  const rows = msgs.map((m) => ({
    message_id: `import:${g.group_jid}:${fnv(`${m.sent_at}|${m.sender}|${m.content}`)}`,
    group_jid: g.group_jid, sender_jid: null, sender_name: m.sender.slice(0, 120),
    content: m.content.slice(0, 4000), kind: m.kind, sent_at: m.sent_at,
  }));
  let inserted = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const { data: ins, error } = await admin.from('asst_group_messages').upsert(rows.slice(i, i + 500), { onConflict: 'message_id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(error.message);
    inserted += ins?.length ?? 0;
  }
  if (!g.is_enabled) await admin.from('asst_groups').update({ is_enabled: true, updated_at: new Date().toISOString() }).eq('group_jid', g.group_jid);
  const fmt = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const first = msgs[0].sent_at, last = msgs[msgs.length - 1].sent_at;
  await sendText(number, `Importei ${inserted} mensagens do grupo *${g.name}* (${fmt(first)} a ${fmt(last)}${rows.length - inserted ? `; ${rows.length - inserted} já estavam` : ''}). Já dá pra perguntar sobre esse período.`);
  if (msgKey) await react(msgKey, '✅');
  log('INFO', 'histórico de grupo importado', { group: g.name, total: rows.length, inserted, owner: allowed.length > 0 });
}

async function transcribe(b64: string, mime: string): Promise<string> {
  if (!whisperUrl || !whisperKey) throw new Error('WHISPER_URL/WHISPER_API_KEY não configurados');
  const bytes = Uint8Array.from(atob(b64.replace(/^data:[^;]+;base64,/, '')), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('audio_file', new Blob([bytes], { type: mime.split(';')[0] || 'audio/ogg' }), 'audio.ogg');
  const r = await fetch(`${whisperUrl}/asr?task=transcribe&language=pt&output=json&encode=true&initial_prompt=${encodeURIComponent(WHISPER_PROMPT)}`, {
    method: 'POST',
    headers: { 'X-Api-Key': whisperKey },
    body: form,
  });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  return String(out?.text ?? '').trim();
}

// Mensagem do dono (texto/áudio/foto/PDF, ou voto em enquete já convertido em
// texto): debounce → brain → resposta + ações nativas + reação final.
type Incoming = { chatId: string; kind: Parsed['kind'] | 'poll'; text: string; attachment: { base64: string; media_type: string | null } | null; key: MsgKey | null; forwarded: boolean };
async function processOwner(admin: SupabaseClient, ui: Record<string, unknown>, m: Incoming) {
  const number = m.chatId.replace(/@.*$/, '');
  let text = m.text;
  let keys: MsgKey[] = m.key ? [m.key] : [];
  let placeholder: MsgKey | null = null;
  try {
    // Foto/PDF vai direto (o arquivo não entra na fila); texto e áudio esperam
    // alguns segundos para juntar com as próximas mensagens.
    if (!m.attachment) {
      const merged = await debounce(admin, m.chatId, text, m.key);
      if (merged === null) return; // uma mensagem mais nova vai responder por esta
      text = merged.text;
      keys = merged.keys.length ? merged.keys : keys;
    }
    presence(number, 'composing', 25_000);
    // Modo opcional (asst_settings.ui.edit_placeholder): manda "⏳" e depois EDITA
    // essa mensagem com a resposta, em vez de mandar uma segunda. Desligado por
    // padrão: a reação 👀 + "digitando…" já dão o feedback e o WhatsApp marca
    // a mensagem como "editada".
    if (ui.edit_placeholder === true) {
      const out = await sendText(number, '⏳').catch(() => null);
      if (out?.key?.id) placeholder = { remoteJid: String(out.key.remoteJid ?? m.chatId), fromMe: true, id: String(out.key.id) };
    }

    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ text, chat_id: m.chatId, channel: 'whatsapp', attachment: m.attachment }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out?.reply) throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
    const reply = String(out.reply);
    const toolCalls: Array<{ name: string; ok: boolean }> = Array.isArray(out.tool_calls) ? out.tool_calls : [];
    const silent = reply === 'NO_REPLY';

    if (silent) {
      if (placeholder) await editText(number, placeholder, '👍').catch(() => {});
    } else if (placeholder) {
      await editText(number, placeholder, reply).catch(async (e) => {
        log('WARN', 'updateMessage falhou; mandando nova', { error: errMsg(e) });
        await sendText(number, reply);
      });
    } else {
      await sendText(number, reply);
    }
    await runActions(admin, number, m.chatId, out.actions);

    const emoji = silent ? '👍' : toolCalls.some((t) => t.ok === false) ? '⚠️' : '✅';
    await Promise.all(keys.map((k) => react(k, emoji)));
    log('INFO', silent ? 'sem resposta (NO_REPLY)' : 'respondido', { chatId: m.chatId, kind: m.kind, forwarded: m.forwarded, tools: toolCalls.map((t) => t.name), actions: (out.actions ?? []).map((a: { type: string }) => a.type) });
  } catch (e) {
    log('ERROR', 'falha ao responder', { chatId: m.chatId, kind: m.kind, error: errMsg(e) });
    const msg = 'Deu erro aqui do meu lado. Tenta de novo em instantes.';
    if (placeholder) await editText(number, placeholder, msg).catch(() => sendText(number, msg).catch(() => {}));
    else await sendText(number, msg).catch(() => {});
    await Promise.all(keys.map((k) => react(k, '❌')));
  }
}

// deno-lint-ignore no-explicit-any
async function handle(payload: any) {
  const event = String(payload?.event ?? '').toLowerCase().replace('_', '.');
  if (event !== 'messages.upsert' && event !== 'messages.update') return;
  const data = payload?.data ?? {};
  // messages.update chega a cada "entregue/lido" das nossas mensagens: interessa o voto em enquete e,
  // desde 2026-09-14, o recibo (entregue/lida) das mensagens do agendamento de entrevista.
  if (event === 'messages.update' && !(Array.isArray(data) ? data : [data]).some((it) => it?.pollUpdates || it?.message?.pollUpdates)) {
    await hiringReceipts(Array.isArray(data) ? data : [data]).catch((e) => log('WARN', 'recibo do agendamento', { error: errMsg(e) }));
    return;
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: st } = await admin.from('asst_settings').select('key, value')
    .in('key', ['allowed_chat_ids', 'ui', 'channels', 'group_watch', 'owner_chat_id', 'telegram_owner_chat_id', 'primary_channel']);
  const cfg = Object.fromEntries((st ?? []).map((s) => [s.key, s.value]));
  const allowed: string[] = Array.isArray(cfg.allowed_chat_ids) ? cfg.allowed_chat_ids.map(String) : [];
  const ui: Record<string, unknown> = cfg.ui && typeof cfg.ui === 'object' ? cfg.ui : {};
  // channels.whatsapp_dm = false → o WhatsApp só lê grupos (conversa é no Telegram desde 2026-09-12)
  const dmEnabled = cfg.channels?.whatsapp_dm !== false;

  // Voto em enquete (chega como atualização, não como mensagem nova).
  if (event === 'messages.update') {
    const items = Array.isArray(data) ? data : [data];
    for (const it of items) {
      if (!it?.pollUpdates && !it?.message?.pollUpdates) continue;
      const vote = await pollVoteText(admin, it);
      if (!vote) { log('INFO', 'pollUpdates sem enquete conhecida', { keys: Object.keys(it ?? {}), id: it?.key?.id ?? it?.keyId }); continue; }
      const jidOk = [vote.chatId, vote.chatId.replace(/@.*$/, '')].some((c) => allowed.includes(c));
      if (!jidOk) continue;
      if (vote.kind === 'dre_category') {
        const reply = await handleDreVote(admin, vote.ref, vote.chosen).catch((e) => { log('ERROR', 'voto DRE', { error: errMsg(e) }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; });
        await sendText(vote.chatId.replace(/@.*$/, ''), reply).catch(() => {});
        await admin.from('asst_messages').insert({ channel: 'cron', chat_id: vote.chatId, role: 'assistant', content: `${vote.text}\n${reply}` });
        continue;
      }
      await processOwner(admin, ui, { chatId: vote.chatId, kind: 'poll', text: vote.text, attachment: null, key: null, forwarded: false });
    }
    return;
  }

  const key = data.key ?? {};
  if (key.fromMe) return;
  // Contas novas do WhatsApp podem mandar o remetente como @lid; o número real
  // vem em remoteJidAlt/senderPn.
  const jid = String(key.remoteJid ?? '');
  const altJid = String(key.remoteJidAlt ?? key.senderPn ?? '');
  if (!jid || jid === 'status@broadcast') return; // status: fora
  if (jid.endsWith('@g.us')) { await handleGroup(admin, data, allowed, cfg); return; } // grupo: só lê (mídia lida + triagem de pagamento)
  const candidates = [jid, altJid, jid.replace(/@.*$/, ''), altJid.replace(/@.*$/, '')].filter(Boolean);
  const isOwner = candidates.some((c) => allowed.includes(c));
  // Responde sempre ao JID que chegou (a Evolution resolve @lid e número).
  const chatId = altJid && jid.endsWith('@lid') ? altJid : jid;
  const number = chatId.replace(/@.*$/, '');
  // Para onde RESPONDER: o JID de origem quando é @lid. Em 2026-09-14, depois de um repareamento, o
  // WhatsApp passou a entregar só no @lid (envio para o número "sumia" sem erro). `number` segue sendo
  // o telefone (identidade: histórico, candidato, sessão de agendamento).
  // O evento pode trazer só o telefone mesmo com addressingMode 'lid': resolveLid acha o @lid real.
  const lidJid = await resolveLid(admin, key, number).catch((e) => { log('WARN', 'resolveLid falhou', { error: errMsg(e) }); return null; });
  const replyTo = lidJid ?? number;
  // Reações também só aparecem se a chave apontar para o @lid.
  const msgKey: MsgKey | null = key.id ? { remoteJid: lidJid ?? jid, fromMe: false, id: String(key.id) } : null;
  // Canais públicos (links wa.me com código, 2026-09-14): quem não é o dono vai para o canal-publico,
  // que decide se atende (código do link, conversa aberta ou canal padrão) ou ignora. O dono só entra
  // lá testando: mensagem com o código de um canal, ou teste aberto há menos de 30 min.
  // Agendamento de entrevista (Contratação, 2026-09-14): candidato com conversa de agendamento aberta
  // ou entrevistador respondendo um pedido → hiring-scheduler. Se ele não tratar, segue o canal público.
  // Com o atendimento público na API oficial, DM de desconhecido aqui é ignorada: a resposta sairia pelo
  // outro número (e quase sempre falharia, fora da janela de 24 h dele), e tráfego de candidato neste
  // número foi o que o baniu em 2026-09-14. O return é obrigatório: o que vem abaixo trata a mensagem
  // como sendo do dono.
  const publicoAqui = await publicOnEvolution(admin).catch(() => false);
  if (!isOwner && !publicoAqui) { log('INFO', 'DM de desconhecido ignorada (atendimento público na API oficial)', { chat: chatId }); return; }
  if (!isOwner && await toHiringScheduler(number, data, replyTo).catch((e) => { log('WARN', 'hiring-scheduler', { error: errMsg(e) }); return false; })) return;
  if (!isOwner || (publicoAqui && await ownerTestingPublic(admin, chatId, data))) {
    await toPublicChannel(chatId, number, msgKey, data, isOwner, replyTo);
    return;
  }
  if (!dmEnabled) {
    // Exceção: recebimento de currículos. Só vale quando o dono AVISA antes ("vou mandar currículos"
    // abre 1 h de recebimento; "pronto" encerra) ou põe "currículo" na legenda do arquivo. Arquivo sem
    // aviso não é tratado como currículo (decisão do dono, 2026-09-13).
    const p0 = parseMessage(data.message);
    const txt0 = String(p0.text ?? '').trim();
    const isTxt = p0.kind === 'document' && ((p0.mime ?? '').startsWith('text/plain') || /\.txt$/i.test(String(p0.inner?.documentMessage?.fileName ?? '')));
    const arquivo = (p0.kind === 'document' && !isTxt) || p0.kind === 'image';
    const falaDeCv = /curr[ií]cul/i.test(txt0);
    const { data: jan } = await admin.from('asst_settings').select('value').eq('key', 'wa_cv_intake').maybeSingle();
    // deno-lint-ignore no-explicit-any
    const janela: any = jan?.value?.until && new Date(jan.value.until).getTime() > Date.now() ? jan.value : null;
    if (p0.kind === 'text' && janela && /^(pronto|acabou|terminei|fim|encerrar|encerra|chega|s[oó] isso|era isso|finaliza[r]?)\b/i.test(txt0)) {
      await admin.from('asst_settings').delete().eq('key', 'wa_cv_intake');
      const n = Number(janela.count ?? 0);
      await sendText(replyTo, n ? `Fechado: ${n} currículo${n > 1 ? 's' : ''} salvo${n > 1 ? 's' : ''} em Contratação.` : 'Fechado. Não chegou nenhum currículo.').catch(() => {});
      if (msgKey) react(msgKey, '👍');
      return;
    }
    // Notas antigas que o dono encaminha ("compras" abre 1 h; "pronto" encerra) — 2026-09-20.
    const janelaCompra = await compraIntake(admin);
    if (p0.kind === 'text' && janelaCompra && /^(pronto|acabou|terminei|fim|encerrar|encerra|chega|s[oó] isso|era isso|finaliza[r]?)\b/i.test(txt0)) {
      await admin.from('asst_settings').delete().eq('key', 'wa_compra_intake');
      await sendReply(replyTo, janelaCompra.count ? `Fechado: ${janelaCompra.count} nota${janelaCompra.count > 1 ? 's' : ''} lançada${janelaCompra.count > 1 ? 's' : ''}.` : 'Fechado. Não chegou nenhuma nota.', msgKey, txt0).catch(() => {});
      if (msgKey) react(msgKey, '👍');
      return;
    }
    if (p0.kind === 'text' && COMPRA_ABRE.test(txt0)) {
      await compraIntakeSet(admin, janelaCompra?.count ?? 0);
      await sendReply(replyTo, 'Pode mandar as notas (foto ou PDF), uma de cada vez. Eu lanço a compra e confirmo o recebimento. Quando terminar, manda "pronto".', msgKey, txt0).catch(() => {});
      if (msgKey) react(msgKey, '👍');
      return;
    }
    // "lançar mesmo assim": solta a nota que ficou segurada pela conferência de duplicidade.
    if (p0.kind === 'text' && /^(lan[çc]ar? mesmo assim|pode lan[çc]ar|lan[çc]a mesmo assim|confirmo|é outra( compra)?)\b/i.test(txt0)) {
      const { data: pend } = await admin.from('asst_settings').select('value').eq('key', 'wa_compra_pendente').maybeSingle();
      // deno-lint-ignore no-explicit-any
      const v: any = pend?.value;
      if (!v?.prompt || new Date(v.until ?? 0).getTime() < Date.now()) {
        await sendReply(replyTo, 'Não tenho nenhuma nota esperando confirmação. Manda a nota de novo.', msgKey, txt0).catch(() => {});
        return;
      }
      await admin.from('asst_settings').delete().eq('key', 'wa_compra_pendente');
      await lancarCompraPendente(admin, cfg, replyTo, msgKey, String(v.prompt));
      return;
    }
    if (arquivo && (janelaCompra || COMPRA_LEGENDA.test(txt0))) {
      await notaEncaminhada(admin, cfg, replyTo, msgKey, data, p0);
      if (janelaCompra) await compraIntakeSet(admin, janelaCompra.count + 1);
      return;
    }
    if (p0.kind === 'text' && falaDeCv && txt0.length < 250) {
      await admin.from('asst_settings').upsert({ key: 'wa_cv_intake', value: { until: new Date(Date.now() + 60 * 60_000).toISOString(), count: Number(janela?.count ?? 0) }, updated_at: new Date().toISOString() });
      await sendText(replyTo, 'Pode mandar os currículos (PDF, foto ou texto). Quando terminar, manda "pronto".').catch(() => {});
      if (msgKey) react(msgKey, '👍');
      return;
    }
    if ((arquivo && (janela || falaDeCv)) || (p0.kind === 'text' && janela && txt0.length >= 250)) {
      const res = await cvFromWhatsApp(admin, replyTo, msgKey, data, p0);
      // Não era currículo (ex.: demanda encaminhada com a janela aberta) → vai para o Telegram
      if (res === 'not_cv') { await relayToTelegram(admin, cfg, chatId, replyTo, msgKey, data, p0); return; }
      if (res === 'ok' && janela) {
        await admin.from('asst_settings').upsert({ key: 'wa_cv_intake', value: { until: new Date(Date.now() + 60 * 60_000).toISOString(), count: Number(janela.count ?? 0) + 1 }, updated_at: new Date().toISOString() });
      }
      return;
    }
    // .txt = exportação de conversa do WhatsApp → histórico de grupo (como antes)
    if (isTxt) { await importGroupExport(admin, replyTo, data, p0, msgKey, allowed); return; }
    // Todo o resto (texto, áudio, foto, PDF — inclusive arquivo sem aviso de currículo) vai para o
    // assistente do Telegram, que responde lá.
    await relayToTelegram(admin, cfg, chatId, replyTo, msgKey, data, p0);
    return;
  }

  const p = parseMessage(data.message);
  if (p.inner?.pollUpdateMessage) return; // voto cifrado: o decifrado vem em messages.update
  let text = p.text ? p.text.trim() : '';
  // deno-lint-ignore no-explicit-any
  let attachment: any = null;

  // Feedback imediato: 👀 na mensagem + "digitando…"/"gravando…" (sem gastar tokens).
  if (msgKey) react(msgKey, '👀');
  presence(number, p.kind === 'audio' ? 'recording' : 'composing', 8_000);

  try {
    if (p.kind === 'audio') {
      const b64 = await mediaBase64(data);
      if (!b64) throw new Error('não consegui baixar o áudio');
      const transcript = await transcribe(b64, p.mime ?? 'audio/ogg');
      if (!transcript) { await sendText(number, 'Não consegui entender o áudio. Pode repetir ou mandar em texto?'); if (msgKey) await react(msgKey, '❓'); return; }
      text = `[Áudio] ${transcript}`;
    } else if (p.kind === 'document' && ((p.mime ?? '').startsWith('text/plain') || /\.txt$/i.test(String(p.inner?.documentMessage?.fileName ?? '')))) {
      // .txt = exportação de conversa do WhatsApp → histórico de grupo (sem passar pelo brain)
      await importGroupExport(admin, number, data, p, msgKey, allowed);
      return;
    } else if (p.kind === 'image' || (p.kind === 'document' && (p.mime === 'application/pdf' || IMAGE_TYPES.includes(p.mime ?? '')))) {
      const b64 = await mediaBase64(data);
      if (!b64) throw new Error('não consegui baixar o arquivo');
      attachment = { base64: b64, media_type: p.mime };
    } else if (p.kind === 'video' || p.kind === 'document' || p.kind === 'other') {
      if (!text) {
        await sendText(number, p.kind === 'video'
          ? 'Vídeo eu ainda não consigo ver. Me conta em texto ou áudio o que precisa?'
          : 'Esse tipo de arquivo eu não leio. Manda como foto ou PDF, ou me diz em texto o que fazer.');
        if (msgKey) await react(msgKey, '❓');
        return;
      }
    }
    if (p.forwarded) text = `[Encaminhada] ${text}`.trim();
  } catch (e) {
    log('ERROR', 'falha ao preparar mensagem', { chatId, kind: p.kind, error: errMsg(e) });
    await sendText(number, 'Deu erro aqui do meu lado. Tenta de novo em instantes.').catch(() => {});
    if (msgKey) await react(msgKey, '❌');
    return;
  }
  // Resposta a uma pergunta do sistema (classificação DRE): gravada direto, sem modelo.
  if (!attachment && !p.forwarded && (p.kind === 'text' || p.kind === 'audio')) {
    const stanza = p.inner?.extendedTextMessage?.contextInfo?.stanzaId;
    const answered = await tryDreAnswer(admin, number, chatId, text.replace(/^\[Áudio\]\s*/, '').replace(/[.!]+$/, ''), stanza ? String(stanza) : null, msgKey)
      .catch((e) => { log('ERROR', 'tryDreAnswer', { error: errMsg(e) }); return false; });
    if (answered) return;
  }
  await processOwner(admin, ui, { chatId, kind: p.kind, text, attachment, key: msgKey, forwarded: p.forwarded });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const url = new URL(req.url);
  const provided = req.headers.get('x-internal-key') ?? url.searchParams.get('key') ?? '';
  const bearer = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  const okBearer = !!serviceRoleKey && bearer === serviceRoleKey; // chamada entre edges/manutenção
  if (!okBearer && (internalKey.length < 20 || provided !== internalKey)) return json({ error: 'Unauthorized' }, 401);
  if (!evoUrl || !evoKey) return json({ error: 'EVOLUTION_URL/EVOLUTION_API_KEY não configurados' }, 503);

  let payload: unknown;
  try { payload = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  // Escrita em grupo, sempre respondendo a mensagem de um pedido e só em grupo acompanhado. Dois
  // usos: comprovante de pagamento (assistente-telegram, texto montado pelo código) e, desde
  // 2026-09-16, a pergunta dos dias trabalhados de freelancer (brain › responder_no_grupo, que só
  // aceita pedido com diária aguardando os dias e pergunta uma vez por pedido).
  // deno-lint-ignore no-explicit-any
  const gs = payload as any;
  if (gs?.action === 'group_send') {
    const jid = String(gs.group_jid ?? '');
    const text = String(gs.text ?? '').slice(0, 3000);
    if (!/@g\.us$/.test(jid) || !text) return json({ error: 'group_jid/text inválidos' }, 400);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: g } = await admin.from('asst_groups').select('is_enabled').eq('group_jid', jid).maybeSingle();
    if (!g?.is_enabled) return json({ error: 'grupo não acompanhado' }, 403);
    // Responde a mensagem do pedido: em grupo a citação precisa do autor (participant).
    let quoted: Record<string, unknown> | null = null;
    if (gs.quoted_message_id) {
      const { data: orig } = await admin.from('asst_group_messages').select('sender_jid, content').eq('message_id', String(gs.quoted_message_id)).maybeSingle();
      quoted = { key: { id: String(gs.quoted_message_id), remoteJid: jid, fromMe: false, ...(orig?.sender_jid ? { participant: orig.sender_jid } : {}) }, message: { conversation: String(orig?.content ?? '').split('\n')[0].slice(0, 200) } };
    }
    const img = typeof gs.image_base64 === 'string' && gs.image_base64 ? gs.image_base64 : null;
    const send = (q: Record<string, unknown> | null) => img
      ? evo(`/message/sendMedia/${evoInstance}`, { number: jid, mediatype: 'image', mimetype: 'image/png', media: img, fileName: 'comprovante.png', caption: text, ...(q ? { quoted: q } : {}) })
      : evo(`/message/sendText/${evoInstance}`, { number: jid, text, ...(q ? { quoted: q } : {}) });
    try {
      await send(quoted);
    } catch (e) {
      if (!quoted) return json({ error: errMsg(e) }, 502);
      log('WARN', 'comprovante com citação falhou; enviando sem', { error: errMsg(e) });
      try { await send(null); } catch (e2) { return json({ error: errMsg(e2) }, 502); }
    }
    return json({ ok: true });
  }

  // 👍 na mensagem que pediu o pagamento, quando o pedido fica todo pago (2026-09-18, pedido do
  // dono). Mesma regra do group_send: só grupo acompanhado. Em grupo a chave precisa do autor.
  if (gs?.action === 'group_react') {
    const jid = String(gs.group_jid ?? '');
    const id = String(gs.message_id ?? '');
    if (!/@g\.us$/.test(jid) || !id) return json({ error: 'group_jid/message_id inválidos' }, 400);
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data: g } = await admin.from('asst_groups').select('is_enabled').eq('group_jid', jid).maybeSingle();
    if (!g?.is_enabled) return json({ error: 'grupo não acompanhado' }, 403);
    const { data: orig } = await admin.from('asst_group_messages').select('sender_jid').eq('message_id', id).maybeSingle();
    try {
      await evo(`/message/sendReaction/${evoInstance}`, {
        key: { remoteJid: jid, fromMe: false, id, ...(orig?.sender_jid ? { participant: orig.sender_jid } : {}) },
        reaction: String(gs.emoji ?? '👍').slice(0, 8),
      });
    } catch (e) { return json({ error: errMsg(e) }, 502); }
    return json({ ok: true });
  }

  // Manutenção: relê a foto/PDF de uma mensagem de grupo já gravada (a imagem não
  // fica salva; a Evolution devolve pelo message_id). Só atualiza content/extracted,
  // não refaz a triagem de pagamento.
  // deno-lint-ignore no-explicit-any
  const pl = payload as any;
  if (pl?.action === 'reler_midia' && pl?.message_id) {
    try {
      const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
      const { data: m } = await admin.from('asst_group_messages').select('id, message_id, group_jid, sender_name, sender_jid, content, media_mime')
        .eq('message_id', String(pl.message_id)).maybeSingle();
      if (!m) return json({ error: 'mensagem não encontrada' }, 404);
      const b64 = await mediaBase64({ key: { id: m.message_id, remoteJid: m.group_jid, fromMe: false, participant: m.sender_jid ?? undefined } });
      if (!b64) return json({ error: 'Evolution não devolveu a mídia' }, 502);
      // Comparação de modelos da leitura (2026-09-24): lê com os dois e devolve, sem gravar nada.
      if (pl.comparar === true) {
        const ler = (modelo: string) => brainCall({ action: 'ler_midia', attachment: { base64: b64, media_type: m.media_mime ?? 'image/jpeg' }, legenda: '', contexto: `Mensagem de grupo${m.sender_name ? `, mandada por ${m.sender_name}` : ''}.`, modelo, so_ler: true });
        const [haiku, sonnet] = await Promise.all([ler('haiku'), ler('sonnet')]);
        return json({ ok: true, haiku: { lido: haiku?.lido, usage: haiku?.usage }, sonnet: { lido: sonnet?.lido, usage: sonnet?.usage } });
      }
      const extracted = await lerMidia(b64, m.media_mime ?? 'image/jpeg', '', `Mensagem de grupo${m.sender_name ? `, mandada por ${m.sender_name}` : ''}.`, `grupo:${m.group_jid}`);
      const cabeca = String(m.content ?? '').split('\n')[0];
      const resumo = String(extracted?.resumo ?? '').trim();
      const texto = String(extracted?.texto ?? '').trim();
      const content = resumo ? `${cabeca}\n${resumo}${texto ? `\nTexto do arquivo: ${texto}` : ''}` : m.content;
      await admin.from('asst_group_messages').update({ content: String(content).slice(0, 4000), extracted }).eq('id', m.id);
      return json({ ok: true, extracted });
    } catch (e) {
      return json({ error: errMsg(e) }, 500);
    }
  }

  // Continuação da fila de documentos de grupo (o trabalhador anterior passou do tempo) ou a
  // varredura do assistente-cron para pedido que ficou parado na fila.
  if (pl?.action === 'processar_fila') {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const job = (async () => {
      const { data: st } = await admin.from('asst_settings').select('key, value');
      await processarFilaGrupo(admin, Object.fromEntries((st ?? []).map((s) => [s.key, s.value])));
    })().catch((e) => log('ERROR', 'processar_fila', { error: errMsg(e) }));
    // deno-lint-ignore no-explicit-any
    (globalThis as any).EdgeRuntime?.waitUntil?.(job);
    return json({ ok: true });
  }

  const p = handle(payload).catch((e) => log('ERROR', 'unhandled', { error: errMsg(e) }));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  return json({ ok: true });
});

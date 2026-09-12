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
async function avisarDono(admin: SupabaseClient, ownerChat: string, reply: string, actions: any[]) {
  if (ownerChat.startsWith('tg:')) {
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'deliver', chat_key: ownerChat, text: reply, actions }),
    });
    if (!r.ok) throw new Error(`assistente-telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return;
  }
  const number = ownerChat.replace(/@.*$/, '');
  await sendText(number, reply);
  await runActions(admin, number, ownerChat, actions);
}

// Triagem: mensagem de grupo que parece pedido de pagamento → brain (modo
// 'triagem_grupo') → pagamento preparado + aviso ao dono. Uma linha por mensagem em
// asst_group_requests (message_id único), então reenvio do webhook não prepara 2×.
// deno-lint-ignore no-explicit-any
async function triarPagamento(admin: SupabaseClient, cfg: Record<string, any>, g: any, msg: { messageId: string | null; sender: string | null; content: string; extracted: any; sentAt: string }) {
  const conf = { ...GROUP_WATCH_DEFAULTS, ...(cfg.group_watch && typeof cfg.group_watch === 'object' ? cfg.group_watch : {}) };
  if (conf.pay_requests === false) return;
  const ownerChat = ownerChatOf(cfg);
  if (!ownerChat) { log('WARN', 'pedido de pagamento sem destino', { group: g.name }); return; }
  // Trava de custo: no máximo N triagens por dia (mensagem de grupo é de terceiros).
  const desde = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count } = await admin.from('asst_group_requests').select('id', { count: 'exact', head: true }).gte('created_at', desde);
  if ((count ?? 0) >= Number(conf.max_per_day ?? 30)) { log('WARN', 'limite diário de triagem atingido', { count }); return; }
  // message_id único: se já existe, outra execução já cuidou deste pedido.
  const { data: req, error } = await admin.from('asst_group_requests').insert({
    message_id: msg.messageId, group_jid: g.group_jid, group_name: g.name, sender_name: msg.sender,
    kind: 'pagamento', status: 'novo', data: { texto: msg.content, extraido: msg.extracted, sent_at: msg.sentAt },
  }).select('id').maybeSingle();
  if (error || !req) { if (error && !/duplicate|unique/i.test(error.message)) log('WARN', 'gravar solicitação', { error: error.message }); return; }

  // Conteúdo de terceiros vai DELIMITADO (e sem forjar a própria tag nem os atributos):
  // é dado, nunca ordem.
  const limpo = msg.content.replace(/<\/?mensagem_do_grupo[^>]*>/gi, '').slice(0, 3000);
  const attr = (v: string) => v.replace(/["<>]/g, ' ').slice(0, 80);
  const quando = new Date(msg.sentAt).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const prompt = [
    `[Sistema] Mensagem no grupo "${attr(String(g.name ?? ''))}" que parece pedido de pagamento (triagem automática).`,
    `<mensagem_do_grupo grupo="${attr(String(g.name ?? ''))}" autor="${attr(msg.sender ?? 'desconhecido')}" quando="${quando}">`,
    limpo,
    '</mensagem_do_grupo>',
    msg.extracted ? `Leitura automática do arquivo anexado: ${JSON.stringify(msg.extracted).slice(0, 2000)}` : '',
    'Siga as regras de TRIAGEM AUTOMÁTICA DE GRUPO.',
  ].filter(Boolean).join('\n');

  try {
    const out = await brainCall({ text: prompt, chat_id: ownerChat, channel: ownerChat.startsWith('tg:') ? 'telegram' : 'whatsapp', modo: 'triagem_grupo' });
    const reply = String(out?.reply ?? '').trim();
    // deno-lint-ignore no-explicit-any
    const actions: any[] = Array.isArray(out?.actions) ? out.actions : [];
    const pagamento = actions.find((a) => a?.type === 'payment');
    if (!reply || reply === 'NO_REPLY') {
      await admin.from('asst_group_requests').update({ status: 'ignorado', updated_at: new Date().toISOString() }).eq('id', req.id);
      log('INFO', 'triagem: não era pedido de pagamento', { group: g.name });
      return;
    }
    await avisarDono(admin, ownerChat, reply, actions);
    await admin.from('asst_group_requests').update({
      status: pagamento ? 'preparado' : 'incompleto', payment_id: pagamento ? String(pagamento.id) : null,
      reply: reply.slice(0, 2000), notified_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq('id', req.id);
    log('INFO', 'triagem de pagamento', { group: g.name, sender: msg.sender, preparado: !!pagamento });
  } catch (e) {
    await admin.from('asst_group_requests').update({ status: 'erro', error: errMsg(e).slice(0, 500), updated_at: new Date().toISOString() }).eq('id', req.id);
    log('ERROR', 'triagem de pagamento falhou', { group: g.name, error: errMsg(e) });
    // O dono precisa saber que chegou um pedido mesmo quando a triagem quebra.
    await avisarDono(admin, ownerChat, `Chegou um pedido de pagamento no grupo *${g.name}*${msg.sender ? ` (${msg.sender})` : ''} e eu não consegui preparar: ${errMsg(e).slice(0, 160)}. Dá uma olhada lá.`, []).catch(() => {});
  }
}

// Grupos: o assistente SÓ LÊ — guarda a mensagem em asst_group_messages e nunca
// responde no grupo. Na primeira mensagem de um grupo busca nome e participantes;
// a leitura só liga sozinha se o dono estiver no grupo (qualquer pessoa pode
// adicionar o número do assistente num grupo). Liga/desliga na tela Assistente.
// deno-lint-ignore no-explicit-any
async function handleGroup(admin: SupabaseClient, data: any, allowed: string[], cfg: Record<string, any> = {}) {
  const groupJid = String(data.key.remoteJid);
  const ownerNums = allowed.map((a) => a.replace(/@.*$/, ''));
  let { data: g } = await admin.from('asst_groups').select('group_jid, name, is_enabled').eq('group_jid', groupJid).maybeSingle();
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
    g = { group_jid: groupJid, name, is_enabled: ownerIn };
    await admin.from('asst_groups').upsert(g, { onConflict: 'group_jid', ignoreDuplicates: true });
    log('INFO', 'grupo novo', { groupJid, name, is_enabled: ownerIn });
  }
  if (!g.is_enabled) return;

  const conf = { ...GROUP_WATCH_DEFAULTS, ...(cfg.group_watch && typeof cfg.group_watch === 'object' ? cfg.group_watch : {}) };
  const p = parseMessage(data.message);
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

  // Pedido de pagamento? A leitura da mídia manda quando existe; senão, o texto.
  const pedido = extracted?.pagamento
    ? extracted.pagamento.e_solicitacao === true
    : PAY_HINT.test(baseText);
  if (!pedido) return;
  await triarPagamento(admin, cfg, g, { messageId, sender, content, extracted, sentAt });
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
  // messages.update chega a cada "entregue/lido" das nossas mensagens: só interessa voto em enquete.
  if (event === 'messages.update' && !(Array.isArray(data) ? data : [data]).some((it) => it?.pollUpdates || it?.message?.pollUpdates)) return;
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
  if (!candidates.some((c) => allowed.includes(c))) {
    log('WARN', 'remetente não autorizado (ignorado)', { jid, altJid, pushName: data.pushName });
    return;
  }
  // Responde sempre ao JID que chegou (a Evolution resolve @lid e número).
  const chatId = altJid && jid.endsWith('@lid') ? altJid : jid;
  const number = chatId.replace(/@.*$/, '');
  const msgKey: MsgKey | null = key.id ? { remoteJid: jid, fromMe: false, id: String(key.id) } : null;
  if (!dmEnabled) {
    // Só avisa uma vez por dia para não virar conversa
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    if (ui.wa_dm_notice_date !== today) {
      await admin.from('asst_settings').upsert({ key: 'ui', value: { ...ui, wa_dm_notice_date: today }, updated_at: new Date().toISOString() });
      await sendText(number, 'Agora eu converso pelo Telegram. Aqui no WhatsApp só acompanho os grupos.').catch(() => {});
    }
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
  if (internalKey.length < 20 || provided !== internalKey) return json({ error: 'Unauthorized' }, 401);
  if (!evoUrl || !evoKey) return json({ error: 'EVOLUTION_URL/EVOLUTION_API_KEY não configurados' }, 503);

  let payload: unknown;
  try { payload = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }

  const p = handle(payload).catch((e) => log('ERROR', 'unhandled', { error: errMsg(e) }));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  return json({ ok: true });
});

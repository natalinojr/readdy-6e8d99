// assistente-telegram — canal Telegram do assistente pessoal do dono (projeto
// PESSOAL; ver assistente/README.md). Desde 2026-09-12 é o canal PRINCIPAL de
// conversa; o WhatsApp fica para leitura de grupos.
//
// Telegram → POST aqui (setWebhook com secret_token = ASSISTENTE_INTERNAL_KEY,
// conferido no header X-Telegram-Bot-Api-Secret-Token). Só responde aos ids em
// asst_settings.telegram_allowed_ids; desconhecido recebe o próprio id (para
// cadastro) e nada mais.
//
// Entrada: texto, voz/áudio (→ Whisper na VPS), foto e PDF (→ brain como anexo),
// clique em botão (callback_query → "[Botão "pergunta"] Resposta: X").
// Saída: texto (HTML: *negrito* do modelo vira <b>), enquete do brain vira
// TECLADO INLINE (botões), localização e contato nativos. Reações: 👀 recebi,
// 👍 respondi, 🤔 ferramenta falhou, 😱 erro, 🫡 sem resposta (NO_REPLY).
//
// Secrets: TELEGRAM_BOT_TOKEN, ASSISTENTE_INTERNAL_KEY, WHISPER_URL, WHISPER_API_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'assistente-telegram', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
const whisperUrl = (Deno.env.get('WHISPER_URL') ?? '').replace(/\/$/, '');
const whisperKey = Deno.env.get('WHISPER_API_KEY') ?? '';
const API = `https://api.telegram.org/bot${botToken}`;
// Vocabulário para o Whisper (initial_prompt): sem isso "Paranaguá" virou "parar na água" (2026-09-12).
const WHISPER_PROMPT = 'Conversa com o Natalino, dono dos restaurantes El Patrón em Paranaguá (PR), lojas Vila Leste e Paranaguá. ERPOS, cardápio, fornecedor, conta a pagar, DRE, CMV, estoque, insumo, Pix, Inter, Stone, iFood, delivery, motoboy, hambúrguer, pastel.';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

// deno-lint-ignore no-explicit-any
async function tg(method: string, body: unknown): Promise<any> {
  const r = await fetch(`${API}/${method}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || out?.ok === false) throw new Error(`Telegram ${method} → ${r.status}: ${String(out?.description ?? '').slice(0, 200)}`);
  return out.result;
}
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// O modelo escreve no estilo WhatsApp (*negrito*, _itálico_); converte para HTML do Telegram.
function toHtml(text: string): string {
  return esc(text)
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<b>$2</b>')
    .replace(/(^|[\s(])_([^_\n]+)_(?=[\s).,;:!?]|$)/g, '$1<i>$2</i>')
    .replace(/```([\s\S]*?)```/g, '<pre>$1</pre>');
}
// Mensagem longa: Telegram aceita 4096 caracteres; quebra em parágrafos.
async function sendText(chatId: number | string, text: string, extra: Record<string, unknown> = {}) {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > 3900) { let cut = rest.lastIndexOf('\n\n', 3900); if (cut < 1000) cut = rest.lastIndexOf('\n', 3900); if (cut < 1000) cut = 3900; parts.push(rest.slice(0, cut)); rest = rest.slice(cut).trimStart(); }
  parts.push(rest);
  let last = null;
  for (let i = 0; i < parts.length; i++) {
    const isLast = i === parts.length - 1;
    try { last = await tg('sendMessage', { chat_id: chatId, text: toHtml(parts[i]), parse_mode: 'HTML', ...(isLast ? extra : {}) }); }
    catch { last = await tg('sendMessage', { chat_id: chatId, text: parts[i], ...(isLast ? extra : {}) }); } // HTML inválido → texto puro
  }
  return last;
}
const react = (chatId: number | string, messageId: number, emoji: string) =>
  tg('setMessageReaction', { chat_id: chatId, message_id: messageId, reaction: emoji ? [{ type: 'emoji', emoji }] : [] }).catch(() => {});
const typing = (chatId: number | string, action: 'typing' | 'upload_photo' = 'typing') => { tg('sendChatAction', { chat_id: chatId, action }).catch(() => {}); };

async function fileBase64(fileId: string): Promise<{ base64: string; path: string }> {
  const f = await tg('getFile', { file_id: fileId });
  const r = await fetch(`https://api.telegram.org/file/bot${botToken}/${f.file_path}`);
  if (!r.ok) throw new Error(`download ${r.status}`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  let bin = ''; const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) bin += String.fromCharCode(...bytes.subarray(i, i + CH));
  return { base64: btoa(bin), path: String(f.file_path) };
}
async function transcribe(b64: string, mime: string): Promise<string> {
  if (!whisperUrl || !whisperKey) throw new Error('WHISPER_URL/WHISPER_API_KEY não configurados');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('audio_file', new Blob([bytes], { type: mime }), 'audio.ogg');
  const r = await fetch(`${whisperUrl}/asr?task=transcribe&language=pt&output=json&encode=true&initial_prompt=${encodeURIComponent(WHISPER_PROMPT)}`, { method: 'POST', headers: { 'X-Api-Key': whisperKey }, body: form });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return String((await r.json())?.text ?? '').trim();
}

// Debounce igual ao do WhatsApp (asst_inbox): mensagens seguidas viram 1 chamada.
const DEBOUNCE_MS = 2500;
async function debounce(admin: SupabaseClient, chatKey: string, text: string, messageId: number | null): Promise<{ text: string; ids: number[] } | null> {
  const { data: row, error } = await admin.from('asst_inbox').insert({ chat_id: chatKey, text, message_key: messageId ? { tg: messageId } : null }).select('id').single();
  if (error || !row) return { text, ids: messageId ? [messageId] : [] };
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const { data: newer } = await admin.from('asst_inbox').select('id').eq('chat_id', chatKey).is('processed_at', null).gt('id', row.id).limit(1);
  if (newer?.length) return null;
  const { data: batch } = await admin.from('asst_inbox').update({ processed_at: new Date().toISOString() }).eq('chat_id', chatKey).is('processed_at', null).select('id, text, message_key');
  if (!batch?.length) return null;
  const sorted = batch.sort((a, b) => Number(a.id) - Number(b.id));
  // deno-lint-ignore no-explicit-any
  return { text: sorted.map((b) => String(b.text)).join('\n'), ids: sorted.map((b) => Number((b.message_key as any)?.tg)).filter((n) => n > 0) };
}

// Ações do brain → recursos nativos do Telegram.
// deno-lint-ignore no-explicit-any
async function runActions(admin: SupabaseClient, chatId: number, chatKey: string, actions: any[]) {
  for (const a of Array.isArray(actions) ? actions : []) {
    try {
      if (a.type === 'poll') {
        // Enquete vira teclado inline: 1 botão por linha (opções longas), callback = índice.
        const { data: p, error } = await admin.from('asst_polls').insert({ message_id: `tg:${chatId}:${crypto.randomUUID()}`, chat_id: chatKey, question: String(a.question), options: a.options, kind: 'tg_buttons' }).select('message_id').single();
        if (error || !p) throw new Error(error?.message ?? 'asst_polls');
        const key = String(p.message_id);
        const rows = (a.options as string[]).map((o, i) => [{ text: o.slice(0, 60), callback_data: `${key.slice(-36)}|${i}` }]);
        const m = await tg('sendMessage', { chat_id: chatId, text: toHtml(`❓ *${a.question}*`), parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } });
        await admin.from('asst_polls').update({ ref: { tg_message_id: m.message_id } }).eq('message_id', key);
      } else if (a.type === 'location') {
        await tg('sendVenue', { chat_id: chatId, latitude: a.lat, longitude: a.lng, title: a.name, address: a.address ?? '' });
      } else if (a.type === 'contact') {
        await tg('sendContact', { chat_id: chatId, phone_number: `+${a.phone}`, first_name: a.name, vcard: a.org ? `BEGIN:VCARD\nVERSION:3.0\nFN:${a.name}\nORG:${a.org}\nTEL:+${a.phone}\nEND:VCARD` : undefined });
      }
    } catch (e) {
      log('WARN', 'ação falhou', { type: a?.type, error: errMsg(e) });
      await sendText(chatId, `Não consegui enviar ${a?.type === 'poll' ? 'os botões' : a?.type === 'location' ? 'a localização' : 'o contato'} (${errMsg(e).slice(0, 120)}).`).catch(() => {});
    }
  }
}

// ── Classificação DRE (pergunta enviada pelo assistente-cron com BOTÕES) ──
// asst_polls: kind 'dre_category', message_id 'tgdre:<chat>:<message_id>', ref {tenant_id,
// bill_id, options[{n,label,category_id}], groups}. Botão "d|<n>" (0 = pular) ou resposta
// digitada (número, nome da categoria, "grupo + nome" para criar, "pular").
// dreAnswer/applyDreChoice são CÓPIA do assistente-webhook (mesma regra do pay_bill):
// ao mudar lá, mudar aqui.
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
// deno-lint-ignore no-explicit-any
async function applyDreChoice(admin: SupabaseClient, ref: any, opt: any): Promise<string> {
  const tenantId = String(ref?.tenant_id ?? '');
  const billId = String(ref?.bill_id ?? '');
  if (!tenantId || !billId) return 'Não achei a conta dessa pergunta; classifica no sistema, por favor.';
  const { data: bill } = await admin.from('fin_accounts_payable').select('id, description, amount, dre_category_id').eq('id', billId).eq('tenant_id', tenantId).maybeSingle();
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
      const { data: nova, error } = await admin.from('fin_dre_categories').insert({ tenant_id: tenantId, name: nome, group_type: opt.group, sort_order: 0, is_active: true }).select('id').single();
      if (error || !nova) { log('ERROR', 'criar categoria DRE falhou', { tenantId, error: error?.message }); return 'Não consegui criar a categoria; classifica no sistema, por favor.'; }
      catId = nova.id;
    }
  }
  const { error } = await admin.from('fin_accounts_payable').update({ dre_category_id: catId }).eq('id', billId).eq('tenant_id', tenantId).is('dre_category_id', null);
  if (error) { log('ERROR', 'classificar conta falhou', { billId, error: error.message }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; }
  return `✅ Classificada em *${opt.label}*: ${desc}.`;
}
// Próxima pergunta já (sem esperar o tick do cron)
const nextDre = () => fetch(`${supabaseUrl}/functions/v1/assistente-cron`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify({ run: 'dre_classify' }),
}).catch((e) => log('WARN', 'próxima pergunta DRE', { error: errMsg(e) }));
// Marca respondida só se ainda estava aberta (clique duplo / resposta dupla não gravam 2×).
async function claimDre(admin: SupabaseClient, messageId: string, answer: string): Promise<boolean> {
  const { data } = await admin.from('asst_polls').update({ answered_at: new Date().toISOString(), answer: [answer] }).eq('message_id', messageId).is('answered_at', null).select('message_id');
  return !!data?.length;
}
// deno-lint-ignore no-explicit-any
async function handleDreClick(admin: SupabaseClient, cq: any) {
  const chatId = Number(cq.message?.chat?.id);
  const mid = Number(cq.message?.message_id);
  const key = `tgdre:${chatId}:${mid}`;
  const { data: poll } = await admin.from('asst_polls').select('message_id, question, ref').eq('message_id', key).maybeSingle();
  if (!poll) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Essa pergunta expirou.' }).catch(() => {}); return; }
  const n = Number(String(cq.data).split('|')[1]);
  // deno-lint-ignore no-explicit-any
  const opt = n === 0 ? { skip: true, label: 'Pular' } : (Array.isArray(poll.ref?.options) ? poll.ref.options : []).find((o: any) => Number(o.n) === n);
  if (!opt) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Opção inválida.' }).catch(() => {}); return; }
  if (!(await claimDre(admin, key, String(opt.label)))) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Essa já foi respondida.' }).catch(() => {}); return; }
  await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `✔ ${String(opt.label).slice(0, 180)}` }).catch(() => {});
  const reply = await applyDreChoice(admin, poll.ref, opt).catch((e) => { log('ERROR', 'resposta DRE', { error: errMsg(e) }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; });
  await tg('editMessageText', { chat_id: chatId, message_id: mid, text: toHtml(`🏷️ ${poll.question}\n${reply}`), parse_mode: 'HTML' }).catch(() => {});
  await admin.from('asst_messages').insert([
    { channel: 'telegram', chat_id: `tg:${chatId}`, role: 'user', content: `[Botão DRE "${poll.question}"] ${opt.label}` },
    { channel: 'cron', chat_id: `tg:${chatId}`, role: 'assistant', content: reply },
  ]);
  nextDre();
}
// Resposta DIGITADA a uma pergunta DRE aberta: a citada (reply) ou, sem citação, a única
// em aberto — e aí só se o texto parece resposta (senão segue para o brain).
async function tryDreAnswerTg(admin: SupabaseClient, chatId: number, text: string, replyTo: number | null, messageId: number | null): Promise<boolean> {
  if (!text) return false;
  const q = admin.from('asst_polls').select('message_id, question, ref').eq('kind', 'dre_category').is('answered_at', null).like('message_id', `tgdre:${chatId}:%`);
  const { data: rows } = replyTo ? await q.eq('message_id', `tgdre:${chatId}:${replyTo}`) : await q.order('created_at', { ascending: false }).limit(2);
  if (!rows?.length || (!replyTo && rows.length > 1)) return false;
  const row = rows[0];
  const opt = dreAnswer(text, row.ref);
  if (!opt && !replyTo) return false;
  if (!opt || opt.invalid) {
    await sendText(chatId, 'Não entendi. Toque num botão da pergunta, escreva o grupo + nome de uma categoria nova (ex.: Despesas Operacionais Consultoria) ou "pular".').catch(() => {});
    if (messageId) await react(chatId, messageId, '🤔');
    return true;
  }
  if (!(await claimDre(admin, row.message_id, text))) return false;
  const reply = await applyDreChoice(admin, row.ref, opt).catch((e) => { log('ERROR', 'resposta DRE', { error: errMsg(e) }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; });
  await sendText(chatId, reply).catch(() => {});
  if (messageId) await react(chatId, messageId, '👍');
  const qid = Number(String(row.message_id).split(':')[2]);
  if (qid) await tg('editMessageReplyMarkup', { chat_id: chatId, message_id: qid, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  await admin.from('asst_messages').insert([
    { channel: 'telegram', chat_id: `tg:${chatId}`, role: 'user', content: text },
    { channel: 'cron', chat_id: `tg:${chatId}`, role: 'assistant', content: reply },
  ]);
  nextDre();
  return true;
}

type Incoming = { chatId: number; chatKey: string; text: string; attachment: { base64: string; media_type: string } | null; messageId: number | null; kind: string };
async function processOwner(admin: SupabaseClient, m: Incoming) {
  let text = m.text;
  let ids = m.messageId ? [m.messageId] : [];
  try {
    if (!m.attachment) {
      const merged = await debounce(admin, m.chatKey, text, m.messageId);
      if (merged === null) return;
      text = merged.text; ids = merged.ids.length ? merged.ids : ids;
    }
    typing(m.chatId);
    const keep = setInterval(() => typing(m.chatId), 4500); // "digitando…" dura ~5 s por chamada
    let out;
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
        body: JSON.stringify({ text, chat_id: m.chatKey, channel: 'telegram', attachment: m.attachment }),
      });
      out = await r.json().catch(() => ({}));
      if (!r.ok || !out?.reply) throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
    } finally { clearInterval(keep); }
    const reply = String(out.reply);
    const toolCalls: Array<{ name: string; ok: boolean }> = Array.isArray(out.tool_calls) ? out.tool_calls : [];
    const silent = reply === 'NO_REPLY';
    if (!silent) await sendText(m.chatId, reply);
    await runActions(admin, m.chatId, m.chatKey, out.actions);
    const emoji = silent ? '🫡' : toolCalls.some((t) => t.ok === false) ? '🤔' : '👍';
    await Promise.all(ids.map((id) => react(m.chatId, id, emoji)));
    log('INFO', silent ? 'sem resposta' : 'respondido', { chat: m.chatKey, kind: m.kind, tools: toolCalls.map((t) => t.name), actions: (out.actions ?? []).map((a: { type: string }) => a.type) });
  } catch (e) {
    log('ERROR', 'falha ao responder', { chat: m.chatKey, kind: m.kind, error: errMsg(e) });
    await sendText(m.chatId, 'Deu erro aqui do meu lado. Tenta de novo em instantes.').catch(() => {});
    await Promise.all(ids.map((id) => react(m.chatId, id, '😱')));
  }
}

// deno-lint-ignore no-explicit-any
async function handle(update: any) {
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: st } = await admin.from('asst_settings').select('key, value').in('key', ['telegram_allowed_ids']);
  const allowed = new Set(((st ?? []).find((s) => s.key === 'telegram_allowed_ids')?.value ?? []).map(String));

  // Clique em botão
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = Number(cq.message?.chat?.id);
    const from = String(cq.from?.id ?? '');
    if (!allowed.has(from)) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Não autorizado.' }).catch(() => {}); return; }
    const [tail, idxStr] = String(cq.data ?? '').split('|');
    const { data: polls } = await admin.from('asst_polls').select('message_id, question, options, answered_at').eq('kind', 'tg_buttons').like('message_id', `%${tail}`).limit(1);
    const poll = polls?.[0];
    const idx = Number(idxStr);
    if (!poll || !Array.isArray(poll.options) || !(idx >= 0 && idx < poll.options.length)) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Essa pergunta expirou.' }).catch(() => {}); return; }
    const chosen = String(poll.options[idx]);
    await tg('answerCallbackQuery', { callback_query_id: cq.id, text: `✔ ${chosen}` }).catch(() => {});
    // Tira os botões e deixa registrado o que foi escolhido
    await tg('editMessageText', { chat_id: chatId, message_id: cq.message.message_id, text: toHtml(`❓ *${poll.question}*\n✅ ${chosen}`), parse_mode: 'HTML' }).catch(() => {});
    if (poll.answered_at) return; // clique repetido
    await admin.from('asst_polls').update({ answered_at: new Date().toISOString(), answer: [chosen] }).eq('message_id', poll.message_id);
    await processOwner(admin, { chatId, chatKey: `tg:${chatId}`, text: `[Botão "${poll.question}"] Resposta: ${chosen}`, attachment: null, messageId: null, kind: 'button' });
    return;
  }

  const msg = update.message ?? update.edited_message;
  if (!msg || msg.from?.is_bot) return;
  const chatId = Number(msg.chat?.id);
  const from = String(msg.from?.id ?? '');
  if (msg.chat?.type !== 'private') return; // grupos do Telegram: fora (por enquanto)
  if (!allowed.has(from)) {
    log('WARN', 'remetente Telegram não autorizado', { from, username: msg.from?.username, name: msg.from?.first_name });
    await sendText(chatId, `Não te conheço ainda. Seu id no Telegram é ${from}. Peça ao dono para cadastrar.`).catch(() => {});
    return;
  }
  const chatKey = `tg:${chatId}`;
  const messageId = Number(msg.message_id) || null;
  if (messageId) react(chatId, messageId, '👀');
  typing(chatId);

  let text = String(msg.text ?? msg.caption ?? '').trim();
  let attachment: { base64: string; media_type: string } | null = null;
  let kind = 'text';
  try {
    if (text === '/start') { await sendText(chatId, 'Opa! Pode falar comigo por aqui: texto, áudio, foto ou PDF. Botões aparecem quando tiver decisão a tomar.'); return; }
    if (msg.voice || msg.audio) {
      kind = 'audio';
      const f = msg.voice ?? msg.audio;
      const { base64 } = await fileBase64(f.file_id);
      const t = await transcribe(base64, String(f.mime_type ?? 'audio/ogg'));
      if (!t) { await sendText(chatId, 'Não consegui entender o áudio. Pode repetir ou mandar em texto?'); return; }
      text = `[Áudio] ${t}${text ? `\n${text}` : ''}`;
    } else if (msg.photo?.length) {
      kind = 'image';
      const best = msg.photo[msg.photo.length - 1];
      const { base64 } = await fileBase64(best.file_id);
      attachment = { base64, media_type: 'image/jpeg' };
    } else if (msg.document) {
      const mime = String(msg.document.mime_type ?? '');
      if (mime === 'application/pdf' || IMAGE_TYPES.includes(mime)) {
        kind = 'document';
        const { base64 } = await fileBase64(msg.document.file_id);
        attachment = { base64, media_type: mime };
      } else if (!text) {
        await sendText(chatId, 'Esse tipo de arquivo eu não leio por aqui. Manda como foto ou PDF (exportação de grupo .txt é pelo WhatsApp).');
        if (messageId) await react(chatId, messageId, '🤔');
        return;
      }
    } else if (msg.location) {
      text = `[Localização enviada: ${msg.location.latitude}, ${msg.location.longitude}]${text ? ` ${text}` : ''}`;
    } else if (msg.contact) {
      text = `[Contato enviado: ${msg.contact.first_name ?? ''} ${msg.contact.last_name ?? ''} ${msg.contact.phone_number}]${text ? ` ${text}` : ''}`.trim();
    } else if (msg.video || msg.sticker || msg.video_note) {
      if (!text) { await sendText(chatId, 'Vídeo/figurinha eu não vejo. Me conta em texto ou áudio?'); return; }
    }
    if (msg.forward_origin || msg.forward_from || msg.forward_sender_name) text = `[Encaminhada] ${text}`.trim();
    if (!text && !attachment) return;
  } catch (e) {
    log('ERROR', 'falha ao preparar', { chat: chatKey, kind, error: errMsg(e) });
    await sendText(chatId, 'Deu erro ao baixar isso. Tenta de novo?').catch(() => {});
    return;
  }
  await processOwner(admin, { chatId, chatKey, text, attachment, messageId, kind });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (internalKey.length < 20 || req.headers.get('x-telegram-bot-api-secret-token') !== internalKey) return json({ error: 'Unauthorized' }, 401);
  if (!botToken) return json({ error: 'TELEGRAM_BOT_TOKEN não configurado' }, 503);
  let update: unknown;
  try { update = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  const p = handle(update).catch((e) => log('ERROR', 'unhandled', { error: errMsg(e) }));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  return json({ ok: true }); // Telegram reenvia se não receber 200 rápido
});

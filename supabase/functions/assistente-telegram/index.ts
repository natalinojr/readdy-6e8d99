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
// Pagamentos pelo Inter (2026-09-12): resumo com botões Pagar/Cancelar; o PIN digitado depois do
// botão é interceptado aqui (nunca vai ao brain nem ao histórico) e a mensagem é apagada. /pin cria/troca.
//
// Entrada interna (header x-internal-key): { action: 'deliver', chat_key, text, actions } —
// usada pela triagem de pedido de pagamento dos grupos do WhatsApp (assistente-webhook)
// para avisar o dono já com o cartão de pagamento e os botões.
// { action: 'pay_watch' } — chamado pelo assistente-cron: atualiza sozinho o cartão dos
// pagamentos em andamento e, quando pago, posta o comprovante no grupo que pediu.
//
// Secrets: TELEGRAM_BOT_TOKEN, ASSISTENTE_INTERNAL_KEY, WHISPER_URL, WHISPER_API_KEY, FISCAL_INTERNAL_KEY (inter-bank).

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
      } else if (a.type === 'payment') {
        const { data: p } = await admin.from('fin_inter_payments').select('*').eq('id', String(a.id)).maybeSingle();
        if (!p) throw new Error('pedido de pagamento não encontrado');
        const m = await tg('sendMessage', {
          chat_id: chatId, text: toHtml(payText(p, 'Tocar em *Pagar* pede seu PIN. Depois o Inter ainda pede a sua aprovação no app.')), parse_mode: 'HTML',
          reply_markup: { inline_keyboard: payKb(p.id) },
        });
        await admin.from('fin_inter_payments').update({ tg_message_id: m.message_id, chat_id: chatKey }).eq('id', p.id);
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
// ── Navegação da pergunta DRE: a MESMA mensagem é editada a cada toque ──
// Pedido do dono (2026-09-12): 1º escolhe o GRUPO, depois a CATEGORIA dentro dele; criar
// categoria nova é um botão que lista os grupos e depois pede o nome.
// Callbacks: d|g|<i> categorias do grupo i · d|c|<n> escolhe a opção n · d|n nova categoria
// (lista os grupos) · d|ng|<i> nova categoria no grupo i (espera o nome digitado;
// ref.awaiting_new = i) · d|b volta aos grupos · d|s pular. Legado (perguntas antigas): d|<n>.
type Btn = { text: string; callback_data: string };
// deno-lint-ignore no-explicit-any
const dreGroups = (ref: any): Array<{ key: string; label: string }> => (Array.isArray(ref?.groups) ? ref.groups : []);
// deno-lint-ignore no-explicit-any
const dreOptions = (ref: any): any[] => (Array.isArray(ref?.options) ? ref.options : []);
// deno-lint-ignore no-explicit-any
function dreView(poll: any, mode: 'groups' | 'cats' | 'new' | 'await', gi = -1): { text: string; rows: Btn[][] } {
  const ref = poll.ref ?? {};
  const groups = dreGroups(ref);
  const g = groups[gi];
  const rows: Btn[][] = [];
  let prompt = '';
  if (mode === 'cats' && g) {
    const cats = dreOptions(ref).filter((o) => o.group === g.key);
    prompt = cats.length ? `Grupo *${g.label}* — escolha a categoria:` : `O grupo *${g.label}* ainda não tem categorias.`;
    for (const o of cats) rows.push([{ text: String(o.label).slice(0, 60), callback_data: `d|c|${o.n}` }]);
    rows.push([{ text: `➕ Nova categoria em ${g.label}`.slice(0, 60), callback_data: `d|ng|${gi}` }]);
    rows.push([{ text: '⬅️ Grupos', callback_data: 'd|b' }]);
  } else if (mode === 'new') {
    prompt = 'Nova categoria: em qual *grupo*?';
    groups.forEach((x, i) => rows.push([{ text: x.label.slice(0, 60), callback_data: `d|ng|${i}` }]));
    rows.push([{ text: '⬅️ Voltar', callback_data: 'd|b' }]);
  } else if (mode === 'await' && g) {
    prompt = `Escreva o *nome* da nova categoria em *${g.label}*.`;
    rows.push([{ text: '⬅️ Voltar', callback_data: 'd|b' }]);
  } else {
    prompt = 'Escolha o *grupo*:';
    groups.forEach((x, i) => {
      const n = dreOptions(ref).filter((o) => o.group === x.key).length;
      rows.push([{ text: `${x.label}${n ? ` (${n})` : ''}`.slice(0, 60), callback_data: `d|g|${i}` }]);
    });
    rows.push([{ text: '➕ Nova categoria', callback_data: 'd|n' }]);
    rows.push([{ text: '⏭️ Pular (classifico no sistema)', callback_data: 'd|s' }]);
  }
  const foot = mode === 'groups' && ref.footer ? `\n\n${ref.footer}` : '';
  return { text: `${ref.header ?? '🏷️ *Classificar no DRE*'}\n${poll.question ?? ''}\n\n${prompt}${foot}`, rows };
}
async function showDre(chatId: number, mid: number, view: { text: string; rows: Btn[][] }) {
  await tg('editMessageText', { chat_id: chatId, message_id: mid, text: toHtml(view.text), parse_mode: 'HTML', reply_markup: { inline_keyboard: view.rows } })
    .catch((e) => { if (!/not modified/i.test(errMsg(e))) log('WARN', 'editar pergunta DRE', { error: errMsg(e) }); });
}
// deno-lint-ignore no-explicit-any
async function setAwaiting(admin: SupabaseClient, poll: any, gi: number | null) {
  const ref = { ...(poll.ref ?? {}) };
  if (gi == null) delete ref.awaiting_new; else ref.awaiting_new = gi;
  poll.ref = ref;
  await admin.from('asst_polls').update({ ref }).eq('message_id', poll.message_id);
}
// Grava a escolha (uma vez só), mostra o resultado na própria pergunta e pede a próxima.
// deno-lint-ignore no-explicit-any
async function finishDre(admin: SupabaseClient, chatId: number, mid: number, poll: any, opt: any, userText: string): Promise<string | null> {
  if (!(await claimDre(admin, poll.message_id, String(opt.label ?? userText)))) return null;
  const reply = await applyDreChoice(admin, poll.ref, opt).catch((e) => { log('ERROR', 'resposta DRE', { error: errMsg(e) }); return 'Deu erro ao gravar a classificação; tenta no sistema.'; });
  const head = `${poll.ref?.header ?? '🏷️ *Classificar no DRE*'}\n${poll.question ?? ''}`;
  await tg('editMessageText', { chat_id: chatId, message_id: mid, text: toHtml(`${head}\n\n${reply}`), parse_mode: 'HTML' })
    .catch(async () => { await sendText(chatId, reply).catch(() => {}); });
  await admin.from('asst_messages').insert([
    { channel: 'telegram', chat_id: `tg:${chatId}`, role: 'user', content: userText },
    { channel: 'cron', chat_id: `tg:${chatId}`, role: 'assistant', content: reply },
  ]);
  nextDre();
  return reply;
}
// deno-lint-ignore no-explicit-any
async function handleDreClick(admin: SupabaseClient, cq: any) {
  const chatId = Number(cq.message?.chat?.id);
  const mid = Number(cq.message?.message_id);
  const key = `tgdre:${chatId}:${mid}`;
  const ack = (text?: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, ...(text ? { text: text.slice(0, 190) } : {}) }).catch(() => {});
  const { data: poll } = await admin.from('asst_polls').select('message_id, question, ref, answered_at').eq('message_id', key).maybeSingle();
  if (!poll) { await ack('Essa pergunta expirou.'); return; }
  if (poll.answered_at) { await ack('Essa já foi respondida.'); return; }
  const [, op, argStr] = String(cq.data).split('|');
  const arg = Number(argStr);
  const groups = dreGroups(poll.ref);
  if (/^\d+$/.test(op ?? '')) { // legado: d|<n> (0 = pular)
    const n = Number(op);
    const opt = n === 0 ? { skip: true, label: 'Pular' } : dreOptions(poll.ref).find((o) => Number(o.n) === n);
    if (!opt) { await ack('Opção inválida.'); return; }
    await ack(`✔ ${opt.label}`);
    await finishDre(admin, chatId, mid, poll, opt, `[Botão DRE] ${opt.label}`);
    return;
  }
  switch (op) {
    case 'g':
      if (!groups[arg]) break;
      await ack();
      if (poll.ref?.awaiting_new != null) await setAwaiting(admin, poll, null);
      await showDre(chatId, mid, dreView(poll, 'cats', arg));
      return;
    case 'b':
      await ack();
      if (poll.ref?.awaiting_new != null) await setAwaiting(admin, poll, null);
      await showDre(chatId, mid, dreView(poll, 'groups'));
      return;
    case 'n':
      await ack();
      await showDre(chatId, mid, dreView(poll, 'new'));
      return;
    case 'ng':
      if (!groups[arg]) break;
      await setAwaiting(admin, poll, arg);
      await ack('Agora escreva o nome da categoria');
      await showDre(chatId, mid, dreView(poll, 'await', arg));
      return;
    case 'c': {
      const opt = dreOptions(poll.ref).find((o) => Number(o.n) === arg);
      if (!opt) break;
      await ack(`✔ ${opt.label}`);
      await finishDre(admin, chatId, mid, poll, opt, `[Botão DRE] ${opt.label}`);
      return;
    }
    case 's':
      await ack('Ok, fica para o sistema');
      await finishDre(admin, chatId, mid, poll, { skip: true, label: 'Pular' }, '[Botão DRE] Pular');
      return;
  }
  await ack('Opção inválida.');
}
// Resposta DIGITADA a uma pergunta DRE aberta. Prioridade: a citada (reply) → a que está
// esperando o nome de categoria nova → a única em aberto (e aí só se parece resposta).
async function tryDreAnswerTg(admin: SupabaseClient, chatId: number, text: string, replyTo: number | null, messageId: number | null): Promise<boolean> {
  if (!text) return false;
  const { data: rows } = await admin.from('asst_polls').select('message_id, question, ref').eq('kind', 'dre_category').is('answered_at', null)
    .like('message_id', `tgdre:${chatId}:%`).order('created_at', { ascending: false }).limit(5);
  if (!rows?.length) return false;
  const row = replyTo
    ? rows.find((r) => r.message_id === `tgdre:${chatId}:${replyTo}`)
    : (rows.find((r) => r.ref?.awaiting_new != null) ?? (rows.length === 1 ? rows[0] : undefined));
  if (!row) return false;
  const mid = Number(String(row.message_id).split(':')[2]);
  const groups = dreGroups(row.ref);
  const aw = row.ref?.awaiting_new;
  // deno-lint-ignore no-explicit-any
  let opt: any;
  if (aw != null && groups[Number(aw)]) {
    if (/^(cancelar|cancela|voltar|deixa)$/.test(semAcento(text))) {
      await setAwaiting(admin, row, null);
      await showDre(chatId, mid, dreView(row, 'groups'));
      if (messageId) await react(chatId, messageId, '👍');
      return true;
    }
    const nome = text.trim().replace(/^["'“”]+|["'“”.]+$/g, '').replace(/\s+/g, ' ');
    if (!nome || nome.length > 60) {
      await sendText(chatId, 'Manda só o nome da categoria (até 60 letras), ou toque em Voltar.').catch(() => {});
      if (messageId) await react(chatId, messageId, '🤔');
      return true;
    }
    const g = groups[Number(aw)];
    const nomeFmt = nome.charAt(0).toUpperCase() + nome.slice(1);
    opt = { group: g.key, name: nomeFmt, label: `${g.label} › ${nomeFmt}` };
  } else {
    opt = dreAnswer(text, row.ref);
    if (!opt && !replyTo) return false;
    if (!opt || opt.invalid) {
      await sendText(chatId, 'Não entendi. Use os botões da pergunta (grupo → categoria, ou ➕ Nova categoria) ou escreva "pular".').catch(() => {});
      if (messageId) await react(chatId, messageId, '🤔');
      return true;
    }
  }
  const reply = await finishDre(admin, chatId, mid, row, opt, text);
  if (reply === null) return false;
  if (messageId) await react(chatId, messageId, '👍');
  return true;
}

// ── Pagamentos pelo Banco Inter (2026-09-12) ──
// Botões: p|ok|<id> pagar · p|no|<id> cancelar · p|st|<id> ver status. "Pagar" põe o pedido em
// awaiting_pin; o PRÓXIMO texto só com números (4–8) em até 5 min é o PIN: apagado do chat, conferido
// contra asst_settings.pay_pin (sha256), e aí inter-bank › execute_payment envia ao Inter.
// 3 PINs errados seguidos = bloqueio de 15 min. /pin cria ou troca o PIN (pede o atual antes).
const fiscalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
const PIN_WINDOW_MS = 5 * 60_000;
const PAY_TTL_MS = 30 * 60_000;
const nowIso = () => new Date().toISOString();
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (d: unknown) => (d ? String(d).slice(0, 10).split('-').reverse().join('/') : '');
const PAY_STATUS: Record<string, string> = {
  draft: 'aguardando você tocar em Pagar', awaiting_pin: 'esperando o PIN', sending: 'enviando ao Inter', sent: 'enviado ao Inter',
  pending_approval: '⏳ aguardando sua aprovação no app do Inter', approved: 'aprovado, processando', scheduled: '📅 agendado no Inter',
  paid: '✅ pago', cancelled: '✖️ cancelado', rejected: '❌ recusado pelo Inter', failed: '❌ não foi enviado', expired: 'expirado',
};
const PAY_DONE = ['paid', 'cancelled', 'rejected', 'failed', 'expired'];
async function sha256hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const pinHash = (pin: string, chatId: number) => sha256hex(`erpos-pay:${chatId}:${pin}`);
// deno-lint-ignore no-explicit-any
async function getSetting(admin: SupabaseClient, key: string): Promise<any> {
  const { data } = await admin.from('asst_settings').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}
async function setSetting(admin: SupabaseClient, key: string, value: unknown) {
  await admin.from('asst_settings').upsert({ key, value, updated_at: nowIso() });
}
// deno-lint-ignore no-explicit-any
async function callInter(action: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`${supabaseUrl}/functions/v1/inter-bank`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': fiscalKey }, body: JSON.stringify({ action, ...body }),
  });
  // deno-lint-ignore no-explicit-any
  const out: any = await r.json().catch(() => ({}));
  if (!r.ok || out?.success === false) throw new Error(String(out?.error ?? `inter-bank HTTP ${r.status}`));
  return out;
}
// deno-lint-ignore no-explicit-any
function payText(p: any, extra = ''): string {
  const lines = [p.kind === 'pix' ? '💸 *Pix pela conta do Inter*' : '💸 *Boleto pela conta do Inter*'];
  if (p.beneficiary_name) lines.push(`Para: ${p.beneficiary_name}`);
  if (p.kind === 'pix') lines.push(`Chave: ${p.pix_key}`);
  if (p.kind === 'boleto') {
    if (p.bank_code) lines.push(`Banco do boleto: ${p.bank_code}`);
    if (p.due_date) lines.push(`Vencimento: ${fmtDate(p.due_date)}`);
    if (p.face_value != null && Math.abs(Number(p.face_value) - Number(p.amount)) > 0.005) lines.push(`Valor do boleto: ${brl(p.face_value)}`);
  }
  lines.push(`*Valor a pagar: ${brl(p.amount)}*`);
  if (p.description) lines.push(`Descrição: ${p.description}`);
  return lines.join('\n') + (extra ? `\n\n${extra}` : '');
}
const payKb = (id: string): Btn[][] => [[{ text: '✅ Pagar', callback_data: `p|ok|${id}` }, { text: '✖️ Cancelar', callback_data: `p|no|${id}` }]];
const statusKb = (id: string): Btn[][] => [[{ text: '🔄 Ver status', callback_data: `p|st|${id}` }, { text: '✖️ Cancelar', callback_data: `p|no|${id}` }]];
// deno-lint-ignore no-explicit-any
async function editPay(chatId: number, mid: number | null, p: any, extra: string, kb?: Btn[][]) {
  const text = toHtml(payText(p, extra));
  if (!mid) { await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) }).catch(() => {}); return; }
  await tg('editMessageText', { chat_id: chatId, message_id: mid, text, parse_mode: 'HTML', ...(kb ? { reply_markup: { inline_keyboard: kb } } : {}) })
    .catch((e) => { if (!/not modified/i.test(errMsg(e))) log('WARN', 'editar pagamento', { error: errMsg(e) }); });
}
// deno-lint-ignore no-explicit-any
const statusLine = (p: any) => `Status: ${PAY_STATUS[p.status] ?? p.status}${p.error ? `\n${p.error}` : ''}${p.status === 'pending_approval' ? '\nAbra o app do Inter › Aprovações para liberar.' : ''}`;
// ── Acompanhamento automático + comprovante no grupo (2026-09-12) ──
// Depois do PIN o pagamento fica esperando a aprovação no app do Inter; antes, o cartão só
// mudava tocando em "Ver status". Agora o assistente-cron chama { action: 'pay_watch' } a cada
// minuto enquanto houver pagamento em andamento, e o cartão é editado quando o status muda.
// Pago + ligado a um pedido de grupo (asst_group_requests.payment_id) → comprovante no grupo,
// respondendo a mensagem do pedido, uma vez só (receipt_sent_at é o trinco).
const PAY_WATCH = ['sent', 'pending_approval', 'approved', 'scheduled'];
const fmtDoc = (d: string) => { const x = d.replace(/\D/g, ''); return x.length === 14 ? x.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : d; };
// deno-lint-ignore no-explicit-any
function receiptText(p: any, loja: string | null): string {
  const tp = p.response?.transacaoPix ?? {};
  const quando = new Date(tp.dataHoraMovimento ?? p.paid_at ?? Date.now()).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const nome = tp.recebedor?.nome ?? p.beneficiary_name;
  const doc = tp.recebedor?.cpfCnpj ?? p.beneficiary_doc;
  const lines = ['✅ *Pagamento realizado*', `${p.kind === 'pix' ? 'Pix' : 'Boleto'} de *${brl(p.amount)}*`];
  if (nome) lines.push(`Para: ${nome}${doc ? ` (${fmtDoc(String(doc))})` : ''}`);
  if (p.description) lines.push(`Referente: ${p.description}`);
  lines.push(`Pago em: ${quando}`);
  if (p.kind === 'pix' && tp.endToEnd) lines.push(`ID da transação (E2E): ${tp.endToEnd}`);
  if (p.kind === 'boleto' && p.digitavel) lines.push(`Linha digitável: ${p.digitavel}`);
  if (p.inter_code) lines.push(`Código no Inter: ${p.inter_code}`);
  lines.push(`Pago pela conta do Banco Inter${loja ? ` — ${loja}` : ''}.`);
  return lines.join('\n');
}
// deno-lint-ignore no-explicit-any
async function sendGroupReceipt(admin: SupabaseClient, p: any): Promise<string | null> {
  if (p.status !== 'paid') return null;
  const { data: claimed } = await admin.from('asst_group_requests').update({ receipt_sent_at: nowIso(), status: 'pago', receipt_error: null, updated_at: nowIso() })
    .eq('payment_id', p.id).is('receipt_sent_at', null).select('id, group_jid, group_name, message_id');
  const rq = claimed?.[0];
  if (!rq) return null;
  const { data: t } = await admin.from('tenants').select('name').eq('id', p.tenant_id).maybeSingle();
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-webhook`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ action: 'group_send', group_jid: rq.group_jid, text: receiptText(p, t?.name ?? null), quoted_message_id: rq.message_id }),
    });
    if (!r.ok) throw new Error(`webhook ${r.status}: ${(await r.text()).slice(0, 200)}`);
    log('INFO', 'comprovante enviado no grupo', { group: rq.group_name, payment: p.id });
    return `📨 Comprovante enviado no grupo *${rq.group_name ?? 'do pedido'}*.`;
  } catch (e) {
    // Solta o trinco: tocar em "Ver status" tenta de novo.
    await admin.from('asst_group_requests').update({ receipt_sent_at: null, receipt_error: errMsg(e).slice(0, 300), updated_at: nowIso() }).eq('id', rq.id);
    log('ERROR', 'comprovante no grupo falhou', { group: rq.group_name, payment: p.id, error: errMsg(e) });
    return `⚠️ Não consegui mandar o comprovante no grupo *${rq.group_name ?? ''}* (${errMsg(e).slice(0, 100)}).`;
  }
}
// Cartão atualizado + comprovante quando pago. Usado no "Ver status", depois do PIN e no pay_watch.
// deno-lint-ignore no-explicit-any
async function afterPayStatus(admin: SupabaseClient, chatId: number, mid: number | null, p: any) {
  const extra = await sendGroupReceipt(admin, p);
  await editPay(chatId, mid, p, statusLine(p) + (extra ? `\n${extra}` : ''), PAY_DONE.includes(p.status) ? undefined : statusKb(p.id));
}
async function payWatch() {
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: rows } = await admin.from('fin_inter_payments').select('*').in('status', PAY_WATCH).like('chat_id', 'tg:%')
    .gte('sent_at', new Date(Date.now() - 7 * 86400_000).toISOString()).order('sent_at', { ascending: false }).limit(20);
  let checked = 0, changed = 0;
  for (const p of rows ?? []) {
    // Recém-enviado (2 h): a cada ~minuto. Depois (ex.: boleto agendado): a cada 30 min, por até 7 dias.
    const recent = Date.now() - new Date(p.sent_at).getTime() < 2 * 3600_000;
    if (Date.now() - new Date(p.updated_at).getTime() < (recent ? 45_000 : 30 * 60_000)) continue;
    checked++;
    const antes = p.status;
    try {
      const out = await callInter('payment_status', { tenant_id: p.tenant_id, payment_id: p.id });
      Object.assign(p, out.payment);
    } catch (e) { log('WARN', 'acompanhar pagamento', { id: p.id, error: errMsg(e) }); }
    if (p.status === antes) { await admin.from('fin_inter_payments').update({ updated_at: nowIso() }).eq('id', p.id).eq('status', antes); continue; }
    changed++;
    await afterPayStatus(admin, Number(String(p.chat_id).slice(3)), Number(p.tg_message_id) || null, p);
    await admin.from('asst_messages').insert({ channel: 'telegram', chat_id: p.chat_id, role: 'assistant', content: `[Pagamento ${p.kind} de ${brl(p.amount)}${p.beneficiary_name ? ` para ${p.beneficiary_name}` : ''}: ${PAY_STATUS[p.status] ?? p.status} (atualizado automaticamente)] id ${p.id}` });
    log('INFO', 'pagamento mudou de status', { id: p.id, de: antes, para: p.status });
  }
  return { checked, changed };
}
async function checkPin(admin: SupabaseClient, chatId: number, pin: string): Promise<boolean> {
  const s = (await getSetting(admin, 'pay_pin')) ?? {};
  if (s.locked_until && new Date(s.locked_until).getTime() > Date.now()) {
    await sendText(chatId, `🔒 PIN bloqueado até ${new Date(s.locked_until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} por tentativas erradas.`).catch(() => {});
    return false;
  }
  if (!s.hash) { await sendText(chatId, 'Você ainda não tem PIN de pagamento. Mande /pin para criar.').catch(() => {}); return false; }
  if ((await pinHash(pin, chatId)) === s.hash) {
    if (s.fails) await setSetting(admin, 'pay_pin', { ...s, fails: 0, locked_until: null });
    return true;
  }
  const fails = Number(s.fails ?? 0) + 1;
  const locked = fails >= 3 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
  await setSetting(admin, 'pay_pin', { ...s, fails: locked ? 0 : fails, locked_until: locked });
  log('WARN', 'PIN de pagamento errado', { chat: chatId, fails, locked: !!locked });
  await sendText(chatId, locked ? '🔒 PIN errado 3 vezes. Bloqueado por 15 minutos.' : `PIN errado (${fails}/3). Digite de novo.`).catch(() => {});
  return false;
}
// deno-lint-ignore no-explicit-any
async function handlePayClick(admin: SupabaseClient, cq: any) {
  const chatId = Number(cq.message?.chat?.id);
  const mid = Number(cq.message?.message_id) || null;
  const [, op, id] = String(cq.data ?? '').split('|');
  const ack = (t?: string) => tg('answerCallbackQuery', { callback_query_id: cq.id, ...(t ? { text: t.slice(0, 190) } : {}) }).catch(() => {});
  const { data: p } = await admin.from('fin_inter_payments').select('*').eq('id', id).maybeSingle();
  if (!p) { await ack('Pedido não encontrado.'); return; }
  if (op === 'no') {
    try {
      const out = await callInter('cancel_payment', { tenant_id: p.tenant_id, payment_id: p.id });
      Object.assign(p, out.payment);
      await ack('Cancelado');
      await editPay(chatId, mid, p, p.inter_code ? '✖️ Cancelado no Inter.' : '✖️ Cancelado. Nada foi enviado ao Inter.');
    } catch (e) {
      await ack('Não deu para cancelar');
      await sendText(chatId, `Não consegui cancelar: ${errMsg(e)}`).catch(() => {});
    }
    return;
  }
  if (op === 'st') {
    try { const out = await callInter('payment_status', { tenant_id: p.tenant_id, payment_id: p.id }); Object.assign(p, out.payment); }
    catch (e) { await ack(errMsg(e).slice(0, 150)); return; }
    await ack(PAY_STATUS[p.status] ?? p.status);
    await afterPayStatus(admin, chatId, mid, p);
    return;
  }
  if (op === 'ok') {
    if (p.status !== 'draft') { await ack(`Esse já está: ${PAY_STATUS[p.status] ?? p.status}`); return; }
    if (Date.now() - new Date(p.created_at).getTime() > PAY_TTL_MS) {
      await admin.from('fin_inter_payments').update({ status: 'expired', updated_at: nowIso() }).eq('id', p.id).eq('status', 'draft');
      p.status = 'expired';
      await ack('Expirou');
      await editPay(chatId, mid, p, 'Pedido expirado (30 minutos). Me peça de novo.');
      return;
    }
    const pin = await getSetting(admin, 'pay_pin');
    if (!pin?.hash) {
      await ack('Crie seu PIN primeiro');
      await editPay(chatId, mid, p, '🔐 Você ainda não tem PIN de pagamento. Mande /pin, crie o PIN e depois toque em Pagar de novo.', payKb(p.id));
      return;
    }
    if (pin.locked_until && new Date(pin.locked_until).getTime() > Date.now()) { await ack('PIN bloqueado por alguns minutos'); return; }
    const { data: moved } = await admin.from('fin_inter_payments').update({ status: 'awaiting_pin', pin_requested_at: nowIso(), updated_at: nowIso() }).eq('id', p.id).eq('status', 'draft').select('id');
    if (!moved?.length) { await ack('Esse já foi tocado'); return; }
    p.status = 'awaiting_pin';
    await ack('Digite o PIN');
    await editPay(chatId, mid, p, '🔐 *Digite seu PIN agora* (a mensagem some depois de lida). Vale por 5 minutos.', [[{ text: '✖️ Cancelar', callback_data: `p|no|${p.id}` }]]);
    return;
  }
  await ack('Opção inválida.');
}
// Texto que pertence ao fluxo de pagamento: /pin, criação/troca do PIN, ou o PIN de um pedido.
// Devolve true se tratou (e aí NADA vai para o brain/histórico).
async function tryPayText(admin: SupabaseClient, chatId: number, text: string, messageId: number | null): Promise<boolean> {
  const chatKey = `tg:${chatId}`;
  const t = text.trim();
  const isPin = /^\d{4,8}$/.test(t);
  const del = () => (messageId ? tg('deleteMessage', { chat_id: chatId, message_id: messageId }).catch(() => {}) : Promise.resolve());
  if (/^\/pin(@\w+)?$/i.test(t)) {
    const pin = await getSetting(admin, 'pay_pin');
    await setSetting(admin, 'pay_pin_setup', { chat: chatKey, step: pin?.hash ? 'current' : 'new', at: nowIso() });
    await sendText(chatId, pin?.hash ? '🔐 Para trocar o PIN de pagamento, digite primeiro o PIN atual.' : '🔐 Crie seu PIN de pagamento: digite de 4 a 8 números. A mensagem some depois de lida.');
    return true;
  }
  const setup = await getSetting(admin, 'pay_pin_setup');
  const setupActive = setup?.chat === chatKey && Date.now() - new Date(setup.at).getTime() < PIN_WINDOW_MS;
  if (setupActive && /^(cancelar|cancela)$/i.test(t)) {
    await admin.from('asst_settings').delete().eq('key', 'pay_pin_setup');
    await sendText(chatId, 'Ok, PIN não alterado.');
    return true;
  }
  if (setupActive && isPin) {
    await del();
    if (setup.step === 'current') {
      if (!(await checkPin(admin, chatId, t))) return true;
      await setSetting(admin, 'pay_pin_setup', { chat: chatKey, step: 'new', at: nowIso() });
      await sendText(chatId, 'Agora digite o PIN novo (4 a 8 números).');
      return true;
    }
    if (setup.step === 'new') {
      if (/^(\d)\1+$/.test(t) || '01234567890'.includes(t) || '09876543210'.includes(t)) { await sendText(chatId, 'Esse PIN é fácil demais (repetido ou sequência). Escolha outro.'); return true; }
      await setSetting(admin, 'pay_pin_setup', { chat: chatKey, step: 'confirm', first: await pinHash(t, chatId), at: nowIso() });
      await sendText(chatId, 'Digite o PIN novo mais uma vez para confirmar.');
      return true;
    }
    if (setup.step === 'confirm') {
      const h = await pinHash(t, chatId);
      if (h !== setup.first) {
        await setSetting(admin, 'pay_pin_setup', { chat: chatKey, step: 'new', at: nowIso() });
        await sendText(chatId, 'Não bateu com o primeiro. Digite o PIN novo de novo.');
        return true;
      }
      await setSetting(admin, 'pay_pin', { hash: h, fails: 0, locked_until: null, set_at: nowIso() });
      await admin.from('asst_settings').delete().eq('key', 'pay_pin_setup');
      await admin.from('asst_messages').insert({ channel: 'telegram', chat_id: chatKey, role: 'assistant', content: '[PIN de pagamento criado/alterado pelo /pin]' });
      await sendText(chatId, '✅ PIN de pagamento salvo. Ele só é pedido depois que você toca em Pagar.');
      return true;
    }
  }
  if (!isPin) return false;
  const { data: rows } = await admin.from('fin_inter_payments').select('*').eq('chat_id', chatKey).eq('status', 'awaiting_pin')
    .gte('pin_requested_at', new Date(Date.now() - PIN_WINDOW_MS).toISOString()).order('pin_requested_at', { ascending: false }).limit(1);
  const p = rows?.[0];
  if (!p) return false;
  await del();
  if (!(await checkPin(admin, chatId, t))) return true;
  const mid = Number(p.tg_message_id) || null;
  await editPay(chatId, mid, p, '⏳ PIN ok. Enviando ao Inter...');
  try {
    const out = await callInter('execute_payment', { tenant_id: p.tenant_id, payment_id: p.id });
    Object.assign(p, out.payment);
  } catch (e) {
    const { data: cur } = await admin.from('fin_inter_payments').select('*').eq('id', p.id).maybeSingle();
    Object.assign(p, cur ?? { status: 'failed' });
    if (!p.error) p.error = errMsg(e);
  }
  await afterPayStatus(admin, chatId, mid, p);
  await admin.from('asst_messages').insert({ channel: 'telegram', chat_id: chatKey, role: 'assistant', content: `[Pagamento ${p.kind} de ${brl(p.amount)}${p.beneficiary_name ? ` para ${p.beneficiary_name}` : ''}: ${PAY_STATUS[p.status] ?? p.status}${p.error ? ` (${p.error})` : ''}] id ${p.id}` });
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
  // O Telegram reenvia o mesmo update se não recebeu 200 a tempo (ex.: 502 de cold start): processa uma vez só.
  if (update?.update_id != null) {
    const { data: fresh } = await admin.from('asst_tg_updates').upsert({ update_id: update.update_id }, { onConflict: 'update_id', ignoreDuplicates: true }).select('update_id');
    if (!fresh?.length) { log('INFO', 'update repetido ignorado', { update_id: update.update_id }); return; }
  }
  const { data: st } = await admin.from('asst_settings').select('key, value').in('key', ['telegram_allowed_ids']);
  const allowed = new Set(((st ?? []).find((s) => s.key === 'telegram_allowed_ids')?.value ?? []).map(String));

  // Clique em botão
  if (update.callback_query) {
    const cq = update.callback_query;
    const chatId = Number(cq.message?.chat?.id);
    const from = String(cq.from?.id ?? '');
    if (!allowed.has(from)) { await tg('answerCallbackQuery', { callback_query_id: cq.id, text: 'Não autorizado.' }).catch(() => {}); return; }
    if (String(cq.data ?? '').startsWith('d|')) { await handleDreClick(admin, cq); return; } // classificação DRE
    if (String(cq.data ?? '').startsWith('p|')) { await handlePayClick(admin, cq); return; } // pagamento pelo Inter
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
  // PIN / criação de PIN de pagamento → tratado aqui, NUNCA vai ao modelo nem ao histórico.
  if (!attachment && kind === 'text' && !msg.edit_date && await tryPayText(admin, chatId, text, messageId)) return;
  // Resposta digitada a uma pergunta de classificação DRE → grava direto, sem o modelo.
  if (!attachment && kind === 'text' && await tryDreAnswerTg(admin, chatId, text, Number(msg.reply_to_message?.message_id) || null, messageId)) return;
  await processOwner(admin, { chatId, chatKey, text, attachment, messageId, kind });
}

// Entrega interna (outra Edge Function): manda um aviso ao dono no Telegram com as
// mesmas ações do brain — inclusive o cartão de pagamento com botões Pagar/Cancelar.
// Usada pela triagem de pedido de pagamento nos grupos do WhatsApp (assistente-webhook).
// deno-lint-ignore no-explicit-any
async function deliver(body: any) {
  const chatKey = String(body.chat_key ?? '');
  if (!/^tg:-?\d+$/.test(chatKey)) throw new Error('chat_key inválido (esperado "tg:<id>")');
  const chatId = Number(chatKey.slice(3));
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const text = String(body.text ?? '').trim();
  if (text && text !== 'NO_REPLY') await sendText(chatId, text);
  await runActions(admin, chatId, chatKey, body.actions);
  log('INFO', 'aviso entregue', { chat: chatKey, actions: (Array.isArray(body.actions) ? body.actions : []).map((a: { type: string }) => a.type) });
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  const secretOk = internalKey.length >= 20 && req.headers.get('x-telegram-bot-api-secret-token') === internalKey;
  const internalOk = internalKey.length >= 20 && req.headers.get('x-internal-key') === internalKey;
  if (!secretOk && !internalOk) return json({ error: 'Unauthorized' }, 401);
  if (!botToken) return json({ error: 'TELEGRAM_BOT_TOKEN não configurado' }, 503);
  let update: unknown;
  try { update = await req.json(); } catch { return json({ error: 'JSON inválido' }, 400); }
  // deno-lint-ignore no-explicit-any
  const acao = String((update as any)?.action ?? '');
  if (acao === 'deliver') {
    try { await deliver(update); return json({ ok: true }); }
    catch (e) { log('ERROR', 'entrega interna falhou', { error: errMsg(e) }); return json({ error: errMsg(e) }, 500); }
  }
  if (acao === 'pay_watch' && internalOk) {
    try { return json({ ok: true, ...(await payWatch()) }); }
    catch (e) { log('ERROR', 'pay_watch falhou', { error: errMsg(e) }); return json({ error: errMsg(e) }, 500); }
  }
  // Quem chega só com a chave interna (outra Edge Function) manda aviso, nunca update do Telegram.
  if (!secretOk) return json({ error: 'Ação interna desconhecida' }, 400);
  const p = handle(update).catch((e) => log('ERROR', 'unhandled', { error: errMsg(e) }));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  return json({ ok: true }); // Telegram reenvia se não receber 200 rápido
});

// assistente-webhook — ponte entre o WhatsApp (Evolution API na VPS) e o
// assistente-brain. Projeto PESSOAL do dono; ver assistente/README.md.
//
// Evolution → POST aqui (evento MESSAGES_UPSERT, header x-internal-key).
// Só responde a chats listados em asst_settings.allowed_chat_ids; qualquer
// outro remetente é ignorado em silêncio (o JID fica no log para cadastro).
// Responde 200 imediatamente e processa em background (EdgeRuntime.waitUntil)
// para a Evolution não repetir o webhook por timeout.
//
// Mídia: áudio → transcrito pelo Whisper na VPS (sem custo por minuto) e vai ao
// brain como texto "[Áudio] ..."; foto/PDF → vão ao brain como anexo (Claude lê).
// Mensagem encaminhada ganha o prefixo "[Encaminhada]".
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

async function evo(path: string, body: unknown) {
  const r = await fetch(`${evoUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: evoKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Evolution ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json().catch(() => ({}));
}

const sendText = (number: string, text: string) => evo(`/message/sendText/${evoInstance}`, { number, text });

// Debounce: no WhatsApp é comum mandar 2–3 mensagens seguidas. Cada mensagem entra
// em asst_inbox e espera DEBOUNCE_MS; se chegou outra depois dela, sai (a mais nova
// responde por todas). A última pega todas as pendentes e manda juntas ao brain:
// 1 chamada ao Claude e 1 resposta coerente em vez de 3.
const DEBOUNCE_MS = 3000;
async function debounce(admin: SupabaseClient, chatId: string, text: string): Promise<string | null> {
  const { data: row, error } = await admin.from('asst_inbox').insert({ chat_id: chatId, text }).select('id').single();
  if (error || !row) return text; // sem fila: responde só esta
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
  const { data: newer } = await admin.from('asst_inbox').select('id')
    .eq('chat_id', chatId).is('processed_at', null).gt('id', row.id).limit(1);
  if (newer?.length) return null;
  const { data: batch } = await admin.from('asst_inbox').update({ processed_at: new Date().toISOString() })
    .eq('chat_id', chatId).is('processed_at', null).select('id, text');
  if (!batch?.length) return null;
  return batch.sort((a, b) => Number(a.id) - Number(b.id)).map((b) => String(b.text)).join('\n');
}

// deno-lint-ignore no-explicit-any
async function evoGet(path: string): Promise<any> {
  const r = await fetch(`${evoUrl}${path}`, { headers: { apikey: evoKey } });
  if (!r.ok) throw new Error(`Evolution ${path} → ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json().catch(() => ({}));
}

// Grupos: o assistente SÓ LÊ — guarda a mensagem em asst_group_messages e nunca
// responde no grupo. Na primeira mensagem de um grupo busca nome e participantes;
// a leitura só liga sozinha se o dono estiver no grupo (qualquer pessoa pode
// adicionar o número do assistente num grupo). Liga/desliga na tela Assistente.
// deno-lint-ignore no-explicit-any
async function handleGroup(admin: SupabaseClient, data: any, allowed: string[]) {
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

  const p = parseMessage(data.message);
  let content = p.text ? p.text.trim() : '';
  if (p.kind === 'audio') {
    try {
      const b64 = await mediaBase64(data);
      const t = b64 ? await transcribe(b64, p.mime ?? 'audio/ogg') : '';
      content = t ? `[Áudio] ${t}` : '[Áudio não transcrito]';
    } catch (e) {
      log('WARN', 'transcrição de grupo falhou', { groupJid, error: errMsg(e) });
      content = '[Áudio não transcrito]';
    }
  } else if (p.kind === 'image') content = `[Foto]${content ? ` ${content}` : ''}`;
  else if (p.kind === 'document') content = `[Arquivo]${content ? ` ${content}` : ''}`;
  else if (p.kind === 'video') content = `[Vídeo]${content ? ` ${content}` : ''}`;
  if (!content) return;
  if (p.forwarded) content = `[Encaminhada] ${content}`;

  const ts = Number(data.messageTimestamp);
  await admin.from('asst_group_messages').upsert({
    message_id: data.key.id ? String(data.key.id) : null,
    group_jid: groupJid,
    sender_jid: String(data.key.participantAlt ?? data.key.participant ?? '') || null,
    sender_name: data.pushName ? String(data.pushName) : null,
    content: content.slice(0, 4000),
    kind: p.kind,
    sent_at: ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
  }, { onConflict: 'message_id', ignoreDuplicates: true });
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

async function transcribe(b64: string, mime: string): Promise<string> {
  if (!whisperUrl || !whisperKey) throw new Error('WHISPER_URL/WHISPER_API_KEY não configurados');
  const bytes = Uint8Array.from(atob(b64.replace(/^data:[^;]+;base64,/, '')), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('audio_file', new Blob([bytes], { type: mime.split(';')[0] || 'audio/ogg' }), 'audio.ogg');
  const r = await fetch(`${whisperUrl}/asr?task=transcribe&language=pt&output=json&encode=true`, {
    method: 'POST',
    headers: { 'X-Api-Key': whisperKey },
    body: form,
  });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const out = await r.json();
  return String(out?.text ?? '').trim();
}

// deno-lint-ignore no-explicit-any
async function handle(payload: any) {
  const event = String(payload?.event ?? '').toLowerCase().replace('_', '.');
  if (event !== 'messages.upsert') return;
  const data = payload?.data ?? {};
  const key = data.key ?? {};
  if (key.fromMe) return;
  // Contas novas do WhatsApp podem mandar o remetente como @lid; o número real
  // vem em remoteJidAlt/senderPn.
  const jid = String(key.remoteJid ?? '');
  const altJid = String(key.remoteJidAlt ?? key.senderPn ?? '');
  if (!jid || jid === 'status@broadcast') return; // status: fora

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: st } = await admin.from('asst_settings').select('value').eq('key', 'allowed_chat_ids').maybeSingle();
  const allowed: string[] = Array.isArray(st?.value) ? st.value.map(String) : [];
  if (jid.endsWith('@g.us')) { await handleGroup(admin, data, allowed); return; } // grupo: só lê
  const candidates = [jid, altJid, jid.replace(/@.*$/, ''), altJid.replace(/@.*$/, '')].filter(Boolean);
  if (!candidates.some((c) => allowed.includes(c))) {
    log('WARN', 'remetente não autorizado (ignorado)', { jid, altJid, pushName: data.pushName });
    return;
  }
  // Responde sempre ao JID que chegou (a Evolution resolve @lid e número).
  const replyTo = jid.endsWith('@lid') && altJid ? altJid : jid;
  const number = replyTo.replace(/@.*$/, '');
  const chatId = altJid && jid.endsWith('@lid') ? altJid : jid;

  const p = parseMessage(data.message);
  let text = p.text ? p.text.trim() : '';
  // deno-lint-ignore no-explicit-any
  let attachment: any = null;

  try {
    await evo(`/chat/sendPresence/${evoInstance}`, { number, presence: p.kind === 'audio' ? 'recording' : 'composing', delay: 1200 }).catch(() => {});

    if (p.kind === 'audio') {
      const b64 = await mediaBase64(data);
      if (!b64) throw new Error('não consegui baixar o áudio');
      const transcript = await transcribe(b64, p.mime ?? 'audio/ogg');
      if (!transcript) { await sendText(number, 'Não consegui entender o áudio. Pode repetir ou mandar em texto?'); return; }
      text = `[Áudio] ${transcript}`;
    } else if (p.kind === 'image' || (p.kind === 'document' && (p.mime === 'application/pdf' || IMAGE_TYPES.includes(p.mime ?? '')))) {
      const b64 = await mediaBase64(data);
      if (!b64) throw new Error('não consegui baixar o arquivo');
      attachment = { base64: b64, media_type: p.mime };
    } else if (p.kind === 'video' || p.kind === 'document' || p.kind === 'other') {
      if (!text) {
        await sendText(number, p.kind === 'video'
          ? 'Vídeo eu ainda não consigo ver. Me conta em texto ou áudio o que precisa?'
          : 'Esse tipo de arquivo eu não leio. Manda como foto ou PDF, ou me diz em texto o que fazer.');
        return;
      }
    }
    if (p.forwarded) text = `[Encaminhada] ${text}`.trim();

    // Foto/PDF vai direto (o arquivo não entra na fila); texto e áudio esperam
    // alguns segundos para juntar com as próximas mensagens.
    if (!attachment) {
      const merged = await debounce(admin, chatId, text);
      if (merged === null) return; // uma mensagem mais nova vai responder por esta
      text = merged;
      await evo(`/chat/sendPresence/${evoInstance}`, { number, presence: 'composing', delay: 1200 }).catch(() => {});
    }

    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ text, chat_id: chatId, channel: 'whatsapp', attachment }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out?.reply) throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
    await sendText(number, String(out.reply));
    log('INFO', 'respondido', { chatId, kind: p.kind, forwarded: p.forwarded, tools: (out.tool_calls ?? []).map((t: { name: string }) => t.name) });
  } catch (e) {
    log('ERROR', 'falha ao responder', { chatId, kind: p.kind, error: errMsg(e) });
    await sendText(number, 'Deu erro aqui do meu lado. Tenta de novo em instantes.').catch(() => {});
  }
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

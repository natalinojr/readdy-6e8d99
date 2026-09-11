// assistente-webhook — ponte entre o WhatsApp (Evolution API na VPS) e o
// assistente-brain. Projeto PESSOAL do dono; ver assistente/README.md.
//
// Evolution → POST aqui (evento MESSAGES_UPSERT, header x-internal-key).
// Só responde a chats listados em asst_settings.allowed_chat_ids; qualquer
// outro remetente é ignorado em silêncio (o JID fica no log para cadastro).
// Responde 200 imediatamente e processa em background (EdgeRuntime.waitUntil)
// para a Evolution não repetir o webhook por timeout.
//
// Secrets: ASSISTENTE_INTERNAL_KEY, EVOLUTION_URL, EVOLUTION_API_KEY,
//          EVOLUTION_INSTANCE (padrão "assistente").

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

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

// Extrai o texto útil de uma mensagem do Baileys. Áudio/imagem sem legenda
// voltam null com o tipo, para responder algo educado até a Fase 2.
// deno-lint-ignore no-explicit-any
function extractText(data: any): { text: string | null; kind: string } {
  const m = data?.message ?? {};
  if (typeof m.conversation === 'string' && m.conversation.trim()) return { text: m.conversation, kind: 'text' };
  if (m.extendedTextMessage?.text) return { text: m.extendedTextMessage.text, kind: 'text' };
  if (m.imageMessage) return { text: m.imageMessage.caption || null, kind: 'image' };
  if (m.documentMessage) return { text: m.documentMessage.caption || null, kind: 'document' };
  if (m.audioMessage) return { text: null, kind: 'audio' };
  if (m.videoMessage) return { text: m.videoMessage.caption || null, kind: 'video' };
  // Mensagem encaminhada com contexto de outra conversa
  if (m.ephemeralMessage?.message) return extractText({ message: m.ephemeralMessage.message });
  return { text: null, kind: String(data?.messageType ?? 'unknown') };
}

// deno-lint-ignore no-explicit-any
async function handle(payload: any) {
  const event = String(payload?.event ?? '').toLowerCase().replace('_', '.');
  if (event !== 'messages.upsert') return;
  const data = payload?.data ?? {};
  const key = data.key ?? {};
  if (key.fromMe) return;
  const jid = String(key.remoteJid ?? '');
  if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast') return; // grupos/status: fora por enquanto

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: st } = await admin.from('asst_settings').select('value').eq('key', 'allowed_chat_ids').maybeSingle();
  const allowed: string[] = Array.isArray(st?.value) ? st.value.map(String) : [];
  const number = jid.replace(/@.*$/, '');
  if (!allowed.includes(jid) && !allowed.includes(number)) {
    log('WARN', 'remetente não autorizado (ignorado)', { jid, pushName: data.pushName });
    return;
  }

  const { text, kind } = extractText(data);
  if (!text) {
    const aviso = kind === 'audio'
      ? 'Ainda não escuto áudio — me manda em texto que eu resolvo. (Transcrição chega na próxima fase.)'
      : `Recebi ${kind === 'image' ? 'a imagem' : 'o arquivo'}, mas por enquanto só leio texto. Me diz o que fazer com isso?`;
    await sendText(number, aviso);
    return;
  }

  try {
    await evo(`/chat/sendPresence/${evoInstance}`, { number, presence: 'composing', delay: 1200 }).catch(() => {});
    const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
      body: JSON.stringify({ text, chat_id: jid, channel: 'whatsapp' }),
    });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || !out?.reply) throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
    await sendText(number, String(out.reply));
    log('INFO', 'respondido', { jid, tools: (out.tool_calls ?? []).map((t: { name: string }) => t.name) });
  } catch (e) {
    log('ERROR', 'falha ao responder', { jid, error: errMsg(e) });
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

  // deno-lint-ignore no-explicit-any
  const p = handle(payload).catch((e) => log('ERROR', 'unhandled', { error: errMsg(e) }));
  // deno-lint-ignore no-explicit-any
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  return json({ ok: true });
});

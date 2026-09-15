// whatsapp-cloud — webhook da API OFICIAL do WhatsApp (Meta Cloud API) para o atendimento público:
// link de candidatura (canal-publico) e agendamento de entrevistas (hiring-scheduler). Criado em
// 2026-09-14, depois que o número da Evolution foi banido. O assistente pessoal continua no
// assistente-webhook (Evolution) e não passa por aqui.
//
//   GET  ?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…  → confirmação do webhook no painel da Meta
//   POST (Meta)  mensagens e recibos. Assinatura X-Hub-Signature-256 conferida com WHATSAPP_APP_SECRET.
//   POST (admin, header x-admin-key = WHATSAPP_ADMIN_KEY):
//        { action: 'status' }           → número, qualidade e modelos
//        { action: 'setup_templates' }  → cria na Meta os modelos de _shared/wa.ts (TEMPLATES)
//
// Secrets: WHATSAPP_CLOUD_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_ADMIN_KEY, WHATSAPP_APP_SECRET (recomendado),
//          ASSISTENTE_INTERNAL_KEY, WHISPER_URL, WHISPER_API_KEY.
// Deploy: --no-verify-jwt (a Meta chama sem JWT).
// deno-lint-ignore-file no-explicit-any

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { graph, TEMPLATES, waConfig, waSendText, waTyping, type WaConfig } from '../_shared/wa.ts';

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const verifyToken = Deno.env.get('WHATSAPP_VERIFY_TOKEN') ?? '';
const adminKey = Deno.env.get('WHATSAPP_ADMIN_KEY') ?? '';
const appSecret = Deno.env.get('WHATSAPP_APP_SECRET') ?? '';
const whisperUrl = (Deno.env.get('WHISPER_URL') ?? '').replace(/\/$/, '');
const whisperKey = Deno.env.get('WHISPER_API_KEY') ?? '';
const WHISPER_PROMPT = 'Conversa de candidato a vaga de emprego na TBA Ipanema, em Pontal do Paraná (PR). Currículo, entrevista, atendente, cozinha, bairro Ipanema, Praia de Leste, Paranaguá, horário, escolaridade.';
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const MAX_MEDIA = 15 * 1024 * 1024;

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'whatsapp-cloud', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const digits = (s: unknown) => String(s ?? '').replace(/\D/g, '');
// Mesmo telefone com e sem o 9 do celular (o WhatsApp manda muitos números antigos sem o 9).
const foneKey = (s: unknown) => {
  let d = digits(s);
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11 && d[2] === '9') d = d.slice(0, 2) + d.slice(3);
  return d;
};

// ── assinatura da Meta (HMAC-SHA256 do corpo com o App Secret) ──
async function signatureOk(raw: string, header: string | null): Promise<boolean> {
  if (!appSecret) return true; // sem segredo configurado: aceita (filtro pelo phone_id abaixo). Ver README.
  const sig = String(header ?? '').replace(/^sha256=/, '');
  if (!sig) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  const hex = Array.from(mac, (b) => b.toString(16).padStart(2, '0')).join('');
  if (hex.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

function toB64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
// Mídia da Cloud API: /{media_id} → url temporária → download com o mesmo token.
async function downloadMedia(mediaId: string): Promise<{ base64: string; mime: string } | null> {
  const meta = await graph(mediaId);
  if (!meta?.url) return null;
  if (Number(meta.file_size ?? 0) > MAX_MEDIA) throw new Error(`arquivo grande demais (${meta.file_size} bytes)`);
  const r = await fetch(meta.url, { headers: { Authorization: `Bearer ${Deno.env.get('WHATSAPP_CLOUD_TOKEN') ?? ''}` } });
  if (!r.ok) throw new Error(`download da mídia → ${r.status}`);
  return { base64: toB64(await r.arrayBuffer()), mime: String(meta.mime_type ?? r.headers.get('content-type') ?? '').split(';')[0].toLowerCase() };
}

async function transcribe(b64: string, mime: string): Promise<string> {
  if (!whisperUrl || !whisperKey) throw new Error('WHISPER_URL/WHISPER_API_KEY não configurados');
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const form = new FormData();
  form.append('audio_file', new Blob([bytes], { type: mime || 'audio/ogg' }), 'audio.ogg');
  const r = await fetch(`${whisperUrl}/asr?task=transcribe&language=pt&output=json&encode=true&initial_prompt=${encodeURIComponent(WHISPER_PROMPT)}`, {
    method: 'POST', headers: { 'X-Api-Key': whisperKey }, body: form,
  });
  if (!r.ok) throw new Error(`Whisper ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return String((await r.json())?.text ?? '').trim();
}

async function internal(fn: string, body: unknown): Promise<any> {
  const r = await fetch(`${supabaseUrl}/functions/v1/${fn}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify(body),
  });
  return { ok: r.ok, status: r.status, out: await r.json().catch(() => ({})) };
}

// Meta reentrega o mesmo evento quando demora: cada id de mensagem é tratado uma vez só.
async function firstTime(admin: SupabaseClient, id: string): Promise<boolean> {
  const { data, error } = await admin.from('wa_cloud_seen').upsert({ id }, { onConflict: 'id', ignoreDuplicates: true }).select('id');
  if (error) { log('WARN', 'dedupe', { error: error.message }); return true; }
  return (data ?? []).length > 0;
}

async function ownerKeys(admin: SupabaseClient): Promise<Set<string>> {
  const { data } = await admin.from('asst_settings').select('value').eq('key', 'allowed_chat_ids').maybeSingle();
  const list = Array.isArray(data?.value) ? data!.value : [];
  return new Set(list.map((x: unknown) => foneKey(String(x).replace(/@.*$/, ''))).filter((x: string) => x.length >= 10));
}

async function handleMessage(admin: SupabaseClient, cfg: WaConfig, m: any, name: string | null) {
  const waId = digits(m.from);
  if (!waId || !m.id) return;
  if (!(await firstTime(admin, String(m.id)))) return;
  // Janela de 24 h: a partir daqui a empresa pode responder com texto livre (hiring-scheduler consulta).
  await admin.from('wa_last_in').upsert({ phone_key: foneKey(waId), at: new Date().toISOString() }, { onConflict: 'phone_key' });
  // Lida + "digitando…" na hora (a resposta pode levar alguns segundos).
  waTyping(cfg, waId, 0, m.id).catch(() => {});

  const type = String(m.type ?? '');
  let kind: 'text' | 'audio' | 'image' | 'document' | 'video' | 'other' = 'other';
  let text = '';
  let file: { base64: string; mime: string; name: string | null } | null = null;
  try {
    if (type === 'text') { kind = 'text'; text = String(m.text?.body ?? ''); }
    else if (type === 'button') { kind = 'text'; text = String(m.button?.text ?? ''); }
    else if (type === 'interactive') { kind = 'text'; text = String(m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title ?? ''); }
    else if (type === 'audio') {
      kind = 'audio';
      const media = await downloadMedia(String(m.audio?.id ?? ''));
      const t = media ? await transcribe(media.base64, media.mime) : '';
      if (!t) { await waSendText(cfg, waId, 'Não consegui ouvir o áudio 😕 Pode escrever?').catch(() => {}); return; }
      text = `[Áudio] ${t}`;
    } else if (type === 'image' || type === 'document') {
      kind = type;
      const src = type === 'image' ? m.image : m.document;
      const fname = String(src?.filename ?? '').trim() || null;
      text = String(src?.caption ?? '');
      const declared = String(src?.mime_type ?? '').split(';')[0].toLowerCase();
      const isDocx = declared === DOCX_MIME || /\.docx$/i.test(fname ?? '');
      if (declared === 'application/pdf' || IMAGE_TYPES.includes(declared) || isDocx) {
        const media = await downloadMedia(String(src?.id ?? ''));
        if (!media) { await waSendText(cfg, waId, 'Não consegui baixar esse arquivo. Pode mandar de novo?').catch(() => {}); return; }
        file = { base64: media.base64, mime: isDocx ? DOCX_MIME : (media.mime || declared), name: fname };
      } else {
        text = text || `[Arquivo${fname ? ` "${fname}"` : ''}]`; // tipo que não lemos: o canal-publico pede PDF/foto/Word
      }
    } else if (type === 'video') kind = 'video';
    // Reação (👍 numa mensagem), figurinha e avisos do sistema: não são conversa; ignora em silêncio
    // (antes respondia "não consigo abrir esse tipo de mensagem" — Aline e Alexandra, 2026-09-15).
    else if (['reaction', 'sticker', 'system', 'ephemeral', 'unsupported', 'request_welcome'].includes(type)) return;
    else { kind = 'other'; text = text || `[${type || 'mensagem'}]`; }
  } catch (e) {
    log('WARN', 'preparar mídia', { type, error: errMsg(e) });
    await waSendText(cfg, waId, 'Não consegui abrir essa mensagem 😕 Pode mandar de novo?').catch(() => {});
    return;
  }

  const isOwner = (await ownerKeys(admin)).has(foneKey(waId));
  // 1) Agendamento de entrevista: candidato com conversa aberta ou entrevistador respondendo.
  // O dono TAMBÉM passa por aqui (diferente do assistente-webhook, aqui não há assistente pessoal):
  // ele é entrevistador e, nos testes, o candidato. O scheduler só trata se houver sessão/pedido dele.
  if (text && kind !== 'image' && kind !== 'document') {
    const r = await internal('hiring-scheduler', { action: 'inbound', number: waId, reply_to: waId, text, name });
    if (r.ok && r.out?.handled === true) return;
  }
  // 2) Link de candidatura (canal-publico decide se atende, igual ao fluxo da Evolution).
  const r = await internal('canal-publico', {
    action: 'incoming', chat_id: `${waId}@s.whatsapp.net`, number: waId, reply_to: waId, name, kind, text, file,
    key: { remoteJid: waId, fromMe: false, id: String(m.id) }, is_owner: isOwner,
  });
  if (!r.ok) log('ERROR', 'canal-publico recusou', { status: r.status, error: r.out?.error });
}

// Recibos (entregue/lida) das mensagens do agendamento → painel Contratação › Agendamentos.
async function handleStatus(admin: SupabaseClient, s: any) {
  const id = String(s.id ?? '');
  const st = String(s.status ?? '');
  const now = new Date().toISOString();
  if (st === 'failed') { log('WARN', 'mensagem não entregue', { id, to: s.recipient_id, errors: s.errors }); return; }
  if (!id || !['delivered', 'read'].includes(st)) return;
  await admin.from('hiring_scheduling_sessions').update({ delivered_at: now }).eq('last_out_msg_id', id).is('delivered_at', null);
  if (st === 'read') await admin.from('hiring_scheduling_sessions').update({ read_at: now }).eq('last_out_msg_id', id).is('read_at', null);
}

async function processEvent(admin: SupabaseClient, body: any) {
  const cfg = await waConfig(admin);
  for (const entry of body?.entry ?? []) {
    for (const change of entry?.changes ?? []) {
      if (change?.field !== 'messages') continue;
      const v = change.value ?? {};
      // Só o número configurado do atendimento público (outros números da conta são ignorados).
      if (cfg.phone_id && String(v.metadata?.phone_number_id ?? '') !== cfg.phone_id) {
        log('INFO', 'evento de outro número (ignorado)', { phone_id: v.metadata?.phone_number_id });
        continue;
      }
      for (const s of v.statuses ?? []) await handleStatus(admin, s).catch((e) => log('WARN', 'recibo', { error: errMsg(e) }));
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [digits(c.wa_id), String(c.profile?.name ?? '')]));
      for (const m of v.messages ?? []) {
        await handleMessage(admin, cfg, m, names.get(digits(m.from)) || null)
          .catch((e) => log('ERROR', 'falha na mensagem', { from: m?.from, type: m?.type, error: errMsg(e) }));
      }
    }
  }
}

// ── admin: status e criação dos modelos ──
async function adminAction(admin: SupabaseClient, body: any) {
  const cfg = await waConfig(admin);
  if (body?.action === 'status') {
    const out: Record<string, unknown> = { config: cfg };
    if (cfg.phone_id) out.numero = await graph(`${cfg.phone_id}?fields=display_phone_number,verified_name,status,quality_rating,name_status,code_verification_status,platform_type,messaging_limit_tier`).catch((e) => ({ erro: errMsg(e) }));
    if (cfg.waba_id) out.modelos = await graph(`${cfg.waba_id}/message_templates?fields=name,status,category,language,rejected_reason&limit=50`).catch((e) => ({ erro: errMsg(e) }));
    if (cfg.waba_id) out.webhook_app = await graph(`${cfg.waba_id}/subscribed_apps`).catch((e) => ({ erro: errMsg(e) }));
    return json(out);
  }
  if (body?.action === 'setup_templates') {
    if (!cfg.waba_id) return json({ error: 'wa_public.waba_id não configurado' }, 400);
    const res: Record<string, unknown> = {};
    for (const t of Object.values(TEMPLATES)) {
      res[t.name] = await graph(`${cfg.waba_id}/message_templates`, {
        body: {
          name: t.name, language: 'pt_BR', category: 'UTILITY',
          components: [{ type: 'BODY', text: t.text, example: { body_text: [[...t.example]] } }],
        },
      }).catch((e) => ({ erro: errMsg(e) }));
    }
    return json(res);
  }
  if (body?.action === 'send_text') {
    // Mensagem avulsa autorizada pelo dono (ex.: pedir de novo um currículo que falhou). Só texto livre:
    // fora da janela de 24 h a Meta recusa, e o erro volta aqui.
    const to = digits(body.to);
    const text = String(body.text ?? '').trim();
    if (to.length < 12 || !text) return json({ error: 'to (com DDI) e text são obrigatórios' }, 400);
    try { return json({ ok: true, id: await waSendText(cfg, to, text) }); }
    catch (e) { return json({ ok: false, error: errMsg(e) }, 502); }
  }
  if (body?.action === 'scheduler_force_tick') {
    // Teste do dono: roda o agendador agora, fora do horário comercial (convites/cobranças).
    const r = await internal('hiring-scheduler', { action: 'tick', force: true });
    return json({ status: r.status, ...r.out });
  }
  if (body?.action === 'subscribe_app') {
    // Liga a conta do WhatsApp ao app (sem isso a Meta não manda os eventos de mensagem).
    if (!cfg.waba_id) return json({ error: 'wa_public.waba_id não configurado' }, 400);
    return json(await graph(`${cfg.waba_id}/subscribed_apps`, { method: 'POST', body: {} }).catch((e) => ({ erro: errMsg(e) })));
  }
  return json({ error: 'ação desconhecida' }, 400);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'GET') {
    // Confirmação do webhook (painel da Meta › WhatsApp › Configuração).
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && verifyToken.length >= 16
      && url.searchParams.get('hub.verify_token') === verifyToken;
    return ok ? new Response(url.searchParams.get('hub.challenge') ?? '', { status: 200 }) : new Response('forbidden', { status: 403 });
  }
  if (req.method !== 'POST') return new Response('method not allowed', { status: 405 });
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });

  const given = req.headers.get('x-admin-key') ?? '';
  if (given) {
    if (adminKey.length < 16 || given !== adminKey) return json({ error: 'Unauthorized' }, 401);
    try { return await adminAction(admin, await req.json()); } catch (e) { return json({ error: errMsg(e) }, 500); }
  }

  const raw = await req.text();
  if (!(await signatureOk(raw, req.headers.get('x-hub-signature-256')))) {
    log('WARN', 'assinatura inválida');
    return new Response('bad signature', { status: 401 });
  }
  let body: any;
  try { body = JSON.parse(raw); } catch { return new Response('bad json', { status: 400 }); }
  if (!appSecret) log('WARN', 'WHATSAPP_APP_SECRET não configurado: assinatura da Meta não conferida');
  // Responde 200 na hora (a Meta reenvia se demorar) e processa em segundo plano.
  const p = processEvent(admin, body).catch((e) => log('ERROR', 'evento', { error: errMsg(e) }));
  (globalThis as any).EdgeRuntime?.waitUntil?.(p);
  return new Response('ok', { status: 200 });
});

// assistente-cron — tarefas agendadas do assistente pessoal (projeto PESSOAL
// do dono; ver assistente/README.md). Chamada a cada minuto pelo pg_cron
// (job "assistente-tick", função fn_assistente_tick) com x-internal-key.
//
// 1. Lembretes: envia no WhatsApp os asst_reminders vencidos e ainda não
//    enviados. Marca sent_at ANTES de enviar (update condicional) para dois
//    ticks simultâneos nunca mandarem o mesmo lembrete; se o envio falha,
//    devolve sent_at = null e o próximo tick tenta de novo.
// 2. Resumo da manhã: uma vez por dia, a partir de asst_settings.morning_brief.time
//    (padrão 07:30, fuso de SP), pede o resumo ao assistente-brain e envia.
//
// Destino: chat_id do lembrete quando é um JID do WhatsApp; senão (lembretes
// criados em teste, resumo) asst_settings.owner_chat_id. Sem destino = não envia.
// Secrets: ASSISTENTE_INTERNAL_KEY, EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const TZ = 'America/Sao_Paulo';
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
function log(level: 'INFO' | 'WARN' | 'ERROR', msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'assistente-cron', level, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const internalKey = Deno.env.get('ASSISTENTE_INTERNAL_KEY') ?? '';
const evoUrl = (Deno.env.get('EVOLUTION_URL') ?? '').replace(/\/$/, '');
const evoKey = Deno.env.get('EVOLUTION_API_KEY') ?? '';
const evoInstance = Deno.env.get('EVOLUTION_INSTANCE') || 'assistente';

async function sendText(number: string, text: string) {
  const r = await fetch(`${evoUrl}/message/sendText/${evoInstance}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: evoKey },
    body: JSON.stringify({ number, text }),
  });
  if (!r.ok) throw new Error(`Evolution sendText → ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

const toNumber = (chatId: string) => chatId.replace(/@.*$/, '');
const isJid = (s: string) => /@s\.whatsapp\.net$|@lid$/.test(s);
// "HH:MM" local de SP e AAAA-MM-DD local
const localHHMM = () => new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

async function getSettings(admin: SupabaseClient) {
  const { data } = await admin.from('asst_settings').select('key, value');
  // deno-lint-ignore no-explicit-any
  return Object.fromEntries((data ?? []).map((s) => [s.key, s.value])) as Record<string, any>;
}

async function sendReminders(admin: SupabaseClient, ownerChat: string | null) {
  const { data: due } = await admin.from('asst_reminders')
    .select('id, text, chat_id').is('sent_at', null).lte('due_at', new Date().toISOString())
    .order('due_at').limit(20);
  let sent = 0;
  for (const r of due ?? []) {
    const target = isJid(r.chat_id) ? r.chat_id : ownerChat;
    if (!target) continue; // sem número cadastrado ainda: fica pendente
    const { data: claimed } = await admin.from('asst_reminders')
      .update({ sent_at: new Date().toISOString() }).eq('id', r.id).is('sent_at', null).select('id');
    if (!claimed?.length) continue; // outro tick pegou
    const text = `⏰ *Lembrete:* ${r.text}`;
    try {
      await sendText(toNumber(target), text);
      await admin.from('asst_messages').insert({ channel: 'cron', chat_id: target, role: 'assistant', content: text });
      sent++;
    } catch (e) {
      await admin.from('asst_reminders').update({ sent_at: null }).eq('id', r.id);
      log('ERROR', 'lembrete falhou', { id: r.id, error: errMsg(e) });
    }
  }
  return sent;
}

// deno-lint-ignore no-explicit-any
async function morningBrief(admin: SupabaseClient, cfg: Record<string, any>, ownerChat: string | null) {
  const mb = cfg.morning_brief ?? { enabled: true, time: '07:30' };
  if (!mb.enabled || !ownerChat) return false;
  const today = localDate();
  const now = localHHMM();
  const time = String(mb.time ?? '07:30');
  // Janela de 3h depois do horário: se a VPS/Evolution estiver fora na hora
  // exata, ainda sai; depois disso não manda um "bom dia" à tarde.
  const [h, m] = time.split(':').map(Number);
  const limit = `${String(Math.min(h + 3, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  if (now < time || now > limit || cfg.last_brief_date === today) return false;

  // Marca antes de gerar (evita duplicar se o brain demorar mais que 1 tick)
  await admin.from('asst_settings').upsert({ key: 'last_brief_date', value: today, updated_at: new Date().toISOString() });

  const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({
      chat_id: ownerChat,
      channel: 'cron',
      text: '[Mensagem automática das 7h30, não foi o Natalino que escreveu] Monte o resumo da manhã dele: '
        + 'tarefas de hoje e atrasadas, lembretes de hoje, contas a pagar vencendo nos próximos 3 dias (e atrasadas) '
        + 'e estoque crítico. Comece com "Bom dia". Curto, só o que pede atenção; se não houver nada num item, pule.',
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out?.reply) {
    await admin.from('asst_settings').upsert({ key: 'last_brief_date', value: null, updated_at: new Date().toISOString() });
    throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
  }
  await sendText(toNumber(ownerChat), String(out.reply));
  return true;
}

// Mantém vivo o cache de 1 h do assistente enquanto o dono está usando: uma
// leitura do cache (max_tokens 0) custa ~R$ 0,008 e renova o TTL; deixar vencer e
// regravar custa ~R$ 0,15. Só dispara entre 07:00 e 23:00, se o dono falou nas
// últimas 4 h e na janela de 50–58 min sem uso (antes disso ainda está vivo;
// depois de 60 min já expirou e "aquecer" seria só regravar, sem economia).
// deno-lint-ignore no-explicit-any
async function keepWarm(admin: SupabaseClient, cfg: Record<string, any>) {
  const now = localHHMM();
  if (now < '07:00' || now > '23:00') return false;
  const { data: lastUser } = await admin.from('asst_messages').select('created_at')
    .eq('role', 'user').eq('channel', 'whatsapp').order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (!lastUser || Date.now() - Date.parse(lastUser.created_at) > 4 * 3600_000) return false;
  const { data: lastAny } = await admin.from('asst_messages').select('created_at').order('created_at', { ascending: false }).limit(1).maybeSingle();
  const lastUse = Math.max(lastAny ? Date.parse(lastAny.created_at) : 0, cfg.last_warm_at ? Date.parse(String(cfg.last_warm_at)) : 0);
  const idle = Date.now() - lastUse;
  if (idle < 50 * 60_000 || idle > 58 * 60_000) return false;
  await admin.from('asst_settings').upsert({ key: 'last_warm_at', value: new Date().toISOString(), updated_at: new Date().toISOString() });
  const r = await fetch(`${supabaseUrl}/functions/v1/assistente-brain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
    body: JSON.stringify({ action: 'warm' }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`warm ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
  log('INFO', 'cache aquecido', { usage: out.usage });
  return true;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (internalKey.length < 20 || req.headers.get('x-internal-key') !== internalKey) return json({ error: 'Unauthorized' }, 401);
  if (!evoUrl || !evoKey) return json({ error: 'EVOLUTION_URL/EVOLUTION_API_KEY não configurados' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const cfg = await getSettings(admin);
  const ownerChat = typeof cfg.owner_chat_id === 'string' && cfg.owner_chat_id ? cfg.owner_chat_id : null;

  const result: Record<string, unknown> = {};
  try { result.reminders_sent = await sendReminders(admin, ownerChat); } catch (e) { result.reminders_error = errMsg(e); log('ERROR', 'reminders', { error: errMsg(e) }); }
  try { result.brief_sent = await morningBrief(admin, cfg, ownerChat); } catch (e) { result.brief_error = errMsg(e); log('ERROR', 'brief', { error: errMsg(e) }); }
  try { result.warmed = await keepWarm(admin, cfg); } catch (e) { result.warm_error = errMsg(e); log('ERROR', 'warm', { error: errMsg(e) }); }
  // Fila do debounce: só serve por segundos; guarda 7 dias para diagnóstico
  await admin.from('asst_inbox').delete().lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  // Mensagens de grupos: guardadas por 90 dias
  await admin.from('asst_group_messages').delete().lt('sent_at', new Date(Date.now() - 90 * 86400000).toISOString());
  // Leitor universal (asst_reader): tabelas/colunas novas entram sozinhas, 1×/dia às 04:00
  if (localHHMM() === '04:00') {
    const { error } = await admin.rpc('fn_asst_reader_refresh');
    if (error) log('ERROR', 'reader refresh', { error: error.message });
  }
  if (result.reminders_sent || result.brief_sent) log('INFO', 'tick', result);
  return json({ ok: true, ...result });
});

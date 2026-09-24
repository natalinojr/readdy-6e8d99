// assistente-cron — tarefas agendadas do assistente pessoal (projeto PESSOAL
// do dono; ver assistente/README.md). Chamada a cada minuto pelo pg_cron
// (job "assistente-tick", função fn_assistente_tick) com x-internal-key.
//
// 1. Lembretes: envia no WhatsApp os asst_reminders vencidos e ainda não
//    enviados. Marca sent_at ANTES de enviar (update condicional) para dois
//    ticks simultâneos nunca mandarem o mesmo lembrete; se o envio falha,
//    devolve sent_at = null e o próximo tick tenta de novo.
// 2. Resumo da manhã: uma vez por dia, a partir de asst_settings.morning_brief.time
//    (padrão 07:30, fuso de SP), monta o resumo em SQL (sem modelo desde 2026-09-23) e envia.
//    POST { preview: 'brief' } gera sem enviar.
//
// 3. Proatividade determinística (asst_settings.proactive): fechamento do dia,
//    anomalia de venda, vencimentos de amanhã, estoque crítico que mudou e
//    tarefas vencidas — regras em SQL, sem modelo. POST { preview: 'closing' |
//    'anomaly' | 'due_tomorrow' | 'stock' | 'tasks_overdue' } gera sem enviar.
//
// Destino: chat_id do lembrete quando é um JID do WhatsApp; senão (lembretes
// criados em teste, resumo) asst_settings.owner_chat_id. Sem destino = não envia.
// Secrets: ASSISTENTE_INTERNAL_KEY, EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import postgres from 'npm:postgres@3.4.5';

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
const isTg = (s: string) => /^tg:-?\d+$/.test(s);
// Telegram (canal principal desde 2026-09-12): chat_id "tg:<id>". HTML com *negrito* convertido.
const tgToken = Deno.env.get('TELEGRAM_BOT_TOKEN') ?? '';
// deno-lint-ignore no-explicit-any
// Saída pelo Telegram desligada (asst_settings.channels.telegram_out = false, dono 2026-09-21: "agora
// é só pelo chat"): o aviso não sai no Telegram, mas continua indo para a conversa (quem chama grava
// em asst_messages) e para o push do app.
let tgOutCache: boolean | null = null;
async function tgLigado(): Promise<boolean> {
  if (tgOutCache === null) {
    const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { data } = await admin.from('asst_settings').select('value').eq('key', 'channels').maybeSingle();
    // deno-lint-ignore no-explicit-any
    tgOutCache = ((data?.value ?? {}) as any).telegram_out !== false;
  }
  return tgOutCache;
}
async function sendTelegram(chatKey: string, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (!await tgLigado()) { await pushDono(text); return null; }
  if (!tgToken) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = esc(text).replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<b>$2</b>');
  const send = async (body: Record<string, unknown>) => {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatKey.slice(3), ...body }) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out?.ok === false) throw new Error(`Telegram → ${r.status}: ${String(out?.description ?? '').slice(0, 200)}`);
    return out.result;
  };
  let res;
  try { res = await send({ text: html, parse_mode: 'HTML', ...extra }); } catch { res = await send({ text, ...extra }); }
  await pushDono(text);
  return res;
}
// Notificação no celular pelo app/PWA do ERPOS (2026-09-15): tudo que o cron manda ao dono no
// Telegram (lembrete, resumo, pergunta de DRE, alertas) também vira Web Push e abre o chat do ERPOS.
async function pushDono(corpo: string) {
  try {
    const url = Deno.env.get('SUPABASE_URL') ?? '';
    const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const texto = corpo.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim();
    if (!url || !key || !texto) return;
    const h = { apikey: key, Authorization: `Bearer ${key}` };
    const st = await fetch(`${url}/rest/v1/asst_settings?key=eq.owner_user_id&select=value`, { headers: h }).then((r) => r.json()).catch(() => []);
    const owner = Array.isArray(st) ? st[0]?.value : null;
    if (!owner) return;
    await fetch(`${url}/functions/v1/send-push`, {
      method: 'POST', headers: { ...h, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'send', user_ids: [String(owner)], payload: { titulo: 'Assistente', corpo: texto.slice(0, 200), url: '/assistente', tag: 'assistente' } }),
    });
  } catch (e) { console.warn(JSON.stringify({ fn: 'assistente-cron', level: 'WARN', msg: 'push', error: String(e) })); }
}
// Entrega para qualquer destino: JID do WhatsApp ou "tg:<id>" do Telegram.
async function deliver(target: string, text: string) {
  if (isTg(target)) return sendTelegram(target, text);
  return sendText(toNumber(target), text);
}
// Pagamento preparado e não concluído em 15 min vira pendência (dono, 2026-09-18) — qualquer origem:
// pedido dele, boleto do dia, reembolso. Pedido de grupo tem a pendência própria (pagamento_grupo)
// desde a triagem, então fica de fora. Substituído ("preparar de novo") não conta: vale o novo, e a
// pendência (que nasce no original) fecha pelo trigger quando o substituto for pago ou cancelado.
const PARADO_MS = 15 * 60_000;
// A regra vale do dia em que nasceu em diante: pedido velho expirado antes dela já foi resolvido por
// outro caminho (visto: Pix do Sacolão de 12/09) e viraria ruído na caixa.
const PARADO_DESDE = Date.parse('2026-09-18T15:00:00Z');
const PAY_LABEL: Record<string, string> = {
  draft: 'não foi tocado em Pagar', awaiting_pin: 'esperando o PIN', expired: 'expirou sem pagar', failed: 'não foi enviado ao Inter',
  rejected: 'recusado pelo Inter', pending_approval: 'aguardando sua aprovação no app do Inter',
};
async function pagamentosParados(admin: SupabaseClient): Promise<number> {
  const { data } = await admin.from('fin_inter_payments')
    .select('id, tenant_id, kind, amount, beneficiary_name, description, status, bill_id, created_at')
    .in('status', Object.keys(PAY_LABEL)).is('replaced_by', null).is('group_request_id', null)
    .lt('created_at', new Date(Date.now() - PARADO_MS).toISOString())
    .gte('created_at', new Date(Math.max(Date.now() - 7 * 86400000, PARADO_DESDE)).toISOString()).limit(50);
  let n = 0;
  for (const p of data ?? []) {
    // Já existe pendência deste pagamento (ou de um que ele substituiu)? Não mexe.
    const { data: tem } = await admin.from('pendencias').select('id').eq('kind', 'pagamento_pendente').eq('ref', String(p.id)).limit(1);
    if (tem?.length) continue;
    const { data: antes } = await admin.from('fin_inter_payments').select('id').eq('replaced_by', p.id).neq('id', p.id);
    if (antes?.length) {
      const { data: velha } = await admin.from('pendencias').select('id').eq('kind', 'pagamento_pendente').in('ref', antes.map((a) => String(a.id))).limit(1);
      if (velha?.length) continue;
    }
    const quem = p.beneficiary_name || p.description || '';
    const { error } = await admin.rpc('fn_pendencia_upsert', {
      p_tenant: p.tenant_id, p_kind: 'pagamento_pendente', p_ref: String(p.id),
      p_titulo: `${p.kind === 'pix' ? 'Pix' : 'Boleto'} de ${brl(p.amount)}${quem ? ` para ${quem}` : ''} — não pago`,
      p_detalhe: `Preparado em ${new Date(p.created_at).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} e ${PAY_LABEL[p.status] ?? p.status}.`,
      p_payload: { payment_id: p.id, bill_id: p.bill_id }, p_rota: null,
      p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'cron',
    });
    if (error) log('WARN', 'pendência de pagamento parado', { payment: p.id, error: error.message }); else n++;
  }
  return n;
}

// "HH:MM" local de SP e AAAA-MM-DD local
const localHHMM = () => new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false });
const localDate = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });

// Pagamento do Inter em andamento (depois do PIN, esperando aprovação no app / agendado):
// o assistente-telegram consulta o status, edita o cartão e posta o comprovante no grupo.
// Não é sincronização de extrato — só roda enquanto existe pagamento que o dono mandou.
async function payWatch(admin: SupabaseClient): Promise<unknown> {
  const { count } = await admin.from('fin_inter_payments').select('id', { count: 'exact', head: true })
    .in('status', ['sent', 'pending_approval', 'approved', 'scheduled']).like('chat_id', 'tg:%')
    .gte('sent_at', new Date(Date.now() - 7 * 86400000).toISOString());
  // Também os pagos ainda sem baixa pela conciliação (o débito demora a cair no extrato).
  const { count: semBaixa } = await admin.from('fin_inter_payments').select('id', { count: 'exact', head: true })
    .eq('status', 'paid').or('bill_id.not.is.null,dre_category_id.not.is.null').is('settled_at', null).lt('settle_attempts', 15).like('chat_id', 'tg:%')
    .gte('paid_at', new Date(Date.now() - 2 * 86400000).toISOString());
  if (!count && !semBaixa) return null;
  const r = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify({ action: 'pay_watch' }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`assistente-telegram ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
}

// Fila dos documentos de grupo (assistente-webhook, 2026-09-23): item em 'processando' há mais de
// 10 min (execução caiu) vira erro; item esperando na 'fila' há mais de 2 min sem ninguém
// processando → acorda o trabalhador.
async function filaGrupo(admin: SupabaseClient): Promise<unknown> {
  const { data: presos } = await admin.from('asst_group_requests').update({ status: 'erro', error: 'processamento interrompido', updated_at: new Date().toISOString() })
    .eq('status', 'processando').lt('updated_at', new Date(Date.now() - 10 * 60_000).toISOString()).select('id');
  const { count } = await admin.from('asst_group_requests').select('id', { count: 'exact', head: true })
    .eq('status', 'fila').lt('updated_at', new Date(Date.now() - 2 * 60_000).toISOString());
  if (!count) return presos?.length ? { presos: presos.length } : null;
  const r = await fetch(`${supabaseUrl}/functions/v1/assistente-webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${serviceRoleKey}` }, body: JSON.stringify({ action: 'processar_fila' }),
  });
  if (!r.ok) throw new Error(`assistente-webhook ${r.status}`);
  return { acordou: count, ...(presos?.length ? { presos: presos.length } : {}) };
}

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
      await deliver(target, text);
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

  // Marca antes de gerar (evita duplicar se demorar mais que 1 tick)
  await admin.from('asst_settings').upsert({ key: 'last_brief_date', value: today, updated_at: new Date().toISOString() });

  // Montado aqui, sem modelo (2026-09-23): o resumo pedido ao assistente-brain custava ~US$ 0,18 por
  // dia (8–9 ferramentas relendo o prompt inteiro) para juntar listas que o SQL já entrega prontas.
  let texto: string;
  try {
    texto = await morningBriefText(admin, cfg, today);
  } catch (e) {
    await admin.from('asst_settings').upsert({ key: 'last_brief_date', value: null, updated_at: new Date().toISOString() });
    throw e;
  }
  await deliver(ownerChat, texto);
  await admin.from('asst_messages').insert({ channel: 'cron', chat_id: ownerChat, role: 'assistant', content: texto, topic: 'avisos' });
  return true;
}

// Resumo da manhã: pendências (caixa) → contas a pagar → tarefas → lembretes → tempo. Só o que pede
// atenção; item vazio some. Mesmo conteúdo que o assistente montava, na mesma ordem.
// deno-lint-ignore no-explicit-any
async function morningBriefText(admin: SupabaseClient, cfg: Record<string, any>, today: string): Promise<string> {
  const tenants = await getTenants(admin, cfg);
  const ids = tenants.map((t) => t.id);
  const nome = (id: string) => tenants.find((t) => t.id === id)?.name ?? 'loja';
  const ownerId = String(cfg.owner_user_id ?? '');
  const ddmm = (iso: string) => iso.slice(0, 10).split('-').reverse().slice(0, 2).join('/');
  const ate3 = addDays(today, 3);
  const [pend, contas, tarefas, lembretes] = await Promise.all([
    admin.from('pendencias').select('titulo, urgencia, acao_requerida, snooze_until').in('tenant_id', ids).eq('status', 'aberta'),
    admin.from('fin_accounts_payable').select('tenant_id, supplier, description, amount, due_date')
      .in('tenant_id', ids).in('status', ['pending', 'overdue', 'partial']).lte('due_date', ate3).limit(500),
    ownerId
      ? admin.from('tasks').select('title, due_date').or(`created_by.eq.${ownerId},assignee_id.eq.${ownerId}`)
        .eq('is_archived', false).is('completed_at', null).lte('due_date', `${today}T23:59:59-03:00`).order('due_date').limit(60)
      : Promise.resolve({ data: [] as Array<{ title: string; due_date: string }> }),
    admin.from('asst_reminders').select('text, due_at').is('sent_at', null)
      .gte('due_at', `${today}T00:00:00-03:00`).lte('due_at', `${today}T23:59:59-03:00`).order('due_at').limit(20),
  ]);
  const linhas: string[] = ['Bom dia!'];

  // Pendências: quantas e quais pedem dinheiro/ação urgente, em uma linha — a lista está na caixa.
  const abertas = (pend.data ?? []).filter((p) => !p.snooze_until || Date.parse(String(p.snooze_until)) < Date.now());
  if (abertas.length) {
    const urgentes = abertas.filter((p) => p.urgencia === 'alta');
    const quais = urgentes.slice(0, 3).map((p) => String(p.titulo ?? '').trim()).filter(Boolean).join('; ');
    linhas.push(`*${abertas.length} pendência${abertas.length === 1 ? '' : 's'}* em aberto${urgentes.length ? ` — urgentes: ${quais}${urgentes.length > 3 ? ` e mais ${urgentes.length - 3}` : ''}` : ''}. Lista completa em Pendências.`);
  }

  // Contas: vencendo hoje até +3 dias e atrasadas, por loja.
  const cs = (contas.data ?? []).map((c) => ({ ...c, amount: Number(c.amount ?? 0), due: String(c.due_date ?? '') }));
  const vencendo = cs.filter((c) => c.due >= today);
  const atrasadas = cs.filter((c) => c.due < today);
  const porLoja = (lista: typeof cs) => {
    const m = new Map<string, { n: number; v: number }>();
    for (const c of lista) { const k = String(c.tenant_id); const a = m.get(k) ?? { n: 0, v: 0 }; a.n++; a.v += c.amount; m.set(k, a); }
    return [...m.entries()].map(([k, a]) => `${tenants.length > 1 ? `${nome(k)}: ` : ''}${a.n} conta${a.n === 1 ? '' : 's'} / ${brl(a.v)}`).join(' · ');
  };
  if (vencendo.length || atrasadas.length) {
    const partes: string[] = [];
    if (vencendo.length) {
      const lista = vencendo.sort((a, b) => a.due.localeCompare(b.due)).slice(0, 4)
        .map((c) => `${c.supplier || c.description} ${brl(c.amount)} (${c.due === today ? 'hoje' : ddmm(c.due)})`).join('; ');
      partes.push(`vencendo até ${ddmm(ate3)}: ${lista}${vencendo.length > 4 ? ` e mais ${vencendo.length - 4}` : ''}`);
    }
    if (atrasadas.length) partes.push(`atrasadas: ${porLoja(atrasadas)}`);
    linhas.push(`*Contas a pagar:* ${partes.join('; ')}.`);
  }

  // Tarefas: de hoje (lista) e atrasadas (quantas, desde quando).
  const ts = (tarefas.data ?? []).map((t) => ({ titulo: String(t.title ?? ''), dia: new Date(String(t.due_date)).toLocaleDateString('en-CA', { timeZone: TZ }) }));
  const deHoje = ts.filter((t) => t.dia === today);
  const velhas = ts.filter((t) => t.dia < today);
  if (deHoje.length) linhas.push(`*Tarefas de hoje (${deHoje.length}):* ${deHoje.slice(0, 6).map((t) => t.titulo).join('; ')}${deHoje.length > 6 ? ` e mais ${deHoje.length - 6}` : ''}.`);
  if (velhas.length) linhas.push(`*Atrasadas (${velhas.length}):* ${velhas.slice(0, 3).map((t) => t.titulo).join('; ')}${velhas.length > 3 ? '…' : ''} — a mais antiga de ${ddmm(velhas[0].dia)}.`);

  const lem = lembretes.data ?? [];
  if (lem.length) linhas.push(`*Lembretes de hoje:* ${lem.map((l) => `${new Date(String(l.due_at)).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' })} ${l.text}`).join('; ')}.`);

  const tempo = await tempoDeHoje(admin, cfg, tenants).catch((e) => { log('WARN', 'resumo: previsão do tempo', { error: errMsg(e) }); return null; });
  if (tempo) linhas.push(tempo);

  if (linhas.length === 1) linhas.push('Nada pedindo atenção hoje.');
  return linhas.join('\n\n');
}

// Previsão de hoje para a loja principal (Open-Meteo, grátis), em uma linha, destacando chuva no
// horário de movimento (almoço 11–14h, noite 18–22h).
// deno-lint-ignore no-explicit-any
async function tempoDeHoje(admin: SupabaseClient, cfg: Record<string, any>, tenants: Array<{ id: string; name: string }>): Promise<string | null> {
  const principal = tenants.find((t) => t.id === String(cfg.default_tenant_id ?? '')) ?? tenants[0];
  if (!principal) return null;
  const { data: ss } = await admin.from('system_settings').select('delivery_config, delivery_city').eq('tenant_id', principal.id).maybeSingle();
  // deno-lint-ignore no-explicit-any
  const loc = (ss?.delivery_config as any)?.store_location;
  let lat: number, lng: number, lugar: string;
  if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') { lat = loc.lat; lng = loc.lng; lugar = principal.name; }
  else if (ss?.delivery_city) {
    const g = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(String(ss.delivery_city))}&count=1&language=pt&format=json`, { signal: AbortSignal.timeout(8000) }).then((r) => r.json());
    const r0 = g?.results?.[0];
    if (!r0) return null;
    lat = r0.latitude; lng = r0.longitude; lugar = String(r0.name);
  } else return null;
  const w = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}&timezone=America%2FSao_Paulo&forecast_days=1`
    + '&hourly=precipitation_probability,weather_code&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    { signal: AbortSignal.timeout(8000) }).then((r) => { if (!r.ok) throw new Error(`open-meteo ${r.status}`); return r.json(); });
  const WMO: Record<number, string> = { 0: 'céu limpo', 1: 'quase limpo', 2: 'parcialmente nublado', 3: 'nublado', 45: 'nevoeiro', 48: 'nevoeiro', 51: 'garoa fraca', 53: 'garoa', 55: 'garoa forte', 61: 'chuva fraca', 63: 'chuva', 65: 'chuva forte', 80: 'pancadas fracas', 81: 'pancadas', 82: 'pancadas fortes', 95: 'trovoada', 96: 'trovoada com granizo', 99: 'trovoada forte' };
  const cond = WMO[Number(w?.daily?.weather_code?.[0])] ?? 'tempo variável';
  const min = Math.round(Number(w?.daily?.temperature_2m_min?.[0])), max = Math.round(Number(w?.daily?.temperature_2m_max?.[0]));
  const horas: string[] = w?.hourly?.time ?? [];
  const prob: number[] = w?.hourly?.precipitation_probability ?? [];
  const chuvaEm = (de: number, ate: number) => Math.max(0, ...horas.map((t, i) => ({ h: Number(t.slice(11, 13)), p: Number(prob[i] ?? 0) })).filter((x) => x.h >= de && x.h < ate).map((x) => x.p));
  const almoco = chuvaEm(11, 14), noite = chuvaEm(18, 22);
  const alertas = [almoco >= 50 ? `chuva no almoço (${almoco}%)` : '', noite >= 50 ? `chuva à noite (${noite}%)` : ''].filter(Boolean);
  return `*Tempo em ${lugar}:* ${cond}, ${min}–${max}°C${alertas.length ? ` — ${alertas.join(' e ')}, pode afetar o movimento` : ''}.`;
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
  // Canais de conversa do dono. Era só 'whatsapp' (de quando o WhatsApp era o canal principal),
  // então o aquecimento nunca rodava e o cache de 1 h vencia — a 1ª mensagem depois de uma pausa
  // pagava a remontagem inteira do prefixo (mais lenta e mais cara). Corrigido em 2026-09-16.
  const { data: lastUser } = await admin.from('asst_messages').select('created_at')
    .eq('role', 'user').in('channel', ['whatsapp', 'telegram', 'app']).order('created_at', { ascending: false }).limit(1).maybeSingle();
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

// ── Proatividade determinística (2026-09-12) ──
// Regras em SQL, texto montado aqui, SEM chamar o modelo (custo zero por aviso).
// Configuração em asst_settings.proactive (mesclada com PRO_DEFAULTS); estado de
// "já mandei hoje" em asst_settings.proactive_state. Cada aviso vai para o dono e
// entra em asst_messages (channel 'cron') para o brain saber o que já foi dito.
// deno-lint-ignore no-explicit-any
const PRO_DEFAULTS: Record<string, any> = {
  // Fechamento: o normal é sair QUANDO A LOJA FECHA O CAIXA (gatilho em cash_registers →
  // run 'closing_tenant'), uma mensagem por loja, com o dia já completo (dono, 2026-09-20: às 23:00
  // faltavam os pedidos pagos depois da meia-noite). O horário abaixo é só a rede de segurança:
  // loja que teve movimento no dia e não abriu caixa nenhum.
  closing: { enabled: true, time: '23:00' },
  due_tomorrow: { enabled: true, time: '17:00' },       // contas que vencem amanhã (+ fim de semana na sexta)
  // Contas que vencem HOJE (dono, 2026-09-18): com boleto guardado → pagamento preparado para
  // aprovar na conversa Financeiro; sem boleto → avisa que falta o boleto.
  due_today: { enabled: true, time: '08:00' },
  anomaly: { enabled: true, from: '11:30', to: '22:30', every_min: 30, drop_pct: 30, spike_pct: 50, min_base: 300 },
  stock: { enabled: true, time: '09:00' },              // estoque crítico: só o que MUDOU
  tasks_overdue: { enabled: true, time: '18:00' },      // tarefas vencidas do dono
  // conta a pagar sem classificação DRE → pergunta em texto, UMA por vez (a resposta é
  // gravada pelo webhook, sem modelo, e ele já pede a próxima).
  // every_min era 2 (2026-09-18): com a janela de 13 h isso dava até ~390 disparos por dia,
  // o dia inteiro de metralhadora. Agora a fila mora na caixa de pendências e a pergunta
  // espontânea sai de 2 em 2 horas; QUANDO o dono responde, o webhook chama
  // { run: 'dre_classify' } na hora e as próximas vêm em sequência — engajar puxa a fila,
  // silêncio não é insistido.
  dre_classify: { enabled: true, from: '08:00', to: '21:00', every_min: 120, per_run: 1, max_open: 1 },
  // item de fornecedor sem classificação CMV × despesa. Era um aviso a cada 30 min
  // (até 32 por dia) e nenhum lugar onde a pendência ficasse. Agora o aviso sai UMA vez
  // por dia e quem segura a cobrança é a caixa (regra `pendencias` abaixo).
  item_classify: { enabled: true, time: '09:30' },
  // Sincronização SILENCIOSA da caixa de pendências (2026-09-18). Não manda mensagem
  // nenhuma: só mantém as linhas agregadas em dia. Fica fora das regras de aviso de
  // propósito — desligar um aviso não pode fazer a pendência sumir de vista.
  pendencias: { enabled: true, sync_min: 30 },
};
let pgc: ReturnType<typeof postgres> | null = null;
const db = () => (pgc ??= postgres(Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 1, prepare: false, idle_timeout: 20 }));
const brl = (n: unknown) => Number(n ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const pct = (a: number, b: number) => (b > 0 ? Math.round(((a - b) / b) * 100) : 0);
const dmy = (d: string) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${y}`; };
const addDays = (isoDate: string, n: number) => { const d = new Date(`${isoDate}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const weekday = (isoDate: string) => new Date(`${isoDate}T12:00:00Z`).getUTCDay(); // 0 = domingo
// Janela: dispara entre `time` e `time`+2h (se a VPS estiver fora na hora exata, ainda sai)
function inWindow(time: string, now: string, hours = 2) {
  const [h, m] = String(time).split(':').map(Number);
  const limit = `${String(Math.min(h + hours, 23)).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  return now >= time && now <= limit;
}

// deno-lint-ignore no-explicit-any
async function getTenants(admin: SupabaseClient, cfg: Record<string, any>): Promise<Array<{ id: string; name: string }>> {
  const watched: string[] = Array.isArray(cfg.watched_tenant_ids) ? cfg.watched_tenant_ids.map(String) : [];
  if (watched.length) {
    const { data } = await admin.from('tenants').select('id, name').in('id', watched).order('name');
    return (data ?? []).map((t) => ({ id: String(t.id), name: String(t.name) }));
  }
  const { data } = await admin.from('user_tenants').select('tenant_id, tenants(name)').eq('user_id', String(cfg.owner_user_id ?? ''));
  // deno-lint-ignore no-explicit-any
  return ((data ?? []) as any[]).map((r) => ({ id: String(r.tenant_id), name: String(r.tenants?.name ?? r.tenant_id) }));
}

// ── Fechamento de CAIXA e de SESSÃO (dono, 2026-09-20) ──────────────────────
// Duas mensagens diferentes: o caixa fala de DINHEIRO (gaveta daquele operador) e a sessão fala do
// TURNO inteiro da loja (vendas, canais, pagamentos, itens). Layout em blocos, como os outros avisos.
const hhmm = (ts: unknown) => (ts ? new Date(String(ts)).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '—');
const diaHora = (ts: unknown) => (ts ? `${dmy(new Date(String(ts)).toLocaleDateString('en-CA', { timeZone: TZ })).slice(0, 5)} ${hhmm(ts)}` : '—');
const diffTexto = (d: number) => (Math.abs(d) < 0.01 ? 'bateu certinho ✅' : d > 0 ? `sobrou ${brl(d)} ⚠️` : `faltou ${brl(Math.abs(d))} ⚠️`);

type Aviso = { texto: string; resumo: string; painel: Record<string, unknown> };
async function caixaText(admin: SupabaseClient, cashRegisterId: string): Promise<Aviso | null> {
  const { data: cr } = await admin.from('cash_registers')
    .select('id, tenant_id, session_id, opening_value, closing_value_expected, closing_value_actual, closing_difference, closing_notes, opened_at, closed_at, operator_id')
    .eq('id', cashRegisterId).maybeSingle();
  if (!cr) return null;
  const [{ data: loja }, { data: op }] = await Promise.all([
    admin.from('tenants').select('name').eq('id', cr.tenant_id).maybeSingle(),
    cr.operator_id ? admin.from('users').select('name').eq('id', cr.operator_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const mov = await db()<Array<{ type: string; total: number; n: number; motivos: string | null }>>`
    select type, coalesce(sum(amount),0)::float as total, count(*)::int as n,
           string_agg(distinct nullif(trim(reason), ''), ', ') as motivos
    from cash_movements where cash_register_id = ${cashRegisterId} group by type`;
  const entrada = mov.find((m) => m.type === 'in'), saida = mov.find((m) => m.type === 'out');
  const dif = Number(cr.closing_difference ?? 0);
  const l: string[] = [];
  l.push(`💵 *Caixa fechado — ${String(loja?.name ?? '')}*`);
  l.push(`${op?.name ?? 'Operador'} · ${diaHora(cr.opened_at)} → ${diaHora(cr.closed_at)}`);
  l.push('');
  l.push(`Abertura: ${brl(cr.opening_value)}`);
  if (entrada) l.push(`Entradas: ${brl(entrada.total)} (${entrada.n})${entrada.motivos ? ` — ${entrada.motivos.slice(0, 120)}` : ''}`);
  if (saida) l.push(`Saídas: ${brl(saida.total)} (${saida.n})${saida.motivos ? ` — ${saida.motivos.slice(0, 120)}` : ''}`);
  l.push(`Esperado na gaveta: ${brl(cr.closing_value_expected)}`);
  l.push(`Contado: ${brl(cr.closing_value_actual)}`);
  l.push(`Diferença: ${diffTexto(dif)}`);
  // Conferência que não bateu: a observação do fechamento É a justificativa do operador (dono, 2026-09-24).
  const temDif = Math.abs(dif) >= 0.01;
  const notas = String(cr.closing_notes ?? '').trim();
  const obs = notas ? `${temDif ? 'Justificativa' : 'Obs.'}: ${notas.slice(0, 300)}` : temDif ? 'Justificativa: não preenchida pelo operador' : '';
  if (obs) l.push(obs);
  const painel = {
    t: 'Caixa fechado', s: String(loja?.name ?? ''),
    r: `${op?.name ?? 'Operador'} · ${diaHora(cr.opened_at)} → ${diaHora(cr.closed_at)}`,
    kpi: {
      p: { l: 'Contado na gaveta', v: brl(cr.closing_value_actual) },
      o: [{ l: 'Esperado', v: brl(cr.closing_value_expected) }, { l: 'Diferença', v: Math.abs(dif) < 0.01 ? 'bate' : brl(dif) }],
    },
    lin: [{
      t: 'Movimento do caixa',
      i: [
        { l: 'Abertura', v: brl(cr.opening_value) },
        ...(entrada ? [{ l: `Entradas (${entrada.n})`, v: brl(entrada.total), d: entrada.motivos?.slice(0, 80) ?? undefined, st: 'ok' as const }] : []),
        ...(saida ? [{ l: `Saídas (${saida.n})`, v: brl(saida.total), d: saida.motivos?.slice(0, 80) ?? undefined, st: 'alerta' as const }] : []),
        { l: 'Conferência', v: diffTexto(dif).replace(' ✅', '').replace(' ⚠️', ''), st: (Math.abs(dif) < 0.01 ? 'ok' : 'perigo') as 'ok' | 'perigo' },
      ],
    }],
    ...(obs ? { al: [obs] } : {}),
  };
  return {
    texto: l.join('\n'),
    resumo: `💵 Caixa fechado — ${String(loja?.name ?? '')}: contado ${brl(cr.closing_value_actual)}, ${diffTexto(dif)}${temDif && notas ? ` — ${notas.slice(0, 120)}` : ''}`,
    painel,
  };
}

// ── Aviso do caixa espera a justificativa (dono, 2026-09-24) ─────────────────
// O PDV fecha o caixa ANTES de pedir a justificativa (FechamentoCaixaModal grava depois, por
// fn_update_cash_register_notes). Então: caixa com diferença e sem justificativa não avisa no
// fechamento; avisa quando a justificativa é gravada (gatilho trg_cash_register_justificou) ou, se
// ela não vier, pela rodada periódica depois de CAIXA_ESPERA_MIN, dizendo que ficou sem justificativa.
// "Já avisado" fica numa chave própria de asst_settings — proactive_state é regravado inteiro por
// outras rotinas e apagaria a marca.
const CAIXA_ESPERA_MIN = 10;
const CAIXA_AVISO_DESDE = '2026-09-24T00:53:00Z';
const CHAVE_CAIXA_AVISADO = 'cash_closing_sent';

async function caixasAvisados(admin: SupabaseClient): Promise<Record<string, string>> {
  const { data } = await admin.from('asst_settings').select('value').eq('key', CHAVE_CAIXA_AVISADO).maybeSingle();
  return ((data?.value ?? {}) as Record<string, string>);
}
async function marcarCaixasAvisados(admin: SupabaseClient, ids: string[]) {
  const atual = await caixasAvisados(admin);
  const agora = new Date().toISOString();
  const limite = Date.now() - 7 * 86_400_000; // guarda uma semana
  const novo = Object.fromEntries(Object.entries({ ...atual, ...Object.fromEntries(ids.map((id) => [id, agora])) })
    .filter(([, quando]) => Date.parse(quando) >= limite));
  await admin.from('asst_settings').upsert({ key: CHAVE_CAIXA_AVISADO, value: novo, updated_at: agora });
}

/** Manda o aviso de um caixa fechado. `semEsperar` = rodada periódica (manda mesmo sem justificativa). */
async function avisarCaixa(admin: SupabaseClient, ownerChat: string | null, id: string, semEsperar: boolean): Promise<Record<string, unknown>> {
  if ((await caixasAvisados(admin))[id]) return { ok: true, skipped: 'já avisado' };
  if (!semEsperar) {
    const { data: cr } = await admin.from('cash_registers').select('closing_difference, closing_notes').eq('id', id).maybeSingle();
    if (cr && Math.abs(Number(cr.closing_difference ?? 0)) >= 0.01 && !String(cr.closing_notes ?? '').trim()) {
      return { ok: true, skipped: 'aguardando justificativa' };
    }
  }
  const aviso = await caixaText(admin, id);
  if (!aviso) return { ok: true, skipped: 'sem conteúdo' };
  if (!ownerChat) return { ok: true, skipped: 'sem canal do dono' };
  await marcarCaixasAvisados(admin, [id]); // antes de mandar: dois gatilhos quase juntos não duplicam
  await (isTg(ownerChat) ? sendTelegram(ownerChat, aviso.texto) : sendText(toNumber(ownerChat), aviso.texto));
  await admin.from('asst_messages').insert({
    channel: 'cron', chat_id: ownerChat, role: 'assistant', topic: 'pagamentos',
    content: `${aviso.resumo}\n[painel]${JSON.stringify(aviso.painel)}[/painel]`,
  });
  return { ok: true, sent: true };
}

/** Rodada periódica: caixas fechados com diferença cuja justificativa não veio em CAIXA_ESPERA_MIN. */
async function caixasSemJustificativa(admin: SupabaseClient, tenants: Array<{ id: string }>, ownerChat: string | null, dry: boolean) {
  const { data } = await admin.from('cash_registers').select('id, closing_difference, closing_notes')
    .in('tenant_id', tenants.map((t) => t.id)).eq('status', 'closed')
    // Fechou antes desta regra existir = já recebeu o aviso na hora do fechamento.
    .gte('closed_at', new Date(Math.max(Date.now() - 86_400_000, Date.parse(CAIXA_AVISO_DESDE))).toISOString())
    .lte('closed_at', new Date(Date.now() - CAIXA_ESPERA_MIN * 60_000).toISOString());
  const pendentes = ((data ?? []) as Array<{ id: string; closing_difference: number | null; closing_notes: string | null }>)
    .filter((c) => Math.abs(Number(c.closing_difference ?? 0)) >= 0.01 && !String(c.closing_notes ?? '').trim());
  if (!pendentes.length) return 'nenhum';
  const avisados = await caixasAvisados(admin);
  const faltam = pendentes.filter((c) => !avisados[c.id]);
  if (dry) return faltam.length ? `${faltam.length} caixa(s) sem justificativa para avisar` : 'nenhum';
  for (const c of faltam) await avisarCaixa(admin, ownerChat, c.id, true);
  return faltam.length;
}

async function sessaoText(admin: SupabaseClient, sessionId: string): Promise<Aviso | null> {
  const { data: s } = await admin.from('sessions')
    .select('id, tenant_id, number, opened_at, closed_at, is_training').eq('id', sessionId).maybeSingle();
  if (!s || s.is_training) return null;
  const { data: loja } = await admin.from('tenants').select('name').eq('id', s.tenant_id).maybeSingle();
  const dia = new Date(String(s.opened_at)).toLocaleDateString('en-CA', { timeZone: TZ });
  const lwDay = addDays(dia, -7);
  const [{ data: rep }, { data: lw }, { data: caixas }] = await Promise.all([
    admin.rpc('fn_get_sales_report', { p_tenant_id: s.tenant_id, p_date_from: `${dia}T00:00:00-03:00`, p_date_to: `${addDays(dia, 1)}T00:00:00-03:00`, p_session_id: sessionId }),
    admin.rpc('fn_get_sales_report', { p_tenant_id: s.tenant_id, p_date_from: `${lwDay}T00:00:00-03:00`, p_date_to: `${addDays(lwDay, 1)}T00:00:00-03:00`, p_session_id: null }),
    admin.from('cash_registers').select('closing_difference').eq('session_id', sessionId),
  ]);
  // deno-lint-ignore no-explicit-any
  const r = (rep ?? {}) as any, prev = (lw ?? {}) as any;
  const rev = Number(r.total_revenue ?? 0), n = Number(r.total_orders ?? 0);
  const extra = await db()<[{ cancelados: number; cancelados_valor: number; descontos: number }]>`
    select
      (select count(*)::int from orders where session_id = ${sessionId} and not is_training and status = 'cancelled') as cancelados,
      (select coalesce(sum(total_amount),0)::float from orders where session_id = ${sessionId} and not is_training and status = 'cancelled') as cancelados_valor,
      (select coalesce(sum(discount_amount),0)::float from orders where session_id = ${sessionId} and not is_training and status <> 'cancelled') as descontos`;
  const x = extra[0];
  if (!n && !x.cancelados) return null; // turno sem venda: não enche o chat
  const lwRev = Number(prev.total_revenue ?? 0);
  const CANAL_NOME: Record<string, string> = { delivery: 'Delivery', table: 'Mesa', qr_universal: 'QR Code', cashier: 'Caixa', immediate: 'Balcão', name: 'Senha', password: 'Senha', self_service: 'Autoatendimento', waiter: 'Garçom' };
  const l: string[] = [];
  l.push(`🌙 *Fechamento do turno — ${String(loja?.name ?? '')}*`);
  l.push(`${s.number ? `Sessão #${s.number} · ` : ''}${diaHora(s.opened_at)} → ${diaHora(s.closed_at)}`);
  l.push('');
  l.push(`*${brl(rev)}* em ${n} pedido${n === 1 ? '' : 's'} · ticket ${brl(r.avg_ticket)}`);
  if (lwRev > 0) l.push(`${pct(rev, lwRev) >= 0 ? '📈 +' : '📉 '}${pct(rev, lwRev)}% vs ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][weekday(lwDay)]} passada (${brl(lwRev)})`);
  // deno-lint-ignore no-explicit-any
  const canais = (Array.isArray(r.by_destination) ? r.by_destination : []).sort((a: any, b: any) => Number(b.revenue) - Number(a.revenue));
  if (canais.length) {
    l.push('');
    l.push('*Por canal*');
    // deno-lint-ignore no-explicit-any
    for (const c of canais as any[]) l.push(`· ${CANAL_NOME[String(c.destination)] ?? c.destination}: ${brl(c.revenue)} (${Number(c.orders)})`);
  }
  // deno-lint-ignore no-explicit-any
  const pagos = (Array.isArray(r.by_payment) ? r.by_payment : []).sort((a: any, b: any) => Number(b.total) - Number(a.total));
  if (pagos.length) {
    l.push('');
    l.push('*Pagamentos*');
    // deno-lint-ignore no-explicit-any
    for (const p of pagos as any[]) l.push(`· ${p.payment_method}: ${brl(p.total)}`);
  }
  const somaItens = new Map<string, number>();
  // deno-lint-ignore no-explicit-any
  for (const i of (Array.isArray(r.top_items) ? r.top_items : []) as any[]) {
    const nome = String(i.item_name ?? '').replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();
    somaItens.set(nome, (somaItens.get(nome) ?? 0) + Number(i.total_qty ?? 0));
  }
  const top = [...somaItens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (top.length) {
    l.push('');
    l.push('*Mais vendidos*');
    top.forEach(([nome, qtd], i) => l.push(`${i + 1}. ${nome} — ${qtd}`));
  }
  const difs = (caixas ?? []) as Array<{ closing_difference: number | null }>;
  const somaDif = difs.reduce((a, c) => a + Number(c.closing_difference ?? 0), 0);
  if (difs.length) { l.push(''); l.push(`*Caixas*: ${difs.length} · dinheiro ${diffTexto(somaDif)}`); }
  const alertas: string[] = [];
  if (x.cancelados) alertas.push(`${x.cancelados} cancelado(s) (${brl(x.cancelados_valor)})`);
  if (x.descontos > 0) alertas.push(`descontos ${brl(x.descontos)}`);
  if (alertas.length) { l.push(''); l.push(`⚠️ ${alertas.join(' · ')}`); }
  const painel = {
    t: 'Fechamento do turno', s: String(loja?.name ?? ''),
    r: `${s.number ? `Sessão #${s.number} · ` : ''}${diaHora(s.opened_at)} → ${diaHora(s.closed_at)}`,
    kpi: {
      p: { l: 'Faturamento', v: brl(rev), ...(lwRev > 0 ? { var: { a: rev, b: lwRev, r: `vs ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][weekday(lwDay)]} passada` } } : {}) },
      o: [{ l: 'Pedidos', v: String(n) }, { l: 'Ticket médio', v: brl(r.avg_ticket) }],
    },
    b: [
      // deno-lint-ignore no-explicit-any
      ...(pagos.length ? [{ t: 'Por forma de pagamento', i: (pagos as any[]).map((p) => ({ l: String(p.payment_method), v: Number(p.total) })) }] : []),
      // deno-lint-ignore no-explicit-any
      ...(canais.length ? [{ t: 'Por canal', c: 'bg-sky-500', i: (canais as any[]).map((c) => ({ l: CANAL_NOME[String(c.destination)] ?? String(c.destination), v: Number(c.revenue), d: `${Number(c.orders)} pedido${Number(c.orders) === 1 ? '' : 's'}` })) }] : []),
    ],
    ...(top.length ? { rk: { t: 'Mais vendidos', i: top.map(([nome, qtd]) => ({ n: nome, q: qtd })) } } : {}),
    ...(difs.length ? { lin: [{ t: 'Caixas', i: [{ l: `${difs.length} caixa${difs.length === 1 ? '' : 's'} do turno`, v: diffTexto(somaDif).replace(' ✅', '').replace(' ⚠️', ''), st: (Math.abs(somaDif) < 0.01 ? 'ok' : 'perigo') as 'ok' | 'perigo' }] }] } : {}),
    ...(alertas.length ? { al: alertas } : {}),
  };
  return {
    texto: l.join('\n'),
    resumo: `🌙 Fechamento do turno — ${String(loja?.name ?? '')}: ${brl(rev)} em ${n} pedido${n === 1 ? '' : 's'}`,
    painel,
  };
}

// Fechamento do dia: números da mesma conta das telas (fn_get_sales_report) + cancelados,
// descontos e quebra de caixa; compara com o mesmo dia da semana passada.
async function closingText(admin: SupabaseClient, tenants: Array<{ id: string; name: string }>, day: string): Promise<string | null> {
  const from = `${day}T00:00:00-03:00`, to = `${addDays(day, 1)}T00:00:00-03:00`;
  const lwDay = addDays(day, -7);
  const parts: string[] = [];
  let anyMovement = false;
  for (const t of tenants) {
    const [{ data: rep }, { data: lw }] = await Promise.all([
      admin.rpc('fn_get_sales_report', { p_tenant_id: t.id, p_date_from: from, p_date_to: to, p_session_id: null }),
      // Só o MESMO DIA da semana passada. Estava indo até o dia de hoje, ou seja, a SEMANA INTEIRA:
      // 19/09 (R$ 749,30) aparecia como -67% "vs sáb passada (R$ 2.292,00)" — o sábado sozinho tinha
      // sido bem menos (dono, 2026-09-20).
      admin.rpc('fn_get_sales_report', { p_tenant_id: t.id, p_date_from: `${lwDay}T00:00:00-03:00`, p_date_to: `${addDays(lwDay, 1)}T00:00:00-03:00`, p_session_id: null }),
    ]);
    // deno-lint-ignore no-explicit-any
    const r = (rep ?? {}) as any, l = (lw ?? {}) as any;
    const rev = Number(r.total_revenue ?? 0), n = Number(r.total_orders ?? 0);
    const extra = await db()<[{ cancelados: number; cancelados_valor: number; descontos: number; quebra: number | null; caixas_abertos: number }]>`
      select
        (select count(*)::int from orders where tenant_id = ${t.id} and is_training = false and status = 'cancelled' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz) as cancelados,
        (select coalesce(sum(total_amount),0)::float from orders where tenant_id = ${t.id} and is_training = false and status = 'cancelled' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz) as cancelados_valor,
        (select coalesce(sum(discount_amount),0)::float from orders where tenant_id = ${t.id} and is_training = false and status <> 'cancelled' and created_at >= ${from}::timestamptz and created_at < ${to}::timestamptz) as descontos,
        (select sum(closing_difference)::float from cash_registers where tenant_id = ${t.id} and closed_at >= ${from}::timestamptz and closed_at < ${to}::timestamptz) as quebra,
        (select count(*)::int from cash_registers where tenant_id = ${t.id} and status <> 'closed' and opened_at >= ${from}::timestamptz and opened_at < ${to}::timestamptz) as caixas_abertos`;
    const x = extra[0];
    if (!n && !x.cancelados) { parts.push(`*${t.name}*: sem movimento hoje.`); continue; }
    anyMovement = true;
    const lines = [`*${t.name}*`];
    const lwRev = Number(l.total_revenue ?? 0);
    lines.push(`Faturamento ${brl(rev)} em ${n} pedidos (ticket ${brl(r.avg_ticket)})${lwRev > 0 ? ` — ${pct(rev, lwRev) >= 0 ? '+' : ''}${pct(rev, lwRev)}% vs ${['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][weekday(lwDay)]} passada (${brl(lwRev)})` : ''}`);
    // deno-lint-ignore no-explicit-any
    const dest = (Array.isArray(r.by_destination) ? r.by_destination : []).map((d: any) => `${{ delivery: 'delivery', table: 'mesa', cashier: 'balcão', immediate: 'balcão', name: 'senha', password: 'senha' }[String(d.destination)] ?? d.destination} ${brl(d.revenue)}`);
    if (dest.length) lines.push(`Por canal: ${dest.join(' · ')}`);
    // deno-lint-ignore no-explicit-any
    const pay = (Array.isArray(r.by_payment) ? r.by_payment : []).sort((a: any, b: any) => Number(b.total) - Number(a.total)).slice(0, 4).map((p: any) => `${p.payment_method} ${brl(p.total)}`);
    if (pay.length) lines.push(`Pagamentos: ${pay.join(' · ')}`);
    // deno-lint-ignore no-explicit-any
    // Junta as unidades do KDS (" (Un. N)") como a aba Produtos e a ação rápida Vendas do dia, senão o
    // mesmo lanche aparece duas vezes com quantidades diferentes (dono, 2026-09-20).
    const somaItens = new Map<string, number>();
    // deno-lint-ignore no-explicit-any
    for (const i of (Array.isArray(r.top_items) ? r.top_items : []) as any[]) {
      const nome = String(i.item_name ?? '').replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();
      somaItens.set(nome, (somaItens.get(nome) ?? 0) + Number(i.total_qty ?? 0));
    }
    const top = [...somaItens.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([nome, qtd]) => `${nome} (${qtd})`);
    if (top.length) lines.push(`Mais vendidos: ${top.join(', ')}`);
    const alerts: string[] = [];
    if (x.cancelados) alerts.push(`${x.cancelados} cancelado(s) (${brl(x.cancelados_valor)})`);
    if (x.descontos > 0) alerts.push(`descontos ${brl(x.descontos)}${rev > 0 ? ` (${Math.round((x.descontos / (rev + x.descontos)) * 100)}%)` : ''}`);
    if (x.quebra != null && Math.abs(x.quebra) >= 1) alerts.push(`quebra de caixa ${x.quebra < 0 ? '-' : '+'}${brl(Math.abs(x.quebra))}`);
    if (x.caixas_abertos) alerts.push(`${x.caixas_abertos} caixa(s) ainda aberto(s)`);
    if (alerts.length) lines.push(`⚠️ ${alerts.join('; ')}`);
    parts.push(lines.join('\n'));
  }
  if (!anyMovement) return null; // dia fechado nas lojas: não manda nada
  return `🌙 *Fechamento de ${dmy(day)}*\n\n${parts.join('\n\n')}`;
}

// Anomalia: venda de hoje até agora × média do mesmo dia da semana nas últimas 4
// semanas até o mesmo horário. Avisa uma vez por loja por dia (queda ou pico).
// deno-lint-ignore no-explicit-any
async function anomalyTexts(tenants: Array<{ id: string; name: string }>, pro: any, state: any, today: string): Promise<Array<{ tenant: string; text: string }>> {
  const out: Array<{ tenant: string; text: string }> = [];
  for (const t of tenants) {
    if (state.anomaly?.[t.id] === today) continue;
    const rows = await db()<[{ hoje: number; base: number; semanas: number }]>`
      with hoje as (
        select coalesce(sum(total_amount),0)::float v from orders
        where tenant_id = ${t.id} and is_training = false and status <> 'cancelled'
          and created_at >= (date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo' and created_at <= now()),
      sem as (
        select w, coalesce(sum(o.total_amount),0)::float v from generate_series(1,4) w
        left join orders o on o.tenant_id = ${t.id} and o.is_training = false and o.status <> 'cancelled'
          and o.created_at >= ((date_trunc('day', now() at time zone 'America/Sao_Paulo')) at time zone 'America/Sao_Paulo') - (w || ' week')::interval
          and o.created_at <= now() - (w || ' week')::interval
        group by w)
      select (select v from hoje) as hoje, (select avg(v) from sem where v > 0)::float as base, (select count(*)::int from sem where v > 0) as semanas`;
    const { hoje, base, semanas } = rows[0];
    if (!base || semanas < 2 || base < Number(pro.min_base)) continue; // sem histórico suficiente
    const d = pct(hoje, base);
    const hhmm = localHHMM();
    if (d <= -Number(pro.drop_pct)) out.push({ tenant: t.id, text: `📉 *${t.name}*: até ${hhmm} vendeu ${brl(hoje)}, ${Math.abs(d)}% abaixo da média das últimas ${semanas} semanas neste dia (${brl(base)} até esta hora). Vale olhar.` });
    else if (d >= Number(pro.spike_pct)) out.push({ tenant: t.id, text: `📈 *${t.name}*: até ${hhmm} já vendeu ${brl(hoje)}, ${d}% acima da média das últimas ${semanas} semanas neste dia (${brl(base)}).` });
  }
  return out;
}

// Contas que vencem HOJE: prepara o pagamento das que têm boleto guardado (fin_accounts_payable.
// boleto_*, gravado pelo brain › guardar_boleto) e lista as que não têm. Não prepara de novo se a
// conta já tem pagamento em aberto ou pago. Pagamento só sai com o PIN e a aprovação no app do Inter.
async function dueTodayRun(tenants: Array<{ id: string; name: string }>, today: string, tgChat: string, ownerId: string) {
  const ids = tenants.map((t) => t.id);
  // Guia com Pix copia e cola (FGTS Digital, 2026-09-18) entra junto: boleto_pix_copia.
  const contas = await db()<Array<{ id: string; tenant_id: string; nome: string; aberto: number; parcial: boolean; linha: string | null; copia: string | null }>>`
    select a.id, a.tenant_id, case when a.boleto_origem = 'guia' then a.description else coalesce(nullif(a.supplier, ''), a.description) end nome,
           (a.amount - coalesce(a.paid_amount, 0))::float aberto, coalesce(a.paid_amount, 0) > 0 parcial,
           coalesce(a.boleto_digitavel, a.boleto_barcode) linha, a.boleto_pix_copia copia
      from fin_accounts_payable a
     where a.tenant_id = any(${ids}::uuid[]) and a.status not in ('paid', 'cancelled') and a.due_date = ${today}::date
       and not exists (select 1 from fin_inter_payments p where p.bill_id = a.id and p.replaced_by is null
                        and p.status not in ('cancelled', 'expired', 'failed', 'rejected'))
     order by a.amount desc`;
  if (!contas.length) return null;
  const byT = new Map(tenants.map((t) => [t.id, t.name]));
  const loja = (id: string) => (tenants.length > 1 ? ` · ${byT.get(id) ?? ''}` : '');
  const pagamentos: string[] = [];
  const comBoleto: string[] = [];
  const semBoleto: string[] = [];
  for (const c of contas) {
    if (!c.linha && !c.copia) { semBoleto.push(`• ${c.nome} — ${brl(c.aberto)}${loja(c.tenant_id)}`); continue; }
    // Já teve pagamento parcial: o boleto cobraria o valor cheio. Não prepara sozinho — confira.
    if (c.parcial) { semBoleto.push(`• ${c.nome} — ${brl(c.aberto)} em aberto${loja(c.tenant_id)} (já tem pagamento parcial: o boleto cobra o valor cheio, confira antes)`); continue; }
    try {
      const r = await fetch(`${supabaseUrl}/functions/v1/inter-bank`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': Deno.env.get('FISCAL_INTERNAL_KEY') ?? '' },
        body: JSON.stringify({ action: 'prepare_payment', tenant_id: c.tenant_id, tipo: c.linha ? 'boleto' : 'pix', linha: c.linha ?? undefined,
          copia_e_cola: c.linha ? undefined : c.copia, valor: c.linha ? undefined : c.aberto, bill_id: c.id,
          descricao: c.nome, requested_by: ownerId || undefined, channel: 'telegram', chat_id: tgChat }),
      });
      const out = await r.json().catch(() => ({}));
      if (!r.ok || !out?.payment?.id) throw new Error(String(out?.error ?? r.status));
      pagamentos.push(String(out.payment.id));
      comBoleto.push(`• ${c.nome} — ${brl(c.aberto)}${loja(c.tenant_id)}`);
    } catch (e) {
      semBoleto.push(`• ${c.nome} — ${brl(c.aberto)}${loja(c.tenant_id)} (boleto guardado, mas não consegui preparar: ${errMsg(e).slice(0, 80)})`);
    }
  }
  const total = contas.reduce((a, b) => a + Number(b.aberto), 0);
  const lines = [`💸 *Vencem hoje (${dmy(today)})*: ${contas.length} conta(s), ${brl(total)}`];
  if (comBoleto.length) lines.push('', '✅ *Com boleto* — pagamento preparado, é só tocar em Pagar:', ...comBoleto);
  if (semBoleto.length) lines.push('', '⚠️ *Sem boleto* — mande o boleto no WhatsApp do assistente ou pague por fora:', ...semBoleto);
  return { text: lines.join('\n'), pagamentos };
}

// Contas que vencem amanhã (na sexta: sáb+dom+seg), atrasadas e saldo sincronizado dos bancos.
async function dueTomorrowText(tenants: Array<{ id: string; name: string }>, today: string): Promise<string | null> {
  const ids = tenants.map((t) => t.id);
  const wd = weekday(today);
  const from = addDays(today, 1), to = addDays(today, wd === 5 ? 3 : 1);
  const [due, overdue, banks] = await Promise.all([
    db()<Array<{ tenant_id: string; supplier: string | null; description: string; amount: number; due_date: string }>>`
      select tenant_id, supplier, description, amount::float, due_date::text from fin_accounts_payable
      where tenant_id = any(${ids}::uuid[]) and status <> 'paid' and due_date between ${from}::date and ${to}::date
      order by due_date, amount desc limit 20`,
    db()<[{ n: number; total: number }]>`
      select count(*)::int n, coalesce(sum(amount - coalesce(paid_amount,0)),0)::float total from fin_accounts_payable
      where tenant_id = any(${ids}::uuid[]) and status <> 'paid' and due_date < ${today}::date`,
    db()<Array<{ name: string; bank_name: string | null; synced_balance: number; synced_balance_at: string }>>`
      select name, bank_name, synced_balance::float, synced_balance_at::text from fin_bank_accounts
      where tenant_id = any(${ids}::uuid[]) and is_active and synced_balance is not null order by synced_balance desc`,
  ]);
  if (!due.length && !overdue[0].n) return null;
  const byT = new Map(tenants.map((t) => [t.id, t.name]));
  const total = due.reduce((a, b) => a + Number(b.amount), 0);
  const lines = [`💸 *Vencimentos ${from === to ? `de amanhã (${dmy(from)})` : `de ${dmy(from)} a ${dmy(to)}`}*: ${due.length} conta(s), ${brl(total)}`];
  for (const d of due.slice(0, 12)) lines.push(`• ${d.supplier || d.description} — ${brl(d.amount)}${from !== to ? ` (${dmy(d.due_date).slice(0, 5)})` : ''}${tenants.length > 1 ? ` · ${byT.get(d.tenant_id) ?? ''}` : ''}`);
  if (due.length > 12) lines.push(`… e mais ${due.length - 12}`);
  if (overdue[0].n) lines.push(`⚠️ Atrasadas: ${overdue[0].n} (${brl(overdue[0].total)})`);
  if (banks.length) lines.push(`Saldo: ${banks.map((b) => `${b.bank_name || b.name} ${brl(b.synced_balance)}`).join(' · ')}`);
  return lines.join('\n');
}

// Estoque crítico: manda só os itens que ENTRARAM em crítico desde o último aviso
// (e quantos saíram). Estado por loja: lista de ids já avisados.
// deno-lint-ignore no-explicit-any
async function stockText(tenants: Array<{ id: string; name: string }>, state: any): Promise<{ text: string | null; newState: Record<string, string[]> }> {
  const prev: Record<string, string[]> = state.stock ?? {};
  const next: Record<string, string[]> = {};
  const parts: string[] = [];
  for (const t of tenants) {
    const rows = await db()<Array<{ id: string; name: string; current_stock: number; min_stock: number; unit: string }>>`
      select id::text, name, current_stock::float, min_stock::float, unit::text from ingredients
      where tenant_id = ${t.id} and deleted_at is null and min_stock > 0 and current_stock <= min_stock order by name`;
    next[t.id] = rows.map((r) => r.id);
    const before = new Set(prev[t.id] ?? []);
    const novos = rows.filter((r) => !before.has(r.id));
    const resolvidos = (prev[t.id] ?? []).filter((id) => !next[t.id].includes(id)).length;
    if (!novos.length && !resolvidos) continue;
    const l = [`*${t.name}*`];
    if (novos.length) l.push(...novos.slice(0, 15).map((r) => `• ${r.name}: ${r.current_stock} ${r.unit} (mín. ${r.min_stock})`));
    if (novos.length > 15) l.push(`… e mais ${novos.length - 15}`);
    if (resolvidos) l.push(`✔️ ${resolvidos} item(ns) saíram do crítico`);
    if (rows.length) l.push(`Total em crítico agora: ${rows.length}`);
    parts.push(l.join('\n'));
  }
  return { text: parts.length ? `📦 *Estoque crítico — o que mudou*\n\n${parts.join('\n\n')}` : null, newState: next };
}

async function tasksOverdueText(ownerId: string): Promise<string | null> {
  const rows = await db()<Array<{ title: string; due_date: string; list: string | null }>>`
    select t.title, to_char(t.due_date at time zone 'America/Sao_Paulo', 'DD/MM') due_date, l.name as list
    from tasks t left join task_lists l on l.id = t.list_id
    where (t.created_by = ${ownerId} or t.assignee_id = ${ownerId}) and t.completed_at is null and t.is_archived = false and t.due_date < now()
    order by t.due_date limit 12`;
  if (!rows.length) return null;
  return `📋 *Tarefas vencidas (${rows.length}${rows.length === 12 ? '+' : ''})*\n${rows.map((r) => `• ${r.title} (${r.due_date}${r.list ? `, ${r.list}` : ''})`).join('\n')}\nMe diga "concluí X" ou "adia X pra sexta" que eu ajusto.`;
}

// ── Caixa de pendências (2026-09-18) ────────────────────────────────────────
// Ver supabase/migrations/20260918120000_pendencias.sql. Estas duas são pendências
// AGREGADAS: uma linha por loja com a contagem ("47 itens sem classificação"), e não uma
// por item — 47 cartões na caixa seriam o mesmo barulho com outra roupa. Por isso o ref é
// fixo e o upsert vai com p_reabrir: a linha fecha quando a conta zera e volta quando
// aparece item novo. Descartada, não volta: ali o dono já disse que não quer ser cobrado.
//
// É isto que conserta o vazamento antigo: a marca d'água do aviso andava no ENVIO, então
// item não classificado nunca mais era cobrado. Agora quem garante a cobrança é a caixa, e
// a marca d'água volta a ser só o que ela diz ser — "o que chegou desde o último aviso".
async function syncPendenciasClassificacao(admin: SupabaseClient, tenants: Array<{ id: string; name: string }>) {
  for (const t of tenants) {
    try {
      const [itens] = await db()<Array<{ n: number }>>`
        select count(*)::int n from fin_item_classifications where tenant_id = ${t.id} and classe is null`;
      if (itens.n > 0) {
        await admin.rpc('fn_pendencia_upsert', {
          p_tenant: t.id, p_kind: 'item_sem_classe', p_ref: 'pendentes',
          p_titulo: `${itens.n} ${itens.n === 1 ? 'item sem classificação' : 'itens sem classificação'} (CMV × despesa)`,
          p_detalhe: 'Enquanto não forem classificados, entram no CMV e a DRE sai errada.',
          p_payload: { total: itens.n }, p_rota: '/financeiro?tab=itens',
          p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'cron', p_reabrir: true,
        });
      } else {
        await admin.rpc('fn_pendencia_resolver_ref', {
          p_tenant: t.id, p_kind: 'item_sem_classe', p_ref: 'pendentes', p_motivo: 'tudo classificado',
        });
      }

      // Mesmo filtro do dreClassify, menos a exclusão por asst_polls: a caixa mostra tudo
      // que falta classificar, não só o que ainda não foi perguntado no Telegram.
      const [contas] = await db()<Array<{ n: number }>>`
        select count(*)::int n from fin_accounts_payable a
         where a.tenant_id = ${t.id} and a.dre_category_id is null and a.status <> 'cancelled'
           and coalesce(a.reference_type, '') not in ('purchase', 'hr_payroll')`;
      if (contas.n > 0) {
        await admin.rpc('fn_pendencia_upsert', {
          p_tenant: t.id, p_kind: 'conta_sem_dre', p_ref: 'pendentes',
          p_titulo: `${contas.n} ${contas.n === 1 ? 'conta sem categoria' : 'contas sem categoria'} na DRE`,
          p_detalhe: 'Conta sem categoria não recebe baixa pelo assistente e fica de fora da DRE.',
          p_payload: { total: contas.n }, p_rota: '/financeiro?tab=pagar',
          p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'cron', p_reabrir: true,
        });
      } else {
        await admin.rpc('fn_pendencia_resolver_ref', {
          p_tenant: t.id, p_kind: 'conta_sem_dre', p_ref: 'pendentes', p_motivo: 'tudo classificado',
        });
      }
    } catch (e) {
      log('WARN', 'sincronizar pendências de classificação', { loja: t.name, error: errMsg(e) });
    }
  }
}

// Estoque crítico e tarefas vencidas também viram linha na caixa (2026-09-18) — não porque
// os avisos estavam errados, mas porque a caixa só serve se for O lugar de olhar. Se metade
// do que espera o dono estivesse aqui e a outra metade espalhada em mensagens, ele teria de
// conferir dois lugares e voltaria a confiar na memória.
//
// Ambas são AGREGADAS e com acao_requerida = true, ou seja, sem o botão "Ciente". É de
// propósito: um alerta recorrente silenciado para sempre por um toque é o mesmo buraco de
// antes com outro nome. Elas fecham sozinhas quando a condição passa, e quem quiser calar
// de vez usa "Não vou fazer", que grava o motivo.
async function syncPendenciasOperacao(admin: SupabaseClient, tenants: Array<{ id: string; name: string }>, ownerId: string) {
  for (const t of tenants) {
    try {
      // Mesmo critério do aviso de estoque: abaixo ou igual ao mínimo, ignorando excluídos.
      const [est] = await db()<Array<{ n: number }>>`
        select count(*)::int n from ingredients
         where tenant_id = ${t.id} and deleted_at is null and min_stock > 0 and current_stock <= min_stock`;
      if (est.n > 0) {
        // Aviso, não tarefa (dono, 2026-09-18): botões Abrir e OK. OK marca "vista" e tira da lista;
        // se MAIS insumos ficarem críticos depois disso, o aviso volta (compara com a contagem do
        // tick anterior, guardada em payload.total). Normalizou → fecha; voltou → reabre.
        const { data: antes } = await admin.from('pendencias').select('id, status, payload')
          .eq('tenant_id', t.id).eq('kind', 'estoque_critico').eq('ref', 'pendentes').maybeSingle();
        await admin.rpc('fn_pendencia_upsert', {
          p_tenant: t.id, p_kind: 'estoque_critico', p_ref: 'pendentes',
          p_titulo: `${est.n} ${est.n === 1 ? 'insumo' : 'insumos'} no estoque crítico`,
          p_detalhe: 'Estão no mínimo ou abaixo dele.',
          p_payload: { total: est.n }, p_rota: '/estoque',
          p_urgencia: 'normal', p_acao_requerida: false, p_origem: 'cron', p_reabrir: true,
        });
        if (antes?.status === 'vista' && est.n > Number(antes.payload?.total ?? 0)) {
          await admin.from('pendencias').update({ status: 'aberta', vista_em: null }).eq('id', antes.id).eq('status', 'vista');
        }
      } else {
        await admin.rpc('fn_pendencia_resolver_ref', {
          p_tenant: t.id, p_kind: 'estoque_critico', p_ref: 'pendentes', p_motivo: 'estoque normalizado',
        });
      }

      // Contas atrasadas (dono, 2026-09-18): uma pendência por loja, com quantas e quanto. Fecha
      // sozinha quando todas forem pagas; volta quando outra atrasar. "Hoje" é o de Brasília.
      const [atr] = await db()<Array<{ n: number; total: number }>>`
        select count(*)::int n, coalesce(sum(amount - coalesce(paid_amount, 0)), 0)::float total
          from fin_accounts_payable
         where tenant_id = ${t.id} and status not in ('paid', 'cancelled')
           and due_date < (now() at time zone 'America/Sao_Paulo')::date`;
      if (atr.n > 0) {
        await admin.rpc('fn_pendencia_upsert', {
          p_tenant: t.id, p_kind: 'conta_atrasada', p_ref: 'pendentes',
          p_titulo: `${atr.n} ${atr.n === 1 ? 'conta atrasada' : 'contas atrasadas'} — ${brl(atr.total)}`,
          p_detalhe: 'Venceram e não foram pagas (ou a baixa não foi dada).',
          p_payload: { total: atr.n, valor: atr.total }, p_rota: '/financeiro?tab=pagar',
          p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'cron', p_reabrir: true,
        });
      } else {
        await admin.rpc('fn_pendencia_resolver_ref', {
          p_tenant: t.id, p_kind: 'conta_atrasada', p_ref: 'pendentes', p_motivo: 'nenhuma conta atrasada',
        });
      }

      // Nota de entrada que chegou da SEFAZ com boleto e ainda não foi lançada (2026-09-21).
      // Sem isto ela é invisível: não tem linha em fin_accounts_payable, então não cai em
      // 'conta_atrasada' nem em lugar nenhum — o fornecedor cobra e o sistema nunca avisou.
      // Caso real do dia: 18 parcelas vencidas na Vila Leste, R$ 8.236,50, a mais velha de
      // 20/06. Só entram as que já venceram ou vencem em até 3 dias: nota recente com boleto
      // para o mês que vem é rotina de conferência, não pendência.
      const [notas] = await db()<Array<{ n: number; total: number; venc: string | null }>>`
        with p as (
          select d.id, (x->>'vencimento')::date venc, (x->>'valor')::numeric valor
            from fiscal_inbound_documents d,
                 lateral jsonb_array_elements(coalesce(d.parcelas, '[]'::jsonb)) x
           where d.tenant_id = ${t.id} and d.status = 'new'
             and d.sefaz_status is distinct from 2
             and (x->>'vencimento') ~ '^\\d{4}-\\d{2}-\\d{2}$'
             and (x->>'valor')::numeric > 0
        )
        select count(distinct id)::int n, coalesce(sum(valor), 0)::float total,
               to_char(min(venc), 'DD/MM') venc
          from p
         where venc <= (now() at time zone 'America/Sao_Paulo')::date + 3`;
      if (notas.n > 0) {
        await admin.rpc('fn_pendencia_upsert', {
          p_tenant: t.id, p_kind: 'nota_nao_lancada', p_ref: 'pendentes',
          // O valor é o das PARCELAS na janela, não o da nota inteira — uma nota pode ter
          // parcela vencida hoje e outra só no mês que vem.
          p_titulo: `${notas.n} ${notas.n === 1 ? 'nota de entrada não lançada' : 'notas de entrada não lançadas'} — ${brl(notas.total)} vencendo`,
          p_detalhe: `Têm boleto vencido ou a vencer (o mais antigo em ${notas.venc}) e ainda não viraram compra nem despesa. Enquanto isso, não existem no Contas a Pagar.`,
          p_payload: { total: notas.n, valor: notas.total }, p_rota: '/financeiro?tab=notas-entrada',
          p_urgencia: 'alta', p_acao_requerida: true, p_origem: 'cron', p_reabrir: true,
        });
      } else {
        await admin.rpc('fn_pendencia_resolver_ref', {
          p_tenant: t.id, p_kind: 'nota_nao_lancada', p_ref: 'pendentes', p_motivo: 'notas conferidas',
        });
      }

      if (ownerId) {
        const [tar] = await db()<Array<{ n: number }>>`
          select count(*)::int n from tasks
           where tenant_id = ${t.id} and (created_by = ${ownerId} or assignee_id = ${ownerId})
             and completed_at is null and is_archived = false and due_date < now()`;
        if (tar.n > 0) {
          await admin.rpc('fn_pendencia_upsert', {
            p_tenant: t.id, p_kind: 'tarefa_vencida', p_ref: 'pendentes',
            p_titulo: `${tar.n} ${tar.n === 1 ? 'tarefa vencida' : 'tarefas vencidas'}`,
            p_detalhe: 'Passaram do prazo e ainda não foram concluídas.',
            p_payload: { total: tar.n }, p_rota: '/tarefas',
            p_urgencia: 'normal', p_acao_requerida: true, p_origem: 'cron', p_reabrir: true,
          });
        } else {
          await admin.rpc('fn_pendencia_resolver_ref', {
            p_tenant: t.id, p_kind: 'tarefa_vencida', p_ref: 'pendentes', p_motivo: 'nada vencido',
          });
        }
      }
    } catch (e) {
      log('WARN', 'sincronizar pendências de operação', { loja: t.name, error: errMsg(e) });
    }
  }
}

// Itens de fornecedor que chegaram sem classificação CMV × despesa (2026-09-16, pedido do dono:
// "avisar no grupo financeiro, com botão pra classificar"). Marca d'água = created_at do último
// item avisado (estado por loja), então cada item entra num aviso só; o total pendente vai junto.
// O primeiro aviso (sem estado) cobre o que já está pendente.
// deno-lint-ignore no-explicit-any
async function itemClassifyText(tenants: Array<{ id: string; name: string }>, state: any): Promise<{ text: string | null; newState: Record<string, string> }> {
  const prev: Record<string, string> = state.item_classify ?? {};
  const next: Record<string, string> = { ...prev };
  const parts: string[] = [];
  let novosTotal = 0;
  for (const t of tenants) {
    const desde = prev[t.id] ?? '1970-01-01T00:00:00Z';
    const rows = await db()<Array<{ description: string; supplier_name: string | null; created_at: string }>>`
      select description, supplier_name, created_at::text from fin_item_classifications
      where tenant_id = ${t.id} and classe is null and created_at > ${desde}::timestamptz
      order by created_at`;
    if (!rows.length) continue;
    next[t.id] = rows[rows.length - 1].created_at;
    novosTotal += rows.length;
    const [{ n }] = await db()<Array<{ n: number }>>`
      select count(*)::int n from fin_item_classifications where tenant_id = ${t.id} and classe is null`;
    const l = [`*${t.name}* — ${rows.length} novo(s)`];
    l.push(...rows.slice(0, 10).map((r) => `• ${r.description}${r.supplier_name ? ` (${r.supplier_name})` : ''}`));
    if (rows.length > 10) l.push(`… e mais ${rows.length - 10}`);
    if (n > rows.length) l.push(`Pendentes no total: ${n}`);
    parts.push(l.join('\n'));
  }
  if (!parts.length) return { text: null, newState: next };
  return {
    text: `🏷️ *Itens novos para classificar* (CMV × despesa)\n\n${parts.join('\n\n')}\n\nSem classificar, ${novosTotal > 1 ? 'eles entram' : 'ele entra'} no CMV e a DRE pode sair errada. Ficam na sua caixa de pendências até serem classificados — este aviso sai uma vez por dia.`,
    newState: next,
  };
}

// Conta a pagar sem classificação DRE (o pay_bill não dá baixa sem ela): uma enquete
// por conta, com as categorias de despesa da loja + os grupos (quase nenhuma loja tem
// categorias). O voto é gravado pelo assistente-webhook (asst_polls.kind =
// 'dre_category'), sem modelo. Pagas primeiro (já estão erradas na DRE). Pergunta
// cada conta uma vez só e segura a fila em `max_open` enquetes sem resposta.
// deno-lint-ignore no-explicit-any
async function dreClassify(admin: SupabaseClient, tenants: Array<{ id: string; name: string }>, cfg: any, ownerChat: string | null, dry: boolean): Promise<unknown> {
  const { count: open } = await admin.from('asst_polls').select('message_id', { count: 'exact', head: true })
    .eq('kind', 'dre_category').is('answered_at', null).gt('created_at', new Date(Date.now() - 3 * 86400000).toISOString());
  const slots = dry ? Number(cfg.per_run) : Math.min(Number(cfg.per_run), Number(cfg.max_open) - (open ?? 0));
  if (slots <= 0) return 'fila cheia (esperando respostas)';
  const ids = tenants.map((t) => t.id);
  const bills = await db()<Array<{ id: string; tenant_id: string; description: string; amount: number; status: string; due_date: string; paid_date: string | null }>>`
    select a.id::text, a.tenant_id::text, a.description, a.amount::float, a.status, a.due_date::text, a.paid_date::text
    from fin_accounts_payable a
    where a.tenant_id::text = any(${ids}) and a.dre_category_id is null and a.status <> 'cancelled'
      and coalesce(a.reference_type, '') not in ('purchase', 'hr_payroll')
      and not exists (select 1 from asst_polls p where p.kind = 'dre_category' and p.ref->>'bill_id' = a.id::text)
    order by (a.status = 'paid') desc, a.due_date limit ${slots}`;
  if (!bills.length) return 'nada sem classificação';
  // Enquete do WhatsApp foi abandonada (2026-09-12): o voto não chegava e ela "fica em
  // aberto". Agora é TEXTO numerado (grupo › categoria), uma pergunta por vez; o dono
  // responde com o número, com "Grupo Categoria nova" ou "pular" (assistente-webhook ›
  // dreAnswer). A próxima sai assim que ele responde (webhook chama { run: 'dre_classify' }).
  const [{ n: restantes }] = await db()<Array<{ n: number }>>`
    select count(*)::int n from fin_accounts_payable a
    where a.tenant_id::text = any(${ids}) and a.dre_category_id is null and a.status <> 'cancelled'
      and coalesce(a.reference_type, '') not in ('purchase', 'hr_payroll')
      and not exists (select 1 from asst_polls p where p.kind = 'dre_category' and p.ref->>'bill_id' = a.id::text)`;
  const out: string[] = [];
  for (const b of bills) {
    const [cats, groups] = await Promise.all([
      db()<Array<{ id: string; name: string; group_type: string; parent: string | null }>>`
        select c.id::text, c.name, c.group_type, p.name as parent from fin_dre_categories c
        left join fin_dre_categories p on p.id = c.parent_id
        where c.tenant_id = ${b.tenant_id} and c.is_active and c.group_type not in ('revenue', 'tax', 'cost')
        order by c.group_type, coalesce(p.name, c.name), c.parent_id nulls first, c.name limit 40`,
      db()<Array<{ key: string; label: string }>>`select key, label from fin_dre_groups where tenant_id = ${b.tenant_id} and key not in ('revenue', 'tax', 'cost') order by sort_order, label`,
    ]);
    const grupos = [{ key: 'expense', label: groups.find((g) => g.key === 'expense')?.label ?? 'Despesas Operacionais' }, ...groups.filter((g) => g.key !== 'expense')];
    // deno-lint-ignore no-explicit-any
    const options: any[] = [];
    const lines: string[] = [];
    for (const g of grupos) {
      lines.push(`*${g.label}*`);
      const doGrupo = cats.filter((c) => c.group_type === g.key);
      for (const c of doGrupo) {
        const label = c.parent ? `${c.parent} › ${c.name}` : c.name;
        options.push({ n: options.length + 1, label, category_id: c.id, group: c.group_type });
        lines.push(`${options.length}. ${label}`);
      }
      if (!doGrupo.length) lines.push('_(sem categorias ainda)_');
    }
    const loja = tenants.length > 1 ? ` — ${tenants.find((t) => t.id === b.tenant_id)?.name}` : '';
    const quando = b.status === 'paid' && b.paid_date ? `paga em ${dmy(b.paid_date)}` : `vence ${dmy(b.due_date)}`;
    const question = `${b.description} · ${brl(b.amount)} · ${quando}`;
    const exemplo = grupos[1]?.label ?? grupos[0].label;
    const text = [
      `🏷️ *Classificar no DRE*${loja}`,
      question,
      '',
      ...lines,
      '',
      `Responde com o *número*. Categoria nova: grupo + nome (ex.: _${exemplo} Consultoria_). "pular" = classifico no sistema.`,
      restantes > 1 ? `_(depois desta, mais ${restantes - 1})_` : '',
    ].filter((l, i, a) => l !== '' || a[i - 1] !== '').join('\n').trim();
    if (dry) { out.push(text); continue; }
    if (!ownerChat) break;
    let msgId: string | null = null;
    const header = `🏷️ *Classificar no DRE*${loja}`;
    const footer = restantes > 1 ? `(depois desta, mais ${restantes - 1})` : '';
    if (isTg(ownerChat)) {
      // Telegram (desde 2026-09-12): 1º passo = escolher o GRUPO. As telas seguintes
      // (categorias do grupo, ➕ nova categoria → grupo → nome) são montadas pelo
      // assistente-telegram editando esta mesma mensagem (dreView) — manter iguais.
      const tgText = `${header}\n${question}\n\nEscolha o *grupo*:${footer ? `\n\n${footer}` : ''}`;
      const rows: Array<Array<{ text: string; callback_data: string }>> = grupos.map((g, i) => {
        const n = options.filter((o) => o.group === g.key).length;
        return [{ text: `${g.label}${n ? ` (${n})` : ''}`.slice(0, 60), callback_data: `d|g|${i}` }];
      });
      rows.push([{ text: '➕ Nova categoria', callback_data: 'd|n' }]);
      rows.push([{ text: '⏭️ Pular (classifico no sistema)', callback_data: 'd|s' }]);
      try {
        const m = await sendTelegram(ownerChat, tgText, { reply_markup: { inline_keyboard: rows } });
        msgId = m?.message_id ? `tgdre:${ownerChat.slice(3)}:${m.message_id}` : null;
      } catch (e) { log('ERROR', 'pergunta DRE (Telegram) falhou', { error: errMsg(e) }); break; }
      if (!msgId) break;
    } else {
      const r = await fetch(`${evoUrl}/message/sendText/${evoInstance}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: evoKey },
        body: JSON.stringify({ number: toNumber(ownerChat), text }),
      });
      const sent = await r.json().catch(() => ({}));
      msgId = sent?.key?.id ? String(sent.key.id) : null;
      if (!r.ok || !msgId) { log('ERROR', 'pergunta DRE falhou', { status: r.status, out: JSON.stringify(sent).slice(0, 200) }); break; }
    }
    await admin.from('asst_polls').insert({
      message_id: msgId, chat_id: ownerChat, question, options: options.map((o) => o.label), kind: 'dre_category',
      ref: { tenant_id: b.tenant_id, bill_id: b.id, options, groups: grupos, header, footer },
    });
    await admin.from('asst_messages').insert({ channel: 'cron', chat_id: ownerChat, role: 'assistant', content: text });
    out.push(b.id);
  }
  return dry ? out.join('\n\n———\n\n') : { sent: out.length };
}

// Orquestra os avisos do tick. `dry` (body.preview) só gera, sem enviar nem marcar.
// deno-lint-ignore no-explicit-any
async function proactive(admin: SupabaseClient, cfg: Record<string, any>, ownerChat: string | null, only?: string): Promise<Record<string, unknown>> {
  const pro = Object.fromEntries(Object.entries(PRO_DEFAULTS).map(([k, v]) => [k, { ...v, ...(cfg.proactive?.[k] ?? {}) }]));
  // deno-lint-ignore no-explicit-any
  const state: any = cfg.proactive_state ?? {};
  const today = localDate();
  const now = localHHMM();
  const dry = !!only;
  const res: Record<string, unknown> = {};
  const tenants = await getTenants(admin, cfg);
  if (!tenants.length) return { skipped: 'sem lojas' };
  const saveState = async () => { if (!dry) await admin.from('asst_settings').upsert({ key: 'proactive_state', value: state, updated_at: new Date().toISOString() }); };
  const deliver = async (kind: string, text: string) => {
    res[kind] = dry ? text : true;
    if (dry || !ownerChat) return;
    // Não chamar deliver() aqui: este deliver local esconde o de fora e chamava a si mesmo
    // ("Maximum call stack size exceeded" — nenhum aviso proativo saía até 2026-09-15).
    await (isTg(ownerChat) ? sendTelegram(ownerChat, text) : sendText(toNumber(ownerChat), text));
    // Assunto pelo TIPO do aviso, não pelas palavras (2026-09-18: "Tarefas vencidas" com "API do iFood"
    // caiu no Financeiro pelo gatilho de texto). Tipo sem assunto fixo segue o gatilho.
    const topic = ({ tasks_overdue: 'avisos', closing: 'pagamentos', due_tomorrow: 'pagamentos', stock: 'compras' } as Record<string, string>)[kind];
    await admin.from('asst_messages').insert({ channel: 'cron', chat_id: ownerChat, role: 'assistant', content: text, ...(topic ? { topic } : {}) });
  };
  const want = (k: string) => (only ? only === k : pro[k].enabled && !!ownerChat);

  if (want('closing') && (dry || (inWindow(pro.closing.time, now) && state.closing_date !== today))) {
    if (!dry) { state.closing_date = today; await saveState(); }
    // Quem abriu turno hoje já recebeu (ou vai receber) o fechamento ao fechar a sessão: aqui ficam só
    // as lojas sem sessão nenhuma no dia, senão o dono receberia a mesma loja duas vezes.
    const { data: comCaixa } = await admin.from('sessions').select('tenant_id')
      .gte('opened_at', `${today}T00:00:00-03:00`).lt('opened_at', `${addDays(today, 1)}T00:00:00-03:00`);
    const abriram = new Set(((comCaixa ?? []) as Array<{ tenant_id: string }>).map((r) => String(r.tenant_id)));
    const jaFoi = (state.closing_sent ?? {}) as Record<string, string>;
    const faltam = dry ? tenants : tenants.filter((t) => !abriram.has(t.id) && jaFoi[t.id] !== today);
    const t = faltam.length ? await closingText(admin, faltam, today) : null;
    if (t) await deliver('closing', t); else res.closing = faltam.length ? 'sem movimento' : 'cada loja já recebeu ao fechar o caixa';
  }
  // Caixa que fechou com diferença e o operador não justificou: avisa assim mesmo depois da espera.
  if (only ? only === 'caixa_sem_justificativa' : !!ownerChat) {
    res.caixa_sem_justificativa = await caixasSemJustificativa(admin, tenants, ownerChat, dry);
  }
  if (want('anomaly')) {
    const lastCheck = state.anomaly_checked_at ? Date.parse(state.anomaly_checked_at) : 0;
    if (dry || (now >= pro.anomaly.from && now <= pro.anomaly.to && Date.now() - lastCheck >= Number(pro.anomaly.every_min) * 60_000)) {
      state.anomaly_checked_at = new Date().toISOString();
      const alerts = await anomalyTexts(tenants, pro.anomaly, state, today);
      state.anomaly ??= {};
      for (const a of alerts) { state.anomaly[a.tenant] = today; await deliver(`anomaly:${a.tenant}`, a.text); }
      if (!alerts.length && dry) res.anomaly = 'nada fora do normal (ou sem histórico)';
      await saveState();
    }
  }
  if (want('due_tomorrow') && (dry || (inWindow(pro.due_tomorrow.time, now) && state.due_date !== today))) {
    if (!dry) { state.due_date = today; await saveState(); }
    const t = await dueTomorrowText(tenants, today);
    if (t) await deliver('due_tomorrow', t); else res.due_tomorrow = 'nada vencendo';
  }
  // Vence hoje → conversa Financeiro com os cartões de pagamento (precisa do Telegram do dono: o
  // pagamento é aprovado pelo botão + PIN, no Telegram ou no chat do ERPOS).
  if (want('due_today') && (dry || (inWindow(pro.due_today.time, now) && state.due_today_date !== today))) {
    const tg = cfg.telegram_owner_chat_id ? `tg:${cfg.telegram_owner_chat_id}` : null;
    if (!tg) res.due_today = 'sem Telegram do dono';
    else if (dry) res.due_today = 'prévia desligada (prepararia pagamentos de verdade)';
    else {
      state.due_today_date = today; await saveState();
      const r = await dueTodayRun(tenants, today, tg, String(cfg.owner_user_id ?? ''));
      if (!r) res.due_today = 'nada vencendo hoje';
      else {
        const d = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({ action: 'deliver', chat_key: tg, text: r.text, save: true, topic: 'pagamentos', actions: r.pagamentos.map((id) => ({ type: 'payment', id })) }),
        });
        if (!d.ok) throw new Error(`assistente-telegram ${d.status}: ${(await d.text()).slice(0, 200)}`);
        res.due_today = { contas: r.text.split('\n').filter((l) => l.startsWith('•')).length, preparados: r.pagamentos.length };
      }
    }
  }
  if (want('stock') && (dry || (inWindow(pro.stock.time, now) && state.stock_date !== today))) {
    const { text, newState } = await stockText(tenants, state);
    if (!dry) { state.stock_date = today; state.stock = newState; await saveState(); }
    if (text) await deliver('stock', text); else res.stock = 'sem mudança';
  }
  if (want('tasks_overdue') && (dry || (inWindow(pro.tasks_overdue.time, now) && state.tasks_date !== today))) {
    if (!dry) { state.tasks_date = today; await saveState(); }
    const t = await tasksOverdueText(String(cfg.owner_user_id ?? ''));
    if (t) await deliver('tasks_overdue', t); else res.tasks_overdue = 'nenhuma vencida';
  }
  // Caixa em dia primeiro (silencioso, 2 contagens por loja): é ela que garante que nada se
  // perde — os avisos abaixo são só ponteiros para cá. Fora do want() de propósito:
  // sincronizar grava no banco e não manda mensagem, então não pode depender de haver canal
  // do dono configurado.
  if (only ? only === 'pendencias' : pro.pendencias.enabled) {
    const lastSync = state.pend_synced_at ? Date.parse(state.pend_synced_at) : 0;
    if (dry || Date.now() - lastSync >= Number(pro.pendencias.sync_min ?? 30) * 60_000) {
      if (!dry) { state.pend_synced_at = new Date().toISOString(); await saveState(); }
      await syncPendenciasClassificacao(admin, tenants);
      await syncPendenciasOperacao(admin, tenants, String(cfg.owner_user_id ?? ''));
      if (dry) res.pendencias = 'caixa sincronizada';
    }
  }
  if (want('item_classify')) {
    const c = pro.item_classify;
    if (dry || (inWindow(c.time, now) && state.item_date !== today)) {
      const { text, newState } = await itemClassifyText(tenants, state);
      if (!dry) { state.item_date = today; state.item_classify = newState; await saveState(); }
      const botao = { type: 'abrir', label: 'Classificar itens', rota: '/financeiro?tab=itens' };
      if (!text) res.item_classify = 'nada novo';
      else if (dry) res.item_classify = `${text}\n[Botão: "${botao.label}" → ${botao.rota}]`;
      else if (ownerChat && isTg(ownerChat)) {
        // Pelo assistente-telegram: botão de link no Telegram + marcador de botão no chat do ERPOS
        // (aba Financeiro) + push — o mesmo caminho dos avisos da Contratação.
        const r = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey },
          body: JSON.stringify({ action: 'deliver', chat_key: ownerChat, text, save: true, topic: 'pagamentos', actions: [botao] }),
        });
        if (!r.ok) throw new Error(`assistente-telegram ${r.status}: ${(await r.text()).slice(0, 200)}`);
        res.item_classify = true;
      } else if (ownerChat) {
        await sendText(toNumber(ownerChat), text);
        await admin.from('asst_messages').insert({ channel: 'cron', chat_id: ownerChat, role: 'assistant', content: `${text}\n[Botão enviado: "${botao.label}" → ${botao.rota}]`, topic: 'pagamentos' });
        res.item_classify = true;
      }
    }
  }
  if (want('dre_classify')) {
    const c = pro.dre_classify;
    const last = state.dre_checked_at ? Date.parse(state.dre_checked_at) : 0;
    if (dry || (now >= c.from && now <= c.to && Date.now() - last >= Number(c.every_min) * 60_000)) {
      if (!dry) { state.dre_checked_at = new Date().toISOString(); await saveState(); }
      res.dre_classify = await dreClassify(admin, tenants, c, ownerChat, dry); // canal principal (Telegram com botões; WhatsApp em texto)
    }
  }
  return res;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (internalKey.length < 20 || req.headers.get('x-internal-key') !== internalKey) return json({ error: 'Unauthorized' }, 401);
  if (!evoUrl || !evoKey) return json({ error: 'EVOLUTION_URL/EVOLUTION_API_KEY não configurados' }, 503);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const cfg = await getSettings(admin);
  // Destino padrão do dono: Telegram quando configurado como canal principal, senão o JID do WhatsApp.
  const waOwnerChat = typeof cfg.owner_chat_id === 'string' && cfg.owner_chat_id ? cfg.owner_chat_id : null;
  const tgOwnerChat = cfg.telegram_owner_chat_id ? `tg:${cfg.telegram_owner_chat_id}` : null;
  const ownerChat = (cfg.primary_channel === 'telegram' && tgOwnerChat) ? tgOwnerChat : waOwnerChat;
  // deno-lint-ignore no-explicit-any
  const body: any = await req.json().catch(() => ({}));
  if (body.preview === 'brief') {
    try { return json({ ok: true, preview: await morningBriefText(admin, cfg, localDate()) }); }
    catch (e) { return json({ error: errMsg(e) }, 500); }
  }
  if (typeof body.preview === 'string') {
    try { return json({ ok: true, preview: await proactive(admin, cfg, ownerChat, body.preview) }); }
    catch (e) { return json({ error: errMsg(e) }, 500); }
  }
  // Gatilhos do PDV (2026-09-20): caixa fechado → mensagem do DINHEIRO daquele caixa; sessão fechada →
  // fechamento do turno da loja. Uma mensagem por caixa e uma por sessão.
  if (body.run === 'closing_cash') {
    try {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'id obrigatório' }, 400);
      return json(await avisarCaixa(admin, ownerChat, id, false));
    } catch (e) { return json({ error: errMsg(e) }, 500); }
  }
  if (body.run === 'closing_session') {
    try {
      const id = String(body.id ?? '');
      if (!id) return json({ error: 'id obrigatório' }, 400);
      const aviso = await sessaoText(admin, id);
      if (!aviso) return json({ ok: true, skipped: 'sem conteúdo' });
      if (!ownerChat) return json({ ok: true, skipped: 'sem canal do dono' });
      // WhatsApp/Telegram não desenham painel: lá vai o texto inteiro. No chat do ERPOS vai UMA linha de
      // resumo (para a lista de conversas e para o modelo) + os dados do painel — nada de texto repetido
      // embaixo do painel (dono, 2026-09-20).
      await (isTg(ownerChat) ? sendTelegram(ownerChat, aviso.texto) : sendText(toNumber(ownerChat), aviso.texto));
      await admin.from('asst_messages').insert({
        channel: 'cron', chat_id: ownerChat, role: 'assistant', topic: 'pagamentos',
        content: `${aviso.resumo}\n[painel]${JSON.stringify(aviso.painel)}[/painel]`,
      });
      // O aviso das 23:00 não repete a loja que já recebeu o fechamento do turno.
      if (body.run === 'closing_session') {
        const { data: s } = await admin.from('sessions').select('tenant_id, opened_at').eq('id', id).maybeSingle();
        if (s) {
          const st = (cfg.proactive_state ?? {}) as Record<string, unknown>;
          const dia = new Date(String(s.opened_at)).toLocaleDateString('en-CA', { timeZone: TZ });
          const enviados = { ...((st.closing_sent ?? {}) as Record<string, string>), [String(s.tenant_id)]: dia };
          await admin.from('asst_settings').upsert({ key: 'proactive_state', value: { ...st, closing_sent: enviados }, updated_at: new Date().toISOString() });
        }
      }
      return json({ ok: true, sent: true });
    } catch (e) { return json({ error: errMsg(e) }, 500); }
  }
  // Fechamento do dia inteiro de uma loja (uso manual; o normal é pelo fechamento da sessão).
  if (body.run === 'closing_tenant') {
    try {
      const tenantId = String(body.tenant_id ?? '');
      if (!tenantId) return json({ error: 'tenant_id obrigatório' }, 400);
      const day = /^\d{4}-\d{2}-\d{2}$/.test(String(body.day ?? '')) ? String(body.day) : localDate();
      const { data: t } = await admin.from('tenants').select('id, name').eq('id', tenantId).maybeSingle();
      if (!t) return json({ error: 'loja não encontrada' }, 404);
      // Outro caixa ainda aberto na loja: o fechamento sai quando o último fechar.
      const { count } = await admin.from('cash_registers').select('id', { count: 'exact', head: true })
        .eq('tenant_id', tenantId).neq('status', 'closed')
        .gte('opened_at', `${day}T00:00:00-03:00`).lt('opened_at', `${addDays(day, 1)}T00:00:00-03:00`);
      if (count) return json({ ok: true, skipped: 'ainda tem caixa aberto' });
      const texto = await closingText(admin, [{ id: String(t.id), name: String(t.name) }], day);
      if (!texto) return json({ ok: true, skipped: 'sem movimento' });
      if (!ownerChat) return json({ ok: true, skipped: 'sem canal do dono' });
      await (isTg(ownerChat) ? sendTelegram(ownerChat, texto) : sendText(toNumber(ownerChat), texto));
      await admin.from('asst_messages').insert({ channel: 'cron', chat_id: ownerChat, role: 'assistant', content: texto, topic: 'pagamentos' });
      // Marca para o aviso das 23:00 não repetir a mesma loja.
      const st = (cfg.proactive_state ?? {}) as Record<string, unknown>;
      const enviados = { ...((st.closing_sent ?? {}) as Record<string, string>), [tenantId]: day };
      await admin.from('asst_settings').upsert({ key: 'proactive_state', value: { ...st, closing_sent: enviados }, updated_at: new Date().toISOString() });
      return json({ ok: true, sent: true });
    } catch (e) { return json({ error: errMsg(e) }, 500); }
  }
  // Chamado pelo webhook logo depois que o dono responde: manda a próxima pergunta DRE já.
  if (body.run === 'dre_classify') {
    try {
      const c = { ...PRO_DEFAULTS.dre_classify, ...(cfg.proactive?.dre_classify ?? {}) };
      if (!c.enabled) return json({ ok: true, skipped: 'desligado' });
      return json({ ok: true, dre_classify: await dreClassify(admin, await getTenants(admin, cfg), c, ownerChat, false) });
    } catch (e) { return json({ error: errMsg(e) }, 500); }
  }

  // Sincroniza a caixa de pendências na hora (manutenção / depois de mudar uma regra), sem esperar
  // os 30 min da regra 'pendencias'.
  if (body.run === 'pendencias') {
    try {
      const tenants = await getTenants(admin, cfg);
      await syncPendenciasClassificacao(admin, tenants);
      await syncPendenciasOperacao(admin, tenants, String(cfg.owner_user_id ?? ''));
      return json({ ok: true, pendencias: tenants.length });
    } catch (e) { return json({ error: errMsg(e) }, 500); }
  }

  const result: Record<string, unknown> = {};
  try { result.reminders_sent = await sendReminders(admin, ownerChat); } catch (e) { result.reminders_error = errMsg(e); log('ERROR', 'reminders', { error: errMsg(e) }); }
  try { result.brief_sent = await morningBrief(admin, cfg, ownerChat); } catch (e) { result.brief_error = errMsg(e); log('ERROR', 'brief', { error: errMsg(e) }); }
  try { result.warmed = await keepWarm(admin, cfg); } catch (e) { result.warm_error = errMsg(e); log('ERROR', 'warm', { error: errMsg(e) }); }
  try { const pr = await proactive(admin, cfg, ownerChat); if (Object.keys(pr).length) result.proactive = pr; } catch (e) { result.proactive_error = errMsg(e); log('ERROR', 'proactive', { error: errMsg(e) }); }
  try { const pw = await payWatch(admin); if (pw) result.pay_watch = pw; } catch (e) { result.pay_watch_error = errMsg(e); log('ERROR', 'pay_watch', { error: errMsg(e) }); }
  try { const pp = await pagamentosParados(admin); if (pp) result.pagamentos_parados = pp; } catch (e) { result.pagamentos_parados_error = errMsg(e); log('ERROR', 'pagamentos_parados', { error: errMsg(e) }); }
  try { const fg = await filaGrupo(admin); if (fg) result.fila_grupo = fg; } catch (e) { result.fila_grupo_error = errMsg(e); log('ERROR', 'fila_grupo', { error: errMsg(e) }); }
  // Agendamento de entrevistas (Contratação): convites, cobrança e lembretes — regras no hiring-scheduler
  try {
    const r = await fetch(`${supabaseUrl}/functions/v1/hiring-scheduler`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify({ action: 'tick' }),
    });
    const hs = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`hiring-scheduler ${r.status}: ${JSON.stringify(hs).slice(0, 200)}`);
    if (hs.invited || hs.followups || hs.sem_resposta || hs.reminded) result.hiring = hs;
  } catch (e) { result.hiring_error = errMsg(e); log('ERROR', 'hiring-scheduler', { error: errMsg(e) }); }
  // Fila do debounce: só serve por segundos; guarda 7 dias para diagnóstico
  await admin.from('asst_inbox').delete().lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  await admin.from('asst_tg_updates').delete().lt('created_at', new Date(Date.now() - 7 * 86400000).toISOString());
  // Mensagens de grupos: NÃO apagar (decisão do dono, 2026-09-12): histórico completo fica guardado.
  // Leitor universal (asst_reader): tabelas/colunas novas entram sozinhas, 1×/dia às 04:00
  if (localHHMM() === '04:00') {
    const { error } = await admin.rpc('fn_asst_reader_refresh');
    if (error) log('ERROR', 'reader refresh', { error: error.message });
  }
  // deno-lint-ignore no-explicit-any
  if (result.reminders_sent || result.brief_sent || result.proactive || (result.pay_watch as any)?.changed) log('INFO', 'tick', result);
  return json({ ok: true, ...result });
});

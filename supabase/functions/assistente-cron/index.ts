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
async function sendTelegram(chatKey: string, text: string, extra: Record<string, unknown> = {}): Promise<any> {
  if (!tgToken) throw new Error('TELEGRAM_BOT_TOKEN não configurado');
  const esc = (x: string) => x.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const html = esc(text).replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1<b>$2</b>');
  const send = async (body: Record<string, unknown>) => {
    const r = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chatKey.slice(3), ...body }) });
    const out = await r.json().catch(() => ({}));
    if (!r.ok || out?.ok === false) throw new Error(`Telegram → ${r.status}: ${String(out?.description ?? '').slice(0, 200)}`);
    return out.result;
  };
  try { return await send({ text: html, parse_mode: 'HTML', ...extra }); } catch { return await send({ text, ...extra }); }
}
// Entrega para qualquer destino: JID do WhatsApp ou "tg:<id>" do Telegram.
async function deliver(target: string, text: string) {
  if (isTg(target)) return sendTelegram(target, text);
  return sendText(toNumber(target), text);
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
  if (!count) return null;
  const r = await fetch(`${supabaseUrl}/functions/v1/assistente-telegram`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-internal-key': internalKey }, body: JSON.stringify({ action: 'pay_watch' }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`assistente-telegram ${r.status}: ${JSON.stringify(out).slice(0, 200)}`);
  return out;
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
        + 'e previsão do tempo de hoje para a loja principal (previsao_tempo: uma linha, destaque chuva no horário de movimento). '
        + 'Estoque crítico só se algo novo (o cron já avisa o que muda). Comece com "Bom dia". Curto, só o que pede atenção; se não houver nada num item, pule.',
    }),
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok || !out?.reply) {
    await admin.from('asst_settings').upsert({ key: 'last_brief_date', value: null, updated_at: new Date().toISOString() });
    throw new Error(`brain ${r.status}: ${JSON.stringify(out).slice(0, 300)}`);
  }
  await deliver(ownerChat, String(out.reply));
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

// ── Proatividade determinística (2026-09-12) ──
// Regras em SQL, texto montado aqui, SEM chamar o modelo (custo zero por aviso).
// Configuração em asst_settings.proactive (mesclada com PRO_DEFAULTS); estado de
// "já mandei hoje" em asst_settings.proactive_state. Cada aviso vai para o dono e
// entra em asst_messages (channel 'cron') para o brain saber o que já foi dito.
// deno-lint-ignore no-explicit-any
const PRO_DEFAULTS: Record<string, any> = {
  closing: { enabled: true, time: '23:00' },            // fechamento do dia por loja
  due_tomorrow: { enabled: true, time: '17:00' },       // contas que vencem amanhã (+ fim de semana na sexta)
  anomaly: { enabled: true, from: '11:30', to: '22:30', every_min: 30, drop_pct: 30, spike_pct: 50, min_base: 300 },
  stock: { enabled: true, time: '09:00' },              // estoque crítico: só o que MUDOU
  tasks_overdue: { enabled: true, time: '18:00' },      // tarefas vencidas do dono
  // conta a pagar sem classificação DRE → pergunta em texto, UMA por vez (a resposta é
  // gravada pelo webhook, sem modelo, e ele já pede a próxima)
  dre_classify: { enabled: true, from: '08:00', to: '21:00', every_min: 2, per_run: 1, max_open: 1 },
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
      admin.rpc('fn_get_sales_report', { p_tenant_id: t.id, p_date_from: `${lwDay}T00:00:00-03:00`, p_date_to: `${day}T00:00:00-03:00`, p_session_id: null }),
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
    const top = (Array.isArray(r.top_items) ? r.top_items : []).slice(0, 5).map((i: any) => `${i.item_name} (${Number(i.total_qty)})`);
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
    await deliver(ownerChat, text);
    await admin.from('asst_messages').insert({ channel: 'cron', chat_id: ownerChat, role: 'assistant', content: text });
  };
  const want = (k: string) => (only ? only === k : pro[k].enabled && !!ownerChat);

  if (want('closing') && (dry || (inWindow(pro.closing.time, now) && state.closing_date !== today))) {
    if (!dry) { state.closing_date = today; await saveState(); }
    const t = await closingText(admin, tenants, today);
    if (t) await deliver('closing', t); else res.closing = 'sem movimento';
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
  if (typeof body.preview === 'string') {
    try { return json({ ok: true, preview: await proactive(admin, cfg, ownerChat, body.preview) }); }
    catch (e) { return json({ error: errMsg(e) }, 500); }
  }
  // Chamado pelo webhook logo depois que o dono responde: manda a próxima pergunta DRE já.
  if (body.run === 'dre_classify') {
    try {
      const c = { ...PRO_DEFAULTS.dre_classify, ...(cfg.proactive?.dre_classify ?? {}) };
      if (!c.enabled) return json({ ok: true, skipped: 'desligado' });
      return json({ ok: true, dre_classify: await dreClassify(admin, await getTenants(admin, cfg), c, ownerChat, false) });
    } catch (e) { return json({ error: errMsg(e) }, 500); }
  }

  const result: Record<string, unknown> = {};
  try { result.reminders_sent = await sendReminders(admin, ownerChat); } catch (e) { result.reminders_error = errMsg(e); log('ERROR', 'reminders', { error: errMsg(e) }); }
  try { result.brief_sent = await morningBrief(admin, cfg, ownerChat); } catch (e) { result.brief_error = errMsg(e); log('ERROR', 'brief', { error: errMsg(e) }); }
  try { result.warmed = await keepWarm(admin, cfg); } catch (e) { result.warm_error = errMsg(e); log('ERROR', 'warm', { error: errMsg(e) }); }
  try { const pr = await proactive(admin, cfg, ownerChat); if (Object.keys(pr).length) result.proactive = pr; } catch (e) { result.proactive_error = errMsg(e); log('ERROR', 'proactive', { error: errMsg(e) }); }
  try { const pw = await payWatch(admin); if (pw) result.pay_watch = pw; } catch (e) { result.pay_watch_error = errMsg(e); log('ERROR', 'pay_watch', { error: errMsg(e) }); }
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

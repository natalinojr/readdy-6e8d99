// assistente-config — backend da tela Assistente (projeto PESSOAL do dono;
// ver assistente/README.md). Só o dono: e-mail fixo + asst_settings.owner_user_id.
//
// Ações (POST JSON { action, ... }), JWT do usuário no Authorization:
//   get                 visão geral: configurações, lojas, conversa recente, lembretes,
//                       memórias, estado do WhatsApp e custo estimado de 30 dias
//   save_settings       { watched_tenant_ids, default_tenant_id, morning_brief: { enabled, time } }
//   add_memory          { content }
//   delete_memory       { id }            (desativa, não apaga)
//   cancel_reminder     { id }            (só lembrete ainda não enviado)
//   whatsapp_connect    {}                QR Code de pareamento da instância na Evolution
//   whatsapp_state      {}                estado da conexão (open | connecting | close)
//   ── Pix permitidos (lista branca do Pix pelo assistente) — PIN PRÓPRIO, criado pelo dono ──
//   pix_allow_status    {}                          { has_pin, locked_until }
//   pix_allow_set_pin   { new_pin }                 SÓ cria (1ª vez); 6–8 dígitos. Não há troca pela tela (decisão do
//                                               dono, 2026-09-12): para trocar, o suporte apaga asst_settings.pix_allow_pin
//                                               direto no banco e a tela pede um PIN novo na próxima abertura.
//   pix_allow_list      { pin }                     itens ativos (da loja que tem o Inter conectado)
//   pix_allow_save      { pin, id?, name, chave }   inclui ou edita
//   pix_allow_remove    { pin, id }                 desativa
//   PIN guardado como PBKDF2-SHA256 (sal aleatório) em asst_settings.pix_allow_pin; 3 erros = 15 min.
//
// Secrets: EVOLUTION_URL, EVOLUTION_API_KEY, EVOLUTION_INSTANCE.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const OWNER_EMAIL = 'natalinojr.engel@gmail.com';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// US$ por milhão de tokens (Sonnet 5). Respostas antigas foram com Opus 5, então
// o valor dos primeiros dias é aproximado — por isso a tela chama de "estimado".
const PRICE = { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5, cache_write_1h: 4 };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const ok = (data: unknown = null) => json({ success: true, data });
const fail = (error: string, status = 400) => json({ success: false, error }, status);
const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));

const evoUrl = (Deno.env.get('EVOLUTION_URL') ?? '').replace(/\/$/, '');
const evoKey = Deno.env.get('EVOLUTION_API_KEY') ?? '';
const evoInstance = Deno.env.get('EVOLUTION_INSTANCE') || 'assistente';

// deno-lint-ignore no-explicit-any
async function evoGet(path: string): Promise<any> {
  if (!evoUrl || !evoKey) throw new Error('Evolution não configurada');
  const r = await fetch(`${evoUrl}${path}`, { headers: { apikey: evoKey }, signal: AbortSignal.timeout(15_000) });
  const text = await r.text();
  if (!r.ok) throw new Error(`Evolution ${r.status}: ${text.slice(0, 200)}`);
  try { return JSON.parse(text); } catch { return {}; }
}

async function whatsappState(): Promise<{ state: string | null; error?: string }> {
  try {
    const out = await evoGet(`/instance/connectionState/${evoInstance}`);
    return { state: String(out?.instance?.state ?? out?.state ?? 'unknown') };
  } catch (e) {
    return { state: null, error: errMsg(e) };
  }
}

async function loadSettings(admin: SupabaseClient) {
  const { data } = await admin.from('asst_settings').select('key, value');
  // deno-lint-ignore no-explicit-any
  return Object.fromEntries((data ?? []).map((s) => [s.key, s.value])) as Record<string, any>;
}

async function setSetting(admin: SupabaseClient, key: string, value: unknown) {
  const { error } = await admin.from('asst_settings').upsert({ key, value, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

// Cotação do dólar (venda, comercial — sem IOF do cartão) para mostrar o custo da IA
// em reais. AwesomeAPI (atualiza ao longo do dia); se falhar, PTAX do Banco Central.
// Guardada 1 h em asst_settings.usd_brl; sem nenhuma fonte, usa a última conhecida.
type Fx = { rate: number; source: string; at: string };
// deno-lint-ignore no-explicit-any
async function usdBrl(admin: SupabaseClient, cfg: Record<string, any>): Promise<Fx | null> {
  const cached = cfg.usd_brl;
  if (cached?.rate && cached?.fetched_at && Date.now() - Date.parse(cached.fetched_at) < 3600_000) return cached;
  let out: Fx | null = null;
  try {
    const j = await (await fetch('https://economia.awesomeapi.com.br/json/last/USD-BRL', { signal: AbortSignal.timeout(8000) })).json();
    const rate = Number(j?.USDBRL?.ask);
    if (rate > 0) out = { rate, source: 'AwesomeAPI', at: String(j.USDBRL.create_date ?? '') };
  } catch { /* tenta o Banco Central */ }
  if (!out) {
    try {
      const f = (d: Date) => `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${d.getFullYear()}`;
      const url = 'https://olinda.bcb.gov.br/olinda/servico/PTAX/versao/v1/odata/CotacaoDolarPeriodo(dataInicial=@dataInicial,dataFinalCotacao=@dataFinalCotacao)'
        + `?@dataInicial='${f(new Date(Date.now() - 10 * 86400000))}'&@dataFinalCotacao='${f(new Date())}'`
        + '&$top=1&$orderby=dataHoraCotacao%20desc&$format=json&$select=cotacaoVenda,dataHoraCotacao';
      const v = (await (await fetch(url, { signal: AbortSignal.timeout(8000) })).json())?.value?.[0];
      if (Number(v?.cotacaoVenda) > 0) out = { rate: Number(v.cotacaoVenda), source: 'PTAX Banco Central', at: String(v.dataHoraCotacao ?? '').slice(0, 16) };
    } catch { /* sem cotação agora */ }
  }
  if (out) {
    await setSetting(admin, 'usd_brl', { ...out, fetched_at: new Date().toISOString() });
    return out;
  }
  return cached?.rate ? cached : null;
}

// ── Pix permitidos: PIN próprio da lista (2026-09-12) ─────────────────────────
// Só o dono cria o PIN (na primeira vez que abre a seção) e só ele sabe: guardamos PBKDF2 com
// sal aleatório. Toda leitura/escrita da lista exige o PIN. O assistente não chama esta edge
// (ela exige o JWT do dono e não está no EDGE_ALLOW do brain) e nunca vê o PIN.
const PIN_ITER = 150_000;
const b64 = (u: Uint8Array) => btoa(String.fromCharCode(...u));
async function pbkdf2(pin: string, saltB64: string, iter = PIN_ITER): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
  return b64(new Uint8Array(bits));
}
function sameStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// deno-lint-ignore no-explicit-any
async function checkAllowPin(admin: SupabaseClient, cfg: Record<string, any>, pin: unknown): Promise<void> {
  const s = cfg.pix_allow_pin;
  if (!s?.hash) throw new Error('PIN_NOT_SET');
  if (s.locked_until && Date.parse(s.locked_until) > Date.now()) {
    throw new Error(`PIN bloqueado até ${new Date(s.locked_until).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })} por tentativas erradas.`);
  }
  const h = await pbkdf2(String(pin ?? ''), String(s.salt), Number(s.iter ?? PIN_ITER));
  if (sameStr(h, String(s.hash))) {
    if (s.fails) await setSetting(admin, 'pix_allow_pin', { ...s, fails: 0, locked_until: null });
    return;
  }
  const fails = Number(s.fails ?? 0) + 1;
  const locked = fails >= 3 ? new Date(Date.now() + 15 * 60_000).toISOString() : null;
  await setSetting(admin, 'pix_allow_pin', { ...s, fails: locked ? 0 : fails, locked_until: locked });
  cfg.pix_allow_pin = { ...s, fails: locked ? 0 : fails, locked_until: locked };
  throw new Error(locked ? 'PIN errado 3 vezes. Bloqueado por 15 minutos.' : `PIN errado (${fails}/3).`);
}
const onlyDigits = (x: unknown) => String(x ?? '').replace(/\D/g, '');
// MESMA normalização da edge inter-bank (normPixKey): se mudar lá, mude aqui.
function normPixKey(k: string): { key: string; kind: string } {
  const s = String(k ?? '').trim();
  if (/@/.test(s)) return { key: s.toLowerCase(), kind: 'email' };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return { key: s.toLowerCase(), kind: 'evp' };
  const dg = onlyDigits(s);
  if (/^\+/.test(s) || (dg.length === 13 && dg.startsWith('55'))) return { key: `+${dg}`, kind: 'telefone' };
  if (dg.length === 14) return { key: dg, kind: 'cnpj' };
  if (dg.length === 11) return { key: dg, kind: 'cpf' };
  return { key: s, kind: 'desconhecida' };
}
async function interTenantId(admin: SupabaseClient): Promise<string> {
  const { data } = await admin.from('fin_inter_config').select('tenant_id').eq('is_active', true).limit(1);
  if (!data?.length) throw new Error('Nenhuma loja tem o Banco Inter conectado.');
  return String(data[0].tenant_id);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return fail('Method not allowed', 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authHeader = req.headers.get('Authorization') ?? '';

  const db = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: { user } } = await db.auth.getUser();
  if (!user) return fail('Unauthorized', 401);

  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const cfg = await loadSettings(admin);
  if (user.email?.toLowerCase() !== OWNER_EMAIL || user.id !== cfg.owner_user_id) return fail('Acesso restrito ao dono', 403);

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try { body = await req.json(); } catch { /* sem corpo */ }

  try {
    switch (body.action) {
      case 'get': {
        const since = new Date(Date.now() - 30 * 86400000).toISOString();
        const [tenants, memories, pending, sent, messages, usageRows, wa] = await Promise.all([
          admin.from('tenants').select('id, name, is_active').order('name'),
          admin.from('asst_memories').select('id, content, created_at').eq('is_active', true).order('created_at', { ascending: false }).limit(200),
          admin.from('asst_reminders').select('id, text, due_at, sent_at').is('sent_at', null).order('due_at').limit(100),
          admin.from('asst_reminders').select('id, text, due_at, sent_at').not('sent_at', 'is', null).order('sent_at', { ascending: false }).limit(20),
          // channel 'grupo' = leitura automática de foto/PDF dos grupos: conta no custo,
          // mas não é conversa, então fica fora da lista da tela.
          admin.from('asst_messages').select('id, role, content, channel, created_at').neq('channel', 'grupo').order('created_at', { ascending: false }).limit(80),
          admin.from('asst_messages').select('usage').eq('role', 'assistant').gte('created_at', since).not('usage', 'is', null).limit(5000),
          whatsappState(),
        ]);
        let usd = 0;
        for (const r of usageRows.data ?? []) {
          // deno-lint-ignore no-explicit-any
          const u = (r.usage ?? {}) as any;
          const w1h = u.cache_write_1h ?? 0; // cache de 1 h custa 2x; o resto é o de 5 min (1,25x)
          usd += ((u.input ?? 0) * PRICE.input + (u.output ?? 0) * PRICE.output + (u.cache_read ?? 0) * PRICE.cache_read
            + ((u.cache_write ?? 0) - w1h) * PRICE.cache_write + w1h * PRICE.cache_write_1h) / 1e6;
        }
        const fx = await usdBrl(admin, cfg);
        const { data: gs } = await admin.from('asst_groups').select('group_jid, name, is_enabled').order('name');
        const groups = [];
        for (const g of gs ?? []) {
          const { data: last } = await admin.from('asst_group_messages').select('sent_at').eq('group_jid', g.group_jid).order('sent_at', { ascending: false }).limit(1).maybeSingle();
          groups.push({ ...g, last_at: last?.sent_at ?? null });
        }
        const watched = Array.isArray(cfg.watched_tenant_ids) ? cfg.watched_tenant_ids : [];
        return ok({
          settings: {
            watched_tenant_ids: watched,
            default_tenant_id: cfg.default_tenant_id ?? null,
            morning_brief: cfg.morning_brief ?? { enabled: true, time: '07:30' },
          },
          tenants: tenants.data ?? [],
          memories: memories.data ?? [],
          reminders: { pending: pending.data ?? [], sent: sent.data ?? [] },
          messages: (messages.data ?? []).reverse(),
          whatsapp: { ...wa, owner_chat_id: cfg.owner_chat_id ?? null },
          usage30d: {
            replies: (usageRows.data ?? []).length,
            usd: Math.round(usd * 100) / 100,
            brl: fx ? Math.round(usd * fx.rate * 100) / 100 : null,
            rate: fx?.rate ?? null,
            rate_source: fx?.source ?? null,
            rate_at: fx?.at ?? null,
          },
          groups,
        });
      }

      case 'save_settings': {
        const ids: string[] = Array.isArray(body.watched_tenant_ids) ? body.watched_tenant_ids.map(String).filter((s: string) => UUID_RE.test(s)) : [];
        if (!ids.length) return fail('Escolha pelo menos uma loja.');
        const { data: exist } = await admin.from('tenants').select('id').in('id', ids);
        const valid = (exist ?? []).map((t) => t.id as string);
        if (valid.length !== ids.length) return fail('Loja inválida na seleção.');
        const def = String(body.default_tenant_id ?? '');
        if (!valid.includes(def)) return fail('A loja principal precisa estar entre as selecionadas.');
        const mb = body.morning_brief ?? {};
        const time = String(mb.time ?? '07:30');
        if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail('Horário do resumo inválido (use HH:MM).');
        await setSetting(admin, 'watched_tenant_ids', valid);
        await setSetting(admin, 'default_tenant_id', def);
        await setSetting(admin, 'morning_brief', { enabled: !!mb.enabled, time });
        return ok();
      }

      case 'add_memory': {
        const content = String(body.content ?? '').trim();
        if (!content) return fail('Escreva o que o assistente deve lembrar.');
        const { error } = await admin.from('asst_memories').insert({ content: content.slice(0, 1000), source: 'tela' });
        if (error) throw new Error(error.message);
        return ok();
      }

      case 'delete_memory': {
        const { error } = await admin.from('asst_memories').update({ is_active: false }).eq('id', Number(body.id));
        if (error) throw new Error(error.message);
        return ok();
      }

      case 'cancel_reminder': {
        const { data, error } = await admin.from('asst_reminders').delete().eq('id', Number(body.id)).is('sent_at', null).select('id');
        if (error) throw new Error(error.message);
        if (!data?.length) return fail('Lembrete já enviado ou não encontrado.');
        return ok();
      }

      case 'toggle_group': {
        const { data, error } = await admin.from('asst_groups')
          .update({ is_enabled: !!body.enabled, updated_at: new Date().toISOString() })
          .eq('group_jid', String(body.group_jid ?? '')).select('group_jid');
        if (error) throw new Error(error.message);
        if (!data?.length) return fail('Grupo não encontrado.');
        return ok();
      }

      case 'pix_allow_status': {
        const st = cfg.pix_allow_pin;
        return ok({ has_pin: Boolean(st?.hash), locked_until: st?.locked_until && Date.parse(st.locked_until) > Date.now() ? st.locked_until : null });
      }
      case 'pix_allow_set_pin': {
        const np = String(body.new_pin ?? '').trim();
        if (!/^\d{6,8}$/.test(np)) return fail('O PIN precisa ter de 6 a 8 números.');
        if (/^(\d)\1+$/.test(np) || '0123456789'.includes(np) || '9876543210'.includes(np)) return fail('PIN fácil demais (repetido ou sequência). Escolha outro.');
        if (cfg.pix_allow_pin?.hash) return fail('O PIN da lista já foi criado e não pode ser trocado pela tela. Para trocar, peça ao suporte (Claude Code).', 403);
        const salt = b64(crypto.getRandomValues(new Uint8Array(16)));
        await setSetting(admin, 'pix_allow_pin', { salt, hash: await pbkdf2(np, salt), iter: PIN_ITER, fails: 0, locked_until: null, set_at: new Date().toISOString(), set_by: user.id });
        return ok({ has_pin: true });
      }
      case 'pix_allow_list': {
        await checkAllowPin(admin, cfg, body.pin);
        const tid = await interTenantId(admin);
        const { data, error } = await admin.from('fin_pix_favorecidos').select('id, name, pix_key, pix_key_kind, created_at').eq('tenant_id', tid).eq('is_active', true).order('name');
        if (error) throw new Error(error.message);
        return ok({ items: data ?? [] });
      }
      case 'pix_allow_save': {
        await checkAllowPin(admin, cfg, body.pin);
        const tid = await interTenantId(admin);
        const name = String(body.name ?? '').trim().slice(0, 80);
        const k = normPixKey(String(body.chave ?? ''));
        if (!name) return fail('Informe o nome de quem vai receber.');
        if (k.kind === 'desconhecida') return fail('Chave Pix não reconhecida. Use CPF, CNPJ, e-mail, telefone com +55 ou a chave aleatória.');
        if (body.id) {
          if (!UUID_RE.test(String(body.id))) return fail('id inválido');
          const { data: dup } = await admin.from('fin_pix_favorecidos').select('id').eq('tenant_id', tid).eq('pix_key', k.key).neq('id', String(body.id)).eq('is_active', true).maybeSingle();
          if (dup) return fail('Essa chave já está na lista em outro nome.');
          const { data, error } = await admin.from('fin_pix_favorecidos').update({ name, pix_key: k.key, pix_key_kind: k.kind }).eq('id', String(body.id)).eq('tenant_id', tid).select('id, name, pix_key, pix_key_kind').single();
          if (error) throw new Error(error.message);
          return ok(data);
        }
        const { data, error } = await admin.from('fin_pix_favorecidos')
          .upsert({ tenant_id: tid, name, pix_key: k.key, pix_key_kind: k.kind, is_active: true, created_by: user.id }, { onConflict: 'tenant_id,pix_key' })
          .select('id, name, pix_key, pix_key_kind').single();
        if (error) throw new Error(error.message);
        return ok(data);
      }
      case 'pix_allow_remove': {
        await checkAllowPin(admin, cfg, body.pin);
        const tid = await interTenantId(admin);
        if (!UUID_RE.test(String(body.id ?? ''))) return fail('id inválido');
        const { error } = await admin.from('fin_pix_favorecidos').update({ is_active: false }).eq('id', String(body.id)).eq('tenant_id', tid);
        if (error) throw new Error(error.message);
        return ok(null);
      }
      case 'whatsapp_state':
        return ok(await whatsappState());

      case 'whatsapp_connect': {
        const st = await whatsappState();
        if (st.state === 'open') return ok({ state: 'open' });
        const out = await evoGet(`/instance/connect/${evoInstance}`);
        const b64 = typeof out?.base64 === 'string' ? out.base64 : null;
        return ok({
          state: st.state,
          qr: b64 ? (b64.startsWith('data:') ? b64 : `data:image/png;base64,${b64}`) : null,
          pairingCode: out?.pairingCode ?? null,
        });
      }

      default:
        return fail(`Ação desconhecida: ${body.action}`);
    }
  } catch (e) {
    console.error(JSON.stringify({ fn: 'assistente-config', action: body.action, error: errMsg(e) }));
    return fail(errMsg(e), 500);
  }
});

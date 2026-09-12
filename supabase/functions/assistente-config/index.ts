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
          admin.from('asst_messages').select('id, role, content, channel, created_at').order('created_at', { ascending: false }).limit(80),
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
          usage30d: { replies: (usageRows.data ?? []).length, usd: Math.round(usd * 100) / 100 },
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

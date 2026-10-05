// ifood-avisos — avisos do iFood no celular (área iFood, 2026-10-05; ideias aprovadas pelo dono).
//
// Chamada pelo cron `ifood-avisos` (a cada 10 min, fn_ifood_avisos_cron) com x-internal-key = FISCAL_INTERNAL_KEY.
// Para cada loja:
//   • "A loja fechou sozinha no iFood" — no horário de funcionamento, fechada por um motivo que não é o horário
//     nem uma pausa da própria loja (status/pausas/horário pela ifood-shipping merchant_overview). 1 por loja/dia.
//   • "Avaliação ruim" — nota ≤ 2 sem resposta nas últimas 48 h (reviews_list). 1 por avaliação.
//   • "O repasse caiu?" — repasse de hoje que bateu com o banco, ou o de ontem que não bateu (fin_ifood_repasses_base,
//     a mesma conta da tela). 1 por data de repasse.
// Enquanto o iFood não libera os módulos Loja/Avaliações em produção, as chamadas voltam erro e nada é avisado.
// Quem recebe: admin da loja + quem tem a permissão (padrão do cargo → cargo na loja → pessoa), pela mesma regra
// de _shared/permissoes-padrao.ts. Grava em `avisos` (idempotente por user/kind/ref) já com push_em e manda o push
// daqui, com o link para a aba certa da /ifood (o push do assistente-cron mandaria para /modulos).

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { permissoesDaPessoa } from '../_shared/permissoes-padrao.ts';
import { agoraBR, fechouSozinha, avaliacoesRuins, avisoRepasse } from './regras.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const INTERNAL = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const log = (level: string, msg: string, ctx: Record<string, unknown> = {}) => console.log(JSON.stringify({ fn: 'ifood-avisos', level, msg, ...ctx }));
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

// deno-lint-ignore no-explicit-any
async function shipping(action: string, tenantId: string, extra: Record<string, unknown> = {}): Promise<any> {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/ifood-shipping`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL, apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ action, tenant_id: tenantId, ...extra }),
  });
  return r.json().catch(() => ({ success: false }));
}

/** Quem recebe: admin sempre; os demais pela permissão (qualquer uma das chaves). */
async function destinatarios(admin: SupabaseClient, tenantId: string, chaves: string[]): Promise<string[]> {
  const [{ data: vinc }, { data: cargo }, { data: pessoa }] = await Promise.all([
    admin.from('user_tenants').select('user_id, role, users!inner(is_active, deleted_at)').eq('tenant_id', tenantId),
    admin.from('permissions').select('role, permission_key, allowed').eq('tenant_id', tenantId).in('permission_key', chaves),
    admin.from('user_permissions').select('user_id, permission_key, allowed').eq('tenant_id', tenantId).in('permission_key', chaves),
  ]);
  const out: string[] = [];
  // deno-lint-ignore no-explicit-any
  for (const v of (vinc ?? []) as any[]) {
    if (v.users?.is_active === false || v.users?.deleted_at) continue;
    const role = String(v.role);
    if (role === 'admin') { out.push(v.user_id); continue; }
    // deno-lint-ignore no-explicit-any
    const lc = ((cargo ?? []) as any[]).filter((c) => c.role === role);
    // deno-lint-ignore no-explicit-any
    const lp = ((pessoa ?? []) as any[]).filter((p) => p.user_id === v.user_id);
    const perms = new Set<string>(permissoesDaPessoa(role, lc, lp));
    if (chaves.some((k) => perms.has(k))) out.push(v.user_id);
  }
  return [...new Set(out)];
}

async function avisar(admin: SupabaseClient, tenantId: string, chaves: string[], kind: string, ref: string, resumo: string, url: string, titulo: string) {
  const quem = await destinatarios(admin, tenantId, chaves);
  if (!quem.length) return 0;
  const painel = { t: titulo, s: 'iFood', lin: [{ t: '', i: [{ l: resumo }] }], bt: [{ l: 'Abrir o iFood', r: url, i: 'ri-e-bike-2-line' }] };
  const { data, error } = await admin.from('avisos').upsert(
    quem.map((user_id) => ({ user_id, tenant_id: tenantId, kind, ref, resumo, painel, push_em: new Date().toISOString() })),
    { onConflict: 'user_id,kind,ref', ignoreDuplicates: true },
  ).select('user_id');
  if (error) { log('WARN', 'avisos', { error: error.message, kind }); return 0; }
  const novos = ((data ?? []) as Array<{ user_id: string }>).map((d) => d.user_id);
  if (!novos.length) return 0; // já avisado antes
  await fetch(`${SUPABASE_URL}/functions/v1/send-push`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    body: JSON.stringify({ action: 'send', user_ids: novos, payload: { titulo, corpo: resumo.slice(0, 200), url, tag: `${kind}-${ref}` } }),
  }).catch((e) => log('WARN', 'push', { error: String(e) }));
  return novos.length;
}

/** Quanto a loja do iFood costuma vender nesta hora deste dia da semana (média das 4 últimas semanas). */
async function vendaNaHora(admin: SupabaseClient, tenantId: string, merchantId: string): Promise<number | null> {
  const desde = new Date(Date.now() - 28 * 86400_000).toISOString();
  const { data } = await admin.from('fin_ifood_sales').select('sale_created_at, gross_bag').eq('tenant_id', tenantId).eq('merchant_id', merchantId).gte('sale_created_at', desde).limit(5000);
  const a = agoraBR();
  let soma = 0;
  for (const s of (data ?? []) as Array<{ sale_created_at: string; gross_bag: number | null }>) {
    const b = agoraBR(new Date(s.sale_created_at));
    if (b.semana === a.semana && Math.floor(b.minutos / 60) === Math.floor(a.minutos / 60)) soma += Number(s.gross_bag) || 0;
  }
  return soma > 0 ? soma / 4 : null;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!INTERNAL || req.headers.get('x-internal-key') !== INTERNAL) return json({ error: 'Unauthorized' }, 401);
  const admin = createClient(SUPABASE_URL, SERVICE, { auth: { persistSession: false } });
  const agora = agoraBR();
  const ontem = agoraBR(new Date(Date.now() - 86400_000)).dia;
  const res: Record<string, unknown>[] = [];

  // 1 e 2) Loja e avaliações: lojas com pedidos do iFood ligados.
  const { data: cfgs } = await admin.from('ifood_pdv_config').select('tenant_id, order_enabled, order_merchant_ids').eq('order_enabled', true);
  // deno-lint-ignore no-explicit-any
  for (const c of (cfgs ?? []) as any[]) {
    const { data: nomes } = await admin.from('fin_ifood_merchants').select('merchant_id, name').eq('tenant_id', c.tenant_id);
    const nomeDe = (id: string) => ((nomes ?? []) as Array<{ merchant_id: string; name: string | null }>).find((n) => n.merchant_id === id)?.name?.trim() || 'sua loja';
    for (const m of (c.order_merchant_ids ?? []) as string[]) {
      try {
        const ov = await shipping('merchant_overview', c.tenant_id, { merchant_id: m });
        if (ov?.success && ov.status) {
          const f = fechouSozinha(ov.status, ov.interruptions, ov.opening_hours, agora);
          if (f.fechou) {
            const media = await vendaNaHora(admin, c.tenant_id, m);
            const resumo = `A ${nomeDe(m)} está fechada no iFood (${agora.hhmm})${f.motivo ? `: ${f.motivo}` : ''}.${media ? ` Nessa hora ela costuma vender uns ${brl(media)}.` : ''}`;
            const n = await avisar(admin, c.tenant_id, ['gestao_delivery', 'gestao_pedidos', 'rel_ifood'], 'ifood_loja_fechou', `${m}:${agora.dia}`, resumo, '/ifood?aba=loja', 'Loja fechada no iFood');
            res.push({ tenant: c.tenant_id, loja: m, fechou: true, avisados: n });
          }
        }
        if (agora.minutos >= 9 * 60 && agora.minutos <= 23 * 60 + 30) {
          const rv = await shipping('reviews_list', c.tenant_id, { merchant_id: m, date_from: ontem, date_to: agora.dia, page_size: 50 });
          if (rv?.success) {
            for (const a of avaliacoesRuins(rv)) {
              const resumo = `Avaliação ${a.nota}★ na ${nomeDe(m)}${a.pedido ? ` (#${a.pedido})` : ''}: "${a.comentario || 'sem comentário'}". Tem resposta sugerida pronta.`;
              await avisar(admin, c.tenant_id, ['rel_ifood', 'gestao_delivery'], 'ifood_avaliacao_ruim', a.id, resumo, '/ifood?aba=loja', 'Avaliação ruim no iFood');
            }
          }
        }
      } catch (e) { log('WARN', 'loja', { tenant: c.tenant_id, merchant: m, error: String(e) }); }
    }
  }

  // 3) Repasse: a partir das 10h (o crédito do Inter chega pela manhã), lojas com o financeiro do iFood ligado.
  if (agora.minutos >= 10 * 60) {
    const { data: lojas } = await admin.from('fin_ifood_merchants').select('tenant_id').eq('api_sync', true);
    for (const t of [...new Set(((lojas ?? []) as Array<{ tenant_id: string }>).map((l) => l.tenant_id))]) {
      try {
        const de = agoraBR(new Date(Date.now() - 3 * 86400_000)).dia;
        const { data, error } = await admin.rpc('fin_ifood_repasses_base', { p_tenant: t, p_from: de, p_to: agora.dia });
        if (error) { log('WARN', 'repasses', { tenant: t, error: error.message }); continue; }
        const av = avisoRepasse(data ?? [], agora.dia, ontem);
        if (av) {
          const n = await avisar(admin, t, ['fin_ifood'], 'ifood_repasse', `${t}:${av.ref}`, av.resumo, '/ifood?aba=dinheiro', av.ok ? 'Repasse do iFood' : 'Repasse do iFood não bateu');
          res.push({ tenant: t, repasse: av.ref, ok: av.ok, avisados: n });
        }
      } catch (e) { log('WARN', 'repasse', { tenant: t, error: String(e) }); }
    }
  }
  log('INFO', 'rodou', { n: res.length });
  return json({ success: true, results: res });
});

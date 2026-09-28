// trafego-pesquisador — Agente Pesquisador do manual do gestor de tráfego (2026-09-28).
// Contexto: PLANO-TRAFEGO-PAGO-AGENTES.md §3.1c item 2 e MANUAL-GESTOR-TRAFEGO-PAGO.md.
//
// 1x por mês (cron dia 1, 07h BRT) ou pelo botão (admin): Sonnet 5 com busca na web confere os
// itens do manual (trafego_manual_itens) e procura mudanças recentes da Meta relevantes para
// restaurante pequeno com delivery próprio → texto livre com as fontes → Haiku estrutura em
// propostas (JSON) → o CÓDIGO decide o destino:
//   - fonte oficial da Meta (host facebook.com/meta.com/fb.com… E a URL apareceu de fato nos
//     resultados da busca) + confirmar/alterar item existente → aplicada sozinha (item atualizado);
//   - nova regra de fonte oficial → aplicada (item novo, confiança "oficial");
//   - o resto (mercado, sem fonte, alerta) → "a testar" ou "pendente" para o admin decidir.
// Ações: run (interno ou admin; responde na hora e roda em segundo plano), list, decide (admin).
// Segredos: ANTHROPIC_API_KEY, FISCAL_INTERNAL_KEY.
import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import { authenticate, tenantRole, roleRank } from '../_shared/tenant-auth.ts';
import { registrarUsoIa, custoIaUsd } from '../_shared/ai-usage.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-internal-key',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const MODELO_PESQUISA = 'claude-sonnet-5'; // plano: Pesquisador em Sonnet (busca + julgamento de fonte)
const MODELO_ESTRUTURA = 'claude-haiku-4-5'; // só transforma o relatório em JSON
const MAX_BUSCAS = 12;
const HOSTS_META = ['facebook.com', 'meta.com', 'fb.com', 'instagram.com', 'whatsapp.com'];

type Row = Record<string, unknown>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const log = (level: 'INFO' | 'WARN' | 'ERROR', msg: string, extra?: unknown) =>
  console.log(`[trafego-pesquisador] ${level} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 1200) : ''}`);

function hostOficial(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const h = new URL(url).hostname.toLowerCase();
    return HOSTS_META.some((d) => h === d || h.endsWith(`.${d}`));
  } catch { return false; }
}
const semBarra = (u: string) => u.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase();

const SYSTEM_PESQUISA = `Você é o pesquisador do manual de um agente gestor de tráfego pago (Meta Ads) para restaurantes pequenos no Brasil com delivery próprio (WhatsApp/cardápio online), orçamento de R$ 20–100/dia. Hoje é {HOJE}.

Tarefa: (1) para cada item do manual abaixo marcado "oficial_a_confirmar" ou "mercado", procure a página OFICIAL da Meta (Central de Ajuda para Empresas, Meta for Developers, Transparency Center, Meta for Business) e diga se ela confirma, contradiz ou não trata do item; (2) procure mudanças da Meta nos últimos ~60 dias que afetem esse tipo de conta (objetivos, WhatsApp/clique para conversa e seu preço, políticas de álcool/comida, atribuição, Advantage+, orçamento, aprendizado).

Hierarquia de fontes: 1) página oficial da Meta; 2) estudo com dados e metodologia; 3) gestores/agências só quando 2+ fontes independentes concordam. Não invente número nem URL. Para cada achado, dê a URL exata que você leu e uma paráfrase curta do que ela diz (citação literal só se for essencial e com até 15 palavras). Se não achou, diga "não achei". Responda em português, em lista por item (use a chave do item) e depois uma lista de mudanças novas.`;

const PROPOSTAS_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['propostas'],
  properties: {
    propostas: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['item_chave', 'tipo', 'resumo', 'regra', 'valor', 'fonte_url', 'trecho'],
        properties: {
          item_chave: { type: ['string', 'null'] },
          tipo: { type: 'string', enum: ['confirmar', 'alterar', 'nova', 'alerta'] },
          resumo: { type: 'string' },
          regra: { type: ['string', 'null'] },
          valor: { type: ['string', 'null'] },
          fonte_url: { type: ['string', 'null'] },
          trecho: { type: ['string', 'null'] },
        },
      },
    },
  },
};
const SYSTEM_ESTRUTURA = `Transforme o relatório de pesquisa em propostas para o manual. Uma proposta por achado com fonte. tipo: "confirmar" (a fonte confirma o item como está), "alterar" (a fonte muda regra/valor do item; preencha regra e/ou valor novos), "nova" (regra que não existe no manual; item_chave null; preencha regra e valor), "alerta" (mudança/risco sem regra clara). item_chave só com uma das chaves existentes, exatamente como escrita. fonte_url exatamente como no relatório (null se não houver). trecho = paráfrase curta (até 200 caracteres). Não crie proposta para "não achei". Português.`;

// ─── Rodada ──────────────────────────────────────────────────────────────────
// deno-lint-ignore no-explicit-any
type Msg = any;

// quem: loja e pessoa que pediram (custo da IA na tela Assistente › Custos da IA); cron = sem loja.
async function pesquisar(admin: SupabaseClient, pesquisaId: string, quem: { tenantId: string | null; userId: string | null } = { tenantId: null, userId: null }) {
  const client = new Anthropic({ apiKey: Deno.env.get('ANTHROPIC_API_KEY') ?? '' });
  const { data: itens } = await admin.from('trafego_manual_itens').select('chave, tema, regra, valor, confianca, fonte_url, verificado_em, status').neq('status', 'revogada').order('tema');
  const lista = ((itens ?? []) as Row[]).map((i) => `- ${i.chave} [${i.confianca}] ${i.tema}: ${i.regra}${i.valor ? ` = ${i.valor}` : ''}${i.fonte_url ? ` (fonte atual: ${i.fonte_url})` : ''}`).join('\n');
  const hoje = new Date().toISOString().slice(0, 10);

  // 1) Pesquisa com busca na web. pause_turn = a busca pausou o turno; reenvia para continuar.
  const messages: Msg[] = [{ role: 'user', content: `Itens atuais do manual:\n${lista}\n\nFaça a pesquisa.` }];
  const usos: Row[] = []; let buscas = 0;
  const urlsVistas = new Set<string>();
  let relatorio = '';
  for (let volta = 0; volta < 5; volta++) {
    // deno-lint-ignore no-explicit-any
    const r: any = await client.messages.create({
      model: MODELO_PESQUISA, max_tokens: 16000,
      system: SYSTEM_PESQUISA.replace('{HOJE}', hoje),
      tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: MAX_BUSCAS }],
      messages,
    // deno-lint-ignore no-explicit-any
    } as any);
    usos.push(r.usage ?? {});
    await registrarUsoIa(admin, { feature: 'trafego-pesquisador', model: r.model ?? MODELO_PESQUISA, usage: r.usage, ref: pesquisaId, tenantId: quem.tenantId, userId: quem.userId });
    buscas += Number(r.usage?.server_tool_use?.web_search_requests ?? 0);
    for (const b of (r.content ?? []) as Row[]) {
      if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) {
        for (const res of b.content as Row[]) if (res.url) urlsVistas.add(semBarra(String(res.url)));
      }
      if (b.type === 'text') {
        relatorio += String(b.text);
        for (const c of ((b.citations ?? []) as Row[])) if (c.url) urlsVistas.add(semBarra(String(c.url)));
      }
    }
    if (r.stop_reason === 'refusal') throw new Error('A IA recusou a pesquisa.');
    if (r.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: r.content });
  }
  if (!relatorio.trim()) throw new Error('A pesquisa não devolveu texto.');

  // 2) Estruturar em propostas.
  const chaves = ((itens ?? []) as Row[]).map((i) => String(i.chave));
  // deno-lint-ignore no-explicit-any
  const e: any = await client.messages.create({
    model: MODELO_ESTRUTURA, max_tokens: 8000, system: SYSTEM_ESTRUTURA,
    output_config: { format: { type: 'json_schema', schema: PROPOSTAS_SCHEMA } },
    messages: [{ role: 'user', content: `Chaves existentes: ${chaves.join(', ')}\n\nRelatório:\n${relatorio}` }],
  // deno-lint-ignore no-explicit-any
  } as any);
  usos.push(e.usage ?? {});
  await registrarUsoIa(admin, { feature: 'trafego-pesquisador', model: e.model ?? MODELO_ESTRUTURA, usage: e.usage, ref: pesquisaId, tenantId: quem.tenantId, userId: quem.userId });
  const texto = (e.content ?? []).filter((b: Row) => b.type === 'text').map((b: Row) => String(b.text)).join('');
  const propostas = ((JSON.parse(texto) as Row).propostas ?? []) as Row[];

  // 3) Destino decidido no código.
  const itemPor = new Map(((itens ?? []) as Row[]).map((i) => [String(i.chave), i]));
  let aplicadas = 0;
  for (const p of propostas.slice(0, 40)) {
    const tipo = String(p.tipo);
    const chave = p.item_chave && itemPor.has(String(p.item_chave)) ? String(p.item_chave) : null;
    const url = p.fonte_url ? String(p.fonte_url).slice(0, 500) : null;
    // Oficial = host da Meta E a URL saiu mesmo da busca (não aceita URL inventada).
    const oficial = !!url && hostOficial(url) && urlsVistas.has(semBarra(url));
    let status = 'pendente';
    if (oficial && chave && (tipo === 'confirmar' || tipo === 'alterar')) status = 'aplicada';
    else if (oficial && tipo === 'nova' && p.regra) status = 'aplicada';
    else if (tipo === 'alterar' || tipo === 'nova') status = 'a_testar';
    if (tipo === 'alerta') status = 'pendente';

    const { data: ins } = await admin.from('trafego_manual_propostas').insert({
      pesquisa_id: pesquisaId, item_chave: chave, tipo, resumo: String(p.resumo ?? '').slice(0, 600),
      regra: p.regra ? String(p.regra).slice(0, 400) : null, valor: p.valor ? String(p.valor).slice(0, 120) : null,
      fonte_url: url, fonte_oficial: oficial, trecho: p.trecho ? String(p.trecho).slice(0, 300) : null, status,
      decided_by: status === 'aplicada' ? 'Pesquisador (fonte oficial)' : null, decided_at: status === 'aplicada' ? new Date().toISOString() : null,
    }).select('id').single();
    if (status === 'aplicada' && ins) { await aplicar(admin, { ...p, item_chave: chave, fonte_url: url, tipo }, true); aplicadas += 1; }
  }

  const custo = usos.reduce((s: number, u, i) => s + custoIaUsd(i === usos.length - 1 ? MODELO_ESTRUTURA : MODELO_PESQUISA, u), 0) + buscas * 0.01;
  await admin.from('trafego_pesquisas').update({
    status: 'done', finished_at: new Date().toISOString(), model: MODELO_PESQUISA, buscas, custo_usd: Math.round(custo * 10000) / 10000,
    usage: { chamadas: usos }, relatorio: relatorio.slice(0, 60000),
  }).eq('id', pesquisaId);
  log('INFO', 'pesquisa ok', { pesquisaId, buscas, propostas: propostas.length, aplicadas, custo });
}

// Aplica uma proposta ao manual estruturado.
async function aplicar(admin: SupabaseClient, p: Row, oficial: boolean) {
  const hoje = new Date().toISOString().slice(0, 10);
  const tipo = String(p.tipo);
  if (p.item_chave && (tipo === 'confirmar' || tipo === 'alterar')) {
    const patch: Row = { verificado_em: hoje, updated_at: new Date().toISOString() };
    if (oficial) { patch.confianca = 'oficial'; patch.fonte_url = p.fonte_url; }
    if (tipo === 'alterar') { if (p.regra) patch.regra = p.regra; if (p.valor) patch.valor = p.valor; if (!oficial) patch.status = 'a_testar'; }
    await admin.from('trafego_manual_itens').update(patch).eq('chave', String(p.item_chave));
  } else if (tipo === 'nova' && p.regra) {
    const chave = String(p.regra).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').slice(0, 40).replace(/^_|_$/g, '') + '_' + hoje.replace(/-/g, '');
    await admin.from('trafego_manual_itens').insert({
      chave, tema: 'Novo (Pesquisador)', regra: String(p.regra).slice(0, 400), valor: p.valor ? String(p.valor).slice(0, 120) : null,
      confianca: oficial ? 'oficial' : 'mercado', fonte_url: p.fonte_url ?? null, verificado_em: hoje, status: oficial ? 'vigente' : 'a_testar',
    });
  }
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? '');
    const internalKey = Deno.env.get('FISCAL_INTERNAL_KEY') ?? '';
    const interno = internalKey.length >= 20 && (req.headers.get('x-internal-key') ?? '') === internalKey;

    // Manual é global, mas o acesso passa pela loja do usuário: membro lê, admin roda/decide.
    let quem = 'Sistema'; let ehAdmin = interno;
    let quemIds: { tenantId: string | null; userId: string | null } = { tenantId: null, userId: null };
    if (!interno) {
      const caller = await authenticate(req, admin);
      if (!caller) return json({ success: false, error: 'Não autenticado' }, 401);
      if (!caller.isServiceRole) {
        const tenantId = String(body.tenant_id ?? '');
        const role = tenantId ? await tenantRole(admin, caller.userId!, tenantId) : null;
        if (!role) return json({ success: false, error: 'Sem acesso' }, 403);
        ehAdmin = roleRank(role) >= 3;
        quemIds = { tenantId, userId: caller.userId ?? null };
        const { data: u } = await admin.from('users').select('name').eq('id', caller.userId!).maybeSingle();
        quem = String(u?.name ?? caller.email ?? 'Admin');
      } else ehAdmin = true;
    }

    if (action === 'run') {
      if (!ehAdmin) return json({ success: false, error: 'Só admin' }, 403);
      const { data: emAndamento } = await admin.from('trafego_pesquisas').select('id').eq('status', 'running').gte('started_at', new Date(Date.now() - 15 * 60000).toISOString()).limit(1).maybeSingle();
      if (emAndamento) return json({ success: false, error: 'Já tem uma pesquisa rodando.' }, 409);
      const { data: p, error } = await admin.from('trafego_pesquisas').insert({ trigger: interno ? 'cron' : 'manual', requested_by: quem }).select('id').single();
      if (error || !p) return json({ success: false, error: error?.message ?? 'não criou a pesquisa' }, 500);
      const id = String(p.id);
      const tarefa = pesquisar(admin, id, quemIds).catch(async (e) => {
        const msg = e instanceof Error ? e.message : String(e);
        log('ERROR', 'pesquisa falhou', { id, msg });
        await admin.from('trafego_pesquisas').update({ status: 'error', finished_at: new Date().toISOString(), error: msg.slice(0, 1000) }).eq('id', id);
      });
      // Leva 1–3 min: responde já e segue em segundo plano.
      // deno-lint-ignore no-explicit-any
      const rt = (globalThis as any).EdgeRuntime;
      if (rt?.waitUntil) rt.waitUntil(tarefa); else await tarefa;
      return json({ success: true, pesquisa_id: id });
    }

    if (action === 'list') {
      const [{ data: itens }, { data: pesquisas }, { data: propostas }] = await Promise.all([
        admin.from('trafego_manual_itens').select('*').order('tema').order('chave'),
        admin.from('trafego_pesquisas').select('id, trigger, status, started_at, finished_at, buscas, custo_usd, error, requested_by').order('started_at', { ascending: false }).limit(6),
        admin.from('trafego_manual_propostas').select('*').order('created_at', { ascending: false }).limit(80),
      ]);
      return json({ success: true, is_admin: ehAdmin, itens: itens ?? [], pesquisas: pesquisas ?? [], propostas: propostas ?? [] });
    }

    if (action === 'relatorio') {
      const { data } = await admin.from('trafego_pesquisas').select('relatorio').eq('id', String(body.pesquisa_id ?? '')).maybeSingle();
      return json({ success: true, relatorio: data?.relatorio ?? null });
    }

    if (action === 'decide') {
      if (!ehAdmin) return json({ success: false, error: 'Só admin' }, 403);
      const decisao = String(body.decisao ?? '');
      if (!['aplicar', 'rejeitar'].includes(decisao)) return json({ success: false, error: 'decisao: aplicar | rejeitar' }, 400);
      const { data: p } = await admin.from('trafego_manual_propostas').select('*').eq('id', String(body.proposta_id ?? '')).maybeSingle();
      if (!p) return json({ success: false, error: 'Proposta não encontrada' }, 404);
      if (!['pendente', 'a_testar'].includes(String(p.status))) return json({ success: false, error: `Proposta já está "${p.status}"` }, 409);
      if (decisao === 'aplicar') await aplicar(admin, p as Row, !!p.fonte_oficial);
      await admin.from('trafego_manual_propostas').update({ status: decisao === 'aplicar' ? 'aplicada' : 'rejeitada', decided_by: quem, decided_at: new Date().toISOString() }).eq('id', String(p.id));
      return json({ success: true });
    }

    return json({ success: false, error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    log('ERROR', 'handler', String(err));
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

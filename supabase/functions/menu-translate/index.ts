// menu-translate — cardápio em outros idiomas (inglês/espanhol) para as telas
// do CLIENTE (delivery, mesa-qr, totem).
//
// Princípio: o português é a fonte da verdade e nunca sai daqui. A tradução é
// uma camada sobreposta (menu_translations) aplicada só na RESPOSTA dos canais
// públicos. Pedido, KDS e impressão da cozinha seguem em português SEMPRE.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   get_locales                          idiomas que a loja oferece
//   set_locales  { locales: [...] }      grava quais idiomas ficam ligados (admin/gerente)
//   list         { locale }              tudo que é traduzível + tradução + status
//   translate    { locale, scope }       IA traduz o que falta ('missing') ou tudo ('all')
//   upsert       { locale, entity_type, entity_id, name, description }   correção manual
//   remove       { locale, entity_type, entity_id }                      apaga a tradução
//
// Autenticação: JWT do usuário com vínculo na loja. Escrita exige admin/gerente.
// Secret necessário: ANTHROPIC_API_KEY (só na ação translate).

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import { authenticate, tenantRole, isManagerRole } from '../_shared/tenant-auth.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Haiku 4.5: tradução de cardápio é tarefa simples e o volume é alto (um
// cardápio inteiro por vez). Se vier tradução ruim de descrição longa, subir
// para 'claude-sonnet-5' — medir antes/depois.
const MODEL = 'claude-haiku-4-5';
// Lote pequeno o bastante para o modelo não perder itens no caminho e grande
// o bastante para não virar 100 chamadas.
const BATCH_SIZE = 25;
// Edge Function tem tempo de parede limitado; um cardápio inteiro não cabe numa
// chamada só. Cada invocação traduz no máximo isto e devolve `remaining` — a
// tela chama de novo até zerar.
const MAX_BATCHES_PER_CALL = 6;

const SUPPORTED_LOCALES: Record<string, string> = {
  en: 'inglês (English)',
  es: 'espanhol (Español)',
};

type EntityType = 'item' | 'category' | 'option_group' | 'option' | 'preset_obs';

interface Source {
  entity_type: EntityType;
  entity_id: string;
  name: string;
  description: string | null;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);

function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'menu-translate', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}

/** md5 do texto PT de origem. Muda o português → a tradução fica marcada como velha. */
async function sourceHash(name: string, description: string | null): Promise<string> {
  const data = new TextEncoder().encode(`${name ?? ''}\n${description ?? ''}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ── O que é traduzível ───────────────────────────────────────────────────────
async function loadSources(admin: any, tenantId: string): Promise<Source[]> {
  const [cats, items, groups, opts, obs] = await Promise.all([
    admin.from('menu_categories').select('id, name').eq('tenant_id', tenantId).is('deleted_at', null),
    admin.from('menu_items').select('id, name, description').eq('tenant_id', tenantId).is('deleted_at', null),
    admin.from('option_groups').select('id, name').eq('tenant_id', tenantId).is('deleted_at', null),
    admin.from('options').select('id, name, description').eq('tenant_id', tenantId).is('deleted_at', null),
    admin.from('item_preset_observations').select('id, text').eq('tenant_id', tenantId).is('deleted_at', null),
  ]);

  const out: Source[] = [];
  for (const c of (cats.data ?? [])) out.push({ entity_type: 'category', entity_id: c.id, name: c.name ?? '', description: null });
  for (const i of (items.data ?? [])) out.push({ entity_type: 'item', entity_id: i.id, name: i.name ?? '', description: i.description ?? null });
  for (const g of (groups.data ?? [])) out.push({ entity_type: 'option_group', entity_id: g.id, name: g.name ?? '', description: null });
  for (const o of (opts.data ?? [])) out.push({ entity_type: 'option', entity_id: o.id, name: o.name ?? '', description: o.description ?? null });
  for (const b of (obs.data ?? [])) out.push({ entity_type: 'preset_obs', entity_id: b.id, name: b.text ?? '', description: null });
  return out.filter((s) => s.name.trim() !== '');
}

const keyOf = (t: string, id: string) => `${t}:${id}`;

// ── Prompt ───────────────────────────────────────────────────────────────────
// A regra que mais importa: nome de prato mexicano NÃO se traduz. "Burrito
// Barbacoa" continua "Burrito Barbacoa" em qualquer idioma — quem traduz isso
// para "Shredded Beef Wrap" destrói a identidade do cardápio e confunde o
// cliente que já conhece a casa.
function buildPrompt(locale: string, batch: Source[]): string {
  const idioma = SUPPORTED_LOCALES[locale] ?? locale;
  const linhas = batch.map((s, i) => {
    const desc = s.description && s.description.trim() !== '' ? s.description.trim() : null;
    return `${i + 1}. NOME: ${s.name}${desc ? `\n   DESCRICAO: ${desc}` : ''}`;
  }).join('\n');

  return `Você traduz o cardápio de um restaurante mexicano brasileiro do português para ${idioma}.

REGRAS (nesta ordem de prioridade):

1. NOME DE PRATO NÃO SE TRADUZ. Palavras da cozinha mexicana ficam idênticas:
   Burrito, Burritos, Quesadilla, Quesadillas, Taco, Tacos, Nachos, Bowl,
   Ensalada, Guacamole, Sour Cream, Pico de Gallo, Pico de Galo, Chilli con
   Carne, Al Pastor, Barbacoa, Pollo, Veggie, Tortilla, Tortilha, Jalapeño,
   Churros, Chipotle, Habanero, Doritos, Cheddar, Barbecue, Sriracha.
   Nome de marca também fica: Coca-Cola, Fanta, Del Valle, Monster, Stella
   Artois, Corona, Ovomaltine.

2. TRADUZA SÓ O QUE É PORTUGUÊS DESCRITIVO em volta do nome:
   "Dupla Quesadilla Pollo" → "${locale === 'es' ? 'Quesadilla Pollo Doble' : 'Double Quesadilla Pollo'}"
   "Unidade Taco Barbacoa" → "${locale === 'es' ? 'Taco Barbacoa (unidad)' : 'Single Taco Barbacoa'}"
   "Batata frita com cheddar e bacon" → "${locale === 'es' ? 'Papas fritas con cheddar y bacon' : 'French fries with cheddar and bacon'}"
   "Água sem gás" → "${locale === 'es' ? 'Agua sin gas' : 'Still water'}"

3. DESCRIÇÃO é lista de ingredientes: traduza os ingredientes comuns (alface,
   tomate, frango, carne, queijo, molho, bacon crocante, pasta de feijão) e
   preserve os nomes mexicanos da regra 1.

4. Mantenha o tom e a pontuação do original. Se o original grita ("PROMO DO
   DIA"), a tradução grita. Não invente informação que não está no original,
   não acrescente ingrediente, não mude preço nem quantidade.

5. Se um texto já estiver em ${idioma} ou for só um número/código, devolva ele
   igual.

Traduza os ${batch.length} itens abaixo.

${linhas}

Responda SOMENTE com um array JSON, sem texto em volta, no formato:
[{"i":1,"name":"...","description":"..."}]
Use "description": null quando o item não tiver DESCRICAO.`;
}

function parseJsonArray(text: string): Array<Record<string, unknown>> {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = cleaned.indexOf('[');
  const end = cleaned.lastIndexOf(']');
  if (start < 0 || end <= start) throw new Error('resposta da IA sem array JSON');
  return JSON.parse(cleaned.slice(start, end + 1));
}

async function translateBatch(client: Anthropic, locale: string, batch: Source[]): Promise<Map<string, { name: string; description: string | null }>> {
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: buildPrompt(locale, batch) }],
  });
  const text = response.content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
  const rows = parseJsonArray(text);

  const out = new Map<string, { name: string; description: string | null }>();
  for (const row of rows) {
    const idx = Number(row.i);
    if (!Number.isFinite(idx) || idx < 1 || idx > batch.length) continue;
    const src = batch[idx - 1];
    const name = typeof row.name === 'string' ? row.name.trim() : '';
    if (name === '') continue;
    const desc = typeof row.description === 'string' && row.description.trim() !== '' ? row.description.trim() : null;
    out.set(keyOf(src.entity_type, src.entity_id), { name, description: desc });
  }
  return out;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { persistSession: false } },
  );

  try {
    const body = await req.json();
    const action = String(body.action ?? '');
    const tenantId = String(body.tenant_id ?? '').trim();
    if (!tenantId) return errResp('tenant_id é obrigatório.');

    const caller = await authenticate(req, admin);
    if (!caller) return errResp('Não autenticado.', 401);

    let role: string | null = null;
    if (!caller.isServiceRole) {
      role = await tenantRole(admin, caller.userId!, tenantId);
      if (!role) return errResp('Você não tem acesso a esta loja.', 403);
    }
    const canWrite = caller.isServiceRole || isManagerRole(role);

    // ── Idiomas da loja ──────────────────────────────────────────────────────
    if (action === 'get_locales') {
      const { data, error } = await admin.from('tenant_locales')
        .select('locale, is_active, sort_order').eq('tenant_id', tenantId).order('sort_order');
      if (error) throw error;
      return json({ success: true, locales: data ?? [], supported: Object.keys(SUPPORTED_LOCALES) });
    }

    if (action === 'set_locales') {
      if (!canWrite) return errResp('Só admin ou gerente pode mudar os idiomas da loja.', 403);
      const raw = Array.isArray(body.locales) ? body.locales : [];
      const locales = raw
        .map((l: any) => String(l?.locale ?? l ?? '').trim())
        .filter((l: string) => Object.prototype.hasOwnProperty.call(SUPPORTED_LOCALES, l));

      await admin.from('tenant_locales').delete().eq('tenant_id', tenantId);
      if (locales.length > 0) {
        const rows = locales.map((locale: string, i: number) => ({ tenant_id: tenantId, locale, is_active: true, sort_order: i }));
        const { error } = await admin.from('tenant_locales').insert(rows);
        if (error) throw error;
      }
      log('INFO', 'set_locales', 'idiomas da loja atualizados', { tenant_id: tenantId, locales });
      return json({ success: true, locales });
    }

    // ── Listagem para a tela de revisão ──────────────────────────────────────
    if (action === 'list') {
      const locale = String(body.locale ?? '').trim();
      if (!SUPPORTED_LOCALES[locale]) return errResp('Idioma não suportado.');

      const sources = await loadSources(admin, tenantId);
      const { data: trans, error } = await admin.from('menu_translations')
        .select('entity_type, entity_id, name, description, source, is_reviewed, source_text_hash, updated_at')
        .eq('tenant_id', tenantId).eq('locale', locale);
      if (error) throw error;

      const byKey = new Map<string, any>();
      for (const t of (trans ?? [])) byKey.set(keyOf(t.entity_type, t.entity_id), t);

      const rows = [];
      for (const s of sources) {
        const t = byKey.get(keyOf(s.entity_type, s.entity_id));
        const hash = await sourceHash(s.name, s.description);
        // 'missing'  nunca traduzido
        // 'stale'    traduzido, mas o português mudou depois
        // 'ok'       em dia
        const status = !t ? 'missing' : (t.source_text_hash && t.source_text_hash !== hash ? 'stale' : 'ok');
        rows.push({
          entity_type: s.entity_type, entity_id: s.entity_id,
          source_name: s.name, source_description: s.description,
          name: t?.name ?? null, description: t?.description ?? null,
          origin: t?.source ?? null, is_reviewed: t?.is_reviewed ?? false,
          status, updated_at: t?.updated_at ?? null,
        });
      }
      const counts = {
        total: rows.length,
        missing: rows.filter((r) => r.status === 'missing').length,
        stale: rows.filter((r) => r.status === 'stale').length,
        reviewed: rows.filter((r) => r.is_reviewed).length,
      };
      return json({ success: true, locale, rows, counts });
    }

    // ── Tradução pela IA ─────────────────────────────────────────────────────
    if (action === 'translate') {
      if (!canWrite) return errResp('Só admin ou gerente pode traduzir o cardápio.', 403);
      const locale = String(body.locale ?? '').trim();
      if (!SUPPORTED_LOCALES[locale]) return errResp('Idioma não suportado.');
      const scope = body.scope === 'all' ? 'all' : 'missing';

      const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
      if (!apiKey) return errResp('Tradução automática ainda não configurada (falta a chave ANTHROPIC_API_KEY no servidor).', 503);

      const sources = await loadSources(admin, tenantId);
      const { data: trans } = await admin.from('menu_translations')
        .select('entity_type, entity_id, source, source_text_hash')
        .eq('tenant_id', tenantId).eq('locale', locale);
      const byKey = new Map<string, any>();
      for (const t of (trans ?? [])) byKey.set(keyOf(t.entity_type, t.entity_id), t);

      // Tradução mexida por gente é respeitada: a IA nunca sobrescreve 'manual'.
      const pending: Source[] = [];
      for (const s of sources) {
        const t = byKey.get(keyOf(s.entity_type, s.entity_id));
        if (t?.source === 'manual') continue;
        if (!t) { pending.push(s); continue; }
        if (scope === 'all') { pending.push(s); continue; }
        const hash = await sourceHash(s.name, s.description);
        if (t.source_text_hash !== hash) pending.push(s);
      }

      if (pending.length === 0) return json({ success: true, translated: 0, remaining: 0, done: true, message: 'Nada a traduzir — já está tudo em dia.' });

      // O mesmo texto aparece muitas vezes: "Burrito Al Pastor" é item e também
      // opção dentro de vários grupos. Traduzir texto único e replicar para
      // todas as entidades que o usam corta custo e tempo sem mudar o resultado
      // — e garante que o mesmo prato não saia escrito de dois jeitos.
      const byText = new Map<string, Source[]>();
      for (const s of pending) {
        const k = `${s.name} ${s.description ?? ''}`;
        if (!byText.has(k)) byText.set(k, []);
        byText.get(k)!.push(s);
      }
      const uniqueTexts = [...byText.values()].map((group) => group[0]);
      const totalUnique = uniqueTexts.length;
      const slice = uniqueTexts.slice(0, MAX_BATCHES_PER_CALL * BATCH_SIZE);

      const client = new Anthropic({ apiKey });
      let saved = 0;
      const failed: string[] = [];

      for (let i = 0; i < slice.length; i += BATCH_SIZE) {
        const batch = slice.slice(i, i + BATCH_SIZE);
        let result: Map<string, { name: string; description: string | null }>;
        try {
          result = await translateBatch(client, locale, batch);
        } catch (err) {
          log('ERROR', 'translate', 'lote falhou', { tenant_id: tenantId, locale, from: i, error: String((err as Error).message).slice(0, 300) });
          failed.push(...batch.map((b) => b.name));
          continue;
        }

        const rows = [];
        for (const rep of batch) {
          const t = result.get(keyOf(rep.entity_type, rep.entity_id));
          if (!t) { failed.push(rep.name); continue; }
          const hash = await sourceHash(rep.name, rep.description);
          // replica para todas as entidades com o mesmo texto em português
          for (const s of byText.get(`${rep.name} ${rep.description ?? ''}`) ?? [rep]) {
            rows.push({
              tenant_id: tenantId, entity_type: s.entity_type, entity_id: s.entity_id, locale,
              name: t.name, description: t.description,
              source: 'ai', is_reviewed: false,
              source_text_hash: hash,
            });
          }
        }
        if (rows.length > 0) {
          const { error } = await admin.from('menu_translations')
            .upsert(rows, { onConflict: 'tenant_id,entity_type,entity_id,locale' });
          if (error) throw error;
          saved += rows.length;
        }
      }

      const remaining = Math.max(0, totalUnique - slice.length);
      log('INFO', 'translate', 'cardápio traduzido', { tenant_id: tenantId, locale, scope, pending: pending.length, unique: totalUnique, saved, remaining, failed: failed.length });
      return json({ success: true, translated: saved, unique: totalUnique, remaining, done: remaining === 0, failed, pending: pending.length });
    }

    // ── Correção manual ──────────────────────────────────────────────────────
    if (action === 'upsert') {
      if (!canWrite) return errResp('Só admin ou gerente pode editar a tradução.', 403);
      const locale = String(body.locale ?? '').trim();
      if (!SUPPORTED_LOCALES[locale]) return errResp('Idioma não suportado.');
      const entityType = String(body.entity_type ?? '') as EntityType;
      const entityId = String(body.entity_id ?? '').trim();
      const name = String(body.name ?? '').trim();
      if (!entityId || name === '') return errResp('entity_id e name são obrigatórios.');

      const sources = await loadSources(admin, tenantId);
      const src = sources.find((s) => s.entity_type === entityType && s.entity_id === entityId);
      if (!src) return errResp('Item não encontrado no cardápio desta loja.', 404);

      const description = typeof body.description === 'string' && body.description.trim() !== '' ? body.description.trim() : null;
      const { error } = await admin.from('menu_translations').upsert({
        tenant_id: tenantId, entity_type: entityType, entity_id: entityId, locale,
        name, description, source: 'manual', is_reviewed: true,
        source_text_hash: await sourceHash(src.name, src.description),
      }, { onConflict: 'tenant_id,entity_type,entity_id,locale' });
      if (error) throw error;
      return json({ success: true });
    }

    if (action === 'remove') {
      if (!canWrite) return errResp('Só admin ou gerente pode apagar a tradução.', 403);
      const locale = String(body.locale ?? '').trim();
      const entityType = String(body.entity_type ?? '');
      const entityId = String(body.entity_id ?? '').trim();
      const { error } = await admin.from('menu_translations').delete()
        .eq('tenant_id', tenantId).eq('locale', locale).eq('entity_type', entityType).eq('entity_id', entityId);
      if (error) throw error;
      return json({ success: true });
    }

    return errResp(`Ação desconhecida: ${action}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log('ERROR', 'handler', 'falha', { error: msg.slice(0, 500) });
    return errResp(msg, 500);
  }
});

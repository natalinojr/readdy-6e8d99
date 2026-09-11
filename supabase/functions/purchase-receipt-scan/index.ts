// purchase-receipt-scan — lê foto/PDF de cupom fiscal, notinha de mercado ou
// pedido de fornecedor e devolve os dados da compra já estruturados para a
// tela Nova Compra (Financeiro › Compras). O usuário só confere e vincula.
//
// Ações (POST JSON { action, tenant_id, ... }):
//   scan  { file_base64, media_type }   lê o documento com o Claude e sugere, por linha,
//                                       o insumo/apresentação do catálogo e as categorias.
//                                       Vínculos já confirmados antes (purchase_receipt_item_links)
//                                       têm prioridade sobre a sugestão da IA.
//   learn { supplier_key, items: [{ raw_description, ingredient_id?, catalog_id?,
//           merchandise_category_id?, dre_category_id?, unit_label?, pack_count?, pack_size? }] }
//                                       memoriza o que o usuário confirmou ao salvar a compra.
//
// Autenticação: JWT do usuário (membership em user_tenants).
// Secret necessário: ANTHROPIC_API_KEY.

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const MODEL = 'claude-opus-5';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const PAYMENT_METHODS = ['Dinheiro', 'PIX', 'Cartão Débito', 'Cartão Crédito', 'Boleto', 'Transferência'];

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
const errResp = (msg: string, status = 400) => json({ success: false, error: msg }, status);
function log(level: 'INFO' | 'WARN' | 'ERROR', action: string, msg: string, ctx?: Record<string, unknown>) {
  const e = JSON.stringify({ ts: new Date().toISOString(), fn: 'purchase-receipt-scan', level, action, msg, ...(ctx ?? {}) });
  if (level === 'ERROR') console.error(e); else if (level === 'WARN') console.warn(e); else console.log(e);
}
const round2 = (n: number) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const onlyDigits = (s: unknown) => String(s ?? '').replace(/\D/g, '');

// Chave de comparação: sem acento, minúsculas, só letras/números. "REQUEIJÃO CX 12X1,5KG"
// e "Requeijao cx 12x1.5kg" viram a mesma chave.
function normKey(s: unknown): string {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
// Fornecedor: CNPJ quando a nota traz (estável), senão o nome normalizado.
function supplierKeyOf(cnpj: unknown, name: unknown): string {
  const d = onlyDigits(cnpj);
  return d.length === 14 || d.length === 11 ? d : normKey(name);
}

// ── Schema da saída (structured outputs) ─────────────────────────────────────
const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const OUTPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['legivel', 'tipo_documento', 'fornecedor_nome', 'fornecedor_cnpj', 'numero_documento', 'data_compra',
    'forma_pagamento', 'valor_total', 'desconto_total', 'itens', 'avisos'],
  properties: {
    legivel: { type: 'boolean' },
    tipo_documento: { type: 'string', enum: ['cupom_fiscal', 'nfe_danfe', 'notinha_manual', 'pedido_orcamento', 'outro'] },
    fornecedor_nome: nullableString,
    fornecedor_cnpj: nullableString,
    numero_documento: nullableString,
    data_compra: nullableString,
    forma_pagamento: { type: ['string', 'null'], enum: [...PAYMENT_METHODS, null] },
    valor_total: nullableNumber,
    desconto_total: nullableNumber,
    itens: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['descricao', 'quantidade', 'unidade', 'preco_unitario', 'valor_total', 'desconto', 'vinculo_tipo',
          'vinculo_id', 'categoria_mercadoria_id', 'categoria_dre_id', 'embalagem_qtd', 'embalagem_conteudo', 'confianca'],
        properties: {
          descricao: { type: 'string' },
          quantidade: { type: 'number' },
          unidade: { type: 'string' },
          preco_unitario: { type: 'number' },
          valor_total: { type: 'number' },
          desconto: { type: 'number' },
          vinculo_tipo: { type: 'string', enum: ['catalogo', 'insumo', 'nenhum'] },
          vinculo_id: nullableString,
          categoria_mercadoria_id: nullableString,
          categoria_dre_id: nullableString,
          embalagem_qtd: nullableNumber,
          embalagem_conteudo: nullableNumber,
          confianca: { type: 'string', enum: ['alta', 'media', 'baixa'] },
        },
      },
    },
    avisos: { type: 'array', items: { type: 'string' } },
  },
};

const SYSTEM_PROMPT = `Você lê documentos de compra de um restaurante brasileiro (cupom fiscal, DANFE, notinha de mercado escrita à mão, pedido de fornecedor) e transcreve os dados para o sistema de compras.

Regras de leitura:
- Transcreva cada linha de produto exatamente como está no documento (descrição original, sem corrigir abreviações). Não invente itens; se uma linha estiver ilegível, inclua-a com confianca "baixa" e explique em avisos.
- quantidade, preco_unitario e valor_total são os números da linha (use ponto como separador decimal no JSON). Produto pesado (ex.: 1,235 kg × 39,90) tem quantidade 1.235 e unidade "kg".
- unidade: use uma destas quando der: un, kg, g, L, mL, cx, fardo, pacote, saco, lata, garrafa, bandeja, dúzia. Sem indicação, "un".
- desconto: desconto da linha em reais (0 se não houver). desconto_total: desconto dado no total do cupom, fora das linhas (null se não houver).
- Se valor_total da linha não bater com quantidade × preco_unitario − desconto, confira de novo a leitura e registre em avisos o que ficou divergente.
- embalagem_qtd/embalagem_conteudo só quando a descrição traz a embalagem explícita (ex.: "CX 12X1,5KG" → 12 e 1.5; "FD 6UN" → 6 e null). Caso contrário, null.
- data_compra no formato AAAA-MM-DD. fornecedor_cnpj só com dígitos. forma_pagamento só se o documento indicar.
- legivel = false quando a imagem não é um documento de compra ou não dá para ler; nesse caso itens vazio e explique em avisos.

Regras de vínculo (use SOMENTE ids das listas fornecidas; nunca invente id):
- Prefira o CATÁLOGO (apresentação do produto por fornecedor) quando for claramente o mesmo produto; senão o INSUMO de estoque; senão "nenhum".
- Só vincule quando for o mesmo produto de fato. Na dúvida, "nenhum" — um vínculo errado dá entrada no estoque errado.
- categoria_mercadoria_id: a categoria de mercadoria mais adequada da lista (ou null).
- categoria_dre_id: só para itens que NÃO são insumo de estoque (limpeza, descartáveis, material de escritório, manutenção...), a categoria de despesa da DRE mais adequada. Para comida/bebida/insumo use null.
- confianca reflete leitura + vínculo juntos.

avisos: frases curtas em português para o usuário conferir (ex.: "Total dos itens difere do total do cupom em R$ 2,00").`;

interface Candidates {
  ingredients: Array<{ id: string; name: string; unit: string }>;
  catalog: Array<{ id: string; name: string; ingredient_id: string | null; default_supplier: string | null; purchase_unit: string | null; pack_count: number | null; pack_size: number | null; merchandise_category_id: string | null; dre_category_id: string | null }>;
  merch: Array<{ id: string; name: string }>;
  dre: Array<{ id: string; name: string; group_type: string | null }>;
}

async function loadCandidates(admin: SupabaseClient, tenantId: string): Promise<Candidates> {
  const [ing, cat, merch, dre] = await Promise.all([
    admin.from('ingredients').select('id, name, unit').eq('tenant_id', tenantId).is('deleted_at', null).order('name').limit(2000),
    admin.from('fin_purchase_catalog').select('id, name, ingredient_id, default_supplier, purchase_unit, pack_count, pack_size, merchandise_category_id, dre_category_id')
      .eq('tenant_id', tenantId).eq('is_active', true).order('name').limit(2000),
    admin.from('fin_merchandise_categories').select('id, name').eq('tenant_id', tenantId).eq('is_active', true).order('sort_order'),
    admin.from('fin_dre_categories').select('id, name, group_type').eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null).order('sort_order'),
  ]);
  return {
    ingredients: (ing.data ?? []) as Candidates['ingredients'],
    catalog: (cat.data ?? []) as Candidates['catalog'],
    merch: (merch.data ?? []) as Candidates['merch'],
    dre: (dre.data ?? []) as Candidates['dre'],
  };
}

function candidatesText(c: Candidates): string {
  const lines: string[] = [];
  lines.push('CATÁLOGO (id | nome | fornecedor | embalagem):');
  for (const x of c.catalog) {
    const emb = x.pack_count ? `${x.purchase_unit ?? ''} ${x.pack_count}×${x.pack_size ?? 1}`.trim() : (x.purchase_unit ?? '');
    lines.push(`${x.id} | ${x.name} | ${x.default_supplier ?? '-'} | ${emb || '-'}`);
  }
  lines.push('', 'INSUMOS DE ESTOQUE (id | nome | unidade de estoque):');
  for (const x of c.ingredients) lines.push(`${x.id} | ${x.name} | ${x.unit}`);
  lines.push('', 'CATEGORIAS DE MERCADORIA (id | nome):');
  for (const x of c.merch) lines.push(`${x.id} | ${x.name}`);
  lines.push('', 'CATEGORIAS DA DRE (id | grupo | nome):');
  for (const x of c.dre) lines.push(`${x.id} | ${x.group_type ?? '-'} | ${x.name}`);
  return lines.join('\n');
}

// deno-lint-ignore no-explicit-any
async function actionScan(admin: SupabaseClient, tenantId: string, body: Record<string, any>) {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) return errResp('Leitura de notas ainda não configurada (falta a chave ANTHROPIC_API_KEY no servidor).', 503);

  const mediaType = String(body.media_type ?? '').toLowerCase();
  const data = String(body.file_base64 ?? '').replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
  if (!data) return errResp('Envie a foto ou o PDF da nota.');
  if (Math.floor(data.length * 3 / 4) > MAX_FILE_BYTES) return errResp('Arquivo grande demais (máx. 8 MB).');
  const isPdf = mediaType === 'application/pdf';
  if (!isPdf && !IMAGE_TYPES.includes(mediaType)) return errResp('Formato não suportado. Use foto (JPG/PNG/WEBP) ou PDF.');

  const cand = await loadCandidates(admin, tenantId);
  const fileBlock = isPdf
    ? { type: 'document' as const, source: { type: 'base64' as const, media_type: 'application/pdf' as const, data } }
    : { type: 'image' as const, source: { type: 'base64' as const, media_type: mediaType as 'image/jpeg', data } };

  const client = new Anthropic({ apiKey });
  const started = Date.now();
  // deno-lint-ignore no-explicit-any
  let response: any;
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      // deno-lint-ignore no-explicit-any
      fallbacks: 'default' as any,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
      messages: [{
        role: 'user',
        content: [
          fileBlock,
          { type: 'text', text: `${candidatesText(cand)}\n\nLeia o documento anexo e devolva os dados da compra.` },
        ],
      }],
    // deno-lint-ignore no-explicit-any
    } as any);
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      log('ERROR', 'scan', 'anthropic auth', {});
      return errResp('Chave da IA inválida no servidor (ANTHROPIC_API_KEY).', 503);
    }
    if (err instanceof Anthropic.RateLimitError) return errResp('Muitas leituras ao mesmo tempo. Tente de novo em alguns segundos.', 429);
    if (err instanceof Anthropic.BadRequestError) {
      log('ERROR', 'scan', 'anthropic bad request', { error: String(err.message).slice(0, 500) });
      return errResp('Não foi possível ler este arquivo. Tente uma foto mais nítida.', 400);
    }
    if (err instanceof Anthropic.APIError) {
      log('ERROR', 'scan', 'anthropic api error', { status: err.status, error: String(err.message).slice(0, 500) });
      return errResp('Serviço de leitura indisponível no momento. Tente de novo.', 502);
    }
    throw err;
  }

  if (response.stop_reason === 'refusal') return errResp('A leitura foi recusada para este arquivo.', 422);
  if (response.stop_reason === 'max_tokens') return errResp('Documento longo demais para ler de uma vez. Envie em partes.', 422);
  const text = (response.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
  // deno-lint-ignore no-explicit-any
  let out: any;
  try { out = JSON.parse(text); } catch {
    log('ERROR', 'scan', 'invalid json from model', { sample: text.slice(0, 300) });
    return errResp('A leitura voltou incompleta. Tente de novo.', 502);
  }

  // ── Pós-processamento: valida ids e aplica vínculos memorizados ──
  const ingById = new Map(cand.ingredients.map((x) => [x.id, x]));
  const catById = new Map(cand.catalog.map((x) => [x.id, x]));
  const merchIds = new Set(cand.merch.map((x) => x.id));
  const dreIds = new Set(cand.dre.map((x) => x.id));
  const supplierKey = supplierKeyOf(out.fornecedor_cnpj, out.fornecedor_nome);

  const rawItems = Array.isArray(out.itens) ? out.itens : [];
  const descKeys = [...new Set(rawItems.map((it: { descricao: string }) => normKey(it.descricao)).filter(Boolean))] as string[];
  const { data: links } = descKeys.length
    ? await admin.from('purchase_receipt_item_links')
      .select('supplier_key, description_key, ingredient_id, catalog_id, merchandise_category_id, dre_category_id, unit_label, pack_count, pack_size, updated_at')
      .eq('tenant_id', tenantId).in('description_key', descKeys)
    : { data: [] };
  // Mesmo fornecedor primeiro; senão, o vínculo mais recente da mesma descrição em qualquer fornecedor.
  // deno-lint-ignore no-explicit-any
  const linkFor = (dk: string): any => {
    const rows = (links ?? []).filter((l) => l.description_key === dk);
    return rows.find((l) => supplierKey && l.supplier_key === supplierKey)
      ?? rows.sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0] ?? null;
  };

  // deno-lint-ignore no-explicit-any
  const items = rawItems.map((it: any) => {
    const dk = normKey(it.descricao);
    const link = linkFor(dk);
    let catalogId: string | null = null;
    let ingredientId: string | null = null;
    let merchId: string | null = merchIds.has(it.categoria_mercadoria_id) ? it.categoria_mercadoria_id : null;
    let dreId: string | null = dreIds.has(it.categoria_dre_id) ? it.categoria_dre_id : null;
    let unitLabel: string = String(it.unidade || 'un');
    let packCount: number | null = Number(it.embalagem_qtd) > 0 ? Number(it.embalagem_qtd) : null;
    let packSize: number | null = Number(it.embalagem_conteudo) > 0 ? Number(it.embalagem_conteudo) : null;
    let source: 'memoria' | 'ia' | null = null;

    if (link && (link.catalog_id ? catById.has(link.catalog_id) : true) && (link.ingredient_id ? ingById.has(link.ingredient_id) : true)) {
      catalogId = link.catalog_id ?? null;
      ingredientId = link.ingredient_id ?? (catalogId ? catById.get(catalogId)?.ingredient_id ?? null : null);
      merchId = link.merchandise_category_id ?? merchId;
      dreId = link.dre_category_id ?? (ingredientId ? null : dreId);
      if (link.unit_label) unitLabel = link.unit_label;
      if (link.pack_count) { packCount = Number(link.pack_count); packSize = link.pack_size != null ? Number(link.pack_size) : null; }
      source = 'memoria';
    } else if (it.vinculo_tipo === 'catalogo' && catById.has(it.vinculo_id)) {
      const c = catById.get(it.vinculo_id)!;
      catalogId = c.id;
      ingredientId = c.ingredient_id;
      merchId = c.merchandise_category_id ?? merchId;
      dreId = c.dre_category_id ?? (ingredientId ? null : dreId);
      source = 'ia';
    } else if (it.vinculo_tipo === 'insumo' && ingById.has(it.vinculo_id)) {
      ingredientId = it.vinculo_id;
      dreId = null;
      source = 'ia';
    }

    const qty = Number(it.quantidade) || 0;
    return {
      raw_description: String(it.descricao ?? ''),
      quantity: qty,
      unit_label: unitLabel,
      unit_price: Number(it.preco_unitario) || 0,
      line_total: round2(Number(it.valor_total) || 0),
      line_discount: round2(Number(it.desconto) || 0),
      catalog_id: catalogId,
      ingredient_id: ingredientId,
      merchandise_category_id: merchId,
      dre_category_id: dreId,
      pack_count: packCount,
      pack_size: packSize,
      confidence: String(it.confianca ?? 'baixa'),
      match_source: source,
    };
  });

  const warnings: string[] = Array.isArray(out.avisos) ? out.avisos.map(String) : [];
  const itemsSum = round2(items.reduce((s: number, it: { line_total: number }) => s + it.line_total, 0));
  const docTotal = out.valor_total != null ? round2(Number(out.valor_total)) : null;
  const discountTotal = out.desconto_total != null ? round2(Number(out.desconto_total)) : 0;
  if (docTotal != null && Math.abs(itemsSum - discountTotal - docTotal) > 0.05) {
    warnings.push(`Soma dos itens (R$ ${itemsSum.toFixed(2)}) difere do total do documento (R$ ${docTotal.toFixed(2)}).`);
  }

  log('INFO', 'scan', 'ok', {
    tenant_id: tenantId, ms: Date.now() - started, items: items.length, model: response.model,
    matched: items.filter((i: { match_source: string | null }) => i.match_source).length,
    input_tokens: response.usage?.input_tokens, output_tokens: response.usage?.output_tokens,
  });

  return json({
    success: true,
    data: {
      readable: out.legivel !== false,
      document_kind: out.tipo_documento,
      supplier_name: out.fornecedor_nome ?? null,
      supplier_cnpj: onlyDigits(out.fornecedor_cnpj) || null,
      supplier_key: supplierKey,
      invoice_number: out.numero_documento ?? null,
      purchase_date: /^\d{4}-\d{2}-\d{2}$/.test(String(out.data_compra ?? '')) ? out.data_compra : null,
      payment_method: PAYMENT_METHODS.includes(out.forma_pagamento) ? out.forma_pagamento : null,
      document_total: docTotal,
      discount_total: discountTotal || null,
      items_sum: itemsSum,
      items,
      warnings,
    },
  });
}

// deno-lint-ignore no-explicit-any
async function actionLearn(admin: SupabaseClient, tenantId: string, userId: string, body: Record<string, any>) {
  const supplierKey = String(body.supplier_key ?? '').slice(0, 200);
  const list = Array.isArray(body.items) ? body.items.slice(0, 300) : [];
  const now = new Date().toISOString();
  const cand = await loadCandidates(admin, tenantId);
  const ingIds = new Set(cand.ingredients.map((x) => x.id));
  const catIds = new Set(cand.catalog.map((x) => x.id));
  const merchIds = new Set(cand.merch.map((x) => x.id));
  const dreIds = new Set(cand.dre.map((x) => x.id));

  const rows = new Map<string, Record<string, unknown>>();
  for (const it of list) {
    const dk = normKey(it?.raw_description);
    if (!dk) continue;
    const row = {
      tenant_id: tenantId,
      supplier_key: supplierKey,
      description_key: dk,
      raw_description: String(it.raw_description).slice(0, 300),
      ingredient_id: ingIds.has(it.ingredient_id) ? it.ingredient_id : null,
      catalog_id: catIds.has(it.catalog_id) ? it.catalog_id : null,
      merchandise_category_id: merchIds.has(it.merchandise_category_id) ? it.merchandise_category_id : null,
      dre_category_id: dreIds.has(it.dre_category_id) ? it.dre_category_id : null,
      unit_label: it.unit_label ? String(it.unit_label).slice(0, 20) : null,
      pack_count: Number(it.pack_count) > 0 ? Number(it.pack_count) : null,
      pack_size: Number(it.pack_count) > 0 && Number(it.pack_size) > 0 ? Number(it.pack_size) : null,
      updated_by: userId,
      updated_at: now,
    };
    // Sem nenhum vínculo não há o que memorizar.
    if (!row.ingredient_id && !row.catalog_id && !row.merchandise_category_id && !row.dre_category_id) continue;
    rows.set(dk, row);
  }
  if (rows.size === 0) return json({ success: true, data: { saved: 0 } });

  const { error } = await admin.from('purchase_receipt_item_links')
    .upsert([...rows.values()], { onConflict: 'tenant_id,supplier_key,description_key' });
  if (error) {
    log('ERROR', 'learn', 'upsert failed', { error: error.message });
    return errResp('Falha ao memorizar vínculos', 500);
  }
  return json({ success: true, data: { saved: rows.size } });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || serviceRoleKey.length < 40) return errResp('Server misconfiguration', 500);
  const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });

  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return errResp('Unauthorized', 401);

  // deno-lint-ignore no-explicit-any
  let body: Record<string, any>;
  try { body = await req.json(); } catch { return errResp('Invalid JSON body'); }
  const action = String(body.action ?? '');

  try {
    const { data: u, error: uErr } = await admin.auth.getUser(token);
    if (uErr || !u?.user) return errResp('Unauthorized', 401);
    const userId = u.user.id;
    const requested = body.tenant_id ? String(body.tenant_id) : '';
    const { data: memberships } = await admin.from('user_tenants').select('tenant_id').eq('user_id', userId);
    const match = requested
      ? (memberships ?? []).find((r) => r.tenant_id === requested)
      : ((memberships ?? []).length === 1 ? memberships![0] : null);
    if (!match) return errResp('Sem acesso a esta loja', 403);
    const tenantId = String(match.tenant_id);

    if (action === 'scan') return await actionScan(admin, tenantId, body);
    if (action === 'learn') return await actionLearn(admin, tenantId, userId, body);
    return errResp(`Ação desconhecida: ${action}`);
  } catch (err) {
    log('ERROR', action, 'unhandled', { error: String((err as Error)?.message ?? err) });
    return errResp('Erro interno', 500);
  }
});

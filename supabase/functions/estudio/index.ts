// estudio — Estúdio de Criação: Kit da Marca + Biblioteca (fotos avaliadas) + gerador de artes.
// 2026-09-28. Contexto: PLANO-TRAFEGO-PAGO-AGENTES.md §3.2. Módulo separado do Tráfego Pago.
//
// Como a arte é feita (modo A do plano): a IA NÃO desenha pixel. O modelo de arte (templates.ts)
// é código; entra a foto real do cardápio + Kit da Marca + textos → satori (SVG) → resvg (PNG)
// → bucket privado `estudio` → URL assinada. Custo zero por imagem.
//
// Ações (body.action, sempre com tenant_id; membro da loja por JWT; escrita = gerente/admin):
//   get_kit           → kit + logo_url + fontes + templates
//   save_kit          {kit}                          (gerente+)
//   prefill_kit       → sugestão de kit lida do logo/fotos (Haiku visão)
//   upload_logo       {file_base64, content_type}    (gerente+)
//   library           → itens do cardápio com foto + nota da IA (studio_assets)
//   analyze_library   {item_ids?}                    (gerente+) → nota 0-10 por foto (Haiku visão)
//   render            {template, item_id, textos?}   → gera PNG, salva como rascunho, devolve URL
//   list_creatives    {limit?, status?}
//   decide            {creative_id, status}          (gerente+)
//   delete_creative   {creative_id}                  (gerente+)
// Segredos: ANTHROPIC_API_KEY. Fontes (woff) e o wasm do resvg vêm do jsDelivr e ficam em cache
// no módulo (cold start ~2 s; depois ~0,5 s por arte).

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import Anthropic from 'npm:@anthropic-ai/sdk@0.125.0';
import satori from 'npm:satori@0.12.2';
import { initWasm, Resvg } from 'npm:@resvg/resvg-wasm@2.6.2';
import { authenticate, tenantRole, isManagerRole } from '../_shared/tenant-auth.ts';
import { TEMPLATES, buildTree, type Kit as KitVisual, type Textos } from './templates.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const BUCKET = 'estudio';
const VISION_MODEL = 'claude-haiku-4-5'; // nota de foto e leitura de logo: tarefa simples, modelo barato
const RESVG_WASM = 'https://cdn.jsdelivr.net/npm/@resvg/resvg-wasm@2.6.2/index_bg.wasm';
// Fontes do Google via fontsource (woff, que o satori lê). Chave = nome mostrado na tela.
const FONTES: Record<string, { pkg: string; pesos: number[] }> = {
  'Inter': { pkg: 'inter', pesos: [400, 700] },
  'Poppins': { pkg: 'poppins', pesos: [400, 700] },
  'Montserrat': { pkg: 'montserrat', pesos: [400, 700] },
  'Roboto': { pkg: 'roboto', pesos: [400, 700] },
  'Nunito': { pkg: 'nunito', pesos: [400, 700] },
  'Playfair Display': { pkg: 'playfair-display', pesos: [400, 700] },
  'Bebas Neue': { pkg: 'bebas-neue', pesos: [400] },
};

type Row = Record<string, unknown>;
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
const log = (level: 'INFO' | 'WARN' | 'ERROR', msg: string, extra?: unknown) =>
  console.log(`[estudio] ${level} ${msg}${extra !== undefined ? ' ' + JSON.stringify(extra).slice(0, 1200) : ''}`);
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };
const HEX = /^#[0-9a-f]{6}$/i;

// ─── Kit ─────────────────────────────────────────────────────────────────────
const KIT_DEFAULT = {
  nome_marca: null as string | null, cor_primaria: '#7a1f1f', cor_secundaria: '#f5c518', cor_fundo: '#1a1a1a', cor_texto: '#ffffff', fonte: 'Inter',
  tom_voz: null as string | null, usa_emoji: false, publico: null as string | null, diferenciais: null as string | null, bordoes: null as string | null,
  cta_padrao: null as string | null, mostrar_preco: true, estilo_foto: null as string | null, palavras_obrigatorias: [] as string[], palavras_proibidas: [] as string[],
  nunca_fazer: null as string | null, logo_path: null as string | null, preenchido_por_ia: false, updated_at: null as string | null,
};
type Kit = typeof KIT_DEFAULT;

async function loadKit(admin: SupabaseClient, tenantId: string): Promise<Kit> {
  const { data } = await admin.from('brand_kit').select('*').eq('tenant_id', tenantId).maybeSingle();
  if (!data) {
    // Sem kit salvo: nome da loja como ponto de partida.
    const { data: t } = await admin.from('tenants').select('name').eq('id', tenantId).maybeSingle();
    return { ...KIT_DEFAULT, nome_marca: t?.name ? String(t.name) : null };
  }
  return { ...KIT_DEFAULT, ...(data as Partial<Kit>) };
}

function sanitizeKit(input: Row): Partial<Kit> {
  const out: Row = {};
  const str = (k: string, max: number) => { if (k in input) out[k] = input[k] ? String(input[k]).trim().slice(0, max) || null : null; };
  const cor = (k: string) => { if (k in input && HEX.test(String(input[k] ?? ''))) out[k] = String(input[k]).toLowerCase(); };
  const bool = (k: string) => { if (k in input) out[k] = input[k] === true; };
  const lista = (k: string) => { if (Array.isArray(input[k])) out[k] = (input[k] as unknown[]).map((x) => String(x).trim().slice(0, 40)).filter(Boolean).slice(0, 30); };
  str('nome_marca', 80); cor('cor_primaria'); cor('cor_secundaria'); cor('cor_fundo'); cor('cor_texto');
  if ('fonte' in input && FONTES[String(input.fonte)]) out.fonte = String(input.fonte);
  if ('tom_voz' in input) out.tom_voz = ['descontraido', 'familiar', 'premium', 'jovem'].includes(String(input.tom_voz)) ? String(input.tom_voz) : null;
  bool('usa_emoji'); bool('mostrar_preco');
  str('publico', 300); str('diferenciais', 600); str('bordoes', 300); str('cta_padrao', 40); str('estilo_foto', 300); str('nunca_fazer', 600);
  lista('palavras_obrigatorias'); lista('palavras_proibidas');
  return out as Partial<Kit>;
}

async function signed(admin: SupabaseClient, path: string | null, seconds = 3600): Promise<string | null> {
  if (!path) return null;
  const { data } = await admin.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

// ─── IA (visão) ──────────────────────────────────────────────────────────────
function anthropic() {
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY') ?? '';
  if (!apiKey) throw new Error('IA não configurada (falta ANTHROPIC_API_KEY).');
  return new Anthropic({ apiKey });
}
// deno-lint-ignore no-explicit-any
async function askVision(system: string, blocks: any[], schema: Row): Promise<Row> {
  // deno-lint-ignore no-explicit-any
  const r: any = await anthropic().messages.create({
    model: VISION_MODEL, max_tokens: 1500, system,
    output_config: { format: { type: 'json_schema', schema } },
    messages: [{ role: 'user', content: blocks }],
  // deno-lint-ignore no-explicit-any
  } as any);
  if (r.stop_reason === 'refusal') throw new Error('A IA recusou analisar a imagem.');
  const text = (r.content ?? []).filter((b: Row) => b.type === 'text').map((b: Row) => String(b.text)).join('');
  return JSON.parse(text) as Row;
}
const imgBlock = (url: string) => ({ type: 'image', source: { type: 'url', url } });

const NOTA_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['nota', 'pontos_fortes', 'problemas', 'serve_para_anuncio', 'o_que_aparece'],
  properties: {
    nota: { type: 'integer' }, pontos_fortes: { type: 'array', items: { type: 'string' } }, problemas: { type: 'array', items: { type: 'string' } },
    serve_para_anuncio: { type: 'boolean' }, o_que_aparece: { type: 'string' },
  },
};
const NOTA_SYSTEM = `Você avalia fotos de pratos para anúncio de restaurante/delivery no Brasil. Responda em português, curto. Dê uma nota 0-10 pensando em: comida em destaque e apetitosa, nitidez, luz (sem escuro/amarelado/estourado), enquadramento (prato inteiro, sem cortar), fundo limpo, sem texto/marca d'água sobreposta, resolução suficiente. ≥7 = pode ir para anúncio sem retoque; 5-6 = usável com ajuste; <5 = refazer a foto. Liste até 3 pontos fortes e até 3 problemas concretos (ex.: "fundo com pia", "foto escura"). Diga em uma frase o que aparece.`;

const KIT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['cor_primaria', 'cor_secundaria', 'cor_fundo', 'tom_voz', 'estilo_foto', 'cta_padrao', 'motivo'],
  properties: {
    cor_primaria: { type: 'string' }, cor_secundaria: { type: 'string' }, cor_fundo: { type: 'string' },
    tom_voz: { type: 'string', enum: ['descontraido', 'familiar', 'premium', 'jovem'] }, estilo_foto: { type: 'string' }, cta_padrao: { type: 'string' }, motivo: { type: 'string' },
  },
};
const KIT_SYSTEM = `Você é diretor de arte de um restaurante/delivery no Brasil. Recebe o logo (se houver) e algumas fotos do cardápio. Sugira um Kit da Marca coerente com o que vê: cor primária e secundária em hex (#rrggbb) tiradas do logo ou das fotos (contraste bom entre elas), cor de fundo escura ou clara que combine, tom de voz, estilo de foto em uma frase (ex.: "fundo escuro, luz lateral, prato de cima") e um CTA curto (≤ 25 caracteres, ex.: "Peça pelo WhatsApp"). Explique em 2 frases o motivo. Português do Brasil.`;

// ─── Render ──────────────────────────────────────────────────────────────────
let wasmReady: Promise<void> | null = null;
const fontCache = new Map<string, ArrayBuffer>();

async function fetchBytes(url: string, what: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Não consegui baixar ${what} (${r.status}).`);
  return await r.arrayBuffer();
}
async function loadFonts(nome: string) {
  const def = FONTES[nome] ?? FONTES['Inter']; const family = FONTES[nome] ? nome : 'Inter';
  const fonts: { name: string; data: ArrayBuffer; weight: 400 | 700; style: 'normal' }[] = [];
  for (const peso of def.pesos) {
    const key = `${def.pkg}-${peso}`;
    if (!fontCache.has(key)) fontCache.set(key, await fetchBytes(`https://cdn.jsdelivr.net/npm/@fontsource/${def.pkg}@5/files/${def.pkg}-latin-${peso}-normal.woff`, `a fonte ${family}`));
    fonts.push({ name: family, data: fontCache.get(key)!, weight: peso === 700 ? 700 : 400, style: 'normal' });
  }
  // Fonte com um peso só (ex.: Bebas Neue): o negrito usa o mesmo arquivo.
  if (def.pesos.length === 1) fonts.push({ ...fonts[0], weight: 700 });
  return { family, fonts };
}
function toDataUri(bytes: Uint8Array, mime: string) {
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}
async function imageAsDataUri(url: string, what: string): Promise<string> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Não consegui abrir ${what} (${r.status}).`);
  const mime = (r.headers.get('content-type') ?? 'image/jpeg').split(';')[0];
  const bytes = new Uint8Array(await r.arrayBuffer());
  if (bytes.length > 6 * 1024 * 1024) throw new Error(`${what} é grande demais (máx. 6 MB).`);
  return toDataUri(bytes, mime);
}

async function renderPng(templateId: string, kit: Kit, item: { name: string; price: number; description: string | null }, textos: Textos, fotoUrl: string, logoUrl: string | null) {
  if (!wasmReady) wasmReady = initWasm(fetch(RESVG_WASM)).catch((e) => { wasmReady = null; throw e; });
  const [{ family, fonts }, fotoDataUri, logoDataUri] = await Promise.all([
    loadFonts(kit.fonte), imageAsDataUri(fotoUrl, 'a foto do item'), logoUrl ? imageAsDataUri(logoUrl, 'o logo') : Promise.resolve(null), wasmReady,
  ]).then(([f, foto, logo]) => [f, foto, logo] as const);
  const kitVisual: KitVisual = { nome_marca: kit.nome_marca, cor_primaria: kit.cor_primaria, cor_secundaria: kit.cor_secundaria, cor_fundo: kit.cor_fundo, cor_texto: kit.cor_texto, fonte: kit.fonte, cta_padrao: kit.cta_padrao, mostrar_preco: kit.mostrar_preco };
  const { tree, def } = buildTree(templateId, { kit: kitVisual, item, textos, fotoDataUri, logoDataUri, fontFamily: family });
  // deno-lint-ignore no-explicit-any
  const svg = await satori(tree as any, { width: def.largura, height: def.altura, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: def.largura } }).render().asPng();
  return { png, def };
}

// ─── HTTP ────────────────────────────────────────────────────────────────────
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
  try {
    const body = await req.json().catch(() => ({})) as Row;
    const action = String(body.action ?? '');
    const tenantId = String(body.tenant_id ?? '');
    if (!tenantId) return json({ success: false, error: 'tenant_id é obrigatório' }, 400);

    const caller = await authenticate(req, admin);
    if (!caller) return json({ success: false, error: 'Não autenticado' }, 401);
    let role = 'admin'; let userName = 'Sistema';
    if (!caller.isServiceRole) {
      const r = await tenantRole(admin, caller.userId!, tenantId);
      if (!r) return json({ success: false, error: 'Sem acesso a esta loja' }, 403);
      role = r; userName = caller.email ?? 'Usuário';
      const { data: u } = await admin.auth.admin.getUserById(caller.userId!);
      userName = String(u?.user?.user_metadata?.name ?? u?.user?.user_metadata?.full_name ?? userName);
    }
    const podeEscrever = caller.isServiceRole || isManagerRole(role);
    const soGerente = () => json({ success: false, error: 'Só gerente ou admin da loja pode fazer isso' }, 403);

    if (action === 'get_kit') {
      const kit = await loadKit(admin, tenantId);
      return json({ success: true, kit, logo_url: await signed(admin, kit.logo_path), fontes: Object.keys(FONTES), templates: TEMPLATES });
    }

    if (action === 'save_kit') {
      if (!podeEscrever) return soGerente();
      const patch = sanitizeKit((body.kit ?? {}) as Row);
      const { error } = await admin.from('brand_kit').upsert({ ...patch, tenant_id: tenantId, updated_at: new Date().toISOString(), updated_by_user_id: caller.userId }, { onConflict: 'tenant_id' });
      if (error) return json({ success: false, error: error.message }, 500);
      const kit = await loadKit(admin, tenantId);
      return json({ success: true, kit, logo_url: await signed(admin, kit.logo_path) });
    }

    if (action === 'upload_logo') {
      if (!podeEscrever) return soGerente();
      const ct = String(body.content_type ?? '');
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(ct)) return json({ success: false, error: 'Logo precisa ser PNG, JPG ou WEBP.' }, 400);
      const b64 = String(body.file_base64 ?? '').replace(/^data:[^;]+;base64,/, '');
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      if (!bytes.length || bytes.length > 2 * 1024 * 1024) return json({ success: false, error: 'Logo vazio ou maior que 2 MB.' }, 400);
      const path = `${tenantId}/logo/${Date.now()}.${ct === 'image/png' ? 'png' : ct === 'image/webp' ? 'webp' : 'jpg'}`;
      const up = await admin.storage.from(BUCKET).upload(path, bytes, { contentType: ct, upsert: false });
      if (up.error) return json({ success: false, error: up.error.message }, 500);
      const { error } = await admin.from('brand_kit').upsert({ tenant_id: tenantId, logo_path: path, updated_at: new Date().toISOString(), updated_by_user_id: caller.userId }, { onConflict: 'tenant_id' });
      if (error) return json({ success: false, error: error.message }, 500);
      return json({ success: true, logo_url: await signed(admin, path) });
    }

    if (action === 'prefill_kit') {
      const kit = await loadKit(admin, tenantId);
      const logoUrl = await signed(admin, kit.logo_path);
      const { data: items } = await admin.from('menu_items').select('name, photo_url').eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null).not('photo_url', 'is', null).neq('photo_url', '').limit(4);
      // deno-lint-ignore no-explicit-any
      const blocks: any[] = [];
      if (logoUrl) blocks.push({ type: 'text', text: 'Logo da marca:' }, imgBlock(logoUrl));
      for (const it of (items ?? []) as Row[]) blocks.push({ type: 'text', text: `Foto do cardápio: ${it.name}` }, imgBlock(String(it.photo_url)));
      if (!blocks.length) return json({ success: false, error: 'Envie o logo ou cadastre fotos no cardápio para a IA sugerir o kit.' }, 400);
      blocks.push({ type: 'text', text: `Nome da marca: ${kit.nome_marca ?? '(não informado)'}. Sugira o Kit da Marca.` });
      const out = await askVision(KIT_SYSTEM, blocks, KIT_SCHEMA);
      const sug: Row = {};
      for (const k of ['cor_primaria', 'cor_secundaria', 'cor_fundo']) if (HEX.test(String(out[k] ?? ''))) sug[k] = String(out[k]).toLowerCase();
      if (['descontraido', 'familiar', 'premium', 'jovem'].includes(String(out.tom_voz))) sug.tom_voz = out.tom_voz;
      if (out.estilo_foto) sug.estilo_foto = String(out.estilo_foto).slice(0, 300);
      if (out.cta_padrao) sug.cta_padrao = String(out.cta_padrao).slice(0, 40);
      return json({ success: true, sugestao: sug, motivo: String(out.motivo ?? '') });
    }

    if (action === 'library') {
      const [{ data: items }, { data: assets }, { data: vendas }] = await Promise.all([
        admin.from('menu_items').select('id, name, price, description, photo_url, is_featured').eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null).order('name').limit(500),
        admin.from('studio_assets').select('menu_item_id, nota_qualidade, analise, analisado_em').eq('tenant_id', tenantId).eq('source', 'cardapio'),
        admin.from('order_items').select('item_id, quantity').eq('tenant_id', tenantId).gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()).limit(20000),
      ]);
      const qty = new Map<string, number>();
      for (const v of (vendas ?? []) as Row[]) qty.set(String(v.item_id), (qty.get(String(v.item_id)) ?? 0) + n(v.quantity));
      const byItem = new Map(((assets ?? []) as Row[]).map((a) => [String(a.menu_item_id), a]));
      const out = ((items ?? []) as Row[]).map((it) => {
        const a = byItem.get(String(it.id));
        return { item_id: String(it.id), name: String(it.name), price: n(it.price), description: it.description ? String(it.description) : null, photo_url: it.photo_url ? String(it.photo_url) : null,
          is_featured: !!it.is_featured, qty_30d: qty.get(String(it.id)) ?? 0, nota_qualidade: a?.nota_qualidade ?? null, analise: a?.analise ?? null, analisado_em: a?.analisado_em ?? null };
      });
      out.sort((x, y) => (y.photo_url ? 1 : 0) - (x.photo_url ? 1 : 0) || y.qty_30d - x.qty_30d);
      return json({ success: true, items: out });
    }

    if (action === 'analyze_library') {
      if (!podeEscrever) return soGerente();
      // Lote de até LOTE fotos por chamada (a tela repete até acabar). Sem item_ids: só as que
      // ainda não têm nota ou cuja foto mudou desde a análise (url diferente).
      const LOTE = 12;
      const ids = Array.isArray(body.item_ids) ? (body.item_ids as unknown[]).map(String).slice(0, LOTE) : null;
      let q = admin.from('menu_items').select('id, name, photo_url').eq('tenant_id', tenantId).eq('is_active', true).is('deleted_at', null).not('photo_url', 'is', null).neq('photo_url', '').order('name').limit(500);
      if (ids) q = q.in('id', ids);
      const [{ data: todos }, { data: feitos }] = await Promise.all([
        q, admin.from('studio_assets').select('menu_item_id, url').eq('tenant_id', tenantId).eq('source', 'cardapio'),
      ]);
      const jaTem = new Map(((feitos ?? []) as Row[]).map((a) => [String(a.menu_item_id), String(a.url ?? '')]));
      const pendentes = ((todos ?? []) as Row[]).filter((it) => ids || jaTem.get(String(it.id)) !== String(it.photo_url));
      const lote = pendentes.slice(0, LOTE);
      let analisados = 0; const erros: string[] = [];
      const avaliar = async (it: Row) => {
        try {
          const out = await askVision(NOTA_SYSTEM, [imgBlock(String(it.photo_url)), { type: 'text', text: `Item do cardápio: ${it.name}. Avalie a foto.` }], NOTA_SCHEMA);
          const nota = Math.max(0, Math.min(10, Math.round(n(out.nota))));
          const { error } = await admin.from('studio_assets').upsert({ tenant_id: tenantId, source: 'cardapio', menu_item_id: it.id, url: it.photo_url, nota_qualidade: nota,
            analise: { pontos_fortes: out.pontos_fortes ?? [], problemas: out.problemas ?? [], serve_para_anuncio: out.serve_para_anuncio === true, o_que_aparece: out.o_que_aparece ?? '' }, analisado_em: new Date().toISOString() }, { onConflict: 'tenant_id,source,menu_item_id' });
          if (error) throw new Error(error.message);
          analisados += 1;
        } catch (e) { erros.push(`${it.name}: ${e instanceof Error ? e.message : String(e)}`); log('WARN', 'nota da foto', { item: it.name, err: String(e) }); }
      };
      // 4 em paralelo: 12 fotos em ~3 rodadas de Haiku, bem abaixo do limite de tempo da função.
      for (let i = 0; i < lote.length; i += 4) await Promise.all(lote.slice(i, i + 4).map(avaliar));
      return json({ success: true, analisados, restantes: Math.max(0, pendentes.length - lote.length), erros: erros.slice(0, 5) });
    }

    if (action === 'render') {
      const templateId = String(body.template ?? ''); const itemId = String(body.item_id ?? '');
      if (!TEMPLATES.some((t) => t.id === templateId)) return json({ success: false, error: 'Modelo inválido.' }, 400);
      const { data: it } = await admin.from('menu_items').select('id, name, price, description, photo_url').eq('tenant_id', tenantId).eq('id', itemId).maybeSingle();
      if (!it) return json({ success: false, error: 'Item não encontrado nesta loja.' }, 404);
      if (!it.photo_url) return json({ success: false, error: 'Este item não tem foto. Cadastre a foto no cardápio primeiro.' }, 400);
      const t = (body.textos ?? {}) as Row;
      const textos: Textos = {
        titulo: t.titulo ? String(t.titulo).slice(0, 60) : null, subtitulo: t.subtitulo !== undefined ? (t.subtitulo ? String(t.subtitulo).slice(0, 90) : '') : undefined,
        preco: t.preco === null ? null : t.preco !== undefined ? n(t.preco) : undefined, cta: t.cta ? String(t.cta).slice(0, 30) : null, selo: t.selo ? String(t.selo).slice(0, 20) : null,
      };
      const kit = await loadKit(admin, tenantId);
      const logoUrl = await signed(admin, kit.logo_path, 300);
      const t0 = Date.now();
      const { png, def } = await renderPng(templateId, kit, { name: String(it.name), price: n(it.price), description: it.description ? String(it.description) : null }, textos, String(it.photo_url), logoUrl);
      const path = `${tenantId}/artes/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.png`;
      const up = await admin.storage.from(BUCKET).upload(path, png, { contentType: 'image/png', upsert: false });
      if (up.error) return json({ success: false, error: up.error.message }, 500);
      const { data: row, error } = await admin.from('studio_creatives').insert({
        tenant_id: tenantId, template: def.id, formato: def.formato, largura: def.largura, altura: def.altura, menu_item_id: it.id, item_name: it.name,
        textos, image_path: path, origem: String(body.origem ?? 'manual').slice(0, 20), request_ref: body.request_ref ? String(body.request_ref).slice(0, 80) : null,
        created_by_user_id: caller.userId, created_by_name: userName,
      }).select('*').single();
      if (error) return json({ success: false, error: error.message }, 500);
      log('INFO', 'arte gerada', { tenantId, template: def.id, ms: Date.now() - t0, kb: Math.round(png.length / 1024) });
      return json({ success: true, creative: { ...row, url: await signed(admin, path) } });
    }

    if (action === 'list_creatives') {
      let q = admin.from('studio_creatives').select('*').eq('tenant_id', tenantId).order('created_at', { ascending: false }).limit(Math.min(200, n(body.limit) || 60));
      if (body.status) q = q.eq('status', String(body.status));
      const { data, error } = await q;
      if (error) return json({ success: false, error: error.message }, 500);
      const paths = ((data ?? []) as Row[]).map((c) => String(c.image_path));
      const { data: urls } = paths.length ? await admin.storage.from(BUCKET).createSignedUrls(paths, 3600) : { data: [] };
      const byPath = new Map(((urls ?? []) as Row[]).map((u) => [String(u.path), u.signedUrl ? String(u.signedUrl) : null]));
      return json({ success: true, creatives: ((data ?? []) as Row[]).map((c) => ({ ...c, url: byPath.get(String(c.image_path)) ?? null })) });
    }

    if (action === 'decide') {
      if (!podeEscrever) return soGerente();
      const status = String(body.status ?? '');
      if (!['aprovada', 'reprovada', 'rascunho'].includes(status)) return json({ success: false, error: 'status inválido' }, 400);
      const { data, error } = await admin.from('studio_creatives').update({ status, decided_by_name: userName, decided_at: new Date().toISOString() })
        .eq('tenant_id', tenantId).eq('id', String(body.creative_id ?? '')).select('*').maybeSingle();
      if (error) return json({ success: false, error: error.message }, 500);
      if (!data) return json({ success: false, error: 'Arte não encontrada' }, 404);
      return json({ success: true, creative: { ...data, url: await signed(admin, String(data.image_path)) } });
    }

    if (action === 'delete_creative') {
      if (!podeEscrever) return soGerente();
      const { data } = await admin.from('studio_creatives').select('image_path').eq('tenant_id', tenantId).eq('id', String(body.creative_id ?? '')).maybeSingle();
      if (!data) return json({ success: false, error: 'Arte não encontrada' }, 404);
      await admin.storage.from(BUCKET).remove([String(data.image_path)]);
      await admin.from('studio_creatives').delete().eq('tenant_id', tenantId).eq('id', String(body.creative_id));
      return json({ success: true });
    }

    return json({ success: false, error: `Ação desconhecida: ${action}` }, 400);
  } catch (err) {
    log('ERROR', 'handler', String(err));
    return json({ success: false, error: err instanceof Error ? err.message : String(err) }, 500);
  }
});

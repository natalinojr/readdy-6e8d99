// Ponte Tráfego Pago → Estúdio de Criação (F3 do PLANO-TRAFEGO-PAGO-AGENTES.md, 2026-09-28).
//
// 1. Na rodada: create_campaign e rotate_creative pedem arte ao Estúdio (Edge `estudio`,
//    ação request_creative, chamada interna com a service role). As artes ficam em
//    params.artes da ação sugerida, para o dono ver antes de aprovar.
// 2. Na execução: o Revisor (código) confere cada arte (existe, não reprovada, item ativo, preço
//    da arte = preço do cardápio); a arte aprovada sobe para a Meta (/adimages → image_hash) e
//    entra no criativo. Sem arte válida, create_campaign cai na foto crua do cardápio (como antes)
//    e rotate_creative falha com o motivo.
// 3. Arte usada vira `publicada` em studio_creatives, com os ids da Meta.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

type Row = Record<string, unknown>;
const BUCKET = 'estudio';
const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

export type ArteRef = { creative_id: string; template: string; item_id: string | null; item_name: string | null };

/** Pede artes ao Estúdio. Nunca lança: devolve { artes, erro }. */
export async function pedirArtes(tenantId: string, opts: { templates: string[]; itemId?: string | null; photoUrl?: string | null; evitarItemIds?: string[]; textos?: Row; ref: string }):
  Promise<{ artes: ArteRef[]; erro: string | null }> {
  const url = Deno.env.get('SUPABASE_URL'); const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return { artes: [], erro: 'Estúdio indisponível (sem credenciais internas).' };
  try {
    const resp = await fetch(`${url}/functions/v1/estudio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({
        action: 'request_creative', tenant_id: tenantId, origem: 'trafego', request_ref: opts.ref, templates: opts.templates,
        item_id: opts.itemId ?? null, photo_url: opts.photoUrl ?? null, evitar_item_ids: opts.evitarItemIds ?? [], textos: opts.textos ?? {},
      }),
    });
    const body = await resp.json().catch(() => ({})) as Row;
    if (!body.success) return { artes: [], erro: String(body.error ?? `Estúdio respondeu ${resp.status}`) };
    const artes = ((body.creatives ?? []) as Row[]).map((c) => ({
      creative_id: String(c.id), template: String(c.template), item_id: c.menu_item_id ? String(c.menu_item_id) : null, item_name: c.item_name ? String(c.item_name) : null,
    }));
    return { artes, erro: ((body.erros ?? []) as string[]).join(' · ') || null };
  } catch (e) {
    return { artes: [], erro: `Estúdio indisponível: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** URLs assinadas (1 h) das artes de cada ação, para a tela mostrar a miniatura. */
export async function urlsDasArtes(admin: SupabaseClient, tenantId: string, actions: Row[]): Promise<Row[]> {
  const ids = [...new Set(actions.flatMap((a) => (((a.params ?? {}) as Row).artes as ArteRef[] | undefined ?? []).map((x) => x.creative_id)))];
  if (!ids.length) return actions;
  const { data } = await admin.from('studio_creatives').select('id, image_path, status, template, item_name').eq('tenant_id', tenantId).in('id', ids);
  const rows = (data ?? []) as Row[];
  const { data: urls } = rows.length ? await admin.storage.from(BUCKET).createSignedUrls(rows.map((r) => String(r.image_path)), 3600) : { data: [] };
  const byPath = new Map(((urls ?? []) as Row[]).map((u) => [String(u.path), u.signedUrl ? String(u.signedUrl) : null]));
  const byId = new Map(rows.map((r) => [String(r.id), { url: byPath.get(String(r.image_path)) ?? null, status: String(r.status) }]));
  return actions.map((a) => {
    const p = (a.params ?? {}) as Row;
    const artes = (p.artes as ArteRef[] | undefined) ?? [];
    if (!artes.length) return a;
    return { ...a, params: { ...p, artes: artes.map((x) => ({ ...x, ...(byId.get(x.creative_id) ?? { url: null, status: 'apagada' }) })) } };
  });
}

/** Revisor (código): a arte pode ir para a Meta? Devolve o PNG ou o motivo da recusa. */
export async function revisarArte(admin: SupabaseClient, tenantId: string, creativeId: string): Promise<{ ok: true; png: Uint8Array; row: Row } | { ok: false; motivo: string }> {
  const { data: c } = await admin.from('studio_creatives').select('*').eq('tenant_id', tenantId).eq('id', creativeId).maybeSingle();
  if (!c) return { ok: false, motivo: 'arte não existe mais no Estúdio' };
  if (c.status === 'reprovada') return { ok: false, motivo: 'arte reprovada no Estúdio' };
  if (c.menu_item_id) {
    const { data: it } = await admin.from('menu_items').select('price, is_active, deleted_at').eq('tenant_id', tenantId).eq('id', String(c.menu_item_id)).maybeSingle();
    if (!it || !it.is_active || it.deleted_at) return { ok: false, motivo: `o item "${c.item_name}" saiu do cardápio` };
    const precoArte = ((c.textos ?? {}) as Row).preco_usado;
    if (precoArte !== null && precoArte !== undefined && Math.abs(n(precoArte) - n(it.price)) > 0.009) {
      return { ok: false, motivo: `preço da arte (R$ ${n(precoArte).toFixed(2)}) diferente do cardápio (R$ ${n(it.price).toFixed(2)}); gere a arte de novo` };
    }
  }
  const { data: blob, error } = await admin.storage.from(BUCKET).download(String(c.image_path));
  if (error || !blob) return { ok: false, motivo: `não consegui abrir o PNG (${error?.message ?? 'vazio'})` };
  return { ok: true, png: new Uint8Array(await blob.arrayBuffer()), row: c as Row };
}

function base64(bytes: Uint8Array) {
  let bin = ''; const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

type GraphPost = (path: string, params: Row, token: string) => Promise<{ ok: boolean; body: Row }>;

/** Sobe o PNG na conta de anúncios e devolve o image_hash. */
export async function subirImagem(graphPost: GraphPost, graphErr: (b: Row) => string, token: string, adAccountId: string, png: Uint8Array): Promise<{ hash: string } | { erro: string }> {
  const r = await graphPost(`${adAccountId}/adimages`, { bytes: base64(png) }, token);
  if (!r.ok) return { erro: graphErr(r.body) };
  const imgs = Object.values((r.body.images ?? {}) as Record<string, Row>);
  const hash = imgs[0]?.hash ? String(imgs[0].hash) : '';
  return hash ? { hash } : { erro: 'A Meta não devolveu o hash da imagem.' };
}

export async function marcarPublicada(admin: SupabaseClient, tenantId: string, creativeId: string, ids: { image_hash: string; creative_id?: string | null; ad_id?: string | null }, quem: string) {
  await admin.from('studio_creatives').update({
    status: 'publicada', meta_image_hash: ids.image_hash, meta_creative_id: ids.creative_id ?? null, meta_ad_id: ids.ad_id ?? null,
    published_at: new Date().toISOString(), decided_by_name: quem, decided_at: new Date().toISOString(),
  }).eq('tenant_id', tenantId).eq('id', creativeId);
}

/**
 * Troca de criativo por fadiga: cria 1 anúncio novo por arte no MESMO conjunto, copiando texto,
 * link e CTA do anúncio ativo (só a imagem muda: 1 variável por vez). Os anúncios antigos seguem
 * no ar; a Meta distribui entre eles e o placar decide depois.
 */
export async function trocarCriativo(admin: SupabaseClient, graphGet: (p: string, t: string) => Promise<Row | null>, graphPost: GraphPost, graphErr: (b: Row) => string,
  token: string, adAccountId: string, tenantId: string, adsetId: string, artes: ArteRef[], quem: string): Promise<{ ok: boolean; result: Row; error?: string }> {
  if (!artes.length) return { ok: false, result: {}, error: 'Nenhuma arte do Estúdio para trocar. Gere uma arte no Estúdio e rode o agente de novo.' };
  const lista = await graphGet(`${adsetId}/ads?fields=id,name,effective_status,creative{object_story_spec}&limit=25`, token);
  const ads = ((lista?.data ?? []) as Row[]);
  const base = ads.find((a) => a.effective_status === 'ACTIVE' && (((a.creative as Row)?.object_story_spec as Row)?.link_data))
    ?? ads.find((a) => (((a.creative as Row)?.object_story_spec as Row)?.link_data));
  if (!base) return { ok: false, result: { adset_id: adsetId }, error: 'Não achei um anúncio de imagem neste conjunto para copiar texto e link (vídeo/carrossel não são trocados automaticamente).' };
  const spec = (base.creative as Row).object_story_spec as Row;
  const ld = spec.link_data as Row;
  const criados: Row[] = []; const recusas: string[] = [];
  for (const arte of artes.slice(0, 3)) {
    const rev = await revisarArte(admin, tenantId, arte.creative_id);
    if (!rev.ok) { recusas.push(`${arte.item_name ?? arte.template}: ${rev.motivo}`); continue; }
    const img = await subirImagem(graphPost, graphErr, token, adAccountId, rev.png);
    if ('erro' in img) { recusas.push(`${arte.item_name ?? arte.template}: ${img.erro}`); continue; }
    const linkData: Row = { message: ld.message, name: ld.name, description: ld.description, link: ld.link, call_to_action: ld.call_to_action, image_hash: img.hash };
    if (ld.page_welcome_message) linkData.page_welcome_message = ld.page_welcome_message;
    const cr = await graphPost(`${adAccountId}/adcreatives`, { name: `ERPOS Estúdio · ${arte.item_name ?? arte.template}`, object_story_spec: { page_id: spec.page_id, link_data: linkData } }, token);
    if (!cr.ok) { recusas.push(`${arte.item_name ?? arte.template}: ${graphErr(cr.body)}`); continue; }
    const ad = await graphPost(`${adAccountId}/ads`, { name: `${String(base.name ?? 'Anúncio').slice(0, 60)} · arte ${arte.item_name ?? ''}`.trim(), adset_id: adsetId, creative: { creative_id: String(cr.body.id) }, status: 'ACTIVE' }, token);
    if (!ad.ok) { recusas.push(`${arte.item_name ?? arte.template}: ${graphErr(ad.body)}`); continue; }
    await marcarPublicada(admin, tenantId, arte.creative_id, { image_hash: img.hash, creative_id: String(cr.body.id), ad_id: String(ad.body.id) }, quem);
    criados.push({ creative_id: arte.creative_id, meta_creative_id: String(cr.body.id), ad_id: String(ad.body.id) });
  }
  if (!criados.length) return { ok: false, result: { adset_id: adsetId, recusas }, error: `Nenhuma arte subiu: ${recusas.join(' · ')}` };
  return { ok: true, result: { adset_id: adsetId, copiado_de: base.id, anuncios_novos: criados, recusas } };
}

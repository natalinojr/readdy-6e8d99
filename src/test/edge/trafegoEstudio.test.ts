// @vitest-environment node
// meta-ads-agent/estudio.ts — ponte Tráfego Pago → Estúdio (F3, 2026-09-28). A subida para a Meta não
// dá para testar sem conta de anúncios de teste; aqui o banco e a Graph API são simulados para
// conferir o Revisor (o que barra a arte) e a troca de criativo (o que é enviado para a Meta).
import { describe, it, expect, beforeAll } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/meta-ads-agent/estudio.ts')).href;
// deno-lint-ignore no-explicit-any
type Any = any;
let E: Any;
beforeAll(async () => { E = await import(/* @vite-ignore */ PATH); });

const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);

// Banco mínimo: tabelas em memória, filtros eq/neq/in e update registrado.
function fakeAdmin(db: Record<string, Any[]>) {
  const updates: Any[] = [];
  const from = (table: string) => {
    const filtros: Array<(r: Any) => boolean> = [];
    let patch: Any = null;
    const q: Any = {
      select: () => q, update: (p: Any) => { patch = p; return q; },
      eq: (k: string, v: unknown) => { filtros.push((r) => r[k] === v); return q; },
      in: (k: string, v: unknown[]) => { filtros.push((r) => v.includes(r[k])); return q; },
      maybeSingle: async () => ({ data: (db[table] ?? []).find((r) => filtros.every((f) => f(r))) ?? null }),
      then: (res: Any) => {
        const rows = (db[table] ?? []).filter((r) => filtros.every((f) => f(r)));
        if (patch) { rows.forEach((r) => Object.assign(r, patch)); updates.push({ table, patch }); }
        return Promise.resolve({ data: rows, error: null }).then(res);
      },
    };
    return q;
  };
  return {
    updates,
    from,
    storage: { from: () => ({ download: async () => ({ data: { arrayBuffer: async () => PNG.buffer }, error: null }) }) },
  };
}

const T = 'tenant-1';
const base = () => ({
  studio_creatives: [
    { id: 'arte-ok', tenant_id: T, status: 'aprovada', menu_item_id: 'item-1', item_name: 'Batata frita', textos: { preco_usado: 30 }, image_path: 'x.png' },
    { id: 'arte-reprovada', tenant_id: T, status: 'reprovada', menu_item_id: 'item-1', item_name: 'Batata frita', textos: {}, image_path: 'y.png' },
    { id: 'arte-preco-velho', tenant_id: T, status: 'rascunho', menu_item_id: 'item-1', item_name: 'Batata frita', textos: { preco_usado: 25 }, image_path: 'z.png' },
    { id: 'arte-item-fora', tenant_id: T, status: 'rascunho', menu_item_id: 'item-2', item_name: 'Taco', textos: { preco_usado: 20 }, image_path: 'w.png' },
    { id: 'arte-sem-preco', tenant_id: T, status: 'rascunho', menu_item_id: 'item-1', item_name: 'Batata frita', textos: { preco_usado: null }, image_path: 'v.png' },
  ],
  menu_items: [
    { id: 'item-1', tenant_id: T, price: 30, is_active: true, deleted_at: null },
    { id: 'item-2', tenant_id: T, price: 20, is_active: false, deleted_at: null },
  ],
});

describe('revisarArte (Revisor do tráfego)', () => {
  it('libera arte com preço igual ao do cardápio e devolve o PNG', async () => {
    const r = await E.revisarArte(fakeAdmin(base()), T, 'arte-ok');
    expect(r.ok).toBe(true);
    expect(r.png).toEqual(PNG);
  });
  it('barra arte reprovada no Estúdio', async () => {
    expect(await E.revisarArte(fakeAdmin(base()), T, 'arte-reprovada')).toMatchObject({ ok: false, motivo: expect.stringContaining('reprovada') });
  });
  it('barra arte com preço diferente do cardápio', async () => {
    expect(await E.revisarArte(fakeAdmin(base()), T, 'arte-preco-velho')).toMatchObject({ ok: false, motivo: expect.stringContaining('preço da arte') });
  });
  it('barra arte de item que saiu do cardápio', async () => {
    expect(await E.revisarArte(fakeAdmin(base()), T, 'arte-item-fora')).toMatchObject({ ok: false, motivo: expect.stringContaining('saiu do cardápio') });
  });
  it('arte sem preço (loja não mostra preço) passa', async () => {
    expect((await E.revisarArte(fakeAdmin(base()), T, 'arte-sem-preco')).ok).toBe(true);
  });
  it('arte de outra loja não existe', async () => {
    expect(await E.revisarArte(fakeAdmin(base()), 'outra-loja', 'arte-ok')).toMatchObject({ ok: false });
  });
});

describe('trocarCriativo (fadiga → anúncio novo com a arte)', () => {
  const linkData = { message: 'Peça já!', name: 'Batata', description: 'crocante', link: 'https://api.whatsapp.com/send?phone=55', call_to_action: { type: 'WHATSAPP_MESSAGE' }, picture: 'https://foto-antiga', page_welcome_message: { v: 2 } };
  const graphGet = async () => ({ data: [
    { id: 'ad-pausado', name: 'Antigo', effective_status: 'PAUSED', creative: { object_story_spec: { page_id: 'pg', link_data: { ...linkData, message: 'velho' } } } },
    { id: 'ad-ativo', name: 'Anúncio burrito', effective_status: 'ACTIVE', creative: { object_story_spec: { page_id: 'pg', link_data: linkData } } },
  ] });
  const graphErr = (b: Any) => String(b?.error?.message ?? 'erro');
  const fakeGraph = () => {
    const calls: Array<{ path: string; params: Any }> = [];
    const post = async (path: string, params: Any) => {
      calls.push({ path, params });
      if (path.endsWith('/adimages')) return { ok: true, body: { images: { bytes: { hash: 'HASH1' } } } };
      if (path.endsWith('/adcreatives')) return { ok: true, body: { id: 'cr-novo' } };
      if (path.endsWith('/ads')) return { ok: true, body: { id: 'ad-novo' } };
      return { ok: false, body: {} };
    };
    return { calls, post };
  };

  it('copia texto/link/CTA do anúncio ativo, troca só a imagem e marca a arte como publicada', async () => {
    const db = base(); const admin = fakeAdmin(db); const g = fakeGraph();
    const r = await E.trocarCriativo(admin, graphGet, g.post, graphErr, 'tok', 'act_1', T, 'adset-9',
      [{ creative_id: 'arte-ok', template: 'feed_4x5_foto_faixa', item_id: 'item-1', item_name: 'Batata frita' }], 'Dono');
    expect(r.ok).toBe(true);
    const cr = g.calls.find((c) => c.path === 'act_1/adcreatives')!;
    const ld = cr.params.object_story_spec.link_data;
    expect(ld).toMatchObject({ message: 'Peça já!', link: linkData.link, call_to_action: linkData.call_to_action, image_hash: 'HASH1', page_welcome_message: { v: 2 } });
    expect(ld.picture).toBeUndefined();
    const ad = g.calls.find((c) => c.path === 'act_1/ads')!;
    expect(ad.params).toMatchObject({ adset_id: 'adset-9', status: 'ACTIVE', creative: { creative_id: 'cr-novo' } });
    expect(db.studio_creatives.find((c) => c.id === 'arte-ok')).toMatchObject({ status: 'publicada', meta_image_hash: 'HASH1', meta_ad_id: 'ad-novo' });
  });

  it('arte barrada pelo Revisor não sobe; sem nenhuma válida a ação falha com o motivo', async () => {
    const g = fakeGraph();
    const r = await E.trocarCriativo(fakeAdmin(base()), graphGet, g.post, graphErr, 'tok', 'act_1', T, 'adset-9',
      [{ creative_id: 'arte-preco-velho', template: 't', item_id: 'item-1', item_name: 'Batata frita' }], 'Dono');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('preço da arte');
    expect(g.calls).toHaveLength(0);
  });

  it('sem arte não chama a Meta', async () => {
    const g = fakeGraph();
    const r = await E.trocarCriativo(fakeAdmin(base()), graphGet, g.post, graphErr, 'tok', 'act_1', T, 'adset-9', [], 'Dono');
    expect(r.ok).toBe(false);
    expect(g.calls).toHaveLength(0);
  });

  it('conjunto só com vídeo/carrossel (sem link_data) não é trocado', async () => {
    const g = fakeGraph();
    const soVideo = async () => ({ data: [{ id: 'v', effective_status: 'ACTIVE', creative: { object_story_spec: { page_id: 'pg', video_data: {} } } }] });
    const r = await E.trocarCriativo(fakeAdmin(base()), soVideo, g.post, graphErr, 'tok', 'act_1', T, 'adset-9',
      [{ creative_id: 'arte-ok', template: 't', item_id: 'item-1', item_name: 'Batata frita' }], 'Dono');
    expect(r.ok).toBe(false);
    expect(g.calls).toHaveLength(0);
  });
});

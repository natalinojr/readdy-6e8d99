// "Acabou hoje" no Cardápio (2026-10-06): o item fica pausado até a próxima abertura da loja e volta sozinho.
// Regra única: pausado_ate = a próxima 05:00 de Brasília depois de agora (a madrugada ainda é o dia anterior
// da loja: pausar à 01:00 volta às 05:00 do mesmo dia de calendário, antes de a loja abrir de novo).
// Brasília = UTC-3 fixo (sem horário de verão desde 2019). Cópia idêntica no front: src/lib/cardapioLista.ts
// (pausaAteDe) — os dois são conferidos pelo mesmo teste (src/test/lib/cardapioLista.test.ts).

export const PAUSA_HORA_VOLTA = 5;

/** ISO (UTC) da próxima 05:00 de Brasília estritamente depois de `agora`. */
export function pausaAteDe(agora: Date = new Date()): string {
  const OFFSET_MS = 3 * 3_600_000;
  const local = new Date(agora.getTime() - OFFSET_MS); // relógio de Brasília lido em UTC
  const alvo = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), PAUSA_HORA_VOLTA, 0, 0);
  const alvoLocal = alvo <= local.getTime() ? alvo + 86_400_000 : alvo;
  return new Date(alvoLocal + OFFSET_MS).toISOString();
}

/** O item está pausado agora? (null/vazio/data passada = não) */
export function estaPausado(pausadoAte: string | null | undefined, agora: Date = new Date()): boolean {
  if (!pausadoAte) return false;
  const t = new Date(pausadoAte).getTime();
  return Number.isFinite(t) && t > agora.getTime();
}

/**
 * Ids dos itens da loja pausados agora ("Acabou hoje"). Erro de leitura (ex.: coluna ainda não criada) = nenhum
 * pausado: o cardápio nunca deixa de abrir por causa disto. `ids` limita a busca (validação de pedido).
 */
// deno-lint-ignore no-explicit-any
export async function idsPausados(admin: any, tenantId: string, ids?: string[]): Promise<Set<string>> {
  try {
    if (ids && !ids.length) return new Set();
    let q = admin.from('menu_items').select('id').eq('tenant_id', tenantId).gt('pausado_ate', new Date().toISOString());
    if (ids) q = q.in('id', ids);
    const { data, error } = await q;
    if (error) { console.warn('[cardapio-pausa] leitura falhou:', error.message); return new Set(); }
    return new Set(((data ?? []) as Array<{ id: string }>).map((r) => String(r.id)));
  } catch (e) {
    console.warn('[cardapio-pausa] leitura falhou:', e instanceof Error ? e.message : String(e));
    return new Set();
  }
}

/**
 * Combos (entre `comboIds`) indisponíveis agora porque um item dele acabou hoje (pausado), está desligado ou
 * foi apagado (o item ou a categoria dele). Mesma regra do front (src/lib/acabouHoje.ts › comboIndisponivel):
 * linha do combo sem item ligado não trava. Erro de leitura = nenhum (nunca derruba o pedido por isto).
 */
// deno-lint-ignore no-explicit-any
export async function combosIndisponiveis(admin: any, tenantId: string, comboIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  try {
    if (!comboIds.length) return out;
    const { data: linhas, error } = await admin.from('combo_items').select('combo_id, item_id')
      .eq('tenant_id', tenantId).in('combo_id', comboIds).is('deleted_at', null);
    if (error) { console.warn('[cardapio-pausa] combo_items falhou:', error.message); return out; }
    const rows = ((linhas ?? []) as Array<{ combo_id: string; item_id: string | null }>).filter((r) => !!r.item_id);
    const itemIds = [...new Set(rows.map((r) => String(r.item_id)))];
    if (!itemIds.length) return out;
    const { data: itens, error: e2 } = await admin.from('menu_items')
      .select('id, is_active, deleted_at, pausado_ate, category_id').eq('tenant_id', tenantId).in('id', itemIds);
    if (e2) { console.warn('[cardapio-pausa] itens do combo falharam:', e2.message); return out; }
    const lista = (itens ?? []) as Array<{ id: string; is_active: boolean | null; deleted_at: string | null; pausado_ate: string | null; category_id: string | null }>;
    const catIds = [...new Set(lista.map((i) => i.category_id).filter(Boolean).map(String))];
    let catsApagadas = new Set<string>();
    if (catIds.length) {
      const { data: cats } = await admin.from('menu_categories').select('id').eq('tenant_id', tenantId).in('id', catIds).not('deleted_at', 'is', null);
      catsApagadas = new Set(((cats ?? []) as Array<{ id: string }>).map((c) => String(c.id)));
    }
    const agora = new Date();
    const ok = new Set(lista.filter((i) =>
      i.is_active !== false && i.deleted_at == null && !estaPausado(i.pausado_ate, agora)
      && !(i.category_id && catsApagadas.has(String(i.category_id))),
    ).map((i) => String(i.id)));
    for (const r of rows) if (!ok.has(String(r.item_id))) out.add(String(r.combo_id));
    return out;
  } catch (e) {
    console.warn('[cardapio-pausa] combos falharam:', e instanceof Error ? e.message : String(e));
    return out;
  }
}

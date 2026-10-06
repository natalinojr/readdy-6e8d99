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

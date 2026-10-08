// "Parece o mesmo que…" na Classificação de itens (dono, 2026-10-08): o produto é reconhecido pela descrição
// exata de cada fornecedor, então "MILHO VERDE PREDILECTA 170G LA" vira item novo mesmo com "MILHO VERDE
// BONARE 170G SACHE" já ligado ao insumo Milho Verde. Aqui só se SUGERE o vínculo de um item parecido do
// mesmo fornecedor — quem liga é a pessoa, com um toque (regra de 2026-09-24: vínculo só confirmado por gente).

export interface ItemParaParecer {
  id: string; supplier_key: string; description: string; ingredient_id: string | null;
  units_per_package: number | null; last_seen_at: string | null;
}

/** Palavras que não dizem o que o produto é (unidade, embalagem, abreviações de nota). */
const VAZIAS = new Set(['UND', 'UNID', 'UNIDADE', 'PCT', 'PACOTE', 'CAIXA', 'SACHE', 'LATA', 'PET', 'GARRAFA', 'COM', 'SEM', 'PARA', 'TIPO', 'KG', 'ML', 'LT', 'GR', 'GRS']);

export function normalizar(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9.,]+/g, ' ').trim();
}

/** Tamanho escrito na descrição, em g ou ml: "170G" → 170 g; "1,5L" → 1500 ml. Sem tamanho: null. */
export function tamanho(desc: string): { v: number; u: 'g' | 'ml' } | null {
  const m = /(\d+(?:[.,]\d+)?)\s?(KG|G|GR|GRS|ML|LT|L)\b/.exec(normalizar(desc));
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  const u = m[2];
  if (u === 'KG') return { v: n * 1000, u: 'g' };
  if (u === 'L' || u === 'LT') return { v: n * 1000, u: 'ml' };
  return { v: n, u: u === 'ML' ? 'ml' : 'g' };
}

/** Palavras que identificam o produto (3+ letras, sem número, sem as vazias). */
export function palavras(desc: string): Set<string> {
  return new Set(normalizar(desc).split(' ').filter((w) => w.length >= 3 && /^[A-Z]+$/.test(w) && !VAZIAS.has(w)));
}

/**
 * O item ligado do MESMO fornecedor que mais parece este: pelo menos 2 palavras em comum e, se os dois dizem
 * o tamanho, o mesmo tamanho. Empate: o mais recente. Nada parecido: null.
 */
export function itemParecido<T extends ItemParaParecer>(alvo: T, todos: T[]): T | null {
  if (alvo.ingredient_id) return null;
  const pa = palavras(alvo.description);
  const ta = tamanho(alvo.description);
  let melhor: { it: T; nota: number } | null = null;
  for (const it of todos) {
    if (it.id === alvo.id || !it.ingredient_id || it.supplier_key !== alvo.supplier_key) continue;
    const tb = tamanho(it.description);
    if (ta && tb && (ta.u !== tb.u || Math.abs(ta.v - tb.v) > 0.001)) continue;
    const pb = palavras(it.description);
    const comuns = [...pa].filter((w) => pb.has(w)).length;
    if (comuns < 2) continue;
    const nota = comuns + (ta && tb ? 1 : 0);
    if (!melhor || nota > melhor.nota || (nota === melhor.nota && String(it.last_seen_at ?? '') > String(melhor.it.last_seen_at ?? ''))) melhor = { it, nota };
  }
  return melhor?.it ?? null;
}

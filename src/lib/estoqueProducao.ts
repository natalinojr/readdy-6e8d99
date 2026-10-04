// Estoque › Produção: contas das fichas e dos registros, sem tela (testadas em src/test/lib).
import type { ProductionBatch, ProductionRecipe } from '@/types/estoque';
import { convertUnit } from './unitConversion';

/** Unidade da ficha/produção (un, l) → a do banco que `fmtQtd` entende (unit, L). */
export const unidadeBanco = (u: string): string => (u === 'un' ? 'unit' : u === 'l' ? 'L' : u);

export interface EsperadoDaProducao {
  /** Quanto era esperado render, na unidade da produção */
  esperadoQtd: number;
  /** Quanto do esperado saiu de fato (96 = 96%) */
  pct: number;
}

/** Esperado × real. `yieldPercentExpected` é a média das produções anteriores da ficha, gravada na hora;
 *  esperado = produzido ÷ (real ÷ esperado). Sem um dos dois rendimentos, não há o que comparar (null). */
export function esperadoDaProducao(
  b: Pick<ProductionBatch, 'producedQuantity' | 'yieldPercentActual' | 'yieldPercentExpected'>,
): EsperadoDaProducao | null {
  const real = b.yieldPercentActual;
  const esp = b.yieldPercentExpected;
  if (real == null || esp == null || !(real > 0) || !(esp > 0) || !(b.producedQuantity > 0)) return null;
  const razao = real / esp;
  return { esperadoQtd: b.producedQuantity / razao, pct: razao * 100 };
}

/** Rendimento médio das produções que têm rendimento calculado (null se nenhuma tem). */
export function rendimentoMedio(batches: Array<Pick<ProductionBatch, 'yieldPercentActual'>>): number | null {
  const v = batches.map((b) => b.yieldPercentActual).filter((y): y is number => y != null);
  return v.length ? v.reduce((s, y) => s + y, 0) / v.length : null;
}

/** Quantas receitas da ficha rendem a quantidade que falta produzir, pelo rendimento da última produção.
 *  Arredonda para cima de meia em meia receita (o campo do registro anda de 0,5 em 0,5).
 *  undefined = não dá para saber (ficha nunca produzida, unidade diferente ou conta absurda): abre com 1. */
export function receitasParaProduzir(
  alvoQtd: number,
  unidadeAlvo: string,
  ultima: Pick<ProductionBatch, 'producedQuantity' | 'unit'> | undefined,
): number | undefined {
  if (!ultima || !(alvoQtd > 0) || !(ultima.producedQuantity > 0)) return undefined;
  const rende = convertUnit(ultima.producedQuantity, ultima.unit, unidadeAlvo);
  if (rende === null || !(rende > 0)) return undefined;
  const receitas = Math.max(0.5, Math.ceil((alvoQtd / rende) * 2 - 1e-9) / 2);
  return receitas > 20 ? undefined : receitas;
}

const norm = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** Ficha cuja saída é este insumo: pelo vínculo (outputIngredientId) e, na falta dele, pelo nome — a mesma
 *  regra que o registro de produção usa para achar o insumo do produto pronto. */
export function fichaDoInsumo(
  recipes: ProductionRecipe[],
  insumo: { id: string; nome: string },
): ProductionRecipe | undefined {
  return recipes.find((r) => r.isActive && r.outputIngredientId === insumo.id)
    ?? recipes.find((r) => r.outputIngredientId === insumo.id)
    ?? recipes.find((r) => r.isActive && !r.outputIngredientId && norm(r.name) === norm(insumo.nome));
}

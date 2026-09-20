import type { RevenueSettingSource } from './revenueSources';

// ─── Tipo da empresa (tenants.kind) ──────────────────────────────────────────
// 'loja' usa o PDV normalmente. 'financeiro' é uma empresa que só usa o módulo
// Financeiro (sem pedido, caixa, cardápio, estoque, mesa ou impressora).
export type TipoEmpresa = 'loja' | 'financeiro';

/**
 * A única pergunta "esta empresa tem PDV?" do sistema.
 * O padrão seguro é "tem PDV": qualquer valor desconhecido, vazio, `null` ou
 * `undefined` devolve `true`, para que nenhuma loja perca tela por dado
 * faltando (ex.: RPC antiga em cache, campo ainda não chegou). Só
 * `'financeiro'` devolve `false`.
 */
export function empresaTemPdv(kind?: string | null): boolean {
  return kind !== 'financeiro';
}

/** Fontes de receita com que a empresa nasce (Financeiro › Receitas › Fontes). */
export function fontesPadrao(kind?: string | null): RevenueSettingSource[] {
  return kind === 'financeiro' ? ['manual'] : ['orders', 'manual'];
}

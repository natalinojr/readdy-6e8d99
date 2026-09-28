// Categorias do sistema na DRE (2026-09-28, pedido do dono).
//
// Custos que o próprio sistema gera têm uma categoria em fin_dre_categories marcada com
// `system_key`. A loja pode renomear e MOVER a categoria para qualquer grupo que a DRE
// subtrai (Deduções da receita bruta, Despesas operacionais ou grupo próprio), mas não
// pode apagar (trava no banco: fn_dre_category_system_guard).
//
// O valor de 'impostos' vem das contas a pagar classificadas nela (como qualquer categoria).
// Os de 'pessoal', 'taxas_cartao' e 'taxas_ifood' vêm do livro-razão/folha, e são
// injetados no mapa de despesas por categoria para caírem onde a loja pôs a categoria.

export type ChaveSistema = 'impostos' | 'pessoal' | 'taxas_cartao' | 'taxas_ifood';

/** Chaves cujo valor NÃO vem de contas a pagar (vem da folha e do livro-razão). */
export const CHAVES_DO_RAZAO: ChaveSistema[] = ['pessoal', 'taxas_cartao', 'taxas_ifood'];

/** Grupo "Deduções da receita bruta" (key embutida herdada do antigo "Impostos e Taxas"). */
export const GRUPO_DEDUCOES = 'tax';

export interface ValoresSistema {
  pessoal: number;
  taxasCartao: number;
  taxasIfood: number;
}

export interface CatComSistema {
  id: string;
  group_type: string;
  system_key?: string | null;
}

const CAMPO: Record<Exclude<ChaveSistema, 'impostos'>, keyof ValoresSistema> = {
  pessoal: 'pessoal',
  taxas_cartao: 'taxasCartao',
  taxas_ifood: 'taxasIfood',
};

/**
 * Põe folha e taxas na categoria do sistema correspondente. O que não tiver categoria
 * (loja sem o seed, ou categoria fora da lista carregada) volta em `soltos`, e a tela
 * mostra numa linha fixa como antes — o dinheiro nunca some do resultado.
 */
export function aplicarCategoriasSistema(
  despesas: Record<string, number>,
  cats: CatComSistema[],
  v: ValoresSistema,
): { despesas: Record<string, number>; soltos: ValoresSistema } {
  const out = { ...despesas };
  const soltos: ValoresSistema = { ...v };
  for (const chave of CHAVES_DO_RAZAO) {
    const cat = cats.find((c) => c.system_key === chave);
    const campo = CAMPO[chave as Exclude<ChaveSistema, 'impostos'>];
    if (!cat) continue;
    const valor = v[campo];
    if (valor) out[cat.id] = (out[cat.id] ?? 0) + valor;
    soltos[campo] = 0;
  }
  return { despesas: out, soltos };
}

/** Soma das categorias do grupo Deduções (a árvore inteira fica no mesmo grupo). */
export function somaDeducoes(despesas: Record<string, number>, cats: CatComSistema[]): number {
  return cats
    .filter((c) => c.group_type === GRUPO_DEDUCOES)
    .reduce((s, c) => s + (despesas[c.id] ?? 0), 0);
}

/** Texto de origem e se a linha abre o detalhe de contas a pagar. */
export function origemSistema(chave: string | null | undefined): { origin: string; drill: 'custo_pessoal' | null } | null {
  switch (chave) {
    case 'pessoal':
      return { origin: 'Folha (bruto + FGTS) — categoria do sistema', drill: 'custo_pessoal' };
    case 'taxas_cartao':
      return { origin: 'Livro-razão: fin_cash_flow → auto_card_fee (taxas de cartão e Pix) — categoria do sistema', drill: null };
    case 'taxas_ifood':
      return { origin: 'Livro-razão: fin_cash_flow → ifood_fee / conciliação do iFood — categoria do sistema', drill: null };
    default:
      return null;
  }
}

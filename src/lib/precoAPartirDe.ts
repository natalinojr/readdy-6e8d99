// Preço "a partir de": item cujo preço vem das opções obrigatórias (ex.: Duo Mex
// custa R$ 0 e o valor está nos burritos escolhidos). Só EXIBIÇÃO — nunca usar
// para cobrar. Regra: preço efetivo (com promoção) + soma das opções mais baratas
// de cada grupo obrigatório (min_selections >= 1; se min > 1, as N mais baratas).

export interface GrupoOpcaoMin {
  id: string;
  is_required?: boolean | null;
  min_selections?: number | null;
}

export interface OpcaoMin {
  option_group_id: string;
  additional_price?: number | null;
  is_active?: boolean | null;
}

/** Mínimo exigido de um grupo (obrigatório conta pelo menos 1). */
export function minExigidoGrupo(g: GrupoOpcaoMin): number {
  const base = g.min_selections != null ? g.min_selections : 0;
  return g.is_required ? Math.max(1, base) : base;
}

/**
 * Soma do mais barato de cada grupo obrigatório.
 * `indisponiveis`: ids de opções esgotadas/indisponíveis (ignoradas).
 */
export function extraMinimoOpcoes(
  grupos: GrupoOpcaoMin[],
  opcoes: Array<OpcaoMin & { id?: string }>,
  indisponiveis?: string[],
): number {
  let extra = 0;
  grupos.forEach(function (g) {
    const min = minExigidoGrupo(g);
    if (min <= 0) return;
    const precos = opcoes
      .filter(function (o) {
        return o.option_group_id === g.id && o.is_active !== false
          && !(indisponiveis && o.id && indisponiveis.indexOf(o.id) >= 0);
      })
      .map(function (o) { return o.additional_price || 0; })
      .sort(function (a, b) { return a - b; });
    for (let k = 0; k < min && k < precos.length; k++) extra += precos[k];
  });
  return extra;
}

/** Preço "a partir de" (efetivo + extra mínimo) e se deve mostrar o prefixo. */
export function precoAPartirDe(
  precoEfetivo: number,
  grupos: GrupoOpcaoMin[],
  opcoes: Array<OpcaoMin & { id?: string }>,
  indisponiveis?: string[],
): { preco: number; extra: number; aPartirDe: boolean } {
  const extra = extraMinimoOpcoes(grupos, opcoes, indisponiveis);
  return { preco: precoEfetivo + extra, extra, aPartirDe: extra > 0 };
}

type OpcaoPt = { id?: string; precoAdicional?: number; ativo?: boolean };

/** Versão para o tipo `Item` do CardapioContext (gruposOpcoes) e `ItemCardapioPublico` (opcoes[].itens). */
export function extraMinimoGruposItem(
  grupos: Array<{ obrigatorio?: boolean; minSelecao?: number; opcoes?: OpcaoPt[]; itens?: OpcaoPt[] }> | null | undefined,
  indisponiveis?: string[],
): number {
  let extra = 0;
  (grupos || []).forEach(function (g, i) {
    extra += extraMinimoOpcoes(
      [{ id: 'g' + i, is_required: g.obrigatorio, min_selections: g.minSelecao }],
      (g.opcoes || g.itens || []).map(function (o) {
        return { id: o.id, option_group_id: 'g' + i, additional_price: o.precoAdicional, is_active: o.ativo };
      }),
      indisponiveis,
    );
  });
  return extra;
}

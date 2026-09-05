import { useState, useCallback, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface DreGroup {
  id?: string;
  key: string;
  label: string;
  icon: string;
  /** Grupo embutido no sistema; não pode ser renomeado nem apagado. */
  standard: boolean;
}

export const STANDARD_DRE_GROUPS: DreGroup[] = [
  { key: 'revenue', label: 'Receitas', icon: 'ri-arrow-down-circle-line', standard: true },
  { key: 'expense', label: 'Despesas Operacionais', icon: 'ri-money-dollar-circle-line', standard: true },
];

/**
 * Grupos aposentados em 2026-09-05, a pedido do dono. Continuam reconhecidos
 * para que categorias antigas não virem "grupo customizado" e passem a ser
 * contadas duas vezes na DRE, mas não são mais oferecidos em lugar nenhum:
 *
 *  - `cost` era redundante com o CMV. Categoria de custo já ia para o CMV, que
 *    é o padrão de qualquer item sem classificação: as duas opções davam o
 *    mesmo número e a segunda ainda criava uma categoria sem uso.
 *  - `tax` nunca foi somado pela DRE, então classificar ali fazia o valor
 *    desaparecer do resultado.
 */
export const GRUPOS_LEGADOS: DreGroup[] = [
  { key: 'cost', label: 'Custos', icon: 'ri-shopping-bag-line', standard: true },
  { key: 'tax', label: 'Impostos e Taxas', icon: 'ri-government-line', standard: true },
];

/** Tudo que NÃO é grupo customizado da loja, incluindo os aposentados. */
export const STANDARD_GROUP_KEYS = [...STANDARD_DRE_GROUPS, ...GRUPOS_LEGADOS].map((g) => g.key);

/**
 * Grupos que a DRE NÃO soma em lugar nenhum hoje (ver DRETab: o resultado
 * operacional desconta expense, cost, pessoal, taxas e os grupos customizados).
 * Classificar uma compra aqui faria o valor sumir do resultado, então esses
 * grupos não são oferecidos como destino de item de compra.
 */
export const GRUPOS_FORA_DA_DRE = ['revenue', 'tax'];

/**
 * Grupo cujo valor sai do CMV e vira despesa. É `expense` e todo grupo
 * customizado — a DRE desenha uma linha própria para cada um deles.
 * `cost` continua sendo CMV, e o que a DRE não soma fica em CMV para o
 * dinheiro não desaparecer do resultado.
 */
export function isGrupoDespesa(groupType: string | null | undefined): boolean {
  if (!groupType) return false;
  if (groupType === 'cost') return false;
  return !GRUPOS_FORA_DA_DRE.includes(groupType);
}

export function useDreGroups() {
  const { user } = useAuth();
  const [rows, setRows] = useState<DreGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    if (!user?.tenantId) { setRows([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('fin_dre_groups')
      .select('id, key, label, icon')
      .eq('tenant_id', user.tenantId)
      .order('sort_order')
      .order('label');
    setRows(
      (data ?? []).map((g) => ({
        id: g.id as string,
        key: g.key as string,
        label: g.label as string,
        icon: (g.icon as string) || 'ri-folder-line',
        standard: false,
      })),
    );
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchGroups(); }, [fetchGroups]);

  // Uma linha cuja `key` é de grupo padrão não é um grupo novo: é o rótulo e o
  // ícone que a loja escolheu para aquele grupo. Sem essa separação o grupo
  // apareceria duas vezes na tela, uma como padrão e outra como customizado.
  const customGroups = rows.filter((r) => !STANDARD_GROUP_KEYS.includes(r.key));
  const overrides = rows.filter((r) => STANDARD_GROUP_KEYS.includes(r.key));

  const aplicarOverride = (g: DreGroup): DreGroup => {
    const ov = overrides.find((o) => o.key === g.key);
    return ov ? { ...g, id: ov.id, label: ov.label, icon: ov.icon } : g;
  };

  /** Só os grupos que a interface oferece hoje. Legados ficam de fora. */
  const allGroups = [...STANDARD_DRE_GROUPS.map(aplicarOverride), ...customGroups];

  /** Inclui os aposentados, para achar o rótulo de uma categoria antiga. */
  const gruposComLegado = [...allGroups, ...GRUPOS_LEGADOS.map(aplicarOverride)];

  const groupMeta = (key: string): DreGroup | undefined =>
    gruposComLegado.find((g) => g.key === key);

  return { allGroups, gruposComLegado, customGroups, loading, refetch: fetchGroups, groupMeta };
}

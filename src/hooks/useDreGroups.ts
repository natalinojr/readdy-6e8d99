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
  { key: 'cost', label: 'Custos', icon: 'ri-shopping-bag-line', standard: true },
  { key: 'expense', label: 'Despesas Operacionais', icon: 'ri-money-dollar-circle-line', standard: true },
  { key: 'tax', label: 'Impostos e Taxas', icon: 'ri-government-line', standard: true },
];

export const STANDARD_GROUP_KEYS = STANDARD_DRE_GROUPS.map((g) => g.key);

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
  const [customGroups, setCustomGroups] = useState<DreGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchGroups = useCallback(async () => {
    if (!user?.tenantId) { setCustomGroups([]); setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase
      .from('fin_dre_groups')
      .select('id, key, label, icon')
      .eq('tenant_id', user.tenantId)
      .order('sort_order')
      .order('label');
    setCustomGroups(
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

  const allGroups = [...STANDARD_DRE_GROUPS, ...customGroups];

  return { allGroups, customGroups, loading, refetch: fetchGroups };
}

import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { SUPABASE_URL } from '@/lib/supabase';
import { notifyReload, subscribeReload } from '@/lib/reloadSignal';

// Mesmo canal do useIngredientCategories: Estoque e Compras leem a MESMA lista,
// então mexer nela numa tela precisa refletir na outra.
const CHANNEL = 'ingredient_categories';

/**
 * Categorias de MERCADORIA (Bebidas, Hortifruti, Proteínas - El Patron...).
 *
 * Não confundir com `fin_dre_categories`, que é plano de contas e mistura
 * mercadoria com despesa (Aluguel, Salário). Esta lista existe para agrupar
 * o que é comprado, espelhando a coluna "Categoria" da planilha de compras.
 *
 * Leitura direta (RLS permite SELECT por tenant); escrita via financial-write.
 */
export interface MerchandiseCategory {
  id: string;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

async function callFinancialWrite(action: string, tenantId: string, payload: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) return { error: 'Sessão expirada' };

  const res = await fetch(`${SUPABASE_URL}/functions/v1/financial-write`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'apikey': import.meta.env.VITE_PUBLIC_SUPABASE_ANON_KEY as string,
    },
    body: JSON.stringify({ action, tenant_id: tenantId, payload }),
  });
  return await res.json();
}

export function useMerchandiseCategories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<MerchandiseCategory[]>([]);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  const tenantId = user?.tenantId;

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeReload(CHANNEL, () => {
      if (mountedRef.current) setTick((t) => t + 1);
    });
    return () => { mountedRef.current = false; unsub(); };
  }, []);

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('fin_merchandise_categories')
        .select('id,name,sort_order,is_active,created_at')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .order('sort_order')
        .order('name');
      if (error) {
        console.error('[useMerchandiseCategories] Erro ao buscar categorias:', error);
      }
      setCategories(data ?? []);
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  useEffect(() => { load(); }, [load, tick]);

  const upsert = useCallback(async (data: { id?: string; name: string; sort_order?: number }) => {
    if (!tenantId) return { error: 'Sem tenant' };
    const json = await callFinancialWrite('upsert_merchandise_category', tenantId, {
      id: data.id ?? undefined,
      name: data.name,
      sort_order: data.sort_order,
    });
    await load();
    if (!json?.error) notifyReload(CHANNEL);
    return json;
  }, [tenantId, load]);

  /** Soft delete: insumos e compras já classificados continuam com a categoria. */
  const remove = useCallback(async (id: string) => {
    if (!tenantId) return { error: 'Sem tenant' };
    const json = await callFinancialWrite('delete_merchandise_category', tenantId, { id });
    await load();
    if (!json?.error) notifyReload(CHANNEL);
    return json;
  }, [tenantId, load]);

  /**
   * Mescla `fromId` em `toId`: move insumos e itens de compra e desativa a origem.
   * É como o usuário colapsa duplicatas herdadas ("Mercearia" → "Secos").
   * Retorna `{ data: { moved_ingredients, moved_purchase_items } }`.
   */
  const merge = useCallback(async (fromId: string, toId: string) => {
    if (!tenantId) return { error: 'Sem tenant' };
    const json = await callFinancialWrite('merge_merchandise_category', tenantId, {
      from_id: fromId,
      to_id: toId,
    });
    await load();
    if (!json?.error) notifyReload(CHANNEL);
    return json;
  }, [tenantId, load]);

  return { categories, loading, load, upsert, remove, merge };
}

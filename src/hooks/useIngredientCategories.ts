import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, SUPABASE_URL } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { notifyReload, subscribeReload } from '@/lib/reloadSignal';

/**
 * Categorias de insumo.
 *
 * ⚠️ Desde 2026-08-26 este hook lê `fin_merchandise_categories` — a MESMA lista
 * usada pelas compras. Antes existiam três fontes concorrentes (o texto livre em
 * `ingredients.category`, a tabela de sugestões `ingredient_categories` e a lista
 * de mercadoria do financeiro), que já haviam divergido entre si.
 *
 * A interface pública foi mantida idêntica de propósito, para não mexer nas telas
 * de Estoque que consomem este hook. A tabela antiga `ingredient_categories` não
 * é mais lida (seu conteúdo foi absorvido na migração).
 */
export interface IngredientCategory {
  id: string;
  name: string;
}

const CHANNEL = 'ingredient_categories';

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

export function useIngredientCategories() {
  const { user } = useAuth();
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const unsub = subscribeReload(CHANNEL, () => {
      if (mountedRef.current) setTick(t => t + 1);
    });
    return () => {
      mountedRef.current = false;
      unsub();
    };
  }, []);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);

    try {
      // Leitura direta: a RLS de fin_merchandise_categories já permite SELECT por tenant
      const { data, error } = await supabase
        .from('fin_merchandise_categories')
        .select('id, name')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });

      if (error) {
        console.error('[useIngredientCategories] load error:', error);
      }

      if (mountedRef.current) {
        setCategories((data ?? []) as IngredientCategory[]);
        setLoading(false);
      }
    } catch (e) {
      console.error('[useIngredientCategories] load exception:', e);
      if (mountedRef.current) setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load, tick]);

  const addCategory = useCallback(async (name: string): Promise<IngredientCategory | null> => {
    if (!user?.tenantId || !name.trim()) return null;
    const trimmed = name.trim();

    if (categories.some((c) => c.name.toLowerCase() === trimmed.toLowerCase())) {
      return null;
    }

    const json = await callFinancialWrite('upsert_merchandise_category', user.tenantId, { name: trimmed });
    if (json?.error || !json?.data) {
      console.error('[useIngredientCategories] addCategory error:', json?.error);
      return null;
    }

    notifyReload(CHANNEL);
    return json.data as IngredientCategory;
  }, [user?.tenantId, categories]);

  const removeCategory = useCallback(async (id: string): Promise<boolean> => {
    if (!user?.tenantId) return false;

    // Soft delete: insumos e compras já classificados mantêm a categoria
    const json = await callFinancialWrite('delete_merchandise_category', user.tenantId, { id });
    if (json?.error) {
      console.error('[useIngredientCategories] removeCategory error:', json.error);
      return false;
    }

    notifyReload(CHANNEL);
    return true;
  }, [user?.tenantId]);

  const names = categories.map((c) => c.name);

  return { categories, names, loading, addCategory, removeCategory, reload: load };
}

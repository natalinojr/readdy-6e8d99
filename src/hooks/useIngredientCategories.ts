import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { notifyReload, subscribeReload } from '@/lib/reloadSignal';

export interface IngredientCategory {
  id: string;
  name: string;
}

const CHANNEL = 'ingredient_categories';

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
      // Usa invokeWithAuth (passa JWT automaticamente) para garantir autenticação
      const { data: fnData, error: fnErr } = await invokeWithAuth<{
        success: boolean;
        data?: IngredientCategory[];
        error?: string;
      }>('config-write', {
        body: {
          action: 'list_ingredient_categories',
          tenant_id: user.tenantId,
        },
      });

      if (!fnErr && fnData?.success && Array.isArray(fnData.data)) {
        if (mountedRef.current) {
          setCategories(fnData.data);
          setLoading(false);
        }
        return;
      }

      // Fallback: query direta
      console.warn('[useIngredientCategories] edge function falhou, tentando direto:', fnErr || fnData?.error);
      const { data, error } = await supabase
        .from('ingredient_categories')
        .select('id, name')
        .eq('tenant_id', user.tenantId)
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

    // Usa invokeWithAuth para garantir autenticação correta
    const { data: fnData, error: fnErr } = await invokeWithAuth<{ success: boolean; data?: IngredientCategory; error?: string }>('config-write', {
      body: {
        action: 'create_ingredient_category',
        tenant_id: user.tenantId,
        name: trimmed,
      },
    });

    if (fnErr || !fnData?.success || !fnData.data) {
      console.error('[useIngredientCategories] addCategory error:', fnErr || fnData?.error);
      return null;
    }

    notifyReload(CHANNEL);
    return fnData.data as IngredientCategory;
  }, [user?.tenantId, categories]);

  const removeCategory = useCallback(async (id: string): Promise<boolean> => {
    if (!user?.tenantId) return false;

    // Usa invokeWithAuth para garantir autenticação correta
    const { data, error } = await invokeWithAuth<{ success: boolean; error?: string }>('config-write', {
      body: {
        action: 'delete_ingredient_category',
        tenant_id: user.tenantId,
        id,
      },
    });

    if (error || !data?.success) {
      console.error('[useIngredientCategories] removeCategory error:', error || data?.error);
      return false;
    }

    notifyReload(CHANNEL);
    return true;
  }, [user?.tenantId]);

  const names = categories.map((c) => c.name);

  return { categories, names, loading, addCategory, removeCategory, reload: load };
}

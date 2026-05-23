import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface InsumoFaltando {
  id: string;
  nome: string;
  estoque: number;
  unidade: string;
}

export interface ItemSemEstoque {
  itemId: string;
  itemName: string;
  insumosFaltando: InsumoFaltando[];
}

/**
 * Retorna mapa de item_id → lista de insumos zerados.
 * Recarrega automaticamente quando o estoque muda.
 */
export function useItensSemEstoque() {
  const { user } = useAuth();
  const [mapaItens, setMapaItens] = useState<Map<string, InsumoFaltando[]>>(new Map());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_items_sem_estoque', {
        p_tenant_id: user.tenantId,
      });

      if (error) {
        console.warn('[useItensSemEstoque] erro:', error.message);
        return;
      }

      const rows = (data as Array<{
        item_id: string;
        item_name: string;
        insumos_faltando: Array<{
          id: string;
          nome: string;
          estoque: number;
          unidade: string;
        }>;
      }>) ?? [];

      const mapa = new Map<string, InsumoFaltando[]>();
      for (const row of rows) {
        mapa.set(row.item_id, (row.insumos_faltando ?? []).map((i) => ({
          id: i.id,
          nome: i.nome,
          estoque: Number(i.estoque ?? 0),
          unidade: i.unidade ?? 'un',
        })));
      }
      setMapaItens(mapa);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  // Escuta evento de recarregamento de estoque
  useEffect(() => {
    const handler = () => load();
    window.addEventListener('estoque_updated', handler);
    return () => window.removeEventListener('estoque_updated', handler);
  }, [load]);

  return { mapaItens, loading, reload: load };
}
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
 * Retorna:
 * - mapaItens: item_id → lista de insumos zerados (ficha técnica do item)
 * - opcoesIndisponiveisIds: Set de option_ids com insumo zerado
 * Recarrega automaticamente quando o estoque muda.
 */
export function useItensSemEstoque() {
  const { user } = useAuth();
  const [mapaItens, setMapaItens] = useState<Map<string, InsumoFaltando[]>>(new Map());
  const [opcoesIndisponiveisIds, setOpcoesIndisponiveisIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      const [itemsResult, opcoesResult] = await Promise.all([
        supabase.rpc('fn_get_items_sem_estoque', { p_tenant_id: user.tenantId }),
        supabase.rpc('fn_get_opcoes_sem_estoque', { p_tenant_id: user.tenantId }),
      ]);

      if (itemsResult.error) {
        console.warn('[useItensSemEstoque] erro items:', itemsResult.error.message);
      } else {
        const rows = (itemsResult.data as Array<{
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
      }

      if (opcoesResult.error) {
        console.warn('[useItensSemEstoque] erro opcoes:', opcoesResult.error.message);
      } else {
        const opcoeIds = (opcoesResult.data as string[] | null) ?? [];
        setOpcoesIndisponiveisIds(new Set(opcoeIds));
      }
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

  // Realtime para mudanças no estoque (stock_movements e ingredients)
  useEffect(() => {
    if (!user?.tenantId) return;
    const channel = supabase
      .channel(`opcoes-estoque-${user.tenantId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ingredients',
        filter: `tenant_id=eq.${user.tenantId}`,
      }, () => load())
      .on('postgres_changes', {
        event: 'INSERT', schema: 'public', table: 'stock_movements',
        filter: `tenant_id=eq.${user.tenantId}`,
      }, () => load())
      .subscribe();
    return () => { channel.unsubscribe(); };
  }, [user?.tenantId, load]);

  return { mapaItens, opcoesIndisponiveisIds, loading, reload: load };
}
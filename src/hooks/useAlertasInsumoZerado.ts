import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { notifyReload } from '@/lib/reloadSignal';
import { useAuth } from '@/contexts/AuthContext';

export interface ItemAfetado {
  id: string;
  nome: string;
}

export interface AlertaInsumoZerado {
  id: string;
  ingredientId: string;
  ingredientName: string;
  unidade: string;
  estoque: number;
  abertoEm: string;
  itens: ItemAfetado[];
  opcionais: ItemAfetado[];
}

type Origem = 'pdv' | 'kds';

/**
 * Insumo que zerou → pergunta antes de tirar item do cardápio.
 * O mesmo alerta aparece no PDV e no KDS ao mesmo tempo; quem responder primeiro resolve,
 * e o realtime faz o aviso sumir no outro terminal.
 * Enquanto ninguém responde, nada sai do cardápio sozinho.
 */
export function useAlertasInsumoZerado(origem: Origem) {
  const { user } = useAuth();
  const [alertas, setAlertas] = useState<AlertaInsumoZerado[]>([]);
  const [resolvendo, setResolvendo] = useState<string | null>(null);
  const tenantId = user?.tenantId;
  const loadRef = useRef<() => void>(() => {});

  const load = useCallback(async () => {
    if (!tenantId) { setAlertas([]); return; }
    const { data, error } = await supabase.rpc('fn_get_stockout_alerts', { p_tenant_id: tenantId });
    if (error) {
      console.warn('[useAlertasInsumoZerado] erro:', error.message);
      return;
    }
    const rows = (data as Array<{
      id: string;
      ingredient_id: string;
      ingredient_name: string;
      unidade: string;
      estoque: number;
      opened_at: string;
      itens: ItemAfetado[] | null;
      opcionais: ItemAfetado[] | null;
    }>) ?? [];
    setAlertas(rows.map((r) => ({
      id: r.id,
      ingredientId: r.ingredient_id,
      ingredientName: r.ingredient_name ?? 'Insumo',
      unidade: r.unidade ?? 'un',
      estoque: Number(r.estoque ?? 0),
      abertoEm: r.opened_at,
      itens: r.itens ?? [],
      opcionais: r.opcionais ?? [],
    })));
  }, [tenantId]);

  loadRef.current = load;

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!tenantId) return;
    const canal = supabase
      .channel(`stockout-alerts-${tenantId}-${origem}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ingredient_stockout_alerts',
        filter: `tenant_id=eq.${tenantId}`,
      }, () => { loadRef.current(); })
      .subscribe();
    return () => { supabase.removeChannel(canal); };
  }, [tenantId, origem]);

  /** 'removed' tira os itens do cardápio; 'kept' mantém tudo vendendo. */
  const responder = useCallback(async (alertaId: string, decisao: 'removed' | 'kept') => {
    if (!tenantId) return;
    setResolvendo(alertaId);
    // some da tela na hora — o realtime confirma para os outros terminais
    setAlertas((prev) => prev.filter((a) => a.id !== alertaId));
    try {
      const { error } = await invokeWithAuth('stock-write', {
        body: {
          action: 'resolve_stockout_alert',
          tenant_id: tenantId,
          alert_id: alertaId,
          decision: decisao,
          source: origem,
        },
      });
      if (error) {
        console.error('[useAlertasInsumoZerado] responder error:', error);
        await load(); // falhou: traz o alerta de volta
      } else if (decisao === 'removed') {
        // o cardápio mudou — CardapioContext escuta este canal
        notifyReload('cardapio');
      }
    } finally {
      setResolvendo(null);
    }
  }, [tenantId, origem, load]);

  return { alertas, responder, resolvendo, reload: load };
}

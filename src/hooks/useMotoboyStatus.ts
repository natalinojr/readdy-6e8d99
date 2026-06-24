import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';

export interface MotoboySinal { status: string; note?: string | null; driverName?: string | null; }

const JANELA_MS = 36 * 3600 * 1000; // pedidos das últimas 36h

/**
 * Lê `motoboy_status`/`motoboy_note` direto da tabela `orders` (read seguro, sem
 * tocar na RPC `fn_get_kds_orders`). Retorna um Map por order id.
 *
 * Carga inicial 1x e, daí em diante, SÓ Realtime: o próprio payload do UPDATE traz
 * `motoboy_status`/`motoboy_driver_id`, então o Map é atualizado direto do evento —
 * sem refetch periódico e sem re-query da lista (poupa a quota do servidor). A única
 * query extra é o nome do entregador quando aparece um dono novo (cacheado por id).
 */
export function useMotoboyStatus(): Map<string, MotoboySinal> {
  const { user } = useAuth();
  const tenantId = (user as { tenantId?: string } | null)?.tenantId;
  const [map, setMap] = useState<Map<string, MotoboySinal>>(new Map());
  // Cache id do entregador → nome (evita buscar o nome a cada evento).
  const nomeCacheRef = useRef<Map<string, string>>(new Map());

  const carregar = useCallback(async () => {
    if (!tenantId) return;
    try {
      const desde = new Date(Date.now() - JANELA_MS).toISOString();
      const { data } = await supabase
        .from('orders')
        .select('id, motoboy_status, motoboy_note, motoboy_driver_id, motoboy_driver:delivery_drivers!motoboy_driver_id(name)')
        .eq('tenant_id', tenantId)
        .eq('origin_type', 'delivery')
        .not('motoboy_status', 'is', null)
        .gte('created_at', desde);
      const m = new Map<string, MotoboySinal>();
      (data ?? []).forEach((o: { id: string; motoboy_status: string | null; motoboy_note: string | null; motoboy_driver_id: string | null; motoboy_driver?: { name: string | null } | { name: string | null }[] | null }) => {
        if (!o.motoboy_status) return;
        const drv = Array.isArray(o.motoboy_driver) ? o.motoboy_driver[0] : o.motoboy_driver;
        const nome = drv?.name ?? null;
        if (o.motoboy_driver_id && nome) nomeCacheRef.current.set(o.motoboy_driver_id, nome);
        m.set(o.id, { status: o.motoboy_status, note: o.motoboy_note, driverName: nome });
      });
      setMap(m);
    } catch { /* silencioso */ }
  }, [tenantId]);

  // Carga inicial (1 query).
  useEffect(() => { carregar(); }, [carregar]);

  // Realtime: cada UPDATE de `orders` atualiza só a entrada daquele pedido, a partir
  // do próprio payload — sem refetch da lista inteira.
  useEffect(() => {
    if (!tenantId) return;
    const aplicar = async (row: { id: string; motoboy_status: string | null; motoboy_note: string | null; motoboy_driver_id: string | null; origin_type: string | null; created_at: string | null }) => {
      if (!row || row.origin_type !== 'delivery') return;
      const recente = !row.created_at || new Date(row.created_at).getTime() >= Date.now() - JANELA_MS;
      if (!row.motoboy_status || !recente) {
        setMap((prev) => { if (!prev.has(row.id)) return prev; const m = new Map(prev); m.delete(row.id); return m; });
        return;
      }
      const status = row.motoboy_status; // captura antes do await (TS perde narrowing depois)
      const note = row.motoboy_note ?? null;
      let nome: string | null = null;
      if (row.motoboy_driver_id) {
        const cache = nomeCacheRef.current;
        if (cache.has(row.motoboy_driver_id)) {
          nome = cache.get(row.motoboy_driver_id) || null;
        } else {
          const { data } = await supabase.from('delivery_drivers').select('name').eq('id', row.motoboy_driver_id).maybeSingle();
          nome = data?.name ?? null;
          cache.set(row.motoboy_driver_id, nome ?? ''); // cacheia até vazio p/ não rebuscar
        }
      }
      setMap((prev) => {
        const m = new Map(prev);
        m.set(row.id, { status, note, driverName: nome });
        return m;
      });
    };
    const ch = supabase
      .channel(`motoboy-status-${tenantId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` },
        (payload) => { aplicar(payload.new as Parameters<typeof aplicar>[0]); })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tenantId]);

  return map;
}

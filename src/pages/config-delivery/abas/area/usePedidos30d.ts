import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { inicioDosUltimos30Dias } from '../../config';

/** Pedido de entrega própria dos últimos 30 dias (sem treino, sem rascunho, sem cancelado). */
export interface PedidoMes {
  id: string;
  status: string;
  subtotal: number;
  taxa: number;
  /** Distância de rota (km) gravada no pedido. */
  km: number | null;
  lat: number | null;
  lng: number | null;
}

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const PAGINA = 1000;
const MAX_PAGINAS = 5;

/**
 * Pedidos de delivery próprio dos últimos 30 dias (Brasília) — a base das contas de "Área e taxa" (quantos
 * pedidos em cada faixa, pontos no mapa) e de "Mínimo e retirada" (simulação da entrega grátis).
 * Retirada (`delivery_platform = 'retirada'`) e apps de fora (iFood etc.) ficam de fora — inclusive o pedido do iFood
 * entregue pelo motoboy da loja (`ifood_order_id`): não usa a tabela de faixas/taxa daqui e inflava a simulação.
 */
export function usePedidos30d(tenantId: string): { pedidos: PedidoMes[]; carregando: boolean; erro: string } {
  const [pedidos, setPedidos] = useState<PedidoMes[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState('');

  useEffect(() => {
    if (!tenantId) return;
    let vivo = true;
    setCarregando(true); setErro(''); setPedidos([]); // troca de loja: não deixa pedido da outra loja na tela
    (async () => {
      try {
        const desde = inicioDosUltimos30Dias();
        const linhas: Record<string, unknown>[] = [];
        for (let p = 0; p < MAX_PAGINAS; p++) {
          const { data, error } = await supabase
            .from('orders')
            .select('id, status, subtotal, delivery_fee, delivery_distance_km, delivery_lat, delivery_lng')
            .eq('tenant_id', tenantId)
            .eq('origin_type', 'delivery')
            .eq('is_training', false)
            .eq('is_draft', false)
            .or('delivery_platform.is.null,delivery_platform.eq.propria')
            .is('ifood_order_id', null) // iFood entregue pelo motoboy da loja é 'propria' no banco, mas a taxa/faixa não é da loja
            .gte('created_at', desde)
            .order('created_at', { ascending: false })
            .range(p * PAGINA, p * PAGINA + PAGINA - 1);
          if (error) throw error;
          const lote = (data ?? []) as Record<string, unknown>[];
          linhas.push(...lote);
          if (lote.length < PAGINA) break;
        }
        if (!vivo) return;
        setPedidos(linhas
          .filter((o) => !/cancel/i.test(String(o.status ?? '')))
          .map((o) => ({
            id: String(o.id),
            status: String(o.status ?? ''),
            subtotal: num(o.subtotal) ?? 0,
            taxa: num(o.delivery_fee) ?? 0,
            km: num(o.delivery_distance_km),
            lat: num(o.delivery_lat),
            lng: num(o.delivery_lng),
          })));
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : (e as { message?: string })?.message ?? String(e));
      } finally {
        if (vivo) setCarregando(false);
      }
    })();
    return () => { vivo = false; };
  }, [tenantId]);

  return { pedidos, carregando, erro };
}

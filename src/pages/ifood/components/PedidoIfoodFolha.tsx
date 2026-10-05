import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { fetchPedidosIfood, type PedidoIfood } from '@/lib/ifoodDashboard';
import { ifoodTipoPedido } from '@/lib/ifoodShipping';
import { montarPedidoOrder, montarPedidosArea, type ItemRow, type MapaCustos, type OrderRow, type PedidoArea } from '@/lib/ifoodArea';
import Folha from '@/pages/estoque/components/inicio/Folha';
import type { AcessoIfood } from '../lib/tipos';
import { nomeLoja } from '../lib/tipos';
import type { LojaIfood } from '../lib/useIfoodDados';
import DetalhePedidoIfood, { dataHoraRotulo } from './DetalhePedidoIfood';

// Folha do pedido (celular: sobe de baixo; computador: janela centralizada). Abre com `?pedido=<id do iFood>`.
// Se o pedido não está no período carregado (link de outro dia), lê o pedido sozinho.

const COLS = 'id, ifood_order_id, display_id, merchant_id, status, order_type, delivered_by, is_test, ordered_at, created_at, customer_name, customer_orders_count, total, benefits, payments, timeline, cancel_reason, order_id';

async function buscarPedido(tenantId: string, id: string, custos: MapaCustos): Promise<PedidoArea | null> {
  const { data, error } = await supabase.from('ifood_orders').select(COLS).eq('tenant_id', tenantId).eq('ifood_order_id', id).maybeSingle();
  if (error || !data) return null;
  const row = data as unknown as OrderRow;
  const it = await supabase.from('ifood_order_items').select('order_row_id, idx, name, quantity, total_price, observations, options').eq('order_row_id', row.id);
  const order = montarPedidoOrder(row, (it.data ?? []) as unknown as ItemRow[]);
  const dia = 86_400_000;
  let fin: PedidoIfood[] = [];
  try {
    const r = await fetchPedidosIfood(tenantId, new Date(order.at.getTime() - dia).toISOString(), new Date(order.at.getTime() + dia).toISOString());
    if (!r.error) fin = r.pedidos;
  } catch { /* sem o dinheiro: segue com o pedido estimado */ }
  return montarPedidosArea([order], fin.filter((f) => f.id === order.id), custos, new Map())[0] ?? null;
}

export default function PedidoIfoodFolha({ tenantId, id, pedidos, lojas, acesso, custos, onFechar, onMudou }: {
  tenantId: string;
  id: string | null;
  pedidos: PedidoArea[];
  lojas: LojaIfood[];
  acesso: AcessoIfood;
  custos: MapaCustos;
  onFechar: () => void;
  onMudou: () => void;
}) {
  const doPeriodo = useMemo(() => (id ? pedidos.find((p) => p.id === id) ?? null : null), [id, pedidos]);
  const [avulso, setAvulso] = useState<{ id: string; p: PedidoArea | null } | null>(null);
  const [lendo, setLendo] = useState(false);

  useEffect(() => {
    if (!id || doPeriodo || !tenantId) { setLendo(false); return; }
    if (avulso?.id === id) return;
    let vivo = true;
    setLendo(true);
    buscarPedido(tenantId, id, custos)
      .catch(() => null)
      .then((p) => { if (vivo) { setAvulso({ id, p }); setLendo(false); } });
    return () => { vivo = false; };
  }, [id, doPeriodo, tenantId, custos, avulso?.id]);

  if (!id) return null;
  const p = doPeriodo ?? (avulso?.id === id ? avulso.p : null);

  const titulo = p ? `${p.numero ? `#${p.numero}` : 'Pedido do iFood'}${p.cliente ? ` · ${p.cliente}` : ''}` : 'Pedido do iFood';
  const sub = p
    ? `${dataHoraRotulo(p.at)} · ${p.order ? ifoodTipoPedido({ order_type: p.order.tipo, order_timing: null, delivered_by: p.order.entregaPor, sales_channel: null, schedule: null }) : 'Pedido de antes de ligar os pedidos'} · ${nomeLoja(lojas, p.loja)}`
    : undefined;

  return (
    <Folha aberta titulo={titulo} subtitulo={sub} onFechar={onFechar}>
      {p ? (
        <div className="pb-3">
          <DetalhePedidoIfood p={p} lojas={lojas} acesso={acesso} tenantId={tenantId} modo="folha" onFechar={onFechar} onMudou={onMudou} />
        </div>
      ) : lendo || !avulso || avulso.id !== id ? (
        <div className="flex justify-center py-10"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>
      ) : (
        <p className="text-sm text-zinc-500 py-8 text-center">Não achei esse pedido do iFood nesta loja.</p>
      )}
    </Folha>
  );
}

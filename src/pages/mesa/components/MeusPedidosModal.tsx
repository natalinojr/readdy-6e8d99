import { useState, useEffect } from 'react';
import { X, ReceiptText, ChevronDown, ChevronUp } from 'lucide-react';
import { supabase } from '@/lib/supabase';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface ItemPedido {
  id: string;
  item_name: string;
  item_price: number;
  quantity: number;
  notes: string | null;
  status: string;
  options: { option_name: string; group_name: string; additional_price: number }[];
  observations: { text: string; is_checked: boolean }[];
}

interface Pedido {
  id: string;
  number: string;
  total_amount: number;
  subtotal: number;
  items: ItemPedido[];
  created_at: string;
}

interface MeusPedidosModalProps {
  tableSessionId: string;
  clienteNome: string;
  tenantId: string;
  onClose: () => void;
}

export default function MeusPedidosModal({
  tableSessionId,
  clienteNome,
  tenantId,
  onClose,
}: MeusPedidosModalProps) {
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  useEffect(() => {
    const buscarPedidos = async () => {
      setCarregando(true);
      try {
        const { data: orders } = await supabase
          .from('orders')
          .select('id, number, total_amount, subtotal, created_at')
          .eq('table_session_id', tableSessionId)
          .eq('destination_name', clienteNome)
          .order('created_at', { ascending: true });

        if (!orders?.length) {
          setPedidos([]);
          setCarregando(false);
          return;
        }

        const pedidosComItens: Pedido[] = await Promise.all(
          orders.map(async (order) => {
            // Buscar itens do pedido
            const { data: items } = await supabase
              .from('order_items')
              .select('id, item_name, item_price, quantity, notes, status')
              .eq('order_id', order.id)
              .order('created_at', { ascending: true });

            if (!items?.length) {
              return {
                id: order.id,
                number: order.number ?? `#${order.id.slice(0, 8)}`,
                total_amount: order.total_amount ?? 0,
                subtotal: order.subtotal ?? 0,
                created_at: order.created_at,
                items: [],
              };
            }

            const itemIds = items.map((it) => it.id);

            // Buscar opções dos itens
            const { data: options } = await supabase
              .from('order_item_options')
              .select('order_item_id, option_name, group_name, additional_price')
              .in('order_item_id', itemIds);

            // Buscar observações dos itens
            const { data: observations } = await supabase
              .from('order_item_observations')
              .select('order_item_id, text, is_checked')
              .in('order_item_id', itemIds);

            // Agrupar por item
            const optionsMap: Record<string, ItemPedido['options']> = {};
            (options ?? []).forEach((opt) => {
              if (!optionsMap[opt.order_item_id]) optionsMap[opt.order_item_id] = [];
              optionsMap[opt.order_item_id].push({
                option_name: opt.option_name,
                group_name: opt.group_name,
                additional_price: opt.additional_price ?? 0,
              });
            });

            const obsMap: Record<string, ItemPedido['observations']> = {};
            (observations ?? []).forEach((obs) => {
              if (!obsMap[obs.order_item_id]) obsMap[obs.order_item_id] = [];
              obsMap[obs.order_item_id].push({
                text: obs.text,
                is_checked: obs.is_checked ?? true,
              });
            });

            return {
              id: order.id,
              number: order.number ?? `#${order.id.slice(0, 8)}`,
              total_amount: order.total_amount ?? 0,
              subtotal: order.subtotal ?? 0,
              created_at: order.created_at,
              items: items.map((it) => ({
                id: it.id,
                item_name: it.item_name,
                item_price: it.item_price ?? 0,
                quantity: it.quantity ?? 1,
                notes: it.notes,
                status: it.status,
                options: optionsMap[it.id] ?? [],
                observations: obsMap[it.id] ?? [],
              })),
            };
          })
        );

        setPedidos(pedidosComItens);
        if (pedidosComItens.length > 0) {
          setExpandedOrderId(pedidosComItens[pedidosComItens.length - 1].id);
        }
      } catch (e) {
        console.error('[MeusPedidos] Erro ao buscar pedidos:', e);
      } finally {
        setCarregando(false);
      }
    };

    buscarPedidos();
  }, [tableSessionId, clienteNome, tenantId]);

  const totalConta = pedidos.reduce((s, p) => s + p.total_amount, 0);

  const toggleExpand = (id: string) => {
    setExpandedOrderId((prev) => (prev === id ? null : id));
  };

  const statusLabel: Record<string, string> = {
    new: 'Aguardando',
    preparing: 'Em preparo',
    ready: 'Pronto',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
  };

  const statusColor: Record<string, string> = {
    new: 'text-zinc-400 bg-zinc-100',
    preparing: 'text-amber-600 bg-amber-100',
    ready: 'text-emerald-600 bg-emerald-100',
    delivered: 'text-zinc-400 bg-zinc-50',
    cancelled: 'text-red-500 bg-red-50',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl">
              <ReceiptText size={18} className="text-amber-600" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Meus Pedidos</h2>
              <p className="text-[10px] text-zinc-400">{clienteNome}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-4">
          {carregando ? (
            <div className="flex flex-col items-center py-12">
              <div className="w-8 h-8 flex items-center justify-center">
                <i className="ri-loader-4-line text-2xl text-amber-500 animate-spin" />
              </div>
              <p className="text-xs text-zinc-400 mt-3">Carregando seus pedidos...</p>
            </div>
          ) : pedidos.length === 0 ? (
            <div className="flex flex-col items-center py-12 text-center">
              <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
                <ReceiptText size={24} className="text-zinc-300" />
              </div>
              <p className="text-sm font-semibold text-zinc-600">Nenhum pedido encontrado</p>
              <p className="text-xs text-zinc-400 mt-1">Seus pedidos enviados aparecerão aqui</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pedidos.map((pedido) => {
                const isExpanded = expandedOrderId === pedido.id;
                const data = new Date(pedido.created_at);
                const hora = `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;

                return (
                  <div key={pedido.id} className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden">
                    {/* Pedido header - clicável */}
                    <button
                      onClick={() => toggleExpand(pedido.id)}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 flex items-center justify-center bg-amber-50 rounded-xl">
                          <span className="text-xs font-black text-amber-600">{pedido.number}</span>
                        </div>
                        <div>
                          <p className="text-xs font-bold text-zinc-800">
                            {pedido.items.length} {pedido.items.length === 1 ? 'item' : 'itens'}
                          </p>
                          <p className="text-[10px] text-zinc-400">{hora}</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-bold text-zinc-900">{fmt(pedido.total_amount)}</span>
                        <div className="w-6 h-6 flex items-center justify-center text-zinc-400">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </div>
                      </div>
                    </button>

                    {/* Itens expandidos */}
                    {isExpanded && (
                      <div className="border-t border-zinc-100">
                        <div className="px-4 py-2 divide-y divide-zinc-50">
                          {pedido.items.map((item) => {
                            const precoTotalItem = item.item_price * item.quantity;
                            return (
                              <div key={item.id} className="py-2.5">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs font-semibold text-zinc-800 truncate">
                                        {item.item_name}
                                      </p>
                                      <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ${statusColor[item.status] ?? 'text-zinc-400 bg-zinc-100'}`}>
                                        {statusLabel[item.status] ?? item.status}
                                      </span>
                                    </div>

                                    {/* Opções */}
                                    {item.options.length > 0 && (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {item.options.map((opt, i) => (
                                          <span
                                            key={i}
                                            className="text-[9px] text-zinc-500 bg-zinc-50 px-1.5 py-0.5 rounded-md"
                                          >
                                            {opt.option_name}
                                            {opt.additional_price > 0 && (
                                              <span className="text-zinc-400 ml-0.5">+{fmt(opt.additional_price)}</span>
                                            )}
                                          </span>
                                        ))}
                                      </div>
                                    )}

                                    {/* Observações */}
                                    {item.observations.filter((o) => o.is_checked).length > 0 && (
                                      <div className="mt-1">
                                        {item.observations
                                          .filter((o) => o.is_checked)
                                          .map((obs, i) => (
                                            <p key={i} className="text-[9px] text-amber-600 italic">
                                              "{obs.text}"
                                            </p>
                                          ))}
                                      </div>
                                    )}

                                    {/* Nota livre */}
                                    {item.notes && (
                                      <p className="text-[9px] text-zinc-400 italic mt-0.5 truncate">
                                        Obs: {item.notes}
                                      </p>
                                    )}
                                  </div>

                                  <div className="text-right flex-shrink-0">
                                    <p className="text-xs font-bold text-zinc-800">{fmt(precoTotalItem)}</p>
                                    <p className="text-[9px] text-zinc-400">
                                      {item.quantity}x {fmt(item.item_price)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Subtotais do pedido */}
                        <div className="bg-zinc-50/70 px-4 py-2.5 space-y-1 border-t border-zinc-100">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500">Subtotal do pedido</span>
                            <span className="text-xs font-semibold text-zinc-700">{fmt(pedido.subtotal)}</span>
                          </div>
                          {pedido.total_amount !== pedido.subtotal && (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-zinc-500">Total do pedido</span>
                              <span className="text-xs font-bold text-zinc-800">{fmt(pedido.total_amount)}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer com total */}
        <div className="border-t border-zinc-100 bg-white px-5 py-4 flex-shrink-0 rounded-b-2xl">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] text-zinc-400 uppercase tracking-wider">Total da Conta</p>
              <p className="text-[10px] text-zinc-400">{pedidos.length} {pedidos.length === 1 ? 'pedido' : 'pedidos'}</p>
            </div>
            <span className="text-xl font-black text-amber-600">{fmt(totalConta)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
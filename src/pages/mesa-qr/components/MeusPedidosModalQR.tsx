function formatMoney(v: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
}

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

interface Props {
  participantId: string;
  participantName: string;
  tenantId: string;
  onClose: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  new: 'Aguardando',
  preparing: 'Em preparo',
  ready: 'Pronto',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
};

const STATUS_COLORS: Record<string, string> = {
  new: 'text-zinc-400 bg-zinc-100',
  preparing: 'text-amber-600 bg-amber-100',
  ready: 'text-emerald-600 bg-emerald-100',
  delivered: 'text-zinc-400 bg-zinc-50',
  cancelled: 'text-red-500 bg-red-50',
};

export default function MeusPedidosModalQR(props: Props) {
  const participantId = props.participantId;
  const participantName = props.participantName;
  const onClose = props.onClose;

  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(null);

  useEffect(function () {
    let cancelled = false;

    async function buscarPedidos() {
      setCarregando(true);
      const url = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '') + '/functions/v1/mesa-write';
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'get_meus_pedidos', participant_id: participantId }),
        });
        const result = await res.json();
        if (cancelled) return;

        const orders = result.data || [];
        const pedidosFormatados: Pedido[] = orders.map(function (order: any) {
          return {
            id: order.id,
            number: order.number ? order.number.slice(-3) : '#' + order.id.slice(0, 8),
            total_amount: order.total_amount || 0,
            subtotal: order.subtotal || 0,
            created_at: order.created_at,
            items: (order.order_items || []).map(function (it: any) {
              return {
                id: it.id,
                item_name: it.item_name,
                item_price: it.item_price || 0,
                quantity: it.quantity || 1,
                notes: it.notes,
                status: it.status,
                options: (it.order_item_options || []).map(function (o: any) {
                  return {
                    option_name: o.option_name,
                    group_name: o.group_name || '',
                    additional_price: o.additional_price || 0,
                  };
                }),
                observations: (it.order_item_observations || []).map(function (o: any) {
                  return {
                    text: o.text,
                    is_checked: true,
                  };
                }),
              };
            }),
          };
        });

        setPedidos(pedidosFormatados);
        if (pedidosFormatados.length > 0) {
          setExpandedOrderId(pedidosFormatados[pedidosFormatados.length - 1].id);
        }
      } catch (e) {
        console.error('[MeusPedidosQR] Erro ao buscar pedidos:', e);
      } finally {
        if (!cancelled) setCarregando(false);
      }
    }

    buscarPedidos();

    return function () {
      cancelled = true;
    };
  }, [participantId]);

  const totalConta = pedidos.reduce(function (s, p) { return s + p.total_amount; }, 0);

  function toggleExpand(id: string) {
    setExpandedOrderId(function (prev) {
      return prev === id ? null : id;
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="bg-white w-full max-w-sm rounded-t-3xl sm:rounded-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-receipt-line text-amber-600 text-base" />
            </div>
            <div>
              <h2 className="text-base font-bold text-zinc-900">Meus Pedidos</h2>
              <p className="text-[10px] text-zinc-400">{participantName}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-100 hover:bg-zinc-200 text-zinc-500 cursor-pointer transition-colors"
          >
            <i className="ri-close-line text-base" />
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
                <i className="ri-receipt-line text-zinc-300 text-xl" />
              </div>
              <p className="text-sm font-semibold text-zinc-600">Nenhum pedido encontrado</p>
              <p className="text-xs text-zinc-400 mt-1">Seus pedidos enviados aparecerão aqui</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pedidos.map(function (pedido) {
                const isExpanded = expandedOrderId === pedido.id;
                const data = new Date(pedido.created_at);
                const hora = String(data.getHours()).padStart(2, '0') + ':' + String(data.getMinutes()).padStart(2, '0');

                return (
                  <div key={pedido.id} className="bg-white border border-zinc-200/80 rounded-2xl overflow-hidden">
                    <button
                      type="button"
                      onClick={function () { toggleExpand(pedido.id); }}
                      className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors text-left"
                    >
                      <div className="flex items-center gap-3">
                        <div className="min-w-9 h-9 flex items-center justify-center bg-amber-50 rounded-xl px-2">
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
                        <span className="text-sm font-bold text-zinc-900">{formatMoney(pedido.total_amount)}</span>
                        <div className="w-6 h-6 flex items-center justify-center text-zinc-400">
                          {isExpanded ? <i className="ri-arrow-up-s-line text-sm" /> : <i className="ri-arrow-down-s-line text-sm" />}
                        </div>
                      </div>
                    </button>

                    {isExpanded ? (
                      <div className="border-t border-zinc-100">
                        <div className="px-4 py-2 divide-y divide-zinc-50">
                          {pedido.items.map(function (item) {
                            const precoTotalItem = item.item_price * item.quantity;
                            return (
                              <div key={item.id} className="py-2.5">
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                      <p className="text-xs font-semibold text-zinc-800 truncate">
                                        {item.item_name}
                                      </p>
                                      <span className={'text-[8px] font-bold px-1.5 py-0.5 rounded-full whitespace-nowrap ' + (STATUS_COLORS[item.status] || 'text-zinc-400 bg-zinc-100')}>
                                        {STATUS_LABELS[item.status] || item.status}
                                      </span>
                                    </div>

                                    {item.options.length > 0 ? (
                                      <div className="mt-1 flex flex-wrap gap-1">
                                        {item.options.map(function (opt, i) {
                                          return (
                                            <span
                                              key={i}
                                              className="text-[9px] text-zinc-500 bg-zinc-50 px-1.5 py-0.5 rounded-md"
                                            >
                                              {opt.option_name}
                                              {opt.additional_price > 0 ? (
                                                <span className="text-zinc-400 ml-0.5">+{formatMoney(opt.additional_price)}</span>
                                              ) : null}
                                            </span>
                                          );
                                        })}
                                      </div>
                                    ) : null}

                                    {item.observations.filter(function (o) { return o.is_checked; }).length > 0 ? (
                                      <div className="mt-1">
                                        {item.observations
                                          .filter(function (o) { return o.is_checked; })
                                          .map(function (obs, i) {
                                            return (
                                              <p key={i} className="text-[9px] text-amber-600 italic">
                                                "{obs.text}"
                                              </p>
                                            );
                                          })}
                                      </div>
                                    ) : null}

                                    {item.notes ? (
                                      <p className="text-[9px] text-zinc-400 italic mt-0.5 truncate">
                                        Obs: {item.notes}
                                      </p>
                                    ) : null}
                                  </div>

                                  <div className="text-right flex-shrink-0">
                                    <p className="text-xs font-bold text-zinc-800">{formatMoney(precoTotalItem)}</p>
                                    <p className="text-[9px] text-zinc-400">
                                      {item.quantity}x {formatMoney(item.item_price)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        <div className="bg-zinc-50/70 px-4 py-2.5 space-y-1 border-t border-zinc-100">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] text-zinc-500">Subtotal do pedido</span>
                            <span className="text-xs font-semibold text-zinc-700">{formatMoney(pedido.subtotal)}</span>
                          </div>
                          {pedido.total_amount !== pedido.subtotal ? (
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] text-zinc-500">Total do pedido</span>
                              <span className="text-xs font-bold text-zinc-800">{formatMoney(pedido.total_amount)}</span>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    ) : null}
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
            <span className="text-xl font-black text-amber-600">{formatMoney(totalConta)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
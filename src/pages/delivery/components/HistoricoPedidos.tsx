import { useState, useEffect } from 'react';

type OrderSummary = {
  id: string;
  number: string;
  status: string;
  created_at: string;
  total_amount: number;
  delivery_fee: number;
};

interface Props {
  tenantId: string;
  phone: string;
  numeroAtual?: string;
  onVerPedido?: (numero: string) => void;
}

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    const hoje = new Date();
    const diffMs = hoje.getTime() - d.getTime();
    const diffDias = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    if (diffDias === 0) return 'Hoje, ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    if (diffDias === 1) return 'Ontem, ' + d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit' }) + ', ' +
      d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'Recebido',
    preparing: 'Em preparo',
    ready: 'Pronto',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
    draft: 'Rascunho',
  };
  return map[status] || status;
}

function getStatusStyle(status: string): { bg: string; text: string; border: string; icon: string } {
  const map: Record<string, { bg: string; text: string; border: string; icon: string }> = {
    new: { bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200/60', icon: 'ri-check-double-line' },
    preparing: { bg: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200/60', icon: 'ri-restaurant-2-line' },
    ready: { bg: 'bg-green-50', text: 'text-green-700', border: 'border-green-200/60', icon: 'ri-checkbox-circle-line' },
    delivered: { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200/60', icon: 'ri-motorbike-line' },
    cancelled: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200/60', icon: 'ri-close-circle-line' },
    draft: { bg: 'bg-zinc-50', text: 'text-zinc-600', border: 'border-zinc-200/60', icon: 'ri-draft-line' },
  };
  return map[status] || map.draft;
}

export default function HistoricoPedidos(props: Props) {
  const tenantId = props.tenantId;
  const phone = props.phone;
  const numeroAtual = props.numeroAtual;
  const onVerPedido = props.onVerPedido;

  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  function fetchHistory() {
    if (!tenantId || !phone) return;

    setLoading(true);
    setError('');

    fetch(getDeliveryWriteUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_customer_orders', tenant_id: tenantId, phone: phone }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setError(data.message || 'Erro ao carregar histórico');
          setLoading(false);
          return;
        }
        setOrders(data.orders || []);
        setLoading(false);
      })
      .catch(function () {
        setError('Erro de conexão');
        setLoading(false);
      });
  }

  useEffect(function () {
    fetchHistory();
  }, [tenantId, phone]);

  if (loading) {
    return (
      <div className="text-center py-10">
        <div className="w-10 h-10 flex items-center justify-center mx-auto mb-3 bg-amber-50 rounded-2xl border border-amber-100">
          <i className="ri-loader-4-line text-lg text-amber-500 animate-spin" />
        </div>
        <p className="text-xs text-zinc-500">Carregando histórico...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-10 px-4">
        <div className="w-10 h-10 flex items-center justify-center mx-auto mb-3 bg-red-50 rounded-2xl border border-red-100">
          <i className="ri-error-warning-line text-lg text-red-500" />
        </div>
        <p className="text-xs text-zinc-500 mb-3">{error}</p>
        <button
          type="button"
          onClick={fetchHistory}
          className="px-4 py-2 bg-amber-50 text-amber-700 text-xs font-bold rounded-xl cursor-pointer hover:bg-amber-100 transition-colors whitespace-nowrap"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="text-center py-12 flex flex-col items-center">
        <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-history-line text-2xl text-zinc-300" />
        </div>
        <p className="text-sm font-bold text-zinc-700 mb-1">Nenhum pedido ainda</p>
        <p className="text-xs text-zinc-500">Seus pedidos de delivery aparecerão aqui</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map(function (order) {
        const style = getStatusStyle(order.status);
        const isCurrentOrder = numeroAtual && order.number === numeroAtual;

        return (
          <div
            key={order.id}
            className={'bg-white rounded-2xl border p-4 transition-all cursor-pointer hover:border-amber-200/60 ' +
              (isCurrentOrder ? 'border-amber-300 ring-1 ring-amber-100' : 'border-zinc-100')
            }
            onClick={function () {
              if (onVerPedido) onVerPedido(order.number);
            }}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-zinc-800">#{order.number}</span>
                  <span
                    className={'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ' +
                      style.bg + ' ' + style.text + ' ' + style.border
                    }
                  >
                    <i className={style.icon + ' text-[9px]'} />
                    {getStatusLabel(order.status)}
                  </span>
                </div>
                <p className="text-[10px] text-zinc-400 mt-1">{formatDate(order.created_at)}</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-amber-600">R$ {order.total_amount.toFixed(2)}</p>
                {order.delivery_fee > 0 ? (
                  <p className="text-[10px] text-zinc-400">+ taxa R$ {order.delivery_fee.toFixed(2)}</p>
                ) : null}
              </div>
            </div>

            <div className="flex items-center justify-between">
              {isCurrentOrder ? (
                <span className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                  Pedido atual
                </span>
              ) : (
                <span />
              )}
              <span className="text-[11px] text-amber-600 font-bold flex items-center gap-1 hover:text-amber-700 transition-colors">
                Ver detalhes
                <i className="ri-arrow-right-s-line text-xs" />
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
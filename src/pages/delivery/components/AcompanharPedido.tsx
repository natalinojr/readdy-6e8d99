import { useState, useEffect, useRef } from 'react';

type OrderStatusData = {
  id: string;
  number: string;
  status: string;
  created_at: string;
  updated_at: string;
  out_for_delivery_at: string | null;
  delivery_sla_min: number | null;
  total_amount: number;
  delivery_fee: number;
  subtotal: number;
  items: Array<{ id: string; item_name: string; item_price: number; quantity: number; notes: string | null }>;
};

interface Props {
  numeroPedido: string;
  tenantId: string;
  onNovoPedido: () => void;
}

const STATUS_STEPS = [
  { key: 'new', label: 'Recebido', icon: 'ri-check-double-line', description: 'Seu pedido foi recebido' },
  { key: 'preparing', label: 'Em preparo', icon: 'ri-restaurant-2-line', description: 'Cozinha preparando' },
  { key: 'ready', label: 'Pronto', icon: 'ri-checkbox-circle-line', description: 'Aguardando entregador' },
  { key: 'em_rota', label: 'Em rota', icon: 'ri-motorbike-line', description: 'Saiu para entrega' },
  { key: 'delivered', label: 'Entregue', icon: 'ri-checkbox-circle-fill', description: 'Pedido entregue' },
];

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'Recebido',
    preparing: 'Em preparo',
    ready: 'Pronto',
    em_rota: 'Em rota',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
    draft: 'Rascunho',
  };
  return map[status] || status;
}

function getDeliveryWriteUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/delivery-write';
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '';
  }
}

export default function AcompanharPedido(props: Props) {
  const numeroPedido = props.numeroPedido;
  const tenantId = props.tenantId;
  const onNovoPedido = props.onNovoPedido;

  const [orderData, setOrderData] = useState<OrderStatusData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function fetchStatus() {
    if (!tenantId || !numeroPedido) return;

    fetch(getDeliveryWriteUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'get_order_status', tenant_id: tenantId, order_number: numeroPedido }),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (data.error) {
          setError(data.message || 'Erro ao buscar status');
          setLoading(false);
          return;
        }
        setOrderData(data.order);
        setLoading(false);
      })
      .catch(function () {
        setError('Erro de conexão');
        setLoading(false);
      });
  }

  useEffect(function () {
    fetchStatus();
    intervalRef.current = setInterval(fetchStatus, 10000);
    return function () {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [numeroPedido, tenantId]);

  function getStepIndex(status: string): number {
    const order = ['new', 'preparing', 'ready', 'em_rota', 'delivered'];
    const idx = order.indexOf(status);
    if (idx < 0) return -1;
    return idx;
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <div className="w-12 h-12 flex items-center justify-center mx-auto mb-4 bg-amber-50 rounded-2xl border border-amber-100">
          <i className="ri-loader-4-line text-xl text-amber-500 animate-spin" />
        </div>
        <p className="text-sm font-bold text-zinc-700">Buscando pedido...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-12 h-12 flex items-center justify-center mx-auto mb-4 bg-red-50 rounded-2xl border border-red-100">
          <i className="ri-error-warning-line text-xl text-red-500" />
        </div>
        <p className="text-sm font-bold text-zinc-700 mb-2">Erro ao carregar</p>
        <p className="text-xs text-zinc-500 mb-4">{error}</p>
        <button
          type="button"
          onClick={fetchStatus}
          className="px-4 py-2 bg-amber-50 text-amber-700 text-sm font-bold rounded-xl cursor-pointer hover:bg-amber-100 transition-colors whitespace-nowrap"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!orderData) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-zinc-500">Pedido não encontrado</p>
      </div>
    );
  }

  const rawStatus = orderData.status;
  // "Em rota" não é um valor do enum — é derivado de out_for_delivery_at (mesma lógica do KDS).
  const status = (rawStatus !== 'delivered' && rawStatus !== 'cancelled' && orderData.out_for_delivery_at)
    ? 'em_rota'
    : rawStatus;
  const currentStep = getStepIndex(status);
  const isCancelled = status === 'cancelled';
  const isDelivered = status === 'delivered';

  // Previsão máxima de entrega = horário do pedido + tempo total da faixa de distância (SLA).
  const previsaoEntregaMs = (orderData.delivery_sla_min != null && orderData.delivery_sla_min > 0)
    ? new Date(orderData.created_at).getTime() + orderData.delivery_sla_min * 60000
    : null;
  const mostrarPrevisao = previsaoEntregaMs != null && !isCancelled && !isDelivered;

  return (
    <div>
      {/* Status principal */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          {isCancelled ? (
            <div className="w-10 h-10 flex items-center justify-center bg-red-100 rounded-xl">
              <i className="ri-close-circle-line text-red-500 text-lg" />
            </div>
          ) : isDelivered ? (
            <div className="w-10 h-10 flex items-center justify-center bg-green-100 rounded-xl">
              <i className="ri-check-double-line text-green-500 text-lg" />
            </div>
          ) : (
            <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl">
              <i className="ri-time-line text-amber-500 text-lg animate-pulse" />
            </div>
          )}
          <div>
            <p className="text-sm font-bold text-zinc-800">
              {isCancelled ? 'Pedido Cancelado' : isDelivered ? 'Pedido Entregue' : 'Pedido em andamento'}
            </p>
            <p className="text-xs text-zinc-500">
              {formatDate(orderData.created_at)} às {formatTime(orderData.created_at)}
            </p>
          </div>
        </div>

        {!isCancelled ? (
          <div className="mt-1 flex items-center gap-1">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-700 text-[10px] font-bold rounded-full border border-amber-200/60">
              <i className="ri-hashtag text-[9px]" />
              {orderData.number}
            </span>
            <span className="text-[10px] font-medium text-zinc-400">
              {getStatusLabel(status)}
            </span>
          </div>
        ) : (
          <div className="mt-2 px-3 py-2 bg-red-50 border border-red-100 rounded-xl">
            <p className="text-xs text-red-600 font-medium flex items-center gap-1.5">
              <i className="ri-information-line text-sm" />
              Seu pedido foi cancelado. Entre em contato com o estabelecimento para mais informações.
            </p>
          </div>
        )}
      </div>

      {/* Previsão máxima de entrega */}
      {mostrarPrevisao ? (
        <div className="mb-6 flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-100 rounded-2xl">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl shrink-0">
            <i className="ri-time-line text-amber-600 text-lg" />
          </div>
          <div>
            <p className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Previsão de entrega até</p>
            <p className="text-lg font-black text-zinc-800 leading-tight">{formatTime(new Date(previsaoEntregaMs!).toISOString())}</p>
          </div>
        </div>
      ) : null}

      {/* Tracker visual */}
      {!isCancelled ? (
        <div className="mb-6">
          <div className="relative">
            {STATUS_STEPS.map(function (step, idx) {
              const isComplete = idx <= currentStep;
              const isCurrent = idx === currentStep;

              return (
                <div key={step.key} className="flex items-start gap-4 mb-0 relative">
                  {/* Linha conectando */}
                  {idx < STATUS_STEPS.length - 1 ? (
                    <div className="absolute left-[19px] top-10 bottom-0 w-0.5 z-0">
                      <div
                        className={'w-full h-full rounded-full transition-all duration-500 ' +
                          (idx < currentStep ? 'bg-amber-400' : 'bg-zinc-200')
                        }
                      />
                    </div>
                  ) : null}

                  {/* Círculo do step */}
                  <div className="relative z-10 shrink-0">
                    <div
                      className={'w-[38px] h-[38px] flex items-center justify-center rounded-full border-2 transition-all duration-300 ' +
                        (isComplete
                          ? 'bg-amber-500 border-amber-500'
                          : 'bg-white border-zinc-200')
                      }
                    >
                      {isComplete ? (
                        <i className="ri-check-line text-white text-sm" />
                      ) : (
                        <span className="text-zinc-300 text-xs font-bold">{idx + 1}</span>
                      )}
                    </div>
                  </div>

                  {/* Conteúdo do step */}
                  <div className={'pb-6 ' + (idx === STATUS_STEPS.length - 1 ? 'pb-0' : '')}>
                    <p
                      className={'text-sm font-bold transition-colors duration-300 ' +
                        (isComplete ? 'text-zinc-800' : 'text-zinc-400')
                      }
                    >
                      {step.label}
                    </p>
                    <p className="text-xs text-zinc-400 mt-0.5">{step.description}</p>
                    {isCurrent && !isDelivered ? (
                      <span className="inline-flex items-center gap-1 mt-1.5 text-[10px] font-medium text-amber-600">
                        <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
                        Agora
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* Itens do pedido */}
      <div className="bg-zinc-50 rounded-2xl p-4 mb-4">
        <h4 className="text-xs font-bold text-zinc-500 uppercase tracking-wider mb-3">Itens do pedido</h4>
        <div className="space-y-2">
          {orderData.items.map(function (item) {
            return (
              <div key={item.id} className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs font-bold text-zinc-800 w-5 text-center shrink-0">{item.quantity}x</span>
                  <span className="text-xs text-zinc-700 truncate">{item.item_name}</span>
                </div>
                <span className="text-xs font-bold text-zinc-800 shrink-0 ml-3">
                  R$ {(item.item_price * item.quantity).toFixed(2)}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Resumo financeiro */}
      <div className="bg-white rounded-2xl border border-zinc-100 p-4 space-y-2 mb-6">
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Subtotal</span>
          <span className="font-bold text-zinc-800">R$ {(orderData.subtotal || 0).toFixed(2)}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-zinc-500">Taxa de entrega</span>
          <span className="font-bold text-zinc-800">
            {orderData.delivery_fee > 0 ? 'R$ ' + orderData.delivery_fee.toFixed(2) : 'Grátis'}
          </span>
        </div>
        <div className="h-px bg-zinc-100" />
        <div className="flex items-center justify-between">
          <span className="text-sm font-bold text-zinc-800">Total</span>
          <span className="text-sm font-bold text-amber-600">R$ {orderData.total_amount.toFixed(2)}</span>
        </div>
      </div>

      <button
        type="button"
        onClick={onNovoPedido}
        className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 text-white font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap text-sm flex items-center justify-center gap-2"
      >
        <i className="ri-add-line text-sm" />
        Fazer novo pedido
      </button>
    </div>
  );
}
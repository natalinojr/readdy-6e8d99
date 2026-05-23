import { memo } from 'react';
import type { KDSPedido, KDSItem } from '@/types/kds';
import { deriveItemStatus } from './KDSCard';

interface Props {
  pedido: KDSPedido;
  itensVisiveis: KDSItem[];
  clienteEditando: boolean;
  pedidoPodePronto: boolean;
  onAvancarPedido: (pedidoId: string) => void;
  onMarcarEmRota?: (pedidoId: string) => void;
  onAvancarPedidoGate: (tipo: 'iniciar' | 'entregar') => void;
  onMarcarProntoPedidoGate: () => void;
}

/**
 * Bottom action buttons for the whole order:
 * "Iniciar Todos", "Marcar Entregue", "Em rota de entrega", "Confirmar Entrega"
 */
const KDSCardActions = memo(function KDSCardActions({
  pedido, itensVisiveis, clienteEditando, pedidoPodePronto,
  onMarcarEmRota, onAvancarPedidoGate, onMarcarProntoPedidoGate,
}: Props) {
  const todosProntos = itensVisiveis.every((i) => {
    const s = deriveItemStatus(i);
    return s === 'pronto' || s === 'entregue';
  });

  const isDelivery = pedido.destino === 'delivery' || pedido.origem === 'delivery';
  const semOperadorCount = itensVisiveis.filter((i) => !i.operadorPreparo).length;

  // Pedidos de autoatendimento não pagos: entrega bloqueada até pagamento no caixa
  const isKioskNaoPago = pedido.origem === 'autoatendimento' && !pedido.isPaid;

  return (
    <>
      {/* Delivery: Em rota */}
      {todosProntos && pedido.status === 'pronto' && isDelivery && (
        <button
          onClick={() => pedidoPodePronto && onMarcarEmRota?.(pedido.id)}
          disabled={!pedidoPodePronto}
          className={`w-full mt-2 mb-1 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
            pedidoPodePronto
              ? 'bg-orange-500 hover:bg-orange-600 text-white cursor-pointer'
              : 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200'
          }`}
        >
          {pedidoPodePronto ? (
            <><i className="ri-bike-line mr-1" />Em rota de entrega</>
          ) : (
            <><i className="ri-lock-line mr-1" />Aguardando operadores ({semOperadorCount} sem operador)</>
          )}
        </button>
      )}

      {/* Non-delivery: Marcar Entregue — bloqueado para kiosk não pago */}
      {todosProntos && pedido.status === 'pronto' && !isDelivery && (
        isKioskNaoPago ? (
          <div className="w-full mt-2 mb-1 py-2 px-3 rounded-lg border border-amber-200 bg-amber-50 flex items-center gap-2">
            <i className="ri-store-2-line text-amber-600 text-sm flex-shrink-0" />
            <span className="text-xs font-bold text-amber-700 leading-tight">
              Aguardando pagamento — entrega pelo caixa
            </span>
          </div>
        ) : (
          <button
            onClick={() => pedidoPodePronto && onMarcarProntoPedidoGate()}
            disabled={!pedidoPodePronto}
            className={`w-full mt-2 mb-1 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
              pedidoPodePronto
                ? 'bg-zinc-800 hover:bg-zinc-900 text-white cursor-pointer'
                : 'bg-zinc-100 text-zinc-400 cursor-not-allowed border border-zinc-200'
            }`}
          >
            {pedidoPodePronto ? (
              <><i className="ri-check-double-line mr-1" />Marcar Entregue</>
            ) : (
              <><i className="ri-lock-line mr-1" />Aguardando operadores ({semOperadorCount} sem operador)</>
            )}
          </button>
        )
      )}

      {/* Em rota → Confirmar Entrega */}
      {pedido.status === 'em_rota' && (
        <button
          onClick={() => onAvancarPedidoGate('entregar')}
          className="w-full mt-2 mb-1 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-colors bg-zinc-800 hover:bg-zinc-900 text-white cursor-pointer"
        >
          <i className="ri-check-double-line mr-1" />Confirmar Entrega
        </button>
      )}

      {/* Novo → Iniciar Todos */}
      {pedido.status === 'novo' && (
        <button
          onClick={() => !clienteEditando && onAvancarPedidoGate('iniciar')}
          disabled={clienteEditando}
          className={`w-full mt-2 mb-1 py-2 text-xs font-bold rounded-lg whitespace-nowrap transition-colors ${
            clienteEditando
              ? 'bg-orange-100 text-orange-400 cursor-not-allowed border border-orange-200'
              : 'bg-amber-500 hover:bg-amber-600 text-white cursor-pointer'
          }`}
        >
          {clienteEditando ? (
            <><i className="ri-lock-line mr-1" />Aguardando cliente finalizar edição...</>
          ) : (
            <><i className="ri-play-line mr-1" />Iniciar Todos</>
          )}
        </button>
      )}
    </>
  );
});

export default KDSCardActions;

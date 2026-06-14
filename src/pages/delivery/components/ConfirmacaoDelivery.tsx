import { useState } from 'react';
import AcompanharPedido from './AcompanharPedido';
import HistoricoPedidos from './HistoricoPedidos';

type TabOption = 'acompanhar' | 'historico';

interface Props {
  numeroPedido: string;
  orderTotal: number;
  deliveryFee: number;
  phone?: string;
  tenantId: string;
  customerId: string;
  onNovoPedido: () => void;
  paymentMethod?: string;
  modoEntrega?: 'entrega' | 'retirada';
}

export default function ConfirmacaoDelivery(props: Props) {
  const numeroPedido = props.numeroPedido;
  const orderTotal = props.orderTotal;
  const deliveryFee = props.deliveryFee;
  const phone = props.phone;
  const tenantId = props.tenantId;
  const customerId = props.customerId;
  const onNovoPedido = props.onNovoPedido;
  const paymentMethod = props.paymentMethod;
  const modoEntrega = props.modoEntrega || 'entrega';

  const [abaAtiva, setAbaAtiva] = useState<TabOption>('acompanhar');
  const [trackingNumero, setTrackingNumero] = useState(numeroPedido);

  function handleVerPedidoHistorico(numero: string) {
    setTrackingNumero(numero);
    setAbaAtiva('acompanhar');
  }

  return (
    <div className="px-4 py-4">
      {/* Cabeçalho de confirmação */}
      <div className="text-center mb-1">
        <div className="w-16 h-16 flex items-center justify-center mx-auto mb-3 bg-green-50 rounded-2xl border border-green-100 relative">
          <div className="absolute -top-1.5 -right-1.5 w-7 h-7 flex items-center justify-center bg-green-500 rounded-full">
            <i className="ri-check-line text-white text-xs" />
          </div>
          <i className={modoEntrega === 'retirada' ? 'ri-store-2-line text-green-600 text-2xl' : 'ri-motorbike-line text-green-600 text-2xl'} />
        </div>

        <h2 className="text-lg font-black text-zinc-800 mb-1">Pedido #{numeroPedido}</h2>
        <p className="text-xs text-zinc-500 mb-3">
          {phone ? 'Acompanhe abaixo o status do seu pedido' : 'Seu pedido foi enviado para a cozinha'}
        </p>

        <div className="inline-flex items-center gap-1 px-3 py-1.5 bg-amber-50 rounded-full border border-amber-200/60 mb-4">
          <span className="text-xs font-bold text-amber-700">
            Total: R$ {orderTotal.toFixed(2)}
          </span>
          {deliveryFee > 0 ? (
            <span className="text-[10px] text-amber-500">
              (taxa R$ {deliveryFee.toFixed(2)})
            </span>
          ) : null}
        </div>

        {paymentMethod ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-full border border-green-200/60 mb-4 mx-2">
            <i className="ri-wallet-3-line text-green-600 text-sm" />
            <span className="text-xs font-bold text-green-700">{paymentMethod}</span>
            <span className="text-[10px] text-green-500">
              {modoEntrega === 'retirada' ? '— Na retirada!' : '— Motoboy já sabe!'}
            </span>
          </div>
        ) : null}
      </div>

      {/* Abas */}
      <div className="flex gap-1 bg-zinc-100 rounded-xl p-1 mb-5">
        <button
          type="button"
          onClick={function () { setAbaAtiva('acompanhar'); }}
          className={'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all duration-200 whitespace-nowrap ' +
            (abaAtiva === 'acompanhar'
              ? 'bg-white text-zinc-800 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700')
          }
        >
          <i className="ri-time-line text-sm" />
          Acompanhar
        </button>
        <button
          type="button"
          onClick={function () { setAbaAtiva('historico'); }}
          className={'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-lg text-xs font-bold cursor-pointer transition-all duration-200 whitespace-nowrap ' +
            (abaAtiva === 'historico'
              ? 'bg-white text-zinc-800 shadow-sm'
              : 'text-zinc-500 hover:text-zinc-700')
          }
        >
          <i className="ri-history-line text-sm" />
          Histórico
        </button>
      </div>

      {/* Conteúdo da aba */}
      {abaAtiva === 'acompanhar' ? (
        <AcompanharPedido
          numeroPedido={trackingNumero}
          tenantId={tenantId}
          onNovoPedido={onNovoPedido}
        />
      ) : (
        <HistoricoPedidos
          tenantId={tenantId}
          phone={phone}
          customerId={customerId}
          numeroAtual={numeroPedido}
          onVerPedido={handleVerPedidoHistorico}
        />
      )}
    </div>
  );
}
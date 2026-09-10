import { useState } from 'react';
import AcompanharPedido from './AcompanharPedido';
import HistoricoPedidos from './HistoricoPedidos';
import PixCobrancaPanel from '@/components/feature/PixCobrancaPanel';
import TrocarPagamentoDelivery from './TrocarPagamentoDelivery';

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
  /** Resumo de valores (subtotal, desconto do cupom, taxa) capturado ao confirmar */
  resumo?: { subtotal: number; desconto: number; deliveryFee: number; voucherCodigo: string } | null;
  /** Pedido a pagar por Pix pelo app: {orderId, orderToken} identificam o pedido na Edge online-payments */
  pixOnline?: { orderId: string; orderToken: string } | null;
  onPixPago?: () => void;
  /** Outras formas (cobrança na entrega/retirada) para quem desistir do Pix pelo app */
  metodosAlternativos?: { key: string; label: string; icon: string }[];
  onTrocarPagamento?: (metodoKey: string, cashAmount?: string) => Promise<boolean>;
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
  const resumo = props.resumo;
  const pixOnline = props.pixOnline;

  const [abaAtiva, setAbaAtiva] = useState<TabOption>('acompanhar');
  // "PIX pelo app": o pedido só vai pra cozinha depois do Pix confirmar
  const [pixPago, setPixPago] = useState(false);
  const metodosAlternativos = props.metodosAlternativos || [];
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
          {pixOnline && !pixPago
            ? 'Seu pedido vai para a cozinha assim que o Pix for confirmado'
            : (phone ? 'Acompanhe abaixo o status do seu pedido' : 'Seu pedido foi enviado para a cozinha')}
        </p>

        {resumo && resumo.desconto > 0 ? (
          /* Detalhamento com desconto do cupom */
          <div className="mx-auto max-w-[260px] mb-4 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-left space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Subtotal</span>
              <span className="font-semibold text-zinc-700">R$ {resumo.subtotal.toFixed(2)}</span>
            </div>
            <div className="flex justify-between text-xs text-emerald-600">
              <span className="flex items-center gap-1"><i className="ri-coupon-3-line" />Cupom {resumo.voucherCodigo}</span>
              <span className="font-bold">- R$ {resumo.desconto.toFixed(2)}</span>
            </div>
            {resumo.deliveryFee > 0 ? (
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Taxa de entrega</span>
                <span className="font-semibold text-zinc-700">R$ {resumo.deliveryFee.toFixed(2)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm font-black pt-1.5 border-t border-zinc-200">
              <span className="text-zinc-800">Total</span>
              <span className="text-amber-600">R$ {orderTotal.toFixed(2)}</span>
            </div>
          </div>
        ) : (
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
        )}

        {paymentMethod && !pixOnline ? (
          <div className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-green-50 rounded-full border border-green-200/60 mb-4 mx-2">
            <i className="ri-wallet-3-line text-green-600 text-sm" />
            <span className="text-xs font-bold text-green-700">{paymentMethod}</span>
            <span className="text-[10px] text-green-500">
              {modoEntrega === 'retirada' ? '— Na retirada!' : '— Motoboy já sabe!'}
            </span>
          </div>
        ) : null}
      </div>

      {/* Pix pelo app: o cliente paga aqui mesmo; a confirmação chega sozinha */}
      {pixOnline ? (
        <div className="mb-5">
          <PixCobrancaPanel
            auth={pixOnline.orderToken ? { order_id: pixOnline.orderId, order_token: pixOnline.orderToken } : { order_id: pixOnline.orderId, order_phone: phone || '' }}
            onPago={function () { setPixPago(true); if (props.onPixPago) props.onPixPago(); }}
            titulo="Pague agora com Pix"
            textoPago="Seu pedido foi para a cozinha. Obrigado!"
          />

          {!pixPago && props.onTrocarPagamento ? (
            <div className="mt-2">
              <TrocarPagamentoDelivery
                metodos={metodosAlternativos}
                orderTotal={orderTotal}
                modoEntrega={modoEntrega}
                labelAbrir="Cancelar o Pix e pagar de outra forma"
                onConfirmar={props.onTrocarPagamento}
              />
            </div>
          ) : null}
        </div>
      ) : null}

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
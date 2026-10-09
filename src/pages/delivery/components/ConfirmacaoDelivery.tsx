import { useState } from 'react';
import { ConviteAppCartao } from '@/components/fidelidade/ConviteAppClube';
import { formatCurrency } from '@/lib/formatters';
import AcompanharPedido from './AcompanharPedido';
import HistoricoPedidos from './HistoricoPedidos';
import PixCobrancaPanel from '@/components/feature/PixCobrancaPanel';
import CartaoCobrancaPanel from '@/components/feature/CartaoCobrancaPanel';
import TrocarPagamentoDelivery from './TrocarPagamentoDelivery';
import CancelarPedidoNaoPago from './CancelarPedidoNaoPago';

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
  /** Pedido a pagar pelo app: {orderId, orderToken} identificam o pedido na Edge online-payments; `metodo` = painel mostrado (sem o campo = Pix) */
  pixOnline?: { orderId: string; orderToken: string; metodo?: 'pix' | 'cartao' } | null;
  /** Cartão de crédito pelo app: `pronto` = public_status já respondeu; `ativo` = loja aceita cartão; `publicKey` = chave pública do Mercado Pago */
  cartaoOnline?: { pronto: boolean; ativo: boolean; publicKey: string };
  /** Cliente escolheu o outro meio (Pix ↔ cartão): só troca o painel mostrado */
  onTrocarMetodoApp?: (metodo: 'pix' | 'cartao') => void;
  onPixPago?: () => void;
  /** Outras formas (cobrança na entrega/retirada) para quem desistir do pagamento pelo app */
  metodosAlternativos?: { key: string; label: string; icon: string }[];
  onTrocarPagamento?: (metodoKey: string, cashAmount?: string) => Promise<boolean>;
  /** Cancelar o pedido que ainda espera o pagamento pelo app (null = cancelou; texto = motivo de não ter cancelado) */
  onCancelarPedido?: () => Promise<string | null>;
}

// "ABC" → Cupom ABC · "Clube" → Prêmio do clube · "ABC + Clube" → Cupom ABC + prêmio do clube
function rotuloDesconto(codigo: string): string {
  const partes = (codigo || '').split(' + ').filter(Boolean);
  if (partes.length === 0) return 'Desconto';
  return partes.map((p, i) => (p === 'Clube' ? (i === 0 ? '🎁 Prêmio do clube' : 'prêmio do clube') : `Cupom ${p}`)).join(' + ');
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
  const cartaoOnline = props.cartaoOnline;
  const metodoApp: 'pix' | 'cartao' = pixOnline && pixOnline.metodo === 'cartao' ? 'cartao' : 'pix';
  // Só oferece o cartão quando a loja aceita e a chave pública chegou
  const cartaoPodeUsar = !!cartaoOnline && cartaoOnline.ativo && !!cartaoOnline.publicKey;
  // Retirada não tem taxa: a taxa exibida é a capturada na confirmação (0 na retirada), nunca a do endereço atual
  const taxaExibida = resumo ? resumo.deliveryFee : (modoEntrega === 'retirada' ? 0 : deliveryFee);

  const [abaAtiva, setAbaAtiva] = useState<TabOption>('acompanhar');
  // Pix/cartão pelo app: o pedido só vai pra cozinha depois do pagamento confirmar
  const [pixPago, setPixPago] = useState(false);
  // Cliente cancelou aqui o pedido que ainda não tinha pago
  const [cancelado, setCancelado] = useState(false);
  const metodosAlternativos = props.metodosAlternativos || [];
  const [trackingNumero, setTrackingNumero] = useState(numeroPedido);
  // Pelo histórico dá pra abrir OUTRO pedido: aí o cabeçalho, os totais e o painel do Pix
  // (que são do pedido recém-feito) saem de cena — senão parece que o Pix é do outro pedido.
  const vendoOriginal = trackingNumero === numeroPedido;

  function handleVerPedidoHistorico(numero: string) {
    setTrackingNumero(numero);
    setAbaAtiva('acompanhar');
  }

  return (
    <div className="px-4 py-5">
      {/* Cabeçalho de confirmação */}
      <div className="mb-3">
        {!vendoOriginal ? (
          <button
            type="button"
            onClick={function () { setTrackingNumero(numeroPedido); setAbaAtiva('acompanhar'); }}
            className="mb-2 h-11 inline-flex items-center gap-1 text-sm font-bold text-[var(--cor-loja)] cursor-pointer whitespace-nowrap"
          >
            <i className="ri-arrow-left-s-line text-lg" /> Voltar ao pedido #{numeroPedido.slice(-4)}
          </button>
        ) : null}
        <div className="flex items-center gap-3">
          <span className={'w-11 h-11 rounded-full flex items-center justify-center shrink-0 ' + (cancelado && vendoOriginal ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700')}>
            <i className={(cancelado && vendoOriginal ? 'ri-close-line' : 'ri-check-line') + ' text-2xl'} />
          </span>
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-tight text-stone-900">
              {!vendoOriginal ? 'Pedido' : cancelado ? 'Pedido cancelado' : 'Pedido enviado!'} <span className="text-stone-500 font-bold">#{trackingNumero.slice(-4)}</span>
            </h2>
            <p className="text-[13px] text-stone-600">
              {!vendoOriginal
                ? 'Você está vendo um pedido do seu histórico'
                : cancelado
                ? 'Nada foi cobrado e o pedido não foi para a cozinha'
                : pixOnline && !pixPago
                ? 'Ele vai para a cozinha assim que o pagamento for confirmado'
                : (modoEntrega === 'retirada' ? 'Retirada na loja' : 'Entrega') + ' · ' + formatCurrency(orderTotal)
                  + (paymentMethod && !pixOnline
                    ? ' · ' + paymentMethod + (/pelo app/i.test(paymentMethod) ? '' : (modoEntrega === 'retirada' ? ' na retirada' : ' na entrega'))
                    : '')}
            </p>
          </div>
        </div>

        {vendoOriginal && !cancelado ? (
          <div className="mt-3"><ConviteAppCartao tenantId={tenantId} motivo="Os pontos deste pedido aparecem no app. Abre em 1 toque e avisa quando ganhar prêmio." /></div>
        ) : null}

        {vendoOriginal && resumo && resumo.desconto > 0 ? (
          /* Detalhamento com desconto (cupom/clube) */
          <div className="mt-3 bg-white border border-stone-200/70 rounded-2xl px-4 py-3 space-y-1.5">
            <div className="flex justify-between text-[13px]">
              <span className="text-stone-600">Subtotal</span>
              <span className="font-semibold text-stone-800">{formatCurrency(resumo.subtotal)}</span>
            </div>
            <div className="flex justify-between text-[13px] text-emerald-700">
              <span className="flex items-center gap-1"><i className="ri-coupon-3-line" />{rotuloDesconto(resumo.voucherCodigo)}</span>
              <span className="font-bold">- {formatCurrency(resumo.desconto)}</span>
            </div>
            {taxaExibida > 0 ? (
              <div className="flex justify-between text-[13px]">
                <span className="text-stone-600">Taxa de entrega</span>
                <span className="font-semibold text-stone-800">{formatCurrency(taxaExibida)}</span>
              </div>
            ) : null}
            <div className="flex justify-between text-sm font-extrabold pt-1.5 border-t border-stone-100">
              <span className="text-stone-900">Total</span>
              <span className="text-stone-900">{formatCurrency(orderTotal)}</span>
            </div>
          </div>
        ) : null}
      </div>

      {/* Pagamento pelo app: o cliente paga aqui mesmo (Pix ou cartão); a confirmação chega sozinha.
          Só UM painel por vez — cada um cancela a cobrança pendente do outro ao montar. */}
      {pixOnline && vendoOriginal ? (
        <div className="mb-5">
          {metodoApp === 'cartao' ? (
            cartaoOnline && !cartaoOnline.pronto ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-stone-400">
                <i className="ri-loader-4-line animate-spin text-[var(--cor-loja)]" />
                Preparando o pagamento com cartão…
              </div>
            ) : cartaoPodeUsar ? (
              <CartaoCobrancaPanel
                auth={pixOnline.orderToken ? { order_id: pixOnline.orderId, order_token: pixOnline.orderToken } : { order_id: pixOnline.orderId, order_phone: phone || '' }}
                publicKey={cartaoOnline!.publicKey}
                onPago={function () { setPixPago(true); if (props.onPixPago) props.onPixPago(); }}
                textoPago="Seu pedido foi para a cozinha"
              />
            ) : (
              <div className="px-4 py-3 bg-[var(--cor-loja-suave,#F9ECE7)] border border-stone-200 rounded-2xl">
                <p className="text-xs text-[var(--cor-loja,#C2410C)]">O pagamento com cartão não está disponível agora. Você pode pagar com Pix.</p>
              </div>
            )
          ) : (
            <PixCobrancaPanel
              auth={pixOnline.orderToken ? { order_id: pixOnline.orderId, order_token: pixOnline.orderToken } : { order_id: pixOnline.orderId, order_phone: phone || '' }}
              onPago={function () { setPixPago(true); if (props.onPixPago) props.onPixPago(); }}
              titulo="Pague agora com Pix"
              textoPago="Seu pedido foi para a cozinha. Obrigado!"
            />
          )}

          {/* Trocar Pix ↔ cartão: clique explícito, nunca automático */}
          {!pixPago && props.onTrocarMetodoApp && (metodoApp === 'cartao' || cartaoPodeUsar) ? (
            <div className="mt-2 text-center">
              <button
                type="button"
                onClick={function () { props.onTrocarMetodoApp!(metodoApp === 'cartao' ? 'pix' : 'cartao'); }}
                className="h-11 text-[13px] font-bold text-[var(--cor-loja)] cursor-pointer whitespace-nowrap"
              >
                {metodoApp === 'cartao'
                  ? <>Prefere Pix? <span className="underline">Pagar com Pix</span></>
                  : <span className="underline">Pagar com cartão de crédito</span>}
              </button>
            </div>
          ) : null}

          {!pixPago && props.onTrocarPagamento ? (
            <div className="mt-2">
              <TrocarPagamentoDelivery
                metodos={metodosAlternativos}
                orderTotal={orderTotal}
                modoEntrega={modoEntrega}
                labelAbrir="Cancelar e pagar de outra forma"
                onConfirmar={props.onTrocarPagamento}
              />
            </div>
          ) : null}

          {!pixPago && props.onCancelarPedido ? (
            <div className="mt-1">
              <CancelarPedidoNaoPago
                numero={numeroPedido}
                onCancelar={props.onCancelarPedido}
                onCancelado={function () { setCancelado(true); }}
              />
            </div>
          ) : null}
        </div>
      ) : null}

      {/* Abas */}
      <div className="grid grid-cols-2 gap-1 bg-stone-100 rounded-[13px] p-1 mb-3">
        <button
          type="button"
          aria-pressed={abaAtiva === 'acompanhar'}
          onClick={function () { setAbaAtiva('acompanhar'); }}
          className={'h-11 rounded-[10px] text-sm cursor-pointer whitespace-nowrap ' + (abaAtiva === 'acompanhar' ? 'bg-white shadow-sm font-bold text-stone-900' : 'font-semibold text-stone-600')}
        >
          Acompanhar
        </button>
        <button
          type="button"
          aria-pressed={abaAtiva === 'historico'}
          onClick={function () { setAbaAtiva('historico'); }}
          className={'h-11 rounded-[10px] text-sm cursor-pointer whitespace-nowrap ' + (abaAtiva === 'historico' ? 'bg-white shadow-sm font-bold text-stone-900' : 'font-semibold text-stone-600')}
        >
          Meus pedidos
        </button>
      </div>

      {/* Conteúdo da aba */}
      {abaAtiva === 'acompanhar' ? (
        <AcompanharPedido
          key={trackingNumero + (cancelado ? '-cancelado' : '')}
          numeroPedido={trackingNumero}
          canceladoPeloCliente={cancelado && vendoOriginal}
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
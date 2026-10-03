import { useState, useEffect, useRef, lazy, Suspense } from 'react';
import type { Rastreio } from './RastreioMapa';
import { formatCurrency } from '@/lib/formatters';
import TrocarPagamentoDelivery, { type MetodoAlternativo } from './TrocarPagamentoDelivery';
import JogosEspera from '@/components/jogos/JogosEspera';
import CancelarPedidoNaoPago from './CancelarPedidoNaoPago';

type OrderStatusData = {
  id: string;
  number: string;
  status: string;
  created_at: string;
  updated_at: string;
  out_for_delivery_at: string | null;
  delivery_sla_min: number | null;
  is_retirada?: boolean;
  /** Notas do pedido ("Pagamento: ...") — diz se o pedido segurado é de Pix ou de cartão pelo app */
  pagamento?: string | null;
  total_amount: number;
  delivery_fee: number;
  subtotal: number;
  items: Array<{
    id: string;
    item_name: string;
    item_price: number;
    quantity: number;
    notes: string | null;
    options?: Array<{ option_name: string; group_name: string | null; additional_price: number }>;
  }>;
};

interface Props {
  numeroPedido: string;
  tenantId: string;
  onNovoPedido: () => void;
  /** Número do pedido que este aparelho deixou esperando o pagamento pelo app (Pix ou cartão) */
  pixPendenteNumero?: string;
  onPagarPix?: () => void;
  /** Sem a chave no aparelho: retoma pelo telefone do cliente (só se o app souber o telefone) */
  onPagarPixSemChave?: (orderId: string, number: string, total: number, fee?: number, isRetirada?: boolean, metodo?: 'pix' | 'cartao') => void;
  /** Trocar a forma de pagamento do pedido segurado (libera pra cozinha) */
  metodosAlternativos?: MetodoAlternativo[];
  onTrocarPagamento?: (orderId: string, metodoKey: string, cashAmount?: string) => Promise<boolean>;
  /** Cancelar o pedido que ainda espera o pagamento pelo app (null = cancelou; texto = motivo de não ter cancelado) */
  onCancelarPedido?: (orderId: string) => Promise<string | null>;
  /** O cliente cancelou este pedido na tela de cima (confirmação): muda o texto do aviso de cancelado */
  canceladoPeloCliente?: boolean;
  modoEntrega?: 'entrega' | 'retirada';
}

const STATUS_STEPS_ENTREGA = [
  { key: 'new', label: 'Recebido', icon: 'ri-check-double-line', description: 'Seu pedido foi recebido' },
  { key: 'preparing', label: 'Em preparo', icon: 'ri-restaurant-2-line', description: 'Cozinha preparando' },
  { key: 'ready', label: 'Pronto', icon: 'ri-checkbox-circle-line', description: 'Aguardando entregador' },
  { key: 'em_rota', label: 'Em rota', icon: 'ri-motorbike-line', description: 'Saiu para entrega' },
  { key: 'delivered', label: 'Entregue', icon: 'ri-checkbox-circle-fill', description: 'Pedido entregue' },
];
// Retirada na loja: ninguém sai com o pedido — não existe "em rota"
const STATUS_STEPS_RETIRADA = [
  { key: 'new', label: 'Recebido', icon: 'ri-check-double-line', description: 'Seu pedido foi recebido' },
  { key: 'preparing', label: 'Em preparo', icon: 'ri-restaurant-2-line', description: 'Cozinha preparando' },
  { key: 'ready', label: 'Pronto', icon: 'ri-store-2-line', description: 'Pode retirar no balcão' },
  { key: 'delivered', label: 'Retirado', icon: 'ri-checkbox-circle-fill', description: 'Pedido retirado' },
];

function getStatusLabel(status: string): string {
  const map: Record<string, string> = {
    new: 'Recebido',
    preparing: 'Em preparo',
    ready: 'Pronto',
    em_rota: 'Em rota',
    delivered: 'Entregue',
    cancelled: 'Cancelado',
    draft: 'Aguardando pagamento',
  };
  return map[status] || status;
}

// Mapa carregado só quando o pedido está em rota (leaflet fora do bundle do cardápio).
const RastreioMapa = lazy(() => import('./RastreioMapa'));
const RASTREIO_MS = 15000;

function getMotoboySignalUrl(): string {
  const base = (import.meta.env.VITE_PUBLIC_SUPABASE_URL as string || '').replace(/\/$/, '');
  return base + '/functions/v1/motoboy-signal';
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
  const [verItens, setVerItens] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // Este aparelho acabou de cancelar o pedido não pago (muda o texto do aviso de cancelado)
  const [canceleiAgora, setCanceleiAgora] = useState(false);
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
        // Limpa erro anterior: o polling (10s) se recupera sozinho de um blip de
        // rede (ex.: voltar do background) sem exigir "Tentar novamente" do cliente.
        setError('');
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

  // Rastreio ao vivo: só enquanto o pedido está em rota (a posição do motoboy vem da
  // motoboy-signal › track_order, só deste pedido). Fora da rota não faz nenhuma chamada.
  const [rastreio, setRastreio] = useState<Rastreio | null>(null);
  const emRotaAgora = !!orderData && !!orderData.out_for_delivery_at && !orderData.is_retirada
    && orderData.status !== 'delivered' && orderData.status !== 'cancelled';
  useEffect(function () {
    if (!emRotaAgora || !tenantId || !numeroPedido) { setRastreio(null); return; }
    let vivo = true;
    function buscar() {
      fetch(getMotoboySignalUrl(), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'track_order', tenant_id: tenantId, order_number: numeroPedido }),
      })
        .then(function (res) { return res.json(); })
        .then(function (data) { if (vivo && data && data.ok) setRastreio(data.rastreio ?? null); })
        .catch(function () { /* mantém a última posição */ });
    }
    buscar();
    const id = setInterval(buscar, RASTREIO_MS);
    return function () { vivo = false; clearInterval(id); };
  }, [emRotaAgora, tenantId, numeroPedido]);

  function getStepIndex(status: string): number {
    const order = isRetirada ? ['new', 'preparing', 'ready', 'delivered'] : ['new', 'preparing', 'ready', 'em_rota', 'delivered'];
    const idx = order.indexOf(status);
    if (idx < 0) return -1;
    return idx;
  }

  if (loading) {
    return (
      <div className="text-center py-12">
        <i className="ri-loader-4-line text-2xl text-[var(--cor-loja)] animate-spin" />
        <p className="text-sm font-bold text-stone-700 mt-3">Buscando pedido...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-12 px-4">
        <div className="w-12 h-12 flex items-center justify-center mx-auto mb-4 bg-red-50 rounded-2xl border border-red-100">
          <i className="ri-error-warning-line text-xl text-red-500" />
        </div>
        <p className="text-sm font-bold text-stone-700 mb-2">Erro ao carregar</p>
        <p className="text-xs text-stone-500 mb-4">{error}</p>
        <button
          type="button"
          onClick={fetchStatus}
          className="h-11 px-4 bg-stone-900 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (!orderData) {
    return (
      <div className="text-center py-12">
        <p className="text-sm text-stone-500">Pedido não encontrado</p>
      </div>
    );
  }

  const isRetirada = !!orderData.is_retirada;
  const STATUS_STEPS = isRetirada ? STATUS_STEPS_RETIRADA : STATUS_STEPS_ENTREGA;
  const rawStatus = orderData.status;
  // "Em rota" não é um valor do enum — é derivado de out_for_delivery_at (mesma lógica do KDS).
  const status = (rawStatus !== 'delivered' && rawStatus !== 'cancelled' && orderData.out_for_delivery_at)
    ? 'em_rota'
    : rawStatus;
  const currentStep = getStepIndex(status);
  const isCancelled = status === 'cancelled';
  const isDelivered = status === 'delivered';
  // Segurado esperando o pagamento pelo app (Pix ou cartão): só este aparelho (que criou o pedido) consegue pagar
  const isAguardandoPix = status === 'draft';
  const temChave = !!props.onPagarPix && !!props.pixPendenteNumero && props.pixPendenteNumero === orderData.number;
  const podePagarPix = isAguardandoPix && (temChave || !!props.onPagarPixSemChave);
  // As notas dizem "Pagamento: Cartão de crédito pelo app" quando o cliente escolheu cartão
  const ehCartaoApp = /cart/i.test(orderData.pagamento || '');
  function pagarPix() {
    if (!orderData) return;
    if (temChave && props.onPagarPix) props.onPagarPix();
    else if (props.onPagarPixSemChave) props.onPagarPixSemChave(orderData.id, orderData.number, orderData.total_amount, orderData.delivery_fee, !!orderData.is_retirada, ehCartaoApp ? 'cartao' : 'pix');
  }

  // Previsão máxima de entrega = horário do pedido + tempo total da faixa de distância (SLA).
  const previsaoEntregaMs = (orderData.delivery_sla_min != null && orderData.delivery_sla_min > 0)
    ? new Date(orderData.created_at).getTime() + orderData.delivery_sla_min * 60000
    : null;
  const mostrarPrevisao = previsaoEntregaMs != null && !isCancelled && !isDelivered;

  // Cabeçalho do andamento: título, ícone e linha de baixo (previsão ou horário)
  const titulo = isCancelled ? 'Pedido cancelado'
    : isDelivered ? (isRetirada ? 'Pedido retirado' : 'Pedido entregue')
    : isAguardandoPix ? 'Aguardando pagamento'
    : status === 'em_rota' ? 'Saiu para entrega'
    : status === 'ready' ? (isRetirada ? 'Pronto! Pode retirar' : 'Pronto, saindo já já')
    : status === 'preparing' ? 'Em preparo'
    : 'Pedido recebido';
  const icone = isCancelled ? 'ri-close-circle-line'
    : isDelivered ? 'ri-check-double-line'
    : isAguardandoPix ? (ehCartaoApp ? 'ri-bank-card-line' : 'ri-qr-code-line')
    : status === 'em_rota' ? 'ri-e-bike-2-line'
    : status === 'ready' ? (isRetirada ? 'ri-store-2-line' : 'ri-checkbox-circle-line')
    : status === 'preparing' ? 'ri-fire-line'
    : 'ri-time-line';
  const linhaDeBaixo = mostrarPrevisao
    ? (isRetirada ? 'Pronto até ' : 'Chega até ') + formatTime(new Date(previsaoEntregaMs!).toISOString())
    : 'Feito em ' + formatDate(orderData.created_at) + ' às ' + formatTime(orderData.created_at);
  const qtdItens = orderData.items.reduce(function (s, i) { return s + (i.quantity || 1); }, 0);

  return (
    <div className="space-y-3">
      {/* Andamento */}
      <section className="bg-white border border-stone-200/70 rounded-[20px] p-5">
        <div className="flex items-center gap-3.5">
          <span className={'w-[52px] h-[52px] rounded-2xl flex items-center justify-center shrink-0 ' +
            (isCancelled ? 'bg-red-50 text-red-700' : isDelivered ? 'bg-emerald-50 text-emerald-700' : 'bg-[var(--cor-loja-suave)] text-[var(--cor-loja)]')}>
            <i className={icone + ' text-[26px]' + (!isCancelled && !isDelivered && !isAguardandoPix ? ' animate-pulse' : '')} />
          </span>
          <div className="min-w-0">
            <p className="text-[22px] leading-tight font-extrabold tracking-tight text-stone-900">{titulo}</p>
            <p className="text-sm font-bold text-stone-700 mt-1">{linhaDeBaixo}</p>
          </div>
        </div>
        {!isCancelled && !isAguardandoPix ? (
          <div className="mt-4 grid gap-1.5" style={{ gridTemplateColumns: 'repeat(' + STATUS_STEPS.length + ', minmax(0, 1fr))' }}>
            {STATUS_STEPS.map(function (step, idx) {
              const feito = idx <= currentStep;
              const atual = idx === currentStep && !isDelivered;
              return (
                <div key={step.key} className="min-w-0">
                  <div className={'h-1.5 rounded-full ' + (feito ? 'bg-[var(--cor-loja)]' : 'bg-stone-200') + (atual ? ' animate-pulse' : '')} />
                  <p className={'text-[11px] mt-1.5 truncate ' + (atual ? 'font-extrabold text-stone-900' : feito ? 'font-semibold text-stone-700' : 'font-semibold text-stone-400')}>{step.label}</p>
                </div>
              );
            })}
          </div>
        ) : null}
        {isCancelled ? (
          <p className="mt-3 text-[13px] text-red-800 bg-red-50 rounded-xl px-3 py-2.5">
            {canceleiAgora || props.canceladoPeloCliente ? 'Você cancelou este pedido. Nada foi cobrado.' : 'Seu pedido foi cancelado. Fale com a loja para saber mais.'}
          </p>
        ) : null}
      </section>

      {/* Pedido segurado esperando o pagamento pelo app */}
      {isAguardandoPix ? (
        <section className="p-4 bg-white border-2 border-stone-200 rounded-[18px]">
          <p className="text-base font-extrabold text-stone-900">Este pedido ainda não foi pago</p>
          <p className="text-[13px] text-stone-600 mt-1 leading-snug">
            {podePagarPix
              ? 'Ele só vai para a cozinha depois do pagamento pelo app.'
              : 'Ele só vai para a cozinha depois do pagamento pelo app. Abra o cardápio com o telefone que fez o pedido para pagar.'}
          </p>
          {podePagarPix ? (
            <button
              type="button"
              onClick={pagarPix}
              className="mt-3 w-full h-14 flex items-center justify-center gap-2 rounded-2xl bg-[var(--cor-loja)] hover:bg-[var(--cor-loja-forte)] text-white text-base font-bold cursor-pointer"
            >
              <i className={ehCartaoApp ? 'ri-bank-card-line' : 'ri-qr-code-line'} /> {ehCartaoApp ? 'Pagar com cartão agora' : 'Pagar com Pix agora'}
            </button>
          ) : null}
          {props.onTrocarPagamento && (props.metodosAlternativos || []).length > 0 ? (
            <div className="mt-2">
              <TrocarPagamentoDelivery
                metodos={props.metodosAlternativos || []}
                orderTotal={orderData.total_amount}
                modoEntrega={props.modoEntrega || 'entrega'}
                labelAbrir="Pagar de outra forma (na entrega ou retirada)"
                onConfirmar={async function (metodoKey, cashAmount) {
                  const ok = await props.onTrocarPagamento!(orderData.id, metodoKey, cashAmount);
                  if (ok) fetchStatus();
                  return ok;
                }}
              />
            </div>
          ) : null}
          {props.onCancelarPedido ? (
            <div className="mt-1">
              <CancelarPedidoNaoPago
                numero={orderData.number}
                onCancelar={function () { return props.onCancelarPedido!(orderData.id); }}
                onCancelado={function () { setCanceleiAgora(true); fetchStatus(); }}
              />
            </div>
          ) : null}
        </section>
      ) : null}

      {/* Rastreio ao vivo: a moto até a casa do cliente + previsão recalculada */}
      {status === 'em_rota' && rastreio && (rastreio.motoboy || rastreio.destino) ? (
        <section className="bg-white border border-stone-200/70 rounded-[18px] p-4">
          <div className="flex items-center justify-between mb-2 gap-2">
            <p className="text-sm font-extrabold text-stone-900 flex items-center gap-1.5">
              <i className="ri-e-bike-2-line text-[var(--cor-loja)]" /> A caminho
            </p>
            {rastreio.eta_min != null ? (
              <p className="text-[13px] font-bold text-stone-900">
                chega em ~{rastreio.eta_min} min <span className="font-medium text-stone-500">({formatTime(new Date(Date.now() + rastreio.eta_min * 60000).toISOString())})</span>
              </p>
            ) : null}
          </div>
          {rastreio.motoboy ? (
            <Suspense fallback={<div className="h-52 w-full rounded-2xl bg-stone-100 animate-pulse" />}>
              <RastreioMapa rastreio={rastreio} />
            </Suspense>
          ) : (
            <p className="text-[13px] text-stone-600 px-3 py-2.5 bg-stone-100 rounded-xl">
              O entregador saiu com seu pedido. A localização dele aparece aqui assim que o GPS do celular dele atualizar.
            </p>
          )}
          {rastreio.motoboy ? (
            <p className="text-xs text-stone-500 mt-1.5">
              Localização atualizada às {formatTime(rastreio.motoboy.atualizado_em)}
              {rastreio.distancia_km != null ? ` · cerca de ${rastreio.distancia_km.toLocaleString('pt-BR')} km` : ''}
            </p>
          ) : null}
        </section>
      ) : null}

      {/* Joguinhos enquanto espera: aviso por cima do jogo quando o pedido anda; entregue = pausa até o próximo pedido */}
      {!isCancelled && !isAguardandoPix ? (
        <JogosEspera
          pedidoEntregue={isDelivered}
          onNovoPedido={props.onNovoPedido}
          tenantId={tenantId}
          credencial={{ tipo: 'delivery', order_number: orderData.number }}
          aviso={status === 'em_rota' ? 'Seu pedido saiu para entrega!'
            : (status === 'ready' && isRetirada) ? 'Seu pedido está pronto! Pode retirar no balcão.'
            : null}
        />
      ) : null}

      {/* Itens do pedido (fechado por padrão) */}
      <section className="bg-white border border-stone-200/70 rounded-[18px] overflow-hidden">
        <button
          type="button"
          onClick={function () { setVerItens(!verItens); }}
          aria-expanded={verItens}
          className="w-full flex items-center justify-between gap-3 px-4 h-14 text-left cursor-pointer"
        >
          <span className="text-sm font-bold text-stone-900">
            {qtdItens} {qtdItens === 1 ? 'item' : 'itens'} · {formatCurrency(orderData.total_amount)}
          </span>
          <span className="text-[13px] font-bold text-[var(--cor-loja)] flex items-center gap-1">
            {verItens ? 'Esconder' : 'Ver itens'}
            <i className={'ri-arrow-down-s-line text-lg transition-transform ' + (verItens ? 'rotate-180' : '')} />
          </span>
        </button>
        {verItens ? (
          <div className="border-t border-stone-100 px-4 py-3 space-y-2.5">
            {orderData.items.map(function (item) {
              const opcoes = item.options ?? [];
              return (
                <div key={item.id}>
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-sm text-stone-800 break-words"><strong>{item.quantity}×</strong> {item.item_name}</span>
                    <span className="text-sm font-bold text-stone-900 shrink-0">{formatCurrency(item.item_price * item.quantity)}</span>
                  </div>
                  {/* Adicionais/opções: o valor do item já os inclui; aqui detalhamos cada um */}
                  {opcoes.length > 0 ? (
                    <div className="ml-6 mt-0.5 space-y-0.5">
                      {opcoes.map(function (op, i) {
                        return (
                          <div key={i} className="flex items-start justify-between gap-2 text-xs text-stone-500">
                            <span className="break-words">+ {op.option_name}</span>
                            {op.additional_price > 0 ? <span className="shrink-0">{formatCurrency(op.additional_price)}</span> : null}
                          </div>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="border-t border-stone-100 pt-2.5 space-y-1">
              <div className="flex justify-between text-[13px] text-stone-600"><span>Subtotal</span><span>{formatCurrency(orderData.subtotal || 0)}</span></div>
              {/* Retirada não tem entrega: não exibe "Taxa de entrega: Grátis" */}
              {!isRetirada ? (
                <div className="flex justify-between text-[13px] text-stone-600">
                  <span>Taxa de entrega</span><span>{orderData.delivery_fee > 0 ? formatCurrency(orderData.delivery_fee) : 'Grátis'}</span>
                </div>
              ) : null}
              <div className="flex justify-between text-sm font-extrabold text-stone-900 pt-1"><span>Total</span><span>{formatCurrency(orderData.total_amount)}</span></div>
            </div>
          </div>
        ) : null}
      </section>

      <button
        type="button"
        onClick={onNovoPedido}
        className="w-full h-[52px] rounded-2xl border border-stone-300 bg-white text-stone-900 flex items-center justify-center gap-2 text-[15px] font-bold cursor-pointer hover:bg-stone-50"
      >
        <i className="ri-add-line text-lg" />
        Fazer novo pedido
      </button>
    </div>
  );
}

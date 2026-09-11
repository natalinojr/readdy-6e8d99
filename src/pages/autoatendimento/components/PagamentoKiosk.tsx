import { useState, useEffect, useRef, useCallback } from 'react';
import QRCodeImport from 'react-qr-code';
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import { type ItemPedidoCliente } from '@/types/mesaCliente';
import TelaCartaoKiosk from './TelaCartaoKiosk';

const NOME_TIPO: Record<string, string> = { pix: 'PIX', credit_card: 'Cartão de Crédito', debit_card: 'Cartão de Débito' };

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

interface PaymentMethod {
  id: string;
  name: string;
  type: string;
}

interface PixPaymentData {
  pix_payment_id: string;
  txid: string;
  emv_payload: string;
  expires_at: string;
  pix_key: string;
  pix_key_type: string;
  beneficiary_name: string;
  amount: number;
}

interface PagamentoKioskProps {
  carrinho: ItemPedidoCliente[];
  identifNome: string;
  identifSenha: string;
  modoIdentificacao: 'nome' | 'senha' | 'comanda' | 'senha_balcao' | 'nenhum';
  pagarNaEntrega: boolean;
  modoPagamento: 'hora' | 'entrega' | 'ambos';
  hasCaixa: boolean;
  formaPagamentoNome?: string;
  orderNumber?: number;
  alertaParcial?: string;
  onEntrarPagamento: (paidPixPaymentId?: string) => Promise<string | null>;
  // Grava o pagamento no caixa SEM voltar o tablet pro início (quem encerra é onConcluir).
  onRegistrarPagamento: (paymentMethodId: string, orderId: string) => Promise<void>;
  onConcluir: (paymentMethodId?: string, orderId?: string) => Promise<void>;
}

// ── Tela de Confirmação ────────────────────────────────────────────────────
function TelaConfirmacao({
  carrinho,
  total,
  modoIdentificacao,
  identificadorLabel,
  identificadorValor,
  isNome,
  orderNumber,
  pagarNaEntrega,
  modoEscolhido,
  formaPagamentoNome,
  alertaParcial,
  onNovoPedido,
}: {
  carrinho: ItemPedidoCliente[];
  total: number;
  modoIdentificacao: string;
  identificadorLabel: string;
  identificadorValor: string;
  isNome: boolean;
  orderNumber?: number;
  pagarNaEntrega: boolean;
  modoEscolhido: 'hora' | 'entrega' | null;
  formaPagamentoNome?: string;
  alertaParcial?: string;
  onNovoPedido: () => void;
}) {
  const [countdown, setCountdown] = useState(15);

  useEffect(() => {
    if (countdown <= 0) { onNovoPedido(); return; }
    const t = setInterval(() => setCountdown((v) => v - 1), 1000);
    return () => clearInterval(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countdown]);

  const pago = modoEscolhido !== 'entrega' && !pagarNaEntrega;
  const numeroDisplay = orderNumber && orderNumber > 0
    ? `#${String(orderNumber).padStart(4, '0')}`
    : null;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center overflow-y-auto">
      {/* Ícone animado */}
      <div className="relative">
        <div className="w-20 h-20 md:w-28 md:h-28 flex items-center justify-center bg-emerald-500/20 rounded-full">
          <i className="ri-checkbox-circle-fill text-5xl md:text-7xl text-emerald-400" />
        </div>
        <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 animate-ping" />
      </div>

      <div>
        <h2 className="text-3xl md:text-6xl font-black text-white leading-tight">
          Pedido confirmado!
          {numeroDisplay && <span className="ml-2 text-amber-400">{numeroDisplay}</span>}
        </h2>
        <p className="text-zinc-400 text-base md:text-2xl mt-1">
          {pago ? 'Retire no balcão quando chamarmos' : 'Pague na retirada do pedido'}
        </p>
      </div>

      {/* Identificador + resumo */}
      <div className="flex gap-3 md:gap-4 w-full max-w-3xl">
        {modoIdentificacao !== 'nenhum' && (
          <div className="bg-amber-500/10 border-2 border-amber-500/40 rounded-xl px-6 py-4 flex flex-col items-center justify-center flex-shrink-0">
            <p className="text-amber-400 text-sm font-bold uppercase tracking-widest mb-1">{identificadorLabel}</p>
            <p className={`text-amber-400 font-black leading-none ${isNome ? 'text-xl md:text-4xl' : 'text-6xl md:text-8xl tracking-wider'}`}>
              {identificadorValor}
            </p>
          </div>
        )}
        <div className="bg-zinc-800 rounded-xl p-3 md:p-4 flex-1 overflow-y-auto max-h-40 md:max-h-48">
          {carrinho.map((item, i) => (
            <div key={i} className="flex justify-between text-sm md:text-base py-0.5">
              <span className="text-zinc-400">{item.quantidade}x {item.nome}</span>
              <span className="text-zinc-300 font-semibold">{fmt(item.preco * item.quantidade)}</span>
            </div>
          ))}
          <div className="border-t border-zinc-700 mt-1.5 pt-1.5 flex justify-between">
            <span className="text-white font-bold text-sm md:text-base">{pago ? 'Total pago' : 'Total a pagar'}</span>
            <span className="text-amber-400 font-black text-base md:text-xl">{fmt(total)}</span>
          </div>
        </div>
      </div>

      {!pago && (
        <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-5 py-3 max-w-3xl w-full text-center">
          <div className="flex items-center justify-center gap-2 text-amber-400 mb-1">
            <i className="ri-information-line text-sm flex-shrink-0" />
            <p className="text-sm md:text-base font-semibold">Pague no balcão ao retirar o pedido</p>
          </div>
          {formaPagamentoNome ? (
            <div className="flex items-center justify-center gap-2">
              <i className="ri-wallet-3-line text-emerald-400 text-sm" />
              <p className="text-sm md:text-base font-bold text-emerald-400">Forma: {formaPagamentoNome}</p>
            </div>
          ) : (
            <p className="text-sm text-zinc-500">Aceitamos: Dinheiro, PIX, Cartão</p>
          )}
        </div>
      )}

      {alertaParcial && (
        <div className="w-full max-w-3xl bg-amber-900/40 border border-amber-500/50 rounded-xl px-5 py-4 flex items-start gap-3">
          <i className="ri-alert-line text-amber-400 text-sm flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-amber-300 font-bold text-sm">Aviso para o operador</p>
            <p className="text-amber-400/80 text-sm mt-0.5">
              Pedido <span className="font-bold text-amber-300">{alertaParcial}</span> registrado, mas alguns itens podem não ter chegado ao KDS.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-col items-center gap-2">
        <button
          onClick={onNovoPedido}
          className="px-10 md:px-14 py-3 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm md:text-xl rounded-xl cursor-pointer transition-colors whitespace-nowrap"
        >
          Novo pedido
        </button>
        <p className="text-zinc-600 text-sm md:text-lg">
          Voltando em <span className="text-amber-400 font-bold">{countdown}s</span>
        </p>
        <div className="w-40 md:w-56 h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full bg-amber-500 rounded-full transition-all duration-1000"
            style={{ width: `${(countdown / 15) * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

// ── Tela PIX ───────────────────────────────────────────────────────────────
function TelaPix({
  total,
  tenantId,
  orderId,
  onPago,
  onVoltar,
  onConcluir,
}: {
  total: number;
  tenantId: string;
  orderId: string | null;
  onPago: (pixPaymentId: string) => void;
  onVoltar: () => void;
  onConcluir: () => void;
}) {
  const [pixData, setPixData] = useState<PixPaymentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [pixError, setPixError] = useState('');
  const [timeLeft, setTimeLeft] = useState(600); // 10 min
  const [pollingStatus, setPollingStatus] = useState<'waiting' | 'confirmed' | 'expired'>('waiting');
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pixDataRef = useRef<PixPaymentData | null>(null);
  const onPagoRef = useRef(onPago);
  onPagoRef.current = onPago;

  // Gera o PIX ao montar
  useEffect(() => {
    generatePix();
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generatePix = async () => {
    setLoading(true);
    setPixError('');
    try {
      const { data, error } = await invokeWithAuth('pix-payment', {
        body: {
          action: 'create_charge',
          tenant_id: tenantId,
          order_id: orderId,
          amount: total,
        },
      });

      if (error || !data?.emv_payload) {
        const msg = data?.error ?? error?.message ?? 'Erro ao gerar PIX';
        setPixError(msg);
        setLoading(false);
        return;
      }

      setPixData(data as PixPaymentData);
      pixDataRef.current = data as PixPaymentData;

      // Calcula tempo restante
      const expiresAt = new Date(data.expires_at).getTime();
      const now = Date.now();
      setTimeLeft(Math.max(0, Math.floor((expiresAt - now) / 1000)));

      // Inicia polling de status
      startPolling(data.pix_payment_id);
    } catch (e) {
      setPixError('Erro ao conectar com o servidor. Tente novamente.');
    } finally {
      setLoading(false);
    }
  };

  const startPolling = (pixPaymentId: string) => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    pollingRef.current = setInterval(async () => {
      try {
        const { data } = await invokeWithAuth('pix-payment', {
          body: { action: 'check_status', pix_payment_id: pixPaymentId, tenant_id: tenantId },
        });
        if (data?.status === 'confirmed') {
          clearInterval(pollingRef.current!);
          setPollingStatus('confirmed');
          setTimeout(() => onPagoRef.current(pixPaymentId), 3500);
        } else if (data?.status === 'expired') {
          clearInterval(pollingRef.current!);
          setPollingStatus('expired');
        }
      } catch { /* non-fatal */ }
    }, 2000);
  };

  // Countdown
  useEffect(() => {
    if (timeLeft <= 0 || pollingStatus !== 'waiting') return;
    const t = setInterval(() => setTimeLeft((v) => {
      if (v <= 1) {
        clearInterval(t);
        setPollingStatus('expired');
        if (pollingRef.current) clearInterval(pollingRef.current);
        return 0;
      }
      return v - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [timeLeft, pollingStatus]);


  // Sair da tela: volta NA HORA e cancela a cobrança em segundo plano. O servidor confere
  // no banco antes de cancelar; se o cliente já tinha pago, o pedido segue pelo fluxo de
  // Pix pago (o PagamentoKiosk continua montado, então a confirmação aparece normalmente).
  const handleVoltar = () => {
    if (pollingRef.current) clearInterval(pollingRef.current);
    const id = pixDataRef.current?.pix_payment_id;
    onVoltar();
    if (!id) return;
    invokeWithAuth<{ status?: string }>('pix-payment', { body: { action: 'cancel', pix_payment_id: id } })
      .then(({ data }) => { if (data?.status === 'confirmed') onPagoRef.current(id); })
      .catch(() => { /* a cobrança vence sozinha em 10 min */ });
  };

  const mins = Math.floor(timeLeft / 60).toString().padStart(2, '0');
  const secs = (timeLeft % 60).toString().padStart(2, '0');
  const progressPct = (timeLeft / 600) * 100;

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-emerald-500/10 rounded-2xl">
          <div className="w-8 h-8 md:w-12 md:h-12 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin" style={{ borderWidth: 3 }} />
        </div>
        <p className="text-zinc-400 text-base md:text-xl font-semibold">Gerando QR Code PIX...</p>
      </div>
    );
  }

  // ── Erro de configuração ──
  if (pixError) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-red-500/10 rounded-2xl">
          <i className="ri-error-warning-line text-3xl md:text-5xl text-red-400" />
        </div>
        <div>
          <h3 className="text-lg md:text-3xl font-bold text-white mb-1">Não foi possível gerar o Pix</h3>
          <p className="text-zinc-400 text-sm md:text-lg max-w-xs">{pixError}</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onVoltar} className="px-5 md:px-8 py-2.5 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold text-sm md:text-lg rounded-xl cursor-pointer transition-colors whitespace-nowrap">
            Escolher outra forma
          </button>
          <button onClick={generatePix} className="px-5 md:px-8 py-2.5 md:py-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-sm md:text-lg rounded-xl cursor-pointer transition-colors whitespace-nowrap">
            Tentar novamente
          </button>
        </div>
      </div>
    );
  }

  // ── PIX Confirmado ──
  if (pollingStatus === 'confirmed') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <div className="relative">
          <div className="w-24 h-24 md:w-32 md:h-32 flex items-center justify-center bg-emerald-500/20 rounded-full">
            <i className="ri-checkbox-circle-fill text-6xl md:text-8xl text-emerald-400" />
          </div>
          <div className="absolute inset-0 rounded-full border-4 border-emerald-500/30 animate-ping" />
        </div>
        <div>
          <h3 className="text-3xl md:text-5xl font-black text-white">PIX Confirmado!</h3>
          <p className="text-emerald-400 font-semibold text-base md:text-xl mt-1">Pagamento recebido com sucesso</p>
        </div>
        <p className="text-amber-400 font-black text-4xl md:text-5xl">{fmt(total)}</p>
        <div className="flex gap-2 items-center bg-zinc-800 px-4 py-2 rounded-xl">
          <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse" />
          <p className="text-zinc-300 text-base md:text-lg">Registrando pedido...</p>
        </div>
      </div>
    );
  }

  // ── PIX Expirado ──
  if (pollingStatus === 'expired') {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center">
        <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-amber-500/10 rounded-2xl">
          <i className="ri-time-line text-3xl md:text-5xl text-amber-400" />
        </div>
        <div>
          <h3 className="text-xl md:text-3xl font-bold text-white mb-1">QR Code expirado</h3>
          <p className="text-zinc-400 text-sm md:text-lg">O tempo para pagamento esgotou. Gere um novo QR Code.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onVoltar} className="px-5 md:px-8 py-2.5 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-white font-semibold text-sm md:text-lg rounded-xl cursor-pointer transition-colors whitespace-nowrap">
            Voltar
          </button>
          <button onClick={generatePix} className="px-5 md:px-8 py-2.5 md:py-4 bg-emerald-500 hover:bg-emerald-400 text-white font-bold text-sm md:text-lg rounded-xl cursor-pointer transition-colors whitespace-nowrap">
            Gerar novo QR Code
          </button>
        </div>
      </div>
    );
  }

  // ── Tela principal PIX ──
  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 md:gap-5 p-5 md:p-8 text-center overflow-y-auto">
      {/* Header */}
      <div className="text-center">
        <div className="flex items-center justify-center gap-2 mb-1">
          <div className="w-10 h-10 flex items-center justify-center bg-emerald-500/20 rounded-lg">
            <i className="ri-qr-code-line text-emerald-400 text-lg" />
          </div>
          <h2 className="text-3xl md:text-5xl font-black text-white">Pague com PIX</h2>
        </div>
        <p className="text-zinc-400 text-base md:text-lg">Abra o app do seu banco e escaneie o QR Code</p>
      </div>

      {/* QR Code + info lado a lado em telas maiores */}
      <div className="flex flex-col md:flex-row items-center gap-5 w-full max-w-3xl">
        {/* QR Code */}
        <div className="relative flex-shrink-0">
          <div className="bg-white p-4 md:p-5 rounded-2xl">
            {pixData?.emv_payload && (
              <QRCode
                value={pixData.emv_payload}
                size={240}
                level="M"
                style={{ display: 'block' }}
              />
            )}
          </div>
          {/* Indicador de polling */}
          <div className="absolute -bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-zinc-900 border border-zinc-700 rounded-full px-3 py-1">
            <div className="w-1.5 h-1.5 bg-emerald-400 rounded-full animate-pulse" />
            <span className="text-zinc-400 text-xs font-semibold">Aguardando pagamento</span>
          </div>
        </div>

        {/* Dados do PIX */}
        <div className="flex flex-col gap-3 w-full md:flex-1">
          {/* Valor */}
          <div className="bg-zinc-800 rounded-xl px-5 py-4 text-center">
            <p className="text-zinc-500 text-xs mb-1">Valor a pagar</p>
            <p className="text-amber-400 font-black text-4xl md:text-5xl">{fmt(total)}</p>
          </div>

          {/* Chave PIX */}
          {pixData?.pix_key && (
            <div className="bg-zinc-800 rounded-xl px-5 py-4">
              <p className="text-zinc-500 text-xs mb-1">Chave PIX ({pixData.pix_key_type?.toUpperCase()})</p>
              <p className="text-white font-mono text-sm font-bold break-all">{pixData.pix_key}</p>
              {pixData.beneficiary_name && (
                <p className="text-zinc-400 text-xs mt-1">{pixData.beneficiary_name}</p>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Timer */}
      <div className="w-full max-w-3xl">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-zinc-500 text-xs">Expira em</span>
          <span className={`text-base font-black ${timeLeft < 60 ? 'text-red-400' : timeLeft < 180 ? 'text-amber-400' : 'text-zinc-300'}`}>
            {mins}:{secs}
          </span>
        </div>
        <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-1000 ${
              timeLeft < 60 ? 'bg-red-500' : timeLeft < 180 ? 'bg-amber-500' : 'bg-emerald-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Botões */}
      <div className="flex flex-col sm:flex-row gap-2 w-full max-w-3xl">
        <button
          onClick={handleVoltar}
          className="flex-1 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-base rounded-xl cursor-pointer transition-colors whitespace-nowrap"
        >
          Escolher outra forma
        </button>
      </div>

      <p className="text-zinc-600 text-xs max-w-sm">
        O pagamento é confirmado automaticamente pelo banco assim que você pagar.
      </p>
    </div>
  );
}

// ── Componente Principal ───────────────────────────────────────────────────
export default function PagamentoKiosk({
  carrinho,
  identifNome,
  identifSenha,
  modoIdentificacao,
  pagarNaEntrega,
  modoPagamento,
  hasCaixa,
  formaPagamentoNome,
  orderNumber,
  alertaParcial,
  onEntrarPagamento,
  onRegistrarPagamento,
  onConcluir,
}: PagamentoKioskProps) {
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const [forma, setForma] = useState<PaymentMethod | null>(null);
  const [confirmado, setConfirmado] = useState(false);
  const [aguardando, setAguardando] = useState(false);
  const [processandoPedido, setProcessandoPedido] = useState(false);
  const [modoEscolhido, setModoEscolhido] = useState<'hora' | 'entrega' | null>(
    modoPagamento === 'hora' ? 'hora' : modoPagamento === 'entrega' ? 'entrega' : null
  );
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [pendingOrderIdLocal, setPendingOrderIdLocal] = useState<string | null>(null);
  // BUG-11: estado de erro de pagamento (ex: caixa fechado)
  const [pagamentoError, setPagamentoError] = useState<string | null>(null);

  const pagarEntregaRef = useRef(false);
  // Pix só é oferecido quando a loja tem provedor que confirma o pagamento (Inter/MP).
  const [pixDisponivel, setPixDisponivel] = useState<boolean | null>(null);
  const [metodosCarregados, setMetodosCarregados] = useState(false);
  // Cartão cobrado na maquininha ao lado (Mercado Pago Point). Sem ela: "pague no balcão".
  const [cartaoNaMaquininha, setCartaoNaMaquininha] = useState(false);
  // Forma escolhida para pagar no balcão (cartão/dinheiro): só informativa na confirmação.
  const [balcaoFormaNome, setBalcaoFormaNome] = useState<string | null>(null);

  const total = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);
  const tenantId = kioskSession?.tenantId ?? user?.tenantId ?? '';

  // Busca métodos de pagamento
  useEffect(() => {
    if (!tenantId) return;
    supabase
      .from('payment_methods')
      .select('id, name, type')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .then(({ data }) => {
        setPaymentMethods((data as PaymentMethod[] | null) ?? []);
        setMetodosCarregados(true);
      });
  }, [tenantId]);

  // Resposta anterior fica guardada na sessão do tablet: a partir do 2º pedido as opções
  // aparecem na hora; a consulta ao servidor só atualiza em segundo plano.
  useEffect(() => {
    if (!tenantId) return;
    const cacheKey = `erpos_kiosk_pix:${tenantId}`;
    try { const c = sessionStorage.getItem(cacheKey); if (c !== null) setPixDisponivel(c === '1'); } catch { /* sem storage */ }
    const desiste = setTimeout(() => setPixDisponivel((prev) => prev ?? false), 6000);
    invokeWithAuth<{ provider: string | null }>('pix-payment', { body: { action: 'kiosk_provider', tenant_id: tenantId } })
      .then(({ data, error }) => {
        if (error) { setPixDisponivel((prev) => prev ?? false); return; }
        const v = Boolean(data?.provider);
        setPixDisponivel(v);
        try { sessionStorage.setItem(cacheKey, v ? '1' : '0'); } catch { /* sem storage */ }
      })
      .catch(() => setPixDisponivel((prev) => prev ?? false))
      .finally(() => clearTimeout(desiste));
  }, [tenantId]);
  useEffect(() => {
    if (!tenantId) return;
    invokeWithAuth<{ point: boolean }>('pix-payment', { body: { action: 'kiosk_card_provider', tenant_id: tenantId } })
      .then(({ data }) => setCartaoNaMaquininha(Boolean(data?.point)))
      .catch(() => setCartaoNaMaquininha(false));
  }, [tenantId]);
  const metodosVisiveis = paymentMethods.filter((m) => m.type !== 'pix' || pixDisponivel === true);

  // Pagar na entrega (modo fixo) — cria pedido ao montar
  useEffect(() => {
    if (pagarNaEntrega && modoPagamento !== 'ambos') {
      setProcessandoPedido(true);
      onEntrarPagamento().finally(() => {
        setProcessandoPedido(false);
        setConfirmado(true);
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePagarNaEntregaEscolhido = async () => {
    if (pagarEntregaRef.current) return;
    pagarEntregaRef.current = true;
    setModoEscolhido('entrega');
    setProcessandoPedido(true);
    try {
      await onEntrarPagamento();
      setConfirmado(true);
    } finally {
      pagarEntregaRef.current = false;
      setProcessandoPedido(false);
    }
  };

  // Cartão/dinheiro: o tablet não tem como confirmar o recebimento (sem maquininha
  // integrada), então o pedido vai em aberto e o operador dá baixa no balcão.
  const handlePagarNoBalcao = async (method: PaymentMethod) => {
    setBalcaoFormaNome(method.name);
    await handlePagarNaEntregaEscolhido();
  };

  // Quando PIX é confirmado: cria pedido e finaliza
  // Pagamento confirmado pelo provedor (Pix pelo banco ou cartão na maquininha).
  const handlePixPago = useCallback(async (pixPaymentId: string, tipo: string = 'pix') => {
    setAguardando(true);
    setPagamentoError(null);
    try {
      // O id do pedido vem direto daqui: o estado do pai ainda não atualizou nesta chamada
      // (era por isso que o pagamento do Pix não entrava no caixa).
      const orderId = await onEntrarPagamento(pixPaymentId);
      if (!orderId) throw new Error('O pagamento foi recebido, mas o pedido não foi registrado. NÃO pague de novo — chame um atendente.');
      invokeWithAuth('pix-payment', { body: { action: 'attach_order', pix_payment_id: pixPaymentId, order_id: orderId } }).catch(() => {});
      const metodo = paymentMethods.find((m) => m.type === tipo);
      if (!metodo) throw new Error(`O pagamento foi recebido, mas a loja não tem a forma de pagamento ${NOME_TIPO[tipo] ?? tipo} cadastrada. NÃO pague de novo — chame um atendente.`);
      await onRegistrarPagamento(metodo.id, orderId);
      setConfirmado(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro ao registrar o pagamento.';
      // Volta pra escolha de forma com o aviso visível (na tela do Pix ele não aparece).
      setPagamentoError(/NÃO pague de novo/.test(msg) ? msg : `O pagamento foi recebido, mas houve um erro ao registrar: ${msg}. NÃO pague de novo — chame um atendente.`);
      setForma(null);
      console.error('[PagamentoKiosk] Erro no pagamento PIX:', msg);
    } finally {
      setAguardando(false);
    }
  }, [onEntrarPagamento, onRegistrarPagamento, paymentMethods]);

  // Helpers de identificador
  const isComanda = modoIdentificacao === 'comanda' || modoIdentificacao === 'senha_balcao';
  const isNome = modoIdentificacao === 'nome';
  const identificadorLabel = isComanda ? (modoIdentificacao === 'senha_balcao' ? 'Senha Nº' : 'Comanda Nº') : isNome ? 'Seu nome' : modoIdentificacao === 'senha' ? 'Sua senha' : 'Pedido';
  const identificadorValor = isNome
    ? (identifNome || 'Cliente')
    : isComanda
    ? (identifSenha.replace(/^[A-Z]-?/i, ''))
    : identifSenha || '---';

  // ── Processando ──
  if (processandoPedido) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <div className="flex gap-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-4 h-4 md:w-5 md:h-5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
        <p className="text-zinc-400 text-base md:text-2xl">Registrando seu pedido...</p>
      </div>
    );
  }

  // ── Confirmado ──
  if (confirmado) {
    return (
      <TelaConfirmacao
        carrinho={carrinho}
        total={total}
        modoIdentificacao={modoIdentificacao}
        identificadorLabel={identificadorLabel}
        identificadorValor={identificadorValor}
        isNome={isNome}
        orderNumber={orderNumber}
        pagarNaEntrega={pagarNaEntrega}
        modoEscolhido={modoEscolhido}
        formaPagamentoNome={formaPagamentoNome ?? balcaoFormaNome ?? undefined}
        alertaParcial={alertaParcial}
        onNovoPedido={() => onConcluir()}
      />
    );
  }

  // ── Escolher hora ou entrega (modo 'ambos') ──
  if (modoPagamento === 'ambos' && modoEscolhido === null) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 md:gap-6 p-5 md:p-8">
        <div className="text-center">
          <h2 className="text-3xl md:text-6xl font-black text-white mb-2">Quando deseja pagar?</h2>
          <p className="text-zinc-400 text-base md:text-2xl">Total: <span className="text-amber-400 font-black">{fmt(total)}</span></p>
          {!hasCaixa && (
            <div className="mt-3 flex items-center justify-center gap-2 text-amber-400 bg-amber-500/10 rounded-full px-4 py-1.5 mx-auto w-fit">
              <i className="ri-lock-line text-sm" />
              <span className="text-xs font-bold">Caixa fechado — pagamento presencial indisponível</span>
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 md:gap-6 w-full max-w-2xl">
          <button
            onClick={() => hasCaixa ? setModoEscolhido('hora') : undefined}
            disabled={!hasCaixa}
            className={`flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 rounded-2xl md:rounded-3xl transition-all ${
              hasCaixa
                ? 'bg-amber-500 hover:bg-amber-400 text-zinc-950 cursor-pointer active:scale-95'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed opacity-70'
            }`}
          >
            <div className={`w-16 h-16 md:w-20 md:h-20 flex items-center justify-center rounded-xl md:rounded-2xl ${hasCaixa ? 'bg-zinc-950/10' : 'bg-zinc-700/50'}`}>
              <i className={`ri-secure-payment-line text-4xl md:text-5xl ${!hasCaixa ? 'text-zinc-600' : ''}`} />
            </div>
            <div className="text-center">
              <p className="text-xl md:text-3xl font-black">Pagar agora</p>
              <p className={`text-sm md:text-lg mt-1 ${hasCaixa ? 'text-zinc-950/60' : 'text-zinc-600'}`}>
                {hasCaixa ? 'PIX, cartão ou dinheiro' : 'Caixa fechado — indisponível'}
              </p>
            </div>
          </button>
          <button
            onClick={handlePagarNaEntregaEscolhido}
            disabled={pagarEntregaRef.current}
            className="flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl md:rounded-3xl cursor-pointer active:scale-95 transition-all disabled:opacity-60"
          >
            <div className="w-16 h-16 md:w-20 md:h-20 flex items-center justify-center bg-zinc-700 rounded-xl md:rounded-2xl">
              <i className="ri-store-2-line text-4xl md:text-5xl text-zinc-300" />
            </div>
            <div className="text-center">
              <p className="text-xl md:text-3xl font-black">Pagar na entrega</p>
              <p className="text-zinc-500 text-sm md:text-lg mt-1">Pague ao retirar no balcão</p>
            </div>
          </button>
        </div>
      </div>
    );
  }

  // ── Cartão na maquininha ao lado (Mercado Pago Point) ──
  if (cartaoNaMaquininha && (forma?.type === 'credit_card' || forma?.type === 'debit_card')) {
    return (
      <TelaCartaoKiosk
        total={total}
        tenantId={tenantId}
        method={forma.type as 'credit_card' | 'debit_card'}
        onPago={handlePixPago}
        onVoltar={() => setForma(null)}
      />
    );
  }

  // ── Tela PIX (real) ──
  if (forma?.type === 'pix') {
    return (
      <TelaPix
        total={total}
        tenantId={tenantId}
        orderId={pendingOrderIdLocal}
        onPago={handlePixPago}
        onVoltar={() => setForma(null)}
        onConcluir={() => onConcluir()}
      />
    );
  }

  // ── Escolha de forma de pagamento ──
  if (!forma) {
    // BUG-11: Bloquear pagamento quando não há caixa (gaveta) aberto.
    // Sem cash_register, record_payment é silenciosamente ignorado → venda sem receita.
    // Só permite "pagar na entrega" (que não precisa de caixa).
    if (!hasCaixa) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-5 md:gap-6 p-5 md:p-8 text-center">
          <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-amber-500/10 rounded-2xl">
            <i className="ri-lock-line text-3xl md:text-5xl text-amber-400" />
          </div>
          <div>
            <h2 className="text-xl md:text-4xl font-black text-white mb-2">Caixa fechado</h2>
            <p className="text-zinc-400 text-sm md:text-lg max-w-md">
              O pagamento não está disponível porque nenhum caixa (gaveta) foi aberto para esta sessão.
            </p>
          </div>
          <div className="bg-zinc-800 border border-zinc-700 rounded-xl px-5 py-4 max-w-md w-full text-left">
            <div className="flex items-start gap-3">
              <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5">
                <i className="ri-information-line text-amber-400 text-lg" />
              </div>
              <div>
                <p className="text-amber-400 font-bold text-sm mb-1">O que fazer?</p>
                <ul className="text-zinc-400 text-sm space-y-1.5">
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span>
                    <span>Solicite ao operador que abra o caixa no PDV</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span>
                    <span>Ou escolha a opção de pagamento na entrega abaixo</span>
                  </li>
                </ul>
              </div>
            </div>
          </div>
          <div className="bg-zinc-800 rounded-xl px-5 py-3">
            <p className="text-zinc-500 text-xs">Total do pedido</p>
            <p className="text-amber-400 font-black text-2xl md:text-3xl">{fmt(total)}</p>
          </div>
          {modoPagamento === 'ambos' || pagarNaEntrega ? (
            <button
              onClick={handlePagarNaEntregaEscolhido}
              disabled={pagarEntregaRef.current}
              className="px-8 py-3 md:py-4 bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-sm md:text-lg rounded-xl md:rounded-2xl cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60"
            >
              <i className="ri-store-2-line mr-2" />
              Pagar na entrega
            </button>
          ) : (
            <p className="text-zinc-600 text-sm">
              Aguarde o operador abrir o caixa para continuar
            </p>
          )}
        </div>
      );
    }

    const getMethodIcon = (type: string) => {
      if (type === 'pix') return 'ri-qr-code-line';
      if (type === 'cash') return 'ri-money-dollar-circle-line';
      if (type === 'credit_card') return 'ri-bank-card-line';
      return 'ri-bank-card-2-line';
    };

    const getMethodDesc = (type: string) => {
      if (type === 'pix') return 'QR Code instantâneo';
      if ((type === 'credit_card' || type === 'debit_card') && cartaoNaMaquininha) return 'Na maquininha ao lado';
      return 'Pague no balcão';
    };

    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 md:gap-6 p-5 md:p-8">
        <div className="text-center">
          <h2 className="text-3xl md:text-6xl font-black text-white mb-2">Como deseja pagar?</h2>
          <p className="text-zinc-400 text-base md:text-2xl">Total: <span className="text-amber-400 font-black">{fmt(total)}</span></p>
        </div>
        {/* BUG-11: Banner de erro de pagamento */}
        {pagamentoError && (
          <div className="w-full max-w-2xl bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 flex items-start gap-3">
            <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5">
              <i className="ri-error-warning-line text-red-400 text-lg" />
            </div>
            <div className="flex-1">
              <p className="text-red-400 font-bold text-sm">Erro no pagamento</p>
              <p className="text-red-400/80 text-sm mt-0.5">{pagamentoError}</p>
            </div>
            <button
              onClick={() => setPagamentoError(null)}
              className="w-6 h-6 flex items-center justify-center text-red-400/60 hover:text-red-400 cursor-pointer flex-shrink-0"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        )}
        {(!metodosCarregados || pixDisponivel === null) ? (
          <div className="flex items-center justify-center gap-3 py-10 text-zinc-400 text-base md:text-xl">
            <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
            Carregando formas de pagamento…
          </div>
        ) : (
        <div className="grid grid-cols-2 gap-3 md:gap-4 w-full max-w-2xl">
          {metodosVisiveis.map((method) => {
            const isPix = method.type === 'pix';
            return (
              <button
                key={method.id}
                onClick={() => setForma(method)}
                className={`flex flex-col items-center gap-2 md:gap-3 p-3 md:p-5 rounded-xl md:rounded-2xl cursor-pointer active:scale-95 transition-all ${
                  isPix
                    ? 'bg-emerald-500 hover:bg-emerald-400 text-white'
                    : 'bg-zinc-800 hover:bg-zinc-700 text-white'
                }`}
              >
                <div className={`w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-xl ${isPix ? 'bg-white/20' : 'bg-zinc-700'}`}>
                  <i className={`${getMethodIcon(method.type)} text-xl md:text-3xl`} />
                </div>
                <div className="text-center">
                  <p className="text-sm md:text-xl font-black">{method.name}</p>
                  <p className={`text-xs mt-0.5 hidden sm:block ${isPix ? 'text-white/70' : 'text-zinc-500'}`}>
                    {getMethodDesc(method.type)}
                  </p>
                </div>
                {isPix && (
                  <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full font-semibold">Recomendado</span>
                )}
              </button>
            );
          })}
          {metodosVisiveis.length === 0 && (
            <button
              onClick={handlePagarNaEntregaEscolhido}
              className="col-span-2 flex flex-col items-center gap-2 md:gap-3 p-3 md:p-5 rounded-xl md:rounded-2xl cursor-pointer active:scale-95 transition-all bg-zinc-800 hover:bg-zinc-700 text-white"
            >
              <div className="w-12 h-12 md:w-14 md:h-14 flex items-center justify-center rounded-xl bg-zinc-700">
                <i className="ri-store-2-line text-xl md:text-3xl" />
              </div>
              <p className="text-sm md:text-xl font-black">Pagar no balcão</p>
            </button>
          )}
        </div>
        )}
        {modoPagamento === 'ambos' && (
          <button
            onClick={handlePagarNaEntregaEscolhido}
            className="text-zinc-500 hover:text-zinc-300 text-sm md:text-base cursor-pointer transition-colors"
          >
            Prefiro pagar na entrega
          </button>
        )}
      </div>
    );
  }

  // ── Cartão / Dinheiro: pagamento no balcão ──
  // Enquanto não há maquininha integrada (Point em modo PDV), o tablet não confirma
  // cartão nem dinheiro — nada é marcado pago aqui; o operador recebe e dá baixa no PDV.
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 md:gap-6 p-5 md:p-8 text-center">
      <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-zinc-800 rounded-xl md:rounded-2xl">
        <i className={`text-3xl md:text-5xl text-amber-400 ${forma.type === 'cash' ? 'ri-money-dollar-circle-line' : 'ri-bank-card-line'}`} />
      </div>
      <div>
        <h2 className="text-xl md:text-5xl font-black text-white">Pague no balcão</h2>
        <p className="text-zinc-400 text-sm md:text-2xl mt-2 max-w-xl">
          Seu pedido vai para a cozinha agora. Pague com <span className="text-white font-bold">{forma.name}</span> ao retirar.
        </p>
      </div>
      <p className="text-zinc-400 text-sm md:text-2xl">Total: <span className="text-amber-400 font-black">{fmt(total)}</span></p>
      {/* BUG-11: Banner de erro de pagamento */}
      {pagamentoError && (
        <div className="w-full max-w-md bg-red-500/10 border border-red-500/30 rounded-xl px-5 py-4 flex items-start gap-3">
          <div className="w-8 h-8 flex items-center justify-center flex-shrink-0 mt-0.5">
            <i className="ri-error-warning-line text-red-400 text-lg" />
          </div>
          <div className="flex-1">
            <p className="text-red-400 font-bold text-sm">Erro no pagamento</p>
            <p className="text-red-400/80 text-sm mt-0.5">{pagamentoError}</p>
          </div>
          <button
            onClick={() => setPagamentoError(null)}
            className="w-6 h-6 flex items-center justify-center text-red-400/60 hover:text-red-400 cursor-pointer flex-shrink-0"
          >
            <i className="ri-close-line text-sm" />
          </button>
        </div>
      )}
      <div className="flex gap-3 md:gap-4">
        <button
          onClick={() => { setForma(null); setPagamentoError(null); }}
          className="px-5 md:px-10 py-3 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm md:text-xl rounded-xl md:rounded-2xl cursor-pointer whitespace-nowrap"
        >
          Voltar
        </button>
        <button
          onClick={() => handlePagarNoBalcao(forma)}
          disabled={processandoPedido}
          className="px-8 md:px-12 py-3 md:py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white font-bold text-sm md:text-xl rounded-xl md:rounded-2xl cursor-pointer whitespace-nowrap"
        >
          Confirmar pedido
        </button>
      </div>
    </div>
  );
}

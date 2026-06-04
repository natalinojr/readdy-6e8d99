import { useState, useEffect, useRef, useCallback } from 'react';
import QRCodeImport from 'react-qr-code';
const QRCode = ((QRCodeImport as unknown as { default: typeof QRCodeImport }).default || QRCodeImport) as typeof QRCodeImport;
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import { type ItemPedidoCliente } from '@/types/mesaCliente';

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
  onEntrarPagamento: () => Promise<void>;
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
  const [confirmandoManual, setConfirmandoManual] = useState(false);
  const [copiado, setCopiado] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pixDataRef = useRef<PixPaymentData | null>(null);

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
          action: 'generate',
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
          setTimeout(() => onPago(pixPaymentId), 1500);
        } else if (data?.status === 'expired') {
          clearInterval(pollingRef.current!);
          setPollingStatus('expired');
        }
      } catch { /* non-fatal */ }
    }, 3000);
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

  const handleCopiarChave = async () => {
    if (!pixData?.emv_payload) return;
    try {
      await navigator.clipboard.writeText(pixData.emv_payload);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch { /* ignore */ }
  };

  const handleConfirmarManual = async () => {
    if (!pixData?.pix_payment_id || confirmandoManual) return;
    setConfirmandoManual(true);
    try {
      await invokeWithAuth('pix-payment', {
        body: { action: 'confirm', pix_payment_id: pixData.pix_payment_id },
      });
      if (pollingRef.current) clearInterval(pollingRef.current);
      setPollingStatus('confirmed');
      setTimeout(() => onPago(pixData.pix_payment_id), 1500);
    } catch { /* ignore */ } finally {
      setConfirmandoManual(false);
    }
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
          <h3 className="text-lg md:text-3xl font-bold text-white mb-1">PIX não configurado</h3>
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

          {/* Copiar código */}
          <button
            onClick={handleCopiarChave}
            className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl text-base font-semibold cursor-pointer transition-all whitespace-nowrap ${
              copiado
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-zinc-700 hover:bg-zinc-600 text-zinc-300'
            }`}
          >
            <i className={`text-base ${copiado ? 'ri-checkbox-circle-line' : 'ri-file-copy-line'}`} />
            {copiado ? 'Código copiado!' : 'Copiar código PIX'}
          </button>
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
          onClick={onVoltar}
          className="flex-1 py-3 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 font-semibold text-base rounded-xl cursor-pointer transition-colors whitespace-nowrap"
        >
          Escolher outra forma
        </button>
        <button
          onClick={handleConfirmarManual}
          disabled={confirmandoManual}
          className="flex-1 py-3 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-400 font-bold text-base rounded-xl cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60"
        >
          {confirmandoManual ? 'Confirmando...' : 'Confirmar PIX (operador)'}
        </button>
      </div>

      <p className="text-zinc-600 text-xs max-w-sm">
        O pagamento é confirmado automaticamente. O botão &quot;Confirmar PIX&quot; é para uso do operador quando necessário.
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

  const simulandoRef = useRef(false);
  const pagarEntregaRef = useRef(false);

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
        if (data && data.length > 0) {
          setPaymentMethods(data as PaymentMethod[]);
        } else {
          setPaymentMethods([
            { id: 'pix', name: 'PIX', type: 'pix' },
            { id: 'credito', name: 'Cartão de Crédito', type: 'credit_card' },
            { id: 'debito', name: 'Cartão de Débito', type: 'debit_card' },
            { id: 'dinheiro', name: 'Dinheiro', type: 'cash' },
          ]);
        }
      });
  }, [tenantId]);

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

  const handleSimularPagamento = async (method: PaymentMethod) => {
    if (simulandoRef.current) return;
    simulandoRef.current = true;
    setAguardando(true);
    try {
      await onEntrarPagamento();
      await new Promise((r) => setTimeout(r, 1200));
      await onConcluir(method.id);
      setConfirmado(true);
    } finally {
      simulandoRef.current = false;
      setAguardando(false);
    }
  };

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

  // Quando PIX é confirmado: cria pedido e finaliza
  const handlePixPago = useCallback(async (pixPaymentId: string) => {
    setAguardando(true);
    try {
      // Cria o pedido no banco
      await onEntrarPagamento();
      // Busca o método PIX para registrar o pagamento
      const pixMethod = paymentMethods.find((m) => m.type === 'pix');
      await onConcluir(pixMethod?.id);
      setConfirmado(true);
    } finally {
      setAguardando(false);
    }
  }, [onEntrarPagamento, onConcluir, paymentMethods]);

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
        formaPagamentoNome={formaPagamentoNome}
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
        </div>
        <div className="grid grid-cols-2 gap-4 md:gap-6 w-full max-w-2xl">
          <button
            onClick={() => setModoEscolhido('hora')}
            className="flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 bg-amber-500 hover:bg-amber-400 text-zinc-950 rounded-2xl md:rounded-3xl cursor-pointer active:scale-95 transition-all"
          >
            <div className="w-16 h-16 md:w-20 md:h-20 flex items-center justify-center bg-zinc-950/10 rounded-xl md:rounded-2xl">
              <i className="ri-secure-payment-line text-4xl md:text-5xl" />
            </div>
            <div className="text-center">
              <p className="text-xl md:text-3xl font-black">Pagar agora</p>
              <p className="text-zinc-950/60 text-sm md:text-lg mt-1">PIX, cartão ou dinheiro</p>
            </div>
          </button>
          <button
            onClick={handlePagarNaEntregaEscolhido}
            className="flex flex-col items-center gap-4 md:gap-6 p-6 md:p-8 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl md:rounded-3xl cursor-pointer active:scale-95 transition-all"
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
    const getMethodIcon = (type: string) => {
      if (type === 'pix') return 'ri-qr-code-line';
      if (type === 'cash') return 'ri-money-dollar-circle-line';
      if (type === 'credit_card') return 'ri-bank-card-line';
      return 'ri-bank-card-2-line';
    };

    const getMethodDesc = (type: string) => {
      if (type === 'pix') return 'QR Code instantâneo';
      if (type === 'cash') return 'Pague no caixa';
      if (type === 'credit_card') return 'À vista ou parcelado';
      return 'Débito à vista';
    };

    return (
      <div className="flex flex-col items-center justify-center h-full gap-5 md:gap-6 p-5 md:p-8">
        <div className="text-center">
          <h2 className="text-3xl md:text-6xl font-black text-white mb-2">Como deseja pagar?</h2>
          <p className="text-zinc-400 text-base md:text-2xl">Total: <span className="text-amber-400 font-black">{fmt(total)}</span></p>
        </div>
        <div className="grid grid-cols-2 gap-3 md:gap-4 w-full max-w-2xl">
          {paymentMethods.map((method) => {
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
        </div>
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

  // ── Cartão / Dinheiro ──
  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 md:gap-6 p-5 md:p-8 text-center">
      <div className="w-16 h-16 md:w-24 md:h-24 flex items-center justify-center bg-zinc-800 rounded-xl md:rounded-2xl">
        <i className={`text-3xl md:text-5xl text-amber-400 ${forma.type === 'cash' ? 'ri-money-dollar-circle-line' : 'ri-bank-card-line'}`} />
      </div>
      <h2 className="text-xl md:text-5xl font-black text-white">
        {forma.type === 'credit_card'
          ? 'Aproxime ou insira o cartão'
          : forma.type === 'debit_card'
          ? 'Insira seu cartão de débito'
          : 'Dirija-se ao caixa para pagar'}
      </h2>
      <p className="text-zinc-400 text-sm md:text-2xl">Total: <span className="text-amber-400 font-black">{fmt(total)}</span></p>
      {forma.type !== 'cash' && (
        <div className="bg-zinc-800 rounded-xl md:rounded-2xl px-8 md:px-12 py-4 md:py-6 border-2 border-dashed border-zinc-600">
          <p className="text-zinc-500 text-sm md:text-xl">Aguardando leitura do terminal...</p>
          <div className="mt-2 md:mt-3 flex justify-center gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="w-3 h-3 md:w-4 md:h-4 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
            ))}
          </div>
        </div>
      )}
      <div className="flex gap-3 md:gap-4">
        <button
          onClick={() => setForma(null)}
          className="px-5 md:px-10 py-3 md:py-4 bg-zinc-700 hover:bg-zinc-600 text-white font-bold text-sm md:text-xl rounded-xl md:rounded-2xl cursor-pointer whitespace-nowrap"
        >
          Voltar
        </button>
        <button
          onClick={() => handleSimularPagamento(forma)}
          disabled={aguardando}
          className="px-8 md:px-12 py-3 md:py-4 bg-emerald-500 hover:bg-emerald-400 disabled:opacity-60 text-white font-bold text-sm md:text-xl rounded-xl md:rounded-2xl cursor-pointer whitespace-nowrap"
        >
          {aguardando ? 'Processando...' : forma.type === 'cash' ? 'Confirmar pagamento no caixa' : 'Simular aprovação'}
        </button>
      </div>
    </div>
  );
}

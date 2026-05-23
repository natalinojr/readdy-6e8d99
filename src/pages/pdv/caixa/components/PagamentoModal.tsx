import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { PartialOrderError } from '@/hooks/useOrderSubmit';
import { usePDV, type PagamentoItem } from '../../../../contexts/PDVContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useToast } from '../../../../contexts/ToastContext';
import { useSessao } from '../../../../contexts/SessaoContext';
import { useKDS, buildKDSPedido } from '../../../../contexts/KDSContext';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { Voucher } from '@/types/vouchers';

interface VoucherAplicado {
  voucher: Voucher;
  applicable_amount: number;
}

interface FormaPagamento {
  id: string;
  nome: string;
  tipo: string;
  icone: string;
  ativo: boolean;
  requiresChange: boolean;
}

const ICON_MAP: Record<string, string> = {
  cash: 'ri-money-dollar-circle-line',
  pix: 'ri-qr-code-line',
  credit_card: 'ri-bank-card-line',
  debit_card: 'ri-bank-card-2-line',
  meal_voucher: 'ri-coupon-line',
  other: 'ri-more-line',
};
import ComprovantePrint from './ComprovantePrint';
import { printKitchenTicket, printSimpleReceipt } from './CozinhaTicketPrint';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ─── Rodada simulada para seleção de contas (mesa) ─── */
interface RodadaMock {
  id: string;
  numero: number;
  nomeResponsavel: string;
  hora: string;
  itens: { nome: string; quantidade: number; preco: number }[];
}

function gerarRodadasMock(mesaNumero: number): RodadaMock[] {
  const horas = ['19:10', '19:35', '20:05'];
  const nomes = [
    ['Carlos Lima', 'Ana Souza'],
    ['Pedro Alves', 'Mariana Costa'],
    ['Roberto Nunes', 'Juliana Melo'],
  ];
  const idx = (mesaNumero - 1) % 3;
  const base = [
    {
      id: `r-${mesaNumero}-1`,
      numero: 1001 + mesaNumero,
      nomeResponsavel: nomes[idx][0],
      hora: horas[0],
      itens: [
        { nome: 'X-Burguer Clássico', quantidade: 2, preco: 28.9 },
        { nome: 'Batata Frita Clássica', quantidade: 1, preco: 14.9 },
      ],
    },
    {
      id: `r-${mesaNumero}-2`,
      numero: 1002 + mesaNumero,
      nomeResponsavel: nomes[idx][1],
      hora: horas[1],
      itens: [
        { nome: 'X-Bacon Duplo', quantidade: 1, preco: 34.9 },
        { nome: 'Refrigerante Lata', quantidade: 2, preco: 7.5 },
      ],
    },
  ];
  return base;
}

/* ─── Etapa 0: Selecionar contas ─── */
function EtapaContasMesa({
  mesaNumero,
  carrinho,
  totalCarrinho,
  onAvancar,
  onClose,
}: {
  mesaNumero: number;
  carrinho: import('../../../../contexts/PDVContext').CarrinhoItem[];
  totalCarrinho: number;
  onAvancar: (totalSelecionado: number, rodadasSelecionadas: RodadaMock[]) => void;
  onClose: () => void;
}) {
  const rodadas = useMemo(() => gerarRodadasMock(mesaNumero), [mesaNumero]);
  const [selecionados, setSelecionados] = useState<Set<string>>(new Set(rodadas.map((r) => r.id)));
  const [incluirCarrinho, setIncluirCarrinho] = useState(true);

  const toggle = (id: string) => {
    const next = new Set(selecionados);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelecionados(next);
  };

  const totalRodadas = useMemo(
    () =>
      rodadas
        .filter((r) => selecionados.has(r.id))
        .flatMap((r) => r.itens)
        .reduce((a, i) => a + i.preco * i.quantidade, 0),
    [rodadas, selecionados],
  );

  const totalSelecionado = totalRodadas + (incluirCarrinho ? totalCarrinho : 0);

  const podeProsseguir = selecionados.size > 0 || (incluirCarrinho && carrinho.length > 0);

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50 flex-shrink-0">
          <div>
            <p className="font-bold text-zinc-900">Selecionar Contas</p>
            <p className="text-xs text-zinc-500 mt-0.5">Mesa {mesaNumero} · Escolha quais pedidos pagar</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {/* Rodadas anteriores */}
          {rodadas.map((rodada) => {
            const subtotal = rodada.itens.reduce((a, i) => a + i.preco * i.quantidade, 0);
            const sel = selecionados.has(rodada.id);
            return (
              <button
                key={rodada.id}
                onClick={() => toggle(rodada.id)}
                className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                  sel ? 'border-amber-400 bg-amber-50/40' : 'border-zinc-200 bg-white hover:border-zinc-300'
                }`}
              >
                <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${sel ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'}`}>
                  <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                    sel ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                  }`}>
                    {sel && <i className="ri-check-line text-white text-[10px]" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-bold text-zinc-800">
                      Pedido #{rodada.numero} · {rodada.nomeResponsavel}
                    </p>
                    <p className="text-[10px] text-zinc-400">{rodada.hora} · {rodada.itens.length} itens</p>
                  </div>
                  <span className={`text-sm font-black flex-shrink-0 ${sel ? 'text-amber-700' : 'text-zinc-600'}`}>{fmt(subtotal)}</span>
                </div>
                <div className="px-3 py-2">
                  {rodada.itens.map((it, i) => (
                    <div key={i} className="flex items-center gap-1.5 py-0.5">
                      <span className="text-[10px] text-zinc-400 w-4 text-right">{it.quantidade}x</span>
                      <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}

          {/* Carrinho atual */}
          {carrinho.length > 0 && (
            <button
              onClick={() => setIncluirCarrinho((v) => !v)}
              className={`w-full text-left border-2 rounded-xl overflow-hidden transition-all cursor-pointer ${
                incluirCarrinho ? 'border-amber-400 bg-amber-50/40' : 'border-zinc-200 bg-white hover:border-zinc-300'
              }`}
            >
              <div className={`flex items-center gap-2.5 px-3 py-2.5 border-b ${incluirCarrinho ? 'border-amber-100 bg-amber-50' : 'border-zinc-100 bg-zinc-50'}`}>
                <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-colors ${
                  incluirCarrinho ? 'bg-amber-500 border-amber-500' : 'border-zinc-300 bg-white'
                }`}>
                  {incluirCarrinho && <i className="ri-check-line text-white text-[10px]" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-bold text-zinc-800">Pedido Atual</p>
                    <span className="text-[9px] font-bold text-amber-600 bg-amber-100 px-1.5 py-0.5 rounded-full">NOVO</span>
                  </div>
                  <p className="text-[10px] text-zinc-400">{carrinho.length} {carrinho.length === 1 ? 'item' : 'itens'} no carrinho</p>
                </div>
                <span className={`text-sm font-black flex-shrink-0 ${incluirCarrinho ? 'text-amber-700' : 'text-zinc-600'}`}>{fmt(totalCarrinho)}</span>
              </div>
              <div className="px-3 py-2">
                {carrinho.slice(0, 3).map((it) => (
                  <div key={it.cartId} className="flex items-center gap-1.5 py-0.5">
                    <span className="text-[10px] text-zinc-400 w-4 text-right">{it.quantidade}x</span>
                    <span className="text-[11px] text-zinc-600 truncate">{it.nome}</span>
                  </div>
                ))}
                {carrinho.length > 3 && <p className="text-[10px] text-zinc-400 mt-0.5">+{carrinho.length - 3} mais...</p>}
              </div>
            </button>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200 flex-shrink-0 space-y-3">
          <div className="flex items-center justify-between bg-zinc-50 rounded-xl px-4 py-2.5">
            <span className="text-sm font-semibold text-zinc-600">Total selecionado</span>
            <span className="text-lg font-black text-zinc-900">{fmt(totalSelecionado)}</span>
          </div>
          <button
            onClick={() => onAvancar(totalSelecionado, rodadas.filter((r) => selecionados.has(r.id)))}
            disabled={!podeProsseguir}
            className="w-full py-3 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
          >
            <i className="ri-arrow-right-line" />
            Ir para Pagamento · {fmt(totalSelecionado)}
          </button>
        </div>
      </div>
    </div>
  );
}

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function PagamentoModal({ onClose, onSuccess }: Props) {
  const { total, destino, carrinho, finalizarPedido, marcarComoPago } = usePDV();
  const { success: toastSuccess, error: toastError } = useToast();
  const { caixa, sessao } = useSessao();
  const { addPedido } = useKDS();
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const operadorNome = caixa?.operadorNome ?? 'Operador';
  const lojaNome = 'ERPOS Restaurante';
  const [formasPagamento, setFormasPagamento] = useState<FormaPagamento[]>([]);
  const [pagamentos, setPagamentos] = useState<PagamentoItem[]>([]);
  const [formaAtiva, setFormaAtiva] = useState('');
  const [valorInput, setValorInput] = useState('');
  const [sucesso, setSucesso] = useState(false);
  const [pagamentosFinal, setPagamentosFinal] = useState<PagamentoItem[]>([]);
  const [showComprovante, setShowComprovante] = useState(false);
  const [numeroPedidoFinal, setNumeroPedidoFinal] = useState(0);
  const [confirmando, setConfirmando] = useState(false);
  // Ref bloqueia clique duplo no mesmo tick (state sozinho não é suficiente)
  const confirmandoRef = useRef(false);
  // Alerta de inserção parcial (HTTP 207): pedido criado mas itens podem estar incompletos
  const [alertaParcial, setAlertaParcial] = useState<{
    orderId: string;
    orderNumber: string;
  } | null>(null);

  // ── Voucher state ──────────────────────────────────────────────────────────
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherAplicado, setVoucherAplicado] = useState<VoucherAplicado | null>(null);
  const [voucherError, setVoucherError] = useState('');

  // BUG 3.8: campos de cliente CPF/email
  const [dadosClienteOpen, setDadosClienteOpen] = useState(false);
  const [customerCpf, setCustomerCpf] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  useEffect(() => {
    if (!user?.tenantId) return;
    supabase.rpc('fn_get_payment_methods', { p_tenant_id: user.tenantId }).then(({ data }) => {
      if (data && Array.isArray(data) && data.length > 0) {
        const methods: FormaPagamento[] = (data as Array<Record<string, unknown>>).map((m) => ({
          id: m.id as string,
          nome: m.name as string,
          tipo: m.type as string,
          icone: ICON_MAP[m.type as string] ?? 'ri-more-line',
          ativo: m.is_active as boolean,
          requiresChange: m.requires_change as boolean,
        }));
        const active = methods.filter((m) => m.ativo);
        setFormasPagamento(active);
        if (active.length > 0) setFormaAtiva(active[0].id);
      }
    });
  }, [user?.tenantId]);

  // ── Etapa seleção de contas (apenas mesa) ──
  const isMesa = destino?.tipo === 'mesa';
  const [etapa, setEtapa] = useState<'selecionar_conta' | 'pagar'>(
    isMesa ? 'selecionar_conta' : 'pagar',
  );
  const [totalSelecionado, setTotalSelecionado] = useState(total);

  const totalEfetivo = isMesa && etapa === 'pagar' ? totalSelecionado : total;

  // Total com desconto de voucher aplicado
  const desconto = voucherAplicado?.applicable_amount ?? 0;
  const totalComDesconto = Math.max(0, totalEfetivo - desconto);

  // ─────────────────────────────────────────────

  const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
  const restante = Math.max(0, totalComDesconto - totalPago);
  const troco = totalPago > totalComDesconto ? totalPago - totalComDesconto : 0;

  // ── Voucher handlers ───────────────────────────────────────────────────────
  async function handleValidarVoucher() {
    if (!voucherCode.trim()) return;
    setVoucherLoading(true);
    setVoucherError('');
    try {
      const { data, error: fnErr } = await supabase.functions.invoke('voucher-write', {
        body: {
          action: 'validate_voucher',
          active_tenant_id: user?.tenantId,
          code: voucherCode.trim().toUpperCase(),
          order_amount: totalEfetivo,
        },
      });
      if (fnErr) throw fnErr;
      const result = data as { valid: boolean; voucher: Voucher | null; applicable_amount: number; reason?: string };
      if (!result.valid) {
        const reasons: Record<string, string> = {
          not_found: 'Voucher não encontrado',
          expired: 'Voucher expirado',
          depleted: 'Saldo esgotado',
          cancelled: 'Voucher cancelado',
        };
        setVoucherError(reasons[result.reason ?? ''] ?? 'Voucher inválido');
        return;
      }
      setVoucherAplicado({ voucher: result.voucher!, applicable_amount: result.applicable_amount });
      setPagamentos([]); // reseta pagamentos ao aplicar voucher
    } catch (err) {
      setVoucherError('Erro ao validar voucher');
    } finally {
      setVoucherLoading(false);
    }
  }

  function handleRemoverVoucher() {
    setVoucherAplicado(null);
    setVoucherCode('');
    setVoucherError('');
    setPagamentos([]);
  }

  const handleAddPagamento = () => {
    const v = parseFloat(valorInput.replace(',', '.'));
    if (isNaN(v) || v <= 0) return;
    const forma = formasPagamento.find((f) => f.id === formaAtiva);
    if (!forma) return;
    const trocoCalc = forma.tipo === 'cash' && v > restante ? v - restante : undefined;
    setPagamentos((prev) => [
      ...prev,
      { formaId: forma.id, formaNome: forma.nome, valor: Math.min(v, restante + (trocoCalc ?? 0)), troco: trocoCalc },
    ]);
    setValorInput('');
  };

  const handleRemovePagamento = (idx: number) => {
    setPagamentos((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleFinalizar = async () => {
    if (restante > 0.01) return;
    // Padrão ref+state: ref bloqueia no mesmo tick, state controla UI
    if (confirmandoRef.current) return;
    confirmandoRef.current = true;
    setConfirmando(true);
    try {
      // Passar dados do cliente (CPF/email) para o pedido
      const numeroStr = await finalizarPedido(pagamentos, {
        customerCpf: customerCpf || undefined,
        customerEmail: customerEmail || undefined,
      });
      const seq = parseInt(numeroStr.replace(/\D/g, '').slice(-4)) || 1;
      setNumeroPedidoFinal(seq);
      marcarComoPago(seq);

      // Resgatar voucher se aplicado
      if (voucherAplicado) {
        await supabase.functions.invoke('voucher-write', {
          body: {
            action: 'redeem_voucher',
            active_tenant_id: user?.tenantId,
            code: voucherAplicado.voucher.code,
            amount: voucherAplicado.applicable_amount,
            order_id: null,
          },
        });
      }

      if (!sessao) {
        const kdsPedido = buildKDSPedido({ cart: carrinho, destino, numeroSeq: seq, origem: 'caixa' });
        addPedido(kdsPedido);
      }
      setPagamentosFinal([...pagamentos]);
      setSucesso(true);
      toastSuccess('Pedido finalizado!', `#${String(seq).padStart(4, '0')} enviado ao KDS`);
      if (settings.print_kds_enabled) {
        printKitchenTicket(seq, carrinho, destino);
      }
      if (settings.print_kitchen_copy_enabled) {
        printSimpleReceipt(seq, carrinho, totalComDesconto, desconto, pagamentos, destino);
      }
    } catch (err) {
      // ── Alerta diferenciado para inserção parcial (HTTP 207) ──────────────
      // O pedido foi criado no banco mas alguns itens podem ter falhado.
      // Exibimos um aviso específico em vez de tratar como erro genérico.
      if (err instanceof PartialOrderError) {
        console.warn('[PagamentoModal] Inserção parcial detectada:', err.orderId, err.orderNumber);
        setAlertaParcial({ orderId: err.orderId, orderNumber: err.orderNumber });
        // Ainda marca como pago e mostra tela de sucesso — o pedido existe no banco
        const seq = parseInt(err.orderNumber.replace(/\D/g, '').slice(-4)) || 1;
        setNumeroPedidoFinal(seq);
        marcarComoPago(seq);
        setPagamentosFinal([...pagamentos]);
        setSucesso(true);
        return;
      }
      const msg = err instanceof Error ? err.message : (typeof err === 'object' ? JSON.stringify(err) : String(err));
      console.error('[PagamentoModal] handleFinalizar error:', msg);
      toastError('Erro ao finalizar pedido', msg);
    } finally {
      confirmandoRef.current = false;
      setConfirmando(false);
    }
  };

  const handleDismissAlertaParcial = useCallback(() => setAlertaParcial(null), []);

  // ── Etapa: selecionar contas da mesa ──
  if (isMesa && etapa === 'selecionar_conta') {
    return (
      <EtapaContasMesa
        mesaNumero={(destino as { tipo: 'mesa'; mesaNumero: number }).mesaNumero ?? 1}
        carrinho={carrinho}
        totalCarrinho={total}
        onAvancar={(totalSel) => {
          setTotalSelecionado(totalSel);
          setPagamentos([]);
          setValorInput('');
          setEtapa('pagar');
        }}
        onClose={onClose}
      />
    );
  }

  if (showComprovante) {
    return (
      <ComprovantePrint
        numero={numeroPedidoFinal}
        carrinho={carrinho}
        total={totalComDesconto}
        desconto={desconto}
        destino={destino}
        pagamentos={pagamentosFinal}
        operador={operadorNome}
        loja={lojaNome}
        onClose={() => { setShowComprovante(false); onSuccess(); }}
      />
    );
  }

  if (sucesso) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
        <div className="bg-white rounded-2xl w-full max-w-sm p-8 flex flex-col items-center text-center">
          {/* ── Alerta de inserção parcial (HTTP 207) ── */}
          {alertaParcial && (
            <div className="w-full mb-5 bg-amber-50 border border-amber-300 rounded-xl p-4 text-left">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0 mt-0.5">
                  <i className="ri-alert-line text-amber-600 text-base" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-amber-800">Pedido criado com aviso</p>
                  <p className="text-xs text-amber-700 mt-1 leading-relaxed">
                    O pedido <strong>{alertaParcial.orderNumber}</strong> foi registrado, mas alguns itens podem não ter chegado ao KDS. Verifique a tela da cozinha e confirme os itens manualmente se necessário.
                  </p>
                </div>
                <button
                  onClick={handleDismissAlertaParcial}
                  className="w-6 h-6 flex items-center justify-center text-amber-400 hover:text-amber-600 cursor-pointer flex-shrink-0"
                >
                  <i className="ri-close-line text-sm" />
                </button>
              </div>
            </div>
          )}

          <div className={`w-16 h-16 flex items-center justify-center rounded-full mb-4 ${alertaParcial ? 'bg-amber-100' : 'bg-green-100'}`}>
            <i className={`text-3xl ${alertaParcial ? 'ri-alert-line text-amber-500' : 'ri-check-line text-green-500'}`} />
          </div>
          <h2 className="text-xl font-bold text-zinc-900 mb-1">
            {alertaParcial ? 'Pedido Registrado (com aviso)' : 'Pedido Finalizado!'}
          </h2>
          <p className="text-zinc-500 text-sm">#{String(numeroPedidoFinal).padStart(4, '0')} · Enviado para o KDS · {formatPrice(totalComDesconto)}</p>
          {/* PDV e operador que registrou */}
          <div className="mt-2 flex items-center gap-2 flex-wrap justify-center">
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-full">
              <i className="ri-store-2-line text-zinc-400" />
              PDV Caixa
            </span>
            {operadorNome && (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-zinc-500 bg-zinc-100 px-2 py-1 rounded-full">
                <i className="ri-user-line text-zinc-400" />
                {operadorNome}
              </span>
            )}
          </div>
          {desconto > 0 && (
            <div className="mt-3 w-full bg-rose-50 border border-rose-200 rounded-xl p-2.5 flex items-center justify-between">
              <span className="text-xs text-rose-600 font-semibold flex items-center gap-1">
                <i className="ri-gift-line" /> Voucher {voucherAplicado?.voucher.code}
              </span>
              <span className="text-sm font-bold text-rose-600">-{formatPrice(desconto)}</span>
            </div>
          )}
          {troco > 0 && (
            <div className="mt-3 w-full bg-green-50 border border-green-200 rounded-xl p-3">
              <p className="text-green-700 font-bold text-lg">{formatPrice(troco)}</p>
              <p className="text-green-600 text-xs">Troco para o cliente</p>
            </div>
          )}
          <button
            onClick={() => { setSucesso(false); setShowComprovante(true); }}
            className="mt-5 w-full py-2.5 border-2 border-orange-500 text-orange-600 font-semibold text-sm rounded-xl hover:bg-orange-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            <i className="ri-printer-line" />
            Imprimir Comprovante
          </button>
          <button
            onClick={() => printSimpleReceipt(numeroPedidoFinal, carrinho, totalComDesconto, desconto, pagamentosFinal, destino)}
            className="mt-2 w-full py-2.5 border-2 border-zinc-300 text-zinc-600 font-semibold text-sm rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
          >
            <i className="ri-receipt-line" />
            Via Simples (Balcão)
          </button>
          <button
            onClick={onSuccess}
            className="mt-2 w-full py-2.5 text-zinc-400 text-sm cursor-pointer hover:text-zinc-600 transition-colors whitespace-nowrap"
          >
            Fechar sem imprimir
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50">
          <div className="flex items-center gap-2">
            {isMesa && (
              <button
                onClick={() => { setEtapa('selecionar_conta'); setPagamentos([]); }}
                className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400"
              >
                <i className="ri-arrow-left-line text-sm" />
              </button>
            )}
            <div>
              <p className="font-bold text-zinc-900">Finalizar Pedido</p>
              {destino && (
                <p className="text-xs text-zinc-500 mt-0.5">
                  {destino.tipo === 'mesa' ? `Mesa ${destino.mesaNumero}` :
                    destino.tipo === 'nome' ? destino.nomeCliente :
                    destino.tipo === 'senha' ? `Senha: ${destino.senha}` :
                    destino.tipo === 'hora' ? 'Fechar na Hora' : `Delivery · ${destino.nomeCliente}`}
                  {isMesa && etapa === 'pagar' && (
                    <span className="ml-1.5 text-amber-600 font-semibold">{formatPrice(totalEfetivo)}</span>
                  )}
                </p>
              )}
            </div>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Order summary */}
          <div className="bg-zinc-50 rounded-xl p-4">
            <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">Resumo do Pedido</p>
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {carrinho.map((item) => (
                <div key={item.cartId} className="flex justify-between text-sm">
                  <span className="text-zinc-700">{item.quantidade}x {item.nome}</span>
                  <span className="font-medium text-zinc-900">{formatPrice(item.precoTotal * item.quantidade)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-zinc-200 space-y-1">
              <div className="flex justify-between text-sm text-zinc-500">
                <span>Subtotal</span>
                <span>{formatPrice(totalEfetivo)}</span>
              </div>
              {desconto > 0 && (
                <div className="flex justify-between text-sm text-rose-600 font-semibold">
                  <span className="flex items-center gap-1">
                    <i className="ri-gift-line" /> Voucher {voucherAplicado?.voucher.code}
                  </span>
                  <span>-{formatPrice(desconto)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-base pt-1 border-t border-zinc-100">
                <span>{isMesa ? 'Total selecionado' : 'Total'}</span>
                <span className="text-amber-600">{formatPrice(totalComDesconto)}</span>
              </div>
            </div>
          </div>

          {/* ── Voucher / Gift Card ─────────────────────────────────────────── */}
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setVoucherOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 flex items-center justify-center text-rose-500">
                  <i className="ri-gift-line text-base" />
                </div>
                <span className="text-sm font-semibold text-zinc-700">
                  {voucherAplicado ? (
                    <span className="text-rose-600">Voucher aplicado: -{formatPrice(desconto)}</span>
                  ) : (
                    'Voucher / Gift Card'
                  )}
                </span>
              </div>
              <i className={`${voucherOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400`} />
            </button>

            {voucherOpen && (
              <div className="px-4 py-3 space-y-3 border-t border-zinc-100">
                {voucherAplicado ? (
                  /* Voucher já aplicado */
                  <div className="flex items-center justify-between bg-rose-50 border border-rose-200 rounded-xl px-4 py-3">
                    <div>
                      <div className="flex items-center gap-2 mb-0.5">
                        <i className="ri-gift-fill text-rose-500 text-sm" />
                        <span className="font-mono font-bold text-rose-700 text-sm tracking-wider">
                          {voucherAplicado.voucher.code}
                        </span>
                      </div>
                      <p className="text-xs text-rose-500">
                        {voucherAplicado.voucher.voucher_type === 'gift_card' ? 'Gift Card' :
                         voucherAplicado.voucher.voucher_type === 'discount' ? 'Desconto' :
                         voucherAplicado.voucher.voucher_type === 'cashback' ? 'Cashback' : 'Item Grátis'}
                        {' · '}Desconto: <strong>{formatPrice(voucherAplicado.applicable_amount)}</strong>
                      </p>
                    </div>
                    <button
                      onClick={handleRemoverVoucher}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-rose-100 text-rose-400 cursor-pointer transition-colors"
                      title="Remover voucher"
                    >
                      <i className="ri-close-line text-sm" />
                    </button>
                  </div>
                ) : (
                  /* Input de código */
                  <>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={voucherCode}
                        onChange={(e) => { setVoucherCode(e.target.value.toUpperCase()); setVoucherError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleValidarVoucher()}
                        placeholder="Ex: GC-A3F9-X2K1"
                        className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-rose-400 font-mono tracking-wider uppercase"
                      />
                      <button
                        onClick={handleValidarVoucher}
                        disabled={!voucherCode.trim() || voucherLoading}
                        className="px-4 py-2 bg-rose-500 hover:bg-rose-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center gap-1.5"
                      >
                        {voucherLoading ? (
                          <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <i className="ri-check-line" />
                        )}
                        Aplicar
                      </button>
                    </div>
                    {voucherError && (
                      <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <i className="ri-error-warning-line" />
                        {voucherError}
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-400">
                      Digite o código do voucher ou gift card e clique em Aplicar para obter o desconto.
                    </p>
                  </>
                )}
              </div>
            )}
          </div>

          {/* BUG 3.8: Dados do cliente (CPF/email) */}
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setDadosClienteOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 flex items-center justify-center text-zinc-400">
                  <i className="ri-user-3-line text-base" />
                </div>
                <span className="text-sm font-semibold text-zinc-700">
                  {customerCpf || customerEmail
                    ? <span className="text-emerald-600">Dados do cliente salvos</span>
                    : 'Dados do cliente (CPF / E-mail)'}
                </span>
                <span className="text-[10px] text-zinc-400 font-medium">Opcional</span>
              </div>
              <i className={`${dadosClienteOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400`} />
            </button>

            {dadosClienteOpen && (
              <div className="px-4 py-3 space-y-3 border-t border-zinc-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">CPF</label>
                    <input
                      type="text"
                      value={customerCpf}
                      onChange={(e) => setCustomerCpf(e.target.value)}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">E-mail</label>
                    <input
                      type="email"
                      value={customerEmail}
                      onChange={(e) => setCustomerEmail(e.target.value)}
                      placeholder="cliente@email.com"
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-zinc-400">
                  CPF e e-mail são salvos junto ao pedido para emissão de nota fiscal e histórico do cliente.
                </p>
              </div>
            )}
          </div>

          {/* Payment methods */}
          <div>
            <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">Forma de Pagamento</p>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-3">
              {formasPagamento.map((forma) => (
                <button
                  key={forma.id}
                  onClick={() => setFormaAtiva(forma.id)}
                  className={`flex flex-col items-center gap-1 p-2 rounded-xl border-2 transition-colors cursor-pointer ${
                    formaAtiva === forma.id
                      ? 'border-amber-500 bg-amber-50'
                      : 'border-zinc-200 hover:border-zinc-300'
                  }`}
                >
                  <div className={`w-7 h-7 flex items-center justify-center ${formaAtiva === forma.id ? 'text-amber-600' : 'text-zinc-400'}`}>
                    <i className={`${forma.icone} text-base`} />
                  </div>
                  <span className={`text-[9px] font-semibold text-center leading-tight ${formaAtiva === forma.id ? 'text-amber-700' : 'text-zinc-500'}`}>
                    {forma.nome}
                  </span>
                </button>
              ))}
            </div>

            {/* Value input */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm">R$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  data-keyboard="decimal"
                  value={valorInput}
                  onChange={(e) => {
                    // Permite apenas dígitos, vírgula e ponto
                    const raw = e.target.value.replace(/[^0-9.,]/g, '');
                    setValorInput(raw);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddPagamento()}
                  placeholder={formatPrice(restante).replace('R$\u00a0', '')}
                  className="w-full pl-9 pr-4 py-2.5 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <button
                onClick={() => { setValorInput(String(restante.toFixed(2))); }}
                className="px-3 py-2.5 border border-zinc-200 rounded-lg text-xs text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
              >
                Exato
              </button>
              <button
                onClick={handleAddPagamento}
                disabled={!valorInput || restante <= 0}
                className="px-4 py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors"
              >
                Adicionar
              </button>
            </div>
          </div>

          {/* Added payments */}
          {pagamentos.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-zinc-500 mb-2 uppercase tracking-wider">Pagamentos Adicionados</p>
              <div className="space-y-2">
                {pagamentos.map((p, idx) => (
                  <div key={idx} className="flex items-center justify-between bg-zinc-50 rounded-lg px-3 py-2">
                    <span className="text-sm text-zinc-700 font-medium">{p.formaNome}</span>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-bold text-zinc-900">{formatPrice(p.valor)}</span>
                      {p.troco && p.troco > 0 && (
                        <span className="text-xs text-green-600 font-medium">troco: {formatPrice(p.troco)}</span>
                      )}
                      <button onClick={() => handleRemovePagamento(idx)} className="text-zinc-300 hover:text-red-400 cursor-pointer">
                        <div className="w-4 h-4 flex items-center justify-center">
                          <i className="ri-close-line text-sm" />
                        </div>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Restante / Troco */}
          {restante > 0.01 && (
            <div className="flex items-center justify-between bg-red-50 border border-red-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-red-600">Restante a pagar</span>
              <span className="text-lg font-bold text-red-600">{formatPrice(restante)}</span>
            </div>
          )}
          {restante <= 0.01 && troco > 0 && (
            <div className="flex items-center justify-between bg-green-50 border border-green-200 rounded-xl px-4 py-3">
              <span className="text-sm font-semibold text-green-600">Troco</span>
              <span className="text-lg font-bold text-green-600">{formatPrice(troco)}</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-zinc-200">
          <button
            onClick={handleFinalizar}
            disabled={restante > 0.01 || confirmando}
            className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap text-base flex items-center justify-center gap-2"
          >
            {confirmando ? (
              <>
                <svg className="animate-spin w-5 h-5 text-white flex-shrink-0" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Confirmando pedido...
              </>
            ) : (
              <>
                <i className="ri-check-double-line" />
                Confirmar Pagamento · {formatPrice(totalComDesconto)}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Overlay de loading global */}
      {confirmando && (
        <div className="absolute inset-0 bg-white/80 rounded-2xl z-10 flex flex-col items-center justify-center gap-4">
          <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-full">
            <svg className="animate-spin w-8 h-8 text-green-500" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
          </div>
          <div className="text-center">
            <p className="text-sm font-bold text-zinc-800">Confirmando pedido...</p>
            <p className="text-xs text-zinc-500 mt-0.5">Enviando para o KDS, aguarde</p>
          </div>
        </div>
      )}
    </div>
  );
}

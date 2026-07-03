import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { PartialOrderError } from '@/hooks/useOrderSubmit';
import { usePDV, type PagamentoItem } from '../../../../contexts/PDVContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useToast } from '../../../../contexts/ToastContext';
import { useSessao } from '../../../../contexts/SessaoContext';
import { useKDS, buildKDSPedido } from '../../../../contexts/KDSContext';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { usePedidosAgrupados } from '@/hooks/usePedidosAgrupados';
import type { Voucher } from '@/types/vouchers';
import type { PedidoAgrupado } from '@/hooks/usePedidosAgrupados';
import EtapaSelecionarPedidos from './pagamento/EtapaSelecionarPedidos';
import AutorizacaoGerenteModal from '@/components/feature/AutorizacaoGerenteModal';
import CortesiaDetalhesModal from './CortesiaDetalhesModal';
import type { KDSPedido } from '@/types/kds';

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
import { printSimpleReceipt } from './CozinhaTicketPrint';
import { queueOrderForPrint, type OrderItemForPrint, type OrderPrintDestino } from '@/lib/printOrderQueue';
import type { PrintResult } from '@/lib/printUtils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface Props {
  onClose: () => void;
  onSuccess: () => void;
}

function formatPrice(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function kdsToPedidoAgrupado(p: KDSPedido): PedidoAgrupado {
  return {
    id: p.id,
    numero: p.numero,
    numeroStr: p.numeroStr,
    total: p.totalAmount,
    criadoEm: p.criadoEm,
    itens: p.itens.map((i) => ({
      nome: i.nome,
      quantidade: i.quantidade,
      preco: i.item_price,
    })),
    isCarrinho: false,
  };
}

export default function PagamentoModal({ onClose, onSuccess }: Props) {
  const { total, destino, carrinho, finalizarPedido, marcarComoPago } = usePDV();
  const { success: toastSuccess, error: toastError, warning: toastWarning } = useToast();
  const { caixa, sessao } = useSessao();
  const { addPedido, reloadOrders, pedidos: kdsPedidos, stationMap: kdsStationMap } = useKDS();
  const { user } = useAuth();
  const { getImpressoraParaEstacao, mapaEstacoes } = useImpressoras();
  const { settings } = useSystemSettings();
  const { pedidosRelacionados, carrinhoComoPedido, reloadOrders: reloadPedidosAgrupados } = usePedidosAgrupados(destino, carrinho, total);
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
  const [orderIdSucesso, setOrderIdSucesso] = useState('');
  const [confirmando, setConfirmando] = useState(false);
  // Ref bloqueia clique duplo no mesmo tick (state sozinho não é suficiente)
  const confirmandoRef = useRef(false);
  // Alerta de inserção parcial (HTTP 207): pedido criado mas itens podem estar incompletos
  const [alertaParcial, setAlertaParcial] = useState<{
    orderId: string;
    orderNumber: string;
  } | null>(null);

  // ── Cortesia (lançada no momento de pagar, com liberação de gerente/admin) ──
  const [showAutorizacaoCortesia, setShowAutorizacaoCortesia] = useState(false);
  const [showCortesiaDetalhes, setShowCortesiaDetalhes] = useState(false);
  const [cortesiaAutorTemp, setCortesiaAutorTemp] = useState<string | null>(null);
  const [foiCortesia, setFoiCortesia] = useState(false);

  // ── Voucher state ──────────────────────────────────────────────────────────
  const [voucherOpen, setVoucherOpen] = useState(false);
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherAplicado, setVoucherAplicado] = useState<VoucherAplicado | null>(null);
  const [voucherError, setVoucherError] = useState('');

  // Box de dados do cliente (campos avulsos — nome/telefone/CPF/e-mail)
  const [dadosClienteOpen, setDadosClienteOpen] = useState(false);
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCpf, setCustomerCpf] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // ── Desconto manual (com autorização de gerente/admin) ──────────────────────
  const [descontoOpen, setDescontoOpen] = useState(false);
  const [descontoInput, setDescontoInput] = useState('');
  const [descontoTipoManual, setDescontoTipoManual] = useState<'valor' | 'percentual'>('valor');
  const [descontoManual, setDescontoManual] = useState(0);
  const [descontoAutorizadoPor, setDescontoAutorizadoPor] = useState<string | null>(null);
  const [showDescontoAuth, setShowDescontoAuth] = useState(false);
  const [descontoPendente, setDescontoPendente] = useState(0);
  const [descontoError, setDescontoError] = useState('');

  const [carrinhoParaReimpressao, setCarrinhoParaReimpressao] = useState<import('../../../../contexts/PDVContext').CarrinhoItem[]>([]);
  const [destinoParaReimpressao, setDestinoParaReimpressao] = useState<import('../../../../contexts/PDVContext').DestinoInfo | null>(null);
  const [participantNameParaReimpressao, setParticipantNameParaReimpressao] = useState<string | null>(null);
  // Dados dos pedidos vinculados para exibir no comprovante/print
  const [pedidosVinculadosComprovante, setPedidosVinculadosComprovante] = useState<import('./ComprovantePrint').PedidoVinculadoComprovante[]>([]);

  // ── Etapa seleção de pedidos ──
  const temPedidosRelacionados = pedidosRelacionados.length > 0;
  // Estado de etapa: começa como 'selecionar_conta' se tem pedidos relacionados, senão 'pagar'
  const [etapa, setEtapa] = useState<'selecionar_conta' | 'pagar'>(
    temPedidosRelacionados ? 'selecionar_conta' : 'pagar',
  );
  const [modoVincularManual, setModoVincularManual] = useState(false);
  const [totalSelecionado, setTotalSelecionado] = useState(total);
  const [pedidosExistentesSelecionados, setPedidosExistentesSelecionados] = useState<PedidoAgrupado[]>([]);

  // Recarrega KDS quando o modal abre para garantir dados atualizados
  useEffect(() => {
    reloadPedidosAgrupados();
  }, [reloadPedidosAgrupados]);

  // Recalcula etapa automaticamente quando pedidos relacionados mudam
  // ATENÇÃO: só redireciona se ainda não houve nenhuma seleção confirmada pelo usuário
  // (pedidosExistentesSelecionados vazio = usuário ainda não passou pela tela de seleção)
  useEffect(() => {
    if (
      etapa === 'pagar' &&
      temPedidosRelacionados &&
      !modoVincularManual &&
      pedidosExistentesSelecionados.length === 0
    ) {
      setEtapa('selecionar_conta');
    }
  }, [temPedidosRelacionados, etapa, modoVincularManual, pedidosExistentesSelecionados.length]);

  const totalEfetivo = etapa === 'pagar' ? totalSelecionado : total;

  // Total com desconto de voucher + desconto manual aplicados
  const desconto = voucherAplicado?.applicable_amount ?? 0;
  const totalComDesconto = Math.max(0, totalEfetivo - desconto - descontoManual);

  // Base do desconto manual: valor efetivo já menos o voucher (não deixa passar do total)
  const baseDesconto = Math.max(0, totalEfetivo - desconto);

  function handleAplicarDesconto() {
    setDescontoError('');
    const n = parseFloat(descontoInput.replace(',', '.'));
    if (!n || n <= 0) { setDescontoError('Informe um valor de desconto'); return; }
    let valor = descontoTipoManual === 'percentual' ? baseDesconto * (n / 100) : n;
    if (descontoTipoManual === 'percentual' && n > 100) { setDescontoError('Percentual máximo é 100%'); return; }
    valor = Math.min(Math.round(valor * 100) / 100, baseDesconto);
    if (valor <= 0) { setDescontoError('Desconto inválido para este total'); return; }
    setDescontoPendente(valor);
    setShowDescontoAuth(true);
  }

  function handleRemoverDesconto() {
    setDescontoManual(0);
    setDescontoAutorizadoPor(null);
    setDescontoInput('');
    setDescontoError('');
    setPagamentos([]);
  }

  // ── Pedidos abertos para vinculação manual ──
  const todosPedidosAbertos = useMemo(() => {
    return kdsPedidos
      .filter((p) => {
        if (p.isPaid) return false;
        if (p.isCancelled) return false;
        if (p.status === 'cancelled') return false;
        return true;
      })
      .map(kdsToPedidoAgrupado);
  }, [kdsPedidos]);

  // Pedidos a mostrar na etapa de seleção
  const pedidosExistentesParaSelecao = useMemo(() => {
    if (modoVincularManual) {
      return todosPedidosAbertos;
    }
    return pedidosRelacionados;
  }, [modoVincularManual, todosPedidosAbertos, pedidosRelacionados]);

  // Helper para identificação do pedido
  const getPedidoIdentificacao = (pedido: PedidoAgrupado) => {
    if (pedido.isCarrinho) return '';
    if (pedido.destino === 'mesa' && pedido.mesaNumero) return `· Mesa ${pedido.mesaNumero}`;
    if (pedido.destino === 'senha' && pedido.senha) return `· Senha ${pedido.senha}`;
    if (pedido.destino === 'nome' && pedido.nomeCliente) return `· ${pedido.nomeCliente}`;
    if (pedido.destino === 'delivery' && pedido.nomeCliente) return `· Delivery · ${pedido.nomeCliente}`;
    if (pedido.destino === 'delivery') return '· Delivery';
    return '';
  };

  // Helper para identificação do pedido principal (carrinho)
  const getCarrinhoIdentificacao = () => {
    if (!destino) return '';
    if (destino.tipo === 'mesa' && destino.mesaNumero) return `· Mesa ${destino.mesaNumero}`;
    if (destino.tipo === 'senha' && destino.senha) return `· Senha ${destino.senha}`;
    if (destino.tipo === 'nome' && destino.nomeCliente) return `· ${destino.nomeCliente}`;
    if (destino.tipo === 'delivery' && destino.nomeCliente) return `· Delivery · ${destino.nomeCliente}`;
    if (destino.tipo === 'delivery') return '· Delivery';
    return '';
  };

  // ─────────────────────────────────────────────

  const totalPago = pagamentos.reduce((acc, p) => acc + p.valor, 0);
  const restante = Math.max(0, totalComDesconto - totalPago);
  const troco = totalPago > totalComDesconto ? totalPago - totalComDesconto : 0;

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

  // ── Voucher handlers ───────────────────────────────────────────────────────
  async function handleValidarVoucher() {
    if (!voucherCode.trim()) return;
    setVoucherLoading(true);
    setVoucherError('');
    try {
      const { data, error: fnErr } = await invokeWithAuth('voucher-write', {
        body: {
          action: 'validate_voucher',
          active_tenant_id: user?.tenantId,
          code: voucherCode.trim().toUpperCase(),
          order_amount: totalEfetivo,
        },
      });
      if (fnErr) throw fnErr;
      const result = data as { valid: boolean; voucher: Voucher | null; applicable_amount: number; reason?: string; min_order_amount?: number };
      if (!result.valid) {
        const reasons: Record<string, string> = {
          not_found: 'Voucher não encontrado',
          expired: 'Voucher expirado',
          depleted: 'Saldo esgotado',
          cancelled: 'Voucher cancelado',
          not_yet_valid: 'Voucher ainda não está vigente',
          below_min_order: result.min_order_amount
            ? `Pedido mínimo de ${formatPrice(result.min_order_amount)} para este voucher`
            : 'Pedido abaixo do mínimo deste voucher',
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
    const isCash = forma.tipo === 'cash';
    if (isCash && v > restante) {
      // Dinheiro com troco: amount = restante, troco = v - restante, valorRecebido = v
      const trocoCalc = v - restante;
      setPagamentos((prev) => [
        ...prev,
        { formaId: forma.id, formaNome: forma.nome, valor: restante, troco: trocoCalc, valorRecebido: v },
      ]);
    } else {
      // Outros métodos: amount = valor informado
      setPagamentos((prev) => [
        ...prev,
        { formaId: forma.id, formaNome: forma.nome, valor: v, troco: undefined },
      ]);
    }
    setValorInput('');
  };

  const handleRemovePagamento = (idx: number) => {
    setPagamentos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Pagamento de pedido existente (não cria pedido, só registra pagamento)
  // paymentGroupId: ID único gerado para agrupar pagamentos de múltiplos pedidos pagos juntos
  const pagarPedidoExistente = useCallback(async (orderId: string, pagamentosParaRegistrar: PagamentoItem[], paymentGroupId?: string | null) => {
    const cashRegisterId: string | null = caixa?.id ?? null;
    let paymentRegistered = false;
    const paymentErrors: string[] = [];
    for (const pag of pagamentosParaRegistrar) {
      if (!pag.formaId) continue;
      try {
        const { error: payErr } = await invokeWithAuth('order-write', {
          body: {
            action: 'record_payment',
            order_id: orderId,
            tenant_id: user?.tenantId,
            cash_register_id: cashRegisterId,
            payment_method_id: pag.formaId,
            amount: pag.valor,
            change_amount: pag.troco ?? 0,
            operator_name: user?.nome ?? null,
            paid_by_pdv: 'cashier',
            payment_group_id: paymentGroupId ?? null,
          },
        });
        if (payErr) {
          paymentErrors.push(typeof payErr === 'string' ? payErr : JSON.stringify(payErr));
        } else {
          paymentRegistered = true;
        }
      } catch (e) {
        paymentErrors.push(e instanceof Error ? e.message : String(e));
      }
    }
    if (paymentErrors.length > 0 && !paymentRegistered) {
      throw new Error(`Falha ao registrar pagamento: ${paymentErrors.join('; ')}`);
    }
    if (paymentRegistered) {
      try {
        await supabase.rpc('fn_update_paid_by_pdv', { p_order_id: orderId, p_paid_by_pdv: 'cashier' });
      } catch (e) {
        console.warn('[PagamentoModal] fn_update_paid_by_pdv error (non-blocking):', e);
      }
    }
    return paymentRegistered;
  }, [caixa?.id, user?.tenantId, user?.nome]);

  const handleFinalizar = async () => {
    if (restante > 0.01) return;
    if (confirmandoRef.current) return;
    confirmandoRef.current = true;
    setConfirmando(true);

    const carrinhoSnapshot = [...carrinho];
    const destinoSnapshot = destino;
    const pedidosExistentes = pedidosExistentesSelecionados.filter((p) => !p.isCarrinho);
    const incluirCarrinho = pedidosExistentesSelecionados.some((p) => p.isCarrinho);

    try {
      let numeroPedidoLocal = 0;
      let orderIdLocal = '';

      // Gera um payment_group_id único se houver mais de um pedido sendo pago junto
      const totalPedidosPagando = pedidosExistentes.length + (incluirCarrinho ? 1 : 0);
      const paymentGroupId: string | null = totalPedidosPagando > 1
        ? crypto.randomUUID()
        : null;

      // ── Recalcula troco total quando há múltiplas formas de pagamento ──
      // Se o total pago > total do pedido, o troco é a diferença.
      // O troco deve ser aplicado aos pagamentos em dinheiro que AINDA NÃO têm troco calculado.
      const trocoTotal = totalPago > totalComDesconto ? totalPago - totalComDesconto : 0;
      let trocoRestante = trocoTotal;
      const pagamentosComTroco: PagamentoItem[] = pagamentos.map((p) => {
        const isCash = formasPagamento.find((f) => f.id === p.formaId)?.tipo === 'cash';
        // Só recalcula se for dinheiro, ainda tem troco restante, e o pagamento ainda não tem troco
        if (isCash && trocoRestante > 0.01 && !p.troco) {
          const trocoDoPagamento = Math.min(trocoRestante, p.valor);
          trocoRestante -= trocoDoPagamento;
          return {
            ...p,
            valor: p.valor - trocoDoPagamento,
            troco: trocoDoPagamento,
            valorRecebido: p.valorRecebido ?? p.valor,
          };
        }
        return p;
      });
      // ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ── ──

      // Se não veio da tela de seleção (pedidosExistentesSelecionados vazio),
      // trata como se o carrinho atual fosse o único pedido a pagar
      const effectiveIncluirCarrinho = incluirCarrinho || pedidosExistentesSelecionados.length === 0;

      // 1. Cria o pedido do carrinho se estiver selecionado
      if (effectiveIncluirCarrinho && carrinhoSnapshot.length > 0) {
        const result = await finalizarPedido(
          pagamentosComTroco,
          {
            customerCpf: customerCpf || undefined,
            customerEmail: customerEmail || undefined,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            paymentGroupId,
          },
          undefined,
          descontoManual > 0 ? { amount: descontoManual, authorizedBy: descontoAutorizadoPor } : undefined,
        );
        const numeroStr = result.number;
        const seq = parseInt(numeroStr.replace(/\D/g, '').slice(-4)) || 1;
        numeroPedidoLocal = seq;
        orderIdLocal = result.orderId;
        setNumeroPedidoFinal(seq);
        setOrderIdSucesso(result.orderId);
        marcarComoPago(seq);
      }

      // 2. Paga os pedidos existentes selecionados (distribui os pagamentos proporcionalmente)
      // O troco é do pagamento total — não deve ser proporcionalizado entre pedidos
      const totalTrocoDistribuido = pagamentosComTroco.reduce((acc, p) => acc + (p.troco ?? 0), 0);
      let trocoJaAtribuido = false;

      const pagamentosParaPedidosExistentes = pedidosExistentes.map((pedido) => {
        const proporcao = pedido.total / totalEfetivo;
        return {
          orderId: pedido.id,
          pagamentos: pagamentosComTroco.map((p) => {
            const isCash = formasPagamento.find((f) => f.id === p.formaId)?.tipo === 'cash';
            const valorProporcional = Number((p.valor * proporcao).toFixed(2));
            // Troco só no primeiro pedido que recebe dinheiro, e apenas uma vez
            let trocoDoPedido = 0;
            if (isCash && !trocoJaAtribuido && totalTrocoDistribuido > 0) {
              trocoJaAtribuido = true;
              trocoDoPedido = totalTrocoDistribuido;
            }
            return {
              ...p,
              valor: valorProporcional,
              troco: trocoDoPedido > 0 ? trocoDoPedido : undefined,
            };
          }),
        };
      });

      for (const { orderId, pagamentos: pg } of pagamentosParaPedidosExistentes) {
        await pagarPedidoExistente(orderId, pg, paymentGroupId);
      }

      // Resgatar voucher se aplicado
      if (voucherAplicado) {
        await invokeWithAuth('voucher-write', {
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
        const kdsPedido = buildKDSPedido({ cart: carrinhoSnapshot, destino: destinoSnapshot, numeroSeq: numeroPedidoLocal, origem: 'caixa', stationMap: kdsStationMap });
        addPedido(kdsPedido);
      }
      setPagamentosFinal([...pagamentosComTroco]);
      setCarrinhoParaReimpressao(carrinhoSnapshot);
      setDestinoParaReimpressao(destinoSnapshot);
      // Buscar participantName nos pedidos KDS vinculados para exibir no ticket de cozinha
      const participantNameFromKDS = pedidosExistentes
        .map((p) => kdsPedidos.find((k) => k.id === p.id)?.participantName)
        .find(Boolean) ?? null;
      setParticipantNameParaReimpressao(participantNameFromKDS);
      // Guarda os pedidos vinculados para o comprovante
      const pedidosVinculadosParaComprovante = pedidosExistentes.map((p) => ({
        numero: p.numero,
        numeroStr: p.numeroStr,
        itens: p.itens.map((i) => ({ nome: i.nome, quantidade: i.quantidade, preco: i.preco })),
        total: p.total,
        destino: p.destino === 'mesa' ? { tipo: 'mesa' as const, mesaNumero: p.mesaNumero ?? 0 } :
          p.destino === 'senha' ? { tipo: 'senha' as const, senha: p.senha ?? '' } :
          p.destino === 'nome' ? { tipo: 'nome' as const, nomeCliente: p.nomeCliente ?? '' } :
          p.destino === 'delivery' ? { tipo: 'delivery' as const, nomeCliente: p.nomeCliente ?? '' } :
          null,
      }));
      setPedidosVinculadosComprovante(pedidosVinculadosParaComprovante);
      setSucesso(true);
      toastSuccess('Pagamento registrado!', `${pedidosExistentes.length + (effectiveIncluirCarrinho ? 1 : 0)} pedido(s) pago(s) · ${formatPrice(totalComDesconto)}`);

      // Reload KDS
      setTimeout(() => {
        reloadOrders();
      }, 500);
    } catch (err) {
      if (err instanceof PartialOrderError) {
        console.warn('[PagamentoModal] Inserção parcial detectada:', err.orderId, err.orderNumber);
        setAlertaParcial({ orderId: err.orderId, orderNumber: err.orderNumber });
        const seq = parseInt(err.orderNumber.replace(/\D/g, '').slice(-4)) || 1;
        setNumeroPedidoFinal(seq);
        setOrderIdSucesso(err.orderId);
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

  // ── Finaliza o pedido do carrinho como cortesia (R$ 0,00) ──
  // Passa a cortesia explicitamente para o finalizarPedido (sem depender do estado
  // isCortesia do contexto). Liberação de gerente/admin já validada antes deste ponto.
  const handleConfirmarCortesia = async (destinatario: string, motivo: string) => {
    if (confirmandoRef.current) return;
    confirmandoRef.current = true;
    setConfirmando(true);
    setShowCortesiaDetalhes(false);

    const carrinhoSnapshot = [...carrinho];
    const destinoSnapshot = destino;
    try {
      const result = await finalizarPedido([], undefined, {
        autorizadoPor: cortesiaAutorTemp,
        destinatario,
        motivo,
      });
      const seq = parseInt(result.number.replace(/\D/g, '').slice(-4)) || 1;
      setNumeroPedidoFinal(seq);
      setOrderIdSucesso(result.orderId);
      marcarComoPago(seq);
      setCarrinhoParaReimpressao(carrinhoSnapshot);
      setDestinoParaReimpressao(destinoSnapshot);
      setParticipantNameParaReimpressao(null);
      setPedidosVinculadosComprovante([]);
      setPagamentosFinal([]);
      setFoiCortesia(true);
      setSucesso(true);
      toastSuccess('Cortesia confirmada!', `#${result.number} — registrado como cortesia`);
      setTimeout(() => reloadOrders(), 500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('[PagamentoModal] handleConfirmarCortesia error:', msg);
      toastError('Erro ao registrar cortesia', msg);
    } finally {
      confirmandoRef.current = false;
      setConfirmando(false);
    }
  };

  const handleDismissAlertaParcial = useCallback(() => setAlertaParcial(null), []);

  // ── Tela de sucesso tem PRIORIDADE sobre qualquer etapa ──
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
            {alertaParcial ? 'Pedido Registrado (com aviso)' : foiCortesia ? 'Cortesia Registrada!' : 'Pedido Finalizado!'}
          </h2>
          <p className="text-zinc-500 text-sm">
            #{String(numeroPedidoFinal).padStart(4, '0')} · Enviado para o KDS · {foiCortesia ? 'Cortesia · R$ 0,00' : formatPrice(totalComDesconto)}
          </p>
          {foiCortesia && cortesiaAutorTemp && (
            <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold text-violet-700 bg-violet-50 border border-violet-200 px-2 py-1 rounded-full">
              <i className="ri-gift-line text-violet-500" />
              Cortesia autorizada por {cortesiaAutorTemp}
            </span>
          )}
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

          {/* Resolve impressora para os botoes manuais de impressao */}
          {(() => {
            const primeiroItem = carrinhoParaReimpressao.find((i) => i.stationId);
            const estacao = primeiroItem?.stationId ?? 'cozinha-padrao';
            const impressora = getImpressoraParaEstacao(estacao);
            return (
              <>
                <button
                  onClick={async () => {
                    try {
                      if (!user?.tenantId || !orderIdSucesso) {
                        toastWarning('Erro ao enfileirar', 'Dados do pedido incompletos para reimpressão.');
                        return;
                      }
                      const printItems: OrderItemForPrint[] = carrinhoParaReimpressao.map((ci) => ({
                        item_name: ci.nome,
                        quantity: ci.quantidade,
                        skip_kds: ci.semPreparo || false,
                        station_id: ci.stationId || null,
                        item_id: ci.itemId || null,
                        options: ci.opcoes?.map((o) => ({ option_name: o.opcaoNome, obrigatorio: (o as Record<string, unknown>).obrigatorio as boolean | undefined })),
                        observations: [
                          ...(ci.observacoes ?? []).map((t) => ({ text: t })),
                        ],
                        notes: ci.observacaoLivre || null,
                      }));
                      const printDestino: OrderPrintDestino = {
                        tipo: destinoParaReimpressao?.tipo ?? 'balcao',
                        destination_name: destinoParaReimpressao?.nomeCliente ?? null,
                        table_number: destinoParaReimpressao?.mesaNumero ?? null,
                      };
                      await queueOrderForPrint(
                        user.tenantId,
                        orderIdSucesso,
                        String(numeroPedidoFinal),
                        'cashier',
                        printItems,
                        printDestino,
                        mapaEstacoes,
                        foiCortesia ? 0 : totalComDesconto,
                      );
                      toastSuccess('Comanda enfileirada', 'A impressora vai imprimir assim que estiver disponível.');
                    } catch (e) {
                      toastWarning('Erro ao enfileirar', 'Não foi possível enfileirar a comanda para impressão.');
                    }
                  }}
                  className="mt-5 w-full py-2.5 border-2 border-orange-500 text-orange-600 font-semibold text-sm rounded-xl hover:bg-orange-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <i className="ri-printer-line" />
                  Reimprimir Comanda (Fila)
                </button>
                <button
                  onClick={async () => {
                    const result = await printSimpleReceipt(numeroPedidoFinal, carrinhoParaReimpressao, foiCortesia ? 0 : totalComDesconto, desconto, pagamentosFinal, destinoParaReimpressao, impressora, true, pedidosVinculadosComprovante, participantNameParaReimpressao);
                    if (!result.success) {
                      toastWarning('Impressão não disponível', result.error || 'Agente local não respondeu. Verifique se o agente está rodando.');
                    }
                  }}
                  className="mt-2 w-full py-2.5 border-2 border-zinc-300 text-zinc-600 font-semibold text-sm rounded-xl hover:bg-zinc-50 cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
                >
                  <i className="ri-receipt-line" />
                  Via Simples (Balcão)
                </button>
              </>
            );
          })()}

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

  // ── Etapa: selecionar pedidos ──
  if (etapa === 'selecionar_conta') {
    const titulo = modoVincularManual
      ? 'Vincular Pedidos'
      : destino?.tipo === 'mesa'
        ? 'Selecionar Contas'
        : 'Selecionar Pedidos para Pagar';
    const subtitulo = modoVincularManual
      ? 'Escolha quais pedidos abertos pagar junto com este carrinho'
      : destino?.tipo === 'mesa'
        ? `Mesa ${destino.mesaNumero} · Escolha quais pedidos pagar`
        : 'Escolha quais pedidos pagar de uma vez';

    return (
      <EtapaSelecionarPedidos
        titulo={titulo}
        subtitulo={subtitulo}
        pedidosExistentes={pedidosExistentesParaSelecao}
        pedidoCarrinho={carrinhoComoPedido}
        onAvancar={(totalSel, pedidosSel) => {
          setTotalSelecionado(totalSel);
          setPedidosExistentesSelecionados(pedidosSel);
          setPagamentos([]);
          setValorInput('');
          setEtapa('pagar');
        }}
        onClose={() => {
          setModoVincularManual(false);
          if (!temPedidosRelacionados) {
            setEtapa('pagar');
          } else {
            onClose();
          }
        }}
      />
    );
  }

  if (showComprovante) {
    const impressoraCaixa = getImpressoraParaEstacao('caixa-pdv');
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
        impressora={impressoraCaixa}
        pedidosVinculados={pedidosVinculadosComprovante}
        onClose={() => { setShowComprovante(false); onSuccess(); }}
      />
    );
  }

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="relative bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50">
          <div className="flex items-center gap-2">
            {(temPedidosRelacionados || modoVincularManual) && (
              <button
                onClick={() => {
                  setModoVincularManual(false);
                  setEtapa('selecionar_conta');
                  setPagamentos([]);
                }}
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
                    destino.tipo === 'delivery' ? `Delivery · ${destino.nomeCliente}` : 'Balcão'}
                  {etapa === 'pagar' && (
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
          {/* Botão Vincular Pedidos — destacado no topo, sempre visível */}
          <button
            onClick={() => {
              setModoVincularManual(true);
              setEtapa('selecionar_conta');
              setPagamentos([]);
            }}
            className="w-full flex items-center justify-center gap-2 py-3 text-sm font-bold text-amber-700 bg-amber-50 hover:bg-amber-100 border-2 border-amber-300 rounded-xl cursor-pointer whitespace-nowrap transition-colors"
          >
            <div className="w-5 h-5 flex items-center justify-center">
              <i className="ri-link-m text-amber-600 text-base" />
            </div>
            Vincular Pedidos
            <span className="text-xs font-normal text-amber-500">(unir com outros pedidos)</span>
          </button>

          {/* Order summary */}
          <div className="bg-zinc-50 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Resumo do Pedido</p>
              {/* Badge indicando pedidos vinculados já selecionados */}
              {pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length > 0 && (
                <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                  {pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length} pedido(s) vinculado(s)
                </span>
              )}
            </div>
            <div className="space-y-1.5 max-h-28 overflow-y-auto">
              {carrinho.map((item) => (
                <div key={item.cartId} className="flex justify-between text-sm">
                  <span className="text-zinc-700">{item.quantidade}x {item.nome}</span>
                  <span className="font-medium text-zinc-900">{formatPrice(item.precoTotal * item.quantidade)}</span>
                </div>
              ))}
            </div>
            {/* Pedidos vinculados manualmente */}
            {pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length > 0 && (
              <div className="mt-2 pt-2 border-t border-zinc-200 space-y-1">
                <p className="text-[10px] font-bold text-amber-600 flex items-center gap-1">
                  <i className="ri-link-m text-[10px]" />
                  Pedidos vinculados:
                </p>
                {pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).map((p) => (
                  <div key={p.id} className="flex justify-between text-xs">
                    <span className="text-zinc-600">
                      #{p.numeroStr || String(p.numero).padStart(4, '0')}
                      <span className="text-zinc-400 ml-1">{getPedidoIdentificacao(p)}</span>
                    </span>
                    <span className="font-medium text-zinc-900">{formatPrice(p.total)}</span>
                  </div>
                ))}
              </div>
            )}
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
                <span>{pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length > 0 ? 'Total selecionado' : 'Total'}</span>
                <span className="text-amber-600">{formatPrice(totalComDesconto)}</span>
              </div>
            </div>
          </div>

          {/* ── Desconto (com autorização) ──────────────────────────────────── */}
          <div className="border border-zinc-200 rounded-xl overflow-hidden">
            <button
              onClick={() => setDescontoOpen((v) => !v)}
              className="w-full flex items-center justify-between px-4 py-3 bg-zinc-50 hover:bg-zinc-100 cursor-pointer transition-colors"
            >
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 flex items-center justify-center text-amber-500">
                  <i className="ri-percent-line text-base" />
                </div>
                <span className="text-sm font-semibold text-zinc-700">
                  {descontoManual > 0 ? (
                    <span className="text-amber-600">Desconto aplicado: -{formatPrice(descontoManual)}</span>
                  ) : (
                    'Desconto'
                  )}
                </span>
              </div>
              <i className={`${descontoOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400`} />
            </button>

            {descontoOpen && (
              <div className="px-4 py-3 space-y-3 border-t border-zinc-100">
                {descontoManual > 0 ? (
                  <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
                    <div>
                      <p className="text-sm font-bold text-amber-700">-{formatPrice(descontoManual)}</p>
                      <p className="text-xs text-amber-500">
                        {descontoAutorizadoPor ? `Autorizado por ${descontoAutorizadoPor}` : 'Autorizado'}
                      </p>
                    </div>
                    <button
                      onClick={handleRemoverDesconto}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-amber-100 text-amber-400 cursor-pointer transition-colors"
                      title="Remover desconto"
                    >
                      <i className="ri-close-line text-sm" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
                      {(['valor', 'percentual'] as const).map((t) => (
                        <button
                          key={t}
                          type="button"
                          onClick={() => setDescontoTipoManual(t)}
                          className={`flex-1 py-1.5 rounded-md text-xs font-semibold cursor-pointer transition-colors ${descontoTipoManual === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                        >
                          {t === 'valor' ? 'Valor (R$)' : 'Percentual (%)'}
                        </button>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={descontoInput}
                        onChange={(e) => { setDescontoInput(e.target.value); setDescontoError(''); }}
                        onKeyDown={(e) => e.key === 'Enter' && handleAplicarDesconto()}
                        placeholder={descontoTipoManual === 'percentual' ? '10' : '5,00'}
                        className="flex-1 px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <button
                        onClick={handleAplicarDesconto}
                        disabled={!descontoInput.trim()}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-white text-sm font-semibold rounded-lg cursor-pointer whitespace-nowrap transition-colors flex items-center gap-1.5"
                      >
                        <i className="ri-shield-check-line" />
                        Aplicar
                      </button>
                    </div>
                    {descontoError && (
                      <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        <i className="ri-error-warning-line" />
                        {descontoError}
                      </div>
                    )}
                    <p className="text-[10px] text-zinc-400">
                      O desconto exige autorização de gerente/admin (PIN ou notificação).
                    </p>
                  </>
                )}
              </div>
            )}
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
                  {customerName || customerPhone || customerCpf || customerEmail
                    ? <span className="text-emerald-600">Dados do cliente salvos</span>
                    : 'Dados do cliente'}
                </span>
                <span className="text-[10px] text-zinc-400 font-medium">Opcional</span>
              </div>
              <i className={`${dadosClienteOpen ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400`} />
            </button>

            {dadosClienteOpen && (
              <div className="px-4 py-3 space-y-3 border-t border-zinc-100">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Nome</label>
                    <input
                      type="text"
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Nome do cliente"
                      maxLength={80}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-semibold text-zinc-500 mb-1 uppercase tracking-wide">Telefone</label>
                    <input
                      type="tel"
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="(00) 00000-0000"
                      maxLength={20}
                      className="w-full px-3 py-2 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
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
                  Salvos junto ao pedido para nota fiscal e histórico do cliente.
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
                        <span className="text-xs text-green-600 font-medium">
                          recebido {formatPrice(p.valorRecebido ?? p.valor)} · troco {formatPrice(p.troco)}
                        </span>
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
        <div className="px-5 py-4 border-t border-zinc-200 space-y-2">
          {/* Cortesia — só para o carrinho atual (sem pedidos vinculados) e com liberação gerente/admin */}
          {carrinho.length > 0 && pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length === 0 && (
            <button
              onClick={() => setShowAutorizacaoCortesia(true)}
              disabled={confirmando}
              className="w-full py-2.5 border-2 border-violet-300 text-violet-700 bg-violet-50 hover:bg-violet-100 disabled:opacity-40 disabled:cursor-not-allowed font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap text-sm flex items-center justify-center gap-2"
            >
              <i className="ri-gift-line text-base" />
              Lançar como Cortesia (R$ 0,00)
            </button>
          )}
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

      {/* Cortesia — autorização gerente/admin */}
      {showAutorizacaoCortesia && (
        <AutorizacaoGerenteModal
          titulo="Autorizar Cortesia"
          descricao="Informe as credenciais de gerente ou admin para liberar este pedido como cortesia (R$ 0,00)."
          niveisPermitidos={['gerente', 'admin']}
          tenantId={user?.tenantId ?? ''}
          onAutorizado={(autorizadoPor) => {
            setCortesiaAutorTemp(autorizadoPor);
            setShowAutorizacaoCortesia(false);
            setShowCortesiaDetalhes(true);
          }}
          onCancelar={() => setShowAutorizacaoCortesia(false)}
        />
      )}

      {/* Cortesia — destinatário + motivo */}
      {showCortesiaDetalhes && (
        <CortesiaDetalhesModal
          autorizadoPor={cortesiaAutorTemp ?? 'Gerente'}
          onConfirmar={(destinatario, motivo) => handleConfirmarCortesia(destinatario, motivo)}
          onCancelar={() => { setShowCortesiaDetalhes(false); setCortesiaAutorTemp(null); }}
        />
      )}

      {/* Desconto — autorização gerente/admin (PIN OU e-mail+senha) */}
      {showDescontoAuth && (
        <AutorizacaoGerenteModal
          titulo="Autorizar Desconto"
          descricao={`Libere o desconto de ${formatPrice(descontoPendente)} com credenciais de gerente ou admin.`}
          niveisPermitidos={['gerente', 'admin']}
          tenantId={user?.tenantId ?? ''}
          onAutorizado={(autorizadoPor) => {
            setDescontoManual(descontoPendente);
            setDescontoAutorizadoPor(autorizadoPor);
            setShowDescontoAuth(false);
            setPagamentos([]);
            toastSuccess('Desconto autorizado', `${formatPrice(descontoPendente)} por ${autorizadoPor}`);
          }}
          onCancelar={() => setShowDescontoAuth(false)}
        />
      )}
    </div>
  );
}
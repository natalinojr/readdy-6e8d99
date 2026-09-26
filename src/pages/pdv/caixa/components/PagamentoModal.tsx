import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import CpfCnpjInput from '@/components/base/CpfCnpjInput';
import { PartialOrderError } from '@/hooks/useOrderSubmit';
import { usePDV, type PagamentoItem } from '../../../../contexts/PDVContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useToast } from '../../../../contexts/ToastContext';
import { useSessao } from '../../../../contexts/SessaoContext';
import { useKDS, buildKDSPedido } from '../../../../contexts/KDSContext';
import { supabase, invokeWithAuth, type EdgeHttpError } from '@/lib/supabase';
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
import CobrarMaquininhaModal from '@/components/feature/CobrarMaquininhaModal';
import { perguntar } from '@/components/base/Dialogos';
import { printSimpleReceipt } from './CozinhaTicketPrint';
import { queueOrderForPrint, type OrderItemForPrint, type OrderPrintDestino } from '@/lib/printOrderQueue';
import type { PrintResult } from '@/lib/printUtils';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/** Marca de pagamento cobrado FORA do sistema (maquininha avulsa), para não voltar à fila. */
const MANUAL = 'manual';

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

// Botões de extras (vincular / desconto / voucher / cliente) na coluna do resumo
const EXTRA_BTN = 'flex flex-col md:flex-row items-center justify-center gap-1 md:gap-1.5 px-1.5 py-2 rounded-lg border text-[11px] md:text-xs font-semibold cursor-pointer transition-colors min-w-0';

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
  // ── Cartao cobrado na maquininha (Mercado Pago Point em modo PDV) ─────────
  // Quando a loja tem maquininha ligada ao sistema, escolher credito/debito no caixa manda
  // o valor para a maquininha em vez de so empilhar o valor digitado: o operador nao erra a
  // forma e o pagamento so entra quando o provedor aprova.
  const [pointPdv, setPointPdv] = useState(false);
  // Pix na maquininha é opcional e separado do cartão (Configurações › Maquininha Point)
  const [pointPdvPix, setPointPdvPix] = useState(false);
  const [cobranca, setCobranca] = useState<{ idx: number; valor: number; method: 'credit_card' | 'debit_card' | 'pix' } | null>(null);
  // depois que a maquininha aprova, o efeito abaixo segue a fila (ou fecha o pedido)
  const [seguirAposCobranca, setSeguirAposCobranca] = useState(false);
  // cobrancas aprovadas nesta venda: depois de criar o pedido, viram vinculo pix_payment -> pedido
  const cobrancasRef = useRef<string[]>([]);
  // Cartão aprovado na maquininha em venda anterior que nunca entrou num pedido (modal fechou,
  // navegador recarregou etc.) — mostrado no topo para reaproveitar ou dispensar com motivo.
  const [cobrancasNaoUsadas, setCobrancasNaoUsadas] = useState<Array<{
    id: string; amount: number; method: 'credit_card' | 'debit_card' | 'pix'; confirmed_at: string; order_id: string | null;
  }>>([]);
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
  const [voucherCode, setVoucherCode] = useState('');
  const [voucherLoading, setVoucherLoading] = useState(false);
  const [voucherAplicado, setVoucherAplicado] = useState<VoucherAplicado | null>(null);
  const [voucherError, setVoucherError] = useState('');

  // Box de dados do cliente (campos avulsos — nome/telefone/CPF/e-mail)
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  const [customerCpf, setCustomerCpf] = useState('');
  const [customerEmail, setCustomerEmail] = useState('');

  // ── Desconto manual (com autorização de gerente/admin) ──────────────────────
  // Desconto / voucher / dados do cliente abrem numa janelinha por cima (não empurram a tela)
  const [extraAberto, setExtraAberto] = useState<'desconto' | 'voucher' | 'cliente' | null>(null);
  // Celular: lista de itens do resumo começa recolhida
  const [resumoAberto, setResumoAberto] = useState(false);
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
  // O pagamento SEMPRE começa direto na tela de pagar. A tela de "Selecionar
  // Pedidos para Pagar" (agrupar vários pedidos do mesmo cliente/mesa) só abre
  // sob demanda, pelo botão "Vincular Pedidos".
  //
  // Antes ela abria automaticamente quando o destino tinha pedidos "não pagos" —
  // o que incluía pedidos RECÉM-pagos ainda não sincronizados (marcarComoPago é
  // local; isPaid só atualiza no reload ~500ms depois). Isso fazia a tela abrir
  // sozinha após um pagamento e, quando o pedido fantasma sumia, ficar travada e
  // vazia ("Nenhum pedido para pagar"). Ir sempre direto ao pagamento elimina
  // as duas situações sem perder o agrupamento (que continua no botão manual).
  const [etapa, setEtapa] = useState<'selecionar_conta' | 'pagar'>('pagar');
  const [modoVincularManual, setModoVincularManual] = useState(false);
  const [totalSelecionado, setTotalSelecionado] = useState(total);
  const [pedidosExistentesSelecionados, setPedidosExistentesSelecionados] = useState<PedidoAgrupado[]>([]);

  // Recarrega KDS quando o modal abre para garantir dados atualizados
  useEffect(() => {
    reloadPedidosAgrupados();
  }, [reloadPedidosAgrupados]);

  const totalEfetivo = etapa === 'pagar' ? totalSelecionado : total;
  const qtdItens = carrinho.reduce((n, i) => n + i.quantidade, 0);
  const qtdVinculados = pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length;
  const temDadosCliente = !!(customerName || customerPhone || customerCpf || customerEmail);

  // Total com desconto de voucher + desconto manual aplicados
  // Voucher limitado ao que sobra depois do desconto manual (senão o desconto total passa
  // do valor do pedido e o order-write recusa por inconsistência financeira)
  const desconto = Math.min(voucherAplicado?.applicable_amount ?? 0, Math.max(0, totalEfetivo - descontoManual));
  const totalComDesconto = Math.max(0, totalEfetivo - desconto - descontoManual);

  // Base do desconto manual: valor efetivo já menos o voucher (não deixa passar do total)
  const baseDesconto = Math.max(0, totalEfetivo - desconto);

  function handleAplicarDesconto() {
    if (bloquearSeAprovado()) return;
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

  // Desconto manual mudou depois do voucher: o valor aplicável do voucher (e o pedido mínimo)
  // foram validados sobre outro total — limpa para o operador aplicar de novo.
  const descontoManualAnteriorRef = useRef(descontoManual);
  useEffect(() => {
    if (descontoManualAnteriorRef.current === descontoManual) return;
    descontoManualAnteriorRef.current = descontoManual;
    if (voucherAplicado) {
      setVoucherAplicado(null);
      setVoucherError('O desconto mudou — aplique o voucher novamente');
    }
  }, [descontoManual, voucherAplicado]);

  function handleRemoverDesconto() {
    if (bloquearSeAprovado()) return;
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

  // Venda do carrinho: o pedido nasce DEPOIS da cobrança, então o vínculo cobrança → pedido
  // é feito aqui (fin_pix_payments.order_id). É o que liga a venda no Mercado Pago ao pedido
  // na hora de conferir a conciliação.
  const vincularCobrancas = useCallback(async (orderId: string) => {
    const ids = cobrancasRef.current.filter((id) => id !== MANUAL);
    if (ids.length === 0 || !orderId) return;
    cobrancasRef.current = [];
    await Promise.all(ids.map((id) =>
      invokeWithAuth('pix-payment', { body: { action: 'attach_order', pix_payment_id: id, order_id: orderId, tenant_id: user?.tenantId } })
        .catch(() => undefined)));
  }, [user?.tenantId]);

  // Pedido único sendo pago: só aí dá para mandar o número do pedido para a maquininha
  // (external_reference no Mercado Pago = casamento exato na conciliação depois).
  const pedidoUnicoParaCobranca = useMemo(() => {
    const existentes = pedidosExistentesSelecionados.filter((p) => !p.isCarrinho);
    const temCarrinho = pedidosExistentesSelecionados.some((p) => p.isCarrinho);
    return existentes.length === 1 && !temCarrinho ? existentes[0] : null;
  }, [pedidosExistentesSelecionados]);

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
  // Dinheiro acima do restante já entra com valor = restante e o troco guardado em p.troco,
  // então totalPago nunca passa do total: o troco exibido tem que somar p.troco.
  const troco = (totalPago > totalComDesconto ? totalPago - totalComDesconto : 0)
    + pagamentos.reduce((acc, p) => acc + (p.troco ?? 0), 0);

  // Cartão aprovado pela maquininha (cobrancaId real, não MANUAL): o cliente já pagou de
  // verdade — nenhuma ação pode fazer essa cobrança desaparecer da tela sem terminar a venda.
  const pagamentosAprovados = pagamentos.filter((p) => p.cobrancaId && p.cobrancaId !== MANUAL);
  const temCobrancaAprovada = pagamentosAprovados.length > 0;
  const valorAprovadoNaMaquininha = pagamentosAprovados.reduce((acc, p) => acc + p.valor, 0);
  const bloquearSeAprovado = useCallback(() => {
    if (!temCobrancaAprovada) return false;
    toastError('Tem cartão aprovado', `O cliente já pagou ${formatPrice(valorAprovadoNaMaquininha)} na maquininha. Termine a venda — se precisar desfazer, estorne na maquininha.`);
    return true;
  }, [temCobrancaAprovada, valorAprovadoNaMaquininha, toastError]);

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

  // A maquininha do caixa esta pronta? (terminal proprio do PDV ou o padrao da loja)
  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelled = false;
    invokeWithAuth<{ point?: boolean; pdv?: boolean; pdv_pix?: boolean }>('pix-payment', {
      body: { action: 'kiosk_card_provider', tenant_id: user.tenantId },
    }).then(({ data }) => {
      if (cancelled) return;
      setPointPdv(Boolean(data?.point && data?.pdv));
      setPointPdvPix(Boolean(data?.point && data?.pdv_pix));
    });
    return () => { cancelled = true; };
  }, [user?.tenantId]);

  // Cartão aprovado no caixa que não entrou em venda nenhuma (tela fechou/recarregou entre a
  // aprovação e o fim da venda). Só faz sentido consultar quando a maquininha do caixa está ligada.
  useEffect(() => {
    if (!pointPdv || !user?.tenantId) return;
    invokeWithAuth<{ charges?: Array<{ id: string; amount: number; method: 'credit_card' | 'debit_card' | 'pix'; confirmed_at: string; order_id: string | null }> }>('pix-payment', {
      body: { action: 'pdv_unused', tenant_id: user.tenantId },
    }).then(({ data }) => {
      setCobrancasNaoUsadas(data?.charges ?? []);
    }).catch(() => undefined);
  }, [pointPdv, user?.tenantId]);

  // "Usar nesta venda": empurra a cobrança pendente como um pagamento já aprovado.
  const handleUsarCobrancaPendente = useCallback((c: { id: string; amount: number; method: 'credit_card' | 'debit_card' | 'pix' }) => {
    const forma = formasPagamento.find((f) => f.tipo === c.method);
    if (!forma) {
      toastError('Forma indisponível', 'Não há forma de pagamento ativa para esse tipo de cobrança.');
      return;
    }
    setPagamentos((prev) => [...prev, { formaId: forma.id, formaNome: forma.nome, valor: c.amount, cobrancaId: c.id }]);
    cobrancasRef.current = [...cobrancasRef.current, c.id];
    setCobrancasNaoUsadas((prev) => prev.filter((x) => x.id !== c.id));
  }, [formasPagamento, toastError]);

  // "Dispensar": pede o motivo e some da lista (backend exige gerente/admin).
  const handleDispensarCobrancaPendente = useCallback(async (c: { id: string }) => {
    const motivo = await perguntar({ titulo: 'Por que dispensar esta cobrança?', placeholder: 'Ex.: estornado na maquininha / lançado à mão em outro pedido', confirmarLabel: 'Dispensar', perigo: true });
    if (!motivo || !motivo.trim()) return;
    try {
      const { error } = await invokeWithAuth('pix-payment', {
        body: { action: 'dismiss_unused', pix_payment_id: c.id, reason: motivo.trim(), tenant_id: user?.tenantId },
      });
      if (error) {
        const code = (error as EdgeHttpError).code;
        toastError('Não foi possível dispensar', code === 'forbidden' ? 'Só gerente ou administrador pode dispensar uma cobrança aprovada.' : error.message);
        return;
      }
      setCobrancasNaoUsadas((prev) => prev.filter((x) => x.id !== c.id));
    } catch (e) {
      toastError('Erro ao dispensar', e instanceof Error ? e.message : String(e));
    }
  }, [user?.tenantId, toastError]);

  // ── Voucher handlers ───────────────────────────────────────────────────────
  async function handleValidarVoucher() {
    if (!voucherCode.trim()) return;
    if (bloquearSeAprovado()) return;
    setVoucherLoading(true);
    setVoucherError('');
    try {
      const { data, error: fnErr } = await invokeWithAuth('voucher-write', {
        body: {
          action: 'validate_voucher',
          active_tenant_id: user?.tenantId,
          code: voucherCode.trim().toUpperCase(),
          order_amount: Math.max(0, totalEfetivo - descontoManual),
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
    if (bloquearSeAprovado()) return;
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
    // Troco só existe em dinheiro: cartão, Pix, vale etc. não podem passar do que falta pagar.
    if (!isCash && v > restante + 0.005) {
      toastWarning('Valor maior que o restante', `${forma.nome} não tem troco: o máximo é ${formatPrice(restante)}.`);
      setValorInput(restante.toFixed(2).replace('.', ','));
      return;
    }
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
    // Linha com cobrança aprovada não some da lista (o botão nem aparece; isto é reforço).
    if (pagamentos[idx]?.cobrancaId && pagamentos[idx].cobrancaId !== MANUAL) {
      bloquearSeAprovado();
      return;
    }
    setPagamentos((prev) => prev.filter((_, i) => i !== idx));
  };

  // Pagamento de pedido existente (não cria pedido, só registra pagamento)
  // paymentGroupId: ID único gerado para agrupar pagamentos de múltiplos pedidos pagos juntos
  const pagarPedidoExistente = useCallback(async (orderId: string, pagamentosParaRegistrar: PagamentoItem[], paymentGroupId?: string | null, paymentGroupSize?: number | null) => {
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
            group_size: paymentGroupId ? (paymentGroupSize ?? null) : null,
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

  // ── Cartão na maquininha: cobra no BOTÃO FINAL, nunca ao montar a lista ────
  // Cobrar no "+" deixava a maquininha carregada com a tela de pagamento ainda editável
  // atrás — dava para mexer ou cancelar com o cliente já passando o cartão.
  const tipoDaForma = useCallback(
    (formaId: string) => formasPagamento.find((f) => f.id === formaId)?.tipo ?? '',
    [formasPagamento],
  );
  const cobrancasPendentes = useMemo(() => pagamentos
    .map((p, idx) => ({ p, idx }))
    .filter(({ p }) => {
      const t = tipoDaForma(p.formaId);
      if (p.cobrancaId) return false;
      return t === 'credit_card' || t === 'debit_card' || (t === 'pix' && pointPdvPix);
    })
    .map(({ p, idx }) => ({ idx, valor: p.valor, method: tipoDaForma(p.formaId) as 'credit_card' | 'debit_card' | 'pix' })),
  [pagamentos, tipoDaForma, pointPdvPix]);
  const precisaCobrar = pointPdv && cobrancasPendentes.length > 0;
  const totalACobrar = cobrancasPendentes.reduce((acc, c) => acc + c.valor, 0);

  const handleConfirmar = () => {
    if (restante > 0.01 || confirmando) return;
    // com mais de um cartão, cobra um de cada vez; o efeito abaixo puxa o próximo
    if (precisaCobrar) { setCobranca(cobrancasPendentes[0]); return; }
    handleFinalizar();
  };

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
      // Voucher entra como DESCONTO no pedido do carrinho (mesmo critério do delivery-write:
      // discount_amount/total_amount do pedido já reduzidos), para o pedido fechar como pago.
      // Pagamento de pedidos já lançados (mesa/vínculo) não tem como receber esse desconto
      // por aqui — bloqueia em vez de gravar o pedido com total cheio e pagamento a menos.
      const vaiCriarPedidoCarrinho = (incluirCarrinho || pedidosExistentes.length === 0) && carrinhoSnapshot.length > 0;
      if (voucherAplicado && (pedidosExistentes.length > 0 || !vaiCriarPedidoCarrinho)) {
        toastError('Voucher não aplicável aqui', 'O voucher só pode ser usado numa venda nova do carrinho, sem pedidos já lançados junto. Remova o voucher para continuar.');
        return;
      }

      let numeroPedidoLocal = 0;
      let orderIdLocal = '';
      // Venda zerada (voucher/desconto cobre 100%) sem nenhum pagamento lançado: registra um
      // pagamento de R$ 0 numa forma existente para o order-write marcar o pedido como pago
      // (ramo total_amount === 0 → is_paid). Sem isso o pedido fica em aberto e trava a sessão.
      const formaZero = formasPagamento.find((f) => f.ativo && f.tipo === 'cash') ?? formasPagamento.find((f) => f.ativo);
      const vendaZerada = vaiCriarPedidoCarrinho && pedidosExistentes.length === 0
        && totalComDesconto < 0.005 && pagamentos.length === 0;
      if (vendaZerada && !formaZero) {
        toastError('Sem forma de pagamento', 'Cadastre/ative uma forma de pagamento para registrar venda de valor zero.');
        return;
      }

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

      // 1. Distribui os pagamentos entre os pedidos existentes (proporcional ao total
      // de cada um). O troco é do pagamento total — não deve ser proporcionalizado.
      const totalTrocoDistribuido = pagamentosComTroco.reduce((acc, p) => acc + (p.troco ?? 0), 0);
      // O troco é entregue UMA vez, então só um pedido do grupo pode gravá-lo. Quando o
      // carrinho vira pedido ele já grava (pagamentosCarrinho herda p.troco), então os
      // existentes não repetem — senão o change_amount entra em dobro no fechamento.
      const carrinhoVaiGravarTroco = effectiveIncluirCarrinho && carrinhoSnapshot.length > 0;
      let trocoJaAtribuido = carrinhoVaiGravarTroco;

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

      // Cada pedido do grupo grava só a SUA parte do valor recebido, senão a soma das
      // linhas de payments conta o grupo em dobro. O carrinho fica com o resto (valor
      // recebido - partes dos existentes): assim absorve o arredondamento e a soma
      // fecha exatamente com o que entrou.
      const pagamentosCarrinho = pagamentosComTroco.map((p, j) => {
        const somaExistentes = pagamentosParaPedidosExistentes.reduce((s, e) => s + e.pagamentos[j].valor, 0);
        return { ...p, valor: Number((p.valor - somaExistentes).toFixed(2)) };
      });

      // 2. Cria o pedido do carrinho se estiver selecionado
      if (effectiveIncluirCarrinho && carrinhoSnapshot.length > 0) {
        const result = await finalizarPedido(
          vendaZerada && formaZero
            ? [{ formaId: formaZero.id, formaNome: formaZero.nome, valor: 0 }]
            : pagamentosCarrinho,
          {
            customerCpf: customerCpf || undefined,
            customerEmail: customerEmail || undefined,
            customerName: customerName || undefined,
            customerPhone: customerPhone || undefined,
            paymentGroupId,
            paymentGroupSize: paymentGroupId ? totalPedidosPagando : null,
          },
          undefined,
          (descontoManual > 0 || desconto > 0)
            ? {
                amount: descontoManual + desconto,
                authorizedBy: [
                  descontoManual > 0 ? descontoAutorizadoPor : null,
                  voucherAplicado ? `voucher ${voucherAplicado.voucher.code} (${formatPrice(desconto)})` : null,
                ].filter(Boolean).join(' + ') || null,
              }
            : undefined,
        );
        if (result.auditoriaDescontoFalhou) {
          toastWarning('Registro do desconto falhou', `Pedido #${result.number} gravado com o desconto, mas o registro de auditoria do desconto não foi salvo.`);
        }
        if (result.pagamentoPendente) toastWarning('Pagamento não confirmado', result.pagamentoPendente);
        const numeroStr = result.number;
        const seq = parseInt(numeroStr.replace(/\D/g, '').slice(-4)) || 1;
        numeroPedidoLocal = seq;
        orderIdLocal = result.orderId;
        setNumeroPedidoFinal(seq);
        setOrderIdSucesso(result.orderId);
        void vincularCobrancas(result.orderId);
        marcarComoPago(seq);
      }

      // 3. Paga todos os pedidos existentes EM PARALELO (cada um é um pedido/linha
      // diferente no banco, então não há corrida de dados). Dentro de cada pedido,
      // os métodos de pagamento continuam sequenciais (ver pagarPedidoExistente).
      // Isso troca N chamadas de rede em série por ~1 tempo de rede no total.
      await Promise.all(
        pagamentosParaPedidosExistentes.map(({ orderId, pagamentos: pg }) =>
          pagarPedidoExistente(orderId, pg, paymentGroupId, totalPedidosPagando),
        ),
      );

      // Sem carrinho (só pedidos já lançados sendo pagos): a cobrança aprovada ainda não foi
      // vinculada a nenhum pedido — vincularCobrancas já é no-op se o carrinho a consumiu antes.
      if (pedidosExistentes.length > 0) {
        void vincularCobrancas(pedidosExistentes[0].id);
      }

      // Resgatar voucher se aplicado
      // Resgata sempre que o pedido existe de fato (UUID): o desconto já foi gravado no
      // create_order, então não resgatar permitiria reusar o voucher.
      const orderIdValido = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderIdLocal);
      if (voucherAplicado && orderIdValido) {
        let erroResgate: string | null = null;
        try {
          const { data: redeemData, error: redeemErr } = await invokeWithAuth<{ error?: string }>('voucher-write', {
            body: {
              action: 'redeem_voucher',
              active_tenant_id: user?.tenantId,
              code: voucherAplicado.voucher.code,
              amount: desconto,
              order_id: orderIdLocal,
              order_amount: Math.max(0, totalEfetivo - descontoManual),
            },
          });
          if (redeemErr) erroResgate = redeemErr.message ?? String(redeemErr);
          else if (redeemData?.error) erroResgate = redeemData.error;
        } catch (e) {
          erroResgate = e instanceof Error ? e.message : String(e);
        }
        if (erroResgate) {
          toastError('Voucher não foi baixado', `Pedido #${numeroPedidoLocal} com desconto, mas o resgate do voucher ${voucherAplicado.voucher.code} falhou: ${erroResgate}. Baixe o voucher manualmente.`);
        }
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
      void vincularCobrancas(result.orderId);
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

  // Maquininha aprovou: ou puxa o próximo cartão da fila, ou fecha o pedido sozinho.
  // Passa por um efeito de propósito — handleFinalizar lê `pagamentos` do estado, e chamar
  // direto no callback usaria a lista de antes da troca de forma (crédito × débito).
  useEffect(() => {
    if (!seguirAposCobranca) return;
    setSeguirAposCobranca(false);
    if (cobrancasPendentes.length > 0) { setCobranca(cobrancasPendentes[0]); return; }
    handleFinalizar();
  }, [seguirAposCobranca]); // eslint-disable-line react-hooks/exhaustive-deps

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
          // Cancelar a vinculação sempre volta para a tela de pagamento
          // (a seleção é um sub-passo opcional, nunca o ponto de entrada).
          setModoVincularManual(false);
          setEtapa('pagar');
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

  // Restante/troco + Cortesia + Confirmar: sempre à vista. No tablet/desktop fica embaixo da
  // coluna do pagamento (a esquerda desce até o fim); no celular, preso no rodapé da janela.
  const rodape = (
    <>
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
        onClick={handleConfirmar}
        disabled={restante > 0.01 || confirmando}
        className={`w-full py-3 ${precisaCobrar ? 'bg-sky-600 hover:bg-sky-700' : 'bg-green-500 hover:bg-green-600'} disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors cursor-pointer whitespace-nowrap text-base flex items-center justify-center gap-2`}
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
          precisaCobrar ? (
          <>
            <i className="ri-bank-card-line" />
            Cobrar na maquininha · {formatPrice(totalACobrar)}
          </>
          ) : (
          <>
            <i className="ri-check-double-line" />
            Confirmar Pagamento · {formatPrice(totalComDesconto)}
          </>
          )
        )}
      </button>
    </>
  );

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-2 sm:p-4">
      {/* Duas colunas (md+): à esquerda o que se paga, à direita como se paga. O rodapé
          (restante/troco + confirmar) fica sempre visível — nada importante atrás de rolagem.
          No celular vira uma coluna, com a lista de itens recolhida. */}
      <div className="relative bg-white rounded-2xl w-full max-w-lg md:max-w-4xl shadow-2xl overflow-hidden flex flex-col max-h-[96dvh] md:h-[min(660px,94dvh)]">
        {/* Header */}
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-200 bg-zinc-50">
          <div className="flex items-center gap-2">
            {modoVincularManual && (
              <button
                onClick={() => {
                  if (bloquearSeAprovado()) return;
                  // Volta para a seleção de vinculação (mantém o modo manual ativo)
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
          <button onClick={() => { if (!bloquearSeAprovado()) onClose(); }} className="w-8 h-8 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400">
            <i className="ri-close-line text-lg" />
          </button>
        </div>

        <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-y-auto md:overflow-hidden">
          {/* ── Esquerda: resumo + extras ─────────────────────────────────── */}
          <div className="md:w-[44%] md:min-h-0 flex flex-col gap-3 p-4 md:border-r border-zinc-200 bg-zinc-50/60">
            <div className="bg-white border border-zinc-200 rounded-xl p-3 flex flex-col md:flex-1 md:min-h-0">
              <button
                type="button"
                onClick={() => setResumoAberto((v) => !v)}
                className="flex items-center justify-between gap-2 mb-2 cursor-pointer md:cursor-default text-left"
              >
                <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">
                  Resumo · {qtdItens} {qtdItens === 1 ? 'item' : 'itens'}
                </span>
                <span className="flex items-center gap-1.5">
                  {qtdVinculados > 0 && (
                    <span className="text-[10px] font-bold text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
                      +{qtdVinculados} vinculado(s)
                    </span>
                  )}
                  <i className={`${resumoAberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-zinc-400 md:hidden`} />
                </span>
              </button>
              {/* Só a lista rola, e só quando é longa */}
              <div className={`${resumoAberto ? 'block' : 'hidden'} md:block max-h-40 md:max-h-none md:flex-1 md:min-h-0 overflow-y-auto pr-1 mb-1`}>
                <div className="space-y-1.5">
              {carrinho.map((item) => (
                <div key={item.cartId} className="flex justify-between text-sm">
                  <span className="text-zinc-700">{item.quantidade}x {item.nome}</span>
                  <span className="font-medium text-zinc-900">{formatPrice(item.precoTotal * item.quantidade)}</span>
                </div>
              ))}
                </div>
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
                <span>{pedidosExistentesSelecionados.filter((p) => !p.isCarrinho).length > 0 ? 'Total selecionado' : 'Total'}</span>
                <span className="text-amber-600">{formatPrice(totalComDesconto)}</span>
              </div>
            </div>
            </div>

            {/* Extras: cada um abre uma janelinha por cima; aplicado, o botão mostra o valor */}
            <div className="grid grid-cols-4 md:grid-cols-2 gap-2 shrink-0">
              <button
                onClick={() => {
                  if (bloquearSeAprovado()) return;
                  setModoVincularManual(true);
                  setEtapa('selecionar_conta');
                  setPagamentos([]);
                }}
                className={`${EXTRA_BTN} ${qtdVinculados > 0 ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-white text-zinc-600 hover:border-amber-300'}`}
              >
                <i className="ri-link-m text-base text-amber-600" />
                <span className="truncate">{qtdVinculados > 0 ? `${qtdVinculados} vinculado(s)` : 'Vincular'}</span>
              </button>
              <button
                onClick={() => setExtraAberto('desconto')}
                className={`${EXTRA_BTN} ${descontoManual > 0 ? 'border-amber-400 bg-amber-50 text-amber-700' : 'border-zinc-200 bg-white text-zinc-600 hover:border-amber-300'}`}
              >
                <i className="ri-percent-line text-base text-amber-500" />
                <span className="truncate">{descontoManual > 0 ? `-${formatPrice(descontoManual)}` : 'Desconto'}</span>
              </button>
              <button
                onClick={() => setExtraAberto('voucher')}
                className={`${EXTRA_BTN} ${voucherAplicado ? 'border-rose-300 bg-rose-50 text-rose-700' : 'border-zinc-200 bg-white text-zinc-600 hover:border-rose-300'}`}
              >
                <i className="ri-gift-line text-base text-rose-500" />
                <span className="truncate">{voucherAplicado ? `-${formatPrice(desconto)}` : 'Voucher'}</span>
              </button>
              <button
                onClick={() => setExtraAberto('cliente')}
                className={`${EXTRA_BTN} ${temDadosCliente ? 'border-emerald-300 bg-emerald-50 text-emerald-700' : 'border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300'}`}
              >
                <i className={`ri-user-3-line text-base ${temDadosCliente ? 'text-emerald-600' : 'text-zinc-400'}`} />
                <span className="truncate">{temDadosCliente ? 'Cliente salvo' : 'CPF / Cliente'}</span>
              </button>
            </div>
          </div>

          {/* ── Direita: pagamento ─────────────────────────────────────────── */}
          <div className="flex-1 md:min-h-0 flex flex-col">
          <div className="md:flex-1 md:min-h-0 md:overflow-y-auto p-4 space-y-3">
          {/* Cartão aprovado e ainda não lançado numa venda */}
          {cobrancasNaoUsadas.length > 0 && (
            <div className="bg-amber-50 border border-amber-300 rounded-xl p-3 space-y-2">
              <p className="text-xs font-bold text-amber-700 flex items-center gap-1.5">
                <i className="ri-alert-line" /> Cartão aprovado e ainda não lançado
              </p>
              {cobrancasNaoUsadas.map((c) => (
                <div key={c.id} className="flex items-center justify-between gap-2 bg-white border border-amber-200 rounded-lg px-3 py-2">
                  <div className="text-xs text-zinc-700">
                    <span className="font-bold">{formatPrice(c.amount)}</span>
                    {' · '}
                    {c.method === 'debit_card' ? 'Débito' : c.method === 'pix' ? 'Pix' : 'Crédito'}
                    {' · '}
                    {new Date(c.confirmed_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleUsarCobrancaPendente(c)}
                      className="px-2.5 py-1 bg-amber-500 hover:bg-amber-600 text-white text-[11px] font-semibold rounded-lg cursor-pointer whitespace-nowrap"
                    >
                      Usar nesta venda
                    </button>
                    <button
                      onClick={() => handleDispensarCobrancaPendente(c)}
                      className="text-[11px] text-zinc-400 hover:text-red-500 cursor-pointer underline whitespace-nowrap"
                    >
                      Dispensar
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
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
                      {p.cobrancaId && p.cobrancaId !== MANUAL ? (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-600" title="Aprovado na maquininha — não pode ser removido">
                          <i className="ri-lock-line" /> aprovado na maquininha
                        </span>
                      ) : (
                        <button onClick={() => handleRemovePagamento(idx)} className="text-zinc-300 hover:text-red-400 cursor-pointer">
                          <div className="w-4 h-4 flex items-center justify-center">
                            <i className="ri-close-line text-sm" />
                          </div>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
          </div>
          <div className="hidden md:block shrink-0 border-t border-zinc-200 px-4 py-3 space-y-2">
            {rodape}
          </div>
          </div>
        </div>

        {/* Rodapé no celular */}
        <div className="md:hidden shrink-0 border-t border-zinc-200 px-4 py-3 space-y-2">
          {rodape}
        </div>

        {/* Extras abertos por cima da janela */}
        {extraAberto && (
          <div className="absolute inset-0 z-20 bg-black/40 flex items-center justify-center p-4" onClick={() => setExtraAberto(null)}>
            <div className="bg-white rounded-xl w-full max-w-sm max-h-full overflow-y-auto shadow-xl" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center justify-between px-4 py-3 bg-zinc-50 border-b border-zinc-100">
                <p className="text-sm font-bold text-zinc-800">
                  {extraAberto === 'desconto' ? 'Desconto' : extraAberto === 'voucher' ? 'Voucher / Gift Card' : 'Dados do cliente (opcional)'}
                </p>
                <button onClick={() => setExtraAberto(null)} className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-zinc-200 cursor-pointer text-zinc-400">
                  <i className="ri-close-line" />
                </button>
              </div>
              {extraAberto === 'desconto' && (
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
              {extraAberto === 'voucher' && (
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
                        {' · '}Desconto: <strong>{formatPrice(desconto)}</strong>
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
              {extraAberto === 'cliente' && (
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
                  <CpfCnpjInput
                    compact
                    label="CPF/CNPJ na nota"
                    value={customerCpf}
                    onChange={setCustomerCpf}
                  />
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
              <div className="px-4 pb-4">
                <button
                  onClick={() => setExtraAberto(null)}
                  className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white text-sm font-semibold rounded-lg cursor-pointer"
                >
                  Pronto
                </button>
              </div>
            </div>
          </div>
        )}
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
          niveisPermitidos={['supervisao', 'gerente', 'admin']}
          tenantId={user?.tenantId ?? ''}
          onAutorizado={(autorizadoPor) => {
            if (bloquearSeAprovado()) { setShowDescontoAuth(false); return; }
            setDescontoManual(descontoPendente);
            setDescontoAutorizadoPor(autorizadoPor);
            setShowDescontoAuth(false);
            setPagamentos([]);
            toastSuccess('Desconto autorizado', `${formatPrice(descontoPendente)} por ${autorizadoPor}`);
          }}
          onCancelar={() => setShowDescontoAuth(false)}
        />
      )}

      {/* Cartão na maquininha: o pagamento só entra na lista quando o provedor aprovar */}
      {cobranca && user?.tenantId && (
        <CobrarMaquininhaModal
          tenantId={user.tenantId}
          amount={cobranca.valor}
          method={cobranca.method}
          orderId={pedidoUnicoParaCobranca?.id ?? null}
          orderNumber={pedidoUnicoParaCobranca?.numeroStr ?? null}
          onAprovado={({ pixPaymentId, method }) => {
            const c = cobranca;
            setCobranca(null);
            if (!c) return;
            cobrancasRef.current = [...cobrancasRef.current, pixPaymentId];
            setPagamentos((prev) => prev.map((p, i) => {
              if (i !== c.idx) return p;
              // A maquininha diz se foi crédito ou débito: se o operador escolheu a forma
              // errada, vale o que a maquininha respondeu.
              const formaReal = formasPagamento.find((f) => f.tipo === method);
              if (formaReal && formaReal.id !== p.formaId) {
                toastWarning('Forma ajustada', `O cliente pagou em ${method === 'debit_card' ? 'débito' : method === 'pix' ? 'Pix' : 'crédito'}: lançado como ${formaReal.nome}.`);
                return { ...p, formaId: formaReal.id, formaNome: formaReal.nome, cobrancaId: pixPaymentId };
              }
              return { ...p, cobrancaId: pixPaymentId };
            }));
            setSeguirAposCobranca(true);
          }}
          onCancelar={() => setCobranca(null)}
          onForaDaMaquininha={() => {
            const c = cobranca;
            setCobranca(null);
            if (!c) return;
            // MANUAL = cobrado fora do sistema (maquininha avulsa). Marca a linha para ela não
            // voltar para a fila; o valor entra como entrava antes da integração.
            setPagamentos((prev) => prev.map((p, i) => (i === c.idx ? { ...p, cobrancaId: MANUAL } : p)));
            toastWarning('Lançado à mão', 'Confira na maquininha avulsa se o pagamento foi aprovado antes de fechar o pedido.');
            setSeguirAposCobranca(true);
          }}
        />
      )}
    </div>
  );
}
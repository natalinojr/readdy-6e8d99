import { useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAppMode } from '@/contexts/AppModeContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useAuth } from '@/contexts/AuthContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useOrderSubmit } from '@/hooks/useOrderSubmit';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';
import DeliveryItemGrid, { type DeliveryCarrinhoItem } from './components/DeliveryItemGrid';
import DeliveryCarrinho, { type ClienteDelivery } from './components/DeliveryCarrinho';
import DeliveryClienteModal from './components/DeliveryClienteModal';
import DeliveryPagamentoModal from './components/DeliveryPagamentoModal';
import DeliveryEntregaConfirmModal from './components/DeliveryEntregaConfirmModal';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { printKitchenTicket } from '@/pages/pdv/caixa/components/CozinhaTicketPrint';
import type { DestinoInfo, CarrinhoItem } from '@/contexts/PDVContext';

type ModalType = 'none' | 'cliente' | 'confirmar_entrega' | 'pagamento';

interface PedidoFinalizado {
  id: string;
  numero: string;
  cliente: ClienteDelivery | null;
  itens: Array<{ nome: string; quantidade: number; preco: number }>;
  total: number;
  taxaEntrega: number;
  horario: string;
  pagamentos: Array<{ forma: string; valor: number; troco?: number }>;
}

let _cartCounter = 0;

export default function PDVDeliveryPage() {
  const { estado, sessao, caixa, loadingSession } = useSessao();
  const navigate = useNavigate();
  const { setMode } = useAppMode();
  const { user } = useAuth();
  const { settings } = useSystemSettings();
  const { submitOrder } = useOrderSubmit();
  const { getImpressoraParaEstacao, mapaEstacoes } = useImpressoras();

  // Impressão de delivery pode ser desativada nas configurações
  // settings.delivery_print_enabled: se false, não imprime nada
  const deliveryPrintEnabled = (settings as Record<string, unknown>).delivery_print_enabled as boolean ?? false;

  const [carrinho, setCarrinho] = useState<DeliveryCarrinhoItem[]>([]);
  const [taxaEntrega, setTaxaEntrega] = useState(0);
  const [cliente, setCliente] = useState<ClienteDelivery | null>(null);
  const [modal, setModal] = useState<ModalType>('none');
  const [pedidosFinalizados, setPedidosFinalizados] = useState<PedidoFinalizado[]>([]);
  const [sucesso, setSucesso] = useState<PedidoFinalizado | null>(null);
  const [tabRight, setTabRight] = useState<'carrinho' | 'historico'>('carrinho');
  const [clock] = useState(() => new Date());
  const [salvando, setSalvando] = useState(false);

  // ─── Handlers do carrinho ───
  const handleAdd = useCallback((ci: Omit<DeliveryCarrinhoItem, 'cartId'>) => {
    _cartCounter += 1;
    setCarrinho((prev) => [...prev, { ...ci, cartId: `dc-${_cartCounter}` }]);
  }, []);

  const handleRemover = useCallback((cartId: string) => {
    setCarrinho((prev) => prev.filter((c) => c.cartId !== cartId));
  }, []);

  const handleAlterarQty = useCallback((cartId: string, delta: number) => {
    setCarrinho((prev) =>
      prev.map((c) => c.cartId === cartId ? { ...c, quantidade: Math.max(1, c.quantidade + delta) } : c)
    );
  }, []);

  const handleLimpar = useCallback(() => {
    setCarrinho([]);
    setCliente(null);
    setTaxaEntrega(0);
  }, []);

  const subtotal = useMemo(() => carrinho.reduce((acc, ci) => acc + ci.precoUnitario * ci.quantidade, 0), [carrinho]);
  const total = subtotal + taxaEntrega;

  // ─── Criar pedido no banco ────────────────────────────────────────────────
  const criarPedidoBanco = useCallback(async (): Promise<{ orderId: string; orderNumber: string } | null> => {
    if (!sessao || !user || carrinho.length === 0) return null;

    const plataformaLabel = cliente
      ? (PLATAFORMAS_DELIVERY.find((p) => p.key === cliente.plataforma)?.label ?? cliente.plataforma)
      : 'Delivery';

    const itensPayload = carrinho.map((ci) => ({
      item_id: ci.itemId && /^[0-9a-f-]{36}$/i.test(ci.itemId) ? ci.itemId : null,
      item_name: ci.itemNome,
      item_price: ci.precoUnitario,
      quantity: ci.quantidade,
      station_id: null,
      // Pedidos de delivery NÃO vão para o KDS — já chegam prontos do app externo
      skip_kds: true,
      notes: ci.observacaoLivre || null,
      options: ci.opcoesSelecionadas.map((o) => ({
        option_id: o.opcaoId && /^[0-9a-f-]{36}$/i.test(o.opcaoId) ? o.opcaoId : null,
        option_name: o.opcaoNome,
        group_name: o.grupoNome,
        additional_price: o.precoAdicional,
      })),
      observations: [
        ...(ci.observacaoLivre ? [{ text: ci.observacaoLivre }] : []),
        ...(ci.observacoes ?? []).map((t) => ({ text: t })),
      ],
    }));

    // Monta observação com número do pedido externo se houver
    const obsExtra = [
      cliente?.numeroPedidoExterno ? `Pedido ${plataformaLabel} #${cliente.numeroPedidoExterno}` : null,
      cliente?.observacaoPedido || null,
    ].filter(Boolean).join(' | ');

    try {
      const result = await submitOrder({
        session_id: sessao.id,
        tenant_id: user.tenantId,
        origin: 'delivery',
        destination: 'delivery',
        destination_name: cliente?.nome ?? plataformaLabel,
        destination_phone: cliente?.telefone ?? null,
        delivery_address: cliente?.endereco
          ? `${cliente.endereco}${cliente.complemento ? `, ${cliente.complemento}` : ''}`
          : null,
        delivery_fee: taxaEntrega,
        customer_name: cliente?.nome ?? null,
        table_number: null,
        waiter_name: obsExtra || null,
        items: itensPayload,
        discount_amount: 0,
        service_fee_amount: taxaEntrega,
        subtotal,
        total_amount: total,
        is_training: user.modoTreino ?? false,
        // Plataforma de delivery para relatórios
        delivery_platform: cliente?.plataforma ?? null,
      }, { stationToImpressoraId: mapaEstacoes });

      return { orderId: result.id, orderNumber: result.number };
    } catch (err) {
      console.error('[PDVDelivery] criarPedidoBanco falhou:', err);
      return null;
    }
  }, [sessao, user, carrinho, cliente, taxaEntrega, subtotal, total, submitOrder]);

  // ─── Registrar pagamento ──────────────────────────────────────────────────
  const registrarPagamento = useCallback(async (
    orderId: string,
    pagamentos: Array<{ formaId: string; forma: string; valor: number; troco?: number }>,
  ): Promise<void> => {
    if (!user || !sessao) return;

    let cashRegisterId: string | null = caixa?.id ?? null;
    if (!cashRegisterId) {
      try {
        const { data: crData } = await supabase
          .from('cash_registers')
          .select('id')
          .eq('session_id', sessao.id)
          .eq('status', 'open')
          .order('opened_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        cashRegisterId = crData?.id ?? null;
      } catch (e) {
        console.warn('[PDVDelivery] Erro ao buscar caixa:', e);
      }
    }

    for (const pgto of pagamentos) {
      if (!pgto.formaId) continue;
      try {
        await invokeWithAuth('order-write', {
          body: {
            action: 'record_payment',
            order_id: orderId,
            tenant_id: user.tenantId,
            cash_register_id: cashRegisterId,
            payment_method_id: pgto.formaId,
            amount: pgto.valor,
            change_amount: pgto.troco ?? 0,
            operator_name: user.nome ?? null,
            paid_by_pdv: 'delivery',
          },
        });
        // Salva PDV que confirmou pagamento
        supabase.rpc('fn_update_paid_by_pdv', { p_order_id: orderId, p_paid_by_pdv: 'delivery' }).catch(() => {});
      } catch (e) {
        console.error('[PDVDelivery] record_payment error:', e);
      }
    }
  }, [user, sessao, caixa]);

  // ─── Finalizar pedido ─────────────────────────────────────────────────────
  const handleFinalizar = useCallback(async (
    pagamentos: Array<{ formaId: string; forma: string; valor: number; troco?: number }>,
  ) => {
    if (carrinho.length === 0 || salvando) return;

    setSalvando(true);
    try {
      const horario = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

      const result = await criarPedidoBanco();
      if (!result) {
        setSalvando(false);
        return;
      }

      const { orderId, orderNumber } = result;

      // Registra pagamento
      if (pagamentos.length > 0) {
        await registrarPagamento(orderId, pagamentos);
      }

      // Impressão automática de ticket de cozinha para delivery (se habilitado)
      if (settings.print_kds_enabled && carrinho.length > 0) {
        try {
          const mappedCarrinho: CarrinhoItem[] = carrinho.map((ci) => ({
            cartId: ci.cartId,
            itemId: ci.itemId,
            nome: ci.itemNome,
            precoBase: ci.itemPreco,
            precoTotal: ci.precoUnitario,
            quantidade: ci.quantidade,
            opcoes: ci.opcoesSelecionadas.map((o) => ({
              grupoNome: o.grupoNome,
              opcaoNome: o.opcaoNome,
              precoAdicional: o.precoAdicional,
            })),
            observacoes: ci.observacoes,
            observacaoLivre: ci.observacaoLivre,
            semPreparo: ci.semPreparo ?? false,
            stationId: ci.stationId,
          }));
          const seq = parseInt(orderNumber.replace(/\D/g, '').slice(-4)) || 1;
          const primeiroItem = mappedCarrinho.find((i) => i.stationId);
          const estacao = primeiroItem?.stationId ?? 'cozinha-padrao';
          const impressora = getImpressoraParaEstacao(estacao);
          const destinoPrint: DestinoInfo = {
            tipo: 'delivery',
            nomeCliente: cliente?.nome ?? 'Delivery',
          };
          await printKitchenTicket(seq, mappedCarrinho, destinoPrint, impressora, true);
        } catch (e) {
          console.warn('[PDVDelivery] Erro ao imprimir ticket de cozinha (non-blocking):', e);
        }
      }

      // Impressão: só imprime se delivery_print_enabled = true nas configurações
      if (deliveryPrintEnabled) {
        // Impressão habilitada — o sistema de impressão padrão cuida disso
        console.log('[PDVDelivery] Impressão habilitada para delivery');
      }

      const pedidoFinalizado: PedidoFinalizado = {
        id: orderId,
        numero: orderNumber,
        cliente,
        itens: carrinho.map((ci) => ({
          nome: ci.itemNome,
          quantidade: ci.quantidade,
          preco: ci.precoUnitario * ci.quantidade,
        })),
        total,
        taxaEntrega,
        horario,
        pagamentos: pagamentos.map((p) => ({ forma: p.forma, valor: p.valor, troco: p.troco })),
      };

      setPedidosFinalizados((prev) => [pedidoFinalizado, ...prev]);
      setSucesso(pedidoFinalizado);
      setCarrinho([]);
      setCliente(null);
      setTaxaEntrega(0);
      setModal('none');
    } finally {
      setSalvando(false);
    }
  }, [carrinho, cliente, total, taxaEntrega, salvando, criarPedidoBanco, registrarPagamento, deliveryPrintEnabled, settings.print_kds_enabled, getImpressoraParaEstacao, printKitchenTicket]);

  // ─── Gate: sem sessão ─────────────────────────────────────────────────────
  if (loadingSession) {
    return (
      <div
        className="flex flex-col h-full items-center justify-center p-8 text-center relative overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full opacity-30"
            style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
          <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        </div>
        <div className="relative z-10 bg-white/70 backdrop-blur-sm border border-zinc-200 rounded-2xl p-8 flex flex-col items-center max-w-xs w-full">
          <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-5">
            <i className="ri-loader-4-line animate-spin text-3xl text-amber-500" />
          </div>
          <h2 className="text-xl font-black text-zinc-900 mb-2">Verificando sessão...</h2>
          <p className="text-zinc-500 text-sm max-w-xs">Aguarde enquanto confirmamos a sessão ativa.</p>
          <div className="mt-5 flex items-center gap-2 px-4 py-2 bg-white/80 border border-zinc-200 rounded-full backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <span className="text-zinc-500 text-xs font-medium">Verificando...</span>
          </div>
        </div>
      </div>
    );
  }

  if (estado === 'sem_sessao') {
    return (
      <div
        className="flex flex-col h-full items-center justify-center p-8 text-center relative overflow-hidden"
        style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
      >
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-24 -left-24 w-72 h-72 rounded-full opacity-30"
            style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
          <div className="absolute -bottom-24 -right-24 w-80 h-80 rounded-full opacity-20"
            style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
        </div>
        <div className="relative z-10 bg-white/70 backdrop-blur-sm border border-zinc-200 rounded-2xl p-8 flex flex-col items-center max-w-xs w-full">
          <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-5">
            <i className="ri-lock-line text-3xl text-amber-500" />
          </div>
          <h2 className="text-xl font-black text-zinc-900 mb-2">PDV Delivery Offline</h2>
          <p className="text-zinc-500 text-sm max-w-xs">Abra uma sessão no PDV Caixa para liberar o terminal de Delivery.</p>
          <div className="mt-5 flex items-center gap-2 px-4 py-2 bg-white/80 border border-zinc-200 rounded-full backdrop-blur-sm">
            <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
            <span className="text-zinc-500 text-xs font-medium">Aguardando sessão...</span>
          </div>
          <button
            onClick={() => { setMode('modulos'); navigate('/modulos'); }}
            className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
          >
            <i className="ri-arrow-left-line text-sm" />
            Voltar aos Módulos
          </button>
        </div>
      </div>
    );
  }

  const plataformaAtual = cliente
    ? PLATAFORMAS_DELIVERY.find((p) => p.key === cliente.plataforma)
    : null;

  return (
    <div
      className="flex h-full overflow-hidden relative"
      style={{ background: 'radial-gradient(ellipse at 20% 0%, #fff8ed 0%, #fafaf9 40%, #f5f5f4 100%)' }}
    >
      {/* Orbs decorativos */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-20 -left-20 w-64 h-64 rounded-full opacity-20"
          style={{ background: 'radial-gradient(circle, #fbbf24 0%, transparent 70%)' }} />
        <div className="absolute bottom-0 -right-32 w-80 h-80 rounded-full opacity-15"
          style={{ background: 'radial-gradient(circle, #f97316 0%, transparent 70%)' }} />
      </div>

      {/* Modais */}
      {modal === 'cliente' && (
        <DeliveryClienteModal
          initial={cliente}
          onConfirm={(c) => { setCliente(c); setModal('none'); }}
          onConfirmAndNext={(c) => { setCliente(c); setModal('confirmar_entrega'); }}
          onClose={() => setModal('none')}
        />
      )}
      {modal === 'confirmar_entrega' && (
        <DeliveryEntregaConfirmModal
          taxaEntrega={taxaEntrega}
          subtotal={subtotal}
          total={total}
          plataforma={cliente?.plataforma}
          numeroPedido={cliente?.numeroPedidoExterno}
          onConfirm={(taxaFinal) => { setTaxaEntrega(taxaFinal); setModal('pagamento'); }}
          onEditar={() => setModal('none')}
          onClose={() => setModal('none')}
        />
      )}
      {modal === 'pagamento' && (
        <DeliveryPagamentoModal
          total={total}
          nomeCliente={
            cliente?.numeroPedidoExterno
              ? `${plataformaAtual?.label ?? 'Delivery'} #${cliente.numeroPedidoExterno}`
              : (cliente?.nome || plataformaAtual?.label || 'Delivery')
          }
          onConfirm={handleFinalizar}
          onClose={() => setModal('none')}
        />
      )}

      {/* Modal de sucesso */}
      {sucesso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSucesso(null)}>
          <div className="bg-white rounded-2xl w-full max-w-sm mx-4 p-6 text-center" onClick={(e) => e.stopPropagation()}>
            <div className="w-16 h-16 flex items-center justify-center bg-green-100 rounded-2xl mx-auto mb-4">
              <i className="ri-check-double-line text-3xl text-green-600" />
            </div>
            <h3 className="text-xl font-black text-zinc-900 mb-1">Pedido Registrado!</h3>
            <p className="text-zinc-500 text-sm mb-1">{sucesso.numero} · {sucesso.horario}</p>

            {sucesso.cliente && (
              <div className="bg-zinc-50 rounded-xl p-3 mb-3 text-left">
                {(() => {
                  const plat = PLATAFORMAS_DELIVERY.find((p) => p.key === sucesso.cliente?.plataforma);
                  return (
                    <div className="flex items-center gap-2 mb-1">
                      <div className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs ${plat?.cor ?? 'bg-zinc-100 text-zinc-500'}`}>
                        <i className={plat?.icon ?? 'ri-store-2-line'} />
                      </div>
                      <span className="text-xs font-bold text-zinc-700">{plat?.label ?? sucesso.cliente.plataforma}</span>
                      {sucesso.cliente.numeroPedidoExterno && (
                        <span className="text-[10px] font-semibold bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded-full">
                          #{sucesso.cliente.numeroPedidoExterno}
                        </span>
                      )}
                    </div>
                  );
                })()}
                {sucesso.cliente.nome && sucesso.cliente.nome !== 'Cliente' && (
                  <p className="text-xs font-bold text-zinc-600">{sucesso.cliente.nome}</p>
                )}
                {sucesso.cliente.endereco && (
                  <p className="text-xs text-zinc-400 mt-0.5">
                    <i className="ri-map-pin-line mr-0.5" />{sucesso.cliente.endereco}
                  </p>
                )}
              </div>
            )}

            <div className="bg-zinc-50 rounded-xl p-3 mb-4 text-left space-y-1">
              {sucesso.itens.map((item, i) => (
                <div key={i} className="flex justify-between text-xs">
                  <span className="text-zinc-600">{item.quantidade}x {item.nome}</span>
                  <span className="font-semibold text-zinc-800">R$ {item.preco.toFixed(2)}</span>
                </div>
              ))}
              {sucesso.taxaEntrega > 0 && (
                <div className="border-t border-zinc-200 pt-1 flex justify-between text-xs text-zinc-500">
                  <span>Custo de entrega</span>
                  <span>R$ {sucesso.taxaEntrega.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between text-sm font-black text-zinc-900 border-t border-zinc-200 pt-1">
                <span>Total</span>
                <span>R$ {sucesso.total.toFixed(2)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 p-2.5 bg-emerald-50 border border-emerald-200 rounded-xl mb-4">
              <i className="ri-check-line text-emerald-500 text-sm" />
              <p className="text-xs text-emerald-700 text-left">
                Registrado nos relatórios, financeiro e estoque atualizado.
                {!deliveryPrintEnabled && ' Impressão desativada para delivery.'}
              </p>
            </div>

            <button
              onClick={() => setSucesso(null)}
              className="w-full py-3 bg-zinc-800 hover:bg-zinc-900 text-white font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors text-sm"
            >
              Novo Pedido
            </button>
          </div>
        </div>
      )}

      {/* Overlay de salvando */}
      {salvando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl px-8 py-6 flex items-center gap-4">
            <i className="ri-loader-4-line animate-spin text-amber-500 text-2xl" />
            <span className="text-sm font-semibold text-zinc-700">Registrando pedido...</span>
          </div>
        </div>
      )}

      {/* LEFT: Cardápio */}
      <div className="relative z-10 flex flex-col flex-1 min-w-0 overflow-hidden bg-white/70 backdrop-blur-sm border-r border-zinc-200/80">
        {/* Top bar */}
        <div className="flex items-center justify-between px-4 py-3 bg-white border-b border-zinc-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <button
              onClick={() => { setMode('modulos'); navigate('/modulos'); }}
              title="Voltar aos Módulos"
              className="w-8 h-8 flex items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 hover:bg-zinc-100 text-zinc-500 hover:text-zinc-700 cursor-pointer transition-colors flex-shrink-0"
            >
              <i className="ri-arrow-left-line text-sm" />
            </button>
            <div className="w-px h-4 bg-zinc-200 flex-shrink-0" />
            <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border border-amber-200 rounded-full">
              <i className="ri-motorbike-line text-amber-600 text-sm" />
              <span className="text-xs font-bold text-amber-700">PDV Delivery</span>
            </div>
            {sessao && <span className="text-xs text-zinc-400 font-medium">{sessao.numero}</span>}
            <span className="text-[10px] font-semibold text-zinc-500 bg-zinc-100 px-2 py-0.5 rounded-full flex items-center gap-1">
              <i className="ri-skip-forward-line text-[9px]" />
              Sem KDS
            </span>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-1.5">
                <div className="w-6 h-6 flex items-center justify-center rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white text-[9px] font-black">
                  {user.nome.charAt(0)}
                </div>
                <span className="text-xs text-zinc-600 font-medium">{user.nome}</span>
              </div>
            )}
            <span className="text-xs font-bold text-zinc-700 tabular-nums">
              {clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        <DeliveryItemGrid onAdd={handleAdd} />
      </div>

      {/* RIGHT: Carrinho + Histórico */}
      <div className="relative z-10 w-80 xl:w-96 flex-shrink-0 flex flex-col bg-white/80 backdrop-blur-sm border-l border-zinc-200/60">
        {/* Tab switcher */}
        <div className="flex border-b border-zinc-100 bg-white/60 flex-shrink-0">
          <button
            onClick={() => setTabRight('carrinho')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${tabRight === 'carrinho' ? 'bg-white text-amber-600 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <i className="ri-shopping-cart-line mr-1" />Carrinho
            {carrinho.length > 0 && (
              <span className="ml-1 text-[9px] font-black bg-amber-500 text-white px-1.5 py-0.5 rounded-full">{carrinho.length}</span>
            )}
          </button>
          <button
            onClick={() => setTabRight('historico')}
            className={`flex-1 py-2.5 text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${tabRight === 'historico' ? 'bg-white text-amber-600 border-b-2 border-amber-500' : 'text-zinc-500 hover:text-zinc-700'}`}
          >
            <i className="ri-history-line mr-1" />Pedidos
            {pedidosFinalizados.length > 0 && (
              <span className="ml-1 text-[9px] font-black bg-zinc-200 text-zinc-600 px-1.5 py-0.5 rounded-full">{pedidosFinalizados.length}</span>
            )}
          </button>
        </div>

        <div className="flex-1 overflow-hidden">
          {tabRight === 'carrinho' ? (
            <DeliveryCarrinho
              carrinho={carrinho}
              taxaEntrega={taxaEntrega}
              cliente={cliente}
              onRemover={handleRemover}
              onAlterarQty={handleAlterarQty}
              onSetCliente={() => setModal('cliente')}
              onSetTaxa={setTaxaEntrega}
              onFinalizar={() => setModal('confirmar_entrega')}
              onLimpar={handleLimpar}
            />
          ) : (
            /* Histórico de pedidos da sessão */
            <div className="flex flex-col h-full overflow-hidden">
              <div className="px-4 py-3 border-b border-zinc-50 flex-shrink-0 flex items-center justify-between">
                <span className="text-xs font-bold text-zinc-600">Pedidos da sessão</span>
                <span className="text-[10px] text-zinc-400">{pedidosFinalizados.length} pedido(s)</span>
              </div>
              <div className="flex-1 overflow-y-auto divide-y divide-zinc-50">
                {pedidosFinalizados.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-12 text-center">
                    <i className="ri-inbox-2-line text-3xl text-zinc-200 mb-2" />
                    <p className="text-sm text-zinc-400">Nenhum pedido ainda</p>
                  </div>
                ) : (
                  pedidosFinalizados.map((p) => {
                    const plat = p.cliente ? PLATAFORMAS_DELIVERY.find((x) => x.key === p.cliente?.plataforma) : null;
                    return (
                      <div key={p.id} className="px-4 py-3 hover:bg-zinc-50 transition-colors">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-zinc-800">{p.numero}</span>
                              <span className="text-[10px] text-zinc-400">{p.horario}</span>
                              {plat && (
                                <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${plat.cor}`}>
                                  {plat.label}
                                </span>
                              )}
                            </div>
                            {p.cliente?.numeroPedidoExterno && (
                              <p className="text-[10px] text-zinc-500 font-semibold mt-0.5">
                                #{p.cliente.numeroPedidoExterno}
                              </p>
                            )}
                            {p.cliente?.nome && p.cliente.nome !== 'Cliente' && (
                              <p className="text-xs text-zinc-600 font-medium mt-0.5">{p.cliente.nome}</p>
                            )}
                            <p className="text-[10px] text-zinc-400 mt-1">
                              {p.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ')}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <span className="text-sm font-black text-zinc-800">R$ {p.total.toFixed(2)}</span>
                            <div className="flex flex-wrap gap-1 mt-1 justify-end">
                              {p.pagamentos.map((pg, i) => (
                                <span key={i} className="text-[9px] font-semibold bg-zinc-100 text-zinc-600 px-1.5 py-0.5 rounded-full">{pg.forma}</span>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
              {pedidosFinalizados.length > 0 && (
                <div className="px-4 py-3 border-t border-zinc-100 flex-shrink-0 flex items-center justify-between bg-zinc-50">
                  <span className="text-xs text-zinc-500">Total da sessão</span>
                  <span className="text-sm font-black text-zinc-800">
                    R$ {pedidosFinalizados.reduce((acc, p) => acc + p.total, 0).toFixed(2)}
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

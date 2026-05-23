import { createContext, useContext, useState, useCallback, useEffect, ReactNode } from 'react';
import { invokeWithAuth, supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from './SessaoContext';
import { useEstoque } from './EstoqueContext';
import { useKDS } from './KDSContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useOrderSubmit } from '@/hooks/useOrderSubmit';
import { useOffline } from '@/contexts/OfflineContext';
import { useImpressoras } from '@/contexts/ImpressorasContext';
import { useMesas } from '@/contexts/MesasContext';
import { printKitchenTicket } from '@/pages/pdv/caixa/components/CozinhaTicketPrint';

export interface OpcaoSelecionada {
  grupoId: string;
  grupoNome: string;
  opcaoId: string;
  opcaoNome: string;
  precoAdicional: number;
}

export interface CarrinhoItem {
  cartId: string;
  itemId: string;
  nome: string;
  categoriaNome?: string;
  precoBase: number;
  precoTotal: number;
  quantidade: number;
  opcoes: OpcaoSelecionada[];
  observacoes: string[];
  observacaoLivre: string;
  /** Per-unit observations: index = unit number (0-based), value = obs text */
  obsUnidades?: string[];
  semPreparo?: boolean;
  stationId?: string;
}

export type DestinoType = 'hora' | 'mesa' | 'delivery' | 'nome' | 'senha';

export interface DestinoInfo {
  tipo: DestinoType;
  mesaId?: string;
  mesaNumero?: number;
  nomeCliente?: string;
  telefone?: string;
  senha?: string;
  enderecoEntrega?: string;
  taxaEntrega?: number;
  observacaoPedido?: string;
}

export interface PagamentoItem {
  formaId: string;
  formaNome: string;
  valor: number;
  troco?: number;
}

interface PDVContextData {
  carrinho: CarrinhoItem[];
  destino: DestinoInfo | null;
  desconto: number;
  taxaServico: boolean;
  numeroPedidoSeq: number;
  ultimoNumeroPedido: string;
  pedidosPagos: Set<number>;
  addItem: (item: Omit<CarrinhoItem, 'cartId'>) => void;
  updateItemQty: (cartId: string, delta: number) => void;
  removeItem: (cartId: string) => void;
  updateItemObs: (cartId: string, obs: string) => void;
  clearCart: () => void;
  setDestino: (d: DestinoInfo | null) => void;
  setDesconto: (v: number) => void;
  toggleTaxaServico: () => void;
  marcarComoPago: (numero: number) => void;
  subtotal: number;
  valorDesconto: number;
  valorTaxaServico: number;
  total: number;
  finalizarPedido: (pagamentos: PagamentoItem[], customerData?: { customerCpf?: string; customerEmail?: string }) => Promise<string>;
  enviarParaCozinha: (destinoOverride?: DestinoInfo | null) => Promise<string>;
}

const PDVContext = createContext<PDVContextData | null>(null);
let cartCounter = 0;

function PDVProviderInner({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { sessao, caixa, gerarProximoNumeroPedido } = useSessao();
  const { deductSaleItems } = useEstoque();
  const { reloadOrders } = useKDS();
  const { settings: sysSettings } = useSystemSettings();
  const { submitOrder } = useOrderSubmit();
  const { refreshPendingCount } = useOffline();
  const { getImpressoraParaEstacao } = useImpressoras();
  const { mesas } = useMesas();

  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([]);
  const [destino, setDestino] = useState<DestinoInfo | null>(null);
  const [desconto, setDesconto] = useState(0);
  // Inicializa taxaServico com o valor atual das settings (e sincroniza quando muda)
  const [taxaServico, setTaxaServico] = useState(() => sysSettings.service_fee_enabled ?? false);
  const [numeroPedidoSeq, setNumeroPedidoSeq] = useState(0);
  const [ultimoNumeroPedido, setUltimoNumeroPedido] = useState('—');
  const [pedidosPagos, setPedidosPagos] = useState<Set<number>>(new Set());

  // Quando a config de taxa de serviço mudar no banco, reflete no toggle do carrinho
  // (só sincroniza se o carrinho estiver vazio, para não surpreender o operador no meio de um pedido)
  useEffect(() => {
    if (carrinho.length === 0) {
      setTaxaServico(sysSettings.service_fee_enabled ?? false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sysSettings.service_fee_enabled]);

  const marcarComoPago = useCallback((numero: number) => {
    setPedidosPagos((prev) => new Set(prev).add(numero));
  }, []);

  const taxaServicoPct = (sysSettings.service_fee_percentage ?? 10) / 100;
  const subtotal = carrinho.reduce((acc, i) => acc + i.precoTotal * i.quantidade, 0);
  const valorDesconto = Math.min(desconto, subtotal);
  const valorTaxaServico = taxaServico ? (subtotal - valorDesconto) * taxaServicoPct : 0;
  const total = subtotal - valorDesconto + valorTaxaServico;

  const addItem = useCallback((item: Omit<CarrinhoItem, 'cartId'>) => {
    setCarrinho((prev) => {
      // Tenta encontrar um item idêntico no carrinho para somar a quantidade
      // Critérios: mesmo itemId, mesmas opções (mesma combinação), mesma obs livre, sem obsUnidades
      const existingIdx = prev.findIndex((ci) => {
        if (ci.itemId !== item.itemId) return false;
        if (ci.observacaoLivre !== item.observacaoLivre) return false;
        // Não agrupa se tem obs por unidade
        if (ci.obsUnidades && ci.obsUnidades.some((o) => o && o.trim() !== '')) return false;
        if (item.obsUnidades && item.obsUnidades.some((o) => o && o.trim() !== '')) return false;
        // Compara opções selecionadas (mesma quantidade e mesmos ids)
        if (ci.opcoes.length !== item.opcoes.length) return false;
        const opcoesMatch = item.opcoes.every((op) =>
          ci.opcoes.some((co) => co.opcaoId === op.opcaoId && co.grupoId === op.grupoId),
        );
        if (!opcoesMatch) return false;
        // Compara observações padrão
        if (ci.observacoes.length !== item.observacoes.length) return false;
        const obsMatch = item.observacoes.every((o) => ci.observacoes.includes(o));
        return obsMatch;
      });

      if (existingIdx >= 0) {
        // Item idêntico encontrado → soma a quantidade
        return prev.map((ci, idx) =>
          idx === existingIdx
            ? { ...ci, quantidade: ci.quantidade + item.quantidade }
            : ci,
        );
      }

      // Item novo → adiciona ao carrinho
      cartCounter += 1;
      return [...prev, { ...item, cartId: `cart-${cartCounter}` }];
    });
  }, []);

  const updateItemQty = useCallback((cartId: string, delta: number) => {
    setCarrinho((prev) =>
      prev.map((i) => (i.cartId === cartId ? { ...i, quantidade: i.quantidade + delta } : i))
        .filter((i) => i.quantidade > 0),
    );
  }, []);

  const removeItem = useCallback((cartId: string) => {
    setCarrinho((prev) => prev.filter((i) => i.cartId !== cartId));
  }, []);

  const updateItemObs = useCallback((cartId: string, obs: string) => {
    setCarrinho((prev) =>
      prev.map((i) => (i.cartId === cartId ? { ...i, observacaoLivre: obs } : i)),
    );
  }, []);

  const clearCart = useCallback(() => {
    setCarrinho([]);
    setDestino(null);
    setDesconto(0);
    // Resetar taxa de serviço para o valor padrão das configurações
    setTaxaServico(sysSettings.service_fee_enabled ?? false);
  }, [sysSettings.service_fee_enabled]);

  const toggleTaxaServico = useCallback(() => setTaxaServico((v) => !v), []);

  // ── Helper: monta payload dos itens para a edge function ────────────────
  const buildItemsPayload = useCallback(() => {
    const obsPedido = destino?.observacaoPedido;
    let obsPedidoAdded = false;

    return carrinho.flatMap((ci) => {
      const temObsUnidade = ci.obsUnidades && ci.obsUnidades.some((o) => o && o.trim() !== '');

      // Adiciona observação geral do pedido no primeiro item
      const obsPedidoExtra = !obsPedidoAdded && obsPedido
        ? [{ text: `[PEDIDO] ${obsPedido}` }]
        : [];
      if (!obsPedidoAdded && obsPedido) obsPedidoAdded = true;

      if (temObsUnidade && ci.quantidade > 1) {
        return Array.from({ length: ci.quantidade }, (_, unitIdx) => {
          const obsUnidade = ci.obsUnidades?.[unitIdx]?.trim() ?? '';
          const extraObs = unitIdx === 0 ? obsPedidoExtra : [];
          return {
            item_id: ci.itemId || null,
            item_name: ci.nome,
            item_price: ci.precoTotal,
            quantity: 1,
            station_id: ci.stationId ?? null,
            skip_kds: ci.semPreparo ?? false,
            notes: obsUnidade || ci.observacaoLivre || null,
            options: ci.opcoes.map((o) => ({
              option_id: o.opcaoId || null,
              option_name: o.opcaoNome,
              group_name: o.grupoNome,
              additional_price: o.precoAdicional,
            })),
            observations: [
              ...ci.observacoes.map((t) => ({ text: t })),
              ...(obsUnidade ? [{ text: `Un.${unitIdx + 1}: ${obsUnidade}` }] : []),
              ...extraObs,
            ],
          };
        });
      }

      const extraObs = !obsPedidoAdded && obsPedido
        ? [{ text: `[PEDIDO] ${obsPedido}` }]
        : [];
      if (!obsPedidoAdded && obsPedido) obsPedidoAdded = true;

      return [{
        item_id: ci.itemId || null,
        item_name: ci.nome,
        item_price: ci.precoTotal,
        quantity: ci.quantidade,
        station_id: ci.stationId ?? null,
        skip_kds: ci.semPreparo ?? false,
        notes: ci.observacaoLivre || null,
        options: ci.opcoes.map((o) => ({
          option_id: o.opcaoId || null,
          option_name: o.opcaoNome,
          group_name: o.grupoNome,
          additional_price: o.precoAdicional,
        })),
        observations: [
          ...ci.observacoes.map((t) => ({ text: t })),
          ...extraObs,
        ],
      }];
    });
  }, [carrinho, destino]);

  // ── Helper: executa baixa de estoque (usa carrinho snapshot) ────────────
  const executarBaixaEstoque = useCallback((orderId: string, snapshot: CarrinhoItem[]) => {
    const itensParaBaixa = snapshot
      .filter((ci) => ci.itemId && /^[0-9a-f-]{36}$/i.test(ci.itemId))
      .map((ci) => ({
        itemId: ci.itemId,
        nome: ci.nome,
        quantidade: ci.quantidade,
      }));
    if (itensParaBaixa.length > 0) {
      deductSaleItems(orderId, itensParaBaixa).catch((e) => {
        console.warn('[PDVContext] Stock deduction failed (non-blocking):', e);
      });
    }
  }, [deductSaleItems]);

  const finalizarPedido = useCallback(async (pagamentos: PagamentoItem[], customerData?: { customerCpf?: string; customerEmail?: string }): Promise<string> => {
    // Generate order number (async — increments sessions.last_order_number in DB)
    const numero = await gerarProximoNumeroPedido();
    setUltimoNumeroPedido(numero);
    setNumeroPedidoSeq((s) => s + 1);

    // If no session, just clear cart (offline/mock mode)
    if (!sessao || !user) {
      clearCart();
      return numero;
    }

    // Build items payload
    const itensPayload = buildItemsPayload();
    const carrinhoSnapshot = [...carrinho]; // snapshot antes de limpar

    // ── Pagamentos para modo offline ──────────────────────────────────────
    const offlinePayments = pagamentos
      .filter((p) => p.formaId)
      .map((p) => ({
        payment_method_id: p.formaId,
        amount: p.valor,
        change_amount: p.troco ?? 0,
      }));

    // Resolve table_session_id from mesas context when destination is mesa
    const tableSessionId = destino?.tipo === 'mesa' && destino.mesaId
      ? (mesas.find((m) => m.id === destino.mesaId)?.tableSessionId ?? null)
      : null;

    // ── 1. Criar pedido com retry automático (3 tentativas) ──────────────────
    const orderResult = await submitOrder({
      session_id: sessao.id,
      tenant_id: user.tenantId,
      destination: destino?.tipo ?? 'hora',
      destination_name: destino?.tipo === 'mesa'
        ? (destino?.nomeCliente ? `Mesa ${destino.mesaNumero} — ${destino.nomeCliente}` : `Mesa ${destino.mesaNumero}`)
        : (destino?.nomeCliente ?? destino?.senha ?? null),
      destination_phone: destino?.telefone ?? null,
      delivery_address: destino?.enderecoEntrega ?? null,
      delivery_fee: destino?.taxaEntrega ?? 0,
      origin: 'cashier',
      items: itensPayload,
      discount_amount: valorDesconto,
      service_fee_amount: valorTaxaServico,
      subtotal,
      total_amount: total,
      cash_register_id: caixa?.id ?? null,
      is_training: user.modoTreino,
      customer_cpf: customerData?.customerCpf ?? null,
      customer_email: customerData?.customerEmail ?? null,
      table_number: destino?.tipo === 'mesa' ? destino.mesaNumero ?? null : null,
      customer_name: destino?.tipo === 'mesa' ? destino?.nomeCliente ?? null : null,
      table_session_id: tableSessionId,
    }, {
      offlinePayments,
    });

    const orderId: string = orderResult.id;
    const isOffline = orderResult.isOffline ?? false;
    const cashRegisterId: string | null = caixa?.id ?? null;

    // ── 2. Pedido criado com sucesso — limpa carrinho AGORA ──────────────────
    clearCart();

    // ── 3. Se foi salvo offline, atualiza contador de pendentes ─────────────
    if (isOffline) {
      refreshPendingCount();
      return orderResult.number;
    }

    // ── Validar se orderId é UUID real (não local/offline) ───────────────────
    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    if (!isValidUuid) {
      console.warn('[PDVContext] orderId inválido (não-UUID) — pulando registro de pagamentos:', orderId);
      return numero;
    }

    // ── 4. Registrar desconto se houver — best effort ────────────────────────
    if (orderId && valorDesconto > 0) {
      try {
        const { error: discErr } = await invokeWithAuth('order-write', {
          body: {
            action: 'apply_discount',
            order_id: orderId,
            tenant_id: user.tenantId,
            discount_type: 'manual_value',
            discount_value: valorDesconto,
            requires_approval: true,
            new_discount_amount: valorDesconto,
            new_total_amount: total,
            reason: 'Desconto autorizado no PDV Caixa',
          },
        });
        if (discErr) console.warn('[PDVContext] apply_discount error (non-blocking):', discErr);
      } catch (e) {
        console.warn('[PDVContext] apply_discount exception (non-blocking):', e);
      }
    }

    // ── 5. Registrar pagamentos — best effort, não bloqueia o operador ───────
    if (orderId && cashRegisterId && pagamentos.length > 0) {
      let paymentRegistered = false;
      for (const pag of pagamentos) {
        if (!pag.formaId) continue;
        try {
          const { error: payErr } = await invokeWithAuth('order-write', {
            body: {
              action: 'record_payment',
              order_id: orderId,
              tenant_id: user.tenantId,
              cash_register_id: cashRegisterId,
              payment_method_id: pag.formaId,
              amount: pag.valor,
              change_amount: pag.troco ?? 0,
              operator_name: user.nome ?? null,
              paid_by_pdv: 'cashier',
            },
          });
          if (payErr) console.warn('[PDVContext] record_payment error (non-blocking):', payErr);
          else paymentRegistered = true;
        } catch (e) {
          console.warn('[PDVContext] record_payment exception (non-blocking):', e);
        }
      }
      // Salva o PDV que confirmou o pagamento
      if (paymentRegistered) {
        try {
          await supabase.rpc('fn_update_paid_by_pdv', { p_order_id: orderId, p_paid_by_pdv: 'cashier' });
        } catch (e) {
          console.warn('[PDVContext] fn_update_paid_by_pdv error (non-blocking):', e);
        }
      }
    } else if (orderId && pagamentos.length > 0) {
      console.warn('[PDVContext] Skipping record_payment — missing cash_register_id. Caixa must be open.');
    }

    // ── 6. Reload KDS e baixa de estoque — best effort ───────────────────────
    if (orderId) {
      setTimeout(() => reloadOrders(), 500);
      executarBaixaEstoque(orderId, carrinhoSnapshot);
    }

    return numero;
  }, [
    gerarProximoNumeroPedido, sessao, user, caixa,
    carrinho, destino, valorDesconto, valorTaxaServico,
    subtotal, total, clearCart, reloadOrders, submitOrder,
    refreshPendingCount, buildItemsPayload, executarBaixaEstoque, mesas,
  ]);

  // ── Enviar para Cozinha (sem pagamento — pagar depois) ───────────────────
  const enviarParaCozinha = useCallback(async (destinoOverride?: DestinoInfo | null): Promise<string> => {
    const numero = await gerarProximoNumeroPedido();
    setUltimoNumeroPedido(numero);
    setNumeroPedidoSeq((s) => s + 1);

    if (!sessao || !user) {
      clearCart();
      return numero;
    }

    // Usa o destino do override (modal) ou do estado
    const destinoAtivo = destinoOverride ?? destino;

    // Monta payload dos itens usando o destino ATIVO (não o estado que pode estar desatualizado)
    const obsPedido = destinoAtivo?.observacaoPedido;
    let obsPedidoAdded = false;
    const itensPayload = carrinho.flatMap((ci) => {
      const temObsUnidade = ci.obsUnidades && ci.obsUnidades.some((o) => o && o.trim() !== '');
      const obsPedidoExtra = !obsPedidoAdded && obsPedido ? [{ text: `[PEDIDO] ${obsPedido}` }] : [];
      if (!obsPedidoAdded && obsPedido) obsPedidoAdded = true;

      if (temObsUnidade && ci.quantidade > 1) {
        return Array.from({ length: ci.quantidade }, (_, unitIdx) => {
          const obsUnidade = ci.obsUnidades?.[unitIdx]?.trim() ?? '';
          const extraObs = unitIdx === 0 ? obsPedidoExtra : [];
          return {
            item_id: ci.itemId || null,
            item_name: ci.nome,
            item_price: ci.precoTotal,
            quantity: 1,
            station_id: ci.stationId ?? null,
            skip_kds: ci.semPreparo ?? false,
            notes: obsUnidade || ci.observacaoLivre || null,
            options: ci.opcoes.map((o) => ({
              option_id: o.opcaoId || null,
              option_name: o.opcaoNome,
              group_name: o.grupoNome,
              additional_price: o.precoAdicional,
            })),
            observations: [
              ...ci.observacoes.map((t) => ({ text: t })),
              ...(obsUnidade ? [{ text: `Un.${unitIdx + 1}: ${obsUnidade}` }] : []),
              ...extraObs,
            ],
          };
        });
      }

      const extraObs = !obsPedidoAdded && obsPedido
        ? [{ text: `[PEDIDO] ${obsPedido}` }]
        : [];
      if (!obsPedidoAdded && obsPedido) obsPedidoAdded = true;

      return [{
        item_id: ci.itemId || null,
        item_name: ci.nome,
        item_price: ci.precoTotal,
        quantity: ci.quantidade,
        station_id: ci.stationId ?? null,
        skip_kds: ci.semPreparo ?? false,
        notes: ci.observacaoLivre || null,
        options: ci.opcoes.map((o) => ({
          option_id: o.opcaoId || null,
          option_name: o.opcaoNome,
          group_name: o.grupoNome,
          additional_price: o.precoAdicional,
        })),
        observations: [
          ...ci.observacoes.map((t) => ({ text: t })),
          ...extraObs,
        ],
      }];
    });

    const carrinhoSnapshot = [...carrinho];

    // Resolve table_session_id from mesas context when destination is mesa
    const tableSessionId = destinoAtivo?.tipo === 'mesa' && destinoAtivo.mesaId
      ? (mesas.find((m) => m.id === destinoAtivo.mesaId)?.tableSessionId ?? null)
      : null;

    const orderResult = await submitOrder({
      session_id: sessao.id,
      tenant_id: user.tenantId,
      destination: destinoAtivo?.tipo ?? 'hora',
      destination_name: destinoAtivo?.tipo === 'mesa'
        ? (destinoAtivo?.nomeCliente ? `Mesa ${destinoAtivo.mesaNumero} — ${destinoAtivo.nomeCliente}` : `Mesa ${destinoAtivo.mesaNumero}`)
        : (destinoAtivo?.nomeCliente ?? destinoAtivo?.senha ?? null),
      destination_phone: destinoAtivo?.telefone ?? null,
      delivery_address: destinoAtivo?.enderecoEntrega ?? null,
      delivery_fee: destinoAtivo?.taxaEntrega ?? 0,
      origin: 'cashier',
      items: itensPayload,
      discount_amount: valorDesconto,
      service_fee_amount: valorTaxaServico,
      subtotal,
      total_amount: total,
      cash_register_id: caixa?.id ?? null,
      is_training: user.modoTreino,
      customer_cpf: null,
      customer_email: null,
      table_number: destinoAtivo?.tipo === 'mesa' ? destinoAtivo.mesaNumero ?? null : null,
      customer_name: destinoAtivo?.tipo === 'mesa' ? destinoAtivo?.nomeCliente ?? null : null,
      table_session_id: tableSessionId,
    }, {});

    const orderId: string = orderResult.id;
    const isOffline = orderResult.isOffline ?? false;

    clearCart();

    if (isOffline) {
      refreshPendingCount();
      return orderResult.number;
    }

    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    if (!isValidUuid) {
      return numero;
    }

    // Imprimir ticket de cozinha automaticamente ao enviar para o KDS via impressora mapeada
    try {
      const seq = parseInt(numero.replace(/\D/g, '').slice(-4)) || 1;
      const primeiroItem = carrinhoSnapshot.find((i) => i.stationId);
      const estacao = primeiroItem?.stationId ?? 'cozinha-padrao';
      const impressora = getImpressoraParaEstacao(estacao);
      await printKitchenTicket(seq, carrinhoSnapshot, destinoAtivo ?? null, impressora);
    } catch (e) {
      console.warn('[PDVContext] Erro ao imprimir ticket de cozinha (non-blocking):', e);
    }

    // Registrar desconto se houver (best effort)
    if (orderId && valorDesconto > 0) {
      try {
        const { error: discErr } = await invokeWithAuth('order-write', {
          body: {
            action: 'apply_discount',
            order_id: orderId,
            tenant_id: user.tenantId,
            discount_type: 'manual_value',
            discount_value: valorDesconto,
            requires_approval: true,
            new_discount_amount: valorDesconto,
            new_total_amount: total,
            reason: 'Desconto autorizado no PDV Caixa',
          },
        });
        if (discErr) console.warn('[PDVContext] apply_discount error (non-blocking):', discErr);
      } catch (e) {
        console.warn('[PDVContext] apply_discount exception (non-blocking):', e);
      }
    }

    // Reload KDS e baixa de estoque
    if (orderId) {
      setTimeout(() => reloadOrders(), 500);
      executarBaixaEstoque(orderId, carrinhoSnapshot);
    }

    return numero;
  }, [
    gerarProximoNumeroPedido, sessao, user, caixa,
    carrinho, destino, valorDesconto, valorTaxaServico,
    subtotal, total, clearCart, reloadOrders, submitOrder,
    refreshPendingCount, executarBaixaEstoque, mesas,
  ]);

  return (
    <PDVContext.Provider value={{
      carrinho, destino, desconto, taxaServico, numeroPedidoSeq,
      ultimoNumeroPedido, pedidosPagos,
      addItem, updateItemQty, removeItem, updateItemObs, clearCart,
      setDestino, setDesconto, toggleTaxaServico, marcarComoPago,
      subtotal, valorDesconto, valorTaxaServico, total,
      finalizarPedido, enviarParaCozinha,
    }}>
      {children}
    </PDVContext.Provider>
  );
}

export function PDVProvider({ children }: { children: ReactNode }) {
  return <PDVProviderInner>{children}</PDVProviderInner>;
}

export function usePDV() {
  const ctx = useContext(PDVContext);
  if (!ctx) throw new Error('usePDV must be used within PDVProvider');
  return ctx;
}

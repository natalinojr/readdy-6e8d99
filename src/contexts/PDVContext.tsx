import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { invokeWithAuth, supabase, ensureFreshSession } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSessao } from './SessaoContext';
import { useKDS } from './KDSContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import { useOrderSubmit, type CreateOrderPayload } from '@/hooks/useOrderSubmit';
import { useOffline } from '@/contexts/OfflineContext';
import { useMesas } from '@/contexts/MesasContext';
import { useToast } from './ToastContext';
import { useNavigate } from 'react-router-dom';
import { useImpressoras } from '@/contexts/ImpressorasContext';

export interface OpcaoSelecionada {
  grupoId: string;
  grupoNome: string;
  opcaoId: string;
  opcaoNome: string;
  precoAdicional: number;
  /** Se o grupo desta opção é obrigatório — quando true, NÃO exibir "+" no ticket/gestor */
  obrigatorio?: boolean;
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
  /** Partes de produção a destacar no ticket de cozinha (ex: ['hamburguer', 'batata']) */
  partesDestaque?: string[];
  /** Partes de produção do item para split de tickets por estação */
  subproducao?: Array<{ nome: string; estacaoId: string; estacao?: string }>;
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
  valorRecebido?: number;
}

export interface FinalizarResult {
  orderId: string;
  number: string;
  printEnqueued?: boolean;
  isOffline?: boolean;
}

interface PDVContextData {
  carrinho: CarrinhoItem[];
  destino: DestinoInfo | null;
  desconto: number;
  taxaServico: boolean;
  numeroPedidoSeq: number;
  ultimoNumeroPedido: string;
  senhaCounter: number;
  consumirSenha: () => Promise<number>;
  /** Cortesia ativa (pedido gratuito autorizado por gerente/admin) */
  isCortesia: boolean;
  cortesiaAutorizadaPor: string | null;
  cortesiaDestinatario: string | null;
  cortesiaMotivo: string | null;
  setCortesia: (ativa: boolean, autorizadoPor: string | null, destinatario?: string | null, motivo?: string | null) => void;
  clearCortesia: () => void;
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
  finalizarPedido: (pagamentos: PagamentoItem[], customerData?: { customerCpf?: string; customerEmail?: string; paymentGroupId?: string | null }) => Promise<FinalizarResult>;
  enviarParaCozinha: (destinoOverride?: DestinoInfo | null) => Promise<FinalizarResult>;
}

const PDVContext = createContext<PDVContextData | null>(null);
let cartCounter = 0;

function PDVProviderInner({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { sessao, caixa, gerarProximoNumeroPedido } = useSessao();
  const { reloadOrders } = useKDS();
  const { settings: sysSettings } = useSystemSettings();
  const { submitOrder } = useOrderSubmit();
  const { refreshPendingCount } = useOffline();
  const { mesas } = useMesas();
  const { mapaEstacoes } = useImpressoras();

  const [carrinho, setCarrinho] = useState<CarrinhoItem[]>([]);
  const [destino, setDestino] = useState<DestinoInfo | null>(null);
  const [desconto, setDesconto] = useState(0);
  const [taxaServico, setTaxaServico] = useState(() => sysSettings.service_fee_enabled ?? false);
  const [numeroPedidoSeq, setNumeroPedidoSeq] = useState(0);
  const [ultimoNumeroPedido, setUltimoNumeroPedido] = useState('—');
  const [pedidosPagos, setPedidosPagos] = useState<Set<number>>(new Set());
  const [isCortesia, setIsCortesia] = useState(false);
  const [cortesiaAutorizadaPor, setCortesiaAutorizadaPor] = useState<string | null>(null);
  const [cortesiaDestinatario, setCortesiaDestinatario] = useState<string | null>(null);
  const [cortesiaMotivo, setCortesiaMotivo] = useState<string | null>(null);

  // Contador de senha/comanda — inicia em 200 e incrementa a cada uso.
  // Gerido pelo backend (Supabase RPC) para ser consistente entre múltiplos PDVs.
  const [senhaCounter, setSenhaCounter] = useState(200);

  // No mount, busca o contador atual do backend (sem incrementar)
  useEffect(() => {
    if (!user?.tenantId) return;
    supabase.rpc('fn_peek_senha', { p_tenant_id: user.tenantId }).then(({ data, error }) => {
      if (!error && typeof data === 'number' && data >= 200) {
        setSenhaCounter(data);
      }
    });
  }, [user?.tenantId]);

  const consumirSenha = useCallback(async (): Promise<number> => {
    if (!user?.tenantId) {
      // Fallback offline: usa contador local
      const current = senhaCounter;
      setSenhaCounter((c) => c + 1);
      return current;
    }
    const { data, error } = await supabase.rpc('fn_next_senha', { p_tenant_id: user.tenantId });
    if (error) {
      console.warn('[PDVContext] Erro ao consumir senha:', error);
      // Fallback local em caso de erro de rede
      const current = senhaCounter;
      setSenhaCounter((c) => c + 1);
      return current;
    }
    const senha = typeof data === 'number' ? data : 200;
    // Atualiza o estado local para exibição da próxima senha
    setSenhaCounter(senha + 1);
    return senha;
  }, [user?.tenantId, senhaCounter]);

  useEffect(() => {
    setTaxaServico(sysSettings.service_fee_enabled ?? false);
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
      const existingIdx = prev.findIndex((ci) => {
        if (ci.itemId !== item.itemId) return false;
        if (ci.observacaoLivre !== item.observacaoLivre) return false;
        if (ci.obsUnidades && ci.obsUnidades.some((o) => o && o.trim() !== '')) return false;
        if (item.obsUnidades && item.obsUnidades.some((o) => o && o.trim() !== '')) return false;
        if (ci.opcoes.length !== item.opcoes.length) return false;
        const opcoesMatch = item.opcoes.every((op) =>
          ci.opcoes.some((co) => co.opcaoId === op.opcaoId && co.grupoId === op.grupoId),
        );
        if (!opcoesMatch) return false;
        if (ci.observacoes.length !== item.observacoes.length) return false;
        const obsMatch = item.observacoes.every((o) => ci.observacoes.includes(o));
        return obsMatch;
      });

      if (existingIdx >= 0) {
        return prev.map((ci, idx) =>
          idx === existingIdx
            ? { ...ci, quantidade: ci.quantidade + item.quantidade }
            : ci,
        );
      }

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
    setTaxaServico(sysSettings.service_fee_enabled ?? false);
    setIsCortesia(false);
    setCortesiaAutorizadaPor(null);
  }, [sysSettings.service_fee_enabled]);

  const toggleTaxaServico = useCallback(() => setTaxaServico((v) => !v), []);

  // ── Helper: monta payload dos itens para a edge function ────────────────
  const buildItemsPayload = useCallback(() => {
    const obsPedido = destino?.observacaoPedido;
    let obsPedidoAdded = false;

    return carrinho.flatMap((ci) => {
      const temObsUnidade = ci.obsUnidades && ci.obsUnidades.some((o) => o && o.trim() !== '');
      const obsPedidoExtra = !obsPedidoAdded && obsPedido
        ? [{ text: `[PEDIDO] ${obsPedido}` }]
        : [];
      if (!obsPedidoAdded && obsPedido) obsPedidoAdded = true;

      // Partes de produção pré-carregadas do contexto do cardápio (evita query RLS no print)
      const productionPartsPayload = ci.subproducao?.filter(sp => sp.estacaoId)
        .map(sp => ({ name: sp.nome, station_id: sp.estacaoId, station_name: sp.estacao })) ?? undefined;

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
            production_parts: productionPartsPayload,
            options: ci.opcoes.map((o) => ({
              option_id: o.opcaoId || null,
              option_name: o.opcaoNome,
              group_name: o.grupoNome,
              additional_price: o.precoAdicional,
              group_obrigatorio: o.obrigatorio,
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
        production_parts: productionPartsPayload,
        options: ci.opcoes.map((o) => ({
          option_id: o.opcaoId || null,
          option_name: o.opcaoNome,
          group_name: o.grupoNome,
          additional_price: o.precoAdicional,
          group_obrigatorio: o.obrigatorio,
        })),
        observations: [
          ...ci.observacoes.map((t) => ({ text: t })),
          ...extraObs,
        ],
      }];
    });
  }, [carrinho, destino]);

  const finalizarPedido = useCallback(async (pagamentos: PagamentoItem[], customerData?: { customerCpf?: string; customerEmail?: string; paymentGroupId?: string | null }): Promise<FinalizarResult> => {
    const freshSession = await ensureFreshSession();
    if (!freshSession) {
      throw new Error('Sessao de autenticacao expirada. Por favor, faca login novamente.');
    }

    // Gera número local APENAS para fallback de UI imediata (não é mais usado como retorno)
    const numeroLocal = await gerarProximoNumeroPedido();
    setUltimoNumeroPedido(numeroLocal);
    setNumeroPedidoSeq((s) => s + 1);

    if (!sessao || !user) {
      clearCart();
      return { orderId: 'local', number: numeroLocal };
    }

    const itensPayload = buildItemsPayload();

    const offlinePayments = pagamentos
      .filter((p) => p.formaId)
      .map((p) => ({
        payment_method_id: p.formaId,
        amount: p.valor,
        change_amount: p.troco ?? 0,
      }));

    const tableSessionId = destino?.tipo === 'mesa' && destino.mesaId
      ? (mesas.find((m) => m.id === destino.mesaId)?.tableSessionId ?? null)
      : null;

    // ── Cortesia: zeramos o total e aplicamos desconto total ──────────────
    const cortesiaAtiva = isCortesia;
    const cortesiaAutor = cortesiaAutorizadaPor;
    const cortesiaDest = cortesiaDestinatario;
    const cortesiaMot = cortesiaMotivo;
    const actualDesconto = cortesiaAtiva ? subtotal : valorDesconto;
    const actualTaxaServico = cortesiaAtiva ? 0 : valorTaxaServico;
    const actualTotal = cortesiaAtiva ? 0 : total;

    // ── Cortesia: monta notes estruturado ──
    let cortesiaNotesStr: string | null = null;
    if (cortesiaAtiva) {
      const parts: string[] = ['Cortesia'];
      if (cortesiaDest) parts.push(`Para: ${cortesiaDest}`);
      if (cortesiaMot) parts.push(`Motivo: ${cortesiaMot}`);
      parts.push(`Autorizado por: ${cortesiaAutor ?? 'Gerente'}`);
      cortesiaNotesStr = parts.join(' | ');
    }

    // Cria pedido — useOrderSubmit enfileira impressão automaticamente via fila centralizada
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
      discount_amount: actualDesconto,
      service_fee_amount: actualTaxaServico,
      subtotal,
      total_amount: actualTotal,
      cash_register_id: caixa?.id ?? null,
      is_training: user.modoTreino,
      customer_cpf: customerData?.customerCpf ?? null,
      customer_email: customerData?.customerEmail ?? null,
      table_number: destino?.tipo === 'mesa' ? destino.mesaNumero ?? null : null,
      customer_name: destino?.tipo === 'mesa' ? destino?.nomeCliente ?? null : null,
      table_session_id: tableSessionId,
      is_cortesia: cortesiaAtiva ? true : undefined,
      notes: cortesiaAtiva ? cortesiaNotesStr : undefined,
      cortesia_authorized_by: cortesiaAtiva ? (cortesiaAutor ?? undefined) : undefined,
    }, { offlinePayments, stationToImpressoraId: mapaEstacoes });

    const orderId: string = orderResult.id;
    const isOffline = orderResult.isOffline ?? false;
    const cashRegisterId: string | null = caixa?.id ?? null;

    clearCart();

    if (isOffline) {
      refreshPendingCount();
      return { orderId, number: orderResult.number, isOffline: true };
    }

    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    if (!isValidUuid) {
      console.warn('[PDVContext] orderId inválido (não-UUID) — pulando registro de pagamentos:', orderId);
      return { orderId, number: orderResult.number, printEnqueued: orderResult.printEnqueued };
    }

    if (orderId && actualDesconto > 0) {
      try {
        const { error: discErr } = await invokeWithAuth('order-write', {
          body: {
            action: 'apply_discount',
            order_id: orderId,
            tenant_id: user.tenantId,
            discount_type: 'manual_value',
            discount_value: actualDesconto,
            requires_approval: true,
            approved_by: cortesiaAtiva ? (cortesiaAutor ?? 'Cortesia') : 'Gerente',
            new_discount_amount: actualDesconto,
            new_total_amount: actualTotal,
            reason: cortesiaAtiva
              ? (cortesiaNotesStr ?? `Cortesia autorizada por: ${cortesiaAutor ?? 'Gerente'}`)
              : 'Desconto autorizado no PDV Caixa',
          },
        });
        if (discErr) console.warn('[PDVContext] apply_discount error (non-blocking):', discErr);
      } catch (e) {
        console.warn('[PDVContext] apply_discount exception (non-blocking):', e);
      }
    }

    // Cortesia: pedido já marcado como pago na edge function — não registrar pagamento
    if (!cortesiaAtiva && orderId && pagamentos.length > 0) {
      let paymentRegistered = false;
      const paymentErrors: string[] = [];
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
              payment_group_id: customerData?.paymentGroupId ?? null,
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
          console.warn('[PDVContext] fn_update_paid_by_pdv error (non-blocking):', e);
        }
      }
    }

    if (orderId) {
      setTimeout(() => reloadOrders(), 500);
    }

    return { orderId, number: orderResult.number, printEnqueued: orderResult.printEnqueued };
  }, [
    gerarProximoNumeroPedido, sessao, user, caixa,
    carrinho, destino, valorDesconto, valorTaxaServico,
    subtotal, total, clearCart, reloadOrders, submitOrder,
    refreshPendingCount, buildItemsPayload, mesas,
    isCortesia, cortesiaAutorizadaPor, cortesiaDestinatario, cortesiaMotivo,
  ]);

  // ── Enviar para Cozinha (sem pagamento — pagar depois) ───────────────────
  const enviarParaCozinha = useCallback(async (destinoOverride?: DestinoInfo | null): Promise<FinalizarResult> => {
    const freshSession = await ensureFreshSession();
    if (!freshSession) {
      throw new Error('Sessao de autenticacao expirada. Por favor, faca login novamente.');
    }

    // Gera número local APENAS para fallback de UI imediata
    const numeroLocal = await gerarProximoNumeroPedido();
    setUltimoNumeroPedido(numeroLocal);
    setNumeroPedidoSeq((s) => s + 1);

    if (!sessao || !user) {
      clearCart();
      return { orderId: 'local', number: numeroLocal };
    }

    const destinoAtivo = destinoOverride ?? destino;

    const obsPedido = destinoAtivo?.observacaoPedido;
    let obsPedidoAdded = false;
    const itensPayload = carrinho.flatMap((ci) => {
      const temObsUnidade = ci.obsUnidades && ci.obsUnidades.some((o) => o && o.trim() !== '');
      const obsPedidoExtra = !obsPedidoAdded && obsPedido ? [{ text: `[PEDIDO] ${obsPedido}` }] : [];
      if (!obsPedidoAdded && obsPedido) obsPedidoAdded = true;

      // Partes de produção pré-carregadas do contexto do cardápio (evita query RLS no print)
      const productionPartsPayload = ci.subproducao?.filter(sp => sp.estacaoId)
        .map(sp => ({ name: sp.nome, station_id: sp.estacaoId, station_name: sp.estacao })) ?? undefined;

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
            production_parts: productionPartsPayload,
            options: ci.opcoes.map((o) => ({
              option_id: o.opcaoId || null,
              option_name: o.opcaoNome,
              group_name: o.grupoNome,
              additional_price: o.precoAdicional,
              group_obrigatorio: o.obrigatorio,
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
        production_parts: productionPartsPayload,
        options: ci.opcoes.map((o) => ({
          option_id: o.opcaoId || null,
          option_name: o.opcaoNome,
          group_name: o.grupoNome,
          additional_price: o.precoAdicional,
          group_obrigatorio: o.obrigatorio,
        })),
        observations: [
          ...ci.observacoes.map((t) => ({ text: t })),
          ...extraObs,
        ],
      }];
    });

    const tableSessionId = destinoAtivo?.tipo === 'mesa' && destinoAtivo.mesaId
      ? (mesas.find((m) => m.id === destinoAtivo.mesaId)?.tableSessionId ?? null)
      : null;

    // Cria pedido — useOrderSubmit enfileira impressão automaticamente via fila centralizada
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
    }, { stationToImpressoraId: mapaEstacoes });

    const orderId: string = orderResult.id;
    const isOffline = orderResult.isOffline ?? false;

    clearCart();

    if (isOffline) {
      refreshPendingCount();
      return { orderId, number: orderResult.number, isOffline: true };
    }

    const isValidUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(orderId);
    if (!isValidUuid) {
      return { orderId, number: orderResult.number, printEnqueued: orderResult.printEnqueued };
    }

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

    if (orderId) {
      setTimeout(() => reloadOrders(), 500);
    }

    return { orderId, number: orderResult.number, printEnqueued: orderResult.printEnqueued };
  }, [
    gerarProximoNumeroPedido, sessao, user, caixa,
    carrinho, destino, valorDesconto, valorTaxaServico,
    subtotal, total, clearCart, reloadOrders, submitOrder,
    refreshPendingCount, mesas,
  ]);

  const setCortesia = useCallback((ativa: boolean, autorizadoPor: string | null, destinatario?: string | null, motivo?: string | null) => {
    setIsCortesia(ativa);
    setCortesiaAutorizadaPor(autorizadoPor);
    setCortesiaDestinatario(destinatario ?? null);
    setCortesiaMotivo(motivo ?? null);
  }, []);

  const clearCortesia = useCallback(() => {
    setIsCortesia(false);
    setCortesiaAutorizadaPor(null);
    setCortesiaDestinatario(null);
    setCortesiaMotivo(null);
  }, []);

  return (
    <PDVContext.Provider value={{
      carrinho, destino, desconto, taxaServico, numeroPedidoSeq,
      ultimoNumeroPedido, pedidosPagos,
      isCortesia, cortesiaAutorizadaPor, cortesiaDestinatario, cortesiaMotivo, setCortesia, clearCortesia,
      addItem, updateItemQty, removeItem, updateItemObs, clearCart,
      setDestino, setDesconto, toggleTaxaServico, marcarComoPago,
      subtotal, valorDesconto, valorTaxaServico, total,
      finalizarPedido, enviarParaCozinha,
      senhaCounter, consumirSenha,
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
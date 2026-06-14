import { useState, useCallback, useEffect, useRef, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessao } from '../../contexts/SessaoContext';
import { useKDS, buildKDSPedido } from '../../contexts/KDSContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { useKioskAuth } from '../../contexts/KioskAuthContext';
import { invokeWithAuth, supabase } from '../../lib/supabase';
import { useOrderSubmit, PartialOrderError } from '../../hooks/useOrderSubmit';
import { useWakeLock } from '../../hooks/useWakeLock';
import { saveOfflineOrder, generateLocalOrderId, generateLocalOrderNumber, countPendingOrders, type OfflineOrder } from '../../lib/offlineDB';
import { startAutoSync, stopAutoSync } from '../../lib/offlineSync';
import WelcomeScreen from './components/WelcomeScreen';
import CardapioKiosk from './components/CardapioKiosk';
import CarrinhoKiosk from './components/CarrinhoKiosk';
import PagamentoKiosk from './components/PagamentoKiosk';
import DestinoKiosk from './components/DestinoKiosk';
import IdentificacaoKiosk from './components/IdentificacaoKiosk';
import FormaPagamentoKiosk from './components/FormaPagamentoKiosk';
import KioskConfigModal from './components/KioskConfigModal';
import PINGate, { isPINAtivo } from './components/PINGate';
import { type ItemPedidoCliente } from '../../types/mesaCliente';
import type { DestinoInfo } from '../../contexts/PDVContext';

// ── ErrorBoundary local para a página de autoatendimento ────────────────────
// Evita que erros aqui derrubem toda a aplicação e mostram uma tela de recovery
class KioskErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean; error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[KioskErrorBoundary] Erro capturado:', error.message, error.stack, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-center p-8">
          <div className="w-16 h-16 flex items-center justify-center bg-red-900/40 rounded-2xl mb-4">
            <i className="ri-error-warning-line text-3xl text-red-400" />
          </div>
          <h2 className="text-2xl font-black text-white mb-2">Totem em manutenção</h2>
          <p className="text-zinc-500 text-sm max-w-xs mb-6">Ocorreu um erro inesperado. Recarregue a página para continuar.</p>
          {this.state.error && (
            <details className="mb-6 text-left bg-zinc-900 border border-zinc-700 rounded-xl p-4 max-w-sm w-full">
              <summary className="text-xs text-red-400 font-semibold cursor-pointer">Detalhes técnicos</summary>
              <pre className="text-[10px] text-red-300 mt-2 overflow-auto max-h-32 whitespace-pre-wrap">{this.state.error.message}</pre>
            </details>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-8 py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-2xl cursor-pointer transition-colors whitespace-nowrap"
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type Etapa = 'welcome' | 'destino' | 'cardapio' | 'carrinho' | 'identificacao' | 'forma_pagamento' | 'pagamento';
type Destino = 'aqui' | 'viagem' | null;

const ETAPAS_FLUXO: Etapa[] = ['cardapio', 'carrinho', 'identificacao', 'forma_pagamento', 'pagamento'];
const getEtapasLabel = (pagarNaEntrega: boolean): Record<string, string> => ({
  cardapio: 'Cardápio',
  carrinho: 'Revisar',
  identificacao: 'Identificação',
  forma_pagamento: 'Pagamento',
  pagamento: pagarNaEntrega ? 'Confirmação' : 'Pagar',
});

let pedidoSeq = 1000;

function useFullscreen() {
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    return () => document.removeEventListener('fullscreenchange', handler);
  }, []);
  const toggle = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch { /* ignore */ }
  }, []);
  return { isFullscreen, toggle };
}

function AutoatendimentoPageInner() {
  const { estado, sessao, caixa, sincronizarSessao } = useSessao();
  const { addPedido, reloadOrders, stationMap } = useKDS();
  const { user, logout } = useAuth();
  const { settings } = useSystemSettings();
  const { kioskSession } = useKioskAuth();
  const navigate = useNavigate();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Mantém a tela do tablet ligada enquanto o autoatendimento está aberto
  useWakeLock();

  const [pinLiberado, setPinLiberado] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>('welcome');
  const [showLogoutPin, setShowLogoutPin] = useState(false);
  const [logoutPin, setLogoutPin] = useState('');
  const [logoutErro, setLogoutErro] = useState('');
  const [showConfigModal, setShowConfigModal] = useState(false);
  const [destino, setDestino] = useState<Destino>(null);
  const [carrinho, setCarrinho] = useState<ItemPedidoCliente[]>([]);
  const [identifNome, setIdentifNome] = useState('');
  const [identifSenha, setIdentifSenha] = useState('');
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingOrderNumber, setPendingOrderNumber] = useState<number | null>(null);
  // Forma de pagamento escolhida pelo cliente (modo entrega)
  const [formaPagamentoId, setFormaPagamentoId] = useState<string | null>(null);
  const [formaPagamentoNome, setFormaPagamentoNome] = useState<string | null>(null);
  // Alerta de inserção parcial (HTTP 207) — pedido criado mas itens podem estar faltando no KDS
  const [alertaParcialKiosk, setAlertaParcialKiosk] = useState<string | null>(null);
  // BUG-10: contador de pedidos offline pendentes de sincronização
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);

  const modoIdentificacao = settings.self_service_id_type;
  const modoPagamento = settings.self_service_payment_type;
  const pularIdentificacao = modoIdentificacao === 'nenhum';
  const pagarNaEntrega = modoPagamento === 'entrega';

  // ── Polling de fallback: verifica sessão a cada 8s quando offline ─────────
  // Garante que o totem detecte a abertura do caixa mesmo se o Realtime falhar
  useEffect(() => {
    if (estado !== 'sem_sessao') return;
    const tenantId = kioskSession?.tenantId ?? user?.tenantId;
    if (!tenantId) return;

    // Verifica imediatamente e depois a cada 8s
    sincronizarSessao();
    const interval = setInterval(() => sincronizarSessao(), 8000);
    return () => clearInterval(interval);
  }, [estado, kioskSession?.tenantId, user?.tenantId, sincronizarSessao]);

  // ── Heartbeat: atualiza last_access_at a cada 2min para indicar que o totem está online
  // Isso permite que a tela de módulos mostre o status real de "online" do totem
  useEffect(() => {
    const userId = kioskSession?.kioskUserId ?? user?.id;
    if (!userId) return;

    const updateHeartbeat = () => {
      supabase.rpc('fn_kiosk_heartbeat', { p_user_id: userId }).then(() => {}).catch(() => {});
    };

    // Atualiza imediatamente ao entrar
    updateHeartbeat();
    // E depois a cada 2 minutos
    const interval = setInterval(updateHeartbeat, 2 * 60 * 1000);
    return () => clearInterval(interval);
  }, [kioskSession?.kioskUserId, user?.id]);

  // ── BUG-10: Auto-sync de pedidos offline no kiosk ──────────────────────────
  // O totem não passa pelo AppLayout/TopBar (que tem auto-sync global),
  // então precisamos de um auto-sync dedicado aqui.
  useEffect(() => {
    const tenantId = kioskSession?.tenantId ?? user?.tenantId;
    if (!tenantId) return;

    const refreshPending = async () => {
      const count = await countPendingOrders(tenantId).catch(() => 0);
      setOfflinePendingCount(count);
    };

    refreshPending();

    startAutoSync(tenantId, (summary) => {
      if (summary.succeeded > 0) {
        refreshPending();
      }
    });

    const interval = setInterval(refreshPending, 30_000);

    return () => {
      stopAutoSync();
      clearInterval(interval);
    };
  }, [kioskSession?.tenantId, user?.tenantId]);

  // ── Helper: invoca edge function usando o token do kiosk (ou fallback para invokeWithAuth) ──
  // PADRONIZADO: usa invokeWithAuth com externalToken — mesmo mecanismo de todos os outros fluxos
  const kioskInvoke = useCallback(async <T = unknown>(
    functionName: string,
    body: Record<string, unknown>,
  ): Promise<{ data: T | null; error: Error | null }> => {
    const token = kioskSession?.accessToken ?? null;
    // invokeWithAuth aceita externalToken — usa o token do kiosk quando disponível,
    // senão usa a sessão Supabase Auth normal (admin logado diretamente)
    return invokeWithAuth<T>(functionName, { body, externalToken: token ?? undefined });
  }, [kioskSession?.accessToken]);

  const etapasVisiveis = ETAPAS_FLUXO.filter((e) => {
    if (e === 'identificacao' && pularIdentificacao) return false;
    // Tela de forma de pagamento só aparece no modo "entrega"
    if (e === 'forma_pagamento' && !pagarNaEntrega) return false;
    // Tela de pagamento não aparece no modo "entrega" (vai direto pra confirmação)
    if (e === 'pagamento' && pagarNaEntrega) return false;
    return true;
  });

  const handleIniciar = () => setEtapa('destino');

  const handleSelecionarDestino = (d: 'aqui' | 'viagem') => {
    setDestino(d);
    setEtapa('cardapio');
  };

  const handleAdicionar = (item: Omit<ItemPedidoCliente, 'enviadoKds'>) => {
    setCarrinho((prev) => {
      const existe = prev.findIndex(
        (c) =>
          c.itemId === item.itemId &&
          JSON.stringify(c.opcoesSelecionadas) === JSON.stringify(item.opcoesSelecionadas) &&
          c.observacao === item.observacao
      );
      if (existe >= 0) {
        return prev.map((c, i) =>
          i === existe ? { ...c, quantidade: c.quantidade + item.quantidade } : c
        );
      }
      return [...prev, { ...item, enviadoKds: false }];
    });
  };

  const handleDiminuir = (itemId: string) => {
    setCarrinho((prev) => {
      // Procura de trás pra frente o primeiro item com esse itemId e quantidade > 0
      const idx = prev.map((c) => c.itemId).lastIndexOf(itemId);
      if (idx < 0) return prev;
      const novo = [...prev];
      const novaQtd = novo[idx].quantidade - 1;
      if (novaQtd <= 0) {
        return novo.filter((_, i) => i !== idx);
      }
      novo[idx] = { ...novo[idx], quantidade: novaQtd };
      return novo;
    });
  };

  const handleAlterarQtd = (index: number, delta: number) => {
    setCarrinho((prev) => {
      const novo = [...prev];
      const novaQtd = novo[index].quantidade + delta;
      if (novaQtd <= 0) return novo.filter((_, i) => i !== index);
      novo[index] = { ...novo[index], quantidade: novaQtd };
      return novo;
    });
  };

  const handleRemover = (index: number) => {
    setCarrinho((prev) => prev.filter((_, i) => i !== index));
  };

  const handleEditarItem = useCallback((index: number, updates: Partial<ItemPedidoCliente>) => {
    setCarrinho((prev) => prev.map((item, i) => (i === index ? { ...item, ...updates } : item)));
  }, []);

  const handleAvancarCarrinho = () => {
    if (pularIdentificacao) {
      setEtapa(pagarNaEntrega ? 'forma_pagamento' : 'pagamento');
    } else {
      setEtapa('identificacao');
    }
  };

  const handleIdentificacaoConcluida = (nome: string, senha: string) => {
    setIdentifNome(nome);
    setIdentifSenha(senha);
    setEtapa(pagarNaEntrega ? 'forma_pagamento' : 'pagamento');
  };

  const handleFormaPagamentoConcluida = (methodId: string, methodName: string) => {
    setFormaPagamentoId(methodId);
    setFormaPagamentoNome(methodName);
    setEtapa('pagamento');
  };

  // Resolve o tenant_id e session_id
  // Prioridade: kiosk session > user normal
  // O SessaoContext já usa a mesma prioridade, então sessao.id é sempre confiável
  const getTenantAndSession = useCallback((): { tenantId: string | null; sessionId: string | null } => {
    // Prioriza kiosk session (modo totem por token), depois user normal (login direto)
    const tenantId = kioskSession?.tenantId ?? user?.tenantId ?? null;
    // sessao.id do SessaoContext é sempre a fonte mais atualizada (via Realtime)
    const sessionId = sessao?.id ?? kioskSession?.sessionId ?? null;

    console.log('[Autoatendimento] getTenantAndSession:', {
      tenantId,
      sessionId,
      sessaoId: sessao?.id,
      kioskSessionId: kioskSession?.sessionId,
      userTenantId: user?.tenantId,
      kioskTenantId: kioskSession?.tenantId,
      userRole: user?.perfil,
    });

    return { tenantId, sessionId };
  }, [kioskSession, user, sessao]);

  const { submitOrder } = useOrderSubmit();
  // Ref para bloquear criação duplicada de pedido no mesmo tick
  // (state pendingOrderId não atualiza rápido o suficiente para dois toques simultâneos)
  const criarPedidoRef = useRef(false);

  // Cria o pedido no banco e retorna o ID e número
  const criarPedidoBanco = useCallback(async (): Promise<{ id: string; numero: number } | null> => {
    let { tenantId, sessionId } = getTenantAndSession();

    console.log('[Autoatendimento] criarPedidoBanco iniciando:', {
      tenantId,
      sessionId,
      carrinhoLength: carrinho.length,
      formaPagamentoNome,
      pagarNaEntrega,
      userPerfil: user?.perfil,
    });

    if (!tenantId) {
      console.error('[Autoatendimento] criarPedidoBanco: tenantId não resolvido — usuário não autenticado');
      return null;
    }

    if (carrinho.length === 0) {
      console.warn('[Autoatendimento] criarPedidoBanco: carrinho vazio');
      return null;
    }

    // Fallback: se sessao ainda não carregou no contexto, busca diretamente do banco
    if (!sessionId) {
      console.log('[Autoatendimento] sessionId não disponível no contexto — buscando diretamente do banco...');
      try {
        const { data: sessions, error: sessErr } = await supabase.rpc('fn_get_active_session', { p_tenant_id: tenantId });
        if (sessErr) {
          console.error('[Autoatendimento] fn_get_active_session error:', sessErr);
        } else {
          sessionId = sessions?.[0]?.id ?? null;
          console.log('[Autoatendimento] Sessão buscada diretamente do banco:', sessionId);
        }
      } catch (e) {
        console.warn('[Autoatendimento] Falha ao buscar sessão diretamente:', e);
      }
    }

    if (!sessionId) {
      console.warn('[Autoatendimento] criarPedidoBanco: sem sessão ativa — pedido não pode ser criado no banco');
      return null;
    }

    let destinoInfo: DestinoInfo;
    if (modoIdentificacao === 'nome') {
      destinoInfo = { tipo: 'nome', nomeCliente: identifNome || 'Cliente' };
    } else if (modoIdentificacao === 'senha' || modoIdentificacao === 'comanda' || modoIdentificacao === 'senha_balcao') {
      destinoInfo = { tipo: 'senha', senha: identifSenha };
    } else {
      destinoInfo = { tipo: 'hora' };
    }

    const notaPagamento = pagarNaEntrega && formaPagamentoNome
      ? `Pagamento na entrega: ${formaPagamentoNome}`
      : null;

    const itensPayload = carrinho.map((item, idx) => ({
      item_id: item.itemId && /^[0-9a-f-]{36}$/i.test(item.itemId) ? item.itemId : null,
      item_name: item.nome,
      item_price: item.preco,
      quantity: item.quantidade,
      station_id: (item.stationId && /^[0-9a-f-]{36}$/i.test(item.stationId)) ? item.stationId : null,
      skip_kds: item.semPreparo ?? false,
      notes: item.observacao || null,
      options: item.opcoesSelecionadas.map((o) => ({
        option_id: o.id || null,
        option_name: o.nome,
        group_name: o.grupoNome || 'Opções',
        additional_price: o.precoAdicional ?? 0,
        group_obrigatorio: o.obrigatorio,
      })),
      observations: [
        ...(item.observacao ? [{ text: item.observacao }] : []),
        ...(idx === 0 && notaPagamento ? [{ text: notaPagamento }] : []),
      ],
    }));

    const subtotal = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

    const destinoTipoMap: Record<string, string> = {
      nome: 'nome',
      senha: 'senha',
      comanda: 'senha',
      senha_balcao: 'senha',
      hora: 'hora',
      na_hora: 'hora',
    };

    const kioskToken = kioskSession?.accessToken ?? undefined;

    console.log('[Autoatendimento] Enviando create_order via useOrderSubmit:', {
      session_id: sessionId,
      tenant_id: tenantId,
      origin: 'self_service',
      itemCount: itensPayload.length,
      subtotal,
      hasKioskToken: !!kioskToken,
      userPerfil: user?.perfil,
    });

    try {
      const result = await submitOrder(
        {
          session_id: sessionId,
          tenant_id: tenantId,
          destination: destinoTipoMap[destinoInfo.tipo] ?? 'hora',
          destination_name: destinoInfo.nomeCliente ?? destinoInfo.senha ?? null,
          destination_phone: null,
          delivery_address: null,
          delivery_fee: 0,
          origin: 'self_service',
          cash_register_id: null,
          items: itensPayload,
          discount_amount: 0,
          service_fee_amount: 0,
          subtotal,
          total_amount: subtotal,
          is_training: user?.modoTreino ?? false,
        },
        { externalToken: kioskToken, paraViagem: destino === 'viagem' },
      );

      const orderNumber = parseInt(result.number.replace(/\D/g, '').slice(-4), 10) || 0;
      console.log('[Autoatendimento] ✅ Pedido criado com sucesso:', result.id, 'número:', orderNumber);
      return { id: result.id, numero: orderNumber };
    } catch (e) {
      // PartialOrderError: pedido criado mas itens falharam parcialmente (HTTP 207)
      // Exibe alerta diferenciado no totem — o pedido existe mas pode estar incompleto no KDS
      if (e instanceof PartialOrderError) {
        console.warn('[Autoatendimento] Pedido parcial detectado:', e.orderId, e.orderNumber);
        setAlertaParcialKiosk(e.orderNumber);
        const orderNumber = parseInt(e.orderNumber.replace(/\D/g, '').slice(-4), 10) || 0;
        return { id: e.orderId, numero: orderNumber };
      }
      console.error('[Autoatendimento] Exceção ao criar pedido após retries:', e);
      return null;
    }
  }, [carrinho, identifNome, identifSenha, modoIdentificacao, pagarNaEntrega, formaPagamentoNome, getTenantAndSession, submitOrder, user?.modoTreino, kioskSession?.accessToken]);


  const handleAvancarPagamento = useCallback(async (): Promise<void> => {
    // Padrão ref+state duplo:
    // - criarPedidoRef bloqueia no mesmo tick (state não atualiza rápido o suficiente)
    // - pendingOrderId bloqueia chamadas subsequentes após o primeiro ciclo
    if (criarPedidoRef.current) {
      console.log('[Autoatendimento] handleAvancarPagamento: bloqueado por ref — criação já em andamento');
      return;
    }
    if (pendingOrderId) {
      console.log('[Autoatendimento] handleAvancarPagamento: pedido já criado, ignorando', pendingOrderId);
      return;
    }
    criarPedidoRef.current = true;
    try {
      console.log('[Autoatendimento] handleAvancarPagamento: chamando criarPedidoBanco...');
      const result = await criarPedidoBanco();
      console.log('[Autoatendimento] handleAvancarPagamento: pedido criado =', result);
      if (result) {
        setPendingOrderId(result.id);
        setPendingOrderNumber(result.numero);

        // Impressão é gerenciada pelo useOrderSubmit via fila centralizada
      } else {
        console.warn('[Autoatendimento] handleAvancarPagamento: criarPedidoBanco retornou null — pedido não salvo no banco');
      }
    } finally {
      criarPedidoRef.current = false;
    }
  }, [criarPedidoBanco, pendingOrderId]);

  const handleConcluir = useCallback(async (paymentMethodId?: string) => {
    const effectiveOrderId = pendingOrderId;
    const { tenantId, sessionId } = getTenantAndSession();

    if (effectiveOrderId && paymentMethodId && sessionId && tenantId) {
      const subtotal = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

      // Busca o caixa ativo da sessão
      let cashRegisterId: string | null = caixa?.id ?? null;
      if (!cashRegisterId && sessionId) {
        try {
          const { data: crData } = await supabase
            .from('cash_registers')
            .select('id')
            .eq('session_id', sessionId)
            .eq('status', 'open')
            .order('opened_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          cashRegisterId = crData?.id ?? null;
        } catch (e) {
          console.error('[Autoatendimento] Erro ao buscar caixa da sessão:', e);
        }
      }

      if (cashRegisterId) {
        try {
          const { error: payErr } = await kioskInvoke('order-write', {
            action: 'record_payment',
            order_id: effectiveOrderId,
            tenant_id: tenantId,
            cash_register_id: cashRegisterId,
            payment_method_id: paymentMethodId,
            amount: subtotal,
            change_amount: 0,
            paid_by_pdv: 'self_service',
          });
          if (payErr) {
            console.error('[Autoatendimento] record_payment error:', payErr);
            throw new Error(typeof payErr === 'string' ? payErr : 'Falha ao registrar pagamento no caixa');
          } else {
            supabase.rpc('fn_update_paid_by_pdv', { p_order_id: effectiveOrderId, p_paid_by_pdv: 'self_service' }).catch(() => {});
          }
        } catch (e) {
          console.error('[Autoatendimento] Erro ao registrar pagamento:', e);
          throw e;
        }
      } else if (paymentMethodId) {
        // BUG-11: Safety net — método de pagamento selecionado mas sem caixa aberto.
        // A UI do PagamentoKiosk já bloqueia esse cenário, mas este catch protege
        // contra race conditions e chamadas diretas.
        console.error('[Autoatendimento] BUG-11 safety net: pagamento bloqueado — sem caixa', {
          orderId: effectiveOrderId,
          paymentMethodId,
          sessionId,
        });
        // Cancela o pedido pois não podemos aceitar pagamento sem caixa
        try {
          await kioskInvoke('order-write', {
            action: 'cancel_order',
            order_id: effectiveOrderId,
            tenant_id: tenantId,
            reason: 'Pagamento recusado: caixa fechado (BUG-11 safety net)',
          });
        } catch { /* non-fatal */ }
        throw new Error('Não é possível registrar o pagamento sem um caixa (gaveta) aberto. Solicite ao operador que abra o caixa no PDV.');
      }
    } else if (!sessionId) {
      // BUG-10 FIX: Modo offline — salva no IndexedDB + KDS local
      if (carrinho.length > 0) {
        pedidoSeq += 1;
        let destinoInfo: DestinoInfo;
        if (modoIdentificacao === 'nome') {
          destinoInfo = { tipo: 'nome', nomeCliente: identifNome || 'Cliente' };
        } else if (modoIdentificacao === 'senha' || modoIdentificacao === 'comanda' || modoIdentificacao === 'senha_balcao') {
          destinoInfo = { tipo: 'senha', senha: identifSenha };
        } else {
          destinoInfo = { tipo: 'hora' };
        }

        // ── KDS local (feedback visual imediato) ──────────────────
        const carrinhoKDS = carrinho.map((item, i) => ({
          cartId: `kiosk-${Date.now()}-${i}`,
          itemId: item.itemId,
          nome: item.nome,
          precoBase: item.preco,
          precoTotal: item.preco * item.quantidade,
          quantidade: item.quantidade,
          opcoes: item.opcoesSelecionadas.map((o) => ({
            grupoNome: o.grupoNome || 'Opções',
            opcaoNome: o.nome,
            precoExtra: o.precoAdicional ?? 0,
          })),
          observacoes: item.observacao ? [item.observacao] : [],
          observacaoLivre: '',
        }));
        const pedidoKDS = buildKDSPedido({
          cart: carrinhoKDS,
          destino: destinoInfo,
          numeroSeq: pedidoSeq,
          origem: 'autoatendimento',
          stationMap,
        });
        addPedido(pedidoKDS);

        // ── IndexedDB (persistência offline) ──────────────────────
        const destinoTipo = destinoInfo.tipo === 'nome' ? 'nome'
          : (destinoInfo.tipo === 'senha' ? 'senha' : 'hora');
        const destinoNome = destinoInfo.tipo === 'nome' ? (destinoInfo.nomeCliente ?? null)
          : (destinoInfo.tipo === 'senha' ? (destinoInfo.senha ?? null) : null);
        const subtotal = carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0);

        const offlineOrder: OfflineOrder = {
          localId: generateLocalOrderId(),
          serverId: null,
          localNumber: generateLocalOrderNumber(pedidoSeq),
          serverNumber: null,
          status: 'pending',
          retryCount: 0,
          lastError: null,
          createdAt: Date.now(),
          syncedAt: null,
          session_id: sessionId ?? '',
          tenant_id: tenantId ?? '',
          origin: 'self_service',
          destination: destinoTipo,
          destination_name: destinoNome,
          destination_phone: null,
          delivery_address: null,
          delivery_fee: 0,
          items: carrinho.map((item) => ({
            item_id: item.itemId && /^[0-9a-f-]{36}$/i.test(item.itemId) ? item.itemId : null,
            item_name: item.nome,
            item_price: item.preco,
            quantity: item.quantidade,
            station_id: (item.stationId && /^[0-9a-f-]{36}$/i.test(item.stationId)) ? item.stationId : null,
            skip_kds: item.semPreparo ?? false,
            notes: item.observacao || null,
            options: item.opcoesSelecionadas.map((o) => ({
              option_id: o.id || null,
              option_name: o.nome,
              group_name: o.grupoNome || 'Opções',
              additional_price: o.precoAdicional ?? 0,
            })),
            observations: item.observacao ? [{ text: item.observacao }] : [],
          })),
          discount_amount: 0,
          service_fee_amount: 0,
          subtotal,
          total_amount: subtotal,
          cash_register_id: caixa?.id ?? null,
          is_training: user?.modoTreino ?? false,
          payments: [],
        };

        saveOfflineOrder(offlineOrder).then(() => {
          setOfflinePendingCount((c) => c + 1);
          console.log('[Autoatendimento] Pedido salvo offline no IndexedDB:', offlineOrder.localId);
        }).catch((e) => {
          console.error('[Autoatendimento] Erro ao salvar pedido offline:', e);
        });
      }
    }

    setTimeout(() => reloadOrders(), 600);

    setCarrinho([]);
    setDestino(null);
    setIdentifNome('');
    setIdentifSenha('');
    setPendingOrderId(null);
    setPendingOrderNumber(null);
    setFormaPagamentoId(null);
    setFormaPagamentoNome(null);
    setAlertaParcialKiosk(null);
    setEtapa('welcome');
  }, [
    pendingOrderId, caixa, getTenantAndSession, carrinho,
    identifNome, identifSenha, modoIdentificacao,
    addPedido, reloadOrders, kioskInvoke,
  ]);

  const handleCancelar = useCallback(async () => {
    if (pendingOrderId) {
      const { tenantId } = getTenantAndSession();
      if (tenantId) {
        try {
          await kioskInvoke('order-write', {
            action: 'cancel_order',
            order_id: pendingOrderId,
            tenant_id: tenantId,
            reason: 'Cancelado pelo cliente no autoatendimento',
          });
        } catch { /* non-fatal */ }
      }
    }
    setCarrinho([]);
    setDestino(null);
    setIdentifNome('');
    setIdentifSenha('');
    setPendingOrderId(null);
    setPendingOrderNumber(null);
    setFormaPagamentoId(null);
    setFormaPagamentoNome(null);
    setAlertaParcialKiosk(null);
    setEtapa('welcome');
  }, [pendingOrderId, getTenantAndSession, kioskInvoke]);

  const marcarTotemOffline = useCallback(async () => {
    const userId = kioskSession?.kioskUserId ?? user?.id;
    if (!userId) return;
    try {
      await supabase.rpc('fn_kiosk_set_offline', { p_user_id: userId });
    } catch (e) {
      console.warn('[Autoatendimento] marcarTotemOffline error (non-blocking):', e);
    }
  }, [kioskSession?.kioskUserId, user?.id]);

  const handleLogoutComPin = useCallback(async () => {
    if (!logoutPin.trim()) { setLogoutErro('Digite o PIN'); return; }
    if (!user?.matricula) {
      await marcarTotemOffline();
      logout();
      navigate('/login');
      return;
    }
    try {
      const { data, error } = await invokeWithAuth('login-pin', {
        body: { badge_number: user.matricula, pin: logoutPin },
      });
      if (error || !(data as Record<string, unknown>)?.user) {
        setLogoutErro('PIN incorreto');
        return;
      }
      await marcarTotemOffline();
      logout();
      navigate('/login');
    } catch {
      setLogoutErro('Erro ao validar PIN');
    }
  }, [logoutPin, user, logout, navigate, marcarTotemOffline]);

  if (estado === 'sem_sessao') {
    return (
      <div className="fixed inset-0 bg-zinc-950 flex flex-col items-center justify-center text-center p-8">
        <div className="w-24 h-24 flex items-center justify-center bg-zinc-800 rounded-3xl mb-6">
          <i className="ri-computer-line text-5xl text-zinc-600" />
        </div>
        <h2 className="text-3xl font-black text-white mb-3">Totem Offline</h2>
        <p className="text-zinc-500 text-base max-w-sm">
          O autoatendimento ficará disponível assim que o caixa iniciar a sessão do dia.
        </p>
        <div className="mt-8 flex items-center gap-3 px-6 py-3 bg-zinc-800 rounded-full">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
          <span className="text-zinc-400 text-sm font-semibold">Aguardando abertura do caixa...</span>
        </div>

        {/* BUG-10: badge de pedidos offline pendentes no totem */}
        {offlinePendingCount > 0 && (
          <div className="mt-6 flex items-center gap-2 px-5 py-3 bg-orange-500/10 border border-orange-500/30 rounded-2xl">
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="ri-cloud-off-line text-orange-400 text-lg" />
            </div>
            <div className="text-left">
              <p className="text-sm font-bold text-orange-400">
                {offlinePendingCount} pedido{offlinePendingCount > 1 ? 's' : ''} offline
              </p>
              <p className="text-xs text-orange-400/70">
                Será sincronizado quando o caixa abrir
              </p>
            </div>
          </div>
        )}

        {!showLogoutPin ? (
          <button
            onClick={() => setShowLogoutPin(true)}
            className="mt-12 text-zinc-700 hover:text-zinc-500 text-xs font-semibold cursor-pointer transition-colors"
          >
            <i className="ri-logout-box-line mr-1" />
            Sair do totem
          </button>
        ) : (
          <div className="mt-8 flex flex-col items-center gap-4 w-full max-w-xs">
            <p className="text-zinc-400 text-sm font-semibold">Digite seu PIN para sair</p>
            {/* Display do PIN */}
            <div className="flex gap-3 justify-center">
              {Array.from({ length: Math.max(4, logoutPin.length) }).map((_, i) => (
                <div key={i} className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center text-xl font-black transition-all ${
                  i < logoutPin.length ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-700 bg-zinc-800 text-zinc-600'
                }`}>
                  {i < logoutPin.length ? '●' : '○'}
                </div>
              ))}
            </div>
            {logoutErro && <p className="text-red-400 text-sm font-semibold">{logoutErro}</p>}
            {/* Teclado numérico */}
            <div className="grid grid-cols-3 gap-2 w-full">
              {['1','2','3','4','5','6','7','8','9'].map((n) => (
                <button key={n} onClick={() => { if (logoutPin.length < 8) { setLogoutPin(p => p + n); setLogoutErro(''); } }}
                  className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-xl font-bold rounded-xl cursor-pointer transition-colors">
                  {n}
                </button>
              ))}
              <button onClick={() => { setLogoutPin(''); setLogoutErro(''); }}
                className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-red-900/40 text-zinc-500 hover:text-red-400 text-sm font-bold rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-bin-line text-lg" />
              </button>
              <button onClick={() => { if (logoutPin.length < 8) { setLogoutPin(p => p + '0'); setLogoutErro(''); } }}
                className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-xl font-bold rounded-xl cursor-pointer transition-colors">
                0
              </button>
              <button onClick={() => { setLogoutPin(p => p.slice(0, -1)); setLogoutErro(''); }}
                className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm font-bold rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-back-2-line text-lg" />
              </button>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={() => { setShowLogoutPin(false); setLogoutPin(''); setLogoutErro(''); }}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleLogoutComPin}
                className="flex-1 py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}

        <button
          onClick={toggleFullscreen}
          title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
          className="absolute bottom-5 right-5 w-10 h-10 flex items-center justify-center bg-zinc-800/60 hover:bg-zinc-700/80 text-zinc-600 hover:text-zinc-400 rounded-xl transition-all cursor-pointer"
        >
          <i className={`text-base ${isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'}`} />
        </button>
      </div>
    );
  }

  if (isPINAtivo() && !pinLiberado) {
    return <PINGate onUnlock={() => setPinLiberado(true)} />;
  }

  if (etapa === 'welcome') {
    return (
      <>
        <WelcomeScreen onIniciar={handleIniciar} />
        {showConfigModal && <KioskConfigModal onClose={() => setShowConfigModal(false)} />}
        {/* Botão de configuração — canto superior direito */}
        <button
          onClick={() => setShowConfigModal(true)}
          title="Configurações do totem"
          className="fixed top-5 right-5 z-[100] w-9 h-9 flex items-center justify-center bg-zinc-900/70 hover:bg-zinc-800/90 text-zinc-600 hover:text-zinc-400 rounded-xl border border-zinc-800 cursor-pointer transition-all"
        >
          <i className="ri-settings-3-line text-sm" />
        </button>
        {!showLogoutPin ? (
          <button
            onClick={() => setShowLogoutPin(true)}
            className="fixed bottom-5 left-5 z-[100] text-zinc-600 hover:text-zinc-400 text-xs font-semibold cursor-pointer transition-colors bg-zinc-900/80 px-3 py-2 rounded-xl border border-zinc-800"
          >
            <i className="ri-logout-box-line mr-1" />
            Sair do totem
          </button>
        ) : (
          <div className="fixed bottom-5 left-5 z-[100] flex flex-col items-center gap-3 w-72 bg-zinc-900 border border-zinc-700 rounded-2xl p-4 shadow-2xl">
            <p className="text-zinc-300 text-sm font-semibold self-start">Digite seu PIN para sair</p>
            {/* Display do PIN */}
            <div className="flex gap-2 justify-center w-full">
              {Array.from({ length: Math.max(4, logoutPin.length) }).map((_, i) => (
                <div key={i} className={`flex-1 h-10 rounded-xl border-2 flex items-center justify-center text-lg font-black transition-all ${
                  i < logoutPin.length ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-700 bg-zinc-800 text-zinc-600'
                }`}>
                  {i < logoutPin.length ? '●' : '○'}
                </div>
              ))}
            </div>
            {logoutErro && <p className="text-red-400 text-xs font-semibold self-start">{logoutErro}</p>}
            {/* Teclado numérico */}
            <div className="grid grid-cols-3 gap-1.5 w-full">
              {['1','2','3','4','5','6','7','8','9'].map((n) => (
                <button key={n} onClick={() => { if (logoutPin.length < 8) { setLogoutPin(p => p + n); setLogoutErro(''); } }}
                  className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-lg font-bold rounded-xl cursor-pointer transition-colors">
                  {n}
                </button>
              ))}
              <button onClick={() => { setLogoutPin(''); setLogoutErro(''); }}
                className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-red-900/40 text-zinc-500 hover:text-red-400 rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-bin-line text-base" />
              </button>
              <button onClick={() => { if (logoutPin.length < 8) { setLogoutPin(p => p + '0'); setLogoutErro(''); } }}
                className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-lg font-bold rounded-xl cursor-pointer transition-colors">
                0
              </button>
              <button onClick={() => { setLogoutPin(p => p.slice(0, -1)); setLogoutErro(''); }}
                className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-back-2-line text-base" />
              </button>
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={() => { setShowLogoutPin(false); setLogoutPin(''); setLogoutErro(''); }}
                className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleLogoutComPin}
                className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Confirmar
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  const etapaIndex = etapasVisiveis.indexOf(etapa as typeof etapasVisiveis[number]);
  const ETAPAS_LABEL = getEtapasLabel(pagarNaEntrega);

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col overflow-hidden">
      {etapa !== 'welcome' && etapa !== 'destino' && (
        <div className="flex items-center justify-between px-6 py-3 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-xl">
              <span className="text-base">🍔</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-white font-black text-base">ERPOS V2 — Autoatendimento</span>
              {destino && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                  destino === 'aqui' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-700 text-zinc-300'
                }`}>
                  <i className={`mr-1 ${destino === 'aqui' ? 'ri-store-2-line' : 'ri-shopping-bag-3-line'}`} />
                  {destino === 'aqui' ? 'Comer aqui' : 'Para viagem'}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {etapasVisiveis.map((e, i) => (
              <div key={e} className="flex items-center gap-2">
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-bold ${
                  etapa === e
                    ? 'bg-amber-500 text-zinc-950'
                    : etapaIndex > i
                    ? 'bg-emerald-500/20 text-emerald-400'
                    : 'bg-zinc-800 text-zinc-500'
                }`}>
                  <span>{i + 1}</span>
                  <span>{ETAPAS_LABEL[e]}</span>
                </div>
                {i < etapasVisiveis.length - 1 && <div className="w-4 h-0.5 bg-zinc-700" />}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowConfigModal(true)}
              title="Configurações do totem"
              className="w-8 h-8 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 rounded-lg cursor-pointer transition-colors"
            >
              <i className="ri-settings-3-line text-sm" />
            </button>
            <button
              onClick={toggleFullscreen}
              title={isFullscreen ? 'Sair da tela cheia' : 'Tela cheia'}
              className="w-8 h-8 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 rounded-lg cursor-pointer transition-colors"
            >
              <i className={`text-sm ${isFullscreen ? 'ri-fullscreen-exit-line' : 'ri-fullscreen-line'}`} />
            </button>
            {/* BUG-10: badge de pedidos offline pendentes */}
            {offlinePendingCount > 0 && (
              <div
                className="flex items-center gap-1.5 px-2.5 py-1 bg-orange-500/20 border border-orange-500/30 rounded-lg cursor-default"
                title={`${offlinePendingCount} pedido(s) aguardando sincronização`}
              >
                <i className="ri-cloud-off-line text-orange-400 text-xs" />
                <span className="text-xs font-bold text-orange-400 whitespace-nowrap">
                  {offlinePendingCount}
                </span>
              </div>
            )}
            <button
              onClick={handleCancelar}
              className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {showConfigModal && <KioskConfigModal onClose={() => setShowConfigModal(false)} />}

      <div className="flex-1 overflow-hidden">
        {etapa === 'destino' && (
          <DestinoKiosk onSelecionar={handleSelecionarDestino} onVoltar={() => setEtapa('welcome')} />
        )}
        {etapa === 'cardapio' && (
          <CardapioKiosk
            carrinho={carrinho}
            onAdicionar={handleAdicionar}
            onDiminuir={handleDiminuir}
            onVerCarrinho={() => setEtapa('carrinho')}
          />
        )}
        {etapa === 'carrinho' && (
          <CarrinhoKiosk
            carrinho={carrinho}
            onAlterarQtd={handleAlterarQtd}
            onRemover={handleRemover}
            onEditarItem={handleEditarItem}
            onVoltar={() => setEtapa('cardapio')}
            onPagar={handleAvancarCarrinho}
          />
        )}
        {etapa === 'identificacao' && (
          <IdentificacaoKiosk
            modo={modoIdentificacao}
            total={carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0)}
            pagarNaEntrega={pagarNaEntrega}
            onContinuar={handleIdentificacaoConcluida}
            onVoltar={() => setEtapa('carrinho')}
          />
        )}
        {etapa === 'forma_pagamento' && (
          <FormaPagamentoKiosk
            total={carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0)}
            onContinuar={handleFormaPagamentoConcluida}
            onVoltar={() => setEtapa(pularIdentificacao ? 'carrinho' : 'identificacao')}
          />
        )}
        {etapa === 'pagamento' && (
          <PagamentoKiosk
            carrinho={carrinho}
            identifNome={identifNome}
            identifSenha={identifSenha}
            modoIdentificacao={modoIdentificacao}
            pagarNaEntrega={pagarNaEntrega}
            modoPagamento={modoPagamento}
            hasCaixa={!!caixa}
            formaPagamentoNome={formaPagamentoNome ?? undefined}
            orderNumber={pendingOrderNumber ?? undefined}
            alertaParcial={alertaParcialKiosk ?? undefined}
            onEntrarPagamento={handleAvancarPagamento}
            onConcluir={handleConcluir}
          />
        )}
      </div>
    </div>
  );
}

export default function AutoatendimentoPage() {
  return (
    <KioskErrorBoundary>
      <AutoatendimentoPageInner />
    </KioskErrorBoundary>
  );
}

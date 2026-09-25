import { useTranslation } from 'react-i18next';
import { useState, useCallback, useEffect, useRef, Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessao } from '../../contexts/SessaoContext';
import { useKDS, buildKDSPedido } from '../../contexts/KDSContext';
import { useAuth } from '../../contexts/AuthContext';
import { useSystemSettings } from '../../hooks/useSystemSettings';
import { useKioskAuth } from '../../contexts/KioskAuthContext';
import { useCardapio } from '../../contexts/CardapioContext';
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
import CpfKiosk from './components/CpfKiosk';
import FormaPagamentoKiosk from './components/FormaPagamentoKiosk';
import KioskConfigModal from './components/KioskConfigModal';
import PINGate, { isPINAtivo } from './components/PINGate';
import { validarPinGerente, validarPinTablet, buscarMatriculaTablet, MAX_TENTATIVAS_PIN_GERENTE } from '../../lib/kioskManagerPin';
import { type ItemPedidoCliente } from '../../types/mesaCliente';
import { useIdiomaCardapio } from '../../hooks/useIdiomaCardapio';
import { edgeUrl } from '../../lib/idiomaCardapio';
import SeletorIdioma from '../../components/SeletorIdioma';
import { haVersaoNova, recarregarAppSozinho } from '../../lib/versaoApp';
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

type Etapa = 'welcome' | 'destino' | 'cardapio' | 'carrinho' | 'identificacao' | 'cpf' | 'forma_pagamento' | 'pagamento';
type Destino = 'aqui' | 'viagem' | null;

const ETAPAS_FLUXO: Etapa[] = ['cardapio', 'carrinho', 'identificacao', 'cpf', 'forma_pagamento', 'pagamento'];
// Rotulos do passo a passo. Recebem o tradutor porque esta funcao roda fora do
// componente — o totem inteiro fala o idioma que o cliente escolheu.
const getEtapasLabel = (pagarNaEntrega: boolean, t: (k: string) => string): Record<string, string> => ({
  cardapio: t('cliente.cardapio'),
  carrinho: t('cliente.etapaRevisar'),
  identificacao: t('cliente.etapaIdentificacao'),
  cpf: t('cliente.etapaCpf'),
  forma_pagamento: t('cliente.etapaPagamento'),
  pagamento: pagarNaEntrega ? t('cliente.etapaConfirmacao') : t('cliente.etapaPagar'),
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
  const { recarregar: recarregarCardapio } = useCardapio();
  const { t } = useTranslation();
  // Idioma do cardapio no totem. A traducao e so de vitrine: o pedido continua
  // sendo montado com o nome em portugues, que e o que a cozinha le.
  const idiomaCardapio = useIdiomaCardapio(edgeUrl('mesa-write'), kioskSession?.tenantId ?? user?.tenantId ?? null);
  const navigate = useNavigate();
  const { isFullscreen, toggle: toggleFullscreen } = useFullscreen();

  // Mantém a tela do tablet ligada enquanto o autoatendimento está aberto
  useWakeLock();

  const [pinLiberado, setPinLiberado] = useState(false);
  const [etapa, setEtapa] = useState<Etapa>('welcome');
  const [showLogoutPin, setShowLogoutPin] = useState(false);
  const [logoutPin, setLogoutPin] = useState('');
  const [logoutErro, setLogoutErro] = useState('');
  // Sair do totem exige matrícula + PIN de gerente/admin da loja (AuthUser não tem matrícula)
  const [logoutCampo, setLogoutCampo] = useState<'matricula' | 'pin'>('matricula');
  const [logoutMatricula, setLogoutMatricula] = useState('');
  const [logoutTentativas, setLogoutTentativas] = useState(0);
  const [logoutLoading, setLogoutLoading] = useState(false);
  const logoutBloqueado = logoutTentativas >= MAX_TENTATIVAS_PIN_GERENTE;
  const logoutDisplay = logoutCampo === 'matricula' ? logoutMatricula : logoutPin;
  const [showConfigModal, setShowConfigModal] = useState(false);
  // Matrícula do próprio tablet: com ela, sair pede só o PIN do tablet. Sem ela (totem
  // antigo por token) continua matrícula + PIN de gerente.
  const [matriculaTablet, setMatriculaTablet] = useState<string | null>(null);
  const tabletUserId = kioskSession?.kioskUserId ?? user?.id ?? null;
  useEffect(() => {
    let vivo = true;
    void buscarMatriculaTablet(tabletUserId).then((m) => {
      if (!vivo) return;
      setMatriculaTablet(m);
      if (m) setLogoutCampo('pin');
    });
    return () => { vivo = false; };
  }, [tabletUserId]);
  const [destino, setDestino] = useState<Destino>(null);
  const [carrinho, setCarrinho] = useState<ItemPedidoCliente[]>([]);
  const [identifNome, setIdentifNome] = useState('');
  const [identifSenha, setIdentifSenha] = useState('');
  // CPF/CNPJ que o cliente escolheu colocar na nota (só dígitos). null = sem CPF.
  const [cpfNota, setCpfNota] = useState<string | null>(null);
  // A pergunta do CPF só existe onde a nota existe: loja com NFC-e ligada e emissão no balcão.
  const [perguntarCpf, setPerguntarCpf] = useState(false);
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null);
  const [pendingOrderNumber, setPendingOrderNumber] = useState<number | null>(null);
  // Pedido pendente já pago (Pix confirmado ou pagamento gravado): não pode mais ser cancelado no totem.
  const [pedidoPago, setPedidoPago] = useState(false);
  const pedidoPagoRef = useRef(false);
  const marcarPedidoPago = useCallback((pago: boolean) => { pedidoPagoRef.current = pago; setPedidoPago(pago); }, []);
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

  // Loja emite NFC-e no balcão? Só então o totem pergunta o CPF. Falha de leitura
  // (RLS, offline) = não pergunta: sem nota, o CPF não teria para onde ir.
  const tenantIdFiscal = kioskSession?.tenantId ?? user?.tenantId ?? null;
  useEffect(() => {
    let vivo = true;
    if (!tenantIdFiscal) { setPerguntarCpf(false); return; }
    supabase
      .from('fiscal_settings')
      .select('enabled, emit_on_counter')
      .eq('tenant_id', tenantIdFiscal)
      .maybeSingle()
      .then(({ data }) => {
        if (vivo) setPerguntarCpf(!!data?.enabled && data?.emit_on_counter !== false);
      }, () => { if (vivo) setPerguntarCpf(false); });
    return () => { vivo = false; };
  }, [tenantIdFiscal]);
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

  // ── Auto-refresh do cardápio no totem ──────────────────────────────────────
  // O CardapioContext só carrega o menu no mount e após edições feitas NO MESMO
  // dispositivo. Como o totem fica ligado o dia todo e os preços/itens são
  // editados no admin (outro dispositivo), sem isto o totem mostraria dados
  // antigos em memória indefinidamente. Recarrega (silencioso, sem piscar):
  //  - toda vez que volta à tela inicial (entre um cliente e outro);
  //  - periodicamente a cada 3 min como rede de segurança.
  useEffect(() => {
    if (etapa === 'welcome') recarregarCardapio({ silent: true });
  }, [etapa, recarregarCardapio]);

  // ── Versão nova publicada ──────────────────────────────────────────────────
  // O totem fica ligado dias seguidos: sem isto ele continuava rodando o build de
  // antes do deploy até alguém lembrar de recarregar (foi o que segurou a correção
  // do "Cancelar" da maquininha em 2026-09-21). Confere de 5 em 5 min e se atualiza
  // SOZINHO na tela inicial, com o carrinho vazio — nunca no meio de um pedido.
  const [versaoNova, setVersaoNova] = useState(false);
  useEffect(() => {
    let vivo = true;
    const conferir = () => { void haVersaoNova().then((tem) => { if (vivo && tem) setVersaoNova(true); }); };
    conferir();
    const interval = setInterval(conferir, 5 * 60 * 1000);
    return () => { vivo = false; clearInterval(interval); };
  }, []);
  const ocioso = etapa === 'welcome' && carrinho.length === 0;
  useEffect(() => {
    if (versaoNova && ocioso) recarregarAppSozinho();
  }, [versaoNova, ocioso]);

  useEffect(() => {
    const interval = setInterval(() => recarregarCardapio({ silent: true }), 3 * 60 * 1000);
    return () => clearInterval(interval);
  }, [recarregarCardapio]);

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
    if (e === 'cpf' && !perguntarCpf) return false;
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

  // Depois da identificação (ou direto do carrinho, quando não há identificação)
  // vem o CPF na nota — se a loja emite NFC-e. Senão, segue para o pagamento.
  const etapaDepoisDoCpf = (): Etapa => (pagarNaEntrega ? 'forma_pagamento' : 'pagamento');

  const handleAvancarCarrinho = () => {
    if (pularIdentificacao) {
      setEtapa(perguntarCpf ? 'cpf' : etapaDepoisDoCpf());
    } else {
      setEtapa('identificacao');
    }
  };

  const handleIdentificacaoConcluida = (nome: string, senha: string) => {
    setIdentifNome(nome);
    setIdentifSenha(senha);
    setEtapa(perguntarCpf ? 'cpf' : etapaDepoisDoCpf());
  };

  const handleCpfConcluido = (cpf: string | null) => {
    setCpfNota(cpf);
    setEtapa(etapaDepoisDoCpf());
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
  // Criação em andamento: quem chegar no meio (ex.: 2º aviso de pagamento aprovado) espera
  // e recebe o MESMO pedido, em vez de null ("pedido não registrado" falso com o pedido pago).
  const criacaoEmAndamentoRef = useRef<Promise<string | null> | null>(null);

  // Cria o pedido no banco e retorna o ID e número
  const criarPedidoBanco = useCallback(async (paidPixPaymentId?: string, formaBalcaoNome?: string, segurarAtePagar?: boolean): Promise<{ id: string; numero: number } | null> => {
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

    // Forma a pagar no balcão: a do modo "entrega" (tela própria) ou a escolhida no
    // PagamentoKiosk (cartão/dinheiro sem maquininha integrada). Pix pago não entra aqui.
    const formaAPagar = typeof paidPixPaymentId === 'string'
      ? null
      : (formaBalcaoNome || (pagarNaEntrega ? formaPagamentoNome : null));
    // "Pagamento na entrega: X" é o marcador que o KDS/Gestor já leem (KDSContext › paymentMethodName).
    const notaPagamento = formaAPagar ? `Pagamento na entrega: ${formaAPagar}` : null;
    const paraViagem = destino === 'viagem';
    // Observação geral do pedido (orders.notes).
    const notasPedido = [
      ...(paraViagem ? ['[VIAGEM]'] : []),
      ...(formaAPagar ? [`Pagar no balcão: ${formaAPagar}`] : []),
    ].join(' · ') || null;

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
        // Em todos os itens: no KDS cada estação só vê os próprios itens.
        ...(paraViagem ? [{ text: '[VIAGEM]' }] : []),
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
          // CPF na nota: a NFC-e automática (order-write › triggerFiscalEmit) lê orders.customer_cpf.
          customer_cpf: cpfNota,
          notes: notasPedido,
          // Pix já pago: o pedido nasce pago em vez de ficar "em aberto" até o record_payment.
          ...(typeof paidPixPaymentId === 'string' ? { paid_pix_payment_id: paidPixPaymentId } : {}),
          // Dinheiro: só vai pra cozinha quando o caixa receber (o PDV libera e imprime).
          ...(segurarAtePagar ? { hold_until_paid: true } : {}),
        },
        { externalToken: kioskToken, paraViagem, enqueuePrint: !segurarAtePagar },
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
  }, [carrinho, identifNome, identifSenha, cpfNota, modoIdentificacao, pagarNaEntrega, formaPagamentoNome, destino, getTenantAndSession, submitOrder, user?.modoTreino, kioskSession?.accessToken]);


  // paidPixPaymentId só vale como texto: esta função também é usada direto em botões (recebe o evento).
  const handleAvancarPagamento = useCallback(async (paidPixPaymentId?: unknown, formaBalcaoNome?: unknown, segurarAtePagar?: unknown): Promise<string | null> => {
    // Padrão ref+state duplo:
    // - criarPedidoRef bloqueia no mesmo tick (state não atualiza rápido o suficiente)
    // - pendingOrderId bloqueia chamadas subsequentes após o primeiro ciclo
    if (criarPedidoRef.current) {
      console.log('[Autoatendimento] handleAvancarPagamento: criação já em andamento — aguardando o mesmo pedido');
      return criacaoEmAndamentoRef.current ? await criacaoEmAndamentoRef.current : null;
    }
    if (pendingOrderId) {
      console.log('[Autoatendimento] handleAvancarPagamento: pedido já criado, ignorando', pendingOrderId);
      return pendingOrderId;
    }
    criarPedidoRef.current = true;
    const criacao = (async (): Promise<string | null> => {
      console.log('[Autoatendimento] handleAvancarPagamento: chamando criarPedidoBanco...');
      const result = await criarPedidoBanco(
        typeof paidPixPaymentId === 'string' ? paidPixPaymentId : undefined,
        typeof formaBalcaoNome === 'string' ? formaBalcaoNome : undefined,
        segurarAtePagar === true,
      );
      console.log('[Autoatendimento] handleAvancarPagamento: pedido criado =', result);
      if (result) {
        setPendingOrderId(result.id);
        setPendingOrderNumber(result.numero);
        if (typeof paidPixPaymentId === 'string') marcarPedidoPago(true);

        // Impressão é gerenciada pelo useOrderSubmit via fila centralizada
        return result.id;
      }
      console.warn('[Autoatendimento] handleAvancarPagamento: criarPedidoBanco retornou null — pedido não salvo no banco');
      return null;
    })();
    criacaoEmAndamentoRef.current = criacao;
    try {
      return await criacao;
    } finally {
      criarPedidoRef.current = false;
      criacaoEmAndamentoRef.current = null;
    }
  }, [criarPedidoBanco, pendingOrderId, marcarPedidoPago]);

  // Grava o pagamento do pedido no caixa aberto, SEM voltar o tablet pro início — o Pix
  // confirmado precisa mostrar a tela "Pedido confirmado" depois de gravar. Lança erro se falhar.
  const registrarPagamento = useCallback(async (paymentMethodId: string, effectiveOrderId: string) => {
    const { tenantId, sessionId } = getTenantAndSession();
    if (!sessionId || !tenantId) throw new Error('Sessão do caixa não encontrada — o pagamento não foi registrado.');
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
          marcarPedidoPago(true);
          // O builder do Supabase não tem .catch (só .then): .catch aqui lançava erro DEPOIS do pagamento gravado.
          supabase.rpc('fn_update_paid_by_pdv', { p_order_id: effectiveOrderId, p_paid_by_pdv: 'self_service' }).then(() => {}, () => {});
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
  }, [caixa, getTenantAndSession, carrinho, kioskInvoke, marcarPedidoPago]);

  // orderId explícito: quem acabou de criar o pedido ainda vê pendingOrderId antigo (null)
  // nesta callback — sem ele o pagamento era pulado em silêncio.
  const handleConcluir = useCallback(async (paymentMethodId?: string, orderId?: string) => {
    const effectiveOrderId = orderId ?? pendingOrderId;
    const { tenantId, sessionId } = getTenantAndSession();

    if (effectiveOrderId && paymentMethodId && sessionId && tenantId) {
      await registrarPagamento(paymentMethodId, effectiveOrderId);
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
          // buildOfflineCreateOrderBody espalha o create_payload antes dos campos legados:
          // o CPF da nota sobrevive à sincronização.
          create_payload: cpfNota ? { customer_cpf: cpfNota } : undefined,
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
    setCpfNota(null);
    setPendingOrderId(null);
    setPendingOrderNumber(null);
    marcarPedidoPago(false);
    setFormaPagamentoId(null);
    setFormaPagamentoNome(null);
    setAlertaParcialKiosk(null);
    setEtapa('welcome');
  }, [
    pendingOrderId, caixa, getTenantAndSession, carrinho,
    identifNome, identifSenha, cpfNota, modoIdentificacao,
    addPedido, reloadOrders, kioskInvoke, registrarPagamento,
  ]);

  const handleCancelar = useCallback(async () => {
    // Pedido já pago não é cancelado aqui (o dinheiro ficaria sem pedido): só volta à tela inicial;
    // o pedido segue para a cozinha e o estorno é com o caixa. O servidor também recusa (order_paid_use_refund).
    if (pendingOrderId && !pedidoPagoRef.current) {
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
    setCpfNota(null);
    setPendingOrderId(null);
    setPendingOrderNumber(null);
    marcarPedidoPago(false);
    setFormaPagamentoId(null);
    setFormaPagamentoNome(null);
    setAlertaParcialKiosk(null);
    setEtapa('welcome');
  }, [pendingOrderId, getTenantAndSession, kioskInvoke, marcarPedidoPago]);

  // ── Inatividade: cliente largou o totem no meio do pedido ──────────────────
  // 90s sem toque → aviso "Ainda está aí?" com contagem de 15s → limpa o carrinho e
  // volta à tela inicial. Não roda na tela inicial nem com o modal de configuração aberto.
  // Na etapa de pagamento o prazo é maior (3 min) e NUNCA roda com cobrança em andamento
  // (Pix gerado, cartão na maquininha, registrando/confirmado) nem com pedido já criado.
  // Regra do dono (2026-09-25, tablet 2 de Paranaguá parado na tela de pagamento): NENHUMA tela
  // fica parada para sempre. Com cobrança em andamento (Pix na tela, cartão na maquininha) ou pedido
  // já criado, o prazo é 11 min — o Pix vence em 10, então não dá mais para pagar depois disso.
  const [cobrancaEmAndamento, setCobrancaEmAndamento] = useState(false);
  const cobrancaAberta = etapa === 'pagamento' && (cobrancaEmAndamento || !!pendingOrderId);
  const INATIVIDADE_MS = cobrancaAberta ? 660_000 : etapa === 'pagamento' ? 180_000 : 90_000;
  const AVISO_SEGUNDOS = 15;
  const ultimaAtividadeRef = useRef(Date.now());
  const [avisoInatividade, setAvisoInatividade] = useState<number | null>(null);
  const monitorarInatividade = etapa !== 'welcome' && !showConfigModal;
  // Pedido já pago não se cancela: só volta ao início (segue pago e na cozinha).
  const handleCancelarRef = useRef(handleCancelar);
  handleCancelarRef.current = () => (pedidoPagoRef.current ? handleConcluir() : handleCancelar());

  useEffect(() => {
    ultimaAtividadeRef.current = Date.now();
    setAvisoInatividade(null);
    if (!monitorarInatividade) return;
    const marcar = () => { ultimaAtividadeRef.current = Date.now(); };
    const eventos = ['pointerdown', 'touchstart', 'keydown', 'wheel'] as const;
    eventos.forEach((ev) => window.addEventListener(ev, marcar, { capture: true, passive: true }));
    const interval = setInterval(() => {
      const parado = Date.now() - ultimaAtividadeRef.current;
      if (parado < INATIVIDADE_MS) { setAvisoInatividade(null); return; }
      const restante = AVISO_SEGUNDOS - Math.floor((parado - INATIVIDADE_MS) / 1000);
      if (restante <= 0) {
        setAvisoInatividade(null);
        handleCancelarRef.current();
        return;
      }
      setAvisoInatividade(restante);
    }, 1000);
    return () => {
      eventos.forEach((ev) => window.removeEventListener(ev, marcar, { capture: true }));
      clearInterval(interval);
    };
  }, [monitorarInatividade, etapa, INATIVIDADE_MS]);

  const marcarTotemOffline = useCallback(async () => {
    const userId = kioskSession?.kioskUserId ?? user?.id;
    if (!userId) return;
    try {
      await supabase.rpc('fn_kiosk_set_offline', { p_user_id: userId });
    } catch (e) {
      console.warn('[Autoatendimento] marcarTotemOffline error (non-blocking):', e);
    }
  }, [kioskSession?.kioskUserId, user?.id]);

  const digitarLogout = (d: string) => {
    setLogoutErro('');
    if (logoutCampo === 'matricula') setLogoutMatricula((m) => (m.length < 8 ? m + d : m));
    else setLogoutPin((p) => (p.length < 8 ? p + d : p));
  };
  // Apagar com o PIN vazio volta para a matrícula
  const apagarLogout = () => {
    setLogoutErro('');
    if (logoutCampo === 'matricula') { setLogoutMatricula((m) => m.slice(0, -1)); return; }
    if (!logoutPin) { if (!matriculaTablet) setLogoutCampo('matricula'); return; }
    setLogoutPin((p) => p.slice(0, -1));
  };
  const limparLogout = () => {
    setLogoutErro('');
    if (logoutCampo === 'matricula') setLogoutMatricula('');
    else setLogoutPin('');
  };
  // Fechar não zera as tentativas: o bloqueio só sai recarregando a página
  const fecharLogout = () => {
    setShowLogoutPin(false);
    setLogoutPin('');
    setLogoutMatricula('');
    setLogoutCampo(matriculaTablet ? 'pin' : 'matricula');
    setLogoutErro(logoutBloqueado ? 'Muitas tentativas. Tente novamente mais tarde.' : '');
  };

  const handleLogoutComPin = useCallback(async () => {
    if (logoutBloqueado) { setLogoutErro('Muitas tentativas. Tente novamente mais tarde.'); return; }
    if (logoutCampo === 'matricula') {
      if (!logoutMatricula.trim()) { setLogoutErro('Digite a matrícula'); return; }
      setLogoutCampo('pin');
      setLogoutErro('');
      return;
    }
    if (!logoutPin.trim()) { setLogoutErro('Digite o PIN'); return; }
    setLogoutLoading(true);
    try {
      const tenantId = kioskSession?.tenantId ?? user?.tenantId;
      const r = matriculaTablet
        ? await validarPinTablet(kioskInvoke, { matricula: matriculaTablet, pin: logoutPin, tenantId })
        : await validarPinGerente(kioskInvoke, { matricula: logoutMatricula, pin: logoutPin, tenantId });
      if (!r.ok) {
        if (r.contaTentativa) {
          const n = logoutTentativas + 1;
          setLogoutTentativas(n);
          setLogoutPin('');
          setLogoutErro(n >= MAX_TENTATIVAS_PIN_GERENTE ? 'Muitas tentativas. Tente novamente mais tarde.' : r.erro);
        } else {
          setLogoutErro(r.erro);
        }
        return;
      }
      await marcarTotemOffline();
      logout();
      navigate('/login');
    } finally {
      setLogoutLoading(false);
    }
  }, [logoutBloqueado, logoutCampo, logoutMatricula, logoutPin, logoutTentativas, matriculaTablet, kioskInvoke, kioskSession?.tenantId, user?.tenantId, logout, navigate, marcarTotemOffline]);

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
            <p className="text-zinc-400 text-sm font-semibold">{matriculaTablet ? 'PIN do tablet para sair' : logoutCampo === 'matricula' ? 'Matrícula do gerente para sair' : 'PIN do gerente para sair'}</p>
            {/* Display do PIN */}
            <div className="flex gap-3 justify-center">
              {Array.from({ length: Math.max(4, logoutDisplay.length) }).map((_, i) => (
                <div key={i} className={`w-10 h-10 rounded-xl border-2 flex items-center justify-center text-xl font-black transition-all ${
                  i < logoutDisplay.length ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-700 bg-zinc-800 text-zinc-600'
                }`}>
                  {i < logoutDisplay.length ? (logoutCampo === 'matricula' ? logoutDisplay[i] : '●') : '○'}
                </div>
              ))}
            </div>
            {/* Travado: a mensagem fica enquanto o bloqueio durar (digitar não a apaga) */}
            {(logoutBloqueado || logoutErro) && <p className="text-red-400 text-sm font-semibold">{logoutBloqueado ? 'Muitas tentativas. Tente novamente mais tarde.' : logoutErro}</p>}
            {/* Teclado numérico */}
            <div className="grid grid-cols-3 gap-2 w-full">
              {['1','2','3','4','5','6','7','8','9'].map((n) => (
                <button key={n} onClick={() => digitarLogout(n)}
                  className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-xl font-bold rounded-xl cursor-pointer transition-colors">
                  {n}
                </button>
              ))}
              <button onClick={limparLogout}
                className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-red-900/40 text-zinc-500 hover:text-red-400 text-sm font-bold rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-bin-line text-lg" />
              </button>
              <button onClick={() => digitarLogout('0')}
                className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-xl font-bold rounded-xl cursor-pointer transition-colors">
                0
              </button>
              <button onClick={apagarLogout}
                className="h-14 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 text-sm font-bold rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-back-2-line text-lg" />
              </button>
            </div>
            <div className="flex gap-3 w-full">
              <button
                onClick={fecharLogout}
                className="flex-1 py-3 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleLogoutComPin}
                disabled={logoutLoading || logoutBloqueado}
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
        {/* O seletor precisa estar na PRIMEIRA tela: e nela que o cliente
            estrangeiro decide se consegue usar o totem. Fixo no topo, como no
            resto do fluxo. */}
        {idiomaCardapio.temSeletor ? (
          <div className="fixed top-0 left-0 right-0 z-[90]">
            <SeletorIdioma
              variante="fixo"
              disponiveis={idiomaCardapio.disponiveis}
              idioma={idiomaCardapio.idioma}
              onTrocar={idiomaCardapio.trocarIdioma}
            />
          </div>
        ) : null}
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
            <p className="text-zinc-300 text-sm font-semibold self-start">{matriculaTablet ? 'PIN do tablet para sair' : logoutCampo === 'matricula' ? 'Matrícula do gerente para sair' : 'PIN do gerente para sair'}</p>
            {/* Display do PIN */}
            <div className="flex gap-2 justify-center w-full">
              {Array.from({ length: Math.max(4, logoutDisplay.length) }).map((_, i) => (
                <div key={i} className={`flex-1 h-10 rounded-xl border-2 flex items-center justify-center text-lg font-black transition-all ${
                  i < logoutDisplay.length ? 'border-amber-500 bg-amber-500/10 text-amber-400' : 'border-zinc-700 bg-zinc-800 text-zinc-600'
                }`}>
                  {i < logoutDisplay.length ? (logoutCampo === 'matricula' ? logoutDisplay[i] : '●') : '○'}
                </div>
              ))}
            </div>
            {(logoutBloqueado || logoutErro) && <p className="text-red-400 text-xs font-semibold self-start">{logoutBloqueado ? 'Muitas tentativas. Tente novamente mais tarde.' : logoutErro}</p>}
            {/* Teclado numérico */}
            <div className="grid grid-cols-3 gap-1.5 w-full">
              {['1','2','3','4','5','6','7','8','9'].map((n) => (
                <button key={n} onClick={() => digitarLogout(n)}
                  className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-lg font-bold rounded-xl cursor-pointer transition-colors">
                  {n}
                </button>
              ))}
              <button onClick={limparLogout}
                className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-red-900/40 text-zinc-500 hover:text-red-400 rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-bin-line text-base" />
              </button>
              <button onClick={() => digitarLogout('0')}
                className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 text-white text-lg font-bold rounded-xl cursor-pointer transition-colors">
                0
              </button>
              <button onClick={apagarLogout}
                className="h-12 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl cursor-pointer transition-colors">
                <i className="ri-delete-back-2-line text-base" />
              </button>
            </div>
            <div className="flex gap-2 w-full">
              <button
                onClick={fecharLogout}
                className="flex-1 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-400 text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleLogoutComPin}
                disabled={logoutLoading || logoutBloqueado}
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
  const ETAPAS_LABEL = getEtapasLabel(pagarNaEntrega, t);

  return (
    <div className="fixed inset-0 bg-zinc-950 flex flex-col overflow-hidden">
      {/* Seletor de idioma preso no topo da janela: no tablet a pessoa chega e
          precisa VER na hora que da pra trocar, sem procurar menu. */}
      {idiomaCardapio.temSeletor ? (
        <SeletorIdioma
          variante="fixo"
          disponiveis={idiomaCardapio.disponiveis}
          idioma={idiomaCardapio.idioma}
          onTrocar={idiomaCardapio.trocarIdioma}
        />
      ) : null}
      {etapa !== 'welcome' && etapa !== 'destino' && (
        <div className="flex items-center justify-between gap-3 px-4 lg:px-6 py-3 bg-zinc-900 border-b border-zinc-800 flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-500 rounded-xl">
              <span className="text-base">🍔</span>
            </div>
            <div className="flex items-center gap-2 min-w-0">
              <span className="hidden xl:inline text-white font-black text-base whitespace-nowrap">ERPOS V2 — Autoatendimento</span>
              {destino && (
                <span className={`text-xs font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${
                  destino === 'aqui' ? 'bg-amber-500/20 text-amber-400' : 'bg-zinc-700 text-zinc-300'
                }`}>
                  <i className={`mr-1 ${destino === 'aqui' ? 'ri-store-2-line' : 'ri-shopping-bag-3-line'}`} />
                  {destino === 'aqui' ? t('cliente.comerAqui') : t('cliente.paraViagem')}
                </span>
              )}
            </div>
          </div>

          {/* Indicadores de etapa: só em telas largas; em tablet (768–1024px) mostram apenas o número
              da etapa atual para os botões (engrenagem, tela cheia, Cancelar) nunca saírem da tela. */}
          <div className="hidden lg:flex items-center gap-2 min-w-0">
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
                  <span className={etapa === e ? '' : 'hidden xl:inline'}>{ETAPAS_LABEL[e]}</span>
                </div>
                {i < etapasVisiveis.length - 1 && <div className="w-4 h-0.5 bg-zinc-700" />}
              </div>
            ))}
          </div>
          {etapaIndex >= 0 && (
            <span className="lg:hidden flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-bold bg-amber-500 text-zinc-950 whitespace-nowrap">
              {etapaIndex + 1}/{etapasVisiveis.length} {ETAPAS_LABEL[etapa as typeof etapasVisiveis[number]]}
            </span>
          )}

          <div className="flex items-center gap-2 flex-shrink-0">
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
            {pedidoPago ? (
              // Pedido pago não se cancela, mas o tablet nunca pode ficar preso nele (Tablet 2 de
              // Paranaguá, 2026-09-25: Pix pago + erro ao lançar no caixa = tela sem saída).
              // "Concluir" só volta ao início; o pedido segue pago e na cozinha.
              <button
                onClick={() => { void handleConcluir(); }}
                className="px-4 py-1.5 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 text-xs font-semibold rounded-xl whitespace-nowrap cursor-pointer"
              >
                Pedido pago · Concluir
              </button>
            ) : (
              <button
                onClick={handleCancelar}
                className="px-4 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white text-xs font-semibold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
              >
                Cancelar
              </button>
            )}
          </div>
        </div>
      )}

      {showConfigModal && <KioskConfigModal onClose={() => setShowConfigModal(false)} />}

      {avisoInatividade !== null && (
        <div
          className="fixed inset-0 z-[150] flex items-center justify-center bg-black/70 p-6"
          onPointerDown={() => { ultimaAtividadeRef.current = Date.now(); setAvisoInatividade(null); }}
        >
          <div className="bg-zinc-900 border border-zinc-700 rounded-3xl p-8 max-w-md w-full text-center">
            <div className="w-16 h-16 mx-auto mb-4 flex items-center justify-center bg-amber-500/15 rounded-2xl">
              <i className="ri-time-line text-4xl text-amber-400" />
            </div>
            <h2 className="text-3xl font-black text-white mb-2">Ainda está aí?</h2>
            <p className="text-zinc-400 text-lg mb-6">
              {pedidoPago ? 'Voltando à tela inicial em ' : 'Seu pedido será cancelado em '}
              <span className="text-amber-400 font-black">{avisoInatividade}s</span>
            </p>
            <button className="w-full py-4 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-black text-xl rounded-2xl cursor-pointer">
              Continuar pedido
            </button>
          </div>
        </div>
      )}

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
            traduzir={idiomaCardapio.traduzir}
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
            traduzir={idiomaCardapio.traduzir}
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
        {etapa === 'cpf' && (
          <CpfKiosk
            total={carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0)}
            onContinuar={handleCpfConcluido}
            onVoltar={() => setEtapa(pularIdentificacao ? 'carrinho' : 'identificacao')}
          />
        )}
        {etapa === 'forma_pagamento' && (
          <FormaPagamentoKiosk
            total={carrinho.reduce((s, i) => s + i.preco * i.quantidade, 0)}
            onContinuar={handleFormaPagamentoConcluida}
            onVoltar={() => setEtapa(perguntarCpf ? 'cpf' : (pularIdentificacao ? 'carrinho' : 'identificacao'))}
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
            formasPermitidas={settings.self_service_payment_methods ?? null}
            hasCaixa={!!caixa}
            formaPagamentoNome={formaPagamentoNome ?? undefined}
            orderNumber={pendingOrderNumber ?? undefined}
            alertaParcial={alertaParcialKiosk ?? undefined}
            onEntrarPagamento={handleAvancarPagamento}
            onRegistrarPagamento={registrarPagamento}
            onConcluir={handleConcluir}
            onCobrancaEmAndamento={setCobrancaEmAndamento}
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

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useKDS } from '@/contexts/KDSContext';
import { useSessao } from '@/contexts/SessaoContext';
import { useAuth } from '@/contexts/AuthContext';
import type { KDSPedido, KDSItem, KDSItemStatus } from '@/types/kds';
import GestorKanbanView from './components/GestorKanbanView';
import GestorListView from './components/GestorListView';
import GestorMesasView from './components/GestorMesasView';
import ObsGateModal, { type ObsGateTipo } from '@/components/feature/ObsGateModal';
import EntregaGateModal from '@/components/feature/EntregaGateModal';
import CancelOrderModal from './components/CancelOrderModal';
import PedidoDetailModal from './components/PedidoDetailModal';
import HistoricoDrawer from './components/HistoricoDrawer';

type Visualizacao = 'kanban' | 'lista' | 'mesas';
type FiltroStatus = 'todos' | 'novo' | 'preparo' | 'pronto' | 'entregue' | 'cancelado';
type FiltroOrigem = 'todas' | 'caixa' | 'garcom' | 'mesa' | 'autoatendimento' | 'delivery';
type FiltroPagamento = 'todos' | 'pagos' | 'nao-pagos';

interface PendingObsAction {
  tipo: ObsGateTipo;
  itensComObs: KDSItem[];
  onConfirm: () => void;
}

interface PendingEntregaAction {
  pedido: KDSPedido;
  onConfirm: () => void;
}

interface PendingCancelAction {
  pedido: KDSPedido;
}

interface ToastNovo {
  id: string;
  numero: number;
  destino: string;
}

function deriveItemStatus(item: KDSItem): KDSItemStatus {
  if (item.unidades && item.unidades.length > 0) {
    const statuses = item.unidades.map((u) => u.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  return item.status;
}

function derivePedidoStatus(pedido: KDSPedido): KDSPedido['status'] {
  // Pedidos cancelados mantêm status visual "entregue" no kanban,
  // mas o filtro usa isCancelled separadamente
  const allStatuses = pedido.itens.map((i) => deriveItemStatus(i));
  if (allStatuses.every((s) => s === 'entregue')) return 'entregue';

  const kitchenItens = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  const kitchenStatuses = kitchenItens.map((i) => deriveItemStatus(i));

  if (kitchenItens.length === 0) {
    if (allStatuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    return 'novo';
  }
  if (kitchenStatuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
  if (kitchenStatuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
  return 'novo';
}

function getEstacoesDoPedido(pedido: KDSPedido): string[] {
  const set = new Set<string>();
  pedido.itens.forEach((i) => {
    if (i.estacao) set.add(i.estacao);
    i.partes?.forEach((p) => { if (p.estacao) set.add(p.estacao); });
  });
  return [...set];
}

function destinoToast(pedido: KDSPedido): string {
  if (pedido.destino === 'mesa') return `Mesa ${pedido.mesaNumero}`;
  if (pedido.destino === 'delivery') return 'Delivery';
  if (pedido.nomeCliente) return pedido.nomeCliente;
  return 'Balcão';
}

export default function GestorPedidosPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { pedidos, setPedidos, updateItemStatusRemote, updateUnitStatusRemote, cancelOrderRemote, reloadOrders, pedidosSalvando } = useKDS();
  const { estado, sessao, loadingSession } = useSessao();
  const { user } = useAuth();

  const [visualizacao, setVisualizacao] = useState<Visualizacao>('kanban');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [filtroEstacao, setFiltroEstacao] = useState<string>('todas');
  const [filtroOrigem, setFiltroOrigem] = useState<FiltroOrigem>('todas');
  const [filtroPagamento, setFiltroPagamento] = useState<FiltroPagamento>('todos');
  const [tick, setTick] = useState(0);
  const [clock, setClock] = useState(new Date());
  const [busca, setBusca] = useState('');
  const [somAtivado, setSomAtivado] = useState(true);
  const [toasts, setToasts] = useState<ToastNovo[]>([]);
  const [showStats, setShowStats] = useState(false);
  const [showHistorico, setShowHistorico] = useState(false);
  const [prontoAlertDismissedAt, setProntoAlertDismissedAt] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [pedidosSalvandoDismissedAt, setPedidosSalvandoDismissedAt] = useState<number>(0);
  const prevIdsRef = useRef<Set<string>>(new Set(pedidos.map((p) => p.id)));
  const audioCtxRef = useRef<AudioContext | null>(null);

  // Aplicar filtro de pagamento vindo do dashboard (navegação)
  useEffect(() => {
    const state = location.state as { filtroPagamento?: FiltroPagamento } | null;
    if (state?.filtroPagamento) {
      setFiltroPagamento(state.filtroPagamento);
      // Limpar o state para não reaplicar em refresh
      navigate(location.pathname, { replace: true, state: {} });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.state]);

  // ─── Som de alerta ───
  const tocarAlerta = useCallback(() => {
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      const playBip = (freq: number, endFreq: number, delay: number, dur: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + delay);
        osc.frequency.exponentialRampToValueAtTime(endFreq, ctx.currentTime + delay + dur);
        gain.gain.setValueAtTime(0.35, ctx.currentTime + delay);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + delay + dur);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + dur);
      };
      playBip(880, 440, 0, 0.3);
      playBip(1200, 900, 0.35, 0.25);
    } catch (e) {
      console.warn('[GestorPedidos] Som indisponível', e);
    }
  }, []);

  const [obsModal, setObsModal] = useState<PendingObsAction | null>(null);
  const [entregaModal, setEntregaModal] = useState<PendingEntregaAction | null>(null);
  const [cancelModal, setCancelModal] = useState<PendingCancelAction | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [detailPedidoId, setDetailPedidoId] = useState<string | null>(null);

  // Tick do relógio — a cada segundo
  useEffect(() => {
    const id = setInterval(() => {
      setTick((t) => t + 1);
      setClock(new Date());
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Detectar novos pedidos → toast + som
  useEffect(() => {
    const currentIds = new Set(pedidos.map((p) => p.id));
    const newPedidos: KDSPedido[] = [];
    pedidos.forEach((p) => {
      if (!prevIdsRef.current.has(p.id)) newPedidos.push(p);
    });

    if (newPedidos.length > 0) {
      if (somAtivado) tocarAlerta();
      const novosToasts: ToastNovo[] = newPedidos.map((p) => ({
        id: p.id,
        numero: p.numero,
        destino: destinoToast(p),
      }));
      setToasts((prev) => [...prev, ...novosToasts]);
      novosToasts.forEach((t) => {
        setTimeout(() => {
          setToasts((prev) => prev.filter((x) => x.id !== t.id));
        }, 5000);
      });
    }
    prevIdsRef.current = currentIds;
  }, [pedidos, somAtivado, tocarAlerta]);

  const getItensComObs = (pedido: KDSPedido): KDSItem[] =>
    pedido.itens.filter((i) => i.observacoes && i.observacoes.length > 0);

  // ─── Cancelar Pedido ───
  const handleCancelarPedido = useCallback((pedidoId: string) => {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    setCancelModal({ pedido });
  }, [pedidos]);

  const executarCancelamento = useCallback(async (reason: string, autorizadoPor?: string) => {
    if (!cancelModal) return;
    setCancelLoading(true);
    const motivoFinal = autorizadoPor
      ? `${reason} [Autorizado por: ${autorizadoPor}]`
      : reason;
    const result = await cancelOrderRemote(cancelModal.pedido.id, motivoFinal);
    setCancelLoading(false);
    if (result.ok) setCancelModal(null);
  }, [cancelModal, cancelOrderRemote]);

  // ─── Iniciar Preparo ───
  const handleIniciarPreparo = useCallback((pedidoId: string) => {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    if (pedido.isEditing) return;
    if (derivePedidoStatus(pedido) !== 'novo') return;

    const itensComObs = getItensComObs(pedido);
    const operador = user?.nome ?? 'Operador';

    const executar = () => {
      const now = Date.now();
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.semPreparo || i.skip_kds) return i;
            return {
              ...i,
              status: 'preparo' as KDSItemStatus,
              iniciouPreparoEm: i.iniciouPreparoEm ?? now,
              operadorPreparo: i.operadorPreparo ?? operador,
              unidades: i.unidades?.map((u) => ({
                ...u,
                status: u.status === 'novo' ? ('preparo' as KDSItemStatus) : u.status,
                iniciouPreparoEm: u.iniciouPreparoEm ?? now,
                operadorPreparo: u.operadorPreparo ?? operador,
              })),
            };
          });
          return { ...p, itens, status: 'preparo' };
        }),
      );
      pedido.itens.forEach((item) => {
        if (item.status === 'novo' && !item.semPreparo && !item.skip_kds) {
          updateItemStatusRemote(item.id, pedidoId, 'preparo');
        }
      });
    };

    if (itensComObs.length > 0) {
      setObsModal({ tipo: 'iniciar', itensComObs, onConfirm: executar });
    } else {
      executar();
    }
  }, [pedidos, user, setPedidos, updateItemStatusRemote]);

  // ─── Marcar Pronto ───
  const handleMarcarPronto = useCallback((pedidoId: string) => {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    if (pedido.isEditing) return;
    if (derivePedidoStatus(pedido) !== 'preparo') return;
    const itensComObs = getItensComObs(pedido);

    const executar = () => {
      const now = Date.now();
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.semPreparo || i.skip_kds) return i;
            return {
              ...i,
              status: 'pronto' as KDSItemStatus,
              ficouProntoEm: i.ficouProntoEm ?? now,
              unidades: i.unidades?.map((u) => ({
                ...u,
                status: u.status === 'pronto' || u.status === 'entregue' ? u.status : ('pronto' as KDSItemStatus),
                ficouProntoEm: u.ficouProntoEm ?? now,
              })),
            };
          });
          return { ...p, itens, status: 'pronto' };
        }),
      );
      pedido.itens.forEach((item) => {
        if (item.status !== 'pronto' && item.status !== 'entregue' && !item.semPreparo && !item.skip_kds) {
          updateItemStatusRemote(item.id, pedidoId, 'pronto');
        }
      });
    };

    if (itensComObs.length > 0) {
      setObsModal({ tipo: 'pronto', itensComObs, onConfirm: executar });
    } else {
      executar();
    }
  }, [pedidos, setPedidos, updateItemStatusRemote]);

  // ─── Avançar ───
  const handleAvancar = useCallback((pedidoId: string) => {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    if (pedido.isEditing) return;
    const derived = derivePedidoStatus(pedido);
    if (derived === 'novo') handleIniciarPreparo(pedidoId);
    else if (derived === 'preparo') handleMarcarPronto(pedidoId);
  }, [pedidos, handleIniciarPreparo, handleMarcarPronto]);

  // ─── Entregar ───
  const handleEntregar = useCallback((pedidoId: string) => {
    const pedido = pedidos.find((p) => p.id === pedidoId);
    if (!pedido) return;
    if (pedido.isEditing) return;

    const executar = () => {
      const now = Date.now();
      const operador = user?.nome ?? 'Operador';
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => ({
            ...i,
            status: 'entregue' as KDSItemStatus,
            entregueEm: now,
            quemEntregou: operador,
            unidades: i.unidades?.map((u) => ({
              ...u,
              status: 'entregue' as KDSItemStatus,
              entregueEm: now,
              quemEntregou: operador,
            })),
          }));
          return { ...p, itens, status: 'entregue' };
        }),
      );
      pedido.itens.forEach((item) => {
        if (item.status !== 'entregue' && !item.semPreparo) {
          updateItemStatusRemote(item.id, pedidoId, 'entregue');
        }
      });
    };

    setEntregaModal({ pedido, onConfirm: executar });
  }, [pedidos, user, setPedidos, updateItemStatusRemote]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    await reloadOrders();
    setTimeout(() => setRefreshing(false), 800);
  }, [reloadOrders]);

  const handleMudarOperador = useCallback((pedidoId: string, operador: string) => {
    setPedidos((prev) =>
      prev.map((p) => {
        if (p.id !== pedidoId) return p;
        return {
          ...p,
          itens: p.itens.map((i) => ({
            ...i,
            operadorPreparo: i.operadorPreparo ?? operador,
            unidades: i.unidades?.map((u) => ({ ...u, operadorPreparo: u.operadorPreparo ?? operador })),
          })),
        };
      }),
    );
  }, [setPedidos]);

  // ─── Computed ───
  const pedidosComStatus: KDSPedido[] = useMemo(
    () => pedidos.map((p) => ({ ...p, status: derivePedidoStatus(p) })),
    [pedidos],
  );

  const estacoesDisponiveis = useMemo(() => {
    const set = new Set<string>();
    pedidosComStatus.forEach((p) => getEstacoesDoPedido(p).forEach((e) => set.add(e)));
    return ['todas', ...Array.from(set).sort()];
  }, [pedidosComStatus]);

  const contadores = useMemo(() => ({
    novo:      pedidosComStatus.filter((p) => p.status === 'novo' && !p.isCancelled).length,
    preparo:   pedidosComStatus.filter((p) => p.status === 'preparo' && !p.isCancelled).length,
    pronto:    pedidosComStatus.filter((p) => p.status === 'pronto' && !p.isCancelled).length,
    entregue:  pedidosComStatus.filter((p) => p.status === 'entregue' && !p.isCancelled).length,
    cancelado: pedidosComStatus.filter((p) => p.isCancelled).length,
    total:     pedidosComStatus.filter((p) => !p.isCancelled).length,
  }), [pedidosComStatus]);

  const contadoresOrigem = useMemo(() => {
    const base = pedidosComStatus.filter((p) => !p.isCancelled);
    return {
      caixa:          base.filter((p) => p.origem === 'caixa').length,
      garcom:         base.filter((p) => p.origem === 'garcom').length,
      mesa:           base.filter((p) => p.origem === 'mesa').length,
      autoatendimento: base.filter((p) => p.origem === 'autoatendimento').length,
      delivery:       base.filter((p) => p.origem === 'delivery').length,
    };
  }, [pedidosComStatus]);

  // Pedidos prontos aguardando entrega há +5min
  const prontosSemEntrega = useMemo(() => {
    return pedidosComStatus.filter((p) => {
      if (p.status !== 'pronto' || p.isCancelled) return false;
      // Usa o ficouProntoEm mais recente dos itens
      const prontoEm = Math.max(...p.itens.map((i) => i.ficouProntoEm ?? 0).filter(Boolean));
      if (prontoEm === 0) return (Date.now() - p.criadoEm) / 60000 > 5;
      return (Date.now() - prontoEm) / 60000 > 5;
    }).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidosComStatus, tick]);

  const tempoMedioPreparo = useMemo(() => {
    const emPreparo = pedidosComStatus.filter((p) => p.status === 'preparo' && !p.isCancelled);
    if (emPreparo.length === 0) return null;
    const tempos = emPreparo.map((p) => (Date.now() - p.criadoEm) / 60000);
    return (tempos.reduce((a, b) => a + b, 0) / tempos.length).toFixed(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidosComStatus, tick]);

  const pedidosAtrasados = useMemo(() => {
    return pedidosComStatus.filter(
      (p) =>
        !p.isCancelled &&
        (p.status === 'preparo' || p.status === 'novo') &&
        (Date.now() - p.criadoEm) / 60000 > 20,
    ).length;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidosComStatus, tick]);

  const pedidosUltimaHora = useMemo(() => {
    const umaHoraAtras = Date.now() - 60 * 60 * 1000;
    return pedidosComStatus.filter((p) => p.criadoEm >= umaHoraAtras && !p.isCancelled).length;
  }, [pedidosComStatus]);

  const { faturamento, ticketMedio } = useMemo(() => {
    const entregues = pedidosComStatus.filter((p) => p.status === 'entregue' && !p.isCancelled && p.totalAmount > 0);
    const fat = entregues.reduce((acc, p) => acc + p.totalAmount, 0);
    const ticket = entregues.length > 0 ? fat / entregues.length : 0;
    return { faturamento: fat, ticketMedio: ticket };
  }, [pedidosComStatus]);

  // Detalhes do pedido — sempre sincronizado com o estado atual
  const detailPedido = useMemo(
    () => (detailPedidoId ? pedidosComStatus.find((p) => p.id === detailPedidoId) ?? null : null),
    [detailPedidoId, pedidosComStatus],
  );

  const filtrados = useMemo(() => {
    let result: KDSPedido[];

    if (filtroStatus === 'cancelado') {
      result = pedidosComStatus.filter((p) => p.isCancelled);
    } else if (filtroStatus === 'todos') {
      result = pedidosComStatus.filter((p) => !p.isCancelled);
    } else {
      result = pedidosComStatus.filter((p) => !p.isCancelled && p.status === filtroStatus);
    }

    if (filtroOrigem !== 'todas') {
      result = result.filter((p) => p.origem === filtroOrigem);
    }

    if (filtroEstacao !== 'todas') {
      result = result.filter(
        (p) =>
          p.itens.some((i) => i.estacao === filtroEstacao) ||
          p.itens.some((i) => i.partes?.some((part) => part.estacao === filtroEstacao)),
      );
    }

    if (filtroPagamento !== 'todos') {
      result = result.filter((p) => {
        if (filtroPagamento === 'pagos') return p.isPaid;
        return !p.isPaid;
      });
    }

    if (busca.trim()) {
      const q = busca.trim().toLowerCase().replace(/^#/, '');
      result = result.filter(
        (p) =>
          String(p.numero).includes(q) ||
          (p.nomeCliente?.toLowerCase().includes(q)) ||
          (p.mesaNumero ? String(p.mesaNumero).includes(q) : false) ||
          (p.participantToken?.toLowerCase().includes(q)) ||
          (p.participantName?.toLowerCase().includes(q)),
      );
    }

    return result;
  }, [pedidosComStatus, filtroStatus, filtroOrigem, filtroEstacao, filtroPagamento, busca]);

  const FILTROS: { key: FiltroStatus; label: string; count?: number; urgent?: boolean; danger?: boolean }[] = [
    { key: 'todos',     label: 'Ativos',      count: contadores.total },
    { key: 'novo',      label: 'Aguardando',  count: contadores.novo,      urgent: contadores.novo > 0 },
    { key: 'preparo',   label: 'Em Preparo',  count: contadores.preparo },
    { key: 'pronto',    label: 'Prontos',     count: contadores.pronto,    urgent: contadores.pronto > 0 },
    { key: 'entregue',  label: 'Entregues',   count: contadores.entregue },
    { key: 'cancelado', label: 'Cancelados',  count: contadores.cancelado, danger: true },
  ];

  const ESTACAO_CORES: Record<string, string> = {
    Grelha:      'bg-orange-100 text-orange-700 border-orange-200',
    Frituras:    'bg-yellow-100 text-yellow-700 border-yellow-200',
    Balcão:      'bg-sky-100 text-sky-700 border-sky-200',
    Confeitaria: 'bg-pink-100 text-pink-700 border-pink-200',
  };

  // ─── Gate: sem sessão ───
  if (loadingSession) {
    return (
      <div className="flex flex-col h-full bg-zinc-50 items-center justify-center p-8 text-center">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl mb-4">
          <i className="ri-loader-4-line animate-spin text-3xl text-amber-500" />
        </div>
        <p className="text-sm font-bold text-zinc-600">Verificando sessão...</p>
        <p className="text-xs text-zinc-400 mt-1">Aguarde um momento</p>
      </div>
    );
  }

  if (estado === 'sem_sessao') {
    return (
      <div className="flex flex-col h-full bg-zinc-50 items-center justify-center p-8 text-center">
        <div className="w-20 h-20 flex items-center justify-center bg-zinc-200 rounded-2xl mb-6">
          <i className="ri-lock-line text-4xl text-zinc-400" />
        </div>
        <h2 className="text-2xl font-black text-zinc-800 mb-2">Gestor Offline</h2>
        <p className="text-zinc-500 text-sm max-w-xs">
          Nenhuma sessão ativa. Abra uma sessão no PDV Caixa para liberar o Gestor de Pedidos.
        </p>
        <div className="mt-6 flex items-center gap-2 px-4 py-2 bg-zinc-100 rounded-full border border-zinc-200">
          <div className="w-2 h-2 rounded-full bg-red-400 animate-pulse" />
          <span className="text-zinc-500 text-xs font-medium">Aguardando sessão...</span>
        </div>
        <button
          onClick={() => navigate('/modulos')}
          className="mt-5 flex items-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-900 text-white text-xs font-bold rounded-xl cursor-pointer transition-colors whitespace-nowrap"
        >
          <i className="ri-arrow-left-line text-sm" />
          Voltar aos Módulos
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-50 overflow-hidden">
      {/* Modais */}
      {obsModal && (
        <ObsGateModal
          tipo={obsModal.tipo}
          itensComObs={obsModal.itensComObs}
          onConfirm={() => { obsModal.onConfirm(); setObsModal(null); }}
          onCancel={() => setObsModal(null)}
        />
      )}
      {entregaModal && (
        <EntregaGateModal
          pedido={entregaModal.pedido}
          onConfirm={() => { entregaModal.onConfirm(); setEntregaModal(null); }}
          onCancel={() => setEntregaModal(null)}
        />
      )}
      {cancelModal && (
        <CancelOrderModal
          pedido={cancelModal.pedido}
          loading={cancelLoading}
          perfilUsuario={user?.perfil}
          tenantId={user?.tenantId}
          onConfirm={executarCancelamento}
          onCancel={() => setCancelModal(null)}
        />
      )}
      {detailPedido && (
        <PedidoDetailModal
          pedido={detailPedido}
          onClose={() => setDetailPedidoId(null)}
          onCancelar={() => handleCancelarPedido(detailPedido.id)}
        />
      )}
      {showHistorico && (
        <HistoricoDrawer
          pedidos={pedidosComStatus}
          onClose={() => setShowHistorico(false)}
          onOpenDetail={(id) => {
            setShowHistorico(false);
            setDetailPedidoId(id);
          }}
        />
      )}

      {/* Toast novos pedidos */}
      {toasts.length > 0 && (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]">
          {toasts.map((t) => (
            <div
              key={t.id}
              className="flex items-center gap-3 bg-zinc-900 text-white px-4 py-3 rounded-xl pointer-events-auto animate-[slideInRight_0.3s_ease-out]"
            >
              <div className="w-8 h-8 flex items-center justify-center rounded-lg bg-amber-500 flex-shrink-0">
                <i className="ri-restaurant-line text-white text-sm" />
              </div>
              <div>
                <p className="text-xs font-black leading-none">Novo Pedido #{String(t.numero).padStart(4, '0')}</p>
                <p className="text-[10px] text-zinc-400 mt-0.5">{t.destino}</p>
              </div>
              <button
                onClick={() => setToasts((prev) => prev.filter((x) => x.id !== t.id))}
                className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/20 cursor-pointer ml-1"
              >
                <i className="ri-close-line text-[10px]" />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Alerta prontos aguardando entrega */}
      {prontosSemEntrega > 0 && Date.now() - prontoAlertDismissedAt > 60000 && (
        <div className="bg-emerald-600 px-3 py-2 flex items-center gap-2 flex-shrink-0">
          <i className="ri-check-double-line text-white text-sm animate-pulse flex-shrink-0" />
          <span className="text-white text-xs font-bold flex-1 min-w-0">
            {prontosSemEntrega} pedido{prontosSemEntrega > 1 ? 's' : ''} pronto{prontosSemEntrega > 1 ? 's' : ''} aguardando entrega há +5min
          </span>
          <button
            onClick={() => setFiltroStatus('pronto')}
            className="text-white text-[10px] font-black px-2 py-1 rounded-lg bg-white/20 hover:bg-white/30 cursor-pointer whitespace-nowrap transition-colors flex-shrink-0"
          >
            Ver
          </button>
          <button
            onClick={() => setProntoAlertDismissedAt(Date.now())}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/20 cursor-pointer text-white flex-shrink-0"
          >
            <i className="ri-close-line text-xs" />
          </button>
        </div>
      )}

      {/* ── Barra fixa: pedidos sendo atualizados pelo PDV ── */}
      {pedidosSalvando.length > 0 && (
        <div className="bg-sky-50 border-b border-sky-200 px-3 py-2 flex items-center gap-2 flex-shrink-0">
          <div className="w-4 h-4 border-2 border-sky-400 border-t-transparent rounded-full animate-spin flex-shrink-0" />
          <span className="text-xs font-bold text-sky-700 flex-shrink-0">Atualizando:</span>
          <div className="flex items-center gap-1.5 flex-1 min-w-0 overflow-hidden">
            {pedidosSalvando.map((p) => (
              <span
                key={p.id}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-white border border-sky-200 rounded-full text-[10px] font-bold text-sky-800 whitespace-nowrap"
              >
                #{String(p.numero).padStart(4, '0')}
                {p.destino === 'mesa' && p.mesaNumero && (
                  <span className="text-sky-500 font-medium">M{p.mesaNumero}</span>
                )}
                {p.destino === 'nome' && p.nomeCliente && (
                  <span className="text-sky-500 font-medium truncate max-w-[80px]">{p.nomeCliente}</span>
                )}
                {p.destino === 'senha' && p.senha && (
                  <span className="text-sky-500 font-medium">S{p.senha}</span>
                )}
              </span>
            ))}
          </div>
          <button
            onClick={() => setPedidosSalvandoDismissedAt(Date.now())}
            className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-sky-100 cursor-pointer text-sky-400 hover:text-sky-600 flex-shrink-0"
            title="Ocultar"
          >
            <i className="ri-close-line text-xs" />
          </button>
        </div>
      )}

      {/* Top Bar */}
      <div className="bg-white border-b border-zinc-100 px-3 py-2 flex items-center gap-2 flex-shrink-0">
        {/* ← Módulos */}
        <button
          onClick={() => navigate('/modulos')}
          title="Voltar aos Módulos"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-zinc-500 hover:text-zinc-800 hover:bg-zinc-100 transition-colors cursor-pointer flex-shrink-0"
        >
          <i className="ri-arrow-left-line text-sm" />
        </button>

        <div className="w-px h-5 bg-zinc-200 flex-shrink-0" />

        {/* Título + sessão */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <div className="w-6 h-6 flex items-center justify-center bg-amber-50 rounded-md flex-shrink-0">
            <i className="ri-restaurant-line text-amber-600 text-xs" />
          </div>
          <span className="text-sm font-bold text-zinc-800 hidden sm:inline">Gestor de Pedidos</span>
          {sessao && (
            <span className="text-[10px] text-zinc-400 hidden lg:inline">{sessao.numero}</span>
          )}
        </div>

        {/* Tempo médio — só desktop */}
        {tempoMedioPreparo !== null && (
          <div className="hidden lg:flex items-center gap-1 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-md flex-shrink-0">
            <i className="ri-timer-line text-zinc-400 text-xs" />
            <span className="text-xs font-semibold text-zinc-500">~{tempoMedioPreparo}min</span>
          </div>
        )}

        {/* Busca */}
        <div className="relative flex-1 min-w-0 max-w-xs">
          <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-xs pointer-events-none" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nº, cliente, mesa ou senha..."
            className="w-full pl-7 pr-7 py-1.5 text-xs border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-800 focus:outline-none focus:border-amber-400"
          />
          {busca && (
            <button
              onClick={() => setBusca('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600 cursor-pointer"
            >
              <i className="ri-close-line text-xs" />
            </button>
          )}
        </div>

        <div className="flex-1 hidden lg:block" />

        {/* Relógio — só desktop */}
        <div className="hidden lg:flex flex-col items-end flex-shrink-0">
          <span className="text-xs font-bold text-zinc-600 tabular-nums">
            {clock.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </span>
          <span className="text-[10px] text-zinc-400 capitalize">
            {clock.toLocaleDateString('pt-BR', { weekday: 'short', day: 'numeric', month: 'short' })}
          </span>
        </div>

        {/* Controles — agrupados num container uniforme */}
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 flex-shrink-0">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            title="Atualizar"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              refreshing ? 'bg-amber-100 text-amber-500' : 'text-zinc-500 hover:bg-white hover:text-zinc-800'
            }`}
          >
            <i className={`ri-refresh-line text-sm ${refreshing ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={() => setSomAtivado((s) => !s)}
            title={somAtivado ? 'Desativar som' : 'Ativar som'}
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              somAtivado ? 'bg-amber-100 text-amber-600' : 'text-zinc-400 hover:bg-white hover:text-zinc-600'
            }`}
          >
            <i className={`${somAtivado ? 'ri-volume-up-line' : 'ri-volume-mute-line'} text-sm`} />
          </button>

          <div className="w-px h-4 bg-zinc-300" />

          <button
            onClick={() => setVisualizacao('kanban')}
            title="Kanban"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              visualizacao === 'kanban' ? 'bg-white text-zinc-800' : 'text-zinc-400 hover:bg-white hover:text-zinc-600'
            }`}
          >
            <i className="ri-layout-column-line text-sm" />
          </button>
          <button
            onClick={() => setVisualizacao('lista')}
            title="Lista"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              visualizacao === 'lista' ? 'bg-white text-zinc-800' : 'text-zinc-400 hover:bg-white hover:text-zinc-600'
            }`}
          >
            <i className="ri-list-check-2 text-sm" />
          </button>
          <button
            onClick={() => setVisualizacao('mesas')}
            title="Por Mesa"
            className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${
              visualizacao === 'mesas' ? 'bg-white text-zinc-800' : 'text-zinc-400 hover:bg-white hover:text-zinc-600'
            }`}
          >
            <i className="ri-table-2 text-sm" />
          </button>
        </div>
      </div>

      {/* ── MOBILE: barra de filtros compacta (1 linha) ── */}
      <MobileFiltrosBar
        filtroStatus={filtroStatus}
        setFiltroStatus={setFiltroStatus}
        filtroOrigem={filtroOrigem}
        setFiltroOrigem={setFiltroOrigem}
        filtroEstacao={filtroEstacao}
        setFiltroEstacao={setFiltroEstacao}
        filtroPagamento={filtroPagamento}
        setFiltroPagamento={setFiltroPagamento}
        contadores={contadores}
        contadoresOrigem={contadoresOrigem}
        estacoesDisponiveis={estacoesDisponiveis}
        pedidosComStatus={pedidosComStatus}
        FILTROS={FILTROS}
      />

      {/* ── DESKTOP: filtros em 1 linha unificada ── */}
      <div className="hidden md:flex items-center gap-0 bg-white border-b border-zinc-100 px-3 flex-shrink-0 overflow-x-auto">
        {/* Status */}
        <div className="flex items-center gap-0.5 py-1.5">
          {FILTROS.map((f) => {
            const isActive = filtroStatus === f.key;
            return (
              <button
                key={f.key}
                onClick={() => setFiltroStatus(f.key)}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? f.danger ? 'bg-red-500 text-white' : 'bg-zinc-800 text-white'
                    : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                {f.label}
                {f.count !== undefined && f.count > 0 && (
                  <span className={`text-[9px] font-black px-1 rounded-full ${
                    isActive
                      ? f.danger ? 'bg-white/25 text-white' : 'bg-white/20 text-white'
                      : f.danger ? 'bg-red-100 text-red-600' : f.urgent ? 'bg-amber-100 text-amber-700' : 'bg-zinc-200 text-zinc-500'
                  }`}>
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <div className="w-px h-4 bg-zinc-200 mx-2 flex-shrink-0" />

        {/* Origem */}
        <div className="flex items-center gap-0.5 py-1.5">
          {(() => {
            const ORIGENS: { key: FiltroOrigem; label: string; icon: string }[] = [
              { key: 'todas',           label: 'Todas',    icon: 'ri-apps-line'       },
              { key: 'caixa',           label: 'Caixa',    icon: 'ri-computer-line'   },
              { key: 'garcom',          label: 'Garçom',   icon: 'ri-user-star-line'  },
              { key: 'mesa',            label: 'Mesa',     icon: 'ri-table-2'         },
              { key: 'autoatendimento', label: 'Totem',    icon: 'ri-smartphone-line' },
              { key: 'delivery',        label: 'Delivery', icon: 'ri-bike-line'       },
            ];
            return ORIGENS
              .filter((o) => o.key === 'todas' || (contadoresOrigem[o.key as keyof typeof contadoresOrigem] ?? 0) > 0)
              .map((o) => {
                const count = o.key === 'todas' ? contadores.total : (contadoresOrigem[o.key as keyof typeof contadoresOrigem] ?? 0);
                const isActive = filtroOrigem === o.key;
                return (
                  <button
                    key={o.key}
                    onClick={() => setFiltroOrigem(o.key)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    <i className={`${o.icon} text-[10px]`} />
                    {o.label}
                    {count > 0 && (
                      <span className={`text-[9px] font-black px-1 rounded-full ${
                        isActive ? 'bg-white/20 text-white' : 'bg-zinc-200 text-zinc-500'
                      }`}>
                        {count}
                      </span>
                    )}
                  </button>
                );
              });
          })()}
        </div>

        {estacoesDisponiveis.length > 1 && (
          <>
            <div className="w-px h-4 bg-zinc-200 mx-2 flex-shrink-0" />
            <div className="flex items-center gap-0.5 py-1.5">
              {estacoesDisponiveis.map((est) => {
                const isActive = filtroEstacao === est;
                return (
                  <button
                    key={est}
                    onClick={() => setFiltroEstacao(est)}
                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                      isActive ? 'bg-zinc-800 text-white' : 'text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100'
                    }`}
                  >
                    {est === 'todas' ? 'Est. Todas' : est}
                  </button>
                );
              })}
            </div>
          </>
        )}

        {/* Pagamento */}
        <div className="w-px h-4 bg-zinc-200 mx-2 flex-shrink-0" />
        <div className="flex items-center gap-0.5 py-1.5">
          {[
            { key: 'todos' as FiltroPagamento, label: 'Pagamento', icon: 'ri-wallet-3-line' },
            { key: 'pagos' as FiltroPagamento, label: 'Pagos', icon: 'ri-checkbox-circle-line' },
            { key: 'nao-pagos' as FiltroPagamento, label: 'Não Pagos', icon: 'ri-time-line' },
          ].map((o) => {
            const isActive = filtroPagamento === o.key;
            const count = o.key === 'todos'
              ? contadores.total
              : pedidosComStatus.filter((p) => !p.isCancelled && (o.key === 'pagos' ? p.isPaid : !p.isPaid)).length;
            return (
              <button
                key={o.key}
                onClick={() => setFiltroPagamento(o.key)}
                className={`flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold transition-colors cursor-pointer whitespace-nowrap flex-shrink-0 ${
                  isActive
                    ? o.key === 'nao-pagos'
                      ? 'bg-red-600 text-white'
                      : o.key === 'pagos'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-zinc-800 text-white'
                    : o.key === 'nao-pagos' && count > 0
                      ? 'bg-red-50 text-red-700 hover:bg-red-100'
                      : o.key === 'pagos' && count > 0
                        ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'text-zinc-500 hover:text-zinc-700 hover:bg-zinc-100'
                }`}
              >
                <i className={`${o.icon} text-[10px]`} />
                {o.label}
                {count > 0 && (
                  <span className={`text-[9px] font-black px-1.5 rounded-full ${
                    isActive
                      ? 'bg-white/25 text-white'
                      : o.key === 'nao-pagos'
                        ? 'bg-red-500 text-white'
                        : o.key === 'pagos'
                          ? 'bg-emerald-500 text-white'
                          : 'bg-zinc-200 text-zinc-500'
                  }`}>
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Resultado da busca + indicador de visualizacao mesas */}
      {visualizacao === 'mesas' && (
        <div className="bg-violet-50 border-b border-violet-100 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <i className="ri-table-2 text-violet-600 text-xs" />
          <span className="text-xs font-semibold text-violet-700">
            Agrupado por mesa — mostrando pedidos com participantes e suas senhas
          </span>
          <button
            onClick={() => setVisualizacao('kanban')}
            className="ml-auto text-xs text-violet-600 hover:text-violet-800 cursor-pointer underline whitespace-nowrap"
          >
            Voltar ao Kanban
          </button>
        </div>
      )}
      {busca.trim() && visualizacao !== 'mesas' && (
        <div className="bg-amber-50 border-b border-amber-100 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <i className="ri-search-line text-amber-600 text-xs" />
          <span className="text-xs font-semibold text-amber-700">
            {filtrados.length} resultado{filtrados.length !== 1 ? 's' : ''} para &quot;{busca}&quot;
          </span>
          <button onClick={() => setBusca('')} className="text-xs text-amber-600 hover:text-amber-800 cursor-pointer ml-1 underline">
            limpar
          </button>
        </div>
      )}

      {/* Conteúdo */}
      <div className="flex-1 overflow-hidden p-2 sm:p-3 md:p-4">
        {visualizacao === 'mesas' ? (
          <div className="h-full overflow-y-auto">
            <GestorMesasView
              pedidos={pedidosComStatus}
              busca={busca}
              onOpenDetail={(id) => setDetailPedidoId(id)}
            />
          </div>
        ) : visualizacao === 'kanban' ? (
          <GestorKanbanView
            pedidos={filtrados}
            onAvancar={handleAvancar}
            onEntregar={handleEntregar}
            onMudarOperador={handleMudarOperador}
            onCancelar={handleCancelarPedido}
            onOpenDetail={(pedidoId) => setDetailPedidoId(pedidoId)}
            onAvancarUnidade={(pedidoId, itemId, unidadeId, novoStatus) => {
              setPedidos((prev) => prev.map((p) => {
                if (p.id !== pedidoId) return p;
                return {
                  ...p,
                  itens: p.itens.map((item) => {
                    if (item.id !== itemId) return item;
                    return {
                      ...item,
                      unidades: item.unidades?.map((u) => u.id === unidadeId ? { ...u, status: novoStatus } : u),
                    };
                  }),
                };
              }));
            }}
            onEntregarUnidade={(pedidoId, itemId, unidadeId) => {
              const operador = user?.nome ?? 'Operador';
              const now = Date.now();
              setPedidos((prev) => prev.map((p) => {
                if (p.id !== pedidoId) return p;
                return {
                  ...p,
                  itens: p.itens.map((item) => {
                    if (item.id !== itemId) return item;
                    const novasUnidades = item.unidades?.map((u) =>
                      u.id === unidadeId
                        ? { ...u, status: 'entregue' as KDSItemStatus, entregueEm: now, quemEntregou: operador }
                        : u
                    );
                    const todasEntregues = novasUnidades?.every((u) => u.status === 'entregue') ?? false;
                    return {
                      ...item,
                      unidades: novasUnidades,
                      status: todasEntregues ? ('entregue' as KDSItemStatus) : item.status,
                    };
                  }),
                };
              }));
              const unitMatch = unidadeId.match(/-u(\d+)$/);
              const unitNumber = unitMatch ? parseInt(unitMatch[1], 10) : 1;
              updateUnitStatusRemote(itemId, pedidoId, unitNumber, 'entregue');
            }}
            operadorAtual={user?.nome}
            elapsed={tick}
            filtroEstacao={filtroEstacao}
            filtroStatus={filtroStatus}
          />
        ) : (
          <GestorListView
            pedidos={filtrados}
            onAvancar={handleAvancar}
            onEntregar={handleEntregar}
            onMudarOperador={handleMudarOperador}
            onCancelar={handleCancelarPedido}
            onOpenDetail={(pedidoId) => setDetailPedidoId(pedidoId)}
            operadorAtual={user?.nome}
            tick={tick}
            filtroEstacao={filtroEstacao}
          />
        )}
      </div>
    </div>
  );
}

// ── Componente de filtros mobile compacto ──
interface MobileFiltrosBarProps {
  filtroStatus: FiltroStatus;
  setFiltroStatus: (v: FiltroStatus) => void;
  filtroOrigem: FiltroOrigem;
  setFiltroOrigem: (v: FiltroOrigem) => void;
  filtroEstacao: string;
  setFiltroEstacao: (v: string) => void;
  filtroPagamento: FiltroPagamento;
  setFiltroPagamento: (v: FiltroPagamento) => void;
  contadores: { novo: number; preparo: number; pronto: number; entregue: number; cancelado: number; total: number };
  contadoresOrigem: { caixa: number; garcom: number; mesa: number; autoatendimento: number; delivery: number };
  estacoesDisponiveis: string[];
  pedidosComStatus: KDSPedido[];
  FILTROS: { key: FiltroStatus; label: string; count?: number; urgent?: boolean; danger?: boolean }[];
}

function MobileFiltrosBar({
  filtroStatus,
  setFiltroStatus,
  filtroOrigem,
  setFiltroOrigem,
  filtroEstacao,
  setFiltroEstacao,
  filtroPagamento,
  setFiltroPagamento,
  contadores,
  contadoresOrigem,
  estacoesDisponiveis,
  pedidosComStatus,
  FILTROS,
}: MobileFiltrosBarProps) {
  const [showSheet, setShowSheet] = useState(false);

  const temFiltroAtivo = filtroOrigem !== 'todas' || filtroEstacao !== 'todas' || filtroPagamento !== 'todos';

  const ORIGENS: { key: FiltroOrigem; label: string; icon: string; cor: string; corAtivo: string }[] = [
    { key: 'todas',           label: 'Todas',    icon: 'ri-apps-line',       cor: 'bg-zinc-100 text-zinc-600 border-zinc-200',     corAtivo: 'bg-zinc-800 text-white border-zinc-800' },
    { key: 'caixa',           label: 'Caixa',    icon: 'ri-computer-line',   cor: 'bg-violet-50 text-violet-700 border-violet-200', corAtivo: 'bg-violet-600 text-white border-violet-600' },
    { key: 'garcom',          label: 'Garçom',   icon: 'ri-user-star-line',  cor: 'bg-sky-50 text-sky-700 border-sky-200',          corAtivo: 'bg-sky-600 text-white border-sky-600' },
    { key: 'mesa',            label: 'Mesa',     icon: 'ri-table-2',         cor: 'bg-teal-50 text-teal-700 border-teal-200',       corAtivo: 'bg-teal-600 text-white border-teal-600' },
    { key: 'autoatendimento', label: 'Totem',    icon: 'ri-smartphone-line', cor: 'bg-amber-50 text-amber-700 border-amber-200',    corAtivo: 'bg-amber-500 text-white border-amber-500' },
    { key: 'delivery',        label: 'Delivery', icon: 'ri-bike-line',       cor: 'bg-rose-50 text-rose-700 border-rose-200',       corAtivo: 'bg-rose-600 text-white border-rose-600' },
  ];

  const PAGAMENTOS: { key: FiltroPagamento; label: string; icon: string; cor: string; corAtivo: string }[] = [
    { key: 'todos',     label: 'Todos',     icon: 'ri-wallet-3-line',       cor: 'bg-zinc-100 text-zinc-600 border-zinc-200',     corAtivo: 'bg-zinc-800 text-white border-zinc-800' },
    { key: 'pagos',     label: 'Pagos',     icon: 'ri-checkbox-circle-line', cor: 'bg-emerald-50 text-emerald-700 border-emerald-200', corAtivo: 'bg-emerald-600 text-white border-emerald-600' },
    { key: 'nao-pagos', label: 'Não Pagos', icon: 'ri-time-line',           cor: 'bg-red-50 text-red-700 border-red-200',         corAtivo: 'bg-red-600 text-white border-red-600' },
  ];

  const ESTACAO_CORES: Record<string, string> = {
    Grelha:      'bg-orange-100 text-orange-700 border-orange-200',
    Frituras:    'bg-yellow-100 text-yellow-700 border-yellow-200',
    Balcão:      'bg-sky-100 text-sky-700 border-sky-200',
    Confeitaria: 'bg-pink-100 text-pink-700 border-pink-200',
  };

  // Ícones compactos por status
  const STATUS_ICONS: Record<FiltroStatus, string> = {
    todos:    'ri-apps-line',
    novo:     'ri-time-line',
    preparo:  'ri-fire-line',
    pronto:   'ri-checkbox-circle-line',
    entregue: 'ri-check-double-line',
    cancelado:'ri-close-circle-line',
  };

  // Contadores de pagamento
  const pagosCount = pedidosComStatus.filter((p) => !p.isCancelled && p.isPaid).length;
  const naoPagosCount = pedidosComStatus.filter((p) => !p.isCancelled && !p.isPaid).length;

  return (
    <>
      {/* Barra compacta — só mobile */}
      <div className="md:hidden bg-white border-b border-zinc-100 px-3 py-2 flex items-center gap-1.5 flex-shrink-0">
        {/* Botões de status — ícone + badge */}
        <div className="flex items-center gap-1 flex-1 overflow-x-auto scrollbar-hide">
          {FILTROS.map((f) => {
            const isActive = filtroStatus === f.key;
            const hasCount = (f.count ?? 0) > 0;
            return (
              <button
                key={f.key}
                onClick={() => setFiltroStatus(f.key)}
                className={`relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 transition-all cursor-pointer ${
                  isActive
                    ? f.danger ? 'bg-red-600 text-white' : 'bg-zinc-800 text-white'
                    : f.danger && hasCount
                      ? 'bg-red-50 text-red-500 border border-red-200'
                      : f.urgent && hasCount
                        ? 'bg-amber-50 text-amber-600 border border-amber-200'
                        : 'bg-zinc-100 text-zinc-500'
                }`}
                title={f.label}
              >
                <i className={`${STATUS_ICONS[f.key]} text-base`} />
                {hasCount && (
                  <span className={`absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-black px-1 rounded-full ${
                    isActive
                      ? 'bg-amber-400 text-white'
                      : f.danger
                        ? 'bg-red-500 text-white'
                        : f.urgent
                          ? 'bg-amber-500 text-white'
                          : 'bg-zinc-400 text-white'
                  }`}>
                    {f.count}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Divisor */}
        <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />

        {/* Botão de pagamento — toggle rápido */}
        <div className="relative flex-shrink-0">
          <button
            onClick={() => {
              if (filtroPagamento === 'todos') setFiltroPagamento('nao-pagos');
              else if (filtroPagamento === 'nao-pagos') setFiltroPagamento('pagos');
              else setFiltroPagamento('todos');
            }}
            className={`relative flex items-center justify-center w-9 h-9 rounded-xl flex-shrink-0 transition-all cursor-pointer ${
              filtroPagamento === 'nao-pagos'
                ? 'bg-red-600 text-white'
                : filtroPagamento === 'pagos'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-zinc-100 text-zinc-500'
            }`}
            title={
              filtroPagamento === 'nao-pagos' ? 'Não Pagos' : filtroPagamento === 'pagos' ? 'Pagos' : 'Pagamento'
            }
          >
            <i className={`${
              filtroPagamento === 'nao-pagos' ? 'ri-time-line' : filtroPagamento === 'pagos' ? 'ri-checkbox-circle-line' : 'ri-wallet-3-line'
            } text-base`} />
            {(naoPagosCount > 0 || pagosCount > 0) && filtroPagamento === 'todos' && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-black px-1 rounded-full bg-zinc-400 text-white">
                {naoPagosCount + pagosCount}
              </span>
            )}
            {filtroPagamento === 'nao-pagos' && naoPagosCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-black px-1 rounded-full bg-white/25 text-white">
                {naoPagosCount}
              </span>
            )}
            {filtroPagamento === 'pagos' && pagosCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[16px] h-4 flex items-center justify-center text-[9px] font-black px-1 rounded-full bg-white/25 text-white">
                {pagosCount}
              </span>
            )}
          </button>
        </div>

        {/* Divisor */}
        <div className="w-px h-6 bg-zinc-200 flex-shrink-0" />

        {/* Botão "Filtros" com indicador de ativo */}
        <button
          onClick={() => setShowSheet(true)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer whitespace-nowrap flex-shrink-0 ${
            temFiltroAtivo
              ? 'bg-amber-500 text-white'
              : 'bg-zinc-100 text-zinc-600'
          }`}
        >
          <i className="ri-equalizer-line text-sm" />
          Filtros
          {temFiltroAtivo && (
            <span className="w-4 h-4 flex items-center justify-center bg-white/30 rounded-full text-[9px] font-black">
              {(filtroOrigem !== 'todas' ? 1 : 0) + (filtroEstacao !== 'todas' ? 1 : 0) + (filtroPagamento !== 'todos' ? 1 : 0)}
            </span>
          )}
        </button>
      </div>

      {/* Bottom Sheet de filtros */}
      {showSheet && (
        <>
          <div
            className="fixed inset-0 z-40 bg-black/40 md:hidden"
            onClick={() => setShowSheet(false)}
          />
          <div className="fixed bottom-0 left-0 right-0 z-50 bg-white rounded-t-2xl md:hidden overflow-hidden"
            style={{ maxHeight: '70vh' }}
          >
            {/* Handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 bg-zinc-200 rounded-full" />
            </div>

            <div className="overflow-y-auto px-4 pb-6" style={{ maxHeight: 'calc(70vh - 40px)' }}>
              {/* Header */}
              <div className="flex items-center justify-between py-3 mb-1">
                <h3 className="text-sm font-black text-zinc-900">Filtros avançados</h3>
                <div className="flex items-center gap-2">
                  {temFiltroAtivo && (
                    <button
                      onClick={() => { setFiltroOrigem('todas'); setFiltroEstacao('todas'); setFiltroPagamento('todos'); }}
                      className="text-xs text-amber-600 font-bold cursor-pointer"
                    >
                      Limpar
                    </button>
                  )}
                  <button
                    onClick={() => setShowSheet(false)}
                    className="w-7 h-7 flex items-center justify-center rounded-lg bg-zinc-100 text-zinc-500 cursor-pointer"
                  >
                    <i className="ri-close-line text-sm" />
                  </button>
                </div>
              </div>

              {/* Pagamento */}
              <div className="mb-5">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <i className="ri-wallet-3-line" />Pagamento
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {PAGAMENTOS.map((p) => {
                    const count = p.key === 'todos' ? 0 : p.key === 'pagos' ? pagosCount : naoPagosCount;
                    const isActive = filtroPagamento === p.key;
                    return (
                      <button
                        key={p.key}
                        onClick={() => setFiltroPagamento(p.key)}
                        className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                          isActive ? p.corAtivo : `${p.cor} opacity-80`
                        }`}
                      >
                        <i className={`${p.icon} text-lg`} />
                        <span className="text-[11px]">{p.label}</span>
                        {count > 0 && (
                          <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-black/10'}`}>
                            {count}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Origem */}
              <div className="mb-5">
                <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <i className="ri-route-line" />Origem do pedido
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {ORIGENS
                    .filter((o) => o.key === 'todas' || (contadoresOrigem[o.key as keyof typeof contadoresOrigem] ?? 0) > 0)
                    .map((o) => {
                      const count = o.key === 'todas' ? contadores.total : (contadoresOrigem[o.key as keyof typeof contadoresOrigem] ?? 0);
                      const isActive = filtroOrigem === o.key;
                      return (
                        <button
                          key={o.key}
                          onClick={() => setFiltroOrigem(o.key)}
                          className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            isActive ? o.corAtivo : `${o.cor} opacity-80`
                          }`}
                        >
                          <i className={`${o.icon} text-lg`} />
                          <span className="text-[11px]">{o.label}</span>
                          {count > 0 && (
                            <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${isActive ? 'bg-white/25 text-white' : 'bg-black/10'}`}>
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                </div>
              </div>

              {/* Estação */}
              {estacoesDisponiveis.length > 1 && (
                <div>
                  <p className="text-[10px] font-black text-zinc-400 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                    <i className="ri-tools-line" />Estação de trabalho
                  </p>
                  <div className="grid grid-cols-3 gap-2">
                    {estacoesDisponiveis.map((est) => {
                      const isActive = filtroEstacao === est;
                      const corBase = ESTACAO_CORES[est] ?? 'bg-zinc-100 text-zinc-600 border-zinc-200';
                      const count = est === 'todas' ? 0 : pedidosComStatus.filter((p) =>
                        !p.isCancelled &&
                        (p.itens.some((i) => i.estacao === est) || p.itens.some((i) => i.partes?.some((part: { estacao?: string }) => part.estacao === est)))
                      ).length;
                      return (
                        <button
                          key={est}
                          onClick={() => setFiltroEstacao(est)}
                          className={`flex flex-col items-center gap-1 py-3 px-2 rounded-xl border text-xs font-bold transition-all cursor-pointer ${
                            isActive
                              ? est === 'todas' ? 'bg-zinc-800 text-white border-zinc-800' : corBase + ' ring-2 ring-current'
                              : est === 'todas' ? 'bg-zinc-100 text-zinc-500 border-zinc-200' : `${corBase} opacity-70`
                          }`}
                        >
                          <i className={`${est === 'todas' ? 'ri-layout-grid-line' : 'ri-store-2-line'} text-lg`} />
                          <span className="text-[11px]">{est === 'todas' ? 'Todas' : est}</span>
                          {count > 0 && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-black/10">
                              {count}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Aplicar */}
              <button
                onClick={() => setShowSheet(false)}
                className="w-full mt-5 py-3 bg-zinc-900 text-white text-sm font-bold rounded-xl cursor-pointer"
              >
                Aplicar filtros
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

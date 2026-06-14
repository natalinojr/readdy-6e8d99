import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type KDSPedido, type KDSItemStatus, type KDSUnidade } from '../../types/kds';
import { useAuth } from '@/contexts/AuthContext';

const ESTACOES_KDS = ['Grelha', 'Frituras', 'Balcão', 'Confeitaria'];
import { useCardapio } from '@/contexts/CardapioContext';
import KDSCard from './components/KDSCard';
import KDSColuna from './components/KDSColuna';
import KDSSetupScreen from './components/KDSSetupScreen';
import KDSListPanel from './components/KDSListPanel';
import RegistrarPerdaModal from './components/RegistrarPerdaModal';
import AdicionarOperadorModal from './components/AdicionarOperadorModal';
import { KDSTopBar } from './components/KDSTopBar';
import { KDSStatusBar } from './components/KDSStatusBar';
import { KDSEsgotadoModal } from './components/KDSEsgotadoModal';
import { KDSFecharEstacaoModal } from './components/KDSFecharEstacaoModal';
import { usePedidosFiltrados } from './hooks/usePedidosFiltrados';
import { useKDSTick } from '../../hooks/useKDSTick';
import { useKDSSound } from '../../hooks/useKDSSound';
import { useSessao } from '../../contexts/SessaoContext';
import { useEstoque } from '../../contexts/EstoqueContext';
import { useKDS } from '../../contexts/KDSContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';

function deriveItemStatus(item: any): any {
  if (item.partes && item.partes.length > 0) {
    const statuses = item.partes.map((p: any) => p.status);
    if (statuses.every((s: any) => s === 'entregue')) return 'entregue';
    if (statuses.every((s: any) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s: any) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  if (item.unidades && item.unidades.length > 0) {
    const statuses = item.unidades.map((u: any) => u.status);
    if (statuses.every((s: any) => s === 'entregue')) return 'entregue';
    if (statuses.every((s: any) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s: any) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
  return item.status;
}

function derivePedidoStatus(pedido: KDSPedido): KDSPedido['status'] {
  const kitchenItens = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  const allItens = pedido.itens;
  if (allItens.every((i) => deriveItemStatus(i) === 'entregue')) return 'entregue';
  if (kitchenItens.length === 0) {
    const skipStatuses = allItens.map((i) => deriveItemStatus(i));
    if (skipStatuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    return 'novo';
  }
  const kitchenStatuses = kitchenItens.map((i) => deriveItemStatus(i));
  if (kitchenStatuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
  if (kitchenStatuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
  return 'novo';
}

export default function KDSPage() {
  useKDSTick();
  const { playNovoPedido, playPedidoPronto, resume } = useKDSSound();
  const { estado, sessao, estacoesAbertas, fecharEstacao, loadingSession } = useSessao();
  const { user } = useAuth();
  const { marcarInsumoEsgotado, insumosEsgotados, insumos } = useEstoque();
  const { pedidos, setPedidos, updateItemStatusRemote, updateUnitStatusRemote, updatePartStatusRemote, toggleObsChecadaRemote, pedidosSalvando, pendingStatusCount, flushPendingStatusQueue } = useKDS();
  const { itensAtivos, estacoes } = useCardapio();
  const { settings: sysSettings } = useSystemSettings();

  // Impressão automática é gerenciada pelo useOrderSubmit via fila centralizada.
  // O KDS não reimprime ao abrir — evita duplicação.

  // ── Alerta de fechamento da cozinha ──────────────────────────────────────
  const [alertaFechamento, setAlertaFechamento] = useState<'aviso' | 'fechando' | null>(null);
  useEffect(() => {
    const closeTime = sysSettings.kitchen_close_time;
    if (!closeTime) return;
    const check = () => {
      const now = new Date();
      const [hh, mm] = closeTime.split(':').map(Number);
      const closeMs = hh * 60 * 60 * 1000 + mm * 60 * 1000;
      const nowMs = now.getHours() * 60 * 60 * 1000 + now.getMinutes() * 60 * 1000 + now.getSeconds() * 1000;
      const diff = closeMs - nowMs;
      if (diff <= 0 && diff > -5 * 60 * 1000) {
        setAlertaFechamento('fechando');
      } else if (diff > 0 && diff <= 15 * 60 * 1000) {
        setAlertaFechamento('aviso');
      } else {
        setAlertaFechamento(null);
      }
    };
    check();
    const id = setInterval(check, 30000);
    return () => clearInterval(id);
  }, [sysSettings.kitchen_close_time]);

  const [logado, setLogado] = useState(false);
  const [estacaoFiltro, setEstacaoFiltro] = useState('Todas');
  const [showFecharEstacao, setShowFecharEstacao] = useState(false);
  const [showRegistrarPerda, setShowRegistrarPerda] = useState(false);
  const [showAdicionarOperador, setShowAdicionarOperador] = useState(false);
  const [showPanel, setShowPanel] = useState<'pronto' | 'entregue' | null>(null);
  const [showEsgotadoModal, setShowEsgotadoModal] = useState(false);
  const [buscaInsumo, setBuscaInsumo] = useState('');
  const [insumoEsgotadoId, setInsumoEsgotadoId] = useState('');
  const [clock, setClock] = useState(new Date());
  const [somAtivo, setSomAtivo] = useState(true);
  const [buscaKDS, setBuscaKDS] = useState('');
  const [flashNovo, setFlashNovo] = useState(false);
  const prevNovosRef = useRef(pedidos.filter((p) => p.status === 'novo').length);

  const estacoesNomes = useMemo(
    () => [
      'Todas',
      ...(estacoes.length > 0
        ? estacoes.filter((e) => e.ativo).map((e) => e.nome)
        : ESTACOES_KDS.filter((e) => e !== 'Todas')),
    ],
    [estacoes],
  );

  const [invertOrdemNovos, setInvertOrdemNovos] = useState(false);
  const [invertOrdemPreparo, setInvertOrdemPreparo] = useState(false);

  useEffect(() => {
    if (!loadingSession && estado === 'sem_sessao') setLogado(false);
  }, [estado, loadingSession]);

  useEffect(() => {
    const id = setInterval(() => setClock(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const novos = pedidos.filter((p) => p.status === 'novo').length;
    if (novos > prevNovosRef.current && somAtivo) {
      playNovoPedido();
      setFlashNovo(true);
      setTimeout(() => setFlashNovo(false), 1200);
    }
    prevNovosRef.current = novos;
  }, [pedidos, somAtivo, playNovoPedido]);

  const handleAtivarSom = useCallback(async () => {
    await resume();
    setSomAtivo((v) => !v);
  }, [resume]);

  const handleLoginSuccess = useCallback((estacao: string) => {
    setEstacaoFiltro(estacao);
    setLogado(true);
  }, []);

  const handleFecharEstacaoConfirm = useCallback(() => {
    if (estacaoFiltro !== 'Todas') {
      const est = estacoesAbertas.find((e) => e.estacaoNome === estacaoFiltro);
      if (est) fecharEstacao(est.estacaoId);
    } else {
      estacoesAbertas.forEach((e) => fecharEstacao(e.estacaoId));
    }
    setLogado(false);
    setShowFecharEstacao(false);
  }, [estacaoFiltro, estacoesAbertas, fecharEstacao]);

  const handleMarcarEmRota = useCallback(
    (pedidoId: string) => {
      setPedidos((prev) =>
        prev.map((p) => (p.id === pedidoId ? { ...p, status: 'em_rota' } : p)),
      );
    },
    [setPedidos],
  );

  const handleAvancarPedido = useCallback(
    (pedidoId: string) => {
      const estacaoOp =
        estacaoFiltro !== 'Todas'
          ? estacaoFiltro
          : estacoesAbertas[0]?.operadorNome ?? 'KDS';
      const isSimulated = pedidoId.startsWith('kds-');
      const nextItemStatuses: Array<{ itemId: string; status: KDSItemStatus }> = [];

      setPedidos((prev) => {
        const pedidoAtual = prev.find((p) => p.id === pedidoId);
        return prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const now = Date.now();
          if (p.status === 'novo') {
            const itens = p.itens.map((i) => {
              const skipPreparo = !!(i.semPreparo || i.skip_kds);
              const itemStatus: KDSItemStatus = skipPreparo ? 'pronto' : 'preparo';
              nextItemStatuses.push({ itemId: i.id, status: itemStatus });
              const partes = i.partes?.map((parte) => ({
                ...parte,
                status: 'preparo' as KDSItemStatus,
                iniciouPreparoEm: parte.iniciouPreparoEm ?? now,
                operadorPreparo: parte.operadorPreparo ?? estacaoOp,
              }));
              return {
                ...i,
                status: itemStatus,
                iniciouPreparoEm: !skipPreparo
                  ? (i.iniciouPreparoEm ?? now)
                  : i.iniciouPreparoEm,
                ficouProntoEm: skipPreparo
                  ? (i.ficouProntoEm ?? now)
                  : i.ficouProntoEm,
                partes,
                operadorPreparo: i.operadorPreparo ?? estacaoOp,
              };
            });
            const novoStatusPedido = derivePedidoStatus({ ...p, itens });
            return { ...p, itens, status: novoStatusPedido };
          }
          if (p.status === 'pronto' || p.status === 'em_rota') {
            const itens = p.itens.map((i) => {
              nextItemStatuses.push({ itemId: i.id, status: 'entregue' });
              const partes = i.partes?.map((parte) => ({
                ...parte,
                status: 'entregue' as KDSItemStatus,
                entregueEm: now,
              }));
              return {
                ...i,
                status: 'entregue' as KDSItemStatus,
                entregueEm: now,
                quemEntregou: estacaoOp,
                partes,
              };
            });
            return { ...p, itens, status: 'entregue' };
          }
          return p;
        });
      });

      if (!isSimulated) {
        nextItemStatuses.forEach(({ itemId, status }) => {
          updateItemStatusRemote(itemId, pedidoId, status);
        });
      }
    },
    [estacaoFiltro, estacoesAbertas, setPedidos, updateItemStatusRemote],
  );

  const handleAvancarItem = useCallback(
    (pedidoId: string, itemId: string, novoStatus: KDSItemStatus) => {
      const estacaoOp = estacaoFiltro !== 'Todas' ? estacaoFiltro : undefined;
      const isSimulated = pedidoId.startsWith('kds-');
      let effectiveForRemote: KDSItemStatus = novoStatus;

      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const effective: KDSItemStatus =
              novoStatus === 'preparo' && i.semPreparo ? 'pronto' : novoStatus;
            effectiveForRemote = effective;
            const nowTs = Date.now();
            return {
              ...i,
              status: effective,
              iniciouPreparoEm:
                effective === 'preparo' ? nowTs : i.iniciouPreparoEm,
              ficouProntoEm:
                effective === 'pronto' ? nowTs : i.ficouProntoEm,
              entregueEm:
                effective === 'entregue' ? nowTs : i.entregueEm,
              operadorPreparo:
                effective === 'preparo'
                  ? (estacaoOp ?? 'KDS')
                  : i.operadorPreparo,
            };
          });
          const derivado = derivePedidoStatus({ ...p, itens });
          const novoStatusPedido =
            p.status === 'em_rota' && derivado !== 'entregue' ? 'em_rota' : derivado;
          if (novoStatusPedido === 'pronto' && p.status !== 'pronto' && somAtivo) {
            setTimeout(() => playPedidoPronto(), 100);
          }
          return { ...p, itens, status: novoStatusPedido };
        }),
      );

      if (!isSimulated) {
        updateItemStatusRemote(itemId, pedidoId, effectiveForRemote);
      }
    },
    [estacaoFiltro, somAtivo, playPedidoPronto, setPedidos, updateItemStatusRemote],
  );

  const handleAvancarParte = useCallback(
    (pedidoId: string, itemId: string, parteId: string, novoStatus: KDSItemStatus) => {
      const estacaoOp = estacaoFiltro !== 'Todas' ? estacaoFiltro : undefined;
      const isSimulated = pedidoId.startsWith('kds-');
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const nowTs = Date.now();
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const partes = i.partes?.map((parte) => {
              if (parte.id !== parteId) return parte;
              return {
                ...parte,
                status: novoStatus,
                iniciouPreparoEm:
                  novoStatus === 'preparo' ? nowTs : parte.iniciouPreparoEm,
                ficouProntoEm:
                  novoStatus === 'pronto' ? nowTs : parte.ficouProntoEm,
                entregueEm:
                  novoStatus === 'entregue' ? nowTs : parte.entregueEm,
                operadorPreparo:
                  novoStatus === 'preparo'
                    ? (estacaoOp ?? 'KDS')
                    : parte.operadorPreparo,
              };
            });
            const newItemStatus = deriveItemStatus({ ...i, partes });
            return {
              ...i,
              partes,
              status: newItemStatus,
              iniciouPreparoEm:
                newItemStatus === 'preparo' && !i.iniciouPreparoEm
                  ? nowTs
                  : i.iniciouPreparoEm,
              ficouProntoEm:
                newItemStatus === 'pronto' && !i.ficouProntoEm
                  ? nowTs
                  : i.ficouProntoEm,
            };
          });
          const novoStatusPedido = derivePedidoStatus({ ...p, itens });
          if (novoStatusPedido === 'pronto' && p.status !== 'pronto' && somAtivo) {
            setTimeout(() => playPedidoPronto(), 100);
          }
          return { ...p, itens, status: novoStatusPedido };
        }),
      );

      if (!isSimulated) {
        updatePartStatusRemote(parteId, itemId, pedidoId, novoStatus);
      }
    },
    [estacaoFiltro, somAtivo, playPedidoPronto, setPedidos, updatePartStatusRemote],
  );

  const handleToggleObsChecada = useCallback(
    (pedidoId: string, itemId: string, obs: string) => {
      let obsIndex = 0;
      let checked = false;

      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const atuais = i.observacoesChecadas ?? [];
            const jaChecada = atuais.includes(obs);
            checked = !jaChecada;
            obsIndex = i.observacoes.indexOf(obs);
            if (obsIndex < 0) obsIndex = 0;
            return {
              ...i,
              observacoesChecadas: jaChecada
                ? atuais.filter((o) => o !== obs)
                : [...atuais, obs],
            };
          });
          return { ...p, itens };
        }),
      );

      if (!pedidoId.startsWith('kds-')) {
        const operadorNome = estacoesAbertas[0]?.operadorNome ?? undefined;
        toggleObsChecadaRemote(itemId, obs, obsIndex, checked, operadorNome);
      }
    },
    [setPedidos, toggleObsChecadaRemote, estacoesAbertas],
  );

  const handleSelecionarOperadorItem = useCallback(
    (pedidoId: string, itemId: string, operador: string) => {
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            return { ...i, operadorPreparo: operador || undefined };
          });
          return { ...p, itens };
        }),
      );
    },
    [setPedidos],
  );

  const handleAvancarUnidade = useCallback(
    (pedidoId: string, itemId: string, unidadeId: string, novoStatus: KDSItemStatus) => {
      const isSimulated = pedidoId.startsWith('kds-');
      const unitNumMatch = unidadeId.match(/-u(\d+)$/);
      const unitNumber = unitNumMatch ? parseInt(unitNumMatch[1], 10) : 1;

      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const now = Date.now();
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const unidades = i.unidades?.map((u) => {
              if (u.id !== unidadeId) return u;
              return {
                ...u,
                status: novoStatus,
                iniciouPreparoEm:
                  novoStatus === 'preparo'
                    ? (u.iniciouPreparoEm ?? now)
                    : u.iniciouPreparoEm,
                ficouProntoEm:
                  novoStatus === 'pronto' ? now : u.ficouProntoEm,
                entregueEm:
                  novoStatus === 'entregue' ? now : u.entregueEm,
              };
            });
            const allStatuses = (unidades ?? []).map((u) => u.status);
            let newItemStatus: KDSItemStatus = 'novo';
            if (allStatuses.every((s) => s === 'entregue')) newItemStatus = 'entregue';
            else if (allStatuses.every((s) => s === 'pronto' || s === 'entregue'))
              newItemStatus = 'pronto';
            else if (allStatuses.some((s) => s === 'preparo' || s === 'pronto'))
              newItemStatus = 'preparo';
            return {
              ...i,
              unidades,
              status: newItemStatus,
              iniciouPreparoEm:
                newItemStatus === 'preparo' && !i.iniciouPreparoEm
                  ? now
                  : i.iniciouPreparoEm,
              ficouProntoEm:
                newItemStatus === 'pronto' && !i.ficouProntoEm ? now : i.ficouProntoEm,
              entregueEm:
                newItemStatus === 'entregue' && !i.entregueEm ? now : i.entregueEm,
            };
          });
          const novoStatusPedido = derivePedidoStatus({ ...p, itens });
          if (novoStatusPedido === 'pronto' && p.status !== 'pronto' && somAtivo) {
            setTimeout(() => playPedidoPronto(), 100);
          }
          return { ...p, itens, status: novoStatusPedido };
        }),
      );

      if (!isSimulated) {
        updateUnitStatusRemote(itemId, pedidoId, unitNumber, novoStatus);
      }
    },
    [somAtivo, playPedidoPronto, setPedidos, updateUnitStatusRemote],
  );

  const handleSelecionarOperadorUnidade = useCallback(
    (pedidoId: string, itemId: string, unidadeId: string, operador: string) => {
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const unidades = i.unidades?.map((u) => {
              if (u.id !== unidadeId) return u;
              return { ...u, operadorPreparo: operador || undefined };
            });
            return { ...i, unidades };
          });
          return { ...p, itens };
        }),
      );
    },
    [setPedidos],
  );

  const handleAtribuirOperadorTodos = useCallback(
    (pedidoId: string, operador: string) => {
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            const status = deriveItemStatus(i);
            if (status !== 'novo') return i;
            if (i.unidades && i.unidades.length > 0) {
              const unidades = i.unidades.map((u) =>
                u.status === 'novo' ? { ...u, operadorPreparo: operador } : u,
              );
              return { ...i, operadorPreparo: operador, unidades };
            }
            return { ...i, operadorPreparo: operador };
          });
          return { ...p, itens };
        }),
      );
    },
    [setPedidos],
  );

  const prevUnicoOpRef = useRef<string | null>(null);
  useEffect(() => {
    const uniqueOps = [...new Set(estacoesAbertas.map((e) => e.operadorNome))];
    if (uniqueOps.length !== 1) {
      prevUnicoOpRef.current = null;
      return;
    }
    const unico = uniqueOps[0];
    if (prevUnicoOpRef.current === unico) return;
    prevUnicoOpRef.current = unico;
    setPedidos((prev) =>
      prev.map((p) => ({
        ...p,
        itens: p.itens.map((i) => ({
          ...i,
          operadorPreparo: i.operadorPreparo ?? unico,
          unidades: i.unidades?.map((u) => ({
            ...u,
            operadorPreparo: u.operadorPreparo ?? unico,
          })),
        })),
      })),
    );
  }, [estacoesAbertas]);

  useEffect(() => {
    setPedidos((prev) =>
      prev.map((p) => ({
        ...p,
        itens: p.itens.map((i) => {
          if (
            i.quantidade <= 1 ||
            (i.unidades && i.unidades.length > 0) ||
            (i.partes && i.partes.length > 0)
          )
            return i;
          const unidades: KDSUnidade[] = Array.from(
            { length: i.quantidade },
            (_, idx) => ({
              id: `${i.id}-u${idx + 1}`,
              numero: idx + 1,
              status: i.status,
              operadorPreparo: i.operadorPreparo,
              iniciouPreparoEm: i.iniciouPreparoEm,
              ficouProntoEm: i.ficouProntoEm,
              entregueEm: i.entregueEm,
              quemEntregou: i.quemEntregou,
            }),
          );
          return { ...i, unidades };
        }),
      })),
    );
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSetObsLivre = useCallback(
    (pedidoId: string, itemId: string, obs: string) => {
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            return { ...i, observacaoLivre: obs || undefined };
          });
          return { ...p, itens };
        }),
      );
    },
    [setPedidos],
  );

  const handleAvancarTodos = useCallback(() => {
    const estacaoOp =
      estacaoFiltro !== 'Todas'
        ? estacaoFiltro
        : estacoesAbertas[0]?.operadorNome ?? 'KDS';

    setPedidos((prev) =>
      prev.map((p) => {
        if (p.status !== 'pronto') return p;
        if (estacaoFiltro !== 'Todas') {
          const temNaEstacao = p.itens.some((i) =>
            i.partes
              ? i.partes.some((pt) => pt.estacao === estacaoFiltro)
              : i.estacao === estacaoFiltro,
          );
          if (!temNaEstacao) return p;
        }
        const now = Date.now();
        const itens = p.itens.map((i) => {
          const partes = i.partes?.map((parte) => ({
            ...parte,
            status: 'entregue' as KDSItemStatus,
            entregueEm: now,
          }));
          return {
            ...i,
            status: 'entregue' as KDSItemStatus,
            entregueEm: now,
            quemEntregou: estacaoOp,
            partes,
          };
        });
        return { ...p, itens, status: 'entregue' };
      }),
    );
  }, [estacaoFiltro, estacoesAbertas, setPedidos]);

  const { novos, preparo, prontos, entregues, emRota, contadorPorEstacao, alertasOutrasEstacoes } =
    usePedidosFiltrados({ pedidos, estacaoFiltro, invertNovos: invertOrdemNovos, invertPreparo: invertOrdemPreparo, busca: buscaKDS }, estacoesNomes);

  const operadoresDisponiveis = useMemo(
    () => [...new Set(estacoesAbertas.map((e) => e.operadorNome))],
    [estacoesAbertas],
  );

  const totalNovos = novos.length;
  const totalAtivos = novos.length + preparo.length;

  // CAMADA 3: Feedback visual quando pedido é bloqueado pelo PDV
  const [lockAlert, setLockAlert] = useState<{ orderId: string; message: string } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { orderId: string; message: string } | undefined;
      if (detail?.orderId) {
        setLockAlert(detail);
        // Auto-dismiss após 5 segundos
        setTimeout(() => setLockAlert((prev) => (prev?.orderId === detail.orderId ? null : prev)), 5000);
      }
    };
    window.addEventListener('kds:order-locked', handler);
    return () => window.removeEventListener('kds:order-locked', handler);
  }, []);

  // ── BUG-35: Alerta de atualização de status com falha ──
  const [statusFailAlert, setStatusFailAlert] = useState<{ count: number; timestamp: number } | null>(null);
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail as { pendingCount: number; permanent?: boolean } | undefined;
      if (detail) {
        setStatusFailAlert({ count: detail.pendingCount, timestamp: Date.now() });
        // Auto-dismiss após 15s (se ainda houver pendências, o operador verá de novo no próximo toque)
        setTimeout(() => setStatusFailAlert((prev) => {
          if (!prev) return null;
          // Se envelheceu 15s e count não mudou, limpa
          if (Date.now() - prev.timestamp >= 15000) return null;
          return prev;
        }), 15000);
      }
    };
    window.addEventListener('kds:status-update-failed', handler);
    return () => window.removeEventListener('kds:status-update-failed', handler);
  }, []);

  // Se pendingStatusCount chegou a zero, limpa o alerta
  useEffect(() => {
    if (pendingStatusCount === 0 && statusFailAlert) {
      setStatusFailAlert(null);
    }
  }, [pendingStatusCount, statusFailAlert]);

  const estacaoInfo =
    estacaoFiltro !== 'Todas'
      ? estacoesAbertas.find((e) => e.estacaoNome === estacaoFiltro) ?? null
      : null;

  if (loadingSession) {
    return (
      <div className="flex flex-col h-full items-center justify-center bg-white">
        <div className="flex flex-col items-center gap-3">
          <div className="w-16 h-16 flex items-center justify-center bg-amber-50 border border-amber-200 rounded-2xl">
            <i className="ri-loader-4-line animate-spin text-3xl text-amber-500" />
          </div>
          <p className="text-sm font-bold text-zinc-600">Verificando sessão...</p>
        </div>
      </div>
    );
  }

  if (!logado) {
    return (
      <KDSSetupScreen onConfirm={handleLoginSuccess} />
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">

      {/* Banner de impressão automática ativa (backup do KDS) */}


      {flashNovo && (
        <div className="fixed inset-0 bg-amber-400/15 z-40 pointer-events-none animate-ping" />
      )}

      {/* Banner de fechamento da cozinha */}
      {alertaFechamento && (
        <div className={`flex items-center justify-between px-4 py-2 flex-shrink-0 ${alertaFechamento === 'fechando' ? 'bg-red-600' : 'bg-amber-500'}`}>
          <div className="flex items-center gap-2">
            <i className={`${alertaFechamento === 'fechando' ? 'ri-alarm-warning-fill' : 'ri-time-line'} text-white text-base`} />
            <span className="text-white text-xs font-bold">
              {alertaFechamento === 'fechando'
                ? `Cozinha fechando agora! Horário de encerramento: ${sysSettings.kitchen_close_time}`
                : `Atenção: cozinha fecha às ${sysSettings.kitchen_close_time} (em menos de 15 min)`}
            </span>
          </div>
          <button onClick={() => setAlertaFechamento(null)} className="text-white/70 hover:text-white cursor-pointer">
            <i className="ri-close-line text-sm" />
          </button>
        </div>
      )}

      {/* Banner de pedido bloqueado para edição (PDV) */}
      {lockAlert && (
        <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 bg-red-500">
          <div className="flex items-center gap-2">
            <i className="ri-lock-line text-white text-base" />
            <span className="text-white text-xs font-bold">
              {lockAlert.message}
            </span>
          </div>
          <button onClick={() => setLockAlert(null)} className="text-white/70 hover:text-white cursor-pointer">
            <i className="ri-close-line text-sm" />
          </button>
        </div>
      )}

      {/* ── BUG-35: Banner de atualização de status com falha ── */}
      {(statusFailAlert || pendingStatusCount > 0) && (
        <div className="flex items-center justify-between px-4 py-2 flex-shrink-0 bg-orange-500">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 flex items-center justify-center">
              <i className="ri-cloud-off-line text-white text-base" />
            </div>
            <span className="text-white text-xs font-bold">
              {pendingStatusCount > 0
                ? `${pendingStatusCount} atualização${pendingStatusCount > 1 ? 'ções' : ''} de status pendente${pendingStatusCount > 1 ? 's' : ''} — tentando novamente em breve`
                : 'Falha ao atualizar status — verifique a conexão'}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { flushPendingStatusQueue(); setStatusFailAlert(null); }}
              className="px-3 py-1 bg-white/20 hover:bg-white/30 text-white text-xs font-bold rounded-md cursor-pointer whitespace-nowrap transition-colors"
            >
              Tentar agora
            </button>
            <button
              onClick={() => setStatusFailAlert(null)}
              className="text-white/70 hover:text-white cursor-pointer"
            >
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        </div>
      )}

      {/* Painéis Pronto / Entregue */}
      {showPanel && (
        <KDSListPanel
          tipo={showPanel}
          pedidos={showPanel === 'pronto' ? prontos : entregues}
          estacaoFiltro={estacaoFiltro}
          onAvancarPedido={(id) => { handleAvancarPedido(id); }}
          onAvancarItem={(pedidoId, itemId) => { handleAvancarItem(pedidoId, itemId, 'entregue'); }}
          onAvancarUnidade={(pedidoId, itemId, unidadeId) => { handleAvancarUnidade(pedidoId, itemId, unidadeId, 'entregue'); }}
          onAvancarTodos={showPanel === 'pronto' ? handleAvancarTodos : undefined}
          onClose={() => setShowPanel(null)}
        />
      )}

      {/* Top Bar */}
      <KDSTopBar
        estacaoFiltro={estacaoFiltro}
        estacoesNomes={estacoesNomes}
        contadorPorEstacao={contadorPorEstacao}
        alertasOutrasEstacoes={alertasOutrasEstacoes}
        totalAtivos={totalAtivos}
        totalNovos={totalNovos}
        somAtivo={somAtivo}
        sessaoNumero={sessao?.numero}
        clock={clock}
        insumosEsgotadosCount={insumosEsgotados.length}
        estacaoInfo={estacaoInfo}
        busca={buscaKDS}
        onBuscaChange={setBuscaKDS}
        onEstacaoChange={setEstacaoFiltro}
        onAtivarSom={handleAtivarSom}
        onAdicionarOperador={() => setShowAdicionarOperador(true)}
        onRegistrarPerda={() => setShowRegistrarPerda(true)}
        onEsgotadoModal={() => {
          setShowEsgotadoModal(true);
          setBuscaInsumo('');
          setInsumoEsgotadoId('');
        }}
        onFecharEstacao={() => setShowFecharEstacao(true)}
      />

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
        </div>
      )}

      {/* Status Bar */}
      <KDSStatusBar
        prontos={prontos}
        entregues={entregues}
        emRota={emRota}
        somAtivo={somAtivo}
        onShowProntos={() => setShowPanel('pronto')}
        onShowEntregues={() => setShowPanel('entregue')}
      />

      {/* Kanban */}
      <div className="flex gap-3 flex-1 overflow-x-auto overflow-y-hidden p-3 snap-x snap-mandatory scroll-smooth">
        <div className="flex gap-3 min-w-max lg:min-w-0 lg:w-full h-full">
          <div className="w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-2rem)] md:w-auto flex-shrink-0 md:flex-1 snap-start lg:snap-none min-w-[340px] lg:min-w-0 h-full flex flex-col">
            <KDSColuna status="novo" count={novos.length} invertSort onToggleSort={() => setInvertOrdemNovos((v) => !v)} sortLabel={invertOrdemNovos ? 'Mais recente' : 'Mais antigo'}>
              {novos.map((pedido) => (
                <KDSCard
                  key={`${pedido.id}-novo`}
                  pedido={pedido}
                  faseColuna="novo"
                  estacaoFiltro={estacaoFiltro}
                  onAvancar={handleAvancarItem}
                  onAvancarParte={handleAvancarParte}
                  onAvancarPedido={handleAvancarPedido}
                  onMarcarEmRota={handleMarcarEmRota}
                  onToggleObsChecada={handleToggleObsChecada}
                  onAvancarUnidade={handleAvancarUnidade}
                  onSelecionarOperadorUnidade={handleSelecionarOperadorUnidade}
                  operadoresDisponiveis={operadoresDisponiveis}
                  onSelecionarOperador={handleSelecionarOperadorItem}
                  onAtribuirOperadorTodos={handleAtribuirOperadorTodos}
                  onSetObsLivre={handleSetObsLivre}
                />
              ))}
            </KDSColuna>
          </div>
          <div className="w-[calc(100vw-1.5rem)] sm:w-[calc(100vw-2rem)] md:w-auto flex-shrink-0 md:flex-1 snap-start lg:snap-none min-w-[340px] lg:min-w-0 h-full flex flex-col">
            <KDSColuna status="preparo" count={preparo.length} invertSort onToggleSort={() => setInvertOrdemPreparo((v) => !v)} sortLabel={invertOrdemPreparo ? 'Mais antigo' : 'Mais recente'}>
              {preparo.map((pedido) => (
                <KDSCard
                  key={`${pedido.id}-preparo`}
                  pedido={pedido}
                  faseColuna="preparo"
                  estacaoFiltro={estacaoFiltro}
                  onAvancar={handleAvancarItem}
                  onAvancarParte={handleAvancarParte}
                  onAvancarPedido={handleAvancarPedido}
                  onMarcarEmRota={handleMarcarEmRota}
                  onToggleObsChecada={handleToggleObsChecada}
                  onAvancarUnidade={handleAvancarUnidade}
                  onSelecionarOperadorUnidade={handleSelecionarOperadorUnidade}
                  operadoresDisponiveis={operadoresDisponiveis}
                  onSelecionarOperador={handleSelecionarOperadorItem}
                  onAtribuirOperadorTodos={handleAtribuirOperadorTodos}
                  onSetObsLivre={handleSetObsLivre}
                />
              ))}
            </KDSColuna>
          </div>
        </div>
      </div>

      {/* Modais */}
      {showRegistrarPerda && (
        <RegistrarPerdaModal
          operador={estacaoInfo?.operadorNome ?? 'Operador KDS'}
          onClose={() => setShowRegistrarPerda(false)}
        />
      )}

      {showAdicionarOperador && (
        <AdicionarOperadorModal
          estacaoAtual={estacaoFiltro}
          onClose={() => setShowAdicionarOperador(false)}
        />
      )}

      {showEsgotadoModal && (
        <KDSEsgotadoModal
          insumos={insumos}
          insumosEsgotados={insumosEsgotados}
          itensAtivos={itensAtivos}
          buscaInsumo={buscaInsumo}
          insumoEsgotadoId={insumoEsgotadoId}
          operadorNome={estacaoInfo?.operadorNome ?? 'KDS'}
          onBuscaChange={(v) => { setBuscaInsumo(v); setInsumoEsgotadoId(''); }}
          onSelecionarInsumo={setInsumoEsgotadoId}
          onConfirmar={() => {
            if (insumoEsgotadoId) {
              marcarInsumoEsgotado(insumoEsgotadoId, estacaoInfo?.operadorNome ?? 'KDS');
              setShowEsgotadoModal(false);
              setInsumoEsgotadoId('');
              setBuscaInsumo('');
            }
          }}
          onClose={() => {
            setShowEsgotadoModal(false);
            setInsumoEsgotadoId('');
            setBuscaInsumo('');
          }}
        />
      )}

      {showFecharEstacao && (
        <KDSFecharEstacaoModal
          estacaoFiltro={estacaoFiltro}
          onConfirmar={handleFecharEstacaoConfirm}
          onClose={() => setShowFecharEstacao(false)}
        />
      )}
    </div>
  );
}
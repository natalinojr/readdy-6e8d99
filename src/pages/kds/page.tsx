import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { type KDSPedido, type KDSItem, type KDSItemStatus, type KDSUnidade } from '../../types/kds';

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

function deriveItemStatus(item: KDSItem): KDSItemStatus {
  if (item.partes && item.partes.length > 0) {
    const statuses = item.partes.map((p) => p.status);
    if (statuses.every((s) => s === 'entregue')) return 'entregue';
    if (statuses.every((s) => s === 'pronto' || s === 'entregue')) return 'pronto';
    if (statuses.some((s) => s === 'preparo' || s === 'pronto')) return 'preparo';
    return 'novo';
  }
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
  const kitchenItens = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  const allItens = pedido.itens;
  // Todos os itens (incluindo skip_kds) devem estar entregues para o pedido ser 'entregue'
  if (allItens.every((i) => deriveItemStatus(i) === 'entregue')) return 'entregue';
  // Se não há itens de cozinha e os skip_kds ainda não estão todos entregues,
  // verifica se todos os skip_kds estão pelo menos prontos
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
  const { estado, sessao, estacoesAbertas, fecharEstacao } = useSessao();
  const { deductSaleItems, marcarInsumoEsgotado, insumosEsgotados, insumos } = useEstoque();
  const { pedidos, setPedidos, updateItemStatusRemote, updateUnitStatusRemote, toggleObsChecadaRemote } = useKDS();
  const { itensAtivos, estacoes } = useCardapio();
  const { settings: sysSettings } = useSystemSettings();

  // ── Alerta de fechamento da cozinha ──────────────────────────────────────
  const [alertaFechamento, setAlertaFechamento] = useState<'aviso' | 'fechando' | null>(null);
  useEffect(() => {
    const closeTime = sysSettings.kitchen_close_time; // 'HH:MM'
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
  const [somAtivo, setSomAtivo] = useState(false);
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

  // Ordenação das colunas KDS
  const [invertOrdemNovos, setInvertOrdemNovos] = useState(false);
  const [invertOrdemPreparo, setInvertOrdemPreparo] = useState(false);

  useEffect(() => {
    if (estado === 'sem_sessao') setLogado(false);
  }, [estado]);

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
        if (pedidoAtual?.status === 'pronto' || pedidoAtual?.status === 'em_rota') {
          const itensParaDeducao = pedidoAtual.itens.map((i) => ({
            itemId: i.menuItemId ?? i.id,
            nome: i.nome,
            quantidade: i.quantidade,
          }));
          deductSaleItems(pedidoAtual.numero, itensParaDeducao);
        }
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
    [estacaoFiltro, estacoesAbertas, deductSaleItems, setPedidos, updateItemStatusRemote],
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
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const nowTs = Date.now();
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
    },
    [estacaoFiltro, somAtivo, playPedidoPronto, setPedidos],
  );

  const handleToggleObsChecada = useCallback(
    (pedidoId: string, itemId: string, obs: string) => {
      let obsIndex = 0;
      let checked = false;

      // Optimistic update local
      setPedidos((prev) =>
        prev.map((p) => {
          if (p.id !== pedidoId) return p;
          const itens = p.itens.map((i) => {
            if (i.id !== itemId) return i;
            const atuais = i.observacoesChecadas ?? [];
            const jaChecada = atuais.includes(obs);
            checked = !jaChecada;
            // Determina o index da observação no array original
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

      // BUG 3.10 FIX: Persiste no banco de forma assíncrona (fire-and-forget)
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
      // Extract unit number from unidadeId (format: `${itemId}-u${numero}`)
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

      // Persiste no banco — sem isso o Realtime reseta as unidades para o status agregado
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
        const itensParaDeducao = p.itens.map((i) => ({
          itemId: i.menuItemId ?? i.id,
          nome: i.nome,
          quantidade: i.quantidade,
        }));
        deductSaleItems(p.numero, itensParaDeducao);
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
  }, [estacaoFiltro, estacoesAbertas, deductSaleItems, setPedidos]);

  const { novos, preparo, prontos, entregues, emRota, contadorPorEstacao, alertasOutrasEstacoes } =
    usePedidosFiltrados({ pedidos, estacaoFiltro, invertNovos: invertOrdemNovos, invertPreparo: invertOrdemPreparo, busca: buscaKDS }, estacoesNomes);

  const operadoresDisponiveis = useMemo(
    () => [...new Set(estacoesAbertas.map((e) => e.operadorNome))],
    [estacoesAbertas],
  );

  const totalNovos = novos.length;
  const totalAtivos = novos.length + preparo.length;

  const estacaoInfo =
    estacaoFiltro !== 'Todas'
      ? estacoesAbertas.find((e) => e.estacaoNome === estacaoFiltro) ?? null
      : null;

  if (!logado) {
    return <KDSSetupScreen onConfirm={handleLoginSuccess} />;
  }

  return (
    <div className="flex flex-col h-full overflow-hidden bg-white">

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
      <div className="flex gap-3 flex-1 overflow-x-auto overflow-y-hidden p-3">
        <div className="flex gap-3 min-w-max lg:min-w-0 lg:w-full">
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

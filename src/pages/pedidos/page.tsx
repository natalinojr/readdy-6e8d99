import { useState, useMemo, useRef, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import NotasFiscaisList from './components/NotasFiscaisList';
import { kdsParaRecente, dbParaRecente, agruparPedidosUnificados } from './lib/conversores';
import type { PedidoRecente } from '@/types/pdv';
import { useKDS } from '@/contexts/KDSContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';
import { supabase } from '@/lib/supabase';
import type { KDSPedido } from '@/types/kds';
import { useOrdersHistory } from '@/hooks/useOrdersHistory';
import { useOrdersPing } from '@/hooks/useOrdersPing';
import { useSessions } from '@/hooks/useSessions';
import { useFiscalDocs } from '@/hooks/useFiscalDocs';
import { useLojaTemIfood } from '@/hooks/useLojaTemIfood';
import { PLATAFORMAS_DELIVERY } from '@/constants/delivery';
import { useSessao } from '@/contexts/SessaoContext';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import { getHojeBR, somarDias } from './components/utils';
import type { ModoPeriodo } from './components/utils';
import {
  resumoPedidos, pendenciasPedidos, passaNoChip, filtrarComGrupos, buscaPedido, canalPedido, numeroCurto, canalFiscal,
  type FiltroChip, type Canal, type ContextoFiltro,
} from '@/lib/pedidosRegras';
import { SecaoTitulo, Nota, type ItemMenu } from '@/components/kit';
import PedidosCabecalho from './components/novo/Cabecalho';
import PeriodoFolha, { rotuloEscolha, rotuloSessao, type EscolhaPeriodo } from './components/novo/PeriodoFolha';
import HorasFolha from './components/novo/HorasFolha';
import PedidosResumo from './components/novo/Resumo';
import PrecisaDeVoce, { idsEsquecidos, contarPendencias } from './components/novo/PrecisaDeVoce';
import ChipsPedidos from './components/novo/ChipsPedidos';
import ListaPedidos from './components/novo/ListaPedidos';
import PedidoDetalhe from './components/novo/PedidoDetalhe';
import { usePedidoAcoes } from './lib/usePedidoAcoes';
import { usePedidosEsquecidos } from './lib/usePedidosEsquecidos';
import { baixarPedidosCsv } from './lib/exportar';
import { useIfoodNoPedidos } from './lib/useIfoodNoPedidos';
import { janelaIfoodPedidos } from './lib/ifoodExterno';

// Pedidos (layout novo aprovado em 2026-10-04 — docs/prototipos/pedidos-proposta.html):
// frase do dia + "Precisa de você" com o botão que resolve, faixa de números, filtros com
// contagem, lista enxuta (celular) / tabela de 5 colunas + painel do pedido (computador).
// Regras em src/lib/pedidosRegras.ts; ações em lib/usePedidoAcoes.tsx.

const ddmm = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

/** Computador (≥1024px): o pedido abre num painel ao lado da lista; no celular, numa folha. */
function useTelaLarga(): boolean {
  const consulta = '(min-width: 1024px)';
  const [larga, setLarga] = useState(() => typeof window !== 'undefined' && window.matchMedia(consulta).matches);
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const mudar = () => setLarga(mq.matches);
    mq.addEventListener('change', mudar);
    return () => mq.removeEventListener('change', mudar);
  }, []);
  return larga;
}

export default function PedidosPage() {
  // Aba "Notas Fiscais" (NFC-e) vive dentro de Pedidos: /pedidos?tab=notas
  const [searchParams, setSearchParams] = useSearchParams();
  const abaAtiva: 'pedidos' | 'notas' = searchParams.get('tab') === 'notas' ? 'notas' : 'pedidos';
  const setAba = (t: 'pedidos' | 'notas') => setSearchParams(t === 'notas' ? { tab: 'notas' } : {}, { replace: true });
  const [busca, setBusca] = useState('');
  const [chip, setChip] = useState<FiltroChip>('todos');
  const [canal, setCanal] = useState<Canal | 'todos'>('todos');
  const [plataforma, setPlataforma] = useState<string>('todas');
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [periodoAberto, setPeriodoAberto] = useState(false);
  const [horasAberto, setHorasAberto] = useState(false);
  const { pedidos: kdsPedidos } = useKDS();
  const { user } = useAuth();
  const { modo, setModo } = useModoFaturamento();
  const { success: toastOk, error: toastErro } = useToast();

  // Sessão atual do SessaoContext (para modo sessão ativa)
  const { sessao: sessaoAtiva, loadingSession } = useSessao();

  // "Hoje" de Brasília recalculado a cada minuto: a aba aberta de um dia para o outro
  // não fica presa no dia em que carregou (antes mostrava ontem com o rótulo "Hoje").
  const [hoje, setHoje] = useState(getHojeBR);
  useEffect(() => {
    const id = setInterval(() => setHoje((h) => { const agora = getHojeBR(); return agora === h ? h : agora; }), 60_000);
    return () => clearInterval(id);
  }, []);

  // Filtro de data
  const [modoPeriodo, setModoPeriodo] = useState<ModoPeriodo>('preset');
  const [presetAtivo, setPresetAtivo] = useState<string>('hoje');
  const [diaEspecifico, setDiaEspecifico] = useState(getHojeBR);
  const [periodoInicio, setPeriodoInicio] = useState(() => somarDias(getHojeBR(), -6));
  const [periodoFim, setPeriodoFim] = useState(getHojeBR);
  const [mesSelecionado, setMesSelecionado] = useState(() => Number(getHojeBR().slice(5, 7)) - 1);
  const [anoSelecionado, setAnoSelecionado] = useState(() => Number(getHojeBR().slice(0, 4)));
  const [anoApenas, setAnoApenas] = useState(() => Number(getHojeBR().slice(0, 4)));

  // Sessão histórica selecionada pelo usuário
  const { sessions, loading: loadingSessions } = useSessions(30);
  const [sessaoSelecionadaId, setSessaoSelecionadaId] = useState<string | null>(null);

  /**
   * LÓGICA DE FILTRO PARA O HOOK:
   *
   * Modo SESSÃO:
   *   - sessaoSelecionadaId = null → usa sessão ATIVA atual (sessaoAtiva.id)
   *   - sessaoSelecionadaId = id   → filtra por sessão histórica
   *
   * Modo DATA (Hoje / Ontem / período):
   *   - presetAtivo = 'hoje' SEM filtro de data → usa RPC (últimas 12h) = mais confiável
   *   - presetAtivo = outros → usa filtro de data direto
   */
  const { hookDateFrom, hookDateTo, hookSessionId } = useMemo(() => {
    if (modo === 'sessao') {
      // Sessão histórica selecionada
      if (sessaoSelecionadaId) {
        return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: sessaoSelecionadaId };
      }
      // Sessão ativa atual — passa o ID da sessão para a RPC
      const activeId = sessaoAtiva?.id ?? null;
      return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: activeId };
    }

    // Modo data
    if (modoPeriodo === 'preset') {
      if (presetAtivo === 'hoje') {
        // "Hoje" = filtro de data direto para garantir apenas pedidos do dia atual
        return { hookDateFrom: hoje, hookDateTo: hoje, hookSessionId: null };
      }
      if (presetAtivo === 'ontem') {
        const d = somarDias(hoje, -1);
        return { hookDateFrom: d, hookDateTo: d, hookSessionId: null };
      }
      if (presetAtivo === '7dias') {
        return { hookDateFrom: somarDias(hoje, -6), hookDateTo: hoje, hookSessionId: null };
      }
      if (presetAtivo === '30dias') {
        return { hookDateFrom: somarDias(hoje, -29), hookDateTo: hoje, hookSessionId: null };
      }
      if (presetAtivo === 'mes') {
        return { hookDateFrom: `${hoje.slice(0, 7)}-01`, hookDateTo: hoje, hookSessionId: null };
      }
      if (presetAtivo === 'ano') {
        return { hookDateFrom: `${hoje.slice(0, 4)}-01-01`, hookDateTo: hoje, hookSessionId: null };
      }
      // 'todos' = sem filtro de data. Vai pela consulta paginada (teto de 5.000 com aviso);
      // sem data nenhuma o hook cai na RPC do KDS, que só traz os pedidos de hoje.
      return { hookDateFrom: '2000-01-01', hookDateTo: undefined, hookSessionId: null };
    }
    if (modoPeriodo === 'dia') {
      return { hookDateFrom: diaEspecifico, hookDateTo: diaEspecifico, hookSessionId: null };
    }
    if (modoPeriodo === 'periodo') {
      return { hookDateFrom: periodoInicio, hookDateTo: periodoFim, hookSessionId: null };
    }
    if (modoPeriodo === 'mes') {
      const mesStr = String(mesSelecionado + 1).padStart(2, '0');
      const lastDay = new Date(anoSelecionado, mesSelecionado + 1, 0).getDate();
      return {
        hookDateFrom: `${anoSelecionado}-${mesStr}-01`,
        hookDateTo: `${anoSelecionado}-${mesStr}-${String(lastDay).padStart(2, '0')}`,
        hookSessionId: null,
      };
    }
    if (modoPeriodo === 'ano') {
      return { hookDateFrom: `${anoApenas}-01-01`, hookDateTo: `${anoApenas}-12-31`, hookSessionId: null };
    }
    return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: null };
  }, [
    modo, sessaoSelecionadaId, sessaoAtiva?.id, hoje,
    modoPeriodo, presetAtivo, diaEspecifico,
    periodoInicio, periodoFim, mesSelecionado,
    anoSelecionado, anoApenas,
  ]);

  const { orders: dbOrders, loading: loadingSessaoOrders, truncated: ordersTruncated, reload: reloadOrders } = useOrdersHistory(
    hookDateFrom,
    hookDateTo,
    hookSessionId,
  );

  // ── Sincronização em tempo real (orientada a eventos) ─────────────────────
  // Em vez de consultar o banco a cada poucos segundos, escutamos o Supabase
  // Realtime: qualquer INSERT/UPDATE em orders ou payments (do tenant) dispara
  // um reload — agrupado por um debounce para não recarregar em rajada. 100%
  // orientado a eventos (sem poll). O botão de atualizar manual cobre o caso
  // raro de um evento realtime perdido.
  // Ping instantâneo via trigger no banco (orders-ping) — cobre o buraco do
  // postgres_changes (RLS por linha + cold start). Reusa o mesmo debounce de 800ms.
  // "Ao vivo" = olhando pedidos que ainda podem mudar agora: sessão atual, Hoje, ou o dia de hoje.
  // Só aí a lista recarrega a cada pedido e entram os pedidos que o KDS já tem e o banco ainda não.
  const aoVivo = modo === 'sessao'
    ? !sessaoSelecionadaId
    : (modoPeriodo === 'preset' && presetAtivo === 'hoje') || (modoPeriodo === 'dia' && diaEspecifico === hoje);
  // Modo sessão sem sessão aberta: não mostra os pedidos de hoje com o rótulo "Sessão atual"
  const semSessaoAberta = modo === 'sessao' && !sessaoSelecionadaId && !sessaoAtiva?.id && !loadingSession;

  const pingDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Pedido do iFood que entra na cozinha vira `orders`: relê os do iFood junto, senão ele aparece duas vezes até o próximo minuto.
  const recarregarIfoodRef = useRef<() => void>(() => undefined);
  useOrdersPing(user?.tenantId, () => {
    if (!aoVivo) return;
    if (pingDebounceRef.current) clearTimeout(pingDebounceRef.current);
    pingDebounceRef.current = setTimeout(() => {
      reloadOrders(hookDateFrom, hookDateTo, hookSessionId ?? null);
      recarregarIfoodRef.current();
    }, 800);
  });
  useEffect(() => () => { if (pingDebounceRef.current) clearTimeout(pingDebounceRef.current); }, []);
  // Filtro mudou: descarta o reload agendado com o filtro antigo (ele gravaria os pedidos de hoje sob "Ontem")
  useEffect(() => { if (pingDebounceRef.current) clearTimeout(pingDebounceRef.current); }, [hookDateFrom, hookDateTo, hookSessionId]);

  useEffect(() => {
    if (!aoVivo || !user?.tenantId) return;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const agendarReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        reloadOrders(hookDateFrom, hookDateTo, hookSessionId ?? null);
      }, 800);
    };

    const canal = supabase
      .channel(`pedidos-page-${user.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${user.tenantId}` }, agendarReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `tenant_id=eq.${user.tenantId}` }, agendarReload)
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(canal);
    };
  }, [user?.tenantId, reloadOrders, hookDateFrom, hookDateTo, hookSessionId, aoVivo]);

  useEffect(() => {
    if (modo !== 'sessao') setSessaoSelecionadaId(null);
  }, [modo]);

  const sessaoSelecionada = useMemo(
    () => sessions.find((s) => s.id === sessaoSelecionadaId) ?? null,
    [sessions, sessaoSelecionadaId],
  );

  // ── Pedidos do iFood que só existem em ifood_orders (modo "Só acompanhar") ──
  // Mesmo período da lista; os que viraram `orders` (entrar na cozinha) já vêm de dbOrders.
  const lojaTemIfood = useLojaTemIfood(user?.tenantId) === true;
  const janelaIfood = useMemo(() => {
    if (semSessaoAberta) return null;
    const sessao = sessaoSelecionada
      ? { opened_at: sessaoSelecionada.opened_at, closed_at: sessaoSelecionada.closed_at }
      : (sessaoAtiva?.dataRef ? { opened_at: sessaoAtiva.dataRef.toISOString(), closed_at: null } : null);
    return janelaIfoodPedidos({ dateFrom: hookDateFrom, dateTo: hookDateTo, hoje, sessao, modoSessao: modo === 'sessao' });
  }, [semSessaoAberta, sessaoSelecionada, sessaoAtiva?.dataRef, hookDateFrom, hookDateTo, hoje, modo]);
  const { pedidos: pedidosIfood, recarregar: recarregarIfood } = useIfoodNoPedidos(user?.tenantId, janelaIfood, {
    ativo: lojaTemIfood,
    comHoje: aoVivo,
  });
  recarregarIfoodRef.current = recarregarIfood;

  // ── Merge: DB (fonte da verdade) + KDS (status em tempo real) ────────────
  const pedidosErpos = useMemo(() => {
    if (semSessaoAberta) return [];
    const kdsMap = new Map(kdsPedidos.map((p) => [p.id, p]));
    const dataBR = (p: KDSPedido) => new Date(p.criadoEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    // Pedido que o KDS já tem e o banco ainda não devolveu: só entra olhando "ao vivo"
    // (numa sessão encerrada ou em outro dia ele entrava com total 0 e "Pendente").
    const soDoKds = () => (aoVivo ? kdsPedidos : [])
      .filter((p) => !p.isTraining && (modo === 'sessao' || dataBR(p) === hoje));

    if (dbOrders.length > 0) {
      const dbMapeados = dbOrders.map((o) => {
        const rec = dbParaRecente(o);
        // Enriquece com dados em tempo real do KDS
        const kds = kdsMap.get(o.id);
        if (kds) {
          const kdsStatusMap: Record<string, PedidoRecente['status']> = {
            novo: 'new', preparo: 'preparing', pronto: 'ready', entregue: 'delivered',
          };
          // Cancelado no banco é definitivo — o KDS pode ainda guardar o pedido como "novo"
          if (kds.isCancelled) {
            rec.status = 'cancelled';
          } else if (rec.status !== 'cancelled' && rec.status !== 'cancelado') {
            rec.status = kdsStatusMap[kds.status] ?? rec.status;
          }

          // Senha/nome do participante (QR universal) — só o KDS resolve esses campos
          if (kds.participantToken) rec.participantToken = kds.participantToken;
          if (kds.participantName) rec.participantName = kds.participantName;

          // ── Timestamps para SLA em tempo real: usa KDS que tem os dados mais frescos ──
          const kdsIniciouPreparo = kds.itens
            .map((i) => i.iniciouPreparoEm)
            .filter((t): t is number => !!t)
            .sort((a, b) => a - b)[0];
          const kdsFicouPronto = kds.itens
            .map((i) => i.ficouProntoEm)
            .filter((t): t is number => !!t)
            .sort((a, b) => a - b)[0];

          // Sobrescreve os timestamps com dados do KDS (mais confiáveis em tempo real)
          if (kdsIniciouPreparo) {
            rec._iniciouPreparoTs = new Date(kdsIniciouPreparo).toISOString();
          }
          if (kdsFicouPronto) {
            rec._ficouProntoTs = new Date(kdsFicouPronto).toISOString();
          }
          // Timestamp de criação do KDS (mais preciso que o DB)
          rec._criadoTs = new Date(kds.criadoEm).toISOString();

          const temposPreparo = kds.itens
            .filter((i) => i.iniciouPreparoEm && i.ficouProntoEm)
            .map((i) => (i.ficouProntoEm! - i.iniciouPreparoEm!) / 60000);
          if (temposPreparo.length > 0) {
            rec.slaCozinha = Math.round(temposPreparo.reduce((a, b) => a + b, 0) / temposPreparo.length);
          }
        }
        return rec;
      });

      // Adiciona pedidos do KDS que ainda não existem no DB (recém-criados)
      const dbIds = new Set(dbOrders.map((o) => o.id));
      const apenasKds = soDoKds().filter((p) => !dbIds.has(p.id)).map(kdsParaRecente);

      return [...apenasKds, ...dbMapeados];
    }

    // Enquanto carrega, não mostra KDS (total=0 poluiria a lista)
    if (loadingSessaoOrders) return [];

    // DB vazio após carregamento: usa os pedidos de agora do KDS (só ao vivo)
    return soDoKds().map(kdsParaRecente);
  }, [kdsPedidos, dbOrders, loadingSessaoOrders, modo, aoVivo, semSessaoAberta, hoje]);

  // Pedidos do iFood só acompanhados entram na mesma lista, na ordem do relógio.
  const pedidos = useMemo(() => {
    if (pedidosIfood.length === 0) return pedidosErpos;
    const ts = (p: PedidoRecente) => (p._criadoTs ? new Date(p._criadoTs).getTime() : 0);
    return [...pedidosErpos, ...pedidosIfood].sort((a, b) => ts(b) - ts(a));
  }, [pedidosErpos, pedidosIfood]);

  // ── Filtro de data no frontend (apenas para filtragem visual) ─────────────
  const filtrarPorData = (p: PedidoRecente): boolean => {
    if (modo === 'sessao') return true;
    const data = p.dataPedido ?? hoje;
    if (modoPeriodo === 'preset') {
      if (presetAtivo === 'hoje') return data === hoje;
      if (presetAtivo === 'ontem') return data === somarDias(hoje, -1);
      if (presetAtivo === '7dias') return data >= somarDias(hoje, -6) && data <= hoje;
      if (presetAtivo === '30dias') return data >= somarDias(hoje, -29) && data <= hoje;
      if (presetAtivo === 'mes') return data.startsWith(hoje.slice(0, 7));
      if (presetAtivo === 'ano') return data.startsWith(hoje.slice(0, 4));
      return true;
    }
    if (modoPeriodo === 'dia') return data === diaEspecifico;
    if (modoPeriodo === 'periodo') return data >= periodoInicio && data <= periodoFim;
    if (modoPeriodo === 'mes') {
      const mesStr = String(mesSelecionado + 1).padStart(2, '0');
      return data.startsWith(`${anoSelecionado}-${mesStr}`);
    }
    if (modoPeriodo === 'ano') return data.startsWith(`${anoApenas}`);
    return true;
  };

  // ── Período (folha "Quais pedidos ver?") ──────────────────────────────────
  const escolha: EscolhaPeriodo = useMemo(() => {
    if (modoPeriodo === 'dia') return { modo: 'dia', dia: diaEspecifico };
    if (modoPeriodo === 'periodo') return { modo: 'periodo', inicio: periodoInicio, fim: periodoFim };
    if (modoPeriodo === 'mes') return { modo: 'mes', mes: mesSelecionado, ano: anoSelecionado };
    if (modoPeriodo === 'ano') return { modo: 'ano', ano: anoApenas };
    return { modo: 'preset', preset: presetAtivo as Extract<EscolhaPeriodo, { modo: 'preset' }>['preset'] };
  }, [modoPeriodo, presetAtivo, diaEspecifico, periodoInicio, periodoFim, mesSelecionado, anoSelecionado, anoApenas]);

  const escolherPeriodo = (e: EscolhaPeriodo) => {
    setModoPeriodo(e.modo as ModoPeriodo);
    if (e.modo === 'preset') setPresetAtivo(e.preset);
    else if (e.modo === 'dia') setDiaEspecifico(e.dia);
    else if (e.modo === 'periodo') { setPeriodoInicio(e.inicio); setPeriodoFim(e.fim); }
    else if (e.modo === 'mes') { setMesSelecionado(e.mes); setAnoSelecionado(e.ano); }
    else setAnoApenas(e.ano);
    setSelecionadoId(null);
  };

  const rotuloPeriodo = modo === 'sessao' ? rotuloSessao(sessaoSelecionada) : rotuloEscolha(escolha, hoje);
  const tituloResumo = modo === 'sessao'
    ? (sessaoSelecionada ? rotuloSessao(sessaoSelecionada) : 'Turno de hoje')
    : rotuloEscolha(escolha, hoje);

  // ── Relógio da tela (selos "Na cozinha · 12 min" andam sozinhos) ─────────
  const [agoraMs, setAgoraMs] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setAgoraMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // ── Pedidos do período → canal → grupos (pagos juntos) → chip + busca ────
  const doPeriodo = useMemo(
    () => pedidos.filter(filtrarPorData),
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [pedidos, modo, modoPeriodo, presetAtivo, diaEspecifico, periodoInicio, periodoFim, mesSelecionado, anoSelecionado, anoApenas, hoje],
  );
  const canaisPresentes = useMemo(() => [...new Set(doPeriodo.map(canalPedido))] as Canal[], [doPeriodo]);
  const plataformasPresentes = useMemo(() => {
    const keys = new Set(doPeriodo.filter((p) => p.origem === 'delivery').map((p) => p.deliveryPlatform ?? ''));
    const lista: { key: string; label: string }[] = PLATAFORMAS_DELIVERY
      .filter((pl) => keys.has(pl.key)).map((pl) => ({ key: pl.key as string, label: pl.label }));
    if (keys.has('')) lista.push({ key: '', label: 'Sem plataforma' });
    return lista;
  }, [doPeriodo]);
  const passaCanal = useMemo(() => (p: PedidoRecente) => {
    if (canal === 'todos') return true;
    if (canalPedido(p) !== canal) return false;
    return canal !== 'delivery' || plataforma === 'todas' || (p.deliveryPlatform ?? '') === plataforma;
  }, [canal, plataforma]);
  // Números de cima: pedidos individuais do canal escolhido
  const doCanal = useMemo(() => doPeriodo.filter(passaCanal), [doPeriodo, passaCanal]);
  // Lista: agrupa antes de filtrar o canal — o grupo pago junto aparece inteiro
  const grupos = useMemo(() => filtrarComGrupos(agruparPedidosUnificados(doPeriodo), passaCanal), [doPeriodo, passaCanal]);

  // Pedido do iFood só acompanhado não tem nota nem existe em `orders`: o id dele não vai para a consulta fiscal.
  const idsDoPeriodo = useMemo(() => doPeriodo.filter((p) => !p.ifoodExterno).map((p) => p.id), [doPeriodo]);
  const fiscal = useFiscalDocs(idsDoPeriodo);
  // "Sem nota" só com a loja emitindo, a leitura das notas ok (senão o lote emitiria em dobro) e o canal
  // com emissão ligada (fiscal_settings.emit_on_*).
  const ctx: ContextoFiltro = useMemo(() => ({
    agoraMs, hoje, fiscalAtivo: fiscal.enabled === true && !fiscal.erroLeitura && fiscal.carregado,
    statusNota: (id: string) => fiscal.byOrder.get(id)?.status,
    emiteNota: fiscal.canais ? (p: PedidoRecente) => fiscal.canais![canalFiscal(p)] : undefined,
  }), [agoraMs, hoje, fiscal.enabled, fiscal.erroLeitura, fiscal.carregado, fiscal.byOrder, fiscal.canais]);

  // Bolinha vermelha da aba "Notas fiscais": notas recusadas ou com erro (mesma regra do grupo "problema"
  // da lista de notas). byOrder repete a nota de grupo em vários pedidos, então conta por id da nota.
  const notasProblema = useMemo(() => {
    const ids = new Set<string>();
    fiscal.byOrder.forEach((d) => { if (d.status === 'rejected' || d.status === 'error') ids.add(d.id); });
    return ids.size;
  }, [fiscal.byOrder]);

  const contagemChips = useMemo(() => {
    const n = {} as Record<FiltroChip, number>;
    (['todos', 'cozinha', 'naopago', 'semnota', 'cancelados'] as FiltroChip[]).forEach((c) => {
      n[c] = filtrarComGrupos(grupos, (p) => passaNoChip(p, c, ctx)).length;
    });
    return n;
  }, [grupos, ctx]);

  const lista = useMemo(
    () => filtrarComGrupos(grupos, (p) => passaNoChip(p, chip, ctx) && buscaPedido(p, busca)),
    [grupos, chip, ctx, busca],
  );

  const resumo = useMemo(() => resumoPedidos(doCanal), [doCanal]);
  const pend = useMemo(() => pendenciasPedidos(doCanal, ctx), [doCanal, ctx]);
  const { esquecidos, recarregar: recarregarEsquecidos } = usePedidosEsquecidos(hoje);
  // Esquecidos = andando há 12 h+ na lista carregada + os de outros dias (consulta própria)
  const esquecidosInfo = useMemo(
    () => ({
      ids: esquecidos.map((e) => e.id),
      // "#204 de 17/09" (número curto + dia), não o código inteiro
      exemplo: esquecidos[0] ? `#${numeroCurto({ numeroCodigo: esquecidos[0].numeroCodigo, numero: 0 })} de ${ddmm(esquecidos[0].criadoTs)}` : undefined,
    }),
    [esquecidos],
  );
  const esquecidosIds = useMemo(() => idsEsquecidos(pend, esquecidosInfo), [pend, esquecidosInfo]);
  // Mesmo número de cartões que o "Precisa de você" mostra
  const nPendencias = contarPendencias(pend, esquecidosInfo, ctx.fiscalAtivo);

  // ── Pedido aberto (painel no computador, folha no celular) ───────────────
  const telaLarga = useTelaLarga();
  const selecionado = useMemo(() => {
    if (!selecionadoId) return null;
    return grupos.find((g) => g.id === selecionadoId) ?? doPeriodo.find((p) => p.id === selecionadoId) ?? null;
  }, [selecionadoId, grupos, doPeriodo]);
  const abrir = (p: PedidoRecente) => setSelecionadoId(p.id);
  // Trocou o que está sendo visto: fecha o pedido aberto (senão ele voltava sozinho e a tabela ficava compacta)
  useEffect(() => { setSelecionadoId(null); }, [modo, sessaoSelecionadaId, canal, plataforma, chip]);
  useEffect(() => { if (canal !== 'delivery') setPlataforma('todas'); }, [canal]);

  const recarregarTudo = () => {
    reloadOrders(hookDateFrom, hookDateTo, hookSessionId ?? null);
    recarregarIfood();
    fiscal.recarregar();
    recarregarEsquecidos();
  };
  const { acoes, elementos: elementosAcoes } = usePedidoAcoes({ onMudou: recarregarTudo });
  const onToast = (ok: boolean, titulo: string, msg?: string) => (ok ? toastOk(titulo, msg) : toastErro(titulo, msg));

  // Busca que não achou no período: um toque procura nos últimos 30 dias (mantém o texto)
  // Só para período recente e curto (Hoje, Ontem, 7 dias, um dia dos últimos 30 ou turno) — num mês/ano
  // escolhido de propósito o botão trocaria o período.
  const periodoCurto = modo === 'sessao'
    || (modoPeriodo === 'preset' && ['hoje', 'ontem', '7dias'].includes(presetAtivo))
    || (modoPeriodo === 'dia' && diaEspecifico >= somarDias(hoje, -29));
  const mostrarProcurar30 = busca.trim().length > 0 && periodoCurto;
  const procurar30 = () => {
    if (modo === 'sessao') setModo('calendario');
    escolherPeriodo({ modo: 'preset', preset: '30dias' });
    setChip('todos');
    setCanal('todos');
  };

  // Esquecidos são de outros dias: abre os últimos 30 dias já no filtro "Na cozinha"
  const verEsquecidos = () => {
    if (modo === 'sessao') setModo('calendario');
    if (!(modoPeriodo === 'preset' && ['30dias', 'ano', 'todos'].includes(presetAtivo))) escolherPeriodo({ modo: 'preset', preset: '30dias' });
    setCanal('todos');
    setBusca('');
    setChip('cozinha');
  };

  const menu: ItemMenu[] = [
    { rotulo: 'Baixar planilha · resumo', icone: 'ri-file-excel-2-line', onClick: () => baixarPedidosCsv(lista, 'resumo', rotuloPeriodo, hoje), oculto: lista.length === 0 },
    { rotulo: 'Baixar planilha · por item', icone: 'ri-file-list-2-line', onClick: () => baixarPedidosCsv(lista, 'detalhado', rotuloPeriodo, hoje), oculto: lista.length === 0 },
    { rotulo: 'Pedidos por hora', icone: 'ri-bar-chart-2-line', onClick: () => setHorasAberto(true) },
    { rotulo: 'Atualizar agora', icone: 'ri-refresh-line', onClick: recarregarTudo },
  ];

  const detalhe = selecionado && (
    <PedidoDetalhe
      pedido={selecionado}
      modo={telaLarga ? 'painel' : 'folha'}
      aberto={!!selecionado}
      onFechar={() => setSelecionadoId(null)}
      onAbrirPedido={abrir}
      agoraMs={agoraMs}
      hoje={hoje}
      fiscal={fiscal}
      onToast={onToast}
      acoes={acoes}
    />
  );

  return (
    <div className="flex flex-col h-full">
      <PedidosCabecalho
        aba={abaAtiva}
        onAba={setAba}
        busca={busca}
        onBusca={setBusca}
        rotuloPeriodo={rotuloPeriodo}
        onAbrirPeriodo={() => setPeriodoAberto(true)}
        // Na aba Notas o ⋯ é o da própria aba (emitir, XMLs, reprocessar)
        menu={abaAtiva === 'notas' ? [] : menu}
        notasProblema={notasProblema}
      />

      {abaAtiva === 'notas' && (
        <div className="flex-1 overflow-y-auto">
          <NotasFiscaisList />
        </div>
      )}

      {abaAtiva === 'pedidos' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 md:p-6 max-w-[1400px] mx-auto pb-16 space-y-4">
            {/* Turno encerrado escolhido */}
            {modo === 'sessao' && sessaoSelecionada && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-2xl text-xs text-amber-800">
                <i className="ri-archive-line text-amber-600 flex-shrink-0" />
                <span className="flex-1 min-w-0">
                  Turno encerrado · {ddmm(sessaoSelecionada.opened_at)} {hhmm(sessaoSelecionada.opened_at)}
                  {sessaoSelecionada.closed_at && ` → ${hhmm(sessaoSelecionada.closed_at)}`}
                  {sessaoSelecionada.operador && ` · ${sessaoSelecionada.operador}`}
                </span>
                <button onClick={() => setSessaoSelecionadaId(null)} className="font-bold text-amber-700 hover:text-amber-900 cursor-pointer whitespace-nowrap">Voltar ao turno atual</button>
              </div>
            )}
            {semSessaoAberta && (
              <div className="flex items-center gap-3 px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-2xl text-xs text-zinc-600">
                <i className="ri-store-2-line text-zinc-400 flex-shrink-0" />
                <span className="flex-1 min-w-0">Nenhum turno aberto agora. Escolha um turno anterior ou conte o dia pelo calendário.</span>
                <button onClick={() => setPeriodoAberto(true)} className="font-bold text-amber-700 cursor-pointer whitespace-nowrap">Escolher</button>
              </div>
            )}

            <PedidosResumo titulo={tituloResumo} resumo={resumo} nPendencias={nPendencias} onChip={setChip} carregando={loadingSessaoOrders} />

            <PrecisaDeVoce
              pend={pend}
              esquecidos={esquecidosInfo}
              resumo={resumo}
              acoes={acoes}
              onAbrir={abrir}
              onChip={setChip}
              onVerEsquecidos={verEsquecidos}
              agoraMs={agoraMs}
              hoje={hoje}
              fiscalAtivo={ctx.fiscalAtivo}
              carregando={loadingSessaoOrders}
            />

            {ordersTruncated && (
              <Nota className="!text-red-700 !bg-red-50">
                Este período tem mais de 5.000 pedidos: a lista e os números estão incompletos. Escolha um período menor ou use os Relatórios.
              </Nota>
            )}

            <div className="pt-2">
              <SecaoTitulo titulo="Pedidos" sub={rotuloPeriodo} />
              <ChipsPedidos
                chip={chip}
                onChip={setChip}
                n={contagemChips}
                fiscalAtivo={ctx.fiscalAtivo}
                canal={canal}
                onCanal={setCanal}
                canais={canaisPresentes}
                plataformas={plataformasPresentes}
                plataforma={plataforma}
                onPlataforma={setPlataforma}
              />
            </div>

            <div className={telaLarga && selecionado ? 'grid grid-cols-[minmax(0,1fr)_380px] gap-4 items-start' : ''}>
              <ListaPedidos
                itens={lista}
                chip={chip}
                carregando={loadingSessaoOrders}
                selecionadoId={selecionado ? selecionadoId : null}
                onAbrir={abrir}
                agoraMs={agoraMs}
                hoje={hoje}
                fiscal={fiscal}
                onToast={onToast}
                busca={busca}
                onBusca={setBusca}
                mostrarProcurar30={mostrarProcurar30}
                onProcurar30={procurar30}
                fiscalAtivo={ctx.fiscalAtivo}
                itensDoPeriodo={grupos}
              />
              {telaLarga && detalhe}
            </div>
          </div>
        </div>
      )}

      {!telaLarga && detalhe}

      <PeriodoFolha
        aberta={periodoAberto}
        onFechar={() => setPeriodoAberto(false)}
        hoje={hoje}
        escolha={escolha}
        onEscolher={escolherPeriodo}
        modoDia={modo === 'sessao' ? 'sessao' : 'calendario'}
        onModoDia={(m) => setModo(m)}
        sessoes={sessions}
        carregandoSessoes={loadingSessions}
        sessaoId={sessaoSelecionadaId}
        onSessao={setSessaoSelecionadaId}
        temSessaoAberta={!!sessaoAtiva?.id}
      />
      <HorasFolha aberta={horasAberto} onFechar={() => setHorasAberto(false)} pedidos={doCanal} />
      {elementosAcoes}
    </div>
  );
}

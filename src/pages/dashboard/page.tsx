import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import SalesChart from './components/SalesChart';
import MesasOverview from './components/MesasOverview';
import UltimosPedidos from './components/UltimosPedidos';
import CategoriasChart from './components/CategoriasChart';
import MaisVendidos from './components/MaisVendidos';
import HorariosPico from './components/HorariosPico';
import ResumoFinanceiro from './components/ResumoFinanceiro';
import DashboardModoToggle from './components/DashboardModoToggle';
import AtencaoFaixa, { type ItemAtencao } from './components/AtencaoFaixa';
import FaturamentoHero, { Variacao } from './components/FaturamentoHero';
import MetasModal from './components/MetasModal';
import PedidosAgora, { duracao } from './components/PedidosAgora';
import PorCanal, { type LinhaCanal } from './components/PorCanal';
import { useDashboardMetrics } from '../../hooks/useDashboardMetrics';
import { useDashboardPainel, salvarDashboardMetas } from '../../hooks/useDashboardPainel';
import { useVisaoGeralExtras } from '../../hooks/useVisaoGeralExtras';
import { useEstoqueSituacao } from '../../hooks/useEstoqueSituacao';
import { useFinanceiroAlertas } from '../../hooks/useFinanceiroAlertas';
import { useOrdersPing } from '../../hooks/useOrdersPing';
import { useAuth } from '../../contexts/AuthContext';
import { useKDS } from '../../contexts/KDSContext';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import { useSessaoFaturamento } from '@/hooks/useSessaoFaturamento';
import { useSessao } from '@/contexts/SessaoContext';
import { useIfoodVendas } from '@/hooks/useIfoodVendas';
import { useIfoodDiaLoja } from '@/hooks/useIfoodDiaLoja';
import { horaDoDia, inicioDoDia } from '@/lib/diaLoja';
import { useVendasHoraComparativo } from '@/hooks/useVendasHoraComparativo';
import { todayBrasilia, somarDias } from '@/lib/dateUtils';
import { diasComparacao, montarVendasHora } from '@/lib/vendasHoraComparativo';
import { useComparacoesLigadas } from '@/components/feature/ComparacaoVendasHora';
import { supabase, invokeWithAuth } from '@/lib/supabase';

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const pct = (current: number, prev: number) =>
  prev > 0 ? ((current - prev) / prev) * 100 : undefined;

const plural = (n: number, s: string, p = `${s}s`) => (n === 1 ? s : p);

// "sex passada" / "sáb passado" — comparação com o mesmo dia da semana anterior.
const ROTULO_SEMANA = ['dom passado', 'seg passada', 'ter passada', 'qua passada', 'qui passada', 'sex passada', 'sáb passado'];

const ORIGEM_CURTA: Record<string, string> = {
  table: 'Mesa', waiter: 'Garçom', cashier: 'Balcão', delivery: 'Delivery', self_service: 'Autoatend.',
};

// Abas do Financeiro para cada alerta (mesmo mapa do antigo bloco "Alertas Financeiros")
const FIN_ABA: Record<string, string> = {
  conta_vencida: 'pagar', folha_pendente: 'rh', compra_recebida_pendente: 'compras', orcamento_expirando: 'orcamentos',
};
const FIN_ICONE: Record<string, string> = {
  conta_vencida: 'ri-calendar-close-line', folha_pendente: 'ri-team-line', compra_recebida_pendente: 'ri-truck-line',
  orcamento_expirando: 'ri-file-list-3-line',
};
const FIN_ACAO: Record<string, string> = {
  conta_vencida: 'Pagar', folha_pendente: 'Ver folha', compra_recebida_pendente: 'Ver compras', orcamento_expirando: 'Ver orçamentos',
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { data: m, loading, error: metricsError, reload } = useDashboardMetrics();
  const { data: situacaoEstoque, reload: reloadAlertas } = useEstoqueSituacao();
  const fin = useFinanceiroAlertas();
  const { pedidos: kdsPedidos } = useKDS();
  const { modo } = useModoFaturamento();
  const { metrics: sessaoMetrics, loading: sessaoLoading, reload: reloadSessao } = useSessaoFaturamento();
  const { sessao } = useSessao();

  const desde = modo === 'sessao' && sessao ? sessao.dataRef.toISOString() : null;
  const { data: painel, reload: reloadPainel } = useDashboardPainel(desde);

  // "Hoje" = dia da loja: a soma das sessões de caixa abertas no dia (a que passa da meia-noite conta no dia em
  // que abriu — regra do dono, 2026-10-04). Categorias e mais vendidos: do começo do dia da loja (depois do fim
  // da sessão de ontem que entrou pela madrugada) em diante.
  const diaLoja = painel?.dia ?? todayBrasilia();
  const outroDia = !!painel && painel.dia !== todayBrasilia();
  const inicioExtras = useMemo(() => {
    if (!painel?.dia) return null;
    let ini = inicioDoDia(painel.dia).getTime();
    for (const j of painel.janelas ?? []) if (j.dia < painel.dia && j.fim) ini = Math.max(ini, new Date(j.fim).getTime());
    return new Date(ini).toISOString();
  }, [painel?.dia, painel?.janelas]); // eslint-disable-line react-hooks/exhaustive-deps
  const intervaloExtras = useMemo(() => (modo !== 'sessao' && inicioExtras && painel?.dia
    ? { from: inicioExtras, to: inicioDoDia(somarDias(painel.dia, 2)).toISOString() }
    : null), [modo, inicioExtras, painel?.dia]);
  const { data: extras, loading: extrasLoading, reload: reloadExtras } = useVisaoGeralExtras('Hoje', intervaloExtras);

  // refreshKey: muda a cada pedido (tempo real) e no Atualizar → o que é "agora".
  // refreshLento: só no Atualizar e a cada 15 min → financeiro e mapa de pico (não pesar o banco a cada pedido).
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshLento, setRefreshLento] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [editandoMetas, setEditandoMetas] = useState(false);

  const reloadAoVivo = useCallback(() => {
    reload();
    reloadExtras();
    reloadSessao();
    reloadPainel();
    reloadAlertas?.();
    setRefreshKey((k) => k + 1);
    setLastUpdated(new Date());
  }, [reload, reloadExtras, reloadSessao, reloadPainel, reloadAlertas]);

  // O que muda devagar: ritmo/validade/metas do painel, alertas financeiros, financeiro de hoje e pico.
  const reloadFin = fin.reload;
  const reloadLento = useCallback(() => {
    reloadPainel(true);
    reloadFin();
    setRefreshLento((k) => k + 1);
  }, [reloadPainel, reloadFin]);

  const reloadAll = useCallback(() => {
    reloadAoVivo();
    reloadLento();
  }, [reloadAoVivo, reloadLento]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) reloadLento(); }, 15 * 60 * 1000);
    return () => clearInterval(t);
  }, [reloadLento]);

  // Tempo real: cada mudança de pedido dispara um ping; recarrega com debounce
  // de 2,5s para agrupar rajadas de eventos (mesmo canal do KDS/impressão).
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useOrdersPing(user?.tenantId, () => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { reloadAoVivo(); }, 2500);
  });
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // SLA médio real da cozinha baseado nos pedidos ativos
  const slaMediaCozinha = (() => {
    const tempos = kdsPedidos
      .flatMap(p => p.itens)
      .filter(i => i.iniciouPreparoEm && i.ficouProntoEm)
      .map(i => (i.ficouProntoEm! - i.iniciouPreparoEm!) / 60000);
    if (tempos.length === 0) return null;
    return Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length);
  })();

  // iFood ao vivo: a API de Vendas (fin_ifood_sales) só é atualizada quando alguém pede. Ao entrar no
  // Dashboard (e no Atualizar / a cada 15 min) busca os últimos 2 dias na API — a mesma busca leve da aba
  // Relatórios › iFood — e relê os totais. Loja sem iFood configurado não chama a API.
  const [ifoodSync, setIfoodSync] = useState(0);
  const temIfoodRef = useRef<{ tenantId: string; tem: boolean } | null>(null);
  useEffect(() => {
    const tenantId = user?.tenantId;
    if (!tenantId) return;
    let vivo = true;
    (async () => {
      if (temIfoodRef.current?.tenantId !== tenantId) {
        const { data } = await supabase.from('fin_ifood_merchants').select('merchant_id').eq('tenant_id', tenantId).limit(1);
        temIfoodRef.current = { tenantId, tem: (data ?? []).length > 0 };
      }
      if (!temIfoodRef.current.tem || !vivo) return;
      await invokeWithAuth('ifood-financial', { body: { action: 'sync_sales', tenant_id: tenantId, days: 2 } }).catch(() => null);
      if (vivo) setIfoodSync((k) => k + 1);
    })();
    return () => { vivo = false; };
  }, [user?.tenantId, refreshLento]);

  // iFood (conciliação + API do iFood, mesma conta da Visão Geral dos Relatórios): não passa pelo PDV,
  // então soma aos totais. Hoje/ontem no modo calendário; no modo sessão, os pedidos feitos desde a abertura.
  const sessaoIntervalo = useMemo(() => (modo === 'sessao' && sessao
    ? { from: sessao.dataRef.toISOString(), to: new Date().toISOString() }
    : null), [modo, sessao?.dataRef.getTime(), refreshKey, ifoodSync]); // eslint-disable-line react-hooks/exhaustive-deps
  // Modo Hoje: iFood do dia da loja (pedido na sessão aberta na hora conta no dia dela; fora de sessão, na data).
  const { data: ifDia } = useIfoodDiaLoja(user?.tenantId, painel?.dia, painel?.janelas, null, refreshKey + ifoodSync);
  const { data: ifSessao } = useIfoodVendas('', sessaoIntervalo, refreshKey + ifoodSync);
  // Mesmo dia da semana passada (dia da loja), até esta hora. Só no modo "Hoje": a sessão conta pedidos não
  // pagos e não fecha com a regra do painel. O corte é arredondado em 5 min para não buscar o iFood da semana
  // de novo a cada pedido.
  const spCorte5 = modo === 'sessao' || !painel ? null
    : new Date(Math.floor(new Date(painel.semana_passada.ate).getTime() / 300000) * 300000).toISOString();
  const { data: ifSemana } = useIfoodDiaLoja(user?.tenantId, modo === 'sessao' ? null : painel?.semana_passada.dia,
    painel?.semana_passada.janelas, spCorte5);
  const ifood = modo === 'sessao' ? ifSessao : ifDia;
  const ifTot = ifood?.total ?? 0;
  const ifPed = ifood?.pedidos ?? 0;

  // Escolhe fonte de dados conforme modo
  const pdvFaturamento = modo === 'sessao' ? sessaoMetrics.faturamento_sessao : (m?.faturamento_hoje ?? 0);
  const pdvPedidos = modo === 'sessao' ? sessaoMetrics.pedidos_sessao : (m?.pedidos_hoje ?? 0);
  const faturamentoHoje = pdvFaturamento + ifTot;
  const pedidosHoje = pdvPedidos + ifPed;
  const ticketMedio = pedidosHoje > 0 ? faturamentoHoje / pedidosHoje : 0;

  // Comparação justa: mesmo dia da semana passada até esta hora (o "vs ontem" comparava o dia parcial com o
  // dia inteiro de ontem e ficava vermelho até a noite). Com iFood, espera a busca da semana chegar.
  const ifSemanaPronto = ifTot === 0 || ifSemana !== null;
  const sp = modo !== 'sessao' && ifSemanaPronto ? painel?.semana_passada : undefined;
  const fatSemana = sp ? sp.faturamento + (ifSemana?.total ?? 0) : 0;
  const pedSemana = sp ? sp.pedidos + (ifSemana?.pedidos ?? 0) : 0;
  const ticketSemana = pedSemana > 0 ? fatSemana / pedSemana : 0;
  const diaSemana = painel?.dia_semana ?? new Date().getDay();
  const rotuloSemana = ROTULO_SEMANA[diaSemana];

  const varSemana = sp && fatSemana > 0 ? pct(faturamentoHoje, fatSemana) : undefined;

  // Vendas por hora do dia (PDV + iFood por cima), sempre do dia de hoje, com linhas de
  // comparação ligáveis (ontem, mesmo dia da semana passada, mesmo dia do mês passado).
  const [comparacoes, alternarComparacao] = useComparacoesLigadas('dashboard.vendasHora.comparacoes', { semana: true });
  // Horas contadas desde a 0h do dia da loja (depois da meia-noite: 24, 25…), hoje e nas comparações.
  const diasComp = useMemo(() => diasComparacao(diaLoja), [diaLoja]);
  const seriesComp = useVendasHoraComparativo(diasComp, comparacoes);
  const horaAgoraNum = horaDoDia(new Date(), diaLoja);
  const vendasPorHora = (() => {
    const pdv: Record<string, number> = {};
    for (const h of m?.vendas_por_hora ?? []) pdv[h.hora.slice(0, 2)] = (pdv[h.hora.slice(0, 2)] ?? 0) + Number(h.valor);
    const ifoodHora: Record<string, number> = {};
    for (const [h, v] of Object.entries(ifDia?.porHora ?? {})) {
      const hh = String(h).padStart(2, '0');
      ifoodHora[hh] = (ifoodHora[hh] ?? 0) + v;
    }
    const ligadas = Object.fromEntries(Object.entries(seriesComp).filter(([k]) => comparacoes[k as keyof typeof comparacoes]));
    return montarVendasHora(pdv, ifoodHora, ligadas, horaAgoraNum);
  })();

  const mesasOcupadas = m?.mesas_ocupadas ?? 0;
  const mesasTotal = m?.mesas_total ?? 0;
  const pedidosAbertosValor = m?.pedidos_abertos_valor ?? 0;
  const pedidosAbertosCount = m?.pedidos_abertos_count ?? 0;
  const atrasados = painel?.atrasados ?? [];
  const atrasoMin = painel?.atraso_min ?? 20;

  const isLoading = loading || (modo === 'sessao' && sessaoLoading);

  // Carimba o horário da última atualização quando novos dados chegam
  useEffect(() => { if (m) setLastUpdated(new Date()); }, [m]);

  // Metas da loja para o dia de hoje
  const metas = painel?.metas ?? [];
  const metaHoje = metas.find((x) => x.dia_semana === diaSemana && (x.faturamento > 0 || x.pedidos > 0 || x.ticket > 0)) ?? null;
  const podeEditarMetas = !!user && ['admin', 'gerente'].includes(user.perfil);

  // Metas antigas (localStorage, uma só para todos os dias): na primeira abertura de quem pode editar,
  // viram a meta da loja para os 7 dias, para não sumirem com a mudança.
  const migrouMetas = useRef(false);
  useEffect(() => {
    if (migrouMetas.current || !podeEditarMetas || !user?.tenantId || !painel?.completo || (painel.metas ?? []).length > 0) return;
    migrouMetas.current = true;
    try {
      const raw = localStorage.getItem(`dashboard_metas_dia:${user.tenantId}`);
      if (!raw) return;
      const a = JSON.parse(raw);
      const base = { faturamento: Number(a.faturamento) || 0, pedidos: Number(a.pedidos) || 0, ticket: Number(a.ticket) || 0 };
      if (!base.faturamento && !base.pedidos && !base.ticket) return;
      salvarDashboardMetas(user.tenantId, [0, 1, 2, 3, 4, 5, 6].map((d) => ({ dia_semana: d, ...base })))
        .then(() => reloadPainel(true))
        .catch((e) => console.error('[Dashboard] migrar metas', e));
    } catch { /* sem storage */ }
  }, [podeEditarMetas, user?.tenantId, painel?.completo, painel?.metas, reloadPainel]);

  // ── Faixa "Precisa de atenção" ──────────────────────────────────────────────
  const itensAtencao: ItemAtencao[] = [];
  for (const a of fin.alertas) {
    if (!FIN_ABA[a.tipo]) continue; // "vence em breve" fica no Financeiro de hoje
    itensAtencao.push({
      id: `fin-${a.tipo}`,
      nivel: a.urgencia === 'alta' ? 'alta' : 'media',
      icone: FIN_ICONE[a.tipo],
      titulo: a.titulo,
      detalhe: a.tipo === 'conta_vencida' ? 'Saldo em atraso'
        : a.tipo === 'compra_recebida_pendente' ? 'Mercadoria já entregue — libere o pagamento'
        : a.descricao,
      valor: a.valor ? fmt(a.valor) : undefined,
      acao: FIN_ACAO[a.tipo],
      ir: { rota: '/financeiro', state: { activeTab: FIN_ABA[a.tipo] } },
    });
  }
  if (atrasados.length > 0) {
    itensAtencao.push({
      id: 'atrasados',
      nivel: 'alta',
      icone: 'ri-fire-line',
      titulo: `${atrasados.length} ${plural(atrasados.length, 'pedido')} há +${atrasoMin} min`,
      detalhe: atrasados.slice(0, 3).map((a) => `${a.destino || ORIGEM_CURTA[a.origem] || 'Pedido'}${a.numero ? ` #${a.numero}` : ''} (${duracao(a.minutos)})`).join(' · '),
      acao: 'Abrir KDS',
      ir: { rota: '/kds' },
    });
  }
  // Estoque pela regra única (fn_estoque_situacao): os mesmos números do Início do Estoque e da pendência.
  const estoque = situacaoEstoque?.insumos ?? [];
  const vaiFaltar = estoque.filter((i) => i.vaiFaltar).sort((a, b) => (a.diasRestantes ?? 0) - (b.diasRestantes ?? 0));
  if (vaiFaltar.length > 0) {
    const diasPrev = situacaoEstoque?.config.diasPrevisao ?? 7;
    const dias = (d: number | null) => (d == null || d < 0.5 ? 'acabou' : `~${Math.max(1, Math.round(d))}d`);
    itensAtencao.push({
      id: 'vai-faltar',
      nivel: vaiFaltar.some((i) => (i.diasRestantes ?? 0) <= 2) ? 'alta' : 'media',
      icone: 'ri-hourglass-line',
      titulo: vaiFaltar.length === 1 ? `${vaiFaltar[0].nome} vai faltar` : `${vaiFaltar.length} insumos vão faltar em até ${diasPrev} dias`,
      detalhe: vaiFaltar.slice(0, 3).map((i) => `${i.nome} (${dias(i.diasRestantes)})`).join(', '),
      acao: 'Ver no Estoque',
      ir: { rota: '/estoque' },
    });
  }
  const abaixoMinimo = estoque.filter((i) => i.abaixoMinimo);
  const validade = painel?.validade ?? null;
  if (abaixoMinimo.length > 0 || (validade && validade.vencidos + validade.vencendo > 0)) {
    const partes: string[] = [];
    if (validade?.vencidos) partes.push(`${validade.vencidos} ${plural(validade.vencidos, 'lote vencido', 'lotes vencidos')}`);
    if (validade?.vencendo) partes.push(`${validade.vencendo} ${plural(validade.vencendo, 'lote vencendo', 'lotes vencendo')}`);
    const zerados = abaixoMinimo.filter((i) => i.esgotado).length;
    if (abaixoMinimo.length) partes.push(`${abaixoMinimo.length} abaixo do mínimo${zerados ? ` (${zerados} ${plural(zerados, 'zerado', 'zerados')})` : ''}`);
    itensAtencao.push({
      id: 'estoque',
      nivel: validade?.vencidos || zerados ? 'alta' : 'media',
      icone: 'ri-archive-line',
      titulo: partes.join(' · '),
      detalhe: abaixoMinimo.length
        ? [...abaixoMinimo].sort((a, b) => Number(b.esgotado) - Number(a.esgotado)).slice(0, 3).map((i) => i.nome).join(', ')
        : 'Confira os lotes na tela de estoque',
      acao: abaixoMinimo.length ? 'Ver lista de compras' : 'Ver estoque',
      ir: { rota: abaixoMinimo.length ? '/estoque' : '/estoque?tab=validade' },
    });
  }

  // Label contextual para o período. Depois da meia-noite, com a sessão de ontem ainda aberta, o "Hoje" segue
  // sendo o dia em que ela abriu — o rótulo diz qual dia é.
  const diaCurto = `${diaLoja.slice(8, 10)}/${diaLoja.slice(5, 7)}`;
  const periodoLabel = modo === 'sessao'
    ? sessao
      ? `Sessão ${sessao.numero} — aberta ${sessao.dataRef.toLocaleDateString('pt-BR')}`
      : 'Sem sessão ativa'
    : outroDia ? `Dia ${diaCurto}${sessao ? ` · caixa aberto desde ${sessao.iniciadaEm}` : ''}` : 'Hoje';

  const ajudaFaturamento = (modo === 'sessao'
    ? 'Tudo que a loja VENDEU desde a abertura do caixa: pedidos do sistema (mesa, balcão, delivery, totem) + iFood.\n\n'
    : 'Tudo que a loja VENDEU no dia: a soma das sessões de caixa abertas hoje — pedidos do sistema (mesa, balcão, ' +
      'delivery, totem) + iFood. A sessão que passa da meia-noite conta inteira no dia em que abriu.\n\n') +
    'É venda, não dinheiro na conta. O que já entrou (maquininha, Pix no banco, repasse do iFood) aparece em ' +
    'Financeiro › Visão Geral › "Recebido hoje", que costuma ficar abaixo deste número até as conciliações do dia.\n\n' +
    `A comparação com ${rotuloSemana} usa o mesmo período até este horário.`;

  const veFinanceiro = !!user && ['admin', 'gerente'].includes(user.perfil);
  const canais: LinhaCanal[] = [
    ...(painel?.canais ?? []).map((c) => ({ ...c, semanaPassada: sp?.canais[c.origem] })),
    ...(ifTot > 0 || ifPed > 0 ? [{ origem: 'ifood', valor: ifTot, pedidos: ifPed, semanaPassada: ifSemana?.total }] : []),
  ];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Bom dia' : hour < 18 ? 'Boa tarde' : 'Boa noite';
  const horaAgora = `${horaAgoraNum % 24}h`;

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-[1400px] mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 md:w-9 md:h-9 flex items-center justify-center rounded-xl flex-shrink-0" style={{ background: 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)' }}>
            <i className="ri-dashboard-line text-white text-base md:text-lg" />
          </div>
          <div className="min-w-0">
            <h1 className="text-base md:text-lg font-bold text-zinc-800">
              {greeting}, <span className="text-amber-500">{user?.nome?.split(' ')[0] ?? ''}</span>!
            </h1>
            <p className="text-xs text-zinc-400">
              {isLoading ? 'Carregando dados...' : (
                <>
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 align-middle mr-1 animate-pulse" />
                  Ao vivo · {periodoLabel}
                  {lastUpdated && ` · ${lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`}
                </>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto max-w-full">
          <DashboardModoToggle />
          <button
            onClick={reloadAll}
            disabled={isLoading}
            className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm disabled:opacity-50"
          >
            <i className={`ri-refresh-line text-sm ${isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Atualizar</span>
          </button>
        </div>
      </div>

      {/* Modo sessão — banner informativo */}
      {modo === 'sessao' && sessao && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-700 font-medium">
          <i className="ri-store-2-line text-sm" />
          <span>
            Exibindo dados da <strong>Sessão {sessao.numero}</strong> — aberta em{' '}
            {sessao.dataRef.toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })} às{' '}
            {sessao.iniciadaEm}. Pedidos de dias anteriores desta sessão estão incluídos.
          </span>
        </div>
      )}

      {modo === 'sessao' && !sessao && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 border border-zinc-200 rounded-xl text-xs text-zinc-500">
          <i className="ri-information-line text-sm" />
          <span>Nenhuma sessão ativa. Abra uma sessão no PDV para ver os dados por sessão.</span>
        </div>
      )}

      {/* Error banner */}
      {metricsError && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
          <i className="ri-error-warning-line text-sm" />
          <span>Erro ao carregar métricas: {metricsError}</span>
          <button
            onClick={reload}
            className="ml-auto text-red-600 hover:text-red-800 font-medium underline cursor-pointer"
          >
            Tentar novamente
          </button>
        </div>
      )}

      {/* 1. Precisa de atenção */}
      <AtencaoFaixa itens={itensAtencao} carregando={!painel || !m || !situacaoEstoque || fin.loading}
        textoTudoEmDia={veFinanceiro ? undefined : 'Tudo em dia: estoque ok e cozinha no prazo.'} />

      {/* 2. Faturamento (com a meta) + cartões */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FaturamentoHero
          titulo={modo === 'sessao' ? 'Faturamento da sessão' : outroDia ? `Faturamento do dia ${diaCurto}` : 'Faturamento hoje'}
          ajuda={ajudaFaturamento}
          valor={faturamentoHoje}
          varSemana={varSemana}
          rotuloSemana={rotuloSemana}
          meta={metaHoje}
          diaSemana={diaSemana}
          ritmoEsperado={modo === 'sessao' || (painel?.ritmo_dias ?? 0) < 2 ? null : painel?.ritmo_esperado ?? null}
          horaAgora={horaAgora}
          podeEditarMetas={podeEditarMetas}
          onEditarMetas={() => setEditandoMetas(true)}
        />

        <div className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-1.5">
          <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-zinc-100 text-zinc-500"><i className="ri-shopping-bag-line text-sm" /></span>
            Pedidos
          </span>
          <p className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-zinc-900">{pedidosHoje}</p>
          <div className="flex flex-wrap gap-1">
            <Variacao pct={sp && pedSemana > 0 ? pct(pedidosHoje, pedSemana) : undefined} rotulo={rotuloSemana} />
          </div>
          <p className="text-[11px] text-zinc-500 mt-auto pt-1.5 border-t border-zinc-100">
            Ticket <b className="text-zinc-800 tabular-nums">{fmt(ticketMedio)}</b>
            {sp && ticketSemana > 0 && ticketMedio > 0 && (() => {
              const v = pct(ticketMedio, ticketSemana) ?? 0;
              return <span className={`ml-1 font-semibold ${v >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{v >= 0 ? '▲' : '▼'} {Math.abs(v).toFixed(0)}%</span>;
            })()}
            {metaHoje && (metaHoje.pedidos > 0 || metaHoje.ticket > 0) && (
              <span className="block text-zinc-400">
                Meta {metaHoje.pedidos > 0 ? `${metaHoje.pedidos} ped.` : ''}{metaHoje.pedidos > 0 && metaHoje.ticket > 0 ? ' · ' : ''}{metaHoje.ticket > 0 ? `ticket ${fmt(metaHoje.ticket)}` : ''}
              </span>
            )}
          </p>
        </div>

        <button
          onClick={() => navigate('/gestor-pedidos', { state: { filtroPagamento: 'nao-pagos' } })}
          className="rounded-2xl border border-zinc-200 bg-white p-4 flex flex-col gap-1.5 text-left cursor-pointer hover:border-amber-300 hover:shadow-sm transition-all group"
        >
          <span className="flex items-center gap-2 text-xs font-semibold text-zinc-500">
            <span className="w-7 h-7 rounded-lg flex items-center justify-center bg-zinc-100 text-zinc-500"><i className="ri-time-line text-sm" /></span>
            Em aberto
          </span>
          <p className="text-xl sm:text-2xl font-bold tabular-nums tracking-tight text-zinc-900">{fmt(pedidosAbertosValor)}</p>
          <p className="text-[11px] text-zinc-500">
            {pedidosAbertosCount > 0
              ? `${pedidosAbertosCount} ${plural(pedidosAbertosCount, 'pedido não pago', 'pedidos não pagos')}`
              : 'Nenhum pedido pendente'}
          </p>
          <p className="text-[11px] text-amber-600 font-semibold mt-auto pt-1.5 group-hover:underline">Ver pedidos →</p>
        </button>
      </section>

      {/* Etiquetas: mesas, cozinha, iFood */}
      <div className="flex flex-wrap gap-2 text-xs -mt-1">
        <span className="bg-white border border-zinc-200 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
          <i className="ri-layout-grid-line text-zinc-400" /> Mesas <b className="tabular-nums">{mesasTotal > 0 ? `${mesasOcupadas}/${mesasTotal}` : '—'}</b>
        </span>
        <span className="bg-white border border-zinc-200 rounded-xl px-3 py-1.5 flex items-center gap-1.5">
          <i className={`ri-timer-line ${slaMediaCozinha !== null && slaMediaCozinha > 15 ? 'text-red-500' : 'text-zinc-400'}`} /> Cozinha
          <b className="tabular-nums">{slaMediaCozinha !== null ? `${slaMediaCozinha} min` : '—'}</b>
          {atrasados.length > 0
            ? <span className="text-red-600 font-semibold">· {atrasados.length} {plural(atrasados.length, 'atrasado')}</span>
            : slaMediaCozinha !== null && <span className={slaMediaCozinha <= 15 ? 'text-emerald-600' : 'text-red-500'}>· {slaMediaCozinha <= 15 ? 'no prazo' : 'acima do alvo'}</span>}
        </span>
        {ifPed > 0 && (
          <span className="bg-white border border-zinc-200 rounded-xl px-3 py-1.5 flex items-center gap-1.5"
            title={(ifood?.pedidosAoVivo ?? 0) > 0 ? 'Valor provisório pela API do iFood até importar a conciliação. Detalhes em Relatórios › iFood.' : 'Detalhes em Relatórios › iFood.'}>
            <i className="ri-e-bike-2-line text-red-500" /> iFood <b className="tabular-nums">{fmt(ifTot)}</b>
            <span className="text-zinc-400">· {ifPed} ped.{(ifood?.pedidosAoVivo ?? 0) > 0 ? ' (provisório)' : ''}</span>
          </span>
        )}
      </div>

      {/* 3. Vendas por hora + Pedidos agora */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <div className="xl:col-span-2 min-w-0">
          <SalesChart data={vendasPorHora} lastUpdated={lastUpdated}
            comparacoes={comparacoes} diasComparacao={diasComp} onAlternarComparacao={alternarComparacao} />
        </div>
        <PedidosAgora
          fila={painel?.fila ?? {}}
          atrasados={atrasados.length}
          atrasoMin={atrasoMin}
          pagosSistema={pdvPedidos}
          pedidosIfood={ifPed}
          rotuloPeriodo={modo === 'sessao' ? 'Na sessão' : 'Pagos hoje'}
        />
      </div>

      {/* 4. Por canal + categorias + mais vendidos */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-stretch">
        <PorCanal linhas={canais} rotuloSemana={sp ? rotuloSemana : null} />
        <CategoriasChart data={extras?.by_category ?? []} loading={extrasLoading} />
        <div className="md:col-span-2 xl:col-span-1 min-w-0">
          <MaisVendidos data={extras?.by_item ?? []} loading={extrasLoading} />
        </div>
      </div>

      {/* 5. Mesas + financeiro de hoje */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-stretch">
        <div className="xl:col-span-2 min-w-0">
          <MesasOverview mesas={m?.mesas_mapa ?? []} />
        </div>
        {veFinanceiro && <ResumoFinanceiro refreshKey={refreshLento} />}
      </div>

      {/* 6. Horários de pico */}
      <HorariosPico refreshKey={refreshLento} />

      {/* 7. Últimos pedidos */}
      <UltimosPedidos pedidos={m?.ultimos_pedidos ?? []} />

      {editandoMetas && user?.tenantId && (
        <MetasModal
          tenantId={user.tenantId}
          metas={metas}
          diaHoje={diaSemana}
          onFechar={() => setEditandoMetas(false)}
          onSalvo={() => reloadPainel(true)}
        />
      )}
    </div>
  );
}

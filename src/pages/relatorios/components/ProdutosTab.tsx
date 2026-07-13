import { useState, useMemo, useEffect, useCallback } from 'react';
import { Search } from 'lucide-react';
import { useSalesReport, useSalesReportBySession } from '@/hooks/useSalesReport';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency } from '@/lib/formatters';
import { getPeriodoAnterior, labelPeriodo } from '@/lib/dateUtils';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import type { SessionInfo } from '@/hooks/useSessions';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';

// ── Classificação ABC ─────────────────────────────────────────────────────────
type ClasseABC = 'A' | 'B' | 'C';

function classificarABC(itens: { receita: number }[]): ClasseABC[] {
  const total = itens.reduce((s, i) => s + i.receita, 0);
  let acumulado = 0;
  return itens.map((item) => {
    acumulado += item.receita;
    const pct = total > 0 ? (acumulado / total) * 100 : 0;
    if (pct <= 70) return 'A';
    if (pct <= 90) return 'B';
    return 'C';
  });
}

const ABC_STYLE: Record<ClasseABC, { badge: string; label: string; desc: string }> = {
  A: { badge: 'bg-emerald-100 text-emerald-700 border-emerald-200', label: 'Classe A', desc: 'Produtos estrela — 70% da receita' },
  B: { badge: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Classe B', desc: 'Produtos importantes — 20% da receita' },
  C: { badge: 'bg-zinc-100 text-zinc-500 border-zinc-200', label: 'Classe C', desc: 'Produtos secundários — 10% da receita' },
};

const fmt = formatCurrency;

// ── Normalização de nome de item ──────────────────────────────────────────────
// Itens com múltiplas unidades rastreadas no KDS são gravados como order_items
// separados com sufixo " (Un. N)" (ex.: "Hamburguer de Bacon (Un. 1)"). No ranking
// são o MESMO produto do cardápio — remove o sufixo e faz trim para agrupar/somar
// (também unifica variações de espaço em branco no fim do nome).
export function normalizarNomeItem(nome: string): string {
  return nome.replace(/\s*\(Un\.\s*\d+\)\s*$/i, '').trim();
}

interface TopItemMerged {
  item_name: string;
  category_name?: string;
  total_qty: number;
  total_revenue: number;
  avg_price?: number;
}

/** Une linhas do top_items que são unidades do mesmo item (somando qtd/receita). */
function mergeUnidades(
  topItems: Array<{ item_name: string; total_qty: number; total_revenue: number; category_name?: string; avg_price?: number }>,
): TopItemMerged[] {
  const map = new Map<string, TopItemMerged>();
  for (const it of topItems) {
    const nome = normalizarNomeItem(it.item_name);
    const key = `${nome}::${it.category_name ?? ''}`;
    const prev = map.get(key);
    if (prev) {
      prev.total_qty += it.total_qty;
      prev.total_revenue += Number(it.total_revenue);
    } else {
      map.set(key, {
        item_name: nome,
        category_name: it.category_name,
        total_qty: it.total_qty,
        total_revenue: Number(it.total_revenue),
      });
    }
  }
  // Preço médio recalculado após somar (receita / qtd)
  return Array.from(map.values()).map((m) => ({
    ...m,
    avg_price: m.total_qty > 0 ? m.total_revenue / m.total_qty : 0,
  }));
}

// Períodos rápidos para override local
const PERIODOS_RAPIDOS = ['7 dias', '30 dias', '3 meses', '6 meses', '12 meses'] as const;
type PeriodoRapido = typeof PERIODOS_RAPIDOS[number];

function periodoRapidoParaDias(p: PeriodoRapido): number {
  if (p === '7 dias') return 7;
  if (p === '30 dias') return 30;
  if (p === '3 meses') return 90;
  if (p === '6 meses') return 180;
  return 365;
}

function periodoGlobalParaDias(periodo: string): number {
  if (periodo.startsWith('custom:')) {
    const [, s, e] = periodo.split(':');
    const diff = new Date(`${e}T23:59:59`).getTime() - new Date(`${s}T00:00:00`).getTime();
    return Math.max(1, Math.ceil(diff / (1000 * 60 * 60 * 24)));
  }
  if (periodo === 'Hoje') return 1;
  if (periodo === 'Ontem') return 1;
  if (periodo === '7 dias') return 7;
  if (periodo === '30 dias') return 30;
  return 30;
}

/** Calcula o período anterior proporcional */
// Removed: now imported from dateUtils

// ── Hook: evolução de um item específico ─────────────────────────────────────
interface ItemEvolucao {
  semana: string;
  qtd: number;
  receita: number;
}

function useItemEvolucao(itemNome: string | null, dias: number) {
  const { user } = useAuth();
  const [data, setData] = useState<ItemEvolucao[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!itemNome || !user?.tenantId) return;
    setLoading(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - dias);

      // itemNome vem NORMALIZADO (sem sufixo " (Un. N)"). Busca o nome base e todas as
      // variações de unidade via prefixo (ilike) e confirma no JS pelo nome normalizado
      // (evita falsos positivos como "Coca" casar com "Coca-Cola").
      const { data: items } = await supabase
        .from('order_items')
        .select('item_name, quantity, item_price, status, orders!inner(created_at, status, tenant_id)')
        .eq('tenant_id', user.tenantId)
        .ilike('item_name', `${itemNome}%`)
        .neq('status', 'cancelled')
        .gte('orders.created_at', from.toISOString())
        .eq('orders.status', 'delivered');

      const weekMap = new Map<string, { qtd: number; receita: number }>();
      (items ?? []).forEach((oi: Record<string, unknown>) => {
        if (normalizarNomeItem(String(oi.item_name ?? '')) !== itemNome) return;
        const order = oi.orders as { created_at: string } | null;
        if (!order) return;
        const d = new Date(order.created_at);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const monday = new Date(d.setDate(diff));
        const key = monday.toISOString().slice(0, 10);
        const prev = weekMap.get(key) ?? { qtd: 0, receita: 0 };
        weekMap.set(key, {
          qtd: prev.qtd + (Number(oi.quantity) || 1),
          receita: prev.receita + (Number(oi.item_price) || 0) * (Number(oi.quantity) || 1),
        });
      });

      const result: ItemEvolucao[] = Array.from(weekMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => ({
          semana: new Date(key + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }),
          qtd: v.qtd,
          receita: v.receita,
        }));

      setData(result);
    } catch (e) {
      console.error('[useItemEvolucao]', e);
    } finally {
      setLoading(false);
    }
  }, [itemNome, user?.tenantId, dias]);

  useEffect(() => { load(); }, [load]);
  return { data, loading };
}

// ── Tooltip customizado ───────────────────────────────────────────────────────
const EvolTooltip = ({ active, payload, label }: { active?: boolean; payload?: { value: number; name: string }[]; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-zinc-200 rounded-xl p-3 text-xs">
      <p className="font-semibold text-zinc-600 mb-1">Semana de {label}</p>
      {payload.map(p => (
        <p key={p.name} className="text-zinc-800">
          {p.name === 'qtd' ? `${p.value} unidades` : fmt(p.value)}
        </p>
      ))}
    </div>
  );
};

// ── Exportar CSV ─────────────────────────────────────────────────────────────
function exportarProdutosCSV(
  itens: { pos: number; nome: string; categoria: string; qtd: number; precoMedio: number; receita: number; pctReceita: string }[],
  periodo: string
) {
  const headers = ['Posição', 'Item', 'Categoria', 'Qtd. Vendida', 'Preço Médio (R$)', 'Receita Total (R$)', '% da Receita', 'Período'];
  const rows = itens.map(i => [
    i.pos,
    i.nome,
    i.categoria,
    i.qtd,
    i.precoMedio.toFixed(2).replace('.', ','),
    i.receita.toFixed(2).replace('.', ','),
    `${i.pctReceita}%`,
    periodo,
  ]);
  const csv = [headers, ...rows].map(r => r.join(';')).join('\n');
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `ranking_produtos_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// Badge de variação
function VarBadge({ atual, anterior }: { atual: number; anterior: number }) {
  if (anterior <= 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const sobe = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sobe ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
      <i className={sobe ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

// Cores por categoria
const CAT_COLORS = ['#f59e0b', '#10b981', '#06b6d4', '#f97316', '#8b5cf6', '#ec4899', '#14b8a6', '#a78bfa', '#ef4444', '#84cc16'];

interface Props {
  periodo: string;
  externalSession?: SessionInfo | null;
}

export default function ProdutosTab({ periodo, externalSession }: Props) {
  const { modo } = useModoFaturamento();
  const isSessao = modo === 'sessao';
  const selectedSession = externalSession ?? null;

  const [busca, setBusca] = useState('');
  const [sortBy, setSortBy] = useState<'qtd' | 'receita'>('receita');
  const [periodoOverride, setPeriodoOverride] = useState<PeriodoRapido | null>(null);
  const [itemSelecionado, setItemSelecionado] = useState<string | null>(null);
  const [modoGrafico, setModoGrafico] = useState<'qtd' | 'receita'>('qtd');
  const [abaAtiva, setAbaAtiva] = useState<'ranking' | 'abc' | 'categorias' | 'complementos'>('ranking');
  const [categoriaFiltro, setCategoriaFiltro] = useState<string>('todas');

  const periodoEfetivo = periodoOverride ?? periodo;
  const periodoAnteriorStr = getPeriodoAnterior(periodoEfetivo);

  // Modo calendário: busca por data
  const { data: reportCalendario, loading: loadingCalendario, hasRealData: hasCalendario } = useSalesReport(
    isSessao ? 'Hoje' : periodoEfetivo
  );
  const { data: reportAnteriorCalendario } = useSalesReport(
    isSessao ? 'Hoje' : periodoAnteriorStr
  );

  // Modo sessão: busca por session_id
  const { data: reportSessao, loading: loadingSessao, hasRealData: hasSessao } = useSalesReportBySession(
    isSessao ? (selectedSession?.id ?? null) : null
  );

  const report = isSessao ? reportSessao : reportCalendario;
  const loading = isSessao ? loadingSessao : loadingCalendario;
  const hasRealData = isSessao ? hasSessao : hasCalendario;
  const reportAnterior = isSessao ? null : reportAnteriorCalendario;

  const dias = periodoOverride
    ? periodoRapidoParaDias(periodoOverride)
    : periodoGlobalParaDias(periodo);
  const { data: evolucao, loading: evolLoading } = useItemEvolucao(itemSelecionado, dias);

  // top_items com unidades do mesmo item já somadas (ex.: "X (Un. 1)" + "X (Un. 2)" → "X")
  const topItens = useMemo(() => mergeUnidades(report?.top_items ?? []), [report]);
  const topItensAnt = useMemo(() => mergeUnidades(reportAnterior?.top_items ?? []), [reportAnterior]);

  // Categorias disponíveis
  const categorias = useMemo(() => {
    const cats = new Set(topItens.map(i => i.category_name ?? 'Sem categoria'));
    return Array.from(cats).sort();
  }, [topItens]);

  const itens = useMemo(() => {
    return topItens
      .map((item, idx) => ({
        pos: idx + 1,
        nome: item.item_name,
        categoria: item.category_name ?? 'Sem categoria',
        qtd: item.total_qty,
        precoMedio: item.avg_price ? Number(item.avg_price) : (item.total_qty > 0 ? Number(item.total_revenue) / item.total_qty : 0),
        receita: Number(item.total_revenue),
      }))
      .filter(i => {
        const matchBusca = i.nome.toLowerCase().includes(busca.toLowerCase());
        const matchCat = categoriaFiltro === 'todas' || i.categoria === categoriaFiltro;
        return matchBusca && matchCat;
      })
      .sort((a, b) => b[sortBy] - a[sortBy]);
  }, [topItens, busca, sortBy, categoriaFiltro]);

  // Mapa de itens do período anterior para comparativo (por nome normalizado)
  const itensAntMap = useMemo(() => {
    const map = new Map<string, { qtd: number; receita: number }>();
    topItensAnt.forEach(i => {
      map.set(i.item_name, { qtd: i.total_qty, receita: Number(i.total_revenue) });
    });
    return map;
  }, [topItensAnt]);

  // Dados por categoria
  const dadosPorCategoria = useMemo(() => {
    if (topItens.length === 0) return [];
    const catMap = new Map<string, { qtd: number; receita: number; itens: number }>();
    topItens.forEach(item => {
      const cat = item.category_name ?? 'Sem categoria';
      const prev = catMap.get(cat) ?? { qtd: 0, receita: 0, itens: 0 };
      catMap.set(cat, {
        qtd: prev.qtd + item.total_qty,
        receita: prev.receita + Number(item.total_revenue),
        itens: prev.itens + 1,
      });
    });
    return Array.from(catMap.entries())
      .map(([cat, d]) => ({ categoria: cat, ...d }))
      .sort((a, b) => b.receita - a.receita);
  }, [topItens]);

  // Classificação ABC
  const itensComABC = useMemo(() => {
    const ordenados = [...itens].sort((a, b) => b.receita - a.receita);
    const classes = classificarABC(ordenados);
    return ordenados.map((item, i) => ({ ...item, classe: classes[i] }));
  }, [itens]);

  const resumoABC = useMemo(() => {
    const grupos: Record<ClasseABC, { count: number; receita: number; qtd: number }> = {
      A: { count: 0, receita: 0, qtd: 0 },
      B: { count: 0, receita: 0, qtd: 0 },
      C: { count: 0, receita: 0, qtd: 0 },
    };
    itensComABC.forEach((item) => {
      grupos[item.classe].count++;
      grupos[item.classe].receita += item.receita;
      grupos[item.classe].qtd += item.qtd;
    });
    return grupos;
  }, [itensComABC]);

  // Receita total: usa report.total_revenue (soma dos total_amount dos pedidos)
  // para bater com Visão Geral. totalReceitaItens é usado apenas para %
  const totalReceitaItens = itens.reduce((s, i) => s + i.receita, 0);
  const totalReceita = report?.total_revenue ?? totalReceitaItens;
  const totalQtd = itens.reduce((s, i) => s + i.qtd, 0);
  const totalReceitaAnt = reportAnterior?.total_revenue ?? (reportAnterior?.top_items.reduce((s, i) => s + Number(i.total_revenue), 0) ?? 0);
  const totalQtdAnt = reportAnterior?.top_items.reduce((s, i) => s + i.total_qty, 0) ?? 0;

  // Top 10 para gráfico horizontal
  const top10 = useMemo(() => {
    return [...itens].slice(0, 10).map(i => ({
      nome: i.nome.length > 22 ? i.nome.slice(0, 22) + '…' : i.nome,
      nomeCompleto: i.nome,
      valor: sortBy === 'receita' ? i.receita : i.qtd,
    }));
  }, [itens, sortBy]);

  // ── Complementos (adicionais) — vem do agregado top_options da RPC ──
  // Só complementos que geram valor (additional_price > 0). % é sobre a receita
  // de complementos (não sobre o faturamento), para o rateio somar 100%.
  const complementos = useMemo(() => {
    const list = (report?.top_options ?? [])
      .filter(o => Number(o.total_revenue) > 0)
      .map(o => ({
        nome: o.option_name,
        qtd: Number(o.total_qty),
        receita: Number(o.total_revenue),
      }))
      .filter(o => o.nome.toLowerCase().includes(busca.toLowerCase()))
      .sort((a, b) => b[sortBy] - a[sortBy]);
    return list.map((o, idx) => ({ ...o, pos: idx + 1 }));
  }, [report, busca, sortBy]);
  const totalReceitaComplementos = complementos.reduce((s, o) => s + o.receita, 0);
  const totalQtdComplementos = complementos.reduce((s, o) => s + o.qtd, 0);
  const topComplementos = useMemo(() => complementos.slice(0, 10).map(o => ({
    nome: o.nome.length > 22 ? o.nome.slice(0, 22) + '…' : o.nome,
    nomeCompleto: o.nome,
    valor: sortBy === 'receita' ? o.receita : o.qtd,
  })), [complementos, sortBy]);

  useEffect(() => {
    if (itens.length > 0 && !itemSelecionado) {
      setItemSelecionado(itens[0].nome);
    }
  }, [itens, itemSelecionado]);

  useEffect(() => {
    setPeriodoOverride(null);
    setItemSelecionado(null);
    setCategoriaFiltro('todas');
  }, [periodo]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
        <span className="text-sm">Carregando produtos...</span>
      </div>
    );
  }

  if (!hasRealData || !report || report.top_items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-shopping-bag-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum produto vendido no período</p>
        <p className="text-xs text-zinc-400 mt-1">Período: <strong>{labelPeriodo(periodoEfetivo)}</strong></p>
      </div>
    );
  }

  const itemAtual = itens.find(i => i.nome === itemSelecionado);

  return (
    <div className="space-y-5">
      {/* Totais com comparativo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[
          {
            label: 'Itens distintos',
            value: itens.length.toString(),
            icon: 'ri-list-check',
            color: 'text-zinc-700 bg-zinc-50',
            ant: null,
          },
          {
            label: 'Total de unidades',
            value: totalQtd.toString(),
            icon: 'ri-stack-line',
            color: 'text-amber-700 bg-amber-50',
            ant: totalQtdAnt,
          },
          {
            label: 'Receita total',
            value: fmt(totalReceita),
            icon: 'ri-money-dollar-circle-line',
            color: 'text-emerald-700 bg-emerald-50',
            ant: totalReceitaAnt,
          },
          {
            label: 'Ticket médio por pedido',
            value: (report?.total_orders ?? 0) > 0
              ? fmt(report!.total_revenue / report!.total_orders)
              : 'R$ 0,00',
            icon: 'ri-receipt-line',
            color: 'text-sky-700 bg-sky-50',
            ant: null,
          },
        ].map(s => (
          <div key={s.label} className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center gap-3">
            <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${s.color}`}>
              <i className={`${s.icon} text-base`} />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-zinc-900">{s.value}</p>
              <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
              {s.ant !== null && s.ant > 0 && (
                <VarBadge atual={s.label === 'Total de unidades' ? totalQtd : totalReceita} anterior={s.ant} />
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Abas */}
      <div className="flex gap-1 p-1 bg-zinc-100 rounded-xl overflow-x-auto scrollbar-hide">
        {([
          { id: 'ranking', label: 'Ranking', icon: 'ri-trophy-line' },
          { id: 'categorias', label: 'Por Categoria', icon: 'ri-folder-chart-line' },
          { id: 'complementos', label: 'Complementos', icon: 'ri-add-circle-line' },
          { id: 'abc', label: 'Análise ABC', icon: 'ri-pie-chart-line' },
        ] as { id: 'ranking' | 'abc' | 'categorias' | 'complementos'; label: string; icon: string }[]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setAbaAtiva(tab.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap ${
              abaAtiva === tab.id ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            <i className={`${tab.icon} text-sm`} />
            <span className="hidden sm:inline">{tab.label}</span>
            <span className="sm:hidden">{tab.id === 'ranking' ? 'Ranking' : tab.id === 'categorias' ? 'Categ.' : tab.id === 'complementos' ? 'Compl.' : 'ABC'}</span>
          </button>
        ))}
      </div>

      {/* ── ABA: Por Categoria ── */}
      {abaAtiva === 'categorias' && (
        <div className="space-y-4">
          {dadosPorCategoria.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-zinc-100 rounded-xl text-zinc-400">
              <i className="ri-folder-chart-line text-3xl text-zinc-200 mb-2" />
              <p className="text-sm">Nenhuma categoria encontrada</p>
            </div>
          ) : (
            <>
              {/* Gráfico de barras por categoria */}
              <div className="bg-white border border-zinc-100 rounded-xl p-5">
                <h3 className="text-sm font-semibold text-zinc-800 mb-4">Receita por Categoria</h3>
                <div className="h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={dadosPorCategoria.map((c, i) => ({ ...c, cor: CAT_COLORS[i % CAT_COLORS.length] }))}
                      margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                      layout="vertical"
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
                      <XAxis
                        type="number"
                        tick={{ fontSize: 9, fill: '#a1a1aa' }}
                        axisLine={false}
                        tickLine={false}
                        tickFormatter={v => v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`}
                      />
                      <YAxis
                        type="category"
                        dataKey="categoria"
                        tick={{ fontSize: 10, fill: '#52525b' }}
                        axisLine={false}
                        tickLine={false}
                        width={100}
                      />
                      <Tooltip
                        formatter={(val: number) => [fmt(val), 'Receita']}
                        contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                      />
                      <Bar dataKey="receita" radius={[0, 4, 4, 0]} maxBarSize={28}>
                        {dadosPorCategoria.map((_, i) => (
                          <Cell key={i} fill={CAT_COLORS[i % CAT_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Cards por categoria */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {dadosPorCategoria.map((cat, i) => {
                  const pct = totalReceita > 0 ? ((cat.receita / totalReceita) * 100).toFixed(1) : '0';
                  const cor = CAT_COLORS[i % CAT_COLORS.length];
                  return (
                    <div key={cat.categoria} className="bg-white border border-zinc-100 rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: cor }} />
                          <span className="text-xs font-semibold text-zinc-700 truncate">{cat.categoria}</span>
                        </div>
                        <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${cor}20`, color: cor }}>
                          {pct}%
                        </span>
                      </div>
                      <p className="text-lg font-black text-zinc-900">{fmt(cat.receita)}</p>
                      <div className="flex items-center justify-between mt-2 text-xs text-zinc-500">
                        <span>{cat.qtd} unidades</span>
                        <span>{cat.itens} {cat.itens === 1 ? 'item' : 'itens'}</span>
                      </div>
                      <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cor }} />
                      </div>
                      <button
                        onClick={() => { setAbaAtiva('ranking'); setCategoriaFiltro(cat.categoria); }}
                        className="mt-3 text-[10px] font-semibold text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
                      >
                        Ver itens desta categoria →
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Tabela resumo */}
              <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-zinc-50 border-b border-zinc-100">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-zinc-500">Categoria</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Itens</th>
                      <th className="px-4 py-3 text-center font-semibold text-zinc-500">Unidades</th>
                      <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita</th>
                      <th className="px-4 py-3 text-right font-semibold text-zinc-500">% Total</th>
                      <th className="px-4 py-3 text-right font-semibold text-zinc-500">Ticket Médio</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-50">
                    {dadosPorCategoria.map((cat, i) => {
                      const pct = totalReceita > 0 ? ((cat.receita / totalReceita) * 100).toFixed(1) : '0';
                      const cor = CAT_COLORS[i % CAT_COLORS.length];
                      return (
                        <tr key={cat.categoria} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cor }} />
                              <span className="font-medium text-zinc-800">{cat.categoria}</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-center text-zinc-600">{cat.itens}</td>
                          <td className="px-4 py-3 text-center font-semibold text-zinc-700">{cat.qtd}</td>
                          <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(cat.receita)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: cor }} />
                              </div>
                              <span className="font-semibold text-zinc-600 w-8 text-right">{pct}%</span>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right text-zinc-600">
                            {cat.qtd > 0 ? fmt(cat.receita / cat.qtd) : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ── ABA: Análise ABC ── */}
      {abaAtiva === 'abc' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {(['A', 'B', 'C'] as ClasseABC[]).map((classe) => {
              const g = resumoABC[classe];
              const pctReceita = totalReceita > 0 ? ((g.receita / totalReceita) * 100).toFixed(1) : '0';
              return (
                <div key={classe} className={`bg-white border rounded-xl p-4 ${classe === 'A' ? 'border-emerald-100' : classe === 'B' ? 'border-amber-100' : 'border-zinc-100'}`}>
                  <div className="flex items-center justify-between mb-3">
                    <span className={`text-xs font-bold px-2.5 py-1 rounded-full border ${ABC_STYLE[classe].badge}`}>
                      {ABC_STYLE[classe].label}
                    </span>
                    <span className="text-2xl font-black text-zinc-800">{g.count}</span>
                  </div>
                  <p className="text-[10px] text-amber-800 mb-2">{ABC_STYLE[classe].desc}</p>
                  <div className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Receita</span>
                      <span className="font-bold text-zinc-800">{fmt(g.receita)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">% do total</span>
                      <span className="font-bold text-zinc-800">{pctReceita}%</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-zinc-500">Unidades</span>
                      <span className="font-bold text-zinc-800">{g.qtd}</span>
                    </div>
                  </div>
                  <div className="mt-3 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${classe === 'A' ? 'bg-emerald-500' : classe === 'B' ? 'bg-amber-400' : 'bg-zinc-300'}`}
                      style={{ width: `${pctReceita}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 flex items-start gap-3">
            <i className="ri-lightbulb-line text-amber-600 text-base flex-shrink-0 mt-0.5" />
            <div className="text-xs text-amber-800">
              <strong>Insight:</strong> Os {resumoABC.A.count} produtos da Classe A representam {totalReceita > 0 ? ((resumoABC.A.receita / totalReceita) * 100).toFixed(0) : 0}% da sua receita.
              Foque em garantir estoque e visibilidade desses itens no cardápio. Os {resumoABC.C.count} produtos da Classe C podem ser candidatos a revisão ou remoção.
            </div>
          </div>

          <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-zinc-50 border-b border-zinc-100">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Classe</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Item</th>
                    <th className="px-4 py-3 text-left font-semibold text-zinc-500">Categoria</th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-500">Qtd.</th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita</th>
                    <th className="px-4 py-3 text-right font-semibold text-zinc-500">% Acum.</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-50">
                  {(() => {
                    let acum = 0;
                    return itensComABC.map((item) => {
                      acum += totalReceita > 0 ? (item.receita / totalReceita) * 100 : 0;
                      return (
                        <tr key={item.nome} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-4 py-3">
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${ABC_STYLE[item.classe].badge}`}>
                              {item.classe}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <p title={item.nome} className="font-medium text-zinc-800 truncate max-w-[180px]">{item.nome}</p>
                          </td>
                          <td className="px-4 py-3">
                            <span className="text-[10px] px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-full">{item.categoria}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-zinc-700">{item.qtd}</td>
                          <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(item.receita)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-semibold ${acum <= 70 ? 'text-emerald-600' : acum <= 90 ? 'text-amber-600' : 'text-zinc-400'}`}>
                              {acum.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      );
                    });
                  })()}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── ABA: Ranking ── */}
      {abaAtiva === 'ranking' && (
        <div className="space-y-4">
          {/* Gráfico de barras horizontal top 10 */}
          {top10.length > 0 && (
            <div className="bg-white border border-zinc-100 rounded-xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-sm font-semibold text-zinc-800">Top 10 Produtos</h3>
                  <p className="text-xs text-zinc-400">
                    {sortBy === 'receita' ? 'Por receita gerada' : 'Por quantidade vendida'}
                    {categoriaFiltro !== 'todas' && ` · Categoria: ${categoriaFiltro}`}
                  </p>
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5">
                  <button
                    onClick={() => setSortBy('receita')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${sortBy === 'receita' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  >
                    R$
                  </button>
                  <button
                    onClick={() => setSortBy('qtd')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${sortBy === 'qtd' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  >
                    Qtd
                  </button>
                </div>
              </div>
              <div style={{ height: Math.max(180, top10.length * 32) }}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={top10}
                    layout="vertical"
                    margin={{ top: 0, right: 60, left: 0, bottom: 0 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
                    <XAxis
                      type="number"
                      tick={{ fontSize: 9, fill: '#a1a1aa' }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={v => sortBy === 'receita'
                        ? (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`)
                        : String(v)
                      }
                    />
                    <YAxis
                      type="category"
                      dataKey="nome"
                      tick={{ fontSize: 10, fill: '#52525b' }}
                      axisLine={false}
                      tickLine={false}
                      width={110}
                    />
                    <Tooltip
                      formatter={(val: number) => [
                        sortBy === 'receita' ? fmt(val) : `${val} unidades`,
                        sortBy === 'receita' ? 'Receita' : 'Quantidade',
                      ]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                    />
                    <Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={22}>
                      {top10.map((_, i) => (
                        <Cell
                          key={i}
                          fill={i === 0 ? '#f59e0b' : i === 1 ? '#fbbf24' : i === 2 ? '#fcd34d' : '#fde68a'}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Tabela + evolução */}
          <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
            {/* Tabela de produtos */}
            <div className="xl:col-span-3 space-y-3">
              {/* Filtros */}
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 flex-1 max-w-xs">
                  <div className="w-4 h-4 flex items-center justify-center text-zinc-400"><Search size={14} /></div>
                  <input
                    type="text"
                    placeholder="Buscar item..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
                  />
                </div>

                {/* Filtro por categoria */}
                {categorias.length > 1 && (
                  <select
                    value={categoriaFiltro}
                    onChange={e => { setCategoriaFiltro(e.target.value); setItemSelecionado(null); }}
                    className="text-xs border border-zinc-200 rounded-lg px-3 py-2 bg-white text-zinc-700 cursor-pointer focus:outline-none w-full sm:w-auto"
                  >
                    <option value="todas">Todas as categorias</option>
                    {categorias.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}

                <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto scrollbar-hide">
                  <button
                    onClick={() => setSortBy('receita')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${sortBy === 'receita' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  >
                    Por Receita
                  </button>
                  <button
                    onClick={() => setSortBy('qtd')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${sortBy === 'qtd' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  >
                    Por Quantidade
                  </button>
                </div>
              </div>

              {categoriaFiltro !== 'todas' && (
                <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-100 rounded-lg">
                  <i className="ri-filter-line text-amber-600 text-xs" />
                  <span className="text-xs text-amber-700 font-medium">Filtrando: {categoriaFiltro}</span>
                  <button
                    onClick={() => setCategoriaFiltro('todas')}
                    className="ml-auto text-[10px] text-amber-600 hover:text-amber-800 cursor-pointer font-semibold"
                  >
                    Limpar filtro ×
                  </button>
                </div>
              )}

              <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                {itens.length === 0 ? (
                  <div className="py-12 text-center text-zinc-400 text-sm">Nenhum item encontrado</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-50 border-b border-zinc-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-zinc-500">#</th>
                          <th className="px-4 py-3 text-left font-semibold text-zinc-500">Item</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">Qtd.</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">Var.</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {itens.map((item, idx) => {
                          const pctReceita = totalReceita > 0 ? ((item.receita / totalReceita) * 100).toFixed(1) : '0.0';
                          const isSelected = item.nome === itemSelecionado;
                          const antItem = itensAntMap.get(item.nome);
                          return (
                            <tr
                              key={item.pos}
                              onClick={() => setItemSelecionado(item.nome === itemSelecionado ? null : item.nome)}
                              className={`cursor-pointer transition-colors ${isSelected ? 'bg-amber-50 border-l-2 border-amber-400' : 'hover:bg-zinc-50'}`}
                            >
                              <td className="px-4 py-3">
                                <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${
                                  idx === 0 ? 'bg-amber-100 text-amber-700' :
                                  idx === 1 ? 'bg-zinc-100 text-zinc-600' :
                                  idx === 2 ? 'bg-orange-100 text-orange-600' : 'text-zinc-400'
                                }`}>{idx + 1}</span>
                              </td>
                              <td className="px-4 py-3">
                                <p title={item.nome} className={`font-medium truncate max-w-[140px] ${isSelected ? 'text-amber-700' : 'text-zinc-800'}`}>{item.nome}</p>
                                <p className="text-[10px] text-zinc-400 mt-0.5">{item.categoria}</p>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-zinc-800">{item.qtd}</td>
                              <td className="px-4 py-3 text-right">
                                {antItem ? (
                                  <VarBadge atual={item.qtd} anterior={antItem.qtd} />
                                ) : (
                                  <span className="text-zinc-300 text-[10px]">—</span>
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(item.receita)}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <div className="w-10 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-amber-400 rounded-full" style={{ width: `${pctReceita}%` }} />
                                  </div>
                                  <span className="text-zinc-500 w-7 text-right">{pctReceita}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Gráfico de evolução do item selecionado */}
            <div className="xl:col-span-2">
              <div className="bg-white border border-zinc-100 rounded-xl p-5 h-full flex flex-col">
                {!itemSelecionado ? (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-8">
                    <div className="w-12 h-12 flex items-center justify-center bg-zinc-100 rounded-xl mb-3">
                      <i className="ri-bar-chart-line text-2xl text-zinc-300" />
                    </div>
                    <p className="text-sm font-semibold text-zinc-500">Selecione um produto</p>
                    <p className="text-xs text-zinc-400 mt-1">Clique em qualquer linha da tabela para ver a evolução semanal</p>
                  </div>
                ) : (
                  <>
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex-1 min-w-0">
                        <h3 className="text-sm font-bold text-zinc-800 truncate">{itemSelecionado}</h3>
                        <p className="text-xs text-zinc-400 mt-0.5">Evolução semanal — {labelPeriodo(periodoEfetivo)}</p>
                      </div>
                      <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-0.5 ml-2 flex-shrink-0">
                        <button
                          onClick={() => setModoGrafico('qtd')}
                          className={`px-2 py-1 text-[10px] font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${modoGrafico === 'qtd' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                        >
                          Qtd
                        </button>
                        <button
                          onClick={() => setModoGrafico('receita')}
                          className={`px-2 py-1 text-[10px] font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${modoGrafico === 'receita' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                        >
                          R$
                        </button>
                      </div>
                    </div>

                    {/* KPIs do item + comparativo */}
                    {itemAtual && (
                      <div className="grid grid-cols-2 gap-2 mb-4">
                        <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                          <p className="text-base font-bold text-amber-700">{itemAtual.qtd}</p>
                          <p className="text-[10px] text-amber-600">unidades</p>
                          {itensAntMap.get(itemAtual.nome) && (
                            <div className="mt-1 flex justify-center">
                              <VarBadge atual={itemAtual.qtd} anterior={itensAntMap.get(itemAtual.nome)!.qtd} />
                            </div>
                          )}
                        </div>
                        <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                          <p className="text-base font-bold text-emerald-700">{fmt(itemAtual.receita)}</p>
                          <p className="text-[10px] text-emerald-600">receita</p>
                          {itensAntMap.get(itemAtual.nome) && (
                            <div className="mt-1 flex justify-center">
                              <VarBadge atual={itemAtual.receita} anterior={itensAntMap.get(itemAtual.nome)!.receita} />
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {evolLoading ? (
                      <div className="flex-1 flex items-center justify-center">
                        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
                      </div>
                    ) : evolucao.length === 0 ? (
                      <div className="flex-1 flex items-center justify-center text-zinc-400 text-xs text-center">
                        <div>
                          <i className="ri-bar-chart-line text-2xl text-zinc-200 block mb-2" />
                          Sem dados de evolução para este período
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-0">
                        <ResponsiveContainer width="100%" height={200}>
                          <BarChart data={evolucao} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                            <XAxis
                              dataKey="semana"
                              tick={{ fontSize: 9, fill: '#a1a1aa' }}
                              axisLine={false}
                              tickLine={false}
                              interval={Math.floor(evolucao.length / 5)}
                            />
                            <YAxis
                              tick={{ fontSize: 9, fill: '#a1a1aa' }}
                              axisLine={false}
                              tickLine={false}
                              width={modoGrafico === 'receita' ? 48 : 28}
                              tickFormatter={v => modoGrafico === 'receita' ? (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)) : String(v)}
                            />
                            <Tooltip content={<EvolTooltip />} />
                            <Bar dataKey={modoGrafico} radius={[4, 4, 0, 0]} maxBarSize={32}>
                              {evolucao.map((_, i) => (
                                <Cell
                                  key={i}
                                  fill={i === evolucao.length - 1 ? '#f59e0b' : '#fcd34d'}
                                />
                              ))}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>

                        {evolucao.length >= 2 && (() => {
                          const ultimo = evolucao[evolucao.length - 1][modoGrafico];
                          const penultimo = evolucao[evolucao.length - 2][modoGrafico];
                          const diff = penultimo > 0 ? ((ultimo - penultimo) / penultimo) * 100 : 0;
                          const subindo = diff >= 0;
                          return (
                            <div className={`mt-3 flex items-center gap-1.5 text-xs font-semibold px-3 py-2 rounded-lg ${subindo ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                              <i className={subindo ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />
                              <span>
                                {subindo ? '+' : ''}{diff.toFixed(1)}% vs semana anterior
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── ABA: Complementos (adicionais) ── */}
      {abaAtiva === 'complementos' && (
        <div className="space-y-4">
          {complementos.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 bg-white border border-zinc-100 rounded-xl text-zinc-400">
              <i className="ri-add-circle-line text-3xl text-zinc-200 mb-2" />
              <p className="text-sm">Nenhum complemento com valor no período</p>
              <p className="text-xs text-zinc-400 mt-1">Adicionais pagos (batata, molhos, bebidas…) aparecem aqui</p>
            </div>
          ) : (
            <>
              {/* Totais */}
              <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
                {[
                  { label: 'Complementos distintos', value: complementos.length.toString(), icon: 'ri-list-check', color: 'text-zinc-700 bg-zinc-50' },
                  { label: 'Unidades vendidas', value: totalQtdComplementos.toString(), icon: 'ri-stack-line', color: 'text-emerald-700 bg-emerald-50' },
                  { label: 'Receita em complementos', value: fmt(totalReceitaComplementos), icon: 'ri-money-dollar-circle-line', color: 'text-emerald-700 bg-emerald-50' },
                ].map(s => (
                  <div key={s.label} className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center gap-3">
                    <div className={`w-9 h-9 flex items-center justify-center rounded-xl flex-shrink-0 ${s.color}`}>
                      <i className={`${s.icon} text-base`} />
                    </div>
                    <div className="min-w-0">
                      <p className="text-xl font-bold text-zinc-900">{s.value}</p>
                      <p className="text-xs text-zinc-500 mt-0.5">{s.label}</p>
                    </div>
                  </div>
                ))}
              </div>

              {/* Controles: busca + ordenação */}
              <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2 flex-1 max-w-xs">
                  <div className="w-4 h-4 flex items-center justify-center text-zinc-400"><Search size={14} /></div>
                  <input
                    type="text"
                    placeholder="Buscar complemento..."
                    value={busca}
                    onChange={e => setBusca(e.target.value)}
                    className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
                  />
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 self-start">
                  <button
                    onClick={() => setSortBy('receita')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${sortBy === 'receita' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  >
                    Por Receita
                  </button>
                  <button
                    onClick={() => setSortBy('qtd')}
                    className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${sortBy === 'qtd' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500'}`}
                  >
                    Por Quantidade
                  </button>
                </div>
              </div>

              {/* Gráfico de barras horizontal top 10 complementos */}
              {topComplementos.length > 0 && (
                <div className="bg-white border border-zinc-100 rounded-xl p-5">
                  <div className="mb-4">
                    <h3 className="text-sm font-semibold text-zinc-800">Top 10 Complementos</h3>
                    <p className="text-xs text-zinc-400">{sortBy === 'receita' ? 'Por receita gerada' : 'Por quantidade vendida'}</p>
                  </div>
                  <div style={{ height: Math.max(180, topComplementos.length * 32) }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={topComplementos} layout="vertical" margin={{ top: 0, right: 60, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" horizontal={false} />
                        <XAxis
                          type="number"
                          tick={{ fontSize: 9, fill: '#a1a1aa' }}
                          axisLine={false}
                          tickLine={false}
                          tickFormatter={v => sortBy === 'receita' ? (v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`) : String(v)}
                        />
                        <YAxis type="category" dataKey="nome" tick={{ fontSize: 10, fill: '#52525b' }} axisLine={false} tickLine={false} width={110} />
                        <Tooltip
                          formatter={(val: number) => [sortBy === 'receita' ? fmt(val) : `${val} unidades`, sortBy === 'receita' ? 'Receita' : 'Quantidade']}
                          contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                        />
                        <Bar dataKey="valor" radius={[0, 4, 4, 0]} maxBarSize={22}>
                          {topComplementos.map((_, i) => (
                            <Cell key={i} fill={i === 0 ? '#10b981' : i === 1 ? '#34d399' : i === 2 ? '#6ee7b7' : '#a7f3d0'} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Tabela de complementos */}
              <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                {complementos.length === 0 ? (
                  <div className="py-12 text-center text-zinc-400 text-sm">Nenhum complemento encontrado</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-zinc-50 border-b border-zinc-100">
                        <tr>
                          <th className="px-4 py-3 text-left font-semibold text-zinc-500">#</th>
                          <th className="px-4 py-3 text-left font-semibold text-zinc-500">Complemento</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">Qtd.</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita</th>
                          <th className="px-4 py-3 text-right font-semibold text-zinc-500">%</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-50">
                        {complementos.map((op, idx) => {
                          const pct = totalReceitaComplementos > 0 ? ((op.receita / totalReceitaComplementos) * 100).toFixed(1) : '0.0';
                          return (
                            <tr key={op.nome} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-4 py-3">
                                <span className={`w-6 h-6 flex items-center justify-center rounded-full text-[10px] font-bold ${
                                  idx === 0 ? 'bg-emerald-100 text-emerald-700' :
                                  idx === 1 ? 'bg-zinc-100 text-zinc-600' :
                                  idx === 2 ? 'bg-teal-100 text-teal-600' : 'text-zinc-400'
                                }`}>{idx + 1}</span>
                              </td>
                              <td className="px-4 py-3">
                                <p title={op.nome} className="font-medium text-zinc-800 truncate max-w-[220px]">{op.nome}</p>
                              </td>
                              <td className="px-4 py-3 text-right font-semibold text-zinc-800">{op.qtd}</td>
                              <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(op.receita)}</td>
                              <td className="px-4 py-3 text-right">
                                <div className="flex items-center justify-end gap-1.5">
                                  <div className="w-10 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
                                  </div>
                                  <span className="text-zinc-500 w-7 text-right">{pct}%</span>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

import { Fragment, useState, useMemo, useEffect } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { useAuth } from '@/contexts/AuthContext';
import { useMerchandiseCategories } from '@/hooks/useMerchandiseCategories';
import { formatCurrency, formatCurrencyPreciso } from '@/lib/formatters';
import type { Purchase, PurchaseItem } from '@/types/financeiro';

/**
 * Relatórios de compras no nível do ITEM (fin_purchase_items), agrupados por
 * categoria de mercadoria / fornecedor / insumo / mês — espelha a aba "CM" da
 * planilha do dono (filtros mês/fornecedor/categoria + totais) para rodar
 * sistema × planilha em paralelo.
 *
 * Categoria de um item: `item.merchandise_category_id` → senão a categoria do
 * insumo (`ingredients.merchandise_category_id`) → senão "Sem categoria".
 * Valor de um item = `total_price + freight_allocated` (custo real da linha).
 */

interface Props {
  purchases: Purchase[];
  /** Abre o detalhe da compra (modal do ComprasTab) a partir de uma linha do drill-down. */
  onOpenPurchase?: (p: Purchase) => void;
}

interface IngredientLite {
  id: string;
  name: string;
  unit: string;
  merchandise_category_id?: string | null;
}

interface Linha {
  purchase: Purchase;
  item: PurchaseItem;
  itemKey: string;
  itemNome: string;
  categoriaId: string;
  categoriaNome: string;
  fornecedor: string;
  data: string;
  mes: string; // YYYY-MM
  qtdCompra: number;
  unidCompra: string;
  qtdBase: number;
  unidBase: string;
  valor: number;
  custoBase: number | null;
}

type Periodo = 'mes' | 'mes_ant' | '3m' | '6m' | '12m' | 'ano' | 'custom';
type GroupBy = 'categoria' | 'fornecedor' | 'item' | 'mes';

const SEM_CATEGORIA = '__sem__';
const CORES = ['#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#06b6d4', '#f97316', '#84cc16', '#ec4899', '#64748b'];

const PERIODOS: { value: Periodo; label: string }[] = [
  { value: 'mes', label: 'Mês atual' },
  { value: 'mes_ant', label: 'Mês anterior' },
  { value: '3m', label: '3 meses' },
  { value: '6m', label: '6 meses' },
  { value: '12m', label: '12 meses' },
  { value: 'ano', label: 'Ano' },
  { value: 'custom', label: 'Personalizado' },
];

const GROUPS: { value: GroupBy; label: string; icon: string }[] = [
  { value: 'categoria', label: 'Categoria', icon: 'ri-price-tag-3-line' },
  { value: 'fornecedor', label: 'Fornecedor', icon: 'ri-truck-line' },
  { value: 'item', label: 'Insumo / Item', icon: 'ri-box-3-line' },
  { value: 'mes', label: 'Mês', icon: 'ri-calendar-line' },
];

const STATUS_LABEL: Record<string, string> = { paid: 'Pago', pending: 'A Pagar', partial: 'Parcelado' };

function toISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return toISO(d);
}

function rangeDoPeriodo(p: Periodo, customFrom: string, customTo: string): { from: string; to: string } {
  const hoje = new Date();
  const y = hoje.getFullYear();
  const m = hoje.getMonth();
  if (p === 'mes') return { from: toISO(new Date(y, m, 1)), to: toISO(new Date(y, m + 1, 0)) };
  if (p === 'mes_ant') return { from: toISO(new Date(y, m - 1, 1)), to: toISO(new Date(y, m, 0)) };
  if (p === 'ano') return { from: toISO(new Date(y, 0, 1)), to: toISO(hoje) };
  if (p === 'custom') return { from: customFrom, to: customTo };
  const meses = p === '3m' ? 3 : p === '6m' ? 6 : 12;
  return { from: toISO(new Date(y, m - meses + 1, 1)), to: toISO(hoje) };
}

function mesLabel(mes: string): string {
  return new Date(mes + '-15T00:00:00').toLocaleDateString('pt-BR', { month: 'short', year: '2-digit' }).replace('.', '');
}

function fmtQtd(n: number): string {
  return n.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
}

function fmtData(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR');
}

function normalizar(s: string): string {
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
}

function Variacao({ atual, anterior }: { atual: number; anterior: number }) {
  if (anterior <= 0) return <span className="text-zinc-300 text-xs">—</span>;
  const pct = ((atual - anterior) / anterior) * 100;
  const up = pct > 0.5;
  const down = pct < -0.5;
  return (
    <span className={`text-xs font-semibold whitespace-nowrap ${up ? 'text-red-600' : down ? 'text-green-600' : 'text-zinc-500'}`}
      title={`Período anterior: ${formatCurrency(anterior)}`}>
      {up ? '▲' : down ? '▼' : '='} {Math.abs(pct).toFixed(0)}%
    </span>
  );
}

// ─── Agregações ──────────────────────────────────────────────────────────────

interface ItemAgg {
  key: string;
  nome: string;
  unidBase: string;
  categoriaNome: string;
  total: number;
  qtdBase: number;
  nCompras: number;
  fornecedores: Set<string>;
  custoMedio: number | null;
  ultimoCusto: number | null;
  ultimaData: string;
  minCusto: number | null;
  maxCusto: number | null;
  linhas: Linha[];
}

function agregarItens(linhas: Linha[]): ItemAgg[] {
  const map = new Map<string, ItemAgg>();
  linhas.forEach((l) => {
    let a = map.get(l.itemKey);
    if (!a) {
      a = {
        key: l.itemKey, nome: l.itemNome, unidBase: l.unidBase, categoriaNome: l.categoriaNome,
        total: 0, qtdBase: 0, nCompras: 0, fornecedores: new Set(), custoMedio: null,
        ultimoCusto: null, ultimaData: '', minCusto: null, maxCusto: null, linhas: [],
      };
      map.set(l.itemKey, a);
    }
    a.total += l.valor;
    a.qtdBase += l.qtdBase;
    a.fornecedores.add(l.fornecedor);
    a.linhas.push(l);
    if (l.custoBase != null && l.custoBase > 0) {
      a.minCusto = a.minCusto == null ? l.custoBase : Math.min(a.minCusto, l.custoBase);
      a.maxCusto = a.maxCusto == null ? l.custoBase : Math.max(a.maxCusto, l.custoBase);
      if (l.data >= a.ultimaData) { a.ultimaData = l.data; a.ultimoCusto = l.custoBase; }
    }
  });
  map.forEach((a) => {
    a.nCompras = new Set(a.linhas.map((l) => l.purchase.id)).size;
    a.custoMedio = a.qtdBase > 0 ? a.total / a.qtdBase : null;
    a.linhas.sort((x, y) => y.data.localeCompare(x.data));
  });
  return Array.from(map.values()).sort((x, y) => y.total - x.total);
}

interface Grupo {
  key: string;
  nome: string;
  total: number;
  totalAnterior: number;
  nCompras: number;
  nItens: number;
  linhas: Linha[];
}

function chaveGrupo(l: Linha, g: GroupBy): { key: string; nome: string } {
  if (g === 'categoria') return { key: l.categoriaId, nome: l.categoriaNome };
  if (g === 'fornecedor') return { key: normalizar(l.fornecedor), nome: l.fornecedor };
  if (g === 'mes') return { key: l.mes, nome: mesLabel(l.mes) };
  return { key: l.itemKey, nome: l.itemNome };
}

function agrupar(linhas: Linha[], anteriores: Linha[], g: GroupBy): Grupo[] {
  const map = new Map<string, Grupo>();
  linhas.forEach((l) => {
    const { key, nome } = chaveGrupo(l, g);
    let grp = map.get(key);
    if (!grp) { grp = { key, nome, total: 0, totalAnterior: 0, nCompras: 0, nItens: 0, linhas: [] }; map.set(key, grp); }
    grp.total += l.valor;
    grp.linhas.push(l);
  });
  anteriores.forEach((l) => {
    const { key } = chaveGrupo(l, g);
    const grp = map.get(key);
    if (grp) grp.totalAnterior += l.valor;
  });
  map.forEach((grp) => {
    grp.nCompras = new Set(grp.linhas.map((l) => l.purchase.id)).size;
    grp.nItens = new Set(grp.linhas.map((l) => l.itemKey)).size;
  });
  const arr = Array.from(map.values());
  if (g === 'mes') return arr.sort((a, b) => b.key.localeCompare(a.key));
  return arr.sort((a, b) => b.total - a.total);
}

// ─── Componente ──────────────────────────────────────────────────────────────

export default function ComprasRelatoriosPanel({ purchases, onOpenPurchase }: Props) {
  const { user } = useAuth();
  const { categories } = useMerchandiseCategories();

  const [periodo, setPeriodo] = useState<Periodo>('mes');
  const [customFrom, setCustomFrom] = useState(() => toISO(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customTo, setCustomTo] = useState(() => toISO(new Date()));
  const [groupBy, setGroupBy] = useState<GroupBy>('categoria');
  const [fFornecedor, setFFornecedor] = useState('all');
  const [fCategoria, setFCategoria] = useState('all');
  const [fStatus, setFStatus] = useState('all');
  const [busca, setBusca] = useState('');
  const [expandidos, setExpandidos] = useState<Set<string>>(new Set());
  const [itensAbertos, setItensAbertos] = useState<Set<string>>(new Set());
  const [ingredients, setIngredients] = useState<IngredientLite[]>([]);

  // Insumos: dão nome e categoria de fallback aos itens ligados ao estoque.
  useEffect(() => {
    if (!user?.tenantId) return;
    let cancelado = false;
    setIngredients([]);
    fetchAllRows<IngredientLite>((from, to) =>
      supabase.from('ingredients').select('id,name,unit,merchandise_category_id').eq('tenant_id', user.tenantId).range(from, to),
    ).then(({ rows, error }) => {
      if (cancelado) return;
      if (error) console.error('[ComprasRelatorios] Erro ao buscar insumos:', error.message);
      setIngredients(rows);
    });
    return () => { cancelado = true; };
  }, [user?.tenantId]);

  const catMap = useMemo(() => {
    const m = new Map<string, string>();
    categories.forEach((c) => m.set(c.id, c.name));
    return m;
  }, [categories]);

  const ingMap = useMemo(() => {
    const m = new Map<string, IngredientLite>();
    ingredients.forEach((i) => m.set(i.id, i));
    return m;
  }, [ingredients]);

  // Todas as linhas (item × compra), independente do período.
  const todasLinhas = useMemo<Linha[]>(() => {
    const out: Linha[] = [];
    purchases.forEach((p) => {
      (p.items ?? []).forEach((it) => {
        const ing = it.ingredient_id ? ingMap.get(it.ingredient_id) : undefined;
        const catId = it.merchandise_category_id || ing?.merchandise_category_id || null;
        const catNome = catId ? (catMap.get(catId) ?? 'Categoria desativada') : 'Sem categoria';
        const qtdCompra = Number(it.quantity) || 0;
        const fator = Number(it.units_per_package) || 1;
        const qtdBase = qtdCompra * fator;
        const valor = (Number(it.total_price) || 0) + (Number(it.freight_allocated) || 0);
        const custoBase = it.cost_per_base_unit != null && Number(it.cost_per_base_unit) > 0
          ? Number(it.cost_per_base_unit)
          : qtdBase > 0 ? valor / qtdBase : null;
        const nome = ing?.name || it.ingredient?.name || it.description || '(sem descrição)';
        out.push({
          purchase: p,
          item: it,
          itemKey: it.ingredient_id ? `ing:${it.ingredient_id}` : `desc:${normalizar(it.description || '')}`,
          itemNome: nome,
          categoriaId: catId ?? SEM_CATEGORIA,
          categoriaNome: catNome,
          fornecedor: p.supplier || 'Sem fornecedor',
          data: p.purchase_date,
          mes: p.purchase_date.slice(0, 7),
          qtdCompra,
          unidCompra: it.unit_label || '',
          qtdBase,
          unidBase: ing?.unit || it.ingredient?.unit || (fator === 1 ? it.unit_label || 'un' : 'un'),
          valor,
          custoBase,
        });
      });
    });
    return out;
  }, [purchases, ingMap, catMap]);

  const { from, to } = rangeDoPeriodo(periodo, customFrom, customTo);
  const diasPeriodo = Math.max(1, Math.round((new Date(to + 'T00:00:00').getTime() - new Date(from + 'T00:00:00').getTime()) / 86400000) + 1);
  const prevTo = addDays(from, -1);
  const prevFrom = addDays(prevTo, -(diasPeriodo - 1));

  const passaFiltros = (l: Linha): boolean => {
    if (fFornecedor !== 'all' && normalizar(l.fornecedor) !== fFornecedor) return false;
    if (fCategoria !== 'all' && l.categoriaId !== fCategoria) return false;
    if (fStatus !== 'all' && l.purchase.payment_status !== fStatus) return false;
    if (busca.trim()) {
      const q = normalizar(busca);
      if (!normalizar(l.itemNome).includes(q) && !normalizar(l.fornecedor).includes(q) && !normalizar(l.categoriaNome).includes(q)) return false;
    }
    return true;
  };

  const linhas = useMemo(
    () => todasLinhas.filter((l) => l.data >= from && l.data <= to && passaFiltros(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todasLinhas, from, to, fFornecedor, fCategoria, fStatus, busca],
  );
  const linhasAnt = useMemo(
    () => todasLinhas.filter((l) => l.data >= prevFrom && l.data <= prevTo && passaFiltros(l)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [todasLinhas, prevFrom, prevTo, fFornecedor, fCategoria, fStatus, busca],
  );

  const grupos = useMemo(() => agrupar(linhas, linhasAnt, groupBy), [linhas, linhasAnt, groupBy]);

  // KPIs
  const total = linhas.reduce((s, l) => s + l.valor, 0);
  const totalAnt = linhasAnt.reduce((s, l) => s + l.valor, 0);
  const nCompras = new Set(linhas.map((l) => l.purchase.id)).size;
  const nItens = new Set(linhas.map((l) => l.itemKey)).size;
  const semCategoria = linhas.filter((l) => l.categoriaId === SEM_CATEGORIA).reduce((s, l) => s + l.valor, 0);
  const nFornecedores = new Set(linhas.map((l) => normalizar(l.fornecedor))).size;

  // Opções de filtro (a partir de TODAS as linhas, para não sumir opção ao filtrar)
  const fornecedoresOpts = useMemo(() => {
    const m = new Map<string, string>();
    todasLinhas.forEach((l) => { if (!m.has(normalizar(l.fornecedor))) m.set(normalizar(l.fornecedor), l.fornecedor); });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [todasLinhas]);
  const categoriasOpts = useMemo(() => {
    const m = new Map<string, string>();
    todasLinhas.forEach((l) => { if (!m.has(l.categoriaId)) m.set(l.categoriaId, l.categoriaNome); });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1], 'pt-BR'));
  }, [todasLinhas]);

  // Matriz categoria × mês + dados do gráfico empilhado
  const meses = useMemo(() => Array.from(new Set(linhas.map((l) => l.mes))).sort(), [linhas]);
  const matriz = useMemo(() => {
    const cats = new Map<string, { nome: string; porMes: Record<string, number>; total: number }>();
    linhas.forEach((l) => {
      let c = cats.get(l.categoriaId);
      if (!c) { c = { nome: l.categoriaNome, porMes: {}, total: 0 }; cats.set(l.categoriaId, c); }
      c.porMes[l.mes] = (c.porMes[l.mes] ?? 0) + l.valor;
      c.total += l.valor;
    });
    return Array.from(cats.entries()).map(([id, c]) => ({ id, ...c })).sort((a, b) => b.total - a.total);
  }, [linhas]);
  const totalPorMes = useMemo(() => {
    const t: Record<string, number> = {};
    linhas.forEach((l) => { t[l.mes] = (t[l.mes] ?? 0) + l.valor; });
    return t;
  }, [linhas]);

  const chartData = useMemo(() => {
    const top = matriz.slice(0, 7);
    const resto = matriz.slice(7);
    return meses.map((mes) => {
      const row: Record<string, number | string> = { mes: mesLabel(mes) };
      top.forEach((c) => { row[c.nome] = Math.round((c.porMes[mes] ?? 0) * 100) / 100; });
      if (resto.length) row['Outras'] = Math.round(resto.reduce((s, c) => s + (c.porMes[mes] ?? 0), 0) * 100) / 100;
      return row;
    });
  }, [matriz, meses]);
  const chartSeries = useMemo(() => {
    const s = matriz.slice(0, 7).map((c) => c.nome);
    if (matriz.length > 7) s.push('Outras');
    return s;
  }, [matriz]);

  const toggle = (set: Set<string>, key: string, setter: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    setter(next);
  };

  const limparFiltros = () => {
    setFFornecedor('all'); setFCategoria('all'); setFStatus('all'); setBusca('');
  };
  const filtrosAtivos = [fFornecedor !== 'all', fCategoria !== 'all', fStatus !== 'all', !!busca.trim()].filter(Boolean).length;

  const exportar = () => {
    const num = (n: number | null | undefined) => (n == null ? '' : String(Math.round(n * 10000) / 10000).replace('.', ','));
    const rows = [
      ['Data', 'Fornecedor', 'NF', 'Categoria', 'Item', 'Qtd compra', 'Emb.', 'Qtd estoque', 'Unid.', 'Preço unit. compra', 'Custo/unid. estoque', 'Frete rateado', 'Total', 'Pagamento', 'Status'],
      ...[...linhas].sort((a, b) => b.data.localeCompare(a.data)).map((l) => [
        l.data, l.fornecedor, l.purchase.invoice_number || '', l.categoriaNome, l.itemNome,
        num(l.qtdCompra), l.unidCompra, num(l.qtdBase), l.unidBase,
        num(Number(l.item.final_unit_cost ?? l.item.unit_price)), num(l.custoBase), num(Number(l.item.freight_allocated ?? 0)), num(l.valor),
        l.purchase.payment_method, STATUS_LABEL[l.purchase.payment_status] ?? l.purchase.payment_status,
      ]),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `Compras_itens_${from}_${to}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  // ─── Render helpers ────────────────────────────────────────────────────────

  const renderLinhasCompra = (ls: Linha[]) => (
    <div className="bg-zinc-50/70 border-t border-zinc-100">
      <div className="overflow-x-auto">
        <table className="w-full text-xs min-w-[720px]">
          <thead>
            <tr className="text-zinc-400 text-[11px]">
              <th className="text-left font-medium px-4 py-1.5">Data</th>
              <th className="text-left font-medium px-2 py-1.5">Fornecedor</th>
              {groupBy !== 'item' && <th className="text-left font-medium px-2 py-1.5">Item</th>}
              <th className="text-right font-medium px-2 py-1.5">Qtd</th>
              <th className="text-right font-medium px-2 py-1.5">Estoque</th>
              <th className="text-right font-medium px-2 py-1.5">Custo/unid.</th>
              <th className="text-right font-medium px-2 py-1.5">Total</th>
              <th className="text-center font-medium px-2 py-1.5">Status</th>
              <th className="px-3 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {ls.map((l) => (
              <tr key={l.item.id} className="border-t border-zinc-100 hover:bg-white transition-colors">
                <td className="px-4 py-1.5 text-zinc-600 whitespace-nowrap">{fmtData(l.data)}</td>
                <td className="px-2 py-1.5 text-zinc-700 truncate max-w-[160px]" title={l.fornecedor}>{l.fornecedor}</td>
                {groupBy !== 'item' && <td className="px-2 py-1.5 text-zinc-700 truncate max-w-[180px]" title={l.itemNome}>{l.itemNome}</td>}
                <td className="px-2 py-1.5 text-right text-zinc-600 whitespace-nowrap">{fmtQtd(l.qtdCompra)} {l.unidCompra}</td>
                <td className="px-2 py-1.5 text-right text-zinc-600 whitespace-nowrap">{fmtQtd(l.qtdBase)} {l.unidBase}</td>
                <td className="px-2 py-1.5 text-right text-zinc-700 whitespace-nowrap">{l.custoBase != null ? `${formatCurrencyPreciso(l.custoBase, 4)}/${l.unidBase}` : '—'}</td>
                <td className="px-2 py-1.5 text-right font-semibold text-zinc-800 whitespace-nowrap">{formatCurrency(l.valor)}</td>
                <td className="px-2 py-1.5 text-center">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${l.purchase.payment_status === 'paid' ? 'bg-green-100 text-green-700' : l.purchase.payment_status === 'partial' ? 'bg-sky-100 text-sky-700' : 'bg-amber-100 text-amber-700'}`}>
                    {STATUS_LABEL[l.purchase.payment_status] ?? l.purchase.payment_status}
                  </span>
                </td>
                <td className="px-3 py-1.5 text-right">
                  {onOpenPurchase && (
                    <button onClick={() => onOpenPurchase(l.purchase)} title="Abrir compra"
                      className="text-zinc-400 hover:text-amber-600 cursor-pointer">
                      <i className="ri-external-link-line" />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderItens = (grupoKey: string, ls: Linha[]) => {
    const itens = agregarItens(ls);
    const totalGrupo = ls.reduce((s, l) => s + l.valor, 0);
    return (
      <div className="bg-zinc-50/40 border-t border-zinc-100">
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[760px]">
            <thead>
              <tr className="text-zinc-400 text-[11px]">
                <th className="text-left font-medium pl-10 pr-2 py-1.5">Insumo / item</th>
                {groupBy !== 'categoria' && <th className="text-left font-medium px-2 py-1.5">Categoria</th>}
                <th className="text-right font-medium px-2 py-1.5">Qtd (estoque)</th>
                <th className="text-right font-medium px-2 py-1.5">Custo médio</th>
                <th className="text-right font-medium px-2 py-1.5">Último</th>
                <th className="text-right font-medium px-2 py-1.5">Mín – Máx</th>
                <th className="text-center font-medium px-2 py-1.5">Compras</th>
                <th className="text-right font-medium px-2 py-1.5">Total</th>
                <th className="text-right font-medium px-4 py-1.5">%</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((it) => {
                const k = `${grupoKey}::${it.key}`;
                const aberto = itensAbertos.has(k);
                const varUltimo = it.custoMedio && it.ultimoCusto ? ((it.ultimoCusto - it.custoMedio) / it.custoMedio) * 100 : null;
                return (
                  <Fragment key={k}>
                    <tr onClick={() => toggle(itensAbertos, k, setItensAbertos)}
                      className="border-t border-zinc-100 hover:bg-white cursor-pointer transition-colors">
                      <td className="pl-6 pr-2 py-2 text-zinc-800 font-medium">
                        <i className={`${aberto ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-zinc-400 mr-1`} />
                        {it.nome}
                        {it.fornecedores.size > 1 && <span className="ml-1.5 text-[10px] text-zinc-400 font-normal">{it.fornecedores.size} forn.</span>}
                      </td>
                      {groupBy !== 'categoria' && <td className="px-2 py-2 text-zinc-500 whitespace-nowrap">{it.categoriaNome}</td>}
                      <td className="px-2 py-2 text-right text-zinc-600 whitespace-nowrap">{fmtQtd(it.qtdBase)} {it.unidBase}</td>
                      <td className="px-2 py-2 text-right text-zinc-700 whitespace-nowrap">{it.custoMedio != null ? formatCurrencyPreciso(it.custoMedio, 4) : '—'}</td>
                      <td className="px-2 py-2 text-right whitespace-nowrap">
                        {it.ultimoCusto != null ? (
                          <span className={varUltimo != null && Math.abs(varUltimo) >= 5 ? (varUltimo > 0 ? 'text-red-600 font-semibold' : 'text-green-600 font-semibold') : 'text-zinc-700'}
                            title={varUltimo != null ? `${varUltimo > 0 ? '+' : ''}${varUltimo.toFixed(1)}% vs média do período` : undefined}>
                            {formatCurrencyPreciso(it.ultimoCusto, 4)}
                          </span>
                        ) : '—'}
                      </td>
                      <td className="px-2 py-2 text-right text-zinc-500 whitespace-nowrap">
                        {it.minCusto != null && it.maxCusto != null && it.nCompras > 1
                          ? `${formatCurrencyPreciso(it.minCusto, 2)} – ${formatCurrencyPreciso(it.maxCusto, 2)}`
                          : '—'}
                      </td>
                      <td className="px-2 py-2 text-center text-zinc-600">{it.nCompras}</td>
                      <td className="px-2 py-2 text-right font-semibold text-zinc-900 whitespace-nowrap">{formatCurrency(it.total)}</td>
                      <td className="px-4 py-2 text-right text-zinc-400 whitespace-nowrap">{totalGrupo > 0 ? ((it.total / totalGrupo) * 100).toFixed(0) : 0}%</td>
                    </tr>
                    {aberto && (
                      <tr>
                        <td colSpan={groupBy !== 'categoria' ? 9 : 8} className="p-0">{renderLinhasCompra(it.linhas)}</td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  if (purchases.length === 0) {
    return (
      <div className="bg-white rounded-xl border border-zinc-200 py-16 text-center">
        <i className="ri-file-chart-line text-4xl text-zinc-200 block mb-2" />
        <p className="text-zinc-400 text-sm">Nenhuma compra lançada ainda</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Período + agrupamento */}
      <div className="bg-white rounded-xl border border-zinc-200 p-3 space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
          <div className="flex bg-zinc-50 border border-zinc-200 rounded-lg overflow-hidden overflow-x-auto">
            {PERIODOS.map((p) => (
              <button key={p.value} onClick={() => setPeriodo(p.value)}
                className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${periodo === p.value ? 'bg-amber-500 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>
                {p.label}
              </button>
            ))}
          </div>
          {periodo === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)}
                className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-200" />
              <span className="text-zinc-400 text-xs">até</span>
              <input type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)}
                className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-200" />
            </div>
          )}
          <p className="text-xs text-zinc-500 whitespace-nowrap">
            {fmtData(from)} – {fmtData(to)}
            <span className="text-zinc-300 mx-1.5">·</span>
            comparado a {fmtData(prevFrom)} – {fmtData(prevTo)}
          </p>
          <div className="lg:ml-auto flex items-center gap-2">
            <button onClick={exportar} disabled={linhas.length === 0}
              className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-700 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap disabled:opacity-40">
              <i className="ri-download-2-line" /> CSV ({linhas.length} itens)
            </button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row lg:items-center gap-2 lg:gap-3">
          <div className="relative flex-1 min-w-[180px]">
            <i className="ri-search-line absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item, fornecedor ou categoria…"
              className="w-full border border-zinc-200 rounded-lg pl-8 pr-2 py-1.5 text-xs text-zinc-700 focus:outline-none focus:ring-2 focus:ring-amber-200" />
          </div>
          <select value={fCategoria} onChange={(e) => setFCategoria(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 max-w-[200px]">
            <option value="all">Todas as categorias</option>
            {categoriasOpts.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          </select>
          <select value={fFornecedor} onChange={(e) => setFFornecedor(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200 max-w-[200px]">
            <option value="all">Todos os fornecedores</option>
            {fornecedoresOpts.map(([k, nome]) => <option key={k} value={k}>{nome}</option>)}
          </select>
          <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}
            className="border border-zinc-200 rounded-lg px-2 py-1.5 text-xs text-zinc-700 bg-white focus:outline-none focus:ring-2 focus:ring-amber-200">
            <option value="all">Todos os status</option>
            <option value="paid">Pago</option>
            <option value="pending">A Pagar</option>
            <option value="partial">Parcelado</option>
          </select>
          {filtrosAtivos > 0 && (
            <button onClick={limparFiltros} className="text-xs text-amber-600 hover:text-amber-700 font-semibold cursor-pointer whitespace-nowrap">
              <i className="ri-close-circle-line mr-0.5" /> Limpar ({filtrosAtivos})
            </button>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500">Total comprado</p>
          <p className="text-lg font-bold text-amber-700 mt-0.5">{formatCurrency(total)}</p>
          <div className="mt-1 flex items-center gap-1.5 text-xs text-zinc-400">
            <Variacao atual={total} anterior={totalAnt} /> <span>vs anterior</span>
          </div>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500">Compras</p>
          <p className="text-lg font-bold text-zinc-800 mt-0.5">{nCompras}</p>
          <p className="text-xs text-zinc-400 mt-1">{nCompras > 0 ? `${formatCurrency(total / nCompras)} / compra` : '—'}</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500">Itens distintos</p>
          <p className="text-lg font-bold text-zinc-800 mt-0.5">{nItens}</p>
          <p className="text-xs text-zinc-400 mt-1">{linhas.length} linhas</p>
        </div>
        <div className="bg-white rounded-xl border border-zinc-200 p-4">
          <p className="text-xs text-zinc-500">Fornecedores</p>
          <p className="text-lg font-bold text-zinc-800 mt-0.5">{nFornecedores}</p>
          <p className="text-xs text-zinc-400 mt-1">{matriz.length} categoria{matriz.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => { setFCategoria(semCategoria > 0 ? SEM_CATEGORIA : 'all'); setGroupBy('item'); }}
          className={`rounded-xl border p-4 text-left cursor-pointer transition-colors ${semCategoria > 0 ? 'bg-red-50 border-red-200 hover:bg-red-100' : 'bg-white border-zinc-200'}`}
          title={semCategoria > 0 ? 'Clique para listar os itens sem categoria' : undefined}>
          <p className={`text-xs ${semCategoria > 0 ? 'text-red-600' : 'text-zinc-500'}`}>Sem categoria</p>
          <p className={`text-lg font-bold mt-0.5 ${semCategoria > 0 ? 'text-red-700' : 'text-green-700'}`}>{formatCurrency(semCategoria)}</p>
          <p className={`text-xs mt-1 ${semCategoria > 0 ? 'text-red-500' : 'text-zinc-400'}`}>
            {total > 0 ? `${((semCategoria / total) * 100).toFixed(1)}% do total` : '—'}
          </p>
        </button>
      </div>

      {linhas.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200 py-14 text-center">
          <i className="ri-filter-off-line text-3xl text-zinc-200 block mb-2" />
          <p className="text-zinc-400 text-sm">Nenhum item de compra no período / filtros selecionados</p>
        </div>
      ) : (
        <>
          {/* Tabela principal agrupada */}
          <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 flex flex-col sm:flex-row sm:items-center gap-2">
              <h4 className="text-sm font-semibold text-zinc-800">Compras por</h4>
              <div className="flex bg-zinc-50 border border-zinc-200 rounded-lg overflow-hidden">
                {GROUPS.map((g) => (
                  <button key={g.value} onClick={() => { setGroupBy(g.value); setExpandidos(new Set()); setItensAbertos(new Set()); }}
                    className={`px-3 py-1.5 text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center gap-1 ${groupBy === g.value ? 'bg-zinc-800 text-white' : 'text-zinc-600 hover:bg-zinc-100'}`}>
                    <i className={g.icon} /> {g.label}
                  </button>
                ))}
              </div>
              <span className="sm:ml-auto text-xs text-zinc-400">{grupos.length} grupo{grupos.length !== 1 ? 's' : ''} · clique para detalhar</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead className="bg-zinc-50 text-xs text-zinc-500">
                  <tr>
                    <th className="text-left font-medium px-4 py-2">{GROUPS.find((g) => g.value === groupBy)?.label}</th>
                    <th className="text-right font-medium px-2 py-2">Total</th>
                    <th className="text-left font-medium px-2 py-2 w-36">% do total</th>
                    <th className="text-right font-medium px-2 py-2">vs anterior</th>
                    <th className="text-center font-medium px-2 py-2">Compras</th>
                    {groupBy !== 'item' && <th className="text-center font-medium px-2 py-2">Itens</th>}
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody>
                  {grupos.map((g, i) => {
                    const pct = total > 0 ? (g.total / total) * 100 : 0;
                    const aberto = expandidos.has(g.key);
                    const cor = g.key === SEM_CATEGORIA ? '#ef4444' : CORES[i % CORES.length];
                    return (
                      <Fragment key={g.key}>
                        <tr onClick={() => toggle(expandidos, g.key, setExpandidos)}
                          className={`border-t border-zinc-100 cursor-pointer transition-colors ${aberto ? 'bg-amber-50/40' : 'hover:bg-zinc-50'}`}>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: cor }} />
                              <span className={`font-semibold ${g.key === SEM_CATEGORIA ? 'text-red-700' : 'text-zinc-800'}`}>{g.nome}</span>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right font-bold text-zinc-900 whitespace-nowrap">{formatCurrency(g.total)}</td>
                          <td className="px-2 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, backgroundColor: cor }} />
                              </div>
                              <span className="text-xs text-zinc-500 w-10 text-right">{pct.toFixed(1)}%</span>
                            </div>
                          </td>
                          <td className="px-2 py-2.5 text-right"><Variacao atual={g.total} anterior={g.totalAnterior} /></td>
                          <td className="px-2 py-2.5 text-center text-xs text-zinc-600">{g.nCompras}</td>
                          {groupBy !== 'item' && <td className="px-2 py-2.5 text-center text-xs text-zinc-600">{g.nItens}</td>}
                          <td className="px-2 py-2.5 text-center text-zinc-400">
                            <i className={aberto ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
                          </td>
                        </tr>
                        {aberto && (
                          <tr>
                            <td colSpan={groupBy !== 'item' ? 7 : 6} className="p-0">
                              {groupBy === 'item' ? renderLinhasCompra([...g.linhas].sort((a, b) => b.data.localeCompare(a.data))) : renderItens(g.key, g.linhas)}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot className="bg-zinc-50 border-t border-zinc-200 text-sm">
                  <tr>
                    <td className="px-4 py-2.5 font-semibold text-zinc-700">Total</td>
                    <td className="px-2 py-2.5 text-right font-bold text-amber-700 whitespace-nowrap">{formatCurrency(total)}</td>
                    <td className="px-2 py-2.5 text-xs text-zinc-400">100%</td>
                    <td className="px-2 py-2.5 text-right"><Variacao atual={total} anterior={totalAnt} /></td>
                    <td className="px-2 py-2.5 text-center text-xs text-zinc-600">{nCompras}</td>
                    {groupBy !== 'item' && <td className="px-2 py-2.5 text-center text-xs text-zinc-600">{nItens}</td>}
                    <td />
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* Evolução mensal por categoria (só faz sentido com 2+ meses) */}
          {meses.length >= 2 && (
            <div className="grid grid-cols-1 xl:grid-cols-5 gap-4">
              <div className="xl:col-span-2 bg-white rounded-xl border border-zinc-200 p-4">
                <h4 className="text-sm font-semibold text-zinc-800 mb-3">Evolução mensal por categoria</h4>
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                    <XAxis dataKey="mes" tick={{ fontSize: 11, fill: '#71717a' }} />
                    <YAxis tick={{ fontSize: 10, fill: '#71717a' }} tickFormatter={(v: number) => `R$${(v / 1000).toFixed(0)}k`} width={52} />
                    <Tooltip
                      formatter={(v: number, name: string) => [formatCurrency(v), name]}
                      contentStyle={{ fontSize: 12, borderRadius: 10, border: '1px solid #e4e4e7' }}
                    />
                    <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11 }} />
                    {chartSeries.map((s, i) => (
                      <Bar key={s} dataKey={s} stackId="a" fill={s === 'Sem categoria' ? '#ef4444' : s === 'Outras' ? '#a1a1aa' : CORES[i % CORES.length]} maxBarSize={44}
                        radius={i === chartSeries.length - 1 ? [4, 4, 0, 0] : undefined} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Matriz categoria × mês (aba CM da planilha) */}
              <div className="xl:col-span-3 bg-white rounded-xl border border-zinc-200 overflow-hidden">
                <div className="px-4 py-3 border-b border-zinc-100 flex items-center justify-between">
                  <h4 className="text-sm font-semibold text-zinc-800">Categoria × Mês</h4>
                  <span className="text-xs text-zinc-400">{meses.length} meses</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="text-xs w-full">
                    <thead className="bg-zinc-50 text-zinc-500">
                      <tr>
                        <th className="text-left font-medium px-4 py-2 sticky left-0 bg-zinc-50">Categoria</th>
                        {meses.map((m) => <th key={m} className="text-right font-medium px-3 py-2 whitespace-nowrap">{mesLabel(m)}</th>)}
                        <th className="text-right font-semibold px-4 py-2 text-zinc-700">Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {matriz.map((c) => (
                        <tr key={c.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                          <td className={`px-4 py-2 font-medium sticky left-0 bg-white whitespace-nowrap ${c.id === SEM_CATEGORIA ? 'text-red-700' : 'text-zinc-800'}`}>{c.nome}</td>
                          {meses.map((m) => (
                            <td key={m} className="px-3 py-2 text-right text-zinc-600 whitespace-nowrap">
                              {c.porMes[m] ? formatCurrency(c.porMes[m]) : <span className="text-zinc-300">—</span>}
                            </td>
                          ))}
                          <td className="px-4 py-2 text-right font-semibold text-zinc-900 whitespace-nowrap">{formatCurrency(c.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="bg-zinc-50 border-t border-zinc-200">
                      <tr>
                        <td className="px-4 py-2 font-semibold text-zinc-700 sticky left-0 bg-zinc-50">Total</td>
                        {meses.map((m) => <td key={m} className="px-3 py-2 text-right font-semibold text-zinc-800 whitespace-nowrap">{formatCurrency(totalPorMes[m] ?? 0)}</td>)}
                        <td className="px-4 py-2 text-right font-bold text-amber-700 whitespace-nowrap">{formatCurrency(total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

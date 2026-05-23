import { useMemo, useState, useEffect, useCallback } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useCmvReport } from '@/hooks/useCmvReport';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { formatCurrency, formatPercent } from '@/lib/formatters';

// ── Hook: CMV mensal histórico ────────────────────────────────────────────────
interface CmvMensalPonto { mes: string; cmv_pct: number; receita: number; custo: number; }

function useCmvMensal() {
  const { user } = useAuth();
  const [dados, setDados] = useState<CmvMensalPonto[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Busca os últimos 12 meses de vendas agrupado por mês
      const from = new Date();
      from.setMonth(from.getMonth() - 11);
      from.setDate(1);
      from.setHours(0, 0, 0, 0);

      // Passo 1: busca order_ids válidos (filtros em join não funcionam no Supabase client)
      const { data: validOrders } = await supabase
        .from('orders')
        .select('id, created_at')
        .eq('tenant_id', user.tenantId)
        .gte('created_at', from.toISOString())
        .not('status', 'in', '(cancelled,draft)')
        .eq('is_training', false);

      if (!validOrders || validOrders.length === 0) { setDados([]); return; }

      const orderIds = validOrders.map((o: { id: string }) => o.id);
      const orderDateMap = new Map(
        (validOrders as Array<{ id: string; created_at: string }>).map((o) => [o.id, o.created_at])
      );

      // Passo 2: busca order_items desses pedidos
      const { data: salesRows } = await supabase
        .from('order_items')
        .select('item_id, item_price, quantity, order_id')
        .eq('tenant_id', user.tenantId)
        .in('order_id', orderIds);

      if (!salesRows || salesRows.length === 0) { setDados([]); return; }

      // Busca fichas técnicas de todos os itens únicos
      const itemIds = [...new Set((salesRows as Array<{ item_id: string | null }>)
        .map(r => r.item_id).filter(Boolean)
        .filter((id): id is string => !!id && /^[0-9a-f-]{36}$/i.test(id)))];

      const fichaMap = new Map<string, number>();
      if (itemIds.length > 0) {
        const { data: fichaRows } = await supabase
          .from('item_ingredients')
          .select('item_id, quantity, ingredients!inner(unit_price)')
          .in('item_id', itemIds)
          .eq('tenant_id', user.tenantId);

        for (const row of (fichaRows ?? []) as Array<{ item_id: string; quantity: number; ingredients: { unit_price: number } }>) {
          fichaMap.set(row.item_id, (fichaMap.get(row.item_id) ?? 0) + Number(row.quantity) * Number(row.ingredients?.unit_price ?? 0));
        }
      }

      // Agrega por mês
      const mesMap = new Map<string, { receita: number; custo: number }>();
      for (const row of salesRows as Array<{ item_id: string | null; item_price: number; quantity: number; order_id: string }>) {
        const createdAt = orderDateMap.get(row.order_id);
        if (!createdAt) continue;
        const date = new Date(createdAt);
        const mesKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        const qty = Number(row.quantity ?? 1);
        const price = Number(row.item_price ?? 0);
        const custo = (fichaMap.get(row.item_id ?? '') ?? 0) * qty;
        const prev = mesMap.get(mesKey) ?? { receita: 0, custo: 0 };
        mesMap.set(mesKey, { receita: prev.receita + price * qty, custo: prev.custo + custo });
      }

      const meses = Array.from(mesMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([mes, v]) => ({
          mes,
          receita: v.receita,
          custo: v.custo,
          cmv_pct: v.receita > 0 ? (v.custo / v.receita) * 100 : 0,
        }));

      setDados(meses);
    } catch (e) {
      console.error('[useCmvMensal]', e);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  useEffect(() => { load(); }, [load]);
  return { dados, loading };
}

// ── Gráfico CMV% Mensal ───────────────────────────────────────────────────────
function GraficoCmvMensal() {
  const { dados, loading } = useCmvMensal();

  if (loading) return (
    <div className="flex items-center justify-center py-8 gap-2 text-zinc-400">
      <i className="ri-loader-4-line animate-spin" />
      <span className="text-xs">Carregando histórico...</span>
    </div>
  );

  if (dados.length === 0) return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <i className="ri-bar-chart-line text-2xl text-zinc-300 block mb-2" />
      <p className="text-xs text-zinc-400">Sem dados históricos suficientes para o gráfico.</p>
    </div>
  );

  const maxCmv = Math.max(...dados.map(d => d.cmv_pct), 50);
  const CHART_H = 120;

  const mesLabel = (mes: string) => {
    const [y, m] = mes.split('-');
    const d = new Date(Number(y), Number(m) - 1, 1);
    return d.toLocaleDateString('pt-BR', { month: 'short' });
  };

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-bold text-zinc-800">Evolução do CMV % — últimos 12 meses</p>
          <p className="text-xs text-zinc-400 mt-0.5">Custo realizado sobre receita total por mês</p>
        </div>
        <div className="flex items-center gap-3 text-[10px] flex-wrap justify-end">
          <div className="flex items-center gap-1"><div className="w-3 h-1 rounded-full bg-emerald-500" /><span className="text-zinc-500">≤ 30%</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-1 rounded-full bg-amber-400" /><span className="text-zinc-500">31–38%</span></div>
          <div className="flex items-center gap-1"><div className="w-3 h-1 rounded-full bg-red-500" /><span className="text-zinc-500">&gt; 38%</span></div>
        </div>
      </div>

      {/* Linhas de referência */}
      <div className="relative" style={{ height: CHART_H + 32 }}>
        {/* Linhas horizontais de referência */}
        {[0, 25, 30, 38, 50].map(pct => {
          if (pct > maxCmv + 5) return null;
          const y = CHART_H - (pct / maxCmv) * CHART_H;
          return (
            <div key={pct} className="absolute left-0 right-0 flex items-center gap-1" style={{ top: y }}>
              <span className="text-[9px] text-zinc-400 w-7 text-right flex-shrink-0">{pct}%</span>
              <div className={`flex-1 border-t ${pct === 30 ? 'border-emerald-300 border-dashed' : pct === 38 ? 'border-red-300 border-dashed' : 'border-zinc-100'}`} />
            </div>
          );
        })}

        {/* Barras */}
        <div className="absolute left-8 right-0 top-0" style={{ height: CHART_H }}>
          <div className="flex items-end gap-1 h-full">
            {dados.map((d, i) => {
              const barH = Math.max((d.cmv_pct / maxCmv) * CHART_H, 4);
              const barColor = d.cmv_pct <= 30 ? 'bg-emerald-500' : d.cmv_pct <= 38 ? 'bg-amber-400' : 'bg-red-500';
              const isLast = i === dados.length - 1;
              return (
                <div key={d.mes} className="flex-1 flex flex-col items-center group relative">
                  {/* Tooltip */}
                  <div className="absolute bottom-full mb-1 hidden group-hover:flex flex-col items-center z-10 pointer-events-none">
                    <div className="bg-zinc-800 text-white text-[10px] rounded-lg px-2 py-1.5 whitespace-nowrap shadow-lg">
                      <p className="font-bold">{fmtPct(d.cmv_pct)}</p>
                      <p className="text-zinc-400">Receita: {fmt(d.receita)}</p>
                    </div>
                    <div className="w-2 h-2 bg-zinc-800 rotate-45 -mt-1" />
                  </div>
                  <div
                    className={`w-full rounded-t-md transition-all cursor-pointer ${barColor} ${isLast ? 'opacity-100' : 'opacity-80 hover:opacity-100'}`}
                    style={{ height: barH }}
                  />
                </div>
              );
            })}
          </div>
        </div>

        {/* Labels mês */}
        <div className="absolute left-8 right-0" style={{ top: CHART_H + 4 }}>
          <div className="flex gap-1">
            {dados.map(d => (
              <div key={d.mes} className="flex-1 text-center">
                <span className="text-[9px] text-zinc-400">{mesLabel(d.mes)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Linha de evolução textual */}
      {dados.length >= 2 && (() => {
        const first = dados[0].cmv_pct;
        const last = dados[dados.length - 1].cmv_pct;
        const delta = last - first;
        return (
          <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-1.5">
              {delta <= 0
                ? <i className="ri-arrow-down-line text-emerald-500 text-sm" />
                : <i className="ri-arrow-up-line text-red-500 text-sm" />}
              <span className={`text-xs font-bold ${delta <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                {delta <= 0 ? '' : '+'}{delta.toFixed(1)}pp
              </span>
              <span className="text-xs text-zinc-400">vs início do período</span>
            </div>
            <div className="flex items-center gap-1 ml-auto">
              <span className="text-[10px] text-zinc-400">Média:</span>
              <span className={`text-xs font-bold ${
                dados.reduce((s, d) => s + d.cmv_pct, 0) / dados.length <= 30
                  ? 'text-emerald-600'
                  : dados.reduce((s, d) => s + d.cmv_pct, 0) / dados.length <= 38
                    ? 'text-amber-600' : 'text-red-500'
              }`}>
                {fmtPct(dados.reduce((s, d) => s + d.cmv_pct, 0) / dados.length)}
              </span>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

const fmt = (v: number, _digits = 2) => formatCurrency(v);
const fmtPct = (v: number) => formatPercent(v);

type Ordenacao = 'cmv_desc' | 'cmv_asc' | 'margem_desc' | 'receita_desc' | 'nome';
type SubTab = 'teorico' | 'realizado';

const PERIODOS = [
  { key: 'Hoje', label: 'Hoje' },
  { key: '7d', label: '7 dias' },
  { key: '30d', label: '30 dias' },
  { key: 'Mês', label: 'Este mês' },
  { key: '3m', label: '3 meses' },
];

// ── CMV Teórico ───────────────────────────────────────────────────────────────

interface ItemCMVTeorico {
  id: string;
  nome: string;
  categoria: string;
  preco: number;
  custo: number;
  cmvPct: number;
  margemBruta: number;
  margemPct: number;
  temFicha: boolean;
}

function cmvColor(pct: number) {
  if (pct <= 25) return 'text-emerald-600 bg-emerald-50';
  if (pct <= 35) return 'text-amber-600 bg-amber-50';
  return 'text-red-600 bg-red-50';
}
function barCmvColor(pct: number) {
  if (pct <= 25) return 'bg-emerald-500';
  if (pct <= 35) return 'bg-amber-400';
  return 'bg-red-500';
}

function CmvTeorico() {
  const { itensAtivos, categorias, loading: loadingCardapio } = useCardapio();
  const { user } = useAuth();
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('cmv_desc');
  const [busca, setBusca] = useState('');
  const [fichaMap, setFichaMap] = useState<Map<string, number>>(new Map());
  const [loadingFicha, setLoadingFicha] = useState(false);

  // Busca fichas técnicas diretamente do banco via RPC (bypassa RLS de forma segura)
  const itemIdsKey = itensAtivos.map((i) => i.id).sort().join(',');
  useEffect(() => {
    if (!user?.tenantId || !itemIdsKey) return;
    const itemIds = itemIdsKey.split(',').filter((id) => /^[0-9a-f-]{36}$/i.test(id));
    if (itemIds.length === 0) return;
    setLoadingFicha(true);
    supabase
      .rpc('fn_get_item_ingredients_batch', {
        p_tenant_id: user.tenantId,
        p_item_ids: itemIds,
      })
      .then(({ data: rows, error }) => {
        if (error) {
          console.error('[CmvTeorico] fn_get_item_ingredients_batch error:', error);
          // Fallback: query direta
          return supabase
            .from('item_ingredients')
            .select('item_id, quantity, ingredients!inner(unit_price)')
            .in('item_id', itemIds)
            .eq('tenant_id', user.tenantId);
        }
        return { data: rows, error: null };
      })
      .then((result) => {
        const map = new Map<string, number>();
        // A RPC retorna { item_id, ingredient_id, quantity, unit_price } (flat)
        // O fallback (query direta) retorna { item_id, quantity, ingredients: { unit_price } } (nested)
        for (const row of ((result as { data: unknown[] | null }).data ?? []) as Array<{
          item_id: string;
          quantity: number;
          unit_price?: number;
          ingredients?: { unit_price: number } | null;
        }>) {
          // Aceita ambos os formatos: flat (RPC) e nested (query direta)
          const cost = Number(row.unit_price ?? row.ingredients?.unit_price ?? 0);
          map.set(row.item_id, (map.get(row.item_id) ?? 0) + Number(row.quantity) * cost);
        }
        setFichaMap(map);
      })
      .finally(() => setLoadingFicha(false));
  }, [user?.tenantId, itemIdsKey]);

  const loading = loadingCardapio || loadingFicha;

  const itensCMV: ItemCMVTeorico[] = useMemo(() => {
    return itensAtivos.map((item) => {
      const custo = fichaMap.get(item.id) ?? 0;
      const temFicha = fichaMap.has(item.id);
      const cmvPct = item.preco > 0 && temFicha ? (custo / item.preco) * 100 : 0;
      const margemBruta = item.preco - custo;
      const margemPct = item.preco > 0 ? (margemBruta / item.preco) * 100 : 0;
      const catNome = categorias.find((c) => c.id === item.categoriaId)?.nome ?? item.categoriaId;
      return { id: item.id, nome: item.nome, categoria: catNome, preco: item.preco, custo, cmvPct, margemBruta, margemPct, temFicha };
    });
  }, [itensAtivos, categorias, fichaMap]);

  const itensFiltrados = useMemo(() => {
    const base = busca ? itensCMV.filter((i) => i.nome.toLowerCase().includes(busca.toLowerCase())) : itensCMV;
    return [...base].sort((a, b) => {
      if (ordenacao === 'cmv_desc') return b.cmvPct - a.cmvPct;
      if (ordenacao === 'cmv_asc') return a.cmvPct - b.cmvPct;
      if (ordenacao === 'margem_desc') return b.margemPct - a.margemPct;
      return a.nome.localeCompare(b.nome);
    });
  }, [itensCMV, busca, ordenacao]);

  const comFicha = itensCMV.filter((i) => i.temFicha);
  const avgCMV = comFicha.length > 0 ? comFicha.reduce((s, i) => s + i.cmvPct, 0) / comFicha.length : 0;
  const melhorMargem = comFicha.length > 0 ? comFicha.reduce((m, i) => (i.margemPct > m.margemPct ? i : m)) : null;
  const piorCMV = comFicha.length > 0 ? comFicha.reduce((m, i) => (i.cmvPct > m.cmvPct ? i : m)) : null;

  if (loading) return <div className="flex items-center justify-center py-16"><div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" /></div>;
  if (itensAtivos.length === 0) return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <i className="ri-pie-chart-2-line text-4xl text-zinc-300 block mb-3" />
      <p className="text-sm font-semibold text-zinc-500 mb-1">Nenhum item no cardápio</p>
      <p className="text-xs text-zinc-400">Cadastre itens no cardápio para calcular CMV.</p>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* Resumo */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">CMV Médio Teórico</p>
          <p className={`text-2xl font-black ${avgCMV <= 30 ? 'text-emerald-600' : avgCMV <= 38 ? 'text-amber-600' : 'text-red-500'}`}>{fmtPct(avgCMV)}</p>
          <p className="text-[10px] text-zinc-400 mt-1">{comFicha.length} de {itensCMV.length} itens com ficha</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Melhor Margem</p>
          {melhorMargem ? (<><p className="text-2xl font-black text-emerald-600">{fmtPct(melhorMargem.margemPct)}</p><p className="text-[10px] text-zinc-500 mt-1 truncate">{melhorMargem.nome}</p></>) : <p className="text-sm text-zinc-400">—</p>}
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs text-zinc-500 mb-1">Maior CMV (atenção)</p>
          {piorCMV ? (<><p className="text-2xl font-black text-red-500">{fmtPct(piorCMV.cmvPct)}</p><p className="text-[10px] text-zinc-500 mt-1 truncate">{piorCMV.nome}</p></>) : <p className="text-sm text-zinc-400">—</p>}
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-4 text-xs flex-wrap">
        <span className="text-zinc-400 font-semibold">CMV ideal:</span>
        {[['bg-emerald-500', '≤ 25% — Excelente'], ['bg-amber-400', '26–35% — Aceitável'], ['bg-red-500', '> 35% — Revisar']].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5"><div className={`w-3 h-3 rounded-full ${c}`} /><span className="text-zinc-500">{l}</span></div>
        ))}
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
          <i className="ri-search-line text-zinc-400 text-sm" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item..." className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
        </div>
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
          {([
            { id: 'cmv_desc', label: 'Maior CMV' },
            { id: 'cmv_asc', label: 'Menor CMV' },
            { id: 'margem_desc', label: 'Maior Margem' },
            { id: 'nome', label: 'Nome' },
          ] as { id: Ordenacao; label: string }[]).map((op) => (
            <button key={op.id} onClick={() => setOrdenacao(op.id)}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${ordenacao === op.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'}`}>
              {op.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        {/* Desktop */}
        <div className="hidden md:block overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500">Item</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Preço Venda</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Custo</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">CMV %</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Margem Bruta</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">Margem %</th>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500">Barra CMV</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {itensFiltrados.map((item) => (
                <tr key={item.id} className="hover:bg-zinc-50 transition-colors">
                  <td className="px-4 py-3">
                    <p className="font-medium text-zinc-800">{item.nome}</p>
                    {!item.temFicha && <p className="text-[10px] text-zinc-400 italic">Sem ficha técnica</p>}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-800">{fmt(item.preco)}</td>
                  <td className="px-4 py-3 text-right text-zinc-600">{item.temFicha ? fmt(item.custo) : <span className="text-zinc-300">—</span>}</td>
                  <td className="px-4 py-3 text-center">
                    {item.temFicha ? <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${cmvColor(item.cmvPct)}`}>{fmtPct(item.cmvPct)}</span> : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {item.temFicha ? <span className={`font-bold ${item.margemBruta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{fmt(item.margemBruta)}</span> : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.temFicha ? <span className="font-semibold text-zinc-700">{fmtPct(item.margemPct)}</span> : <span className="text-zinc-300">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {item.temFicha ? (
                      <div className="w-28 h-2 bg-zinc-100 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full transition-all ${barCmvColor(item.cmvPct)}`} style={{ width: `${Math.min(item.cmvPct, 100)}%` }} />
                      </div>
                    ) : <span className="text-zinc-300 text-[10px]">sem dados</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {/* Mobile cards */}
        <div className="md:hidden divide-y divide-zinc-50">
          {itensFiltrados.map((item) => (
            <div key={item.id} className="p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-zinc-800 truncate">{item.nome}</p>
                  {!item.temFicha && <p className="text-[10px] text-zinc-400 italic">Sem ficha técnica</p>}
                </div>
                {item.temFicha ? (
                  <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${cmvColor(item.cmvPct)}`}>{fmtPct(item.cmvPct)}</span>
                ) : <span className="text-zinc-300 text-[10px]">—</span>}
              </div>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-[10px] text-zinc-400">Preço</p>
                  <p className="text-xs font-bold text-zinc-800">{fmt(item.preco)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400">Custo</p>
                  <p className="text-xs font-bold text-zinc-700">{item.temFicha ? fmt(item.custo) : '—'}</p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-400">Margem</p>
                  <p className={`text-xs font-bold ${item.temFicha ? (item.margemBruta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-zinc-300'}`}>
                    {item.temFicha ? fmt(item.margemBruta) : '—'}
                  </p>
                </div>
              </div>
              {item.temFicha && (
                <div className="mt-2">
                  <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${barCmvColor(item.cmvPct)}`} style={{ width: `${Math.min(item.cmvPct, 100)}%` }} />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
      {itensFiltrados.length === 0 && <div className="text-center py-10"><i className="ri-search-line text-3xl text-zinc-300 block mb-2" /><p className="text-sm text-zinc-400">Nenhum item encontrado</p></div>}
    </div>
  );
}

// ── CMV Realizado ─────────────────────────────────────────────────────────────

function CmvRealizado() {
  const { data, loading, load } = useCmvReport();
  const [periodo, setPeriodo] = useState('30d');
  const [customDe, setCustomDe] = useState('');
  const [customAte, setCustomAte] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const [ordenacao, setOrdenacao] = useState<Ordenacao>('receita_desc');
  const [busca, setBusca] = useState('');

  useEffect(() => { load(periodo); }, [periodo, load]); // eslint-disable-line

  const aplicarCustom = () => {
    if (!customDe || !customAte) return;
    const p = `custom:${customDe}:${customAte}`;
    setPeriodo(p);
    setShowCustom(false);
    load(p);
  };

  const exportarCSV = () => {
    if (!data || itensFiltrados.length === 0) return;
    const headers = ['Item', 'Categoria', 'Qtd Vendida', 'Receita (R$)', 'Custo Total (R$)', 'CMV %', 'Margem R$', 'Margem %', 'Tem Ficha'];
    const rows = itensFiltrados.map((i) => [
      i.item_name,
      i.categoria || '',
      i.qtd_vendida,
      i.receita_total.toFixed(2).replace('.', ','),
      i.custo_total.toFixed(2).replace('.', ','),
      i.cmv_pct.toFixed(1).replace('.', ','),
      i.margem_bruta.toFixed(2).replace('.', ','),
      i.margem_pct.toFixed(1).replace('.', ','),
      i.tem_ficha ? 'Sim' : 'Não',
    ]);
    const rodape = [
      'TOTAL', '', comFicha.reduce((s, i) => s + i.qtd_vendida, 0),
      data.receita_total.toFixed(2).replace('.', ','),
      data.custo_total.toFixed(2).replace('.', ','),
      data.cmv_pct_geral.toFixed(1).replace('.', ','),
      data.margem_bruta_total.toFixed(2).replace('.', ','),
      data.receita_total > 0 ? ((data.margem_bruta_total / data.receita_total) * 100).toFixed(1).replace('.', ',') : '0',
      '',
    ];
    const csv = [headers, ...rows, rodape].map((r) => r.join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cmv_realizado_${data.periodo_de}_${data.periodo_ate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const itensFiltrados = useMemo(() => {
    if (!data?.itens) return [];
    const base = busca ? data.itens.filter((i) => i.item_name.toLowerCase().includes(busca.toLowerCase())) : data.itens;
    return [...base].sort((a, b) => {
      if (ordenacao === 'cmv_desc') return b.cmv_pct - a.cmv_pct;
      if (ordenacao === 'cmv_asc') return a.cmv_pct - b.cmv_pct;
      if (ordenacao === 'margem_desc') return b.margem_pct - a.margem_pct;
      if (ordenacao === 'receita_desc') return b.receita_total - a.receita_total;
      return a.item_name.localeCompare(b.item_name);
    });
  }, [data?.itens, busca, ordenacao]);

  const comFicha = itensFiltrados.filter((i) => i.tem_ficha);
  const semFicha = itensFiltrados.filter((i) => !i.tem_ficha);

  return (
    <div className="space-y-5">
      {/* Seletor de período */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1">
          {PERIODOS.map((p) => (
            <button key={p.key} onClick={() => { setPeriodo(p.key); setShowCustom(false); }}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                periodo === p.key ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}>
              {p.label}
            </button>
          ))}
          <button onClick={() => setShowCustom((v) => !v)}
            className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
              periodo.startsWith('custom:') ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
            }`}>
            <i className="ri-calendar-line" /> Período
          </button>
        </div>
        {showCustom && (
          <div className="flex items-center gap-2">
            <input type="date" value={customDe} onChange={(e) => setCustomDe(e.target.value)}
              className="text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400" />
            <span className="text-xs text-zinc-400">até</span>
            <input type="date" value={customAte} onChange={(e) => setCustomAte(e.target.value)}
              className="text-xs border border-zinc-200 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-amber-400" />
            <button onClick={aplicarCustom} disabled={!customDe || !customAte}
              className="px-3 py-1.5 bg-amber-500 text-white text-xs font-semibold rounded-lg hover:bg-amber-600 disabled:opacity-40 cursor-pointer whitespace-nowrap">
              Aplicar
            </button>
          </div>
        )}
        <button onClick={() => load(periodo)} className="w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors" title="Atualizar">
          <i className={`ri-refresh-line text-base ${loading ? 'animate-spin' : ''}`} />
        </button>
        {data && data.itens.length > 0 && (
          <button
            onClick={exportarCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-100 text-zinc-600 text-xs font-semibold rounded-lg hover:bg-zinc-200 transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-download-line text-sm" /> Exportar CSV
          </button>
        )}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-16 gap-2 text-zinc-400">
          <i className="ri-loader-4-line animate-spin text-xl" />
          <span className="text-sm">Calculando CMV realizado...</span>
        </div>
      )}

      {!loading && data && (
        <>
          {/* Cards resumo */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-white border border-zinc-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Receita do Período</p>
              <p className="text-xl font-black text-zinc-800">{fmt(data.receita_total)}</p>
              <p className="text-[10px] text-zinc-400 mt-1">{data.itens.length} itens vendidos</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Custo Total (CMV)</p>
              <p className="text-xl font-black text-zinc-800">{fmt(data.custo_total)}</p>
              <p className="text-[10px] text-zinc-400 mt-1">{comFicha.length} itens com ficha técnica</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">CMV % Realizado</p>
              <p className={`text-xl font-black ${data.cmv_pct_geral <= 30 ? 'text-emerald-600' : data.cmv_pct_geral <= 38 ? 'text-amber-600' : 'text-red-500'}`}>
                {data.receita_total > 0 ? fmtPct(data.cmv_pct_geral) : '—'}
              </p>
              <p className="text-[10px] text-zinc-400 mt-1">custo / receita total</p>
            </div>
            <div className="bg-white border border-zinc-100 rounded-xl p-4">
              <p className="text-xs text-zinc-500 mb-1">Margem Bruta</p>
              <p className={`text-xl font-black ${data.margem_bruta_total >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                {fmt(data.margem_bruta_total)}
              </p>
              <p className="text-[10px] text-zinc-400 mt-1">receita − custo direto</p>
            </div>
          </div>

          {/* Gráfico de evolução mensal */}
          <GraficoCmvMensal />

          {/* Aviso sem ficha */}
          {semFicha.length > 0 && (
            <div className="flex items-start gap-2.5 px-3 py-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <i className="ri-error-warning-line text-amber-500 text-sm flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700">
                <strong>{semFicha.length} item{semFicha.length > 1 ? 's' : ''}</strong> sem ficha técnica — o custo destes itens não está sendo contabilizado no CMV. Configure fichas técnicas para maior precisão.
              </p>
            </div>
          )}

          {data.itens.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-zinc-100 rounded-xl">
              <i className="ri-bar-chart-grouped-line text-4xl text-zinc-300 block mb-3" />
              <p className="text-sm font-semibold text-zinc-500 mb-1">Sem vendas no período</p>
              <p className="text-xs text-zinc-400">Selecione outro período para visualizar o CMV realizado.</p>
            </div>
          ) : (
            <>
              {/* Filtros tabela */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2 bg-white border border-zinc-200 rounded-lg px-3 py-2">
                  <i className="ri-search-line text-zinc-400 text-sm" />
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar item vendido..." className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none" />
                </div>
                <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto">
                  {([
                    { id: 'receita_desc', label: 'Mais Vendidos' },
                    { id: 'cmv_desc', label: 'Maior CMV' },
                    { id: 'cmv_asc', label: 'Menor CMV' },
                    { id: 'margem_desc', label: 'Maior Margem' },
                    { id: 'nome', label: 'Nome' },
                  ] as { id: Ordenacao; label: string }[]).map((op) => (
                    <button key={op.id} onClick={() => setOrdenacao(op.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${
                        ordenacao === op.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                      }`}>
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tabela realizado */}
              <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
                {/* Desktop */}
                <div className="hidden md:block overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                  <table className="w-full text-xs">
                    <thead className="bg-zinc-50 border-b border-zinc-100">
                      <tr>
                        <th className="px-4 py-3 text-left font-semibold text-zinc-500">Item</th>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500">Qtd Vendida</th>
                        <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita</th>
                        <th className="px-4 py-3 text-right font-semibold text-zinc-500">Custo Total</th>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500">CMV %</th>
                        <th className="px-4 py-3 text-right font-semibold text-zinc-500">Margem R$</th>
                        <th className="px-4 py-3 text-center font-semibold text-zinc-500">Margem %</th>
                        <th className="px-4 py-3 text-left font-semibold text-zinc-500 w-28">Barra</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-50">
                      {itensFiltrados.map((item) => (
                        <tr key={item.item_id || item.item_name} className="hover:bg-zinc-50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-zinc-800 truncate max-w-[180px]">{item.item_name}</p>
                            {item.categoria && <p className="text-[10px] text-zinc-400">{item.categoria}</p>}
                            {!item.tem_ficha && <p className="text-[10px] text-amber-500 italic">Sem ficha técnica</p>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className="font-semibold text-zinc-700">{item.qtd_vendida}</span>
                          </td>
                          <td className="px-4 py-3 text-right font-semibold text-zinc-800">{fmt(item.receita_total)}</td>
                          <td className="px-4 py-3 text-right text-zinc-600">
                            {item.tem_ficha ? fmt(item.custo_total) : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.tem_ficha ? (
                              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${cmvColor(item.cmv_pct)}`}>
                                {fmtPct(item.cmv_pct)}
                              </span>
                            ) : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {item.tem_ficha ? (
                              <span className={`font-bold ${item.margem_bruta >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                {fmt(item.margem_bruta)}
                              </span>
                            ) : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-4 py-3 text-center">
                            {item.tem_ficha ? <span className="font-semibold text-zinc-700">{fmtPct(item.margem_pct)}</span> : <span className="text-zinc-300">—</span>}
                          </td>
                          <td className="px-4 py-3">
                            {item.tem_ficha ? (
                              <div className="w-20 h-2 bg-zinc-100 rounded-full overflow-hidden">
                                <div className={`h-full rounded-full ${barCmvColor(item.cmv_pct)}`} style={{ width: `${Math.min(item.cmv_pct, 100)}%` }} />
                              </div>
                            ) : <span className="text-zinc-300 text-[10px]">—</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    {/* Totais */}
                    {comFicha.length > 0 && (
                      <tfoot>
                        <tr className="border-t-2 border-zinc-200 bg-amber-50">
                          <td className="px-4 py-3 font-bold text-zinc-700 text-xs">
                            Total ({comFicha.length} itens c/ ficha)
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-zinc-700">
                            {comFicha.reduce((s, i) => s + i.qtd_vendida, 0)}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-zinc-800">
                            {fmt(comFicha.reduce((s, i) => s + i.receita_total, 0))}
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-zinc-800">
                            {fmt(comFicha.reduce((s, i) => s + i.custo_total, 0))}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${cmvColor(data.cmv_pct_geral)}`}>
                              {fmtPct(data.cmv_pct_geral)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right font-bold text-emerald-700">
                            {fmt(data.margem_bruta_total)}
                          </td>
                          <td className="px-4 py-3 text-center font-bold text-zinc-700">
                            {data.receita_total > 0 ? fmtPct((data.margem_bruta_total / data.receita_total) * 100) : '—'}
                          </td>
                          <td />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
                {/* Mobile cards */}
                <div className="md:hidden divide-y divide-zinc-50">
                  {itensFiltrados.map((item) => (
                    <div key={item.item_id || item.item_name} className="p-3">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-zinc-800 truncate">{item.item_name}</p>
                          {item.categoria && <p className="text-[10px] text-zinc-400">{item.categoria}</p>}
                          {!item.tem_ficha && <p className="text-[10px] text-amber-500 italic">Sem ficha técnica</p>}
                        </div>
                        {item.tem_ficha ? (
                          <span className={`flex-shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold ${cmvColor(item.cmv_pct)}`}>{fmtPct(item.cmv_pct)}</span>
                        ) : <span className="text-zinc-300 text-[10px]">—</span>}
                      </div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div>
                          <p className="text-[10px] text-zinc-400">Receita</p>
                          <p className="text-xs font-bold text-zinc-800">{fmt(item.receita_total)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400">Custo</p>
                          <p className="text-xs font-bold text-zinc-700">{item.tem_ficha ? fmt(item.custo_total) : '—'}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400">Margem</p>
                          <p className={`text-xs font-bold ${item.tem_ficha ? (item.margem_bruta >= 0 ? 'text-emerald-600' : 'text-red-500') : 'text-zinc-300'}`}>
                            {item.tem_ficha ? fmt(item.margem_bruta) : '—'}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400">Qtd vendida</p>
                          <p className="text-xs font-bold text-zinc-700">{item.qtd_vendida}</p>
                        </div>
                      </div>
                      {item.tem_ficha && (
                        <div className="w-full h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${barCmvColor(item.cmv_pct)}`} style={{ width: `${Math.min(item.cmv_pct, 100)}%` }} />
                        </div>
                      )}
                    </div>
                  ))}
                  {/* Mobile total footer */}
                  {comFicha.length > 0 && (
                    <div className="p-3 bg-amber-50 border-t-2 border-zinc-200">
                      <p className="text-xs font-bold text-zinc-700 mb-2">Total — {comFicha.length} itens c/ ficha</p>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <p className="text-[10px] text-zinc-400">Receita total</p>
                          <p className="text-xs font-bold text-zinc-800">{fmt(comFicha.reduce((s, i) => s + i.receita_total, 0))}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400">CMV geral</p>
                          <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${cmvColor(data.cmv_pct_geral)}`}>
                            {fmtPct(data.cmv_pct_geral)}
                          </span>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400">Margem bruta</p>
                          <p className="text-xs font-bold text-emerald-700">{fmt(data.margem_bruta_total)}</p>
                        </div>
                        <div>
                          <p className="text-[10px] text-zinc-400">Qtd total</p>
                          <p className="text-xs font-bold text-zinc-700">{comFicha.reduce((s, i) => s + i.qtd_vendida, 0)}</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </>
      )}

      {!loading && !data && (
        <div className="flex flex-col items-center justify-center py-16 text-center bg-white border border-zinc-100 rounded-xl">
          <i className="ri-bar-chart-grouped-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-sm font-semibold text-zinc-500">Selecione um período para calcular o CMV realizado</p>
        </div>
      )}
    </div>
  );
}

// ── Tab principal ─────────────────────────────────────────────────────────────

export default function CmvTab() {
  const [subTab, setSubTab] = useState<SubTab>('realizado');

  return (
    <div className="space-y-4">
      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-zinc-100 rounded-xl p-1 w-fit">
        <button
          onClick={() => setSubTab('realizado')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            subTab === 'realizado' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <i className="ri-bar-chart-grouped-line mr-1.5" />
          CMV Realizado
        </button>
        <button
          onClick={() => setSubTab('teorico')}
          className={`px-4 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer whitespace-nowrap ${
            subTab === 'teorico' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
          }`}
        >
          <i className="ri-test-tube-line mr-1.5" />
          CMV Teórico
        </button>
      </div>

      {/* Descrição do modo */}
      <div className="flex items-start gap-2.5 px-3 py-2 bg-zinc-50 border border-zinc-100 rounded-xl">
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i className={`text-sm ${subTab === 'realizado' ? 'ri-bar-chart-grouped-line text-amber-500' : 'ri-test-tube-line text-zinc-400'}`} />
        </div>
        <p className="text-xs text-zinc-500">
          {subTab === 'realizado'
            ? 'CMV Realizado cruza os pedidos do período com as fichas técnicas — mostra o custo real de tudo que foi vendido.'
            : 'CMV Teórico mostra o custo por unidade de cada item do cardápio, independente do volume vendido.'}
        </p>
      </div>

      {subTab === 'teorico' && <CmvTeorico />}
      {subTab === 'realizado' && <CmvRealizado />}
    </div>
  );
}

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from 'recharts';
import { useCmvRelatorio } from '@/hooks/useCmvRelatorio';

interface Props { periodo: string; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

function labelPeriodo(periodo: string): string {
  if (periodo.startsWith('custom:')) {
    const [, s, e] = periodo.split(':');
    const f = (d: string) => { const [y, m, dia] = d.split('-'); return `${dia}/${m}/${y}`; };
    return s === e ? f(s) : `${f(s)} → ${f(e)}`;
  }
  return periodo;
}

// Cor baseada no CMV%: verde < 30%, amarelo 30-45%, vermelho > 45%
function cmvColor(pct: number): string {
  if (pct === 0) return '#d4d4d8'; // sem ficha
  if (pct <= 30) return '#10b981';
  if (pct <= 45) return '#f59e0b';
  return '#ef4444';
}

function cmvLabel(pct: number): { text: string; cls: string } {
  if (pct === 0) return { text: 'Sem ficha', cls: 'bg-zinc-100 text-zinc-400' };
  if (pct <= 30) return { text: 'Ótimo', cls: 'bg-emerald-100 text-emerald-700' };
  if (pct <= 45) return { text: 'Atenção', cls: 'bg-amber-100 text-amber-700' };
  return { text: 'Alto', cls: 'bg-red-100 text-red-700' };
}

export default function CMVTab({ periodo }: Props) {
  const { data, loading } = useCmvRelatorio(periodo);
  const [sortBy, setSortBy] = useState<'receita' | 'cmv' | 'margem'>('receita');
  const [filtro, setFiltro] = useState<'todos' | 'com_ficha' | 'sem_ficha'>('todos');

  const itens = useMemo(() => {
    let lista = [...data.por_item];
    if (filtro === 'com_ficha') lista = lista.filter(i => i.tem_ficha_tecnica);
    if (filtro === 'sem_ficha') lista = lista.filter(i => !i.tem_ficha_tecnica);
    if (sortBy === 'receita') lista.sort((a, b) => b.receita_total - a.receita_total);
    if (sortBy === 'cmv') lista.sort((a, b) => b.cmv_pct - a.cmv_pct);
    if (sortBy === 'margem') lista.sort((a, b) => b.margem_bruta - a.margem_bruta);
    return lista;
  }, [data.por_item, sortBy, filtro]);

  const itensCom = data.por_item.filter(i => i.tem_ficha_tecnica);
  // receita_total agora vem de orders.total_amount (mesma base da Visão Geral)
  const totalReceita = data.resumo.receita_total;
  const totalCusto = itensCom.reduce((s, i) => s + i.custo_total, 0);
  const totalMargem = itensCom.reduce((s, i) => s + i.margem_bruta, 0);
  // CMV geral: custo sobre a receita total dos pedidos (não só itens com ficha)
  // isso dá uma visão mais real do impacto do custo no faturamento total
  const receitaItensCom = itensCom.reduce((s, i) => s + i.receita_total, 0);
  const cmvGeral = receitaItensCom > 0 ? (totalCusto / receitaItensCom) * 100 : 0;

  // Top 10 para gráfico
  const top10 = useMemo(() => {
    return [...itensCom]
      .sort((a, b) => b.receita_total - a.receita_total)
      .slice(0, 10)
      .map(i => ({
        nome: i.item_name.length > 20 ? i.item_name.slice(0, 20) + '…' : i.item_name,
        receita: i.receita_total,
        custo: i.custo_total,
        margem: i.margem_bruta,
        cmv: i.cmv_pct,
      }));
  }, [itensCom]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-zinc-400">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mr-3" />
        <span className="text-sm">Calculando CMV...</span>
      </div>
    );
  }

  if (data.por_item.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-scales-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum pedido no período</p>
        <p className="text-xs text-zinc-400 mt-1">Período: <strong>{labelPeriodo(periodo)}</strong></p>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Banner de cobertura */}
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${
        data.resumo.cobertura_pct >= 80
          ? 'bg-emerald-50 border-emerald-100'
          : data.resumo.cobertura_pct >= 50
          ? 'bg-amber-50 border-amber-100'
          : 'bg-red-50 border-red-100'
      }`}>
        <i className={`ri-pie-chart-line text-sm flex-shrink-0 ${
          data.resumo.cobertura_pct >= 80 ? 'text-emerald-600'
          : data.resumo.cobertura_pct >= 50 ? 'text-amber-600'
          : 'text-red-500'
        }`} />
        <div className="flex-1 min-w-0">
          <p className={`text-xs font-semibold ${
            data.resumo.cobertura_pct >= 80 ? 'text-emerald-700'
            : data.resumo.cobertura_pct >= 50 ? 'text-amber-700'
            : 'text-red-700'
          }`}>
            Cobertura de fichas técnicas: <strong>{data.resumo.cobertura_pct}%</strong>
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">
            {data.resumo.itens_com_ficha} de {data.resumo.itens_com_ficha + data.resumo.itens_sem_ficha} itens vendidos têm ficha técnica cadastrada.
            {data.resumo.itens_sem_ficha > 0 && (
              <span className="text-amber-600 font-medium"> Cadastre as fichas dos {data.resumo.itens_sem_ficha} itens restantes para calcular o CMV completo.</span>
            )}
          </p>
        </div>
        <span className={`text-lg font-black flex-shrink-0 ${
          data.resumo.cobertura_pct >= 80 ? 'text-emerald-600'
          : data.resumo.cobertura_pct >= 50 ? 'text-amber-600'
          : 'text-red-500'
        }`}>{data.resumo.cobertura_pct}%</span>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-zinc-900">{fmt(totalReceita)}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Receita total</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">Período: {labelPeriodo(periodo)}</p>
        </div>
        <div className={`bg-white border rounded-xl p-4 text-center ${
          cmvGeral > 0 && cmvGeral <= 30 ? 'border-emerald-200'
          : cmvGeral > 30 && cmvGeral <= 45 ? 'border-amber-200'
          : cmvGeral > 45 ? 'border-red-200'
          : 'border-zinc-100'
        }`}>
          <p className={`text-xl font-black ${
            cmvGeral === 0 ? 'text-zinc-400'
            : cmvGeral <= 30 ? 'text-emerald-600'
            : cmvGeral <= 45 ? 'text-amber-600'
            : 'text-red-600'
          }`}>
            {cmvGeral > 0 ? `${cmvGeral.toFixed(1)}%` : '—'}
          </p>
          <p className="text-xs text-zinc-500 mt-0.5">CMV geral</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">Itens com ficha técnica</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-red-600">{totalCusto > 0 ? fmt(totalCusto) : '—'}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Custo total (CMV)</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{itensCom.length} itens calculados</p>
        </div>
        <div className="bg-white border border-emerald-100 rounded-xl p-4 text-center">
          <p className="text-xl font-black text-emerald-600">{totalMargem > 0 ? fmt(totalMargem) : '—'}</p>
          <p className="text-xs text-zinc-500 mt-0.5">Margem bruta</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">
            {totalReceita > 0 && totalMargem > 0
              ? `${((totalMargem / totalReceita) * 100).toFixed(1)}% da receita`
              : 'Cadastre fichas técnicas'}
          </p>
        </div>
      </div>

      {/* Referência de CMV */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {[
          { label: 'Ótimo', range: 'CMV ≤ 30%', color: 'bg-emerald-50 border-emerald-100 text-emerald-700', dot: 'bg-emerald-500' },
          { label: 'Atenção', range: 'CMV 30–45%', color: 'bg-amber-50 border-amber-100 text-amber-700', dot: 'bg-amber-400' },
          { label: 'Alto', range: 'CMV > 45%', color: 'bg-red-50 border-red-100 text-red-700', dot: 'bg-red-500' },
        ].map(r => (
          <div key={r.label} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${r.color}`}>
            <div className={`w-2 h-2 rounded-full flex-shrink-0 ${r.dot}`} />
            <div>
              <p className="text-xs font-bold">{r.label}</p>
              <p className="text-[10px] opacity-80">{r.range}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Gráfico receita vs custo */}
      {top10.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Receita vs Custo — Top 10 Itens</h3>
            <p className="text-xs text-zinc-400">Apenas itens com ficha técnica cadastrada</p>
          </div>
          <div style={{ height: Math.max(200, top10.length * 36) }}>
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
                  tickFormatter={v => v >= 1000 ? `R$${(v / 1000).toFixed(0)}k` : `R$${v}`}
                />
                <YAxis
                  type="category"
                  dataKey="nome"
                  tick={{ fontSize: 10, fill: '#52525b' }}
                  axisLine={false}
                  tickLine={false}
                  width={120}
                />
                <Tooltip
                  formatter={(val: number, name: string) => [
                    fmt(val),
                    name === 'receita' ? 'Receita' : name === 'custo' ? 'Custo (CMV)' : 'Margem',
                  ]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                />
                <Bar dataKey="receita" fill="#f59e0b" radius={[0, 4, 4, 0]} maxBarSize={16} name="receita" />
                <Bar dataKey="custo" fill="#ef4444" radius={[0, 4, 4, 0]} maxBarSize={16} name="custo" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tabela detalhada */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        {/* Controles */}
        <div className="px-4 py-3 border-b border-zinc-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto scrollbar-hide">
            {([
              { id: 'todos', label: `Todos (${data.por_item.length})` },
              { id: 'com_ficha', label: `Com ficha (${data.resumo.itens_com_ficha})` },
              { id: 'sem_ficha', label: `Sem ficha (${data.resumo.itens_sem_ficha})` },
            ] as { id: typeof filtro; label: string }[]).map(f => (
              <button
                key={f.id}
                onClick={() => setFiltro(f.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                  filtro === f.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto scrollbar-hide">
            {([
              { id: 'receita', label: 'Por Receita' },
              { id: 'cmv', label: 'Por CMV%' },
              { id: 'margem', label: 'Por Margem' },
            ] as { id: typeof sortBy; label: string }[]).map(s => (
              <button
                key={s.id}
                onClick={() => setSortBy(s.id)}
                className={`px-3 py-1 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                  sortBy === s.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {itens.length === 0 ? (
          <div className="py-12 text-center text-zinc-400 text-sm">Nenhum item encontrado</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Item</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Categoria</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Qtd.</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Custo (CMV)</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">CMV%</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Margem Bruta</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {itens.map((item) => {
                  const { text, cls } = cmvLabel(item.cmv_pct);
                  const cor = cmvColor(item.cmv_pct);
                  return (
                    <tr key={item.item_name} className="hover:bg-zinc-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          {!item.tem_ficha_tecnica && (
                            <i className="ri-alert-line text-amber-400 text-xs flex-shrink-0" title="Sem ficha técnica" />
                          )}
                          <span className="font-medium text-zinc-800 truncate max-w-[160px]">{item.item_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-[10px] px-2 py-0.5 bg-zinc-100 text-zinc-500 rounded-full">{item.category_name}</span>
                      </td>
                      <td className="px-4 py-3 text-center font-semibold text-zinc-700">{item.total_qty}</td>
                      <td className="px-4 py-3 text-right font-bold text-zinc-900">{fmt(item.receita_total)}</td>
                      <td className="px-4 py-3 text-right">
                        {item.tem_ficha_tecnica
                          ? <span className="font-semibold text-red-600">{fmt(item.custo_total)}</span>
                          : <span className="text-zinc-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        {item.tem_ficha_tecnica ? (
                          <div className="flex items-center gap-1.5 justify-center">
                            <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full"
                                style={{ width: `${Math.min(item.cmv_pct, 100)}%`, backgroundColor: cor }}
                              />
                            </div>
                            <span className="font-bold w-10 text-right" style={{ color: cor }}>
                              {item.cmv_pct.toFixed(1)}%
                            </span>
                          </div>
                        ) : (
                          <span className="text-zinc-300 text-[10px]">Sem ficha</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {item.tem_ficha_tecnica
                          ? <span className={`font-bold ${item.margem_bruta >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{fmt(item.margem_bruta)}</span>
                          : <span className="text-zinc-300">—</span>
                        }
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cls}`}>{text}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              {itensCom.length > 0 && (
                <tfoot className="border-t-2 border-zinc-200">
                  <tr>
                    <td colSpan={3} className="px-4 py-3 font-bold text-zinc-700">
                      Total ({itensCom.length} itens com ficha)
                    </td>
                    <td className="px-4 py-3 text-right font-black text-zinc-900">{fmt(receitaItensCom)}</td>
                    <td className="px-4 py-3 text-right font-black text-red-600">{fmt(totalCusto)}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-black text-sm ${cmvGeral <= 30 ? 'text-emerald-600' : cmvGeral <= 45 ? 'text-amber-600' : 'text-red-600'}`}>
                        {cmvGeral.toFixed(1)}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-black text-emerald-600">{fmt(totalMargem)}</td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </div>

      {/* Aviso se há itens sem ficha */}
      {data.resumo.itens_sem_ficha > 0 && (
        <div className="flex items-start gap-3 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
          <i className="ri-lightbulb-line text-amber-600 text-sm flex-shrink-0 mt-0.5" />
          <div className="text-xs text-amber-800">
            <strong>{data.resumo.itens_sem_ficha} {data.resumo.itens_sem_ficha === 1 ? 'item vendido não tem' : 'itens vendidos não têm'} ficha técnica cadastrada.</strong>{' '}
            O CMV desses itens não pode ser calculado. Acesse o módulo de Cardápio → Ficha Técnica para cadastrar os ingredientes e custos de cada item.
          </div>
        </div>
      )}
    </div>
  );
}

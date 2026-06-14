import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChevronDown, ChevronUp, Utensils, AlertCircle } from 'lucide-react';
import { useConsumoPorLanche } from '@/hooks/useConsumoPorLanche';

interface Props {
  dateFrom: string;
  dateTo: string;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtNum = (v: number, d = 3) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }).format(v);

const COLORS = [
  '#f59e0b', '#10b981', '#ef4444', '#3b82f6', '#8b5cf6',
  '#f97316', '#06b6d4', '#84cc16', '#ec4899', '#6366f1',
];

export default function ConsumoPorLanchePanel({ dateFrom, dateTo }: Props) {
  const { dados, loading, error } = useConsumoPorLanche(dateFrom, dateTo);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n; });

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Carregando consumo por prato...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 py-4 px-4 bg-red-50 rounded-xl">
        <AlertCircle size={14} className="text-red-500" />
        <span className="text-xs text-red-600">{error}</span>
      </div>
    );
  }

  if (dados.length === 0) {
    return (
      <div className="py-10 text-center">
        <Utensils size={24} className="text-zinc-200 mx-auto mb-2" />
        <p className="text-xs text-zinc-400">Nenhum prato com ficha técnica no período.</p>
        <p className="text-[10px] text-zinc-300 mt-1">
          Cadastre fichas técnicas nos itens do cardápio para ver o consumo por prato.
        </p>
      </div>
    );
  }

  const top10 = dados.slice(0, 10);
  const totalCusto = dados.reduce((s, d) => s + d.custoTotal, 0);
  const totalVendidas = dados.reduce((s, d) => s + d.qtdVendida, 0);

  return (
    <div className="space-y-4">
      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white border border-zinc-100 rounded-xl p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Pratos com ficha</p>
          <p className="text-xl font-bold text-zinc-800">{dados.length}</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Unidades vendidas</p>
          <p className="text-xl font-bold text-zinc-800">{totalVendidas}</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-3">
          <p className="text-[10px] text-zinc-400 uppercase tracking-wide">Custo total insumos</p>
          <p className="text-xl font-bold text-zinc-800">{fmt(totalCusto)}</p>
        </div>
      </div>

      {/* Gráfico Top 10 */}
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-zinc-600 mb-3">Top 10 Pratos — Custo de Insumos</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart
            data={top10.map((d) => ({ name: d.itemNome, custo: d.custoTotal, qtd: d.qtdVendida }))}
            layout="vertical"
            margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
          >
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `R$${(v / 1).toFixed(0)}`}
            />
            <YAxis
              dataKey="name"
              type="category"
              tick={{ fontSize: 10, fill: '#52525b' }}
              tickLine={false}
              axisLine={false}
              width={120}
            />
            <Tooltip
              formatter={(v: number) => [fmt(v), 'Custo insumos']}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f4f4f5' }}
            />
            <Bar dataKey="custo" radius={[0, 4, 4, 0]} maxBarSize={16}>
              {top10.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela detalhada */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-3 py-2 text-left font-semibold text-zinc-500 w-6" />
                <th className="px-3 py-2 text-left font-semibold text-zinc-500">Prato / Item</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500 w-24">Qtd Vendida</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500 w-24">Pedidos</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500 w-28">Custo Insumos</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500 w-24">Custo/Un</th>
              </tr>
            </thead>
            <tbody>
              {dados.map((item, idx) => {
                const exp = expanded.has(item.itemId);
                const custoUnit = item.qtdVendida > 0 ? item.custoTotal / item.qtdVendida : 0;
                return (
                  <>
                    <tr
                      key={item.itemId}
                      className="border-b border-zinc-50 hover:bg-zinc-50/50 cursor-pointer transition-colors"
                      onClick={() => toggle(item.itemId)}
                    >
                      <td className="px-3 py-2">
                        {item.ingredientes.length > 0 ? (
                          exp ? (
                            <ChevronUp size={11} className="text-amber-500" />
                          ) : (
                            <ChevronDown size={11} className="text-zinc-400" />
                          )
                        ) : null}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div
                            className="w-2 h-2 rounded-full flex-shrink-0"
                            style={{ background: COLORS[idx % COLORS.length] }}
                          />
                          <span className="font-medium text-zinc-800">{item.itemNome}</span>
                          {item.ingredientes.length === 0 && (
                            <span className="text-[9px] text-zinc-400 bg-zinc-100 px-1 rounded">sem ficha</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-700 font-medium">
                        {item.qtdVendida}x
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">{item.numPedidos}</td>
                      <td className="px-3 py-2 text-right font-semibold text-zinc-800">
                        {fmt(item.custoTotal)}
                      </td>
                      <td className="px-3 py-2 text-right text-zinc-500">{fmt(custoUnit)}</td>
                    </tr>

                    {exp && item.ingredientes.length > 0 && (
                      <tr key={`${item.itemId}-detail`}>
                        <td colSpan={6} className="bg-amber-50/30 px-6 py-2">
                          <p className="text-[10px] font-semibold text-zinc-500 mb-1.5 uppercase">
                            Insumos consumidos (total do período)
                          </p>
                          <div className="space-y-1">
                            {item.ingredientes.map((ing) => (
                              <div
                                key={ing.id}
                                className="flex items-center justify-between text-[11px] py-0.5"
                              >
                                <span className="text-zinc-700">{ing.nome}</span>
                                <div className="flex items-center gap-4 text-zinc-500">
                                  <span>{fmtNum(ing.quantidade)} {ing.unidade}</span>
                                  <span className="font-semibold text-zinc-700 w-20 text-right">
                                    {fmt(ing.custo)}
                                  </span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
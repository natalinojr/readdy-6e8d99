import { useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { ConsumoIngrediente } from '@/hooks/useConsumoIngredientes';

interface Props {
  dados: ConsumoIngrediente[];
  loading: boolean;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v);
const pct = (v: number, total: number) =>
  total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%';

const COLORS = [
  '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6',
  '#ef4444', '#06b6d4', '#f97316', '#84cc16',
  '#ec4899', '#6366f1',
];

interface CategoriaAgregada {
  nome: string;
  qtdIngredientes: number;
  custoTotal: number;
  custoVendas: number;
  custoProducao: number;
  custoPerda: number;
  consumoTotal: number;
  ingredientes: ConsumoIngrediente[];
}

export default function ConsumoCategoriasPanel({ dados, loading }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const categorias = useMemo<CategoriaAgregada[]>(() => {
    const map = new Map<string, CategoriaAgregada>();
    for (const d of dados.filter((i) => !i.semCadastro)) {
      const cat = d.categoria || 'Sem categoria';
      const prev = map.get(cat) ?? {
        nome: cat,
        qtdIngredientes: 0,
        custoTotal: 0,
        custoVendas: 0,
        custoProducao: 0,
        custoPerda: 0,
        consumoTotal: 0,
        ingredientes: [],
      };
      prev.qtdIngredientes += 1;
      prev.custoTotal += d.custoTotal;
      prev.custoVendas += d.custoVendas;
      prev.custoProducao += d.custoProducao;
      prev.custoPerda += d.custoPerda;
      prev.consumoTotal += d.totalConsumido;
      prev.ingredientes.push(d);
      map.set(cat, prev);
    }
    return Array.from(map.values()).sort((a, b) => b.custoTotal - a.custoTotal);
  }, [dados]);

  const totalGeral = useMemo(
    () => categorias.reduce((s, c) => s + c.custoTotal, 0),
    [categorias],
  );

  const chartData = useMemo(
    () => categorias.slice(0, 10).map((c) => ({ name: c.nome, custo: c.custoTotal, perda: c.custoPerda })),
    [categorias],
  );

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <div className="w-5 h-5 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Carregando...</span>
      </div>
    );
  }

  if (categorias.length === 0) {
    return (
      <div className="py-8 text-center text-xs text-zinc-400">
        Nenhum dado de categoria no período.
      </div>
    );
  }

  const toggle = (nome: string) =>
    setExpanded((p) => { const n = new Set(p); n.has(nome) ? n.delete(nome) : n.add(nome); return n; });

  return (
    <div className="space-y-4">
      {/* Gráfico de barras */}
      <div className="bg-white border border-zinc-100 rounded-xl p-4">
        <p className="text-xs font-semibold text-zinc-600 mb-3">Custo por Categoria (Top 10)</p>
        <ResponsiveContainer width="100%" height={200}>
          <BarChart data={chartData} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
            <XAxis
              dataKey="name"
              tick={{ fontSize: 10, fill: '#71717a' }}
              tickLine={false}
              axisLine={false}
              interval={0}
              height={40}
              angle={-20}
              textAnchor="end"
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#a1a1aa' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
              width={45}
            />
            <Tooltip
              formatter={(v: number) => [fmt(v), 'Custo']}
              contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f4f4f5' }}
            />
            <Bar dataKey="custo" radius={[4, 4, 0, 0]} maxBarSize={40}>
              {chartData.map((_, i) => (
                <Cell key={i} fill={COLORS[i % COLORS.length]} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>

      {/* Tabela por categoria */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-3 py-2 text-left font-semibold text-zinc-500 w-6" />
                <th className="px-3 py-2 text-left font-semibold text-zinc-500">Categoria</th>
                <th className="px-3 py-2 text-center font-semibold text-zinc-500 w-16">Itens</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500">Custo Total</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500 w-16">% Total</th>
                <th className="px-3 py-2 text-right font-semibold text-amber-600 w-28">Vendas</th>
                <th className="px-3 py-2 text-right font-semibold text-sky-600 w-28">Produção</th>
                <th className="px-3 py-2 text-right font-semibold text-red-500 w-28">Perdas</th>
              </tr>
            </thead>
            <tbody>
              {categorias.map((cat, idx) => {
                const exp = expanded.has(cat.nome);
                return (
                  <>
                    <tr
                      key={cat.nome}
                      className="border-b border-zinc-50 hover:bg-zinc-50/50 cursor-pointer transition-colors"
                      onClick={() => toggle(cat.nome)}
                    >
                      <td className="px-3 py-2">
                        <div
                          className="w-2.5 h-2.5 rounded-full"
                          style={{ background: COLORS[idx % COLORS.length] }}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {exp ? <ChevronUp size={11} className="text-amber-500" /> : <ChevronDown size={11} className="text-zinc-400" />}
                          <span className="font-medium text-zinc-800">{cat.nome}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center text-zinc-500">{cat.qtdIngredientes}</td>
                      <td className="px-3 py-2 text-right font-semibold text-zinc-800">
                        {fmt(cat.custoTotal)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-zinc-500">{pct(cat.custoTotal, totalGeral)}</span>
                      </td>
                      <td className="px-3 py-2 text-right text-amber-700">{fmt(cat.custoVendas)}</td>
                      <td className="px-3 py-2 text-right text-sky-700">{fmt(cat.custoProducao)}</td>
                      <td className="px-3 py-2 text-right text-red-500">{fmt(cat.custoPerda)}</td>
                    </tr>

                    {exp && (
                      <tr key={`${cat.nome}-detail`}>
                        <td colSpan={8} className="bg-zinc-50/60 px-6 py-2">
                          <div className="space-y-1">
                            {cat.ingredientes
                              .sort((a, b) => b.custoTotal - a.custoTotal)
                              .map((ing) => (
                                <div
                                  key={ing.id}
                                  className="flex items-center justify-between text-[11px] py-1 border-b border-zinc-100 last:border-0"
                                >
                                  <span className="text-zinc-700 font-medium">{ing.nome}</span>
                                  <div className="flex items-center gap-4 text-zinc-500">
                                    <span>{fmtNum(ing.totalConsumido)} {ing.unidade}</span>
                                    <span className="font-semibold text-zinc-800">{fmt(ing.custoTotal)}</span>
                                    {ing.porTipo.perda > 0 && (
                                      <span className="text-red-500">
                                        Perda: {fmt(ing.custoPerda)}
                                      </span>
                                    )}
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
            <tfoot>
              <tr className="bg-zinc-50 border-t border-zinc-200">
                <td colSpan={3} className="px-3 py-2 text-xs font-bold text-zinc-700">
                  Total
                </td>
                <td className="px-3 py-2 text-right text-xs font-bold text-zinc-800">
                  {fmt(totalGeral)}
                </td>
                <td className="px-3 py-2 text-right text-xs text-zinc-400">100%</td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-amber-700">
                  {fmt(categorias.reduce((s, c) => s + c.custoVendas, 0))}
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-sky-700">
                  {fmt(categorias.reduce((s, c) => s + c.custoProducao, 0))}
                </td>
                <td className="px-3 py-2 text-right text-xs font-semibold text-red-500">
                  {fmt(categorias.reduce((s, c) => s + c.custoPerda, 0))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
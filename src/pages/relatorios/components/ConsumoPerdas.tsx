import { useMemo } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { AlertTriangle, TrendingDown, PackageX } from 'lucide-react';
import type { ConsumoIngrediente } from '@/hooks/useConsumoIngredientes';

interface Props {
  dados: ConsumoIngrediente[];
  loading: boolean;
}

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(v);
const pct = (v: number, total: number) =>
  total > 0 ? ((v / total) * 100).toFixed(1) + '%' : '0%';

const SEV_COLORS = ['#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16'];

function getSeverity(pctPerda: number): { label: string; color: string; bg: string } {
  if (pctPerda > 20) return { label: 'Crítico', color: 'text-red-700', bg: 'bg-red-100' };
  if (pctPerda > 10) return { label: 'Alto', color: 'text-orange-700', bg: 'bg-orange-100' };
  if (pctPerda > 5) return { label: 'Médio', color: 'text-amber-700', bg: 'bg-amber-100' };
  return { label: 'Baixo', color: 'text-emerald-700', bg: 'bg-emerald-100' };
}

export default function ConsumoPerdas({ dados, loading }: Props) {
  const comPerdas = useMemo(
    () =>
      dados
        .filter((d) => !d.semCadastro && d.porTipo.perda > 0)
        .map((d) => ({
          ...d,
          pctPerda: d.totalConsumido > 0 ? (d.porTipo.perda / d.totalConsumido) * 100 : 0,
        }))
        .sort((a, b) => b.custoPerda - a.custoPerda),
    [dados],
  );

  const totalCustoPerda = useMemo(
    () => comPerdas.reduce((s, d) => s + d.custoPerda, 0),
    [comPerdas],
  );
  const totalCustoGeral = useMemo(
    () => dados.filter((d) => !d.semCadastro).reduce((s, d) => s + d.custoTotal, 0),
    [dados],
  );

  const chartData = useMemo(
    () =>
      comPerdas.slice(0, 8).map((d) => ({
        name: d.nome.length > 16 ? d.nome.slice(0, 14) + '…' : d.nome,
        custo: d.custoPerda,
      })),
    [comPerdas],
  );

  // Agrupar por categoria
  const porCategoria = useMemo(() => {
    const map = new Map<string, { custo: number; qtd: number }>();
    for (const d of comPerdas) {
      const cat = d.categoria || 'Sem categoria';
      const prev = map.get(cat) ?? { custo: 0, qtd: 0 };
      prev.custo += d.custoPerda;
      prev.qtd += 1;
      map.set(cat, prev);
    }
    return Array.from(map.entries())
      .map(([cat, v]) => ({ cat, ...v }))
      .sort((a, b) => b.custo - a.custo);
  }, [comPerdas]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 justify-center">
        <div className="w-5 h-5 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
        <span className="text-xs text-zinc-400">Carregando...</span>
      </div>
    );
  }

  if (comPerdas.length === 0) {
    return (
      <div className="py-10 text-center">
        <PackageX size={28} className="text-zinc-200 mx-auto mb-2" />
        <p className="text-sm font-semibold text-zinc-500">Nenhuma perda registrada</p>
        <p className="text-xs text-zinc-400 mt-1">Ótimo! Sem perdas no período selecionado.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Cards de resumo */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-50 border border-red-100 rounded-xl p-3">
          <p className="text-[10px] text-red-500 uppercase tracking-wide">Custo total perdas</p>
          <p className="text-xl font-bold text-red-700">{fmt(totalCustoPerda)}</p>
          <p className="text-[10px] text-red-400 mt-0.5">{pct(totalCustoPerda, totalCustoGeral)} do custo total</p>
        </div>
        <div className="bg-orange-50 border border-orange-100 rounded-xl p-3">
          <p className="text-[10px] text-orange-500 uppercase tracking-wide">Ingredientes com perda</p>
          <p className="text-xl font-bold text-orange-700">{comPerdas.length}</p>
          <p className="text-[10px] text-orange-400 mt-0.5">
            de {dados.filter((d) => !d.semCadastro).length} cadastrados
          </p>
        </div>
        <div className="bg-amber-50 border border-amber-100 rounded-xl p-3">
          <p className="text-[10px] text-amber-600 uppercase tracking-wide">Maior perda</p>
          <p className="text-sm font-bold text-amber-800 truncate">{comPerdas[0]?.nome ?? '—'}</p>
          <p className="text-[10px] text-amber-500 mt-0.5">{fmt(comPerdas[0]?.custoPerda ?? 0)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Gráfico Top perdas */}
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-600 mb-3">Top Perdas por Custo</p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 0, right: 10, left: 0, bottom: 0 }}
            >
              <XAxis
                type="number"
                tick={{ fontSize: 9, fill: '#a1a1aa' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) => `R$${v.toFixed(0)}`}
              />
              <YAxis
                dataKey="name"
                type="category"
                tick={{ fontSize: 9, fill: '#52525b' }}
                tickLine={false}
                axisLine={false}
                width={90}
              />
              <Tooltip
                formatter={(v: number) => [fmt(v), 'Perda']}
                contentStyle={{ fontSize: 11, borderRadius: 8, border: '1px solid #f4f4f5' }}
              />
              <Bar dataKey="custo" radius={[0, 4, 4, 0]} maxBarSize={14}>
                {chartData.map((_, i) => (
                  <Cell key={i} fill={SEV_COLORS[Math.min(i, SEV_COLORS.length - 1)]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Perdas por categoria */}
        <div className="bg-white border border-zinc-100 rounded-xl p-4">
          <p className="text-xs font-semibold text-zinc-600 mb-3">Perdas por Categoria</p>
          <div className="space-y-2">
            {porCategoria.map((c) => (
              <div key={c.cat} className="flex items-center gap-2">
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-xs text-zinc-700 font-medium">{c.cat}</span>
                    <span className="text-xs font-semibold text-red-600">{fmt(c.custo)}</span>
                  </div>
                  <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-red-400 rounded-full transition-all"
                      style={{ width: pct(c.custo, totalCustoPerda) }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-zinc-400 w-10 text-right">
                  {pct(c.custo, totalCustoPerda)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Tabela detalhada */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="px-4 py-2.5 border-b border-zinc-100 flex items-center gap-2">
          <AlertTriangle size={13} className="text-red-500" />
          <p className="text-xs font-semibold text-zinc-700">Ranking de Perdas</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-zinc-50 border-b border-zinc-100">
                <th className="px-3 py-2 text-left font-semibold text-zinc-500">#</th>
                <th className="px-3 py-2 text-left font-semibold text-zinc-500">Ingrediente</th>
                <th className="px-3 py-2 text-left font-semibold text-zinc-500">Categoria</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500">Qtd Perdida</th>
                <th className="px-3 py-2 text-right font-semibold text-zinc-500">% do Consumo</th>
                <th className="px-3 py-2 text-right font-semibold text-red-500">Custo Perda</th>
                <th className="px-3 py-2 text-center font-semibold text-zinc-500">Nível</th>
              </tr>
            </thead>
            <tbody>
              {comPerdas.map((item, idx) => {
                const sev = getSeverity(item.pctPerda);
                return (
                  <tr
                    key={item.id}
                    className="border-b border-zinc-50 last:border-0 hover:bg-zinc-50/50 transition-colors"
                  >
                    <td className="px-3 py-2 text-zinc-400 font-mono">{idx + 1}</td>
                    <td className="px-3 py-2 font-medium text-zinc-800">{item.nome}</td>
                    <td className="px-3 py-2 text-zinc-500">{item.categoria}</td>
                    <td className="px-3 py-2 text-right text-zinc-600">
                      {fmtNum(item.porTipo.perda)} {item.unidade}
                    </td>
                    <td className="px-3 py-2 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <div className="w-16 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-red-400 rounded-full"
                            style={{ width: Math.min(item.pctPerda, 100) + '%' }}
                          />
                        </div>
                        <span className="text-zinc-500 w-10 text-right">
                          {item.pctPerda.toFixed(1)}%
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-semibold text-red-600">
                      {fmt(item.custoPerda)}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${sev.bg} ${sev.color}`}>
                        {sev.label}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="bg-red-50/50 border-t border-red-100">
                <td colSpan={5} className="px-3 py-2 text-xs font-bold text-zinc-600">Total</td>
                <td className="px-3 py-2 text-right text-xs font-bold text-red-600">
                  {fmt(totalCustoPerda)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Dica de ação */}
      <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 flex items-start gap-2">
        <TrendingDown size={14} className="text-amber-600 mt-0.5 flex-shrink-0" />
        <div>
          <p className="text-xs font-semibold text-amber-800">Como reduzir perdas?</p>
          <p className="text-[11px] text-amber-700 mt-0.5">
            Revise os processos de armazenamento dos ingredientes com maior perda. Considere ajustar
            o estoque mínimo e frequência de compras para itens críticos.
          </p>
        </div>
      </div>
    </div>
  );
}
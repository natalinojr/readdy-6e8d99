import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import type { Comparacao, PontoVendasHora } from '@/lib/vendasHoraComparativo';
import ChipsComparacao, { COMPARACOES, COR_COMPARACAO, rotuloComparacao } from '@/components/feature/ComparacaoVendasHora';

interface Props {
  /** valor = total da hora (PDV + iFood); ifood = parte do iFood, desenhada à parte; ontem/semana/mes = comparações */
  data: PontoVendasHora[];
  lastUpdated?: Date | null;
  comparacoes: Record<Comparacao, boolean>;
  diasComparacao: Record<Comparacao, string>;
  onAlternarComparacao: (k: Comparacao) => void;
}

const formatBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

export default function SalesChart({ data, lastUpdated, comparacoes, diasComparacao, onAlternarComparacao }: Props) {
  const horaAtualizacao = lastUpdated
    ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  const temIfood = data.some((d) => (d.ifood ?? 0) > 0);

  return (
    <div className="bg-white rounded-2xl border border-zinc-200 flex flex-col">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Vendas por Hora</h3>
          <p className="text-xs text-zinc-400">
            Movimento do dia de hoje{temIfood && <> · <span className="text-red-500">tracejado = iFood</span></>}
          </p>
        </div>
        {horaAtualizacao && (
          <span className="flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Atualizado {horaAtualizacao}
          </span>
        )}
      </div>

      <div className="p-5">
      <ChipsComparacao ligadas={comparacoes} dias={diasComparacao} onAlternar={onAlternarComparacao} className="mb-4" />

      {data.length === 0 ? (
        <div className="py-14 text-center">
          <i className="ri-bar-chart-line text-4xl text-zinc-200" />
          <p className="text-zinc-400 text-sm mt-2">Sem vendas registradas hoje</p>
          <p className="text-xs text-zinc-300 mt-1">O gráfico aparecerá quando houver movimentação</p>
        </div>
      ) : (
        <div className="h-52 min-h-[208px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={data} margin={{ top: 2, right: 14, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorVendas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="hora" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `R$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} width={48} />
              <Tooltip
                formatter={(val: number, name: string) => [formatBRL(val),
                  name === 'ifood' ? 'Só iFood'
                  : name === 'ontem' || name === 'semana' || name === 'mes' ? rotuloComparacao(name, diasComparacao[name])
                  : 'Hoje']}
                contentStyle={{ borderRadius: 12, border: '1px solid #e4e4e7', fontSize: 12 }}
                labelStyle={{ fontWeight: 600, color: '#18181b' }}
              />
              <Area type="monotone" dataKey="valor" stroke="#F59E0B" strokeWidth={2}
                fill="url(#colorVendas)" dot={false} activeDot={{ r: 4, fill: '#F59E0B', strokeWidth: 0 }} />
              {temIfood && (
                <Area type="monotone" dataKey="ifood" stroke="#ea1d2c" strokeWidth={1.5} strokeDasharray="4 3"
                  fill="#ea1d2c" fillOpacity={0.06} dot={false} activeDot={{ r: 3, fill: '#ea1d2c' }} />
              )}
              {COMPARACOES.map((k) => comparacoes[k] && (
                <Line key={k} type="monotone" dataKey={k} stroke={COR_COMPARACAO[k]} strokeWidth={1.5} strokeDasharray="5 4"
                  dot={false} activeDot={{ r: 3, fill: COR_COMPARACAO[k], strokeWidth: 0 }} isAnimationActive={false} />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      )}
      </div>
    </div>
  );
}

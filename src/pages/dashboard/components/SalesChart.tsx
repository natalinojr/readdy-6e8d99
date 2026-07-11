import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface Props {
  data: Array<{ hora: string; valor: number }>;
  lastUpdated?: Date | null;
}

const formatBRL = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);

export default function SalesChart({ data, lastUpdated }: Props) {
  const horaAtualizacao = lastUpdated
    ? lastUpdated.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="bg-white border border-zinc-100 rounded-xl p-5 flex flex-col">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Vendas por Hora</h3>
          <p className="text-xs text-zinc-400 mt-0.5">Movimento do dia de hoje</p>
        </div>
        {horaAtualizacao && (
          <span className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-600">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            Atualizado {horaAtualizacao}
          </span>
        )}
      </div>

      {data.length === 0 ? (
        <div className="h-52 flex flex-col items-center justify-center text-center">
          <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl mb-3">
            <i className="ri-bar-chart-line text-zinc-400 text-lg" />
          </div>
          <p className="text-sm text-zinc-400">Sem vendas registradas hoje</p>
          <p className="text-xs text-zinc-300 mt-1">O gráfico aparecerá quando houver movimentação</p>
        </div>
      ) : (
        <div className="h-52 min-h-[208px]">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 2, right: 4, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorVendas" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.15} />
                  <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} interval={1} />
              <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false}
                tickFormatter={(v) => `R$${v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v}`} width={48} />
              <Tooltip
                formatter={(val: number) => [formatBRL(val), 'Vendas']}
                contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 12 }}
                labelStyle={{ fontWeight: 600, color: '#18181b' }}
              />
              <Area type="monotone" dataKey="valor" stroke="#F59E0B" strokeWidth={2}
                fill="url(#colorVendas)" dot={false} activeDot={{ r: 4, fill: '#F59E0B', strokeWidth: 0 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

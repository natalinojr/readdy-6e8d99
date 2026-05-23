import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useDeliveryReport } from '@/hooks/useDeliveryReport';

interface Props { periodo: string; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const CORES_GRAFICO = ['#f59e0b', '#10b981', '#06b6d4', '#f97316', '#ef4444', '#8b5cf6', '#ec4899'];

export default function DeliveryTab({ periodo }: Props) {
  const { dados, loading } = useDeliveryReport(periodo);

  const temComissao = dados.porPlataforma.some((p) => p.comissao_pct > 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { porPlataforma, horariosPico, porDiaSemana, totalPedidos, totalReceita,
    totalCustoEntrega, totalComissao, totalReceitaLiquida, ticketMedioGeral, tempoMedioRegistro } = dados;

  const temDados = totalPedidos > 0;

  if (!temDados) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-motorbike-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum pedido de delivery no período</p>
        <p className="text-xs text-zinc-400 mt-1">Registre pedidos no PDV Delivery para ver os dados aqui</p>
      </div>
    );
  }

  // Horário de pico (hora com mais pedidos)
  const horarioPicoMax = horariosPico.reduce(
    (max, h) => (h.pedidos > max.pedidos ? h : max),
    { hora: '—', pedidos: 0, receita: 0 },
  );

  // Dia de pico
  const diaPicoMax = porDiaSemana.reduce(
    (max, d) => (d.pedidos > max.pedidos ? d : max),
    { dia: '—', pedidos: 0, receita: 0 },
  );

  const margemLiquida = totalReceita > 0 ? (totalReceitaLiquida / totalReceita) * 100 : 0;

  return (
    <div className="space-y-5">

      {/* KPIs principais */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 flex items-center justify-center bg-amber-50 rounded-lg">
              <i className="ri-shopping-bag-line text-amber-600 text-sm" />
            </div>
            <span className="text-xs text-zinc-500 font-medium">Total de Pedidos</span>
          </div>
          <p className="text-2xl font-black text-zinc-900">{totalPedidos}</p>
          <p className="text-xs text-zinc-400 mt-1">Ticket médio: {fmt(ticketMedioGeral)}</p>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 flex items-center justify-center bg-emerald-50 rounded-lg">
              <i className="ri-money-dollar-circle-line text-emerald-600 text-sm" />
            </div>
            <span className="text-xs text-zinc-500 font-medium">Receita Bruta</span>
          </div>
          <p className="text-2xl font-black text-zinc-900">{fmt(totalReceita)}</p>
          <p className="text-xs text-zinc-400 mt-1">Inclui custo de entrega</p>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 flex items-center justify-center bg-red-50 rounded-lg">
              <i className="ri-motorbike-line text-red-500 text-sm" />
            </div>
            <span className="text-xs text-zinc-500 font-medium">Custo de Entrega</span>
          </div>
          <p className="text-2xl font-black text-zinc-900">{fmt(totalCustoEntrega)}</p>
          <p className="text-xs text-zinc-400 mt-1">
            {totalPedidos > 0 ? fmt(totalCustoEntrega / totalPedidos) : 'R$ 0,00'} por pedido
          </p>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 flex items-center justify-center bg-teal-50 rounded-lg">
              <i className="ri-funds-line text-teal-600 text-sm" />
            </div>
            <span className="text-xs text-zinc-500 font-medium">Receita Líquida Real</span>
          </div>
          <p className="text-2xl font-black text-zinc-900">{fmt(totalReceitaLiquida)}</p>
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            <p className="text-xs text-zinc-400">Margem: {margemLiquida.toFixed(1)}%</p>
            {temComissao && totalComissao > 0 && (
              <span className="text-[10px] font-bold text-orange-500 bg-orange-50 px-1.5 py-0.5 rounded-full">
                -{fmt(totalComissao)} comissão
              </span>
            )}
          </div>
        </div>
      </div>

      {/* KPIs secundários */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-amber-50 rounded-xl flex-shrink-0">
            <i className="ri-time-line text-amber-600" />
          </div>
          <div>
            <p className="text-xs text-zinc-400">Horário de pico</p>
            <p className="text-sm font-black text-zinc-800">{horarioPicoMax.hora}</p>
            <p className="text-[10px] text-zinc-400">{horarioPicoMax.pedidos} pedidos</p>
          </div>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-emerald-50 rounded-xl flex-shrink-0">
            <i className="ri-calendar-check-line text-emerald-600" />
          </div>
          <div>
            <p className="text-xs text-zinc-400">Melhor dia</p>
            <p className="text-sm font-black text-zinc-800">{diaPicoMax.dia}</p>
            <p className="text-[10px] text-zinc-400">{diaPicoMax.pedidos} pedidos</p>
          </div>
        </div>

        <div className="bg-white border border-zinc-100 rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center bg-zinc-100 rounded-xl flex-shrink-0">
            <i className="ri-timer-flash-line text-zinc-600" />
          </div>
          <div>
            <p className="text-xs text-zinc-400">Tempo médio de registro</p>
            <p className="text-sm font-black text-zinc-800">
              {tempoMedioRegistro !== null ? `${tempoMedioRegistro} min` : '—'}
            </p>
            <p className="text-[10px] text-zinc-400">Do lançamento ao pagamento</p>
          </div>
        </div>
      </div>

      {/* Receita bruta vs líquida por plataforma */}
      {porPlataforma.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Cards por plataforma */}
          <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50">
              <h3 className="text-xs font-bold text-zinc-700">Performance por Plataforma</h3>
              <p className="text-[10px] text-zinc-400 mt-0.5">Receita bruta, custo de entrega e receita líquida</p>
            </div>
            <div className="divide-y divide-zinc-50">
              {porPlataforma.map((p, i) => (
                <div key={p.platform} className="px-4 py-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <div className={`w-7 h-7 flex items-center justify-center rounded-lg text-xs ${p.cor}`}>
                        <i className={p.icon} />
                      </div>
                      <div>
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-zinc-800">{p.label}</p>
                          {p.comissao_pct > 0 && (
                            <span className="text-[9px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                              {p.comissao_pct}% comissão
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-zinc-400">{p.pedidos} pedidos · {p.pct_pedidos.toFixed(1)}%</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-black text-zinc-900">{fmt(p.receita_liquida)}</p>
                      <p className="text-[10px] text-zinc-400">líquido real</p>
                    </div>
                  </div>
                  <div className={`grid gap-2 text-center ${p.comissao_pct > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                    <div className="bg-zinc-50 rounded-lg p-1.5">
                      <p className="text-[10px] text-zinc-400">Bruto</p>
                      <p className="text-xs font-bold text-zinc-700">{fmt(p.receita_bruta)}</p>
                    </div>
                    <div className="bg-red-50 rounded-lg p-1.5">
                      <p className="text-[10px] text-red-400">Entrega</p>
                      <p className="text-xs font-bold text-red-600">-{fmt(p.custo_entrega)}</p>
                    </div>
                    {p.comissao_pct > 0 && (
                      <div className="bg-orange-50 rounded-lg p-1.5">
                        <p className="text-[10px] text-orange-400">Comissão</p>
                        <p className="text-xs font-bold text-orange-600">-{fmt(p.comissao_valor)}</p>
                      </div>
                    )}
                    <div className="bg-emerald-50 rounded-lg p-1.5">
                      <p className="text-[10px] text-emerald-500">Ticket</p>
                      <p className="text-xs font-bold text-emerald-700">{fmt(p.ticket_medio)}</p>
                    </div>
                  </div>
                  <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${p.pct_receita}%`,
                        backgroundColor: CORES_GRAFICO[i % CORES_GRAFICO.length],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Pizza de distribuição */}
          <div className="bg-white border border-zinc-100 rounded-xl p-5">
            <h3 className="text-xs font-bold text-zinc-700 mb-1">Distribuição de Pedidos</h3>
            <p className="text-[10px] text-zinc-400 mb-4">Por plataforma de delivery</p>
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={porPlataforma}
                    dataKey="pedidos"
                    nameKey="label"
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    innerRadius={40}
                  >
                    {porPlataforma.map((_, i) => (
                      <Cell key={i} fill={CORES_GRAFICO[i % CORES_GRAFICO.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(val: number, name: string) => [`${val} pedidos`, name]}
                    contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                  />
                  <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>
      )}

      {/* Receita bruta vs custo entrega — barras empilhadas por plataforma */}
      {porPlataforma.length > 1 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <h3 className="text-xs font-bold text-zinc-700 mb-1">Receita Bruta vs Custo de Entrega</h3>
          <p className="text-[10px] text-zinc-400 mb-4">Comparativo por plataforma</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porPlataforma} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `R$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`}
                  width={44}
                />
                <Tooltip
                  formatter={(val: number, name: string) => [
                    fmt(val),
                    name === 'receita_liquida' ? 'Receita Líquida' : name === 'custo_entrega' ? 'Custo Entrega' : 'Receita Bruta',
                  ]}
                  contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                />
                <Legend
                  iconSize={8}
                  wrapperStyle={{ fontSize: 10 }}
                  formatter={(v) =>
                    v === 'receita_liquida' ? 'Receita Líquida' : v === 'custo_entrega' ? 'Custo Entrega' : v
                  }
                />
                <Bar dataKey="receita_liquida" stackId="a" fill="#10b981" name="receita_liquida" />
                <Bar dataKey="custo_entrega" stackId="a" fill="#ef4444" name="custo_entrega" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Horários de pico */}
      {horariosPico.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <h3 className="text-xs font-bold text-zinc-700 mb-1">Horários de Pico</h3>
          <p className="text-[10px] text-zinc-400 mb-4">Pedidos de delivery por hora do dia</p>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={horariosPico} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <YAxis
                  tick={{ fontSize: 10, fill: '#a1a1aa' }}
                  axisLine={false}
                  tickLine={false}
                  allowDecimals={false}
                  width={28}
                />
                <Tooltip
                  formatter={(val: number, name: string) => [
                    name === 'pedidos' ? `${val} pedidos` : fmt(val),
                    name === 'pedidos' ? 'Pedidos' : 'Receita',
                  ]}
                  contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                />
                <Bar dataKey="pedidos" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Por dia da semana */}
      <div className="bg-white border border-zinc-100 rounded-xl p-5">
        <h3 className="text-xs font-bold text-zinc-700 mb-1">Pedidos por Dia da Semana</h3>
        <p className="text-[10px] text-zinc-400 mb-4">Volume de pedidos de delivery por dia</p>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={porDiaSemana} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
              <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 10, fill: '#a1a1aa' }}
                axisLine={false}
                tickLine={false}
                allowDecimals={false}
                width={28}
              />
              <Tooltip
                formatter={(val: number) => [`${val} pedidos`, 'Pedidos']}
                contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
              />
              <Bar dataKey="pedidos" fill="#06b6d4" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Tabela detalhada por plataforma */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100">
          <p className="text-xs font-bold text-zinc-700">Detalhamento por Plataforma</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500">Plataforma</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">Pedidos</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Receita Bruta</th>
                <th className="px-4 py-3 text-right font-semibold text-red-500">Custo Entrega</th>
                {temComissao && (
                  <th className="px-4 py-3 text-right font-semibold text-orange-500">Comissão App</th>
                )}
                <th className="px-4 py-3 text-right font-semibold text-emerald-600">Receita Líquida Real</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Ticket Médio</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">% Pedidos</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {porPlataforma.map((p, i) => (
                <tr key={p.platform} className="hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-6 h-6 flex items-center justify-center rounded-lg text-xs ${p.cor}`}>
                        <i className={p.icon} />
                      </div>
                      <div>
                        <span className="font-semibold text-zinc-800">{p.label}</span>
                        {p.comissao_pct > 0 && (
                          <span className="ml-1.5 text-[9px] font-bold bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full">
                            {p.comissao_pct}%
                          </span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-semibold text-zinc-700">{p.pedidos}</td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-800">{fmt(p.receita_bruta)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-red-500">-{fmt(p.custo_entrega)}</td>
                  {temComissao && (
                    <td className="px-4 py-3 text-right font-semibold text-orange-500">
                      {p.comissao_pct > 0 ? `-${fmt(p.comissao_valor)}` : <span className="text-zinc-300">—</span>}
                    </td>
                  )}
                  <td className="px-4 py-3 text-right font-bold text-emerald-700">{fmt(p.receita_liquida)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-zinc-700">{fmt(p.ticket_medio)}</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center gap-1.5 justify-center">
                      <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${p.pct_pedidos}%`,
                            backgroundColor: CORES_GRAFICO[i % CORES_GRAFICO.length],
                          }}
                        />
                      </div>
                      <span className="text-[10px] font-bold text-zinc-500">{p.pct_pedidos.toFixed(1)}%</span>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot className="border-t-2 border-zinc-200">
              <tr>
                <td className="px-4 py-3 font-bold text-zinc-700">Total</td>
                <td className="px-4 py-3 text-center font-black text-zinc-900">{totalPedidos}</td>
                <td className="px-4 py-3 text-right font-black text-zinc-900">{fmt(totalReceita)}</td>
                <td className="px-4 py-3 text-right font-black text-red-500">-{fmt(totalCustoEntrega)}</td>
                {temComissao && (
                  <td className="px-4 py-3 text-right font-black text-orange-500">-{fmt(totalComissao)}</td>
                )}
                <td className="px-4 py-3 text-right font-black text-emerald-700">{fmt(totalReceitaLiquida)}</td>
                <td className="px-4 py-3 text-right font-black text-zinc-900">{fmt(ticketMedioGeral)}</td>
                <td className="px-4 py-3 text-center font-bold text-zinc-600">100%</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area,
} from 'recharts';
import { useCancelamentosReport } from '@/hooks/useCancelamentosReport';

interface Props { periodo: string; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

type SubTab = 'cancelamentos' | 'estornos' | 'descontos' | 'gorjetas';

export default function CancelamentosTab({ periodo }: Props) {
  const [sub, setSub] = useState<SubTab>('cancelamentos');
  const { dados, loading } = useCancelamentosReport(periodo);

  const cancelamentos = dados.cancelamentos as Record<string, unknown>[];
  const estornos = dados.estornos as Record<string, unknown>[];
  const descontos = dados.descontos as Record<string, unknown>[];
  const gorjetas = dados.gorjetas as Record<string, unknown>[];

  const totalCancelamentos = cancelamentos.reduce((s, c) => s + (c.valor as number), 0);
  const totalEstornos = estornos.reduce((s, c) => s + (c.valor as number), 0);
  const totalDescontos = descontos.reduce((s, c) => s + (c.valor as number), 0);
  const totalGorjetas = gorjetas.reduce((s, c) => s + ((c.totalGorjeta as number) ?? 0), 0);

  // Ranking de motivos de cancelamento
  const motivosRanking = useMemo(() => {
    const mapa: Record<string, { count: number; total: number }> = {};
    cancelamentos.forEach(c => {
      const motivo = (c.motivo as string) || 'Sem motivo';
      if (!mapa[motivo]) mapa[motivo] = { count: 0, total: 0 };
      mapa[motivo].count += 1;
      mapa[motivo].total += c.valor as number;
    });
    return Object.entries(mapa)
      .map(([motivo, d]) => ({ motivo, count: d.count, total: d.total }))
      .sort((a, b) => b.count - a.count);
  }, [cancelamentos]);

  // Tendência de cancelamentos por horário
  const tendenciaDia = useMemo(() => {
    const mapa: Record<string, { count: number; total: number }> = {};
    cancelamentos.forEach(c => {
      const hora = (c.hora as string) ?? '';
      const dia = hora.length >= 5 ? hora.slice(0, 5) : hora;
      if (!mapa[dia]) mapa[dia] = { count: 0, total: 0 };
      mapa[dia].count += 1;
      mapa[dia].total += c.valor as number;
    });
    return Object.entries(mapa)
      .map(([dia, d]) => ({ dia, count: d.count, total: d.total }))
      .slice(0, 12);
  }, [cancelamentos]);

  // Impacto financeiro acumulado
  const impactoAcumulado = useMemo(() => {
    let acum = 0;
    return tendenciaDia.map((d) => {
      acum += d.total;
      return { ...d, acumulado: acum };
    });
  }, [tendenciaDia]);

  // Exportar CSV
  const exportarCSV = () => {
    const headers = ['Tipo', 'Pedido', 'Destino/Cliente', 'Motivo', 'Valor (R$)', 'Hora'];
    const rows: string[][] = [];
    cancelamentos.forEach(c => rows.push(['Cancelamento', c.pedido as string, c.mesa as string, c.motivo as string, (c.valor as number).toFixed(2).replace('.', ','), c.hora as string]));
    estornos.forEach(e => rows.push(['Estorno', e.pedido as string, e.cliente as string, e.motivo as string, (e.valor as number).toFixed(2).replace('.', ','), e.hora as string]));
    descontos.forEach(d => rows.push(['Desconto', d.pedido as string, d.mesa as string, `${d.pct}%`, (d.valor as number).toFixed(2).replace('.', ','), d.hora as string]));
    const csv = [headers, ...rows].map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cancelamentos_${periodo}_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const hasAnyData = cancelamentos.length > 0 || estornos.length > 0 || descontos.length > 0 || gorjetas.length > 0;

  if (!hasAnyData) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-refund-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum cancelamento, estorno ou desconto no período</p>
        <p className="text-xs text-zinc-400 mt-1">Período: <strong className="text-zinc-400">{periodo}</strong></p>
      </div>
    );
  }

  const maxMotivo = motivosRanking[0]?.count ?? 1;

  return (
    <div className="space-y-5">
      {/* Header com exportar */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs text-zinc-400">Período: <strong className="text-zinc-600">{periodo}</strong></p>
        </div>
        {hasAnyData && (
          <button
            onClick={exportarCSV}
            className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-download-line" /> Exportar CSV
          </button>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white border border-red-100 rounded-xl p-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">Cancelamentos</p>
          <p className="text-xl font-black text-red-600">{fmt(totalCancelamentos)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{cancelamentos.length} pedidos</p>
        </div>
        <div className="bg-white border border-orange-100 rounded-xl p-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">Estornos</p>
          <p className="text-xl font-black text-orange-600">{fmt(totalEstornos)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{estornos.length} pedidos</p>
        </div>
        <div className="bg-white border border-amber-100 rounded-xl p-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">Descontos Concedidos</p>
          <p className="text-xl font-black text-amber-600">{fmt(totalDescontos)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{descontos.length} pedidos</p>
        </div>
        <div className="bg-white border border-emerald-100 rounded-xl p-4 text-center">
          <p className="text-xs text-zinc-500 mb-1">Total Gorjetas</p>
          <p className="text-xl font-black text-emerald-600">{fmt(totalGorjetas)}</p>
          <p className="text-[10px] text-zinc-400 mt-0.5">{gorjetas.reduce((s, g) => s + ((g.pedidos as number) ?? 0), 0)} pedidos</p>
        </div>
      </div>

      {/* Gráficos de análise — só mostra se há cancelamentos */}
      {cancelamentos.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Ranking de motivos */}
          <div className="bg-white border border-zinc-100 rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-zinc-800">Ranking de Motivos</h3>
              <p className="text-xs text-zinc-400">Principais causas de cancelamento</p>
            </div>
            {motivosRanking.length > 0 ? (
              <div className="space-y-3">
                {motivosRanking.slice(0, 6).map((m, idx) => {
                  const pct = Math.round((m.count / maxMotivo) * 100);
                  const colors = ['bg-red-500', 'bg-orange-500', 'bg-amber-500', 'bg-zinc-400', 'bg-zinc-300', 'bg-zinc-200'];
                  return (
                    <div key={m.motivo} className="flex items-center gap-3">
                      <span className={`w-5 h-5 flex items-center justify-center rounded-full text-[10px] font-black flex-shrink-0 ${
                        idx === 0 ? 'bg-red-100 text-red-700' : idx === 1 ? 'bg-orange-100 text-orange-700' : 'bg-zinc-100 text-zinc-500'
                      }`}>{idx + 1}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-zinc-700 truncate">{m.motivo}</span>
                          <span className="text-xs font-bold text-zinc-800 ml-2 whitespace-nowrap">{m.count}x</span>
                        </div>
                        <div className="h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${colors[idx]}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="text-xs text-zinc-400 w-16 text-right flex-shrink-0">{fmt(m.total)}</span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="flex items-center justify-center h-32 text-zinc-300 text-xs">
                Sem dados de motivo
              </div>
            )}
          </div>

          {/* Tendência por horário */}
          <div className="bg-white border border-zinc-100 rounded-xl p-5">
            <div className="mb-4">
              <h3 className="text-sm font-semibold text-zinc-800">Distribuição por Horário</h3>
              <p className="text-xs text-zinc-400">Cancelamentos ao longo do dia</p>
            </div>
            {tendenciaDia.length > 1 ? (
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={tendenciaDia} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                    <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip
                      formatter={(val: number, name: string) => [
                        name === 'count' ? `${val} cancelamentos` : fmt(val),
                        name === 'count' ? 'Qtd' : 'Valor',
                      ]}
                      contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                    />
                    <Bar dataKey="count" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={28} name="count" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <div className="flex items-center justify-center h-44 text-zinc-300 text-xs">
                Dados insuficientes para o gráfico
              </div>
            )}
          </div>
        </div>
      )}

      {/* Gráfico de impacto financeiro acumulado */}
      {impactoAcumulado.length > 1 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Impacto Financeiro Acumulado</h3>
            <p className="text-xs text-zinc-400">Perda acumulada por cancelamentos ao longo do período</p>
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={impactoAcumulado} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="impactoGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} width={52}
                  tickFormatter={v => `R$${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                <Tooltip
                  formatter={(v: number, name: string) => [
                    fmt(v),
                    name === 'acumulado' ? 'Perda acumulada' : 'Perda no período',
                  ]}
                  contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                />
                <Area type="monotone" dataKey="acumulado" stroke="#ef4444" strokeWidth={2.5}
                  fill="url(#impactoGrad)" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} name="acumulado" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center justify-between mt-2 pt-2 border-t border-zinc-50">
            <span className="text-xs text-zinc-500">Perda total no período</span>
            <span className="text-sm font-black text-red-600">{fmt(totalCancelamentos + totalEstornos)}</span>
          </div>
        </div>
      )}

      {/* Insight de impacto */}
      {cancelamentos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
            <p className="text-lg font-black text-red-700">
              {cancelamentos.length > 0 ? fmt(totalCancelamentos / cancelamentos.length) : '—'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">Ticket médio cancelado</p>
          </div>
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-4 text-center">
            <p className="text-lg font-black text-amber-700">
              {motivosRanking[0]?.motivo ?? '—'}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">Motivo mais frequente</p>
          </div>
          <div className="bg-zinc-50 border border-zinc-100 rounded-xl p-4 text-center">
            <p className="text-lg font-black text-zinc-700">
              {fmt(totalCancelamentos + totalEstornos + totalDescontos)}
            </p>
            <p className="text-xs text-zinc-500 mt-0.5">Impacto total no período</p>
          </div>
        </div>
      )}

      {/* Sub-tabs */}
      <div className="flex items-center gap-1 bg-zinc-100 rounded-lg p-1 overflow-x-auto scrollbar-hide">
        {([
          { id: 'cancelamentos', label: 'Cancelamentos', count: cancelamentos.length },
          { id: 'estornos', label: 'Estornos', count: estornos.length },
          { id: 'descontos', label: 'Descontos', count: descontos.length },
          { id: 'gorjetas', label: 'Gorjetas', count: gorjetas.length },
        ] as { id: SubTab; label: string; count: number }[]).map((t) => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-md transition-colors cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${sub === t.id ? 'bg-white text-zinc-900' : 'text-zinc-500 hover:text-zinc-700'}`}>
            {t.label}
            {t.count > 0 && (
              <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${sub === t.id ? 'bg-zinc-100 text-zinc-600' : 'bg-zinc-200 text-zinc-500'}`}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {sub === 'cancelamentos' && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          {cancelamentos.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">Nenhum cancelamento no período</div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Pedido</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Destino</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Motivo</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Valor</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {cancelamentos.map((c, i) => (
                  <tr key={(c.id as string) ?? i} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono font-semibold text-zinc-700">{c.pedido as string}</td>
                    <td className="px-4 py-3 text-center text-zinc-600">{c.mesa as string}</td>
                    <td className="px-4 py-3 text-zinc-600 max-w-[200px] truncate">
                      <span className="px-2 py-0.5 bg-red-50 text-red-700 rounded-full text-[10px] font-medium">
                        {c.motivo as string}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-red-600">{fmt(c.valor as number)}</td>
                    <td className="px-4 py-3 text-center font-mono text-zinc-500">{c.hora as string}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-zinc-200">
                <tr>
                  <td colSpan={3} className="px-4 py-3 font-bold text-zinc-600">Total cancelamentos</td>
                  <td className="px-4 py-3 text-right font-black text-red-600">{fmt(totalCancelamentos)}</td>
                  <td />
                </tr>
              </tfoot>
            </table></div>
          )}
        </div>
      )}

      {sub === 'estornos' && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          {estornos.length === 0 ? (
            <div className="py-12 text-center text-zinc-400">
              <i className="ri-check-double-line text-3xl block mb-2" />
              <p className="text-sm">Nenhum estorno no período</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Pedido</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Cliente</th>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Motivo</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Valor</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {estornos.map((e, i) => (
                  <tr key={(e.id as string) ?? i} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono font-semibold text-zinc-700">{e.pedido as string}</td>
                    <td className="px-4 py-3 font-medium text-zinc-800">{e.cliente as string}</td>
                    <td className="px-4 py-3 text-zinc-600">{e.motivo as string}</td>
                    <td className="px-4 py-3 text-right font-bold text-orange-600">{fmt(e.valor as number)}</td>
                    <td className="px-4 py-3 text-center font-mono text-zinc-500">{e.hora as string}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {sub === 'descontos' && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          {descontos.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">Nenhum desconto no período</div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Pedido</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Destino</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">%</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Valor Desc.</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Hora</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {descontos.map((d, i) => (
                  <tr key={(d.id as string) ?? i} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-mono font-semibold text-zinc-700">{d.pedido as string}</td>
                    <td className="px-4 py-3 text-center text-zinc-600">{d.mesa as string}</td>
                    <td className="px-4 py-3 text-center font-bold text-amber-600">{d.pct as number}%</td>
                    <td className="px-4 py-3 text-right font-bold text-amber-600">{fmt(d.valor as number)}</td>
                    <td className="px-4 py-3 text-center font-mono text-zinc-500">{d.hora as string}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-zinc-200">
                <tr>
                  <td colSpan={3} className="px-4 py-3 font-bold text-zinc-600">Total descontos</td>
                  <td className="px-4 py-3 text-right font-black text-amber-600">{fmt(totalDescontos)}</td>
                  <td />
                </tr>
              </tfoot>
            </table></div>
          )}
        </div>
      )}

      {sub === 'gorjetas' && (
        <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-zinc-100 bg-zinc-50 flex items-center justify-between">
            <p className="text-xs font-bold text-zinc-700">Gorjetas por Garçom</p>
            <p className="text-xs font-bold text-emerald-600">Total: {fmt(totalGorjetas)}</p>
          </div>
          {gorjetas.length === 0 ? (
            <div className="py-12 text-center text-zinc-400 text-sm">Nenhuma gorjeta no período</div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-zinc-50 border-b border-zinc-100">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-zinc-500">Garçom</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">Pedidos</th>
                  <th className="px-4 py-3 text-center font-semibold text-zinc-500">% com gorjeta</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Total Gorjeta</th>
                  <th className="px-4 py-3 text-right font-semibold text-zinc-500">Média/Pedido</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-50">
                {[...gorjetas].sort((a, b) => (b.totalGorjeta as number) - (a.totalGorjeta as number)).map((g, i) => (
                  <tr key={i} className="hover:bg-zinc-50">
                    <td className="px-4 py-3 font-medium text-zinc-800">{g.garcom as string}</td>
                    <td className="px-4 py-3 text-center text-zinc-600">{g.pedidos as number}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center gap-2 justify-center">
                        <div className="w-14 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${g.pctPedidosGorjeta as number}%` }} />
                        </div>
                        <span className="font-bold text-emerald-600">{g.pctPedidosGorjeta as number}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-600">{fmt(g.totalGorjeta as number)}</td>
                    <td className="px-4 py-3 text-right text-zinc-600">{fmt(g.mediaGorjeta as number)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { PedidoRecente } from '@/types/pdv';
import { formatCurrency } from '@/lib/formatters';

interface PedidosMetricasProps {
  totalPedidos: number;
  totalValor: number;
  ticketMedio: number;
  emAberto: number;
  entregues: number;
  cancelados: number;
  pagos: number;
  pendentes: number;
  valorPago: number;
  slaMedio: number | null;
  filtrados: PedidoRecente[];
}

export default function PedidosMetricas({
  totalPedidos, totalValor, ticketMedio, emAberto, entregues, cancelados,
  pagos, pendentes, valorPago, slaMedio, filtrados,
}: PedidosMetricasProps) {
  const [mostrarAnalise, setMostrarAnalise] = useState(false);

  const metricCards = [
    { label: 'Total', value: totalPedidos, icon: 'ri-file-list-3-line', color: 'text-zinc-700', bg: 'bg-white', border: 'border-zinc-100' },
    { label: 'Faturamento', value: formatCurrency(totalValor), icon: 'ri-money-dollar-circle-line', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    { label: 'Ticket Médio', value: formatCurrency(ticketMedio), icon: 'ri-receipt-line', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-100' },
    { label: 'Em Aberto', value: emAberto, icon: 'ri-time-line', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-100' },
    { label: 'Entregues', value: entregues, icon: 'ri-check-double-line', color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-100' },
    { label: 'Cancelados', value: cancelados, icon: 'ri-close-circle-line', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-100' },
  ];

  const pagamentoCards = [
    { label: 'Pagos', value: pagos, sub: formatCurrency(valorPago), icon: 'ri-check-double-line', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-100' },
    ...(slaMedio !== null ? [{
      label: 'SLA médio cozinha',
      value: `${slaMedio}min`,
      sub: slaMedio <= 15 ? 'Dentro do alvo' : 'Acima do alvo',
      icon: 'ri-fire-line',
      color: slaMedio <= 15 ? 'text-emerald-700' : 'text-red-700',
      bg: slaMedio <= 15 ? 'bg-emerald-50' : 'bg-red-50',
      border: slaMedio <= 15 ? 'border-emerald-100' : 'border-red-100',
    }] : []),
  ];

  // Calcula horários de pico a partir dos pedidos filtrados
  const horariosData = (() => {
    const map: Record<string, { pedidos: number; valor: number }> = {};
    filtrados.forEach((p) => {
      const hora = p.criadoEm?.slice(0, 2) ?? '00';
      if (!map[hora]) map[hora] = { pedidos: 0, valor: 0 };
      map[hora].pedidos += 1;
      map[hora].valor += p.total ?? 0;
    });
    return Object.entries(map)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([hora, v]) => ({ hora: `${hora}h`, ...v }));
  })();

  return (
    <>
      {/* Cards de métricas */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 md:gap-3">
        {metricCards.map((m) => (
          <div key={m.label} className={`p-3 md:p-3.5 rounded-xl border ${m.bg} ${m.border}`}>
            <div className="flex items-center gap-1.5 mb-1 md:mb-1.5">
              <i className={`${m.icon} text-sm ${m.color}`} />
              <p className="text-[9px] md:text-[10px] font-semibold text-zinc-500 uppercase tracking-wide leading-tight">{m.label}</p>
            </div>
            <p className={`text-base md:text-lg font-black ${m.color}`}>{m.value}</p>
          </div>
        ))}
      </div>

      {/* Painel pagamentos + horários */}
      {totalPedidos > 0 && (
        <div className="bg-white rounded-xl border border-zinc-100 overflow-hidden">
          <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-50 flex-wrap gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              {pagamentoCards.map((c) => (
                <div key={c.label} className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${c.bg} ${c.border}`}>
                  <i className={`${c.icon} text-sm ${c.color}`} />
                  <div>
                    <p className="text-[9px] font-semibold text-zinc-500 uppercase tracking-wide leading-none">{c.label}</p>
                    <p className={`text-sm font-black ${c.color} leading-tight`}>{c.value}</p>
                    <p className="text-[9px] text-zinc-400 leading-none">{c.sub}</p>
                  </div>
                </div>
              ))}
            </div>
            <button
              onClick={() => setMostrarAnalise((v) => !v)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${mostrarAnalise ? 'bg-amber-100 text-amber-700' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'}`}
            >
              <i className="ri-bar-chart-2-line" />
              {mostrarAnalise ? 'Ocultar análise' : 'Horários de pico'}
            </button>
          </div>

          {mostrarAnalise && horariosData.length > 0 && (
            <div className="p-4">
              <div className="mb-3">
                <p className="text-xs font-semibold text-zinc-700">Distribuição de pedidos por hora</p>
                <p className="text-[10px] text-zinc-400">Identifique os horários de maior movimento no período selecionado</p>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={horariosData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      name === 'pedidos' ? `${v} pedidos` : `R$ ${v.toFixed(2)}`,
                      name === 'pedidos' ? 'Pedidos' : 'Faturamento',
                    ]}
                    contentStyle={{ borderRadius: 8, border: '1px solid #e4e4e7', fontSize: 11 }}
                  />
                  <Bar dataKey="pedidos" fill="#f59e0b" radius={[4, 4, 0, 0]} maxBarSize={32} />
                </BarChart>
              </ResponsiveContainer>
              {(() => {
                const pico = horariosData.reduce((a, b) => a.pedidos > b.pedidos ? a : b);
                return (
                  <span className="text-[10px] text-zinc-500 mt-2 block">
                    Pico: <strong className="text-amber-600">{pico.hora}</strong> com <strong className="text-amber-600">{pico.pedidos} pedidos</strong>
                  </span>
                );
              })()}
            </div>
          )}

          {mostrarAnalise && horariosData.length === 0 && (
            <div className="p-6 text-center text-zinc-400 text-xs">
              Sem dados de horário disponíveis para o período selecionado
            </div>
          )}
        </div>
      )}
    </>
  );
}

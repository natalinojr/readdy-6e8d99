import { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import type { PedidoRecente } from '@/types/pdv';
import { formatCurrency } from '@/lib/formatters';
import { KpiCard } from '@/pages/financeiro/components/dreUi';

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

  const slaOk = slaMedio !== null && slaMedio <= 15;

  return (
    <>
      {/* Cartões de resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6 gap-2 sm:gap-3">
        <KpiCard semVariacao atual={0} label="Total" icon="ri-file-list-3-line" value={String(totalPedidos)} />
        <KpiCard semVariacao atual={0} label="Faturamento" icon="ri-money-dollar-circle-line" value={formatCurrency(totalValor)} valueTone="text-emerald-700" />
        <KpiCard semVariacao atual={0} label="Ticket Médio" icon="ri-receipt-line" value={formatCurrency(ticketMedio)} valueTone="text-amber-700" />
        <KpiCard semVariacao atual={0} label="Em Aberto" icon="ri-time-line" value={String(emAberto)} valueTone="text-amber-700" />
        <KpiCard semVariacao atual={0} label="Entregues" icon="ri-check-double-line" value={String(entregues)} valueTone="text-emerald-700" />
        <KpiCard semVariacao atual={0} label="Cancelados" icon="ri-close-circle-line" value={String(cancelados)} valueTone="text-red-600" />
      </div>

      {/* Pagamentos + horários */}
      {totalPedidos > 0 && (
        <div className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
          <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-700 flex items-center gap-1">
                <i className="ri-check-double-line" /> Pagos: {pagos} · {formatCurrency(valorPago)}
              </span>
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 flex items-center gap-1">
                <i className="ri-time-line" /> Pendentes: {pendentes}
              </span>
              {slaMedio !== null && (
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md flex items-center gap-1 ${slaOk ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
                  <i className="ri-fire-line" /> SLA médio cozinha: {slaMedio}min · {slaOk ? 'Dentro do alvo' : 'Acima do alvo'}
                </span>
              )}
            </div>
            <button
              onClick={() => setMostrarAnalise((v) => !v)}
              className="flex items-center gap-1.5 px-3 py-2 border border-zinc-200 bg-white hover:bg-zinc-50 rounded-xl text-xs font-semibold text-zinc-600 cursor-pointer transition-colors whitespace-nowrap shadow-sm"
            >
              <i className="ri-bar-chart-2-line" />
              {mostrarAnalise ? 'Ocultar análise' : 'Horários de pico'}
            </button>
          </div>

          {mostrarAnalise && horariosData.length > 0 && (
            <div className="p-5">
              <div className="mb-3">
                <h3 className="text-sm font-bold text-zinc-800">Distribuição de pedidos por hora</h3>
                <p className="text-xs text-zinc-400">Identifique os horários de maior movimento no período selecionado</p>
              </div>
              <ResponsiveContainer width="100%" height={140}>
                <BarChart data={horariosData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                  <XAxis dataKey="hora" tick={{ fontSize: 11, fill: '#71717a' }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} allowDecimals={false} width={24} />
                  <Tooltip
                    formatter={(v: number, name: string) => [
                      name === 'pedidos' ? `${v} pedidos` : `R$ ${v.toFixed(2)}`,
                      name === 'pedidos' ? 'Pedidos' : 'Faturamento',
                    ]}
                    cursor={{ fill: '#fafafa' }}
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
            <div className="py-14 text-center text-zinc-400 text-sm">
              Sem dados de horário disponíveis para o período selecionado
            </div>
          )}
        </div>
      )}
    </>
  );
}

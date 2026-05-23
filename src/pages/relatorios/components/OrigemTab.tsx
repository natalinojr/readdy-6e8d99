import { useState, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { useOrigemReport, getPeriodoAnteriorOrigem, labelPeriodoAnteriorOrigem } from '@/hooks/useOrigemReport';
import { useSalesReportBySession } from '@/hooks/useSalesReport';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import type { SessionInfo } from '@/hooks/useSessions';

interface Props { periodo: string; externalSession?: SessionInfo | null; }

const fmt = (v: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);

const ICONES: Record<string, string> = {
  'Caixa': 'ri-store-line',
  'Garçom': 'ri-user-smile-line',
  'Mesa (QR)': 'ri-qr-code-line',
  'Autoatendimento': 'ri-tablet-line',
  'Delivery': 'ri-motorbike-line',
};

// Badge de variação
function VarBadge({ atual, anterior }: { atual: number; anterior: number }) {
  if (anterior <= 0) return null;
  const pct = ((atual - anterior) / anterior) * 100;
  const sobe = pct >= 0;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${sobe ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'}`}>
      <i className={sobe ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} />
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

const ORIGEM_LABEL: Record<string, string> = {
  cashier: 'Caixa',
  waiter: 'Garçom',
  table: 'Mesa (QR)',
  self_service: 'Autoatendimento',
  delivery: 'Delivery',
};

const ORIGEM_COR: Record<string, string> = {
  cashier: '#f59e0b',
  waiter: '#10b981',
  table: '#06b6d4',
  self_service: '#f97316',
  delivery: '#ef4444',
};

export default function OrigemTab({ periodo, externalSession }: Props) {
  const { modo } = useModoFaturamento();
  const isSessao = modo === 'sessao';
  const selectedSession = externalSession ?? null;

  // ── Modo calendário: usa o hook de origem por data ──
  const { dados: dadosData, loading: loadingData } = useOrigemReport(isSessao ? '' : periodo);

  // ── Modo sessão: usa o hook por session_id ──
  const { data: reportSessao, loading: loadingSessao } = useSalesReportBySession(
    isSessao ? (selectedSession?.id ?? null) : null
  );

  // ── Dados por hora no modo sessão (edge function não retorna, busca direto) ──
  const [horaSessao, setHoraSessao] = useState<any[]>([]);
  const [loadingHoraSessao, setLoadingHoraSessao] = useState(false);

  // Quando estiver no modo sessão, monta os dados por origem a partir do reportSessao
  const dados = useMemo(() => {
    if (!isSessao) return dadosData;
    if (!reportSessao) return { porOrigem: [], porHora: [], totalValor: 0, totalPedidos: 0 };

    const byDest = reportSessao.by_destination ?? [];
    let totalValor = 0;
    let totalPedidos = 0;

    const porOrigem = byDest
      .map((d) => {
        const key = d.destination ?? 'cashier';
        const valor = Number(d.revenue ?? 0);
        const pedidos = Number(d.orders ?? 0);
        totalValor += valor;
        totalPedidos += pedidos;
        return {
          origem: ORIGEM_LABEL[key] ?? key,
          origemKey: key,
          pedidos,
          valor,
          ticketMedio: pedidos > 0 ? Math.round((valor / pedidos) * 100) / 100 : 0,
          pct: 0,
          cor: ORIGEM_COR[key] ?? '#94a3b8',
        };
      })
      .sort((a, b) => b.valor - a.valor);

    // Recalcular percentuais
    porOrigem.forEach((o) => {
      o.pct = totalValor > 0 ? Math.round((o.valor / totalValor) * 1000) / 10 : 0;
    });

    return {
      porOrigem,
      porHora: [], // por hora não temos no modo sessão via RPC — simplificado
      totalValor: Math.round(totalValor * 100) / 100,
      totalPedidos,
    };
  }, [isSessao, dadosData, reportSessao]);

  const loading = isSessao ? loadingSessao : loadingData;

  const periodoAntStr = getPeriodoAnteriorOrigem(periodo);
  const labelAnt = labelPeriodoAnteriorOrigem(periodo);

  // Comparativo anterior — só no modo calendário (sessão não tem período anterior)
  const { dados: dadosAnt, loading: loadingAnt } = useOrigemReport(isSessao ? '' : periodoAntStr);

  const temDados = dados.porOrigem.length > 0;

  if (loading || (!isSessao && loadingAnt)) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="w-6 h-6 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Modo sessão sem sessão selecionada
  if (isSessao && !selectedSession) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-amber-50 rounded-2xl mb-4">
          <i className="ri-store-2-line text-3xl text-amber-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Selecione uma sessão no cabeçalho</p>
        <p className="text-xs text-zinc-400 mt-1">Use o seletor de sessão acima para ver os dados</p>
      </div>
    );
  }

  if (!temDados) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-zinc-400">
        <div className="w-16 h-16 flex items-center justify-center bg-zinc-100 rounded-2xl mb-4">
          <i className="ri-route-line text-3xl text-zinc-300" />
        </div>
        <p className="text-sm font-semibold text-zinc-500">Nenhum pedido registrado no período</p>
        <p className="text-xs text-zinc-400 mt-1">Registre pedidos no PDV para ver os dados por canal de origem</p>
        <p className="text-xs text-zinc-300 mt-1">Período: <strong className="text-zinc-400">{periodo}</strong></p>
      </div>
    );
  }

  const origens = dados.porOrigem;
  const porHora = dados.porHora;
  const total = dados.totalValor;
  const totalPedidos = dados.totalPedidos;
  const totalAnt = dadosAnt.totalValor;
  const totalPedidosAnt = dadosAnt.totalPedidos;

  const antMap = new Map(dadosAnt.porOrigem.map((o) => [o.origem, o]));

  return (
    <div className="space-y-5">
      {/* Comparativo global — apenas no modo calendário */}
      {!isSessao && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-zinc-50 border border-zinc-100 rounded-xl">
          <i className="ri-history-line text-zinc-400 text-sm flex-shrink-0" />
          <p className="text-xs text-zinc-500 flex-1">
            Comparando <span className="font-semibold text-zinc-700">{periodo}</span> com <span className="font-semibold text-zinc-700">{labelAnt}</span> (período proporcional anterior)
          </p>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400">Receita:</span>
              <VarBadge atual={total} anterior={totalAnt} />
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-400">Pedidos:</span>
              <VarBadge atual={totalPedidos} anterior={totalPedidosAnt} />
            </div>
          </div>
        </div>
      )}

      {/* Cards por origem */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {origens.map((o) => {
          const antOrig = antMap.get(o.origem);
          return (
            <div key={o.origemKey} className="bg-white border border-zinc-100 rounded-xl p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 flex items-center justify-center rounded-lg" style={{ backgroundColor: `${o.cor}20` }}>
                    <i className={`${ICONES[o.origem] ?? 'ri-store-line'} text-sm`} style={{ color: o.cor }} />
                  </div>
                  <span className="text-xs font-semibold text-zinc-600">{o.origem}</span>
                </div>
                {!isSessao && antOrig && <VarBadge atual={o.valor} anterior={antOrig.valor} />}
              </div>
              <p className="text-xl font-black text-zinc-900">{fmt(o.valor)}</p>
              {!isSessao && antOrig && (
                <p className="text-[10px] text-zinc-400 mt-0.5">Ant.: {fmt(antOrig.valor)}</p>
              )}
              <div className="flex items-center justify-between mt-1.5">
                <div className="flex items-center gap-1">
                  <p className="text-xs text-zinc-500">{o.pedidos} pedidos</p>
                  {!isSessao && antOrig && <VarBadge atual={o.pedidos} anterior={antOrig.pedidos} />}
                </div>
                <span className="text-xs font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${o.cor}15`, color: o.cor }}>
                  {o.pct.toFixed(1)}%
                </span>
              </div>
              <div className="mt-2 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full" style={{ width: `${o.pct}%`, backgroundColor: o.cor }} />
              </div>
              <p className="text-[10px] text-zinc-400 mt-1.5">Ticket médio: {fmt(o.ticketMedio)}</p>
            </div>
          );
        })}
      </div>

      {/* Resumo global */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-lg font-black text-zinc-900">{fmt(total)}</p>
          <p className="text-xs text-zinc-500">Faturamento total</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-lg font-black text-zinc-900">{totalPedidos}</p>
          <p className="text-xs text-zinc-500">Total de pedidos</p>
        </div>
        <div className="bg-white border border-zinc-100 rounded-xl p-4 text-center">
          <p className="text-lg font-black text-zinc-900">{totalPedidos > 0 ? fmt(total / totalPedidos) : 'R$ 0,00'}</p>
          <p className="text-xs text-zinc-500">Ticket médio geral</p>
        </div>
      </div>

      {/* Gráfico por hora — apenas no modo calendário (sessão não tem dados de hora) */}
      {!isSessao && porHora.length > 0 && (
        <div className="bg-white border border-zinc-100 rounded-xl p-5">
          <div className="mb-4">
            <h3 className="text-sm font-semibold text-zinc-800">Faturamento por Hora e Canal</h3>
            <p className="text-xs text-zinc-400">Evolução ao longo do dia por origem do pedido</p>
          </div>
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={porHora} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f4f4f5" vertical={false} />
                <XAxis dataKey="hora" tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#a1a1aa' }} axisLine={false} tickLine={false}
                  tickFormatter={(v) => `R$${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} width={44} />
                <Tooltip
                  formatter={(val: number, name: string) => [fmt(val), { caixa: 'Caixa', garcom: 'Garçom', mesa: 'Mesa (QR)', auto: 'Autoatendimento', delivery: 'Delivery' }[name] ?? name]}
                  contentStyle={{ borderRadius: 8, fontSize: 11, border: '1px solid #e4e4e7' }}
                />
                <Legend iconSize={8} wrapperStyle={{ fontSize: 10 }}
                  formatter={(v) => ({ caixa: 'Caixa', garcom: 'Garçom', mesa: 'Mesa (QR)', auto: 'Autoatendimento', delivery: 'Delivery' }[v] ?? v)}
                />
                <Bar dataKey="caixa" stackId="a" fill="#f59e0b" />
                <Bar dataKey="garcom" stackId="a" fill="#10b981" />
                <Bar dataKey="mesa" stackId="a" fill="#06b6d4" />
                <Bar dataKey="auto" stackId="a" fill="#f97316" />
                <Bar dataKey="delivery" stackId="a" fill="#ef4444" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Tabela comparativa */}
      <div className="bg-white border border-zinc-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 bg-zinc-50 border-b border-zinc-100 flex items-center justify-between">
          <p className="text-xs font-bold text-zinc-700">Comparativo por Canal</p>
          {!isSessao && <p className="text-[10px] text-zinc-400">vs. {labelAnt} (proporcional)</p>}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 border-b border-zinc-100">
              <tr>
                <th className="px-4 py-3 text-left font-semibold text-zinc-500">Canal</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">Pedidos</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">% Pedidos</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Faturamento</th>
                <th className="px-4 py-3 text-center font-semibold text-zinc-500">Var. Receita</th>
                <th className="px-4 py-3 text-right font-semibold text-zinc-500">Ticket Médio</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {origens.map((o) => {
                const antOrig = !isSessao ? antMap.get(o.origem) : null;
                return (
                  <tr key={o.origemKey} className="hover:bg-zinc-50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: o.cor }} />
                        <span className="font-medium text-zinc-800">{o.origem}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <span className="font-semibold text-zinc-700">{o.pedidos}</span>
                        {antOrig && <VarBadge atual={o.pedidos} anterior={antOrig.pedidos} />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ backgroundColor: `${o.cor}15`, color: o.cor }}>
                        {totalPedidos > 0 ? ((o.pedidos / totalPedidos) * 100).toFixed(1) : '0.0'}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-zinc-800">{fmt(o.valor)}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center gap-1.5 justify-center">
                        <div className="w-12 h-1.5 bg-zinc-100 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${o.pct}%`, backgroundColor: o.cor }} />
                        </div>
                        {antOrig ? (
                          <VarBadge atual={o.valor} anterior={antOrig.valor} />
                        ) : (
                          <span className="font-bold text-zinc-600">{o.pct.toFixed(1)}%</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-zinc-800">{fmt(o.ticketMedio)}</td>
                  </tr>
                );
              })}
            </tbody>
            {origens.length > 0 && (
              <tfoot className="border-t-2 border-zinc-200">
                <tr>
                  <td className="px-4 py-3 font-bold text-zinc-700">Total</td>
                  <td className="px-4 py-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <span className="font-black text-zinc-900">{totalPedidos}</span>
                      {!isSessao && <VarBadge atual={totalPedidos} anterior={totalPedidosAnt} />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-zinc-600">100%</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <span className="font-black text-zinc-900">{fmt(total)}</span>
                      {!isSessao && <VarBadge atual={total} anterior={totalAnt} />}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-zinc-600">100%</td>
                  <td className="px-4 py-3 text-right font-black text-zinc-900">{totalPedidos > 0 ? fmt(total / totalPedidos) : 'R$ 0,00'}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>
    </div>
  );
}
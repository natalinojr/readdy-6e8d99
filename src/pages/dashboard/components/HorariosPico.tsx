import { useMemo } from 'react';
import { useVisaoGeralExtras } from '@/hooks/useVisaoGeralExtras';

const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const HORAS_EXIBIR = [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

function intensidade(valor: number, max: number): string {
  if (max === 0 || valor === 0) return 'bg-zinc-100';
  const ratio = valor / max;
  if (ratio >= 0.85) return 'bg-amber-500';
  if (ratio >= 0.65) return 'bg-amber-400';
  if (ratio >= 0.45) return 'bg-amber-300';
  if (ratio >= 0.25) return 'bg-amber-200';
  if (ratio >= 0.1) return 'bg-amber-100';
  return 'bg-zinc-100';
}

function textIntensidade(valor: number, max: number): string {
  if (max === 0 || valor === 0) return 'text-zinc-300';
  const ratio = valor / max;
  if (ratio >= 0.65) return 'text-amber-900';
  return 'text-zinc-500';
}

export default function HorariosPico() {
  const { data: extras, loading } = useVisaoGeralExtras('30 dias');

  const horaAtual = new Date().getHours();
  const diaAtual = new Date().getDay();

  // Pico mais alto do dia de hoje (baseado nos dados de hora)
  const picoHoje = useMemo(() => {
    if (!extras?.by_hour) return null;
    const comMovimento = extras.by_hour.filter(h => h.orders > 0);
    if (comMovimento.length === 0) return null;
    return comMovimento.reduce((max, h) => h.orders > max.orders ? h : max, comMovimento[0]);
  }, [extras]);

  // Próximo horário de pico (hora com mais pedidos após a hora atual)
  const proximoPico = useMemo(() => {
    if (!extras?.by_hour) return null;
    const proximas = extras.by_hour.filter(h => h.hour > horaAtual && h.orders > 0);
    if (proximas.length === 0) return null;
    return proximas.reduce((max, h) => h.orders > max.orders ? h : max, proximas[0]);
  }, [extras, horaAtual]);

  // Hora atual com dados
  const dadosHoraAtual = extras?.by_hour.find(h => h.hour === horaAtual);

  // Máximo para normalização
  const maxOrders = useMemo(() => {
    if (!extras?.by_hour) return 1;
    return Math.max(...extras.by_hour.map(h => h.orders), 1);
  }, [extras]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-zinc-100 p-5 animate-pulse">
        <div className="h-4 bg-zinc-100 rounded w-32 mb-4" />
        <div className="grid grid-cols-17 gap-1">
          {Array.from({ length: 17 }).map((_, i) => (
            <div key={i} className="h-8 bg-zinc-100 rounded" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-zinc-100 p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 flex items-center justify-center bg-amber-50 rounded-lg">
            <i className="ri-fire-line text-amber-500 text-sm" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-zinc-800">Horários de Pico</h3>
            <p className="text-xs text-zinc-400">Distribuição de pedidos por hora — últimos 30 dias</p>
          </div>
        </div>

        {/* Indicadores rápidos */}
        <div className="flex items-center gap-3">
          {dadosHoraAtual && dadosHoraAtual.orders > 0 && (
            <div className="text-right">
              <p className="text-[10px] text-zinc-400">Agora ({horaAtual}h)</p>
              <p className="text-xs font-bold text-amber-600">{dadosHoraAtual.orders} ped. (média)</p>
            </div>
          )}
          {proximoPico && (
            <div className="text-right border-l border-zinc-100 pl-3">
              <p className="text-[10px] text-zinc-400">Próximo pico</p>
              <p className="text-xs font-bold text-zinc-700">{proximoPico.hour}h</p>
            </div>
          )}
        </div>
      </div>

      {/* Mapa de calor por hora */}
      <div>
        <div>
          {/* Sparkbar ACIMA — mais espaço e visível antes do heatmap */}
          <div className="flex items-end gap-1 mb-2 pl-8 h-14">
            {HORAS_EXIBIR.map(h => {
              const dado = extras?.by_hour.find(d => d.hour === h);
              const orders = dado?.orders ?? 0;
              const pct = maxOrders > 0 ? (orders / maxOrders) * 100 : 0;
              const isAtual = h === horaAtual;
              return (
                <div key={h} className="flex-1 flex items-end justify-center h-full">
                  <div
                    className={`w-full rounded-t transition-all duration-500 ${isAtual ? 'bg-amber-500' : 'bg-amber-200'}`}
                    style={{ height: `${Math.max(pct, orders > 0 ? 6 : 0)}%` }}
                  />
                </div>
              );
            })}
          </div>

          {/* Labels de hora */}
          <div className="flex items-center gap-1 mb-1 pl-8">
            {HORAS_EXIBIR.map(h => (
              <div
                key={h}
                className={`flex-1 text-center text-[9px] font-semibold ${h === horaAtual ? 'text-amber-600' : 'text-zinc-400'}`}
              >
                {h}h
              </div>
            ))}
          </div>

          {/* Heatmap de células */}
          <div className="flex items-center gap-1">
            <div className="w-8 text-[9px] text-zinc-400 font-medium text-right pr-1 flex-shrink-0">
              {DIAS_SEMANA[diaAtual]}
            </div>
            {HORAS_EXIBIR.map(h => {
              const dado = extras?.by_hour.find(d => d.hour === h);
              const orders = dado?.orders ?? 0;
              const isAtual = h === horaAtual;
              return (
                <div
                  key={h}
                  className={`flex-1 h-10 rounded flex items-center justify-center relative group cursor-default transition-all
                    ${intensidade(orders, maxOrders)}
                    ${isAtual ? 'ring-2 ring-amber-500 ring-offset-1' : ''}
                  `}
                >
                  {orders > 0 && (
                    <span className={`text-[9px] font-bold ${textIntensidade(orders, maxOrders)}`}>
                      {orders}
                    </span>
                  )}
                  {/* Tooltip aparece ABAIXO da célula para não ser cortado */}
                  <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 hidden group-hover:block z-20 pointer-events-none">
                    <div className="bg-zinc-900 text-white text-[10px] rounded-lg px-2.5 py-1.5 whitespace-nowrap shadow-lg">
                      <p className="font-semibold">{h}:00 — {h + 1}:00</p>
                      <p className="text-zinc-300">{orders} pedido{orders !== 1 ? 's' : ''} (média)</p>
                    </div>
                    <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-zinc-900 rotate-45" />
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Legenda + insights */}
      <div className="mt-4 pt-3 border-t border-zinc-100 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            {['bg-zinc-100', 'bg-amber-100', 'bg-amber-200', 'bg-amber-300', 'bg-amber-400', 'bg-amber-500'].map((cls, i) => (
              <div key={i} className={`w-4 h-3 rounded-sm ${cls}`} />
            ))}
          </div>
          <span className="text-[10px] text-zinc-400">Menos → Mais pedidos</span>
        </div>

        {picoHoje && (
          <div className="flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5">
            <i className="ri-fire-fill text-amber-500 text-xs" />
            <span className="text-xs font-semibold text-amber-700">
              Pico histórico: {picoHoje.hour}h ({picoHoje.orders} pedidos/dia em média)
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

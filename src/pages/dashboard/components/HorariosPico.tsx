import { useMemo } from 'react';
import { useDashboardPico } from '@/hooks/useDashboardPainel';

// Mapa de pico: média de pedidos por dia da semana × hora nas últimas 4 semanas (horário de Brasília).
// Dia de operação: a madrugada (até 5h59) fica na linha do dia anterior — sábado 1h é a noite de sábado.
// Antes era uma linha só, somando todos os dias, pela hora do aparelho e sem a madrugada.

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const ORDEM_DIAS = [1, 2, 3, 4, 5, 6, 0]; // Seg..Dom

function agoraBrasilia() {
  const partes = (dt: Date) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', hour12: false }).formatToParts(dt);
  const p = partes(new Date());
  const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0) % 24;
  // dia de operação = o dia de 6 horas atrás
  const wd = partes(new Date(Date.now() - 6 * 3600 * 1000)).find((x) => x.type === 'weekday')?.value ?? 'Sun';
  return { d: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd), h };
}

function cor(r: number) {
  if (r >= 0.85) return 'bg-amber-500 text-amber-950';
  if (r >= 0.65) return 'bg-amber-400 text-amber-950';
  if (r >= 0.45) return 'bg-amber-300 text-amber-900';
  if (r >= 0.25) return 'bg-amber-200 text-amber-800';
  if (r > 0) return 'bg-amber-100 text-amber-700';
  return 'bg-zinc-100 text-zinc-300';
}

const fmtN = (v: number) => (v >= 10 ? v.toFixed(0) : v.toFixed(1).replace('.', ',').replace(',0', ''));

export default function HorariosPico({ refreshKey = 0 }: { refreshKey?: number }) {
  const { data } = useDashboardPico(refreshKey);
  const agora = agoraBrasilia();

  const { mapa, horas, max, picoSemana, picoHoje } = useMemo(() => {
    const mapa = new Map<string, number>();
    let max = 0;
    let picoSemana: { d: number; h: number; p: number } | null = null;
    let picoHoje: { h: number; p: number } | null = null;
    const hs = new Set<number>();
    for (const c of data ?? []) {
      mapa.set(`${c.d}:${c.h}`, c.p);
      hs.add(c.h);
      if (c.p > max) max = c.p;
      if (!picoSemana || c.p > picoSemana.p) picoSemana = c;
      if (c.d === agora.d && (!picoHoje || c.p > picoHoje.p)) picoHoje = { h: c.h, p: c.p };
    }
    // Eixo do dia de operação: começa às 6h e vai até a madrugada; só as horas que tiveram pedido.
    const op = (h: number) => (h + 24 - 6) % 24;
    const horas = [...hs].sort((a, b) => op(a) - op(b));
    if (horas.length > 0) {
      const ini = op(horas[0]);
      const fim = op(horas[horas.length - 1]);
      horas.length = 0;
      for (let x = ini; x <= fim; x++) horas.push((x + 6) % 24);
    }
    return { mapa, horas, max, picoSemana, picoHoje };
  }, [data, agora.d]);

  return (
    <section className="bg-white rounded-2xl border border-zinc-200">
      <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-100 gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-bold text-zinc-800">Horários de pico</h3>
          <p className="text-xs text-zinc-400">Média de pedidos por hora · últimas 4 semanas</p>
        </div>
        <div className="flex items-center gap-2 text-xs flex-wrap">
          {picoHoje && (
            <span className="bg-zinc-50 border border-zinc-200 rounded-lg px-2.5 py-1 text-zinc-600">
              Hoje ({DIAS[agora.d].toLowerCase()}) o pico costuma ser <b className="text-zinc-800">{picoHoje.h}h</b>
            </span>
          )}
          {picoSemana && (
            <span className="bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-2.5 py-1 font-semibold">
              <i className="ri-fire-fill" /> Semana: {DIAS[picoSemana.d]} {picoSemana.h}h
            </span>
          )}
        </div>
      </div>

      <div className="p-5 overflow-x-auto">
        {!data ? (
          <div className="h-48 rounded-xl bg-zinc-50 animate-pulse" />
        ) : horas.length === 0 ? (
          <div className="py-10 text-center">
            <i className="ri-fire-line text-3xl text-zinc-200" />
            <p className="text-zinc-400 text-sm mt-1">Ainda sem pedidos nas últimas 4 semanas</p>
          </div>
        ) : (
          <div style={{ minWidth: Math.max(480, horas.length * 30 + 48) }}>
            <div className="flex gap-1 mb-1 pl-10">
              {horas.map((h) => (
                <div key={h} className={`flex-1 text-center text-[9px] font-semibold ${h === agora.h ? 'text-amber-600' : 'text-zinc-400'}`}>{h}h</div>
              ))}
            </div>
            {ORDEM_DIAS.map((d) => (
              <div key={d} className="flex gap-1 mb-1 items-center">
                <div className={`w-10 text-[10px] text-right pr-1.5 ${d === agora.d ? 'font-bold text-amber-600' : 'text-zinc-400'}`}>{DIAS[d]}</div>
                {horas.map((h) => {
                  const v = mapa.get(`${d}:${h}`) ?? 0;
                  const ehAgora = d === agora.d && h === agora.h;
                  return (
                    <div key={h} title={`${DIAS[d]} ${h}h: em média ${fmtN(v)} pedido${v === 1 ? '' : 's'}`}
                      className={`flex-1 h-8 rounded-md text-[10px] font-bold flex items-center justify-center tabular-nums ${cor(max > 0 ? v / max : 0)} ${ehAgora ? 'ring-2 ring-zinc-800 ring-offset-1' : ''}`}>
                      {v > 0 ? fmtN(v) : ''}
                    </div>
                  );
                })}
              </div>
            ))}
            <div className="flex items-center gap-2 mt-3 pl-10 text-[10px] text-zinc-400 flex-wrap">
              <span>menos</span>
              {['bg-zinc-100', 'bg-amber-100', 'bg-amber-200', 'bg-amber-300', 'bg-amber-400', 'bg-amber-500'].map((c) => (
                <span key={c} className={`w-4 h-3 rounded-sm ${c}`} />
              ))}
              <span>mais</span>
              <span className="ml-3 inline-flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm ring-2 ring-zinc-800" /> agora</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

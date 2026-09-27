import { useMemo } from 'react';

// Mapa de calor dia da semana × hora (Brasília): cor = nº de pedidos, totais em R$ por dia (direita) e por hora (embaixo).
// Usado em Relatórios › iFood e › Calendário.

export interface PontoSemanaHora {
  semana: number; // 0 = domingo
  hora: number; // 0-23 Brasília
  valor: number;
}

const brl = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(v);
const brl0 = (v: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(v);
const SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const SEMANA_LONGA = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

/** rgb = "234,29,44" (a opacidade vem do nº de pedidos); texto = cor do número nas células claras. */
export default function HeatmapSemanaHora({ pontos, rgb = '234,29,44', texto = '#9f1239' }: { pontos: PontoSemanaHora[]; rgb?: string; texto?: string }) {
  const heat = useMemo(() => {
    const g: { n: number; v: number }[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, v: 0 })));
    for (const p of pontos) { g[p.semana][p.hora].n += 1; g[p.semana][p.hora].v += p.valor; }
    // Só as horas com pedido (hora sem nenhum pedido no período some da tabela).
    const horas = [...Array(24).keys()].filter((h) => g.some((l) => l[h].n > 0));
    const max = Math.max(1, ...g.flat().map((c) => c.n));
    const porSemana = g.map((l) => l.reduce((a, c) => a + c.v, 0));
    const porHora = g[0].map((_, h) => ({ n: g.reduce((a, l) => a + l[h].n, 0), v: g.reduce((a, l) => a + l[h].v, 0) }));
    const totalV = porSemana.reduce((a, v) => a + v, 0);
    return { g, horas, max, porSemana, porHora, totalV };
  }, [pontos]);

  if (!heat.horas.length) return <p className="text-sm text-zinc-400 text-center py-10">Nenhum pedido no período.</p>;

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px] min-w-full" style={{ gridTemplateColumns: `36px repeat(${heat.horas.length}, minmax(54px, 1fr)) 70px` }}>
        <div />
        {heat.horas.map((h) => <div key={h} className="text-[10px] text-zinc-400 text-center">{h}h</div>)}
        <div className="text-[10px] text-zinc-400 text-right pr-1">Total</div>
        {heat.g.map((linha, s) => (
          <div key={s} className="contents">
            <div className="text-[11px] font-semibold text-zinc-500 flex items-center">{SEMANA[s]}</div>
            {heat.horas.map((h) => {
              const c = linha[h];
              const a = c.n / heat.max;
              return (
                <div key={h} title={`${SEMANA_LONGA[s]} ${h}h: ${c.n} pedidos · ${brl(c.v)}`}
                  className="h-7 rounded-md flex items-center justify-center text-[10px] font-bold"
                  style={{ background: c.n ? `rgba(${rgb},${0.1 + a * 0.85})` : '#fafafa', color: a > 0.5 ? '#fff' : texto }}>
                  {c.n || ''}
                </div>
              );
            })}
            <div className="text-[11px] text-zinc-600 font-semibold text-right pr-1 flex items-center justify-end tabular-nums">{brl0(heat.porSemana[s])}</div>
          </div>
        ))}
        <div className="text-[11px] font-semibold text-zinc-500 flex items-center pt-1 border-t border-zinc-100">Total</div>
        {heat.horas.map((h) => (
          <div key={h} title={`${h}h: ${heat.porHora[h].n} pedidos · ${brl(heat.porHora[h].v)}`}
            className="text-[10px] text-zinc-600 font-semibold text-center pt-1 border-t border-zinc-100 tabular-nums whitespace-nowrap">
            {heat.porHora[h].v ? brl0(heat.porHora[h].v) : ''}
          </div>
        ))}
        <div className="text-[11px] text-zinc-800 font-bold text-right pr-1 pt-1 border-t border-zinc-100 flex items-center justify-end tabular-nums">{brl0(heat.totalV)}</div>
      </div>
    </div>
  );
}

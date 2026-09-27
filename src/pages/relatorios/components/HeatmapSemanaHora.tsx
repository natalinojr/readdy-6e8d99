import { useMemo, useState } from 'react';

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
    // Da 1ª à última hora com pedido; hora vazia no meio aparece, mas estreita (ver colunas abaixo).
    let horas = [...Array(24).keys()].filter((h) => g.some((l) => l[h].n > 0));
    if (horas.length) { const a = Math.min(...horas), b = Math.max(...horas); horas = [...Array(b - a + 1).keys()].map((i) => a + i); }
    const max = Math.max(1, ...g.flat().map((c) => c.n));
    const porSemana = g.map((l) => l.reduce((a, c) => a + c.v, 0));
    const pedSemana = g.map((l) => l.reduce((a, c) => a + c.n, 0));
    const porHora = g[0].map((_, h) => ({ n: g.reduce((a, l) => a + l[h].n, 0), v: g.reduce((a, l) => a + l[h].v, 0) }));
    const totalV = porSemana.reduce((a, v) => a + v, 0);
    return { g, horas, max, porSemana, pedSemana, porHora, totalV };
  }, [pontos]);

  // Balão de informações ao passar o mouse (s = -1: linha de total da hora).
  const [dica, setDica] = useState<{ s: number; h: number; x: number; y: number; baixo: boolean } | null>(null);
  const mostrar = (s: number, h: number) => (e: React.MouseEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const baixo = r.top < 150;
    setDica({ s, h, x: Math.min(Math.max(r.left + r.width / 2, 110), window.innerWidth - 110), y: baixo ? r.bottom + 8 : r.top - 8, baixo });
  };
  const esconder = () => setDica(null);

  if (!heat.horas.length) return <p className="text-sm text-zinc-400 text-center py-10">Nenhum pedido no período.</p>;

  return (
    <div className="overflow-x-auto">
      <div className="inline-grid gap-[3px] min-w-full" style={{ gridTemplateColumns: `36px ${heat.horas.map((h) => (heat.porHora[h].n ? 'minmax(54px, 1fr)' : '22px')).join(' ')} 70px` }}>
        <div />
        {heat.horas.map((h) => <div key={h} className={`text-zinc-400 text-center ${heat.porHora[h].n ? 'text-[10px]' : 'text-[8px]'}`}>{h}h</div>)}
        <div className="text-[10px] text-zinc-400 text-right pr-1">Total</div>
        {heat.g.map((linha, s) => (
          <div key={s} className="contents">
            <div className="text-[11px] font-semibold text-zinc-500 flex items-center">{SEMANA[s]}</div>
            {heat.horas.map((h) => {
              const c = linha[h];
              const a = c.n / heat.max;
              return (
                <div key={h} onMouseEnter={mostrar(s, h)} onMouseLeave={esconder}
                  className={`h-7 rounded-md flex items-center justify-center text-[10px] font-bold cursor-default transition-shadow ${dica?.s === s && dica.h === h ? 'ring-2 ring-zinc-800/70' : ''}`}
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
          <div key={h} onMouseEnter={mostrar(-1, h)} onMouseLeave={esconder}
            className="cursor-default text-[10px] text-zinc-600 font-semibold text-center pt-1 border-t border-zinc-100 tabular-nums whitespace-nowrap">
            {heat.porHora[h].v ? brl0(heat.porHora[h].v) : ''}
          </div>
        ))}
        <div className="text-[11px] text-zinc-800 font-bold text-right pr-1 pt-1 border-t border-zinc-100 flex items-center justify-end tabular-nums">{brl0(heat.totalV)}</div>
      </div>
      {dica && <Balao heat={heat} dica={dica} rgb={rgb} />}
    </div>
  );
}

const pct = (v: number) => `${(v * 100).toFixed(v >= 0.1 ? 0 : 1).replace('.', ',')}%`;

function Balao({ heat, dica, rgb }: {
  heat: { g: { n: number; v: number }[][]; porSemana: number[]; pedSemana: number[]; porHora: { n: number; v: number }[]; totalV: number };
  dica: { s: number; h: number; x: number; y: number; baixo: boolean };
  rgb: string;
}) {
  const { s, h } = dica;
  const total = s < 0;
  const c = total ? heat.porHora[h] : heat.g[s][h];
  const faixa = `${String(h).padStart(2, '0')}h–${String((h + 1) % 24).padStart(2, '0')}h`;
  const titulo = total ? 'Todos os dias' : SEMANA_LONGA[s][0].toUpperCase() + SEMANA_LONGA[s].slice(1);
  const linhas: [string, string][] = c.n ? [
    ['Vendas', brl(c.v)],
    ['Ticket médio', brl(c.v / c.n)],
    ...(total
      ? [['Do total do período', pct(heat.totalV ? c.v / heat.totalV : 0)] as [string, string]]
      : [
          ['Do dia', pct(heat.porSemana[s] ? c.v / heat.porSemana[s] : 0)] as [string, string],
          ['Do horário', pct(heat.porHora[h].v ? c.v / heat.porHora[h].v : 0)] as [string, string],
        ]),
  ] : [];

  return (
    <div className="fixed z-50 pointer-events-none w-[200px]"
      style={{ left: dica.x, top: dica.y, transform: `translate(-50%, ${dica.baixo ? '0' : '-100%'})` }}>
      <div className="rounded-xl bg-zinc-900/95 text-white shadow-xl ring-1 ring-black/10 backdrop-blur-sm overflow-hidden">
        <div className="flex items-center gap-2 px-3 pt-2.5 pb-2 border-b border-white/10">
          <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: `rgb(${rgb})` }} />
          <span className="text-xs font-bold">{titulo}</span>
          <span className="ml-auto text-[11px] text-zinc-400 tabular-nums">{faixa}</span>
        </div>
        <div className="px-3 py-2">
          <div className="flex items-baseline gap-1.5">
            <span className="text-xl font-black tabular-nums">{c.n}</span>
            <span className="text-[11px] text-zinc-400">{c.n === 1 ? 'pedido' : 'pedidos'}</span>
          </div>
          {c.n ? (
            <div className="mt-1.5 space-y-1">
              {linhas.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-[11px]">
                  <span className="text-zinc-400">{k}</span>
                  <span className="font-semibold tabular-nums">{v}</span>
                </div>
              ))}
            </div>
          ) : <p className="text-[11px] text-zinc-500 mt-0.5">Nenhum pedido nesse horário.</p>}
        </div>
      </div>
    </div>
  );
}

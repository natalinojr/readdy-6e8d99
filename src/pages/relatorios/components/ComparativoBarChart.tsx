import { useMemo, useState } from 'react';

interface DataPoint {
  nome: string;
  atual: number;
  anterior: number;
  unidade: string;
}

interface Props {
  dados: DataPoint[];
  titulo: string;
  maxItens?: number;
}

const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);

export default function ComparativoBarChart({ dados, titulo, maxItens = 15 }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { width, height, padding } = { width: 700, height: 320, padding: { top: 30, right: 20, bottom: 80, left: 60 } };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const dadosLimitados = useMemo(() => dados.slice(0, maxItens), [dados, maxItens]);

  const { maxVal, barW, groupW, bars } = useMemo(() => {
    if (dadosLimitados.length === 0) {
      return { maxVal: 1, barW: 0, groupW: 0, bars: [] };
    }

    const maxVal = Math.max(...dadosLimitados.map((d) => Math.max(d.atual, d.anterior)), 0.1);
    const groupW = chartW / dadosLimitados.length;
    const barW = Math.min(groupW * 0.35, 28);
    const gap = groupW * 0.1;

    const bars = dadosLimitados.map((d, i) => {
      const x = padding.left + i * groupW + groupW / 2;
      const hAtual = (d.atual / maxVal) * chartH;
      const hAnterior = (d.anterior / maxVal) * chartH;
      const yAtual = padding.top + chartH - hAtual;
      const yAnterior = padding.top + chartH - hAnterior;

      return {
        x,
        yAtual,
        yAnterior,
        hAtual,
        hAnterior,
        barW,
        gap,
        nome: d.nome,
        atual: d.atual,
        anterior: d.anterior,
        unidade: d.unidade,
      };
    });

    return { maxVal, barW, groupW, bars };
  }, [dadosLimitados, chartW, chartH]);

  if (dadosLimitados.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400">
        <p className="text-xs">Sem dados suficientes para o gráfico</p>
      </div>
    );
  }

  const yTicks = 5;

  return (
    <div className="relative">
      <p className="text-xs font-semibold text-zinc-600 mb-2">{titulo}</p>

      {/* Legenda */}
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-amber-400 rounded-sm" />
          <span className="text-[10px] text-zinc-500">Período atual</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-3 bg-zinc-300 rounded-sm" />
          <span className="text-[10px] text-zinc-500">Período anterior</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: 340 }}>
        {/* Grid Y */}
        {Array.from({ length: yTicks + 1 }, (_, i) => {
          const y = padding.top + chartH - (i / yTicks) * chartH;
          const val = (i / yTicks) * maxVal;
          return (
            <g key={i}>
              <line x1={padding.left} y1={y} x2={width - padding.right} y2={y} stroke="#f4f4f5" strokeWidth={1} />
              <text x={padding.left - 6} y={y + 3} textAnchor="end" fontSize={9} fill="#a1a1aa">
                {fmtNum(val)}
              </text>
            </g>
          );
        })}

        {/* Barras */}
        {bars.map((b, i) => (
          <g
            key={i}
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
            className="cursor-pointer"
          >
            {/* Barra anterior (cinza) */}
            <rect
              x={b.x - b.barW - b.gap / 2}
              y={b.yAnterior}
              width={b.barW}
              height={b.hAnterior}
              fill={hoverIdx === i ? '#a1a1aa' : '#d4d4d8'}
              rx={2}
              className="transition-colors duration-150"
            />
            {/* Barra atual (âmbar) */}
            <rect
              x={b.x + b.gap / 2}
              y={b.yAtual}
              width={b.barW}
              height={b.hAtual}
              fill={hoverIdx === i ? '#f59e0b' : '#fbbf24'}
              rx={2}
              className="transition-colors duration-150"
            />

            {/* Label do nome (rotacionado) */}
            <text
              x={b.x}
              y={padding.top + chartH + 14}
              textAnchor="end"
              fontSize={8}
              fill="#71717a"
              transform={`rotate(-45, ${b.x}, ${padding.top + chartH + 14})`}
            >
              {b.nome.length > 18 ? b.nome.slice(0, 18) + '...' : b.nome}
            </text>
          </g>
        ))}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && bars[hoverIdx] && (
        <div
          className="absolute bg-zinc-800 text-white text-[10px] px-2.5 py-1.5 rounded-lg pointer-events-none z-10 whitespace-nowrap"
          style={{
            left: Math.min(Math.max(bars[hoverIdx].x - 60, 0), width - 140),
            top: Math.min(Math.max(Math.min(bars[hoverIdx].yAtual, bars[hoverIdx].yAnterior) - 55, 0), height - 80),
          }}
        >
          <p className="font-semibold truncate max-w-[180px]">{bars[hoverIdx].nome}</p>
          <div className="flex items-center gap-1.5 mt-0.5">
            <div className="w-2 h-2 bg-amber-400 rounded-sm" />
            <span>Atual: {fmtNum(bars[hoverIdx].atual)} {bars[hoverIdx].unidade}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 bg-zinc-300 rounded-sm" />
            <span>Anterior: {fmtNum(bars[hoverIdx].anterior)} {bars[hoverIdx].unidade}</span>
          </div>
          <p className="text-zinc-400 mt-0.5">
            Var: {bars[hoverIdx].anterior > 0
              ? (((bars[hoverIdx].atual - bars[hoverIdx].anterior) / bars[hoverIdx].anterior) * 100).toFixed(1)
              : '0'}%
          </p>
        </div>
      )}
    </div>
  );
}
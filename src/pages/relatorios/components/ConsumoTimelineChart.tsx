import { useMemo, useState } from 'react';
import type { TimelinePoint } from '../../../hooks/useConsumoTimeline';

interface Props {
  dados: TimelinePoint[];
  unidade: string;
  nome: string;
}

const fmtNum = (v: number) =>
  new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(v);

const fmtDia = (dia: string) => {
  const d = new Date(dia + 'T00:00:00');
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
};

export default function ConsumoTimelineChart({ dados, unidade, nome }: Props) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const { width, height, padding } = { width: 600, height: 200, padding: { top: 20, right: 20, bottom: 40, left: 50 } };

  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const { maxConsumo, maxEstoque, minEstoque, consumoPath, estoquePath, estoqueAreaPath, points } = useMemo(() => {
    if (dados.length === 0) {
      return { maxConsumo: 1, maxEstoque: 1, minEstoque: 0, consumoPath: '', estoquePath: '', estoqueAreaPath: '', points: [] };
    }

    const maxConsumo = Math.max(...dados.map((d) => d.consumo), 0.1);
    const maxEstoque = Math.max(...dados.map((d) => d.estoque), 0.1);
    const minEstoque = Math.min(...dados.map((d) => d.estoque), 0);
    const maxVal = Math.max(maxConsumo, maxEstoque);

    const stepX = chartW / Math.max(dados.length - 1, 1);

    const consumoPoints = dados.map((d, i) => ({
      x: padding.left + i * stepX,
      y: padding.top + chartH - (d.consumo / maxVal) * chartH,
      consumo: d.consumo,
      estoque: d.estoque,
      dia: d.dia,
    }));

    const estoquePoints = dados.map((d, i) => ({
      x: padding.left + i * stepX,
      y: padding.top + chartH - (d.estoque / maxVal) * chartH,
    }));

    const consumoPath = consumoPoints.length > 0
      ? `M ${consumoPoints[0].x} ${consumoPoints[0].y} ` +
        consumoPoints.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')
      : '';

    const estoquePath = estoquePoints.length > 0
      ? `M ${estoquePoints[0].x} ${estoquePoints[0].y} ` +
        estoquePoints.slice(1).map((p) => `L ${p.x} ${p.y}`).join(' ')
      : '';

    const estoqueAreaPath = estoquePoints.length > 0
      ? `M ${estoquePoints[0].x} ${padding.top + chartH} ` +
        estoquePoints.map((p) => `L ${p.x} ${p.y}`).join(' ') +
        ` L ${estoquePoints[estoquePoints.length - 1].x} ${padding.top + chartH} Z`
      : '';

    return { maxConsumo, maxEstoque, minEstoque, consumoPath, estoquePath, estoqueAreaPath, points: consumoPoints };
  }, [dados, chartW, chartH]);

  if (dados.length === 0) {
    return (
      <div className="flex items-center justify-center py-8 text-zinc-400">
        <p className="text-xs">Sem dados de consumo para o período</p>
      </div>
    );
  }

  const yTicks = 5;
  const maxVal = Math.max(maxConsumo, maxEstoque);

  return (
    <div className="relative">
      {/* Legenda */}
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-red-400 rounded-full" />
          <span className="text-[10px] text-zinc-500">Consumo</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-3 h-0.5 bg-emerald-400 rounded-full" />
          <span className="text-[10px] text-zinc-500">Estoque</span>
        </div>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto" style={{ maxHeight: 220 }}>
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

        {/* Área do estoque */}
        {estoqueAreaPath && (
          <path d={estoqueAreaPath} fill="rgba(52,211,153,0.08)" />
        )}

        {/* Linha do estoque */}
        {estoquePath && (
          <path d={estoquePath} fill="none" stroke="#34d399" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        )}

        {/* Linha do consumo */}
        {consumoPath && (
          <path d={consumoPath} fill="none" stroke="#f87171" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" strokeDasharray="4 3" />
        )}

        {/* Pontos do consumo */}
        {points.map((p, i) => (
          <circle
            key={i}
            cx={p.x}
            cy={p.y}
            r={hoverIdx === i ? 4 : 2.5}
            fill="#f87171"
            className="transition-all duration-150"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}

        {/* Eixo X - labels */}
        {dados.map((d, i) => {
          const stepX = chartW / Math.max(dados.length - 1, 1);
          const x = padding.left + i * stepX;
          const showLabel = dados.length <= 10 || i % Math.ceil(dados.length / 10) === 0 || i === dados.length - 1;
          if (!showLabel) return null;
          return (
            <text key={i} x={x} y={height - 12} textAnchor="middle" fontSize={8} fill="#a1a1aa">
              {fmtDia(d.dia)}
            </text>
          );
        })}
      </svg>

      {/* Tooltip */}
      {hoverIdx !== null && points[hoverIdx] && (
        <div
          className="absolute bg-zinc-800 text-white text-[10px] px-2.5 py-1.5 rounded-lg pointer-events-none z-10 whitespace-nowrap"
          style={{
            left: Math.min(Math.max(points[hoverIdx].x - 40, 0), width - 100),
            top: Math.max(points[hoverIdx].y - 50, 0),
          }}
        >
          <p className="font-semibold">{fmtDia(points[hoverIdx].dia)}</p>
          <p>Consumo: {fmtNum(points[hoverIdx].consumo)} {unidade}</p>
          <p>Estoque: {fmtNum(points[hoverIdx].estoque)} {unidade}</p>
        </div>
      )}
    </div>
  );
}
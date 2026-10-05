import { posDia, segmentosTrilho, txtJanelas, type Janela } from './horarioUtil';

// Barra do dia: vai das 6h às 6h do dia seguinte (horário que passa da meia-noite cabe inteiro).
// Faixa âmbar = aberto; linha preta = agora (quando `agora` vem em minutos do dia, hora de Brasília).
const GRADE = 'linear-gradient(90deg, transparent calc(25% - 1px), #e4e4e7 calc(25% - 1px), #e4e4e7 25%, transparent 25%, transparent calc(50% - 1px), #e4e4e7 calc(50% - 1px), #e4e4e7 50%, transparent 50%, transparent calc(75% - 1px), #e4e4e7 calc(75% - 1px), #e4e4e7 75%, transparent 75%)';

export default function Trilho({ janelas, agora = null, grande = false }: {
  janelas: Janela[];
  agora?: number | null;
  grande?: boolean;
}) {
  const segs = segmentosTrilho(janelas);
  return (
    <div className={`relative ${grande ? 'h-[18px]' : 'h-3'}`} role="img" aria-label={`Aberto: ${txtJanelas(janelas).toLowerCase()}`}>
      <div className={`absolute inset-0 overflow-hidden bg-zinc-100 ${grande ? 'rounded-full' : 'rounded-md'}`} style={{ backgroundImage: GRADE }}>
        {segs.map((s, k) => (
          <i key={k} className={`absolute inset-y-0 block bg-amber-500 ${grande ? 'rounded-full' : 'rounded-md'}`} style={{ left: `${s.left}%`, width: `${s.width}%` }} />
        ))}
      </div>
      {agora != null && (
        <i className="absolute -top-0.5 -bottom-0.5 block w-0.5 bg-zinc-900" style={{ left: `calc(${Math.min(posDia(agora), 99.6)}% - 1px)` }} />
      )}
    </div>
  );
}

/** Eixo da barra: 6h, 12h, 18h, 0h, 6h. */
export function EixoHoras() {
  const marcas: [string, number][] = [['6h', 0], ['12h', 25], ['18h', 50], ['0h', 75], ['6h', 100]];
  return (
    <div className="relative h-3.5" aria-hidden>
      {marcas.map(([t, x], k) => (
        <b key={k} className="absolute top-0 text-[9.5px] font-extrabold text-zinc-400"
          style={{ left: `${x}%`, transform: x === 0 ? 'none' : x === 100 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{t}</b>
      ))}
    </div>
  );
}

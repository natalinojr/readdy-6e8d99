// Desenho da roleta do clube — usado na configuração (Clientes & Marketing ›
// Fidelidade) e no tablet. Só desenha e gira: quem sorteia é o banco
// (fn_fidelidade_girar); a tela recebe o índice do prêmio e gira até ele.
import { chancesRoleta } from '@/lib/fidelidade';

export interface FatiaRoleta { id: string; nome: string; cor: string; peso: number }

/** Rotação (graus) que para a roleta no meio da fatia `indice`, partindo de `rotacaoAtual`
 *  e dando `voltas` voltas inteiras antes. A seta fica em cima (0°). */
export function rotacaoParaFatia(premios: FatiaRoleta[], indice: number, rotacaoAtual: number, voltas = 5): number {
  const { chances } = chancesRoleta(premios);
  let acc = 0;
  for (let i = 0; i < indice; i++) acc += chances[i]?.chance ?? 0;
  const meio = (acc + (chances[indice]?.chance ?? 0) / 2) * 360;
  return rotacaoAtual - (rotacaoAtual % 360) + 360 * voltas + (360 - meio);
}

export default function RoletaSvg({ premios, rotacao, tamanho = 'w-56 h-56', seta = 'border-t-zinc-800' }: {
  premios: FatiaRoleta[];
  rotacao: number;
  tamanho?: string;
  seta?: string;
}) {
  const { chances } = chancesRoleta(premios);
  const R = 100;
  let acc = 0;
  const fatias = premios.map((p, i) => {
    const ch = chances[i].chance;
    const ini = acc * 2 * Math.PI;
    acc += ch;
    const fim = acc * 2 * Math.PI;
    const x1 = R + R * Math.sin(ini), y1 = R - R * Math.cos(ini);
    const x2 = R + R * Math.sin(fim), y2 = R - R * Math.cos(fim);
    const grande = fim - ini > Math.PI ? 1 : 0;
    const meio = (ini + fim) / 2;
    const d = ch >= 0.9999
      ? `M ${R} 0 A ${R} ${R} 0 1 1 ${R - 0.01} 0 Z`
      : `M ${R} ${R} L ${x1} ${y1} A ${R} ${R} 0 ${grande} 1 ${x2} ${y2} Z`;
    return { p, d, meio, ch };
  });
  return (
    <div className={`relative mx-auto ${tamanho}`}>
      <div className={`absolute left-1/2 -top-1 -translate-x-1/2 z-10 w-0 h-0 border-l-[10px] border-r-[10px] border-t-[18px] border-l-transparent border-r-transparent ${seta}`} />
      <svg viewBox="-4 -4 208 208" className="w-full h-full" style={{ transform: `rotate(${rotacao}deg)`, transition: 'transform 3.2s cubic-bezier(.15,.85,.25,1)' }}>
        {fatias.map(({ p, d }) => <path key={p.id} d={d} fill={p.cor} stroke="#fff" strokeWidth={2} />)}
        {fatias.map(({ p, meio, ch }) => ch >= 0.05 && (
          <text
            key={`t_${p.id}`}
            x={R + R * 0.62 * Math.sin(meio)} y={R - R * 0.62 * Math.cos(meio)}
            textAnchor="middle" dominantBaseline="middle" fontSize={8} fontWeight={700} fill="#fff"
            transform={`rotate(${(meio * 180) / Math.PI} ${R + R * 0.62 * Math.sin(meio)} ${R - R * 0.62 * Math.cos(meio)})`}
          >
            {p.nome.length > 16 ? p.nome.slice(0, 15) + '…' : p.nome}
          </text>
        ))}
        <circle cx={R} cy={R} r={14} fill="#fff" stroke="#e4e4e7" strokeWidth={2} />
      </svg>
    </div>
  );
}

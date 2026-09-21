// Filtros novos de Candidatos (briefing §3.3): vaga, ficha incompleta, ordenar por aderência.
// Lógica pura (sem query, sem JSX) separada do componente só para poder ser testada (Constraint 3).
import type { Candidate } from '../shared';
import type { Aderencia } from '../aderencia';

export interface FiltrosNovosValor {
  vaga: string | null;
  fichaIncompleta: boolean;
  ordenarPorAderencia: boolean;
}

export const FILTROS_NOVOS_INICIAL: FiltrosNovosValor = { vaga: null, fichaIncompleta: false, ordenarPorAderencia: false };

/**
 * Filtro de vaga (por job_id — duas vagas de empresas diferentes podem ter o mesmo título, então
 * comparar por título misturaria candidatos delas) + ficha incompleta.
 */
export function aplicarFiltrosNovos(
  items: Candidate[],
  filtro: Pick<FiltrosNovosValor, 'vaga' | 'fichaIncompleta'>,
  vagaIdsDe: (c: Candidate) => string[],
  faltasDe: (c: Candidate) => number,
): Candidate[] {
  return items
    .filter((c) => !filtro.vaga || vagaIdsDe(c).includes(filtro.vaga))
    .filter((c) => !filtro.fichaIncompleta || faltasDe(c) > 0);
}

/** Ordena por aderência (nota do currículo, T02) decrescente; sem candidatura válida vai para o fim. */
export function ordenarPorAderencia(items: Candidate[], aderenciaDe: (c: Candidate) => Aderencia | null): Candidate[] {
  return [...items].sort((a, b) => (aderenciaDe(b)?.score ?? -1) - (aderenciaDe(a)?.score ?? -1));
}

/** Etiqueta de vaga: job_id (fonte do filtro) + rótulo já pronto pra exibir (título, com empresa quando ambíguo). */
export interface VagaEtiqueta { id: string; label: string }

interface Props {
  vagas: VagaEtiqueta[];
  valor: FiltrosNovosValor;
  onChange: (v: FiltrosNovosValor) => void;
}

/** Etiquetas de filtro — mesmo padrão visual dos chips de fase (page.tsx / AreaCandidatos.tsx). */
export default function FiltrosCandidatos({ vagas, valor, onChange }: Props) {
  const base = 'px-3 h-8 rounded-full text-xs font-bold whitespace-nowrap border cursor-pointer transition-colors';
  const ativo = 'bg-zinc-900 text-white border-zinc-900';
  const inativo = 'bg-white text-zinc-600 border-zinc-200 hover:border-zinc-300';
  return (
    <div className="flex flex-wrap gap-1.5 mb-3">
      <button onClick={() => onChange({ ...valor, vaga: null })} className={`${base} ${valor.vaga === null ? ativo : inativo}`}>
        Todas as vagas
      </button>
      {vagas.map((v) => (
        <button key={v.id} onClick={() => onChange({ ...valor, vaga: v.id })} className={`${base} ${valor.vaga === v.id ? ativo : inativo}`}>
          {v.label}
        </button>
      ))}
      <button onClick={() => onChange({ ...valor, fichaIncompleta: !valor.fichaIncompleta })}
        className={`${base} ${valor.fichaIncompleta ? ativo : inativo}`}>
        <i className="ri-error-warning-line" /> Ficha incompleta
      </button>
      <button onClick={() => onChange({ ...valor, ordenarPorAderencia: !valor.ordenarPorAderencia })}
        title="Ordena pela aderência do currículo (mesma nota do chip do card) — não é a nota da entrevista"
        className={`${base} ${valor.ordenarPorAderencia ? ativo : inativo}`}>
        <i className="ri-percent-line" /> Ordenar por aderência
      </button>
    </div>
  );
}

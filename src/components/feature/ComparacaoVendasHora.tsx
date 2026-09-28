import { useCallback, useState } from 'react';
import type { Comparacao } from '@/lib/vendasHoraComparativo';

// Botões que ligam/desligam as linhas de comparação dos gráficos "Vendas por Hora"
// (Dashboard e Relatórios › Visão Geral). A escolha fica guardada no navegador.

export const COMPARACOES: Comparacao[] = ['ontem', 'semana', 'mes'];
export const COR_COMPARACAO: Record<Comparacao, string> = { ontem: '#3b82f6', semana: '#8b5cf6', mes: '#14b8a6' };

const ddmm = (ymd: string) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}`;
const diaSemana = (ymd: string) =>
  new Date(`${ymd}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' }).replace('.', '');

/** `base` = como chamar o dia de referência ('Ontem' quando é hoje, 'Dia anterior' quando é outro dia). */
export function rotuloComparacao(k: Comparacao, ymd: string, base = 'Ontem'): string {
  return k === 'ontem' ? `${base} (${ddmm(ymd)})`
    : k === 'semana' ? `Semana passada (${diaSemana(ymd)} ${ddmm(ymd)})`
    : `4 semanas atrás (${diaSemana(ymd)} ${ddmm(ymd)})`;
}

export function useComparacoesLigadas(chave: string) {
  const [ligadas, setLigadas] = useState<Record<Comparacao, boolean>>(() => {
    const padrao = { ontem: false, semana: false, mes: false };
    try { return { ...padrao, ...JSON.parse(localStorage.getItem(chave) ?? '{}') }; } catch { return padrao; }
  });
  const alternar = useCallback((k: Comparacao) => {
    setLigadas((c) => {
      const n = { ...c, [k]: !c[k] };
      try { localStorage.setItem(chave, JSON.stringify(n)); } catch { /* sem storage */ }
      return n;
    });
  }, [chave]);
  return [ligadas, alternar] as const;
}

interface Props {
  ligadas: Record<Comparacao, boolean>;
  dias: Record<Comparacao, string>;
  onAlternar: (k: Comparacao) => void;
  baseOntem?: string;
  className?: string;
}

export default function ChipsComparacao({ ligadas, dias, onAlternar, baseOntem, className = '' }: Props) {
  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {COMPARACOES.map((k) => (
        <button key={k} type="button" onClick={() => onAlternar(k)} aria-pressed={ligadas[k]}
          className={`flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded-full border transition-colors cursor-pointer ${
            ligadas[k] ? 'bg-zinc-50 border-zinc-300 text-zinc-700' : 'border-zinc-200 text-zinc-400 hover:text-zinc-600'}`}>
          <span className="w-3 h-0.5 rounded-full" style={{ background: ligadas[k] ? COR_COMPARACAO[k] : '#d4d4d8' }} />
          {rotuloComparacao(k, dias[k], baseOntem)}
        </button>
      ))}
    </div>
  );
}

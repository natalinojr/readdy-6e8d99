/**
 * Peças visuais compartilhadas pelas abas do DRE (DRE, DRE Comparativo).
 * Mantém as duas telas com a mesma linguagem: chip de variação, cabeçalho de
 * seção, card de KPI, seletor segmentado e navegação de mês.
 */
import type { ReactNode } from 'react';

export function variacaoPct(atual: number, anterior: number) {
  if (anterior === 0) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function addMeses(mes: string, n: number) {
  const [y, m] = mes.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "Setembro de 2026". Monta a data local — `new Date('2026-09-01')` é UTC e vira agosto no Brasil. */
export function mesExtenso(mes: string) {
  const [y, m] = mes.split('-').map(Number);
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Variação vs. referência. `inverse` = linha de custo/despesa: subir é ruim.
export function VarChip({ atual, anterior, inverse }: { atual: number; anterior?: number; inverse?: boolean }) {
  if (anterior === undefined || anterior === null) return <span className="text-zinc-300 text-xs">—</span>;
  const v = variacaoPct(atual, anterior);
  if (v === null) return <span className="text-zinc-300 text-xs">—</span>;
  if (Math.abs(v) < 0.05) {
    return <span className="inline-flex items-center px-1.5 py-0.5 rounded-md text-[11px] font-semibold bg-zinc-100 text-zinc-500 tabular-nums">0,0%</span>;
  }
  const up = v > 0;
  const good = inverse ? !up : up;
  return (
    <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[11px] font-semibold tabular-nums ${good ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      <i className={up ? 'ri-arrow-up-line' : 'ri-arrow-down-line'} />
      {Math.abs(v).toFixed(1).replace('.', ',')}%
    </span>
  );
}

export const SECTION_TONES: Record<string, string> = {
  emerald: 'bg-emerald-50 text-emerald-600',
  orange: 'bg-orange-50 text-orange-600',
  rose: 'bg-rose-50 text-rose-600',
  indigo: 'bg-indigo-50 text-indigo-600',
  zinc: 'bg-zinc-100 text-zinc-600',
};

export function SectionHeader({
  label, icon = 'ri-folder-line', tone = 'zinc', colSpan = 5,
}: { label: string; icon?: string; tone?: string; colSpan?: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-5 pt-5 pb-2">
        <div className="flex items-center gap-2.5">
          <span className={`w-6 h-6 rounded-md flex items-center justify-center flex-shrink-0 ${SECTION_TONES[tone] ?? SECTION_TONES.zinc}`}>
            <i className={`${icon} text-sm`} />
          </span>
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-500">{label}</span>
          <span className="flex-1 h-px bg-zinc-100" />
        </div>
      </td>
    </tr>
  );
}

// Nota curta embaixo de uma linha (sem caixa — só texto de apoio).
export function NoteRow({ children, colSpan = 5 }: { children: ReactNode; colSpan?: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="pl-10 pr-5 pb-2.5 pt-0">
        <p className="text-[11px] leading-relaxed text-zinc-400 flex items-start gap-1.5">
          <i className="ri-information-line mt-px flex-shrink-0" />
          <span>{children}</span>
        </p>
      </td>
    </tr>
  );
}

export function Segmented<T extends string>({
  value, onChange, options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { id: T; label: string; icon: string; title?: string }[];
}) {
  return (
    <div className="flex bg-zinc-100 p-1 rounded-xl">
      {options.map(o => (
        <button
          key={o.id}
          title={o.title}
          onClick={() => onChange(o.id)}
          className={`px-3 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-all whitespace-nowrap flex items-center gap-1.5 ${
            value === o.id ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'
          }`}
        >
          <i className={`${o.icon} text-sm`} />
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function KpiCard({
  label, icon, value, valueTone, sub, subTone, atual, anterior, inverse, highlight,
}: {
  label: string;
  icon: string;
  value: string;
  valueTone?: string;
  sub?: string;
  subTone?: string;
  atual: number;
  anterior?: number;
  inverse?: boolean;
  highlight?: 'pos' | 'neg';
}) {
  const ring = highlight === 'pos'
    ? 'border-emerald-200 bg-gradient-to-br from-emerald-50 to-white'
    : highlight === 'neg'
    ? 'border-red-200 bg-gradient-to-br from-red-50 to-white'
    : 'border-zinc-200 bg-white';
  return (
    <div className={`rounded-2xl border p-4 flex flex-col gap-2 ${ring}`}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-7 h-7 rounded-lg bg-zinc-100 text-zinc-500 flex items-center justify-center flex-shrink-0">
            <i className={`${icon} text-sm`} />
          </span>
          <span className="text-xs font-semibold text-zinc-500 truncate">{label}</span>
        </div>
        <VarChip atual={atual} anterior={anterior} inverse={inverse} />
      </div>
      <p className={`text-2xl font-bold tabular-nums tracking-tight ${valueTone ?? 'text-zinc-900'}`}>{value}</p>
      {sub && <p className={`text-xs ${subTone ?? 'text-zinc-400'}`}>{sub}</p>}
    </div>
  );
}

/** Navegação de mês: setas + nome por extenso (clique abre o seletor nativo). */
export function MonthNav({ mes, onChange, canGoNext }: { mes: string; onChange: (m: string) => void; canGoNext: boolean }) {
  return (
    <div className="flex items-center bg-white border border-zinc-200 rounded-xl overflow-hidden shadow-sm">
      <button
        onClick={() => onChange(addMeses(mes, -1))}
        className="w-9 h-10 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 hover:text-zinc-800 transition-colors"
        title="Mês anterior"
      >
        <i className="ri-arrow-left-s-line text-lg" />
      </button>
      <div className="relative px-2 min-w-[150px] text-center">
        <p className="text-sm font-bold text-zinc-900 leading-tight">{mesExtenso(mes)}</p>
        <p className="text-[10px] text-zinc-400 leading-tight">clique para escolher</p>
        <input
          type="month" value={mes}
          onChange={e => e.target.value && onChange(e.target.value)}
          className="absolute inset-0 opacity-0 cursor-pointer"
          aria-label="Escolher mês"
        />
      </div>
      <button
        onClick={() => canGoNext && onChange(addMeses(mes, 1))}
        disabled={!canGoNext}
        className="w-9 h-10 flex items-center justify-center hover:bg-zinc-50 cursor-pointer text-zinc-500 hover:text-zinc-800 transition-colors disabled:opacity-30 disabled:cursor-default"
        title="Próximo mês"
      >
        <i className="ri-arrow-right-s-line text-lg" />
      </button>
    </div>
  );
}

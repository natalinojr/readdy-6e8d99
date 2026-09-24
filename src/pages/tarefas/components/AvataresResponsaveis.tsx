import type { Responsavel } from '../lib/responsaveis';
import { iniciais } from './TaskCard';

/** Iniciais empilhadas dos responsáveis (até 3) + nome (1) ou "Ana +2". */
export default function AvataresResponsaveis({ pessoas, tamanho = 5, comNome = true, max = 3 }: {
  pessoas: Responsavel[];
  /** 4, 5 ou 6 (classe w-/h- do Tailwind) */
  tamanho?: 4 | 5 | 6;
  comNome?: boolean;
  max?: number;
}) {
  if (!pessoas.length) return null;
  const dim = tamanho === 4 ? 'w-4 h-4 text-[8px]' : tamanho === 6 ? 'w-6 h-6 text-[10px]' : 'w-5 h-5 text-[9px]';
  const visiveis = pessoas.slice(0, max);
  const resto = pessoas.length - visiveis.length;
  const nome = pessoas.length === 1
    ? (pessoas[0].name ?? 'Usuário')
    : `${(pessoas[0].name ?? 'Usuário').split(' ')[0]}${pessoas.length === 2 ? ` e ${(pessoas[1].name ?? 'Usuário').split(' ')[0]}` : ` +${pessoas.length - 1}`}`;
  return (
    <span className="flex items-center gap-1.5 min-w-0" title={pessoas.map((p) => p.name ?? 'Usuário').join(', ')}>
      <span className="flex -space-x-1.5 shrink-0">
        {visiveis.map((p) => (
          <span key={p.id} className={`${dim} rounded-full bg-indigo-100 text-indigo-600 ring-2 ring-white flex items-center justify-center font-semibold`}>
            {iniciais(p.name ?? '?')}
          </span>
        ))}
        {resto > 0 && (
          <span className={`${dim} rounded-full bg-slate-200 text-slate-600 ring-2 ring-white flex items-center justify-center font-semibold`}>+{resto}</span>
        )}
      </span>
      {comNome && <span className="truncate">{nome}</span>}
    </span>
  );
}

import { Star, Check } from 'lucide-react';
import type { CampoCustom } from '../../hooks/useTarefas';
import type { UsuarioOption } from '../../lib/agrupamento';

interface CampoBadgeProps {
  campo: CampoCustom;
  value: unknown;
  usuarios?: UsuarioOption[];
  /** compacto = card do Kanban/Calendário; normal = coluna da Lista */
  compacto?: boolean;
}

const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

/** Exibição somente-leitura de um valor de campo personalizado. */
export default function CampoBadge({ campo, value, usuarios = [], compacto = false }: CampoBadgeProps) {
  if (value === null || value === undefined || value === '') return null;

  const base = compacto ? 'text-[10px]' : 'text-xs';

  switch (campo.field_type) {
    case 'dropdown': {
      const opcao = campo.options.find((o) => o.id === value);
      if (!opcao) return null;
      return (
        <span
          className={`${base} px-1.5 py-0.5 rounded-full font-medium text-white whitespace-nowrap`}
          style={{ backgroundColor: opcao.color }}
          title={campo.name}
        >
          {opcao.label}
        </span>
      );
    }

    case 'labels': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      const opcoes = campo.options.filter((o) => ids.includes(o.id));
      if (!opcoes.length) return null;
      return (
        <span className="inline-flex gap-1 flex-wrap">
          {opcoes.map((o) => (
            <span
              key={o.id}
              className={`${base} px-1.5 py-0.5 rounded-full font-medium text-white whitespace-nowrap`}
              style={{ backgroundColor: o.color }}
              title={campo.name}
            >
              {o.label}
            </span>
          ))}
        </span>
      );
    }

    case 'checkbox':
      return value === true ? (
        <span className={`${base} inline-flex items-center gap-0.5 text-emerald-600 font-medium`} title={campo.name}>
          <Check size={compacto ? 10 : 12} /> {campo.name}
        </span>
      ) : null;

    case 'rating': {
      const nota = typeof value === 'number' ? value : 0;
      return (
        <span className={`${base} inline-flex items-center gap-0.5 text-amber-500`} title={`${campo.name}: ${nota}/5`}>
          <Star size={compacto ? 10 : 12} className="fill-amber-400 text-amber-400" />
          {nota}
        </span>
      );
    }

    case 'currency':
      return (
        <span className={`${base} text-slate-600 font-medium whitespace-nowrap`} title={campo.name}>
          {BRL.format(Number(value))}
        </span>
      );

    case 'number':
      return <span className={`${base} text-slate-600 whitespace-nowrap`} title={campo.name}>{String(value)}</span>;

    case 'date':
      return (
        <span className={`${base} text-slate-500 whitespace-nowrap`} title={campo.name}>
          {new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}
        </span>
      );

    case 'user': {
      const u = usuarios.find((x) => x.id === value);
      if (!u) return null;
      return <span className={`${base} text-slate-600 whitespace-nowrap`} title={campo.name}>{u.nome}</span>;
    }

    case 'url':
      return (
        <a
          href={String(value).startsWith('http') ? String(value) : `https://${value}`}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className={`${base} text-indigo-500 hover:underline truncate max-w-[140px] inline-block align-bottom`}
          title={campo.name}
        >
          {String(value).replace(/^https?:\/\//, '')}
        </a>
      );

    default:
      return (
        <span className={`${base} text-slate-600 truncate max-w-[160px] inline-block align-bottom`} title={campo.name}>
          {String(value)}
        </span>
      );
  }
}

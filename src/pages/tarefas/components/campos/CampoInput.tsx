import { useState, useEffect } from 'react';
import { Star, ExternalLink } from 'lucide-react';
import type { CampoCustom } from '../../hooks/useTarefas';
import type { UsuarioOption } from '../../lib/agrupamento';

interface CampoInputProps {
  campo: CampoCustom;
  value: unknown;
  usuarios: UsuarioOption[];
  onChange: (value: unknown) => void;
}

const INPUT_CLS = 'w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm bg-white outline-none focus:border-indigo-300';

/** Editor de valor para cada field_type. O backend revalida tudo em task-write. */
export default function CampoInput({ campo, value, usuarios, onChange }: CampoInputProps) {
  // Campos de texto/número guardam rascunho local e só gravam no blur,
  // para não disparar uma escrita por tecla digitada.
  const [rascunho, setRascunho] = useState<string>('');
  useEffect(() => {
    setRascunho(value === null || value === undefined ? '' : String(value));
  }, [value, campo.id]);

  switch (campo.field_type) {
    case 'text':
    case 'url':
    case 'phone':
      return (
        <div className="flex items-center gap-1.5">
          <input
            type={campo.field_type === 'phone' ? 'tel' : 'text'}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={() => {
              const novo = rascunho.trim();
              if (novo !== (value ?? '')) onChange(novo || null);
            }}
            placeholder="—"
            className={INPUT_CLS}
          />
          {campo.field_type === 'url' && typeof value === 'string' && value && (
            <a
              href={value.startsWith('http') ? value : `https://${value}`}
              target="_blank"
              rel="noreferrer"
              className="p-1 text-slate-400 hover:text-indigo-500 shrink-0"
              title="Abrir link"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      );

    case 'textarea':
      return (
        <textarea
          value={rascunho}
          onChange={(e) => setRascunho(e.target.value)}
          onBlur={() => {
            const novo = rascunho.trim();
            if (novo !== (value ?? '')) onChange(novo || null);
          }}
          rows={3}
          placeholder="—"
          className={`${INPUT_CLS} resize-y`}
        />
      );

    case 'number':
    case 'currency':
      return (
        <div className="relative">
          {campo.field_type === 'currency' && (
            <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-slate-400">R$</span>
          )}
          <input
            type="number"
            step={campo.field_type === 'currency' ? '0.01' : 'any'}
            value={rascunho}
            onChange={(e) => setRascunho(e.target.value)}
            onBlur={() => {
              if (rascunho.trim() === '') {
                if (value !== null && value !== undefined) onChange(null);
                return;
              }
              const num = Number(rascunho);
              if (!Number.isFinite(num)) {
                setRascunho(value === null || value === undefined ? '' : String(value));
                return;
              }
              if (num !== value) onChange(num);
            }}
            placeholder="—"
            className={`${INPUT_CLS} ${campo.field_type === 'currency' ? 'pl-7' : ''}`}
          />
        </div>
      );

    case 'date':
      return (
        <input
          type="date"
          value={typeof value === 'string' ? value.slice(0, 10) : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={INPUT_CLS}
        />
      );

    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm text-slate-600 py-1">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
            className="rounded border-slate-300 text-indigo-500 focus:ring-indigo-400"
          />
          {value === true ? 'Sim' : 'Não'}
        </label>
      );

    case 'dropdown':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={INPUT_CLS}
        >
          <option value="">—</option>
          {campo.options.map((o) => (
            <option key={o.id} value={o.id}>{o.label}</option>
          ))}
        </select>
      );

    case 'labels': {
      const selecionados = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="flex flex-wrap gap-1.5 py-0.5">
          {campo.options.map((o) => {
            const ativo = selecionados.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                onClick={() => {
                  const proximo = ativo ? selecionados.filter((s) => s !== o.id) : [...selecionados, o.id];
                  onChange(proximo.length ? proximo : null);
                }}
                className={`px-2 py-0.5 rounded-full text-xs font-medium border transition ${
                  ativo ? 'text-white' : 'text-slate-500 bg-white border-slate-200 hover:border-slate-300'
                }`}
                style={ativo ? { backgroundColor: o.color, borderColor: o.color } : undefined}
              >
                {o.label}
              </button>
            );
          })}
          {campo.options.length === 0 && <span className="text-xs text-slate-400">Sem opções configuradas</span>}
        </div>
      );
    }

    case 'user':
      return (
        <select
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value || null)}
          className={INPUT_CLS}
        >
          <option value="">—</option>
          {usuarios.map((u) => (
            <option key={u.id} value={u.id}>{u.nome}</option>
          ))}
        </select>
      );

    case 'rating': {
      const nota = typeof value === 'number' ? value : 0;
      return (
        <div className="flex items-center gap-0.5 py-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onChange(nota === n ? null : n)}
              className="p-0.5 text-slate-300 hover:text-amber-400 transition"
              title={`${n} de 5`}
            >
              <Star size={16} className={n <= nota ? 'fill-amber-400 text-amber-400' : ''} />
            </button>
          ))}
          {nota > 0 && (
            <button type="button" onClick={() => onChange(null)} className="ml-1 text-[10px] text-slate-400 hover:text-slate-600">
              limpar
            </button>
          )}
        </div>
      );
    }

    default:
      return null;
  }
}

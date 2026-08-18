import { useState } from 'react';
import { ChevronRight, ChevronDown, Plus } from 'lucide-react';
import type { NoPasta } from '../lib/pastas';

interface ArvorePastasProps {
  nos: NoPasta[];
  selectedId: string | null;
  onSelecionar: (id: string) => void;
  onNovaSubpasta: (parentId: string) => void;
  /** No celular a folha inteira é clicável e some ao selecionar — sem hover de "+". */
  compacto?: boolean;
}

export default function ArvorePastas({ nos, selectedId, onSelecionar, onNovaSubpasta, compacto = false }: ArvorePastasProps) {
  const [recolhidas, setRecolhidas] = useState<Set<string>>(new Set());

  const alternar = (id: string) => {
    setRecolhidas((prev) => {
      const p = new Set(prev);
      if (p.has(id)) p.delete(id);
      else p.add(id);
      return p;
    });
  };

  const renderNo = (no: NoPasta): React.ReactNode => {
    const temFilhas = no.filhas.length > 0;
    const recolhida = recolhidas.has(no.id);
    const ativa = selectedId === no.id;

    return (
      <div key={no.id}>
        <div
          className={`group w-full flex items-center gap-1 text-sm ${
            ativa ? 'bg-indigo-50 text-indigo-700 font-medium' : 'text-slate-600 hover:bg-slate-50'
          }`}
          style={{ paddingLeft: `${16 + no.profundidade * 16}px` }}
        >
          <button
            onClick={() => alternar(no.id)}
            className={`shrink-0 p-0.5 -ml-0.5 text-slate-300 hover:text-slate-500 ${temFilhas ? '' : 'invisible'}`}
            tabIndex={temFilhas ? 0 : -1}
          >
            {recolhida ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
          </button>
          <button onClick={() => onSelecionar(no.id)} className="flex-1 flex items-center gap-2 py-2 text-left min-w-0">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: no.color }} />
            <span className="flex-1 truncate">{no.name}</span>
            {no.open_count > 0 && <span className="text-xs text-slate-400 shrink-0">{no.open_count}</span>}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              onNovaSubpasta(no.id);
            }}
            className={`shrink-0 p-1.5 mr-2 rounded text-slate-300 hover:text-indigo-500 hover:bg-indigo-50 ${
              compacto ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
            }`}
            title="Nova subpasta"
          >
            <Plus size={13} />
          </button>
        </div>
        {!recolhida && temFilhas && no.filhas.map((filha) => renderNo(filha))}
      </div>
    );
  };

  return <div>{nos.map((no) => renderNo(no))}</div>;
}

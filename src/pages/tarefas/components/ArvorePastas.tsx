import { useState } from 'react';
import { ChevronRight, ChevronDown, EyeOff, Plus, Trash2, Users, Share2 } from 'lucide-react';
import type { NoPasta } from '../lib/pastas';

interface ArvorePastasProps {
  nos: NoPasta[];
  selectedId: string | null;
  onSelecionar: (id: string) => void;
  onNovaSubpasta: (parentId: string) => void;
  /** Exclui a pasta junto com as subpastas e tarefas (quem chama confirma). */
  onExcluir?: (no: NoPasta) => void;
  /** Abre o compartilhamento da pasta. */
  onCompartilhar?: (no: NoPasta) => void;
  /** No celular a folha inteira é clicável e some ao selecionar — sem hover de "+". */
  compacto?: boolean;
}

export default function ArvorePastas({ nos, selectedId, onSelecionar, onNovaSubpasta, onExcluir, onCompartilhar, compacto = false }: ArvorePastasProps) {
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
    // Sem "access" = resposta antiga do servidor, em que toda pasta era minha.
    const acesso = no.access ?? 'owner';
    const podeEditar = acesso === 'owner' || acesso === 'edit';
    // Símbolo de pasta compartilhada (2026-09-24): vale também o compartilhamento herdado da pasta
    // de cima (shared_count); servidor antigo sem shared_count cai no share_count (só os diretos).
    const pessoas = no.shared_count ?? no.share_count ?? 0;
    const compartilhada = acesso !== 'owner' || pessoas > 0;
    const foraDoCompartilhamento = acesso === 'owner' && !!no.share_excluded;
    const acaoCls = `shrink-0 rounded text-slate-300 ${compacto ? 'p-2.5 opacity-100 text-slate-400' : 'p-1.5 opacity-0 group-hover:opacity-100'}`;

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
          {/* Tocar no símbolo mostra com quem a pasta está compartilhada (janela Compartilhar). */}
          {compartilhada && (
            <button
              onClick={(e) => { e.stopPropagation(); onCompartilhar?.(no); }}
              className={`shrink-0 flex items-center gap-0.5 rounded-md px-1 text-[10px] font-semibold text-indigo-500 hover:bg-indigo-50 ${compacto ? 'py-2' : 'py-1'}`}
              title={acesso === 'owner'
                ? `Compartilhada com ${pessoas} ${pessoas === 1 ? 'pessoa' : 'pessoas'} — ver quem`
                : `De ${no.owner_name ?? 'outra pessoa'} · ${acesso === 'edit' ? 'você pode editar' : 'só ver'} — ver quem tem acesso`}
              aria-label={`Pasta compartilhada: ver com quem`}
            >
              <Users size={12} />
              {acesso === 'owner' && pessoas > 0 && <span>{pessoas}</span>}
            </button>
          )}
          {foraDoCompartilhamento && (
            <span className="shrink-0 px-1 text-slate-400" title="Fora do compartilhamento: quem recebeu a pasta de cima não vê esta">
              <EyeOff size={12} />
            </span>
          )}
          <div className="flex items-center mr-2">
            {onCompartilhar && (
              <button
                onClick={(e) => { e.stopPropagation(); onCompartilhar(no); }}
                className={`${acaoCls} hover:text-indigo-500 hover:bg-indigo-50`}
                title={acesso === 'owner' ? 'Compartilhar' : 'Quem tem acesso'}
              >
                <Share2 size={12} />
              </button>
            )}
            {podeEditar && (
              <button
                onClick={(e) => { e.stopPropagation(); onNovaSubpasta(no.id); }}
                className={`${acaoCls} hover:text-indigo-500 hover:bg-indigo-50`}
                title="Nova subpasta"
              >
                <Plus size={13} />
              </button>
            )}
            {onExcluir && acesso === 'owner' && (
              <button
                onClick={(e) => { e.stopPropagation(); onExcluir(no); }}
                className={`${acaoCls} hover:text-red-500 hover:bg-red-50`}
                title={temFilhas ? 'Excluir pasta e subpastas' : 'Excluir pasta'}
              >
                <Trash2 size={13} />
              </button>
            )}
          </div>
        </div>
        {!recolhida && temFilhas && no.filhas.map((filha) => renderNo(filha))}
      </div>
    );
  };

  return <div>{nos.map((no) => renderNo(no))}</div>;
}

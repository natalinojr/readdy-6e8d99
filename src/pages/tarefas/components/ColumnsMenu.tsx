import { useState } from 'react';
import { Columns3, Check } from 'lucide-react';
import type { ColunaDef, ColunaId } from '../lib/colunas';

interface ColumnsMenuProps {
  disponiveis: ColunaDef[];
  visiveis: ColunaId[];
  onChange: (colunas: ColunaId[]) => void;
}

/** Botão + popover pra escolher quais colunas aparecem na view Lista, estilo ClickUp. */
export default function ColumnsMenu({ disponiveis, visiveis, onChange }: ColumnsMenuProps) {
  const [aberto, setAberto] = useState(false);

  const alternar = (id: ColunaId) => {
    onChange(visiveis.includes(id) ? visiveis.filter((v) => v !== id) : [...visiveis, id]);
  };

  // Campos personalizados primeiro: com muitas colunas nativas eles ficavam
  // no fim da lista, abaixo da dobra do menu, e pareciam não existir.
  const secoes = [
    { titulo: 'Campos personalizados', itens: disponiveis.filter((c) => c.personalizado) },
    { titulo: 'Colunas padrão', itens: disponiveis.filter((c) => !c.personalizado) },
  ].filter((s) => s.itens.length > 0);

  return (
    <div className="relative">
      <button
        onClick={() => setAberto((v) => !v)}
        className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition ${
          aberto
            ? 'border-indigo-300 bg-indigo-50 text-indigo-700 font-medium'
            : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
        }`}
      >
        <Columns3 size={13} />
        Colunas
      </button>

      {aberto && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setAberto(false)} />
          <div className="absolute right-0 top-full mt-1 z-30 w-64 bg-white rounded-xl border border-slate-200 shadow-lg p-1.5 max-h-[70vh] overflow-y-auto">
            {secoes.map((secao) => (
              <div key={secao.titulo} className="mb-1 last:mb-0">
                <p className="px-2 pt-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">{secao.titulo}</p>
                {secao.itens.map((c) => {
                  const on = visiveis.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      onClick={() => alternar(c.id)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-xs text-left hover:bg-slate-50"
                    >
                      <span className={`w-3.5 h-3.5 rounded border flex items-center justify-center shrink-0 ${on ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300'}`}>
                        {on && <Check size={10} className="text-white" />}
                      </span>
                      <span className="truncate text-slate-600" title={c.label}>{c.label}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

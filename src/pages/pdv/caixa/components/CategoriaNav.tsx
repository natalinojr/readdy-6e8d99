import { useState, RefObject } from 'react';
import { useCardapio } from '../../../../contexts/CardapioContext';

interface Props {
  categoriaAtiva: string;
  busca: string;
  onCategoria: (id: string) => void;
  onBusca: (v: string) => void;
  searchRef?: RefObject<HTMLInputElement>;
  onEnter?: () => void;
}

export default function CategoriaNav({ categoriaAtiva, busca, onCategoria, onBusca, searchRef, onEnter }: Props) {
  const [searchFocused, setSearchFocused] = useState(false);
  const { categorias } = useCardapio();
  const ativas = categorias.filter((c) => c.ativo);

  return (
    <div className="flex flex-col gap-3 px-4 pt-4 pb-2">
      {/* Search */}
      <div className={`flex items-center gap-2 border rounded-lg px-3 py-2 transition-colors ${searchFocused ? 'border-amber-400 bg-white' : 'border-zinc-200 bg-zinc-50'}`}>
        <div className="w-4 h-4 flex items-center justify-center text-zinc-400">
          <i className="ri-search-line text-sm" />
        </div>
        <input
          ref={searchRef}
          type="text"
          value={busca}
          onChange={(e) => onBusca(e.target.value)}
          onFocus={() => setSearchFocused(true)}
          onBlur={() => setSearchFocused(false)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && onEnter) onEnter();
          }}
          placeholder="Buscar item ou número..."
          className="flex-1 bg-transparent text-sm text-zinc-800 placeholder-zinc-400 outline-none"
        />
        {busca && (
          <button onClick={() => onBusca('')} className="cursor-pointer text-zinc-400 hover:text-zinc-600">
            <div className="w-4 h-4 flex items-center justify-center">
              <i className="ri-close-line text-sm" />
            </div>
          </button>
        )}
      </div>

      {/* Categories */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
        <button
          onClick={() => onCategoria('todas')}
          className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
            categoriaAtiva === 'todas'
              ? 'bg-amber-500 text-white'
              : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
          }`}
        >
          Todos
        </button>
        {ativas.map((cat) => (
          <button
            key={cat.id}
            onClick={() => onCategoria(cat.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
              categoriaAtiva === cat.id
                ? 'bg-amber-500 text-white'
                : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
            }`}
          >
            {cat.nome}
          </button>
        ))}
      </div>
    </div>
  );
}

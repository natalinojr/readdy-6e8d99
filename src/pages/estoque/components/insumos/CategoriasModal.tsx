import { useState } from 'react';
import { X, Plus } from 'lucide-react';
import type { IngredientCategory } from '@/hooks/useIngredientCategories';

interface CategoriasModalProps {
  categories: IngredientCategory[];
  loading?: boolean;
  onClose: () => void;
  onAdd: (nome: string) => Promise<IngredientCategory | null | void>;
  onRemove: (id: string) => Promise<boolean | void>;
}

export default function CategoriasModal({ categories, loading, onClose, onAdd, onRemove }: CategoriasModalProps) {
  const [novaCategoria, setNovaCategoria] = useState('');
  const [saving, setSaving] = useState(false);

  const handleAdicionar = async () => {
    const nome = novaCategoria.trim();
    if (!nome) return;
    const jaExiste = categories.some((c) => c.name.toLowerCase() === nome.toLowerCase());
    if (jaExiste) return;
    setSaving(true);
    await onAdd(nome);
    setNovaCategoria('');
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl p-6 w-full max-w-sm mx-4">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">Gerenciar Categorias</h2>
            <p className="text-xs text-zinc-400 mt-0.5">Categorias salvas no banco de dados</p>
          </div>
          <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <X size={16} />
          </button>
        </div>

        <div className="space-y-2 mb-4 max-h-56 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center gap-2 py-6">
              <i className="ri-loader-4-line animate-spin text-amber-500" />
              <span className="text-xs text-zinc-400">Carregando categorias...</span>
            </div>
          )}
          {!loading && categories.length === 0 && (
            <p className="text-xs text-zinc-400 text-center py-6">Nenhuma categoria cadastrada.<br />Adicione abaixo para começar.</p>
          )}
          {!loading && categories.map((cat) => (
            <div key={cat.id} className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg group">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                <span className="text-xs font-medium text-zinc-700">{cat.name}</span>
              </div>
              <button
                onClick={() => onRemove(cat.id)}
                className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50 text-zinc-300 hover:text-red-500 cursor-pointer transition-colors opacity-0 group-hover:opacity-100"
                title="Remover categoria"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <input
            value={novaCategoria}
            onChange={(e) => setNovaCategoria(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdicionar()}
            placeholder="Ex: Proteínas, Laticínios, Temperos..."
            className="flex-1 text-sm border border-zinc-200 rounded-lg px-3 py-2 text-zinc-800 focus:outline-none focus:border-amber-400"
          />
          <button
            onClick={handleAdicionar}
            disabled={!novaCategoria.trim() || saving}
            className="px-3 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap transition-colors"
          >
            {saving ? <i className="ri-loader-4-line animate-spin" /> : <Plus size={14} />}
          </button>
        </div>
        <p className="text-[10px] text-zinc-400 mt-2">
          Remover uma categoria aqui não altera os insumos que já a utilizam.
        </p>
      </div>
    </div>
  );
}

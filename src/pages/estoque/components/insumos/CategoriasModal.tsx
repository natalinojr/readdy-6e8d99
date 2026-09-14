import { useState } from 'react';
import { X, Plus, Pencil, Check } from 'lucide-react';
import type { IngredientCategory } from '@/hooks/useIngredientCategories';

interface CategoriasModalProps {
  categories: IngredientCategory[];
  loading?: boolean;
  onClose: () => void;
  onAdd: (nome: string) => Promise<IngredientCategory | null | void>;
  onRemove: (id: string) => Promise<boolean | void>;
  /** Renomeia; o nome acompanha nos insumos e fichas que usam a categoria. */
  onRename?: (id: string, nome: string) => Promise<{ error: string | null }>;
}

export default function CategoriasModal({ categories, loading, onClose, onAdd, onRemove, onRename }: CategoriasModalProps) {
  const [novaCategoria, setNovaCategoria] = useState('');
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editNome, setEditNome] = useState('');
  const [editErro, setEditErro] = useState('');
  const [renomeando, setRenomeando] = useState(false);

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

  const iniciarEdicao = (cat: IngredientCategory) => {
    setEditId(cat.id);
    setEditNome(cat.name);
    setEditErro('');
  };

  const cancelarEdicao = () => {
    setEditId(null);
    setEditErro('');
  };

  const salvarEdicao = async (cat: IngredientCategory) => {
    if (!onRename) return;
    const nome = editNome.trim();
    if (!nome) { setEditErro('Informe o nome'); return; }
    if (nome === cat.name) { cancelarEdicao(); return; }
    setRenomeando(true);
    const { error } = await onRename(cat.id, nome);
    setRenomeando(false);
    if (error) { setEditErro(error); return; }
    cancelarEdicao();
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

        <div className="space-y-2 mb-4 max-h-72 overflow-y-auto">
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
            editId === cat.id ? (
              <div key={cat.id} className="px-2 py-2 bg-amber-50 border border-amber-300 rounded-lg">
                <div className="flex items-center gap-1.5">
                  <input
                    autoFocus
                    value={editNome}
                    onChange={(e) => { setEditNome(e.target.value); setEditErro(''); }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') salvarEdicao(cat);
                      if (e.key === 'Escape') cancelarEdicao();
                    }}
                    disabled={renomeando}
                    className="flex-1 min-w-0 text-xs border border-zinc-200 rounded-md px-2 py-1.5 text-zinc-800 bg-white focus:outline-none focus:border-amber-400"
                  />
                  <button
                    onClick={() => salvarEdicao(cat)}
                    disabled={renomeando || !editNome.trim()}
                    className="w-7 h-7 flex items-center justify-center rounded-md bg-amber-500 text-white hover:bg-amber-600 disabled:opacity-40 cursor-pointer"
                    title="Salvar (Enter)"
                  >
                    {renomeando ? <i className="ri-loader-4-line animate-spin text-xs" /> : <Check size={13} />}
                  </button>
                  <button
                    onClick={cancelarEdicao}
                    disabled={renomeando}
                    className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-100 text-zinc-500 cursor-pointer"
                    title="Cancelar (Esc)"
                  >
                    <X size={13} />
                  </button>
                </div>
                {editErro && <p className="text-[10px] text-red-600 mt-1">{editErro}</p>}
              </div>
            ) : (
              <div key={cat.id} className="flex items-center justify-between px-3 py-2.5 bg-zinc-50 border border-zinc-200 rounded-lg group">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-amber-400 flex-shrink-0" />
                  <span className="text-xs font-medium text-zinc-700 truncate">{cat.name}</span>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                  {onRename && (
                    <button
                      onClick={() => iniciarEdicao(cat)}
                      className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-amber-50 text-zinc-400 hover:text-amber-600 cursor-pointer transition-colors"
                      title="Renomear categoria"
                    >
                      <Pencil size={12} />
                    </button>
                  )}
                  <button
                    onClick={() => onRemove(cat.id)}
                    className="w-6 h-6 flex items-center justify-center rounded-md hover:bg-red-50 text-zinc-300 hover:text-red-500 cursor-pointer transition-colors"
                    title="Remover categoria"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            )
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
          Renomear muda o nome em todos os insumos, compras e fichas que usam a categoria. Remover não altera os insumos que já a utilizam.
        </p>
      </div>
    </div>
  );
}

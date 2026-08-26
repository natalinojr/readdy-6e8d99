import { useState } from 'react';
import { useMerchandiseCategories } from '@/hooks/useMerchandiseCategories';

interface Props {
  onClose: () => void;
}

/**
 * Gerencia a lista de categorias de MERCADORIA (Bebidas, Hortifruti, Proteínas...).
 * Não confundir com o plano de contas do DRE — aqui é só o agrupamento do que é comprado.
 */
export default function CategoriasMercadoriaModal({ onClose }: Props) {
  const { categories, loading, upsert, remove, merge } = useMerchandiseCategories();

  const [newName, setNewName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  // Mesclagem: qual categoria é a origem e para onde ela vai
  const [mergeId, setMergeId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleAdd = async () => {
    const name = newName.trim();
    if (!name || saving) return;
    setSaving(true);
    setError(null);
    const res = await upsert({ name });
    setSaving(false);
    if (res?.error) {
      setError(String(res.error));
      return;
    }
    setNewName('');
  };

  const startEdit = (id: string, name: string) => {
    setEditingId(id);
    setEditingName(name);
    setConfirmId(null);
    setMergeId(null);
    setError(null);
  };

  /** Abre o seletor de destino inline na própria linha. */
  const startMerge = (id: string) => {
    setMergeId(id);
    setMergeTargetId('');
    setEditingId(null);
    setConfirmId(null);
    setError(null);
    setSuccess(null);
  };

  const cancelMerge = () => {
    setMergeId(null);
    setMergeTargetId('');
  };

  const handleMerge = async () => {
    if (!mergeId || !mergeTargetId || saving) return;
    const from = categories.find((c) => c.id === mergeId);
    const to = categories.find((c) => c.id === mergeTargetId);
    setSaving(true);
    setError(null);
    setSuccess(null);
    const res = await merge(mergeId, mergeTargetId);
    setSaving(false);
    if (res?.error) {
      setError(String(res.error));
      return;
    }
    const moved = res?.data ?? {};
    const ing = Number(moved.moved_ingredients ?? 0);
    const items = Number(moved.moved_purchase_items ?? 0);
    setSuccess(
      `${ing} insumo${ing !== 1 ? 's' : ''} e ${items} ${items !== 1 ? 'itens' : 'item'} de compra movido${items !== 1 ? 's' : ''} de «${from?.name ?? ''}» para «${to?.name ?? ''}».`
    );
    cancelMerge();
  };

  const handleSaveEdit = async () => {
    const name = editingName.trim();
    if (!name || !editingId || saving) return;
    setSaving(true);
    setError(null);
    const res = await upsert({ id: editingId, name });
    setSaving(false);
    if (res?.error) {
      setError(String(res.error));
      return;
    }
    setEditingId(null);
    setEditingName('');
  };

  const handleRemove = async (id: string) => {
    if (saving) return;
    setSaving(true);
    setError(null);
    const res = await remove(id);
    setSaving(false);
    if (res?.error) {
      setError(String(res.error));
      return;
    }
    setConfirmId(null);
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3">
      <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-zinc-900 text-sm">Categorias de Mercadoria</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Como você agrupa o que compra (Bebidas, Hortifruti, Proteínas...)
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Adicionar */}
        <div className="px-6 py-3 border-b border-zinc-100 flex items-center gap-2 flex-shrink-0">
          <input
            value={newName}
            onChange={(e) => { setNewName(e.target.value); setError(null); }}
            onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            placeholder="Nova categoria..."
            className="flex-1 border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          <button
            onClick={handleAdd}
            disabled={saving || !newName.trim()}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-line" /> Adicionar
          </button>
        </div>

        {/* Erro (ex.: nome duplicado) */}
        {error && (
          <div className="mx-6 mt-3 px-3 py-2 bg-red-50 border border-red-100 rounded-lg flex items-start gap-2 flex-shrink-0">
            <i className="ri-error-warning-line text-red-500 text-sm mt-px" />
            <p className="text-xs text-red-600 font-semibold flex-1">{error}</p>
            <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 cursor-pointer">
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        )}

        {/* Sucesso da mesclagem */}
        {success && (
          <div className="mx-6 mt-3 px-3 py-2 bg-emerald-50 border border-emerald-100 rounded-lg flex items-start gap-2 flex-shrink-0">
            <i className="ri-checkbox-circle-line text-emerald-500 text-sm mt-px" />
            <p className="text-xs text-emerald-700 font-semibold flex-1">{success}</p>
            <button onClick={() => setSuccess(null)} className="text-emerald-400 hover:text-emerald-600 cursor-pointer">
              <i className="ri-close-line text-sm" />
            </button>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm">
              <i className="ri-loader-4-line animate-spin mr-2" /> Carregando...
            </div>
          ) : categories.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                <i className="ri-price-tag-3-line text-2xl text-zinc-400" />
              </div>
              <p className="text-zinc-600 font-semibold text-sm">Nenhuma categoria cadastrada</p>
              <p className="text-zinc-400 text-xs mt-1 max-w-xs">
                Crie categorias como Bebidas, Hortifruti ou Proteínas para agrupar suas compras
              </p>
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {categories.map((cat) => (
                <div key={cat.id} className="flex items-center gap-3 px-6 py-3 hover:bg-zinc-50 transition-colors">
                  <div className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-xl flex-shrink-0">
                    <i className="ri-price-tag-3-line text-zinc-500 text-sm" />
                  </div>

                  {editingId === cat.id ? (
                    <>
                      <input
                        value={editingName}
                        autoFocus
                        onChange={(e) => setEditingName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit();
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 min-w-0 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      />
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={handleSaveEdit}
                          disabled={saving || !editingName.trim()}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Salvar
                        </button>
                        <button
                          onClick={() => { setEditingId(null); setError(null); }}
                          className="px-3 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                        >
                          Cancelar
                        </button>
                      </div>
                    </>
                  ) : confirmId === cat.id ? (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-zinc-800 truncate">{cat.name}</p>
                        <p className="text-[10px] text-zinc-400 mt-0.5">
                          Remover da lista? As compras já lançadas continuam com esta categoria.
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => handleRemove(cat.id)}
                          disabled={saving}
                          className="px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Excluir
                        </button>
                        <button
                          onClick={() => setConfirmId(null)}
                          className="px-3 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                        >
                          Cancelar
                        </button>
                      </div>
                    </>
                  ) : mergeId === cat.id ? (
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-zinc-800 truncate">{cat.name}</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">Mesclar em qual categoria?</p>
                      <div className="flex items-center gap-2 mt-2">
                        <select
                          value={mergeTargetId}
                          autoFocus
                          onChange={(e) => { setMergeTargetId(e.target.value); setError(null); }}
                          className="flex-1 min-w-0 border border-zinc-200 rounded-lg px-3 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-amber-400"
                        >
                          <option value="">Escolha o destino...</option>
                          {/* A origem nunca aparece como destino */}
                          {categories.filter((c) => c.id !== cat.id).map((c) => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                        <button
                          onClick={handleMerge}
                          disabled={saving || !mergeTargetId}
                          className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                        >
                          Mesclar
                        </button>
                        <button
                          onClick={cancelMerge}
                          disabled={saving}
                          className="px-3 py-1.5 border border-zinc-200 rounded-lg text-xs font-semibold text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                        >
                          Cancelar
                        </button>
                      </div>
                      {mergeTargetId && (
                        <p className="text-[10px] text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-2 py-1.5 mt-2">
                          Todos os insumos e compras de «{cat.name}» passam para «
                          {categories.find((c) => c.id === mergeTargetId)?.name}». «{cat.name}» sai da lista.
                          Não dá para desfazer.
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-zinc-800 truncate">{cat.name}</p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        <button
                          onClick={() => startMerge(cat.id)}
                          disabled={saving || categories.length < 2}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 disabled:opacity-40 cursor-pointer"
                          title="Mesclar em outra categoria"
                        >
                          <i className="ri-git-merge-line text-sm" />
                        </button>
                        <button
                          onClick={() => startEdit(cat.id, cat.name)}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                          title="Renomear"
                        >
                          <i className="ri-edit-line text-sm" />
                        </button>
                        <button
                          onClick={() => { setConfirmId(cat.id); setEditingId(null); setMergeId(null); setError(null); }}
                          className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-300 hover:text-red-500 cursor-pointer"
                          title="Excluir"
                        >
                          <i className="ri-delete-bin-line text-sm" />
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-zinc-400">
            {categories.length} categoria{categories.length !== 1 ? 's' : ''}
          </p>
          <button onClick={onClose} className="px-4 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

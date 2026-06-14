import { useState, useMemo } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import ItemImage from '@/components/base/ItemImage';

export default function DestaquesTab() {
  const {
    itens, categorias, destaques,
    adicionarDestaque, editarDestaque, removerDestaque, reordenarDestaques,
    saving,
  } = useCardapio();

  const [showAddModal, setShowAddModal] = useState(false);
  const [buscaAdd, setBuscaAdd] = useState('');
  const [filtroCategoriaAdd, setFiltroCategoriaAdd] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editPrice, setEditPrice] = useState('');
  const [editDescription, setEditDescription] = useState('');

  const destaqueItemIds = new Set(destaques.map(d => d.itemId));

  // Itens disponiveis para adicionar (ativos, nao ja destacados)
  const itensDisponiveis = useMemo(() => {
    return itens
      .filter(i => i.status === 'ativo' && !destaqueItemIds.has(i.id))
      .filter(i => {
        const matchBusca = i.nome.toLowerCase().includes(buscaAdd.toLowerCase());
        const matchCat = !filtroCategoriaAdd || i.categoriaId === filtroCategoriaAdd;
        return matchBusca && matchCat;
      });
  }, [itens, destaqueItemIds, buscaAdd, filtroCategoriaAdd]);

  const categoriaMap = Object.fromEntries(categorias.map(c => [c.id, c.nome]));
  const categoriasAtivas = categorias.filter(c => c.ativo);

  const handleAdd = async (itemId: string) => {
    await adicionarDestaque(itemId, null, null);
    setShowAddModal(false);
    setBuscaAdd('');
    setFiltroCategoriaAdd('');
  };

  const startEdit = (d: typeof destaques[0]) => {
    setEditingId(d.id);
    setEditPrice(d.customPrice != null ? String(d.customPrice) : '');
    setEditDescription(d.customDescription ?? '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditPrice('');
    setEditDescription('');
  };

  const saveEdit = async () => {
    if (!editingId) return;
    const priceVal = editPrice.trim() ? parseFloat(editPrice.replace(',', '.')) : null;
    await editarDestaque(editingId, {
      customPrice: priceVal,
      customDescription: editDescription.trim() || null,
    });
    setEditingId(null);
  };

  const handleRemove = async (id: string) => {
    if (!confirm('Remover este item dos destaques?')) return;
    await removerDestaque(id);
  };

  const moveUp = async (idx: number) => {
    if (idx === 0) return;
    const arr = [...destaques];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    await reordenarDestaques(arr.map((d, i) => ({ id: d.id, sortOrder: i })));
  };

  const moveDown = async (idx: number) => {
    if (idx === destaques.length - 1) return;
    const arr = [...destaques];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    await reordenarDestaques(arr.map((d, i) => ({ id: d.id, sortOrder: i })));
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Destaques</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            {destaques.length > 0
              ? `${destaques.length} itens em destaque — aparecem como primeira categoria no cardápio`
              : 'Adicione itens para criar a seção de destaques do cardápio'}
          </p>
        </div>
        <button
          onClick={() => setShowAddModal(true)}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <i className="ri-add-line text-base" />
          Adicionar Item
        </button>
      </div>

      {/* Info banner when empty */}
      {destaques.length === 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-5 md:p-6 text-center mb-4">
          <div className="w-12 h-12 flex items-center justify-center bg-amber-100 rounded-full mx-auto mb-3">
            <i className="ri-star-line text-amber-500 text-xl" />
          </div>
          <h3 className="text-sm font-semibold text-amber-800 mb-1">Nenhum item em destaque</h3>
          <p className="text-xs text-amber-600 max-w-md mx-auto">
            Os destaques aparecem como a primeira categoria do seu cardápio. Adicione itens que você quer promover — é possível personalizar o preço e a descrição de cada um.
          </p>
        </div>
      )}

      {/* Destaques list */}
      <div className="space-y-2">
        {destaques.map((dest, idx) => (
          <div
            key={dest.id}
            className="flex items-center gap-2 md:gap-4 p-3 md:p-4 rounded-xl border bg-white border-gray-100 transition-all"
          >
            {/* Order controls */}
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button
                onClick={() => moveUp(idx)}
                disabled={idx === 0 || saving}
                className="w-6 h-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer text-gray-400 transition-colors"
              >
                <i className="ri-arrow-up-s-line text-sm" />
              </button>
              <span className="text-[10px] font-bold text-gray-300 text-center">{idx + 1}</span>
              <button
                onClick={() => moveDown(idx)}
                disabled={idx === destaques.length - 1 || saving}
                className="w-6 h-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer text-gray-400 transition-colors"
              >
                <i className="ri-arrow-down-s-line text-sm" />
              </button>
            </div>

            {/* Item image */}
            <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
              <ItemImage src={dest.itemFotoUrl} alt={dest.itemNome} className="w-full h-full" />
            </div>

            {/* Item info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-gray-800">{dest.itemNome}</span>
                <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">{dest.itemCategoriaNome}</span>
              </div>

              {editingId === dest.id ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-gray-400">Preço:</span>
                      <span className="text-xs text-gray-400 line-through">R$ {dest.itemPreco.toFixed(2).replace('.', ',')}</span>
                    </div>
                    <input
                      className="w-28 border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-800 focus:outline-none focus:border-orange-400"
                      placeholder="R$ 0,00"
                      value={editPrice}
                      onChange={e => setEditPrice(e.target.value)}
                    />
                  </div>
                  <div className="flex items-start gap-1.5">
                    <span className="text-xs text-gray-400 mt-1.5">Desc:</span>
                    <input
                      className="flex-1 border border-gray-200 rounded-md px-2 py-1 text-sm text-gray-800 focus:outline-none focus:border-orange-400"
                      placeholder="Descrição personalizada (opcional)"
                      value={editDescription}
                      onChange={e => setEditDescription(e.target.value)}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={saveEdit}
                      disabled={saving}
                      className="px-3 py-1 text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white rounded-md transition-colors cursor-pointer whitespace-nowrap disabled:opacity-50"
                    >
                      Salvar
                    </button>
                    <button
                      onClick={cancelEdit}
                      className="px-3 py-1 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200 rounded-md transition-colors cursor-pointer whitespace-nowrap"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                  <span className="text-sm font-bold text-orange-600">
                    R$ {(dest.customPrice != null ? dest.customPrice : dest.itemPreco).toFixed(2).replace('.', ',')}
                  </span>
                  {dest.customPrice != null && (
                    <span className="text-xs text-gray-400 line-through">R$ {dest.itemPreco.toFixed(2).replace('.', ',')}</span>
                  )}
                  {dest.customDescription && (
                    <span className="text-xs text-gray-500 truncate max-w-[200px]">{dest.customDescription}</span>
                  )}
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {editingId !== dest.id && (
                <button
                  onClick={() => startEdit(dest)}
                  disabled={saving}
                  className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 border border-gray-200 hover:border-orange-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-pencil-line text-sm" />Personalizar
                </button>
              )}
              {editingId !== dest.id && (
                <button
                  onClick={() => startEdit(dest)}
                  disabled={saving}
                  className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer"
                >
                  <i className="ri-pencil-line text-sm" />
                </button>
              )}
              <button
                onClick={() => handleRemove(dest.id)}
                disabled={saving}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                title="Remover dos destaques"
              >
                <i className="ri-close-line text-sm" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h3 className="text-base font-semibold text-gray-800">Adicionar aos Destaques</h3>
              <button
                onClick={() => { setShowAddModal(false); setBuscaAdd(''); setFiltroCategoriaAdd(''); }}
                className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
              >
                <i className="ri-close-line text-lg" />
              </button>
            </div>

            {/* Search & filter */}
            <div className="px-5 py-3 space-y-2 border-b border-gray-50">
              <div className="flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
                <i className="ri-search-line text-gray-400 text-sm" />
                <input
                  className="flex-1 text-sm focus:outline-none bg-transparent"
                  placeholder="Buscar item..."
                  value={buscaAdd}
                  onChange={e => setBuscaAdd(e.target.value)}
                  autoFocus
                />
                {buscaAdd && (
                  <button onClick={() => setBuscaAdd('')} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                    <i className="ri-close-line text-sm" />
                  </button>
                )}
              </div>
              {categoriasAtivas.length > 1 && (
                <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto scrollbar-none">
                  <button
                    onClick={() => setFiltroCategoriaAdd('')}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${!filtroCategoriaAdd ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    Todas
                  </button>
                  {categoriasAtivas.map(cat => (
                    <button
                      key={cat.id}
                      onClick={() => setFiltroCategoriaAdd(cat.id)}
                      className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex-shrink-0 ${filtroCategoriaAdd === cat.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      {cat.nome}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Items list */}
            <div className="flex-1 overflow-y-auto p-4">
              {itensDisponiveis.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-10 h-10 flex items-center justify-center bg-gray-100 rounded-full mx-auto mb-3">
                    <i className="ri-search-line text-gray-400 text-lg" />
                  </div>
                  <p className="text-sm text-gray-500">Nenhum item disponível</p>
                  <p className="text-xs text-gray-400 mt-1">
                    {destaqueItemIds.size > 0 && itens.filter(i => i.status === 'ativo').length === destaqueItemIds.size
                      ? 'Todos os itens ativos já estão nos destaques!'
                      : 'Crie itens ativos no cardápio primeiro.'}
                  </p>
                </div>
              ) : (
                <div className="space-y-1">
                  {itensDisponiveis.map(item => (
                    <button
                      key={item.id}
                      onClick={() => handleAdd(item.id)}
                      disabled={saving}
                      className="w-full flex items-center gap-3 p-2.5 rounded-lg hover:bg-orange-50 transition-colors cursor-pointer text-left disabled:opacity-40"
                    >
                      <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                        <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{item.nome}</p>
                        <p className="text-xs text-gray-400">{categoriaMap[item.categoriaId] ?? '—'} · R$ {item.preco.toFixed(2).replace('.', ',')}</p>
                      </div>
                      <i className="ri-add-circle-line text-orange-500 text-lg" />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
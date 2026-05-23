import { useState, useMemo } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import type { Item } from '@/types/cardapio';
import ItemModal from './ItemModal';
import ItemImage from '@/components/base/ItemImage';

export default function ItensTab() {
  const { itens, categorias, obsGlobais, estacoes, salvarItem, excluirItem, saving } = useCardapio();
  const [busca, setBusca] = useState('');
  const [filtroCategoria, setFiltroCategoria] = useState('');
  const [filtroStatus, setFiltroStatus] = useState('');
  const [filtroDelivery, setFiltroDelivery] = useState(false);
  const [modalItem, setModalItem] = useState<Item | null | undefined>(undefined);
  const [vistaLista, setVistaLista] = useState(false);
  const [duplicando, setDuplicando] = useState<string | null>(null);

  const categoriaMap = Object.fromEntries(categorias.map(c => [c.id, c.nome]));

  // Contagem de itens por categoria
  const contagemPorCategoria = useMemo(() => {
    const map: Record<string, number> = {};
    itens.forEach(item => {
      map[item.categoriaId] = (map[item.categoriaId] ?? 0) + 1;
    });
    return map;
  }, [itens]);

  const itensFiltrados = itens.filter(item => {
    const matchBusca = item.nome.toLowerCase().includes(busca.toLowerCase()) ||
      item.descricao.toLowerCase().includes(busca.toLowerCase());
    const matchCat = !filtroCategoria || item.categoriaId === filtroCategoria;
    const matchStatus = !filtroStatus || item.status === filtroStatus;
    // Filtro delivery: mostra itens exclusivos de delivery OU itens com delivery ativo
    const matchDelivery = !filtroDelivery || item.somenteDelivery === true || item.delivery?.ativo === true;
    return matchBusca && matchCat && matchStatus && matchDelivery;
  });

  const deliveryCount = itens.filter(i => i.somenteDelivery || i.delivery?.ativo).length;
  const ativosCount = itens.filter(i => i.status === 'ativo').length;
  const inativosCount = itens.filter(i => i.status === 'inativo').length;

  const handleSave = async (saved: Item) => {
    await salvarItem(saved);
    setModalItem(undefined);
  };

  const toggleStatus = async (item: Item) => {
    await salvarItem({ ...item, status: item.status === 'ativo' ? 'inativo' : 'ativo' });
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este item? Esta ação não pode ser desfeita.')) return;
    await excluirItem(id);
  };

  const handleDuplicar = async (item: Item) => {
    setDuplicando(item.id);
    try {
      const copia: Item = {
        ...item,
        id: `new-${Date.now()}`,
        nome: `${item.nome} (cópia)`,
        status: 'inativo', // começa inativo para revisão
        gruposOpcoes: item.gruposOpcoes.map(g => ({
          ...g,
          id: `new-g-${Date.now()}-${Math.random()}`,
          opcoes: g.opcoes.map(o => ({ ...o, id: `new-o-${Date.now()}-${Math.random()}` })),
        })),
        promocoes: [],
      };
      await salvarItem(copia);
    } finally {
      setDuplicando(null);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Itens do Cardápio</h2>
          <div className="flex items-center gap-3 mt-1">
            <p className="text-xs text-gray-500">{itensFiltrados.length} de {itens.length} itens</p>
            <span className="text-xs text-green-600 font-medium">{ativosCount} ativos</span>
            {inativosCount > 0 && <span className="text-xs text-zinc-400">{inativosCount} inativos</span>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Vista toggle */}
          <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
            <button
              onClick={() => setVistaLista(false)}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${!vistaLista ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="Vista em grade"
            >
              <i className="ri-layout-grid-line text-sm" />
            </button>
            <button
              onClick={() => setVistaLista(true)}
              className={`w-7 h-7 flex items-center justify-center rounded-md transition-colors cursor-pointer ${vistaLista ? 'bg-white text-orange-600 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              title="Vista em lista"
            >
              <i className="ri-list-check text-sm" />
            </button>
          </div>
          <button
            onClick={() => setModalItem(null)}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-3 md:px-4 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
          >
            <i className="ri-add-line text-base" />
            <span className="hidden sm:inline">Novo Item</span>
            <span className="sm:hidden">Novo</span>
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-col gap-2 mb-5">
        {/* Linha 1: busca + delivery */}
        <div className="flex items-center gap-2">
          <div className="flex-1 flex items-center gap-2 border border-gray-200 rounded-lg px-3 py-2 bg-white">
            <i className="ri-search-line text-gray-400 text-sm" />
            <input
              className="flex-1 text-sm focus:outline-none bg-transparent"
              placeholder="Buscar item..."
              value={busca}
              onChange={e => setBusca(e.target.value)}
            />
            {busca && (
              <button onClick={() => setBusca('')} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <i className="ri-close-line text-sm" />
              </button>
            )}
          </div>
          <button
            onClick={() => setFiltroDelivery(v => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-lg border transition-colors cursor-pointer whitespace-nowrap ${filtroDelivery ? 'bg-orange-500 text-white border-orange-500' : 'bg-white text-gray-600 border-gray-200 hover:border-orange-300'}`}
          >
            <i className="ri-e-bike-2-line text-sm" />
            <span className="hidden sm:inline">No Delivery</span>
            {deliveryCount > 0 && (
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${filtroDelivery ? 'bg-white/30 text-white' : 'bg-orange-100 text-orange-600'}`}>
                {deliveryCount}
              </span>
            )}
          </button>
        </div>

        {/* Linha 2: filtros de categoria e status */}
        <div className="flex flex-col sm:flex-row gap-2">
          {/* Categorias com scroll horizontal */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 overflow-x-auto flex-1 scrollbar-none">
            <button
              onClick={() => setFiltroCategoria('')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1 flex-shrink-0 ${!filtroCategoria ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            >
              Todas
              <span className={`text-[10px] px-1 rounded-full ${!filtroCategoria ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-500'}`}>
                {itens.length}
              </span>
            </button>
            {categorias.filter(c => c.ativo).map(cat => (
              <button
                key={cat.id}
                onClick={() => setFiltroCategoria(cat.id)}
                className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1 flex-shrink-0 ${filtroCategoria === cat.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
              >
                {cat.nome}
                {(contagemPorCategoria[cat.id] ?? 0) > 0 && (
                  <span className={`text-[10px] px-1 rounded-full ${filtroCategoria === cat.id ? 'bg-orange-100 text-orange-600' : 'bg-gray-200 text-gray-500'}`}>
                    {contagemPorCategoria[cat.id]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Status filter */}
          <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1 flex-shrink-0">
            <button
              onClick={() => setFiltroStatus('')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${!filtroStatus ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              Todos
            </button>
            <button
              onClick={() => setFiltroStatus('ativo')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${filtroStatus === 'ativo' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              Ativos
            </button>
            <button
              onClick={() => setFiltroStatus('inativo')}
              className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${filtroStatus === 'inativo' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
            >
              Inativos
            </button>
          </div>
        </div>
      </div>

      {/* Vista em Grade */}
      {!vistaLista && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {itensFiltrados.map(item => (
            <div key={item.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden transition-all hover:border-gray-200 ${item.status === 'inativo' ? 'opacity-60' : ''}`}>
              <div className="relative w-full h-32 md:h-36">
                <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" />
                <div className="absolute top-2 right-2 flex gap-1.5 flex-wrap justify-end">
                  {item.somenteDelivery && (
                    <span className="bg-orange-500 text-white text-[10px] px-2 py-0.5 rounded-full font-bold flex items-center gap-1 whitespace-nowrap">
                      <i className="ri-e-bike-2-line text-xs" />
                      Só Delivery
                    </span>
                  )}
                  {item.delivery?.ativo && (
                    <span className="bg-orange-600 text-white text-xs px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
                      <i className="ri-e-bike-2-line text-[10px]" />
                      <span className="hidden sm:inline">Delivery</span>
                    </span>
                  )}
                  {item.promocoes.some(p => p.ativo) && (
                    <span className="bg-red-500 text-white text-xs px-2 py-0.5 rounded-full font-medium">Promo</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${item.status === 'ativo' ? 'bg-green-500 text-white' : 'bg-gray-400 text-white'}`}>
                    {item.status === 'ativo' ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
              </div>
              <div className="p-3">
                <div className="flex items-start justify-between gap-2 mb-1">
                  <h3 className="font-semibold text-sm text-gray-800 leading-tight">{item.nome}</h3>
                  <div className="text-right flex-shrink-0">
                    <span className="text-sm font-bold text-orange-600 whitespace-nowrap">R$ {item.preco.toFixed(2).replace('.', ',')}</span>
                    {item.delivery?.ativo && item.delivery.preco != null && item.delivery.preco !== item.preco && (
                      <div className="text-[10px] text-orange-500 font-medium whitespace-nowrap">
                        <i className="ri-e-bike-2-line" /> R$ {item.delivery.preco.toFixed(2).replace('.', ',')}
                      </div>
                    )}
                  </div>
                </div>
                <p className="text-xs text-gray-500 line-clamp-2 mb-2">{item.descricao}</p>
                <div className="flex items-center gap-2 md:gap-3 text-xs text-gray-400 flex-wrap">
                  <span><i className="ri-restaurant-line mr-0.5" />{categoriaMap[item.categoriaId] ?? '—'}</span>
                  <span><i className="ri-time-line mr-0.5" />{item.slaMinutos}min</span>
                  {item.gruposOpcoes.length > 0 && (
                    <span><i className="ri-list-check-2 mr-0.5" />{item.gruposOpcoes.length} grupos</span>
                  )}
                </div>
              </div>
              <div className="flex items-center justify-between px-3 pb-3 pt-2 border-t border-gray-50 gap-2">
                <button
                  onClick={() => toggleStatus(item)}
                  disabled={saving}
                  className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${item.status === 'ativo' ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${item.status === 'ativo' ? 'left-5' : 'left-0.5'}`} />
                </button>
                <div className="flex items-center gap-1 flex-1 justify-end">
                  <button
                    onClick={() => handleDuplicar(item)}
                    disabled={saving || duplicando === item.id}
                    title="Duplicar item"
                    className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                  >
                    {duplicando === item.id
                      ? <i className="ri-loader-4-line animate-spin text-sm" />
                      : <i className="ri-file-copy-line text-sm" />
                    }
                  </button>
                  <button onClick={() => setModalItem(item)} className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 border border-gray-200 hover:border-orange-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                    <i className="ri-pencil-line text-sm" />
                    <span className="hidden sm:inline">Editar</span>
                  </button>
                  <button onClick={() => handleDelete(item.id)} disabled={saving} className="flex items-center gap-1.5 px-2 md:px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                    <i className="ri-delete-bin-line text-sm" />
                    <span className="hidden sm:inline">Excluir</span>
                  </button>
                </div>
              </div>
            </div>
          ))}

          {itensFiltrados.length === 0 && (
            <div className="col-span-full text-center py-16">
              <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-full mx-auto mb-3">
                <i className="ri-search-line text-gray-400 text-xl" />
              </div>
              <p className="text-sm text-gray-500">Nenhum item encontrado</p>
            </div>
          )}
        </div>
      )}

      {/* Vista em Lista */}
      {vistaLista && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {itensFiltrados.length === 0 ? (
            <div className="text-center py-16">
              <i className="ri-search-line text-3xl text-gray-300 block mb-2" />
              <p className="text-sm text-gray-500">Nenhum item encontrado</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Item</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Categoria</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">SLA</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Preço</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {itensFiltrados.map(item => (
                      <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${item.status === 'inativo' ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                              <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <p className="font-semibold text-gray-800 truncate">{item.nome}</p>
                                {item.somenteDelivery && (
                                  <span className="flex items-center gap-0.5 bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded-full font-bold whitespace-nowrap">
                                    <i className="ri-e-bike-2-line" />
                                    Só Delivery
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-gray-400 line-clamp-2 max-w-[200px]">{item.descricao}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{categoriaMap[item.categoriaId] ?? '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-xs text-gray-500">{item.slaMinutos}min</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-orange-600">R$ {item.preco.toFixed(2).replace('.', ',')}</span>
                          {item.delivery?.ativo && item.delivery.preco != null && item.delivery.preco !== item.preco && (
                            <span className="block text-[10px] text-orange-500 font-medium">
                              <i className="ri-e-bike-2-line" /> R$ {item.delivery.preco.toFixed(2).replace('.', ',')}
                            </span>
                          )}
                          {item.promocoes.some(p => p.ativo) && (
                            <span className="block text-[10px] text-red-500 font-medium">Promo ativa</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => toggleStatus(item)}
                            disabled={saving}
                            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${item.status === 'ativo' ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${item.status === 'ativo' ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleDuplicar(item)}
                              disabled={saving || duplicando === item.id}
                              title="Duplicar item"
                              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-orange-500 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                            >
                              {duplicando === item.id
                                ? <i className="ri-loader-4-line animate-spin text-sm" />
                                : <i className="ri-file-copy-line text-sm" />
                              }
                            </button>
                            <button
                              onClick={() => setModalItem(item)}
                              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer"
                              title="Editar"
                            >
                              <i className="ri-pencil-line text-sm" />
                            </button>
                            <button
                              onClick={() => handleDelete(item.id)}
                              disabled={saving}
                              className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                              title="Excluir"
                            >
                              <i className="ri-delete-bin-line text-sm" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile cards (list view) */}
              <div className="md:hidden divide-y divide-gray-50">
                {itensFiltrados.map(item => (
                  <div key={item.id} className={`flex items-center gap-3 px-3 py-3 ${item.status === 'inativo' ? 'opacity-60' : ''}`}>
                    <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                      <ItemImage src={item.fotoUrl} alt={item.nome} className="w-full h-full" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">{item.nome}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-orange-600 font-bold">R$ {item.preco.toFixed(2).replace('.', ',')}</span>
                        <span className="text-xs text-gray-400">{categoriaMap[item.categoriaId] ?? '—'}</span>
                        <span className="text-xs text-gray-400">{item.slaMinutos}min</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => toggleStatus(item)}
                        disabled={saving}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${item.status === 'ativo' ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${item.status === 'ativo' ? 'left-4' : 'left-0.5'}`} />
                      </button>
                      <button
                        onClick={() => setModalItem(item)}
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer"
                      >
                        <i className="ri-pencil-line text-sm" />
                      </button>
                      <button
                        onClick={() => handleDelete(item.id)}
                        disabled={saving}
                        className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <i className="ri-delete-bin-line text-sm" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {modalItem !== undefined && (
        <ItemModal
          item={modalItem ?? undefined}
          categorias={categorias}
          obsGlobais={obsGlobais}
          estacoes={estacoes}
          saving={saving}
          onSave={handleSave}
          onClose={() => setModalItem(undefined)}
        />
      )}
    </div>
  );
}

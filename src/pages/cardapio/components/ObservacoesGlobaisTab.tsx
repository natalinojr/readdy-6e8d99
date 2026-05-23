import { useState, useMemo } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import type { ObservacaoGlobal } from '@/types/cardapio';

// ── ExclusaoSeletor ────────────────────────────────────────────────────────────

interface ExclusaoSeletorProps {
  obs: ObservacaoGlobal;
  onSalvar: (excludedItemIds: string[], excludedCategoryIds: string[]) => void;
  onFechar: () => void;
}

function ExclusaoSeletor({ obs, onSalvar, onFechar }: ExclusaoSeletorProps) {
  const { itens, categorias } = useCardapio();
  const [aba, setAba] = useState<'categorias' | 'itens'>('categorias');
  const [busca, setBusca] = useState('');

  const [excItemIds, setExcItemIds] = useState<string[]>(obs.excludedItemIds ?? []);
  const [excCatIds, setExcCatIds] = useState<string[]>(obs.excludedCategoryIds ?? []);

  const categoriasAtivas = useMemo(() => categorias.filter(c => c.ativo), [categorias]);
  const itensAtivos = useMemo(() => itens.filter(i => i.status === 'ativo'), [itens]);

  const catsFiltradas = useMemo(() =>
    categoriasAtivas.filter(c => !busca || c.nome.toLowerCase().includes(busca.toLowerCase())),
    [categoriasAtivas, busca]);

  const itensFiltrados = useMemo(() =>
    itensAtivos.filter(i => !busca || i.nome.toLowerCase().includes(busca.toLowerCase())),
    [itensAtivos, busca]);

  const toggleCat = (id: string) =>
    setExcCatIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleItem = (id: string) =>
    setExcItemIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const totalExclusoes = excItemIds.length + excCatIds.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[85vh]">
        {/* Header */}
        <div className="px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-zinc-900 text-sm">Excluir de itens / categorias</h3>
              <p className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                Selecione onde a obs <strong className="text-orange-600">"{obs.texto}"</strong> <strong>não</strong> deve aparecer
              </p>
            </div>
            <button onClick={onFechar} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-gray-100 text-gray-400 cursor-pointer flex-shrink-0">
              <i className="ri-close-line text-base" />
            </button>
          </div>

          {/* Busca */}
          <div className="mt-3 flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <i className="ri-search-line text-gray-400 text-sm" />
            <input
              type="text"
              value={busca}
              onChange={e => setBusca(e.target.value)}
              placeholder={aba === 'categorias' ? 'Buscar categoria...' : 'Buscar item...'}
              className="flex-1 bg-transparent text-sm outline-none text-zinc-800 placeholder-zinc-400"
            />
            {busca && (
              <button onClick={() => setBusca('')} className="text-gray-400 hover:text-gray-600 cursor-pointer">
                <i className="ri-close-line text-sm" />
              </button>
            )}
          </div>

          {/* Abas */}
          <div className="flex gap-1 mt-3">
            <button
              onClick={() => { setAba('categorias'); setBusca(''); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${aba === 'categorias' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              <i className="ri-folder-3-line mr-1" />
              Categorias
              {excCatIds.length > 0 && (
                <span className="ml-1.5 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{excCatIds.length}</span>
              )}
            </button>
            <button
              onClick={() => { setAba('itens'); setBusca(''); }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-lg cursor-pointer transition-colors whitespace-nowrap ${aba === 'itens' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
            >
              <i className="ri-restaurant-line mr-1" />
              Itens específicos
              {excItemIds.length > 0 && (
                <span className="ml-1.5 bg-orange-500 text-white text-[9px] font-bold px-1.5 py-0.5 rounded-full">{excItemIds.length}</span>
              )}
            </button>
          </div>
        </div>

        {/* Lista */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1">
          {aba === 'categorias' && (
            <>
              {catsFiltradas.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">Nenhuma categoria encontrada</p>
              )}
              {catsFiltradas.map(cat => {
                const excluida = excCatIds.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => toggleCat(cat.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-all ${excluida ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 hover:bg-gray-50 hover:border-gray-200'}`}
                  >
                    <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-all ${excluida ? 'bg-red-500 border-red-500' : 'bg-white border-gray-300'}`}>
                      {excluida && <i className="ri-close-line text-white text-[10px]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${excluida ? 'text-red-700 line-through decoration-red-300' : 'text-zinc-800'}`}>
                        {cat.nome}
                      </p>
                      <p className="text-[10px] text-gray-400">{cat.totalItens} {cat.totalItens === 1 ? 'item' : 'itens'}</p>
                    </div>
                    {excluida && (
                      <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                        <i className="ri-eye-off-line mr-0.5" />Excluída
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}

          {aba === 'itens' && (
            <>
              {itensFiltrados.length === 0 && (
                <p className="text-center text-sm text-gray-400 py-8">Nenhum item encontrado</p>
              )}
              {itensFiltrados.map(item => {
                const excluido = excItemIds.includes(item.id);
                const catNome = categorias.find(c => c.id === item.categoriaId)?.nome ?? '';
                return (
                  <button
                    key={item.id}
                    onClick={() => toggleItem(item.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border text-left cursor-pointer transition-all ${excluido ? 'bg-red-50 border-red-200' : 'bg-white border-gray-100 hover:bg-gray-50 hover:border-gray-200'}`}
                  >
                    <div className={`w-5 h-5 flex items-center justify-center rounded border-2 flex-shrink-0 transition-all ${excluido ? 'bg-red-500 border-red-500' : 'bg-white border-gray-300'}`}>
                      {excluido && <i className="ri-close-line text-white text-[10px]" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium truncate ${excluido ? 'text-red-700 line-through decoration-red-300' : 'text-zinc-800'}`}>
                        {item.nome}
                      </p>
                      {catNome && <p className="text-[10px] text-gray-400">{catNome}</p>}
                    </div>
                    {excluido && (
                      <span className="text-[10px] font-bold text-red-500 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded-full whitespace-nowrap flex-shrink-0">
                        <i className="ri-eye-off-line mr-0.5" />Excluído
                      </span>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-gray-100 bg-gray-50 flex-shrink-0">
          {totalExclusoes > 0 && (
            <div className="flex items-center gap-2 mb-3 px-3 py-2 bg-red-50 border border-red-200 rounded-xl">
              <i className="ri-eye-off-line text-red-500 text-sm flex-shrink-0" />
              <p className="text-xs text-red-700 flex-1">
                Obs. oculta em{' '}
                {excCatIds.length > 0 && <strong>{excCatIds.length} {excCatIds.length === 1 ? 'categoria' : 'categorias'}</strong>}
                {excCatIds.length > 0 && excItemIds.length > 0 && ' e '}
                {excItemIds.length > 0 && <strong>{excItemIds.length} {excItemIds.length === 1 ? 'item' : 'itens'}</strong>}
              </p>
              <button
                onClick={() => { setExcCatIds([]); setExcItemIds([]); }}
                className="text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer whitespace-nowrap"
              >
                Limpar tudo
              </button>
            </div>
          )}
          <div className="flex gap-2">
            <button
              onClick={onFechar}
              className="flex-1 py-2.5 bg-white border border-gray-200 hover:bg-gray-50 text-gray-600 text-sm font-semibold rounded-xl cursor-pointer whitespace-nowrap transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={() => onSalvar(excItemIds, excCatIds)}
              className="flex-1 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold rounded-xl cursor-pointer whitespace-nowrap transition-colors flex items-center justify-center gap-2"
            >
              <i className="ri-save-line" />
              Salvar exclusões
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ObservacoesGlobaisTab ──────────────────────────────────────────────────────

export default function ObservacoesGlobaisTab() {
  const { obsGlobais, categorias, itens, criarObsGlobal, editarObsGlobal, excluirObsGlobal, saving } = useCardapio();
  const [novoTexto, setNovoTexto] = useState('');
  const [editId, setEditId] = useState<string | null>(null);
  const [editTexto, setEditTexto] = useState('');
  const [exclusaoObsId, setExclusaoObsId] = useState<string | null>(null);

  const ativas = obsGlobais.filter(o => o.ativo).length;

  const handleAdd = async () => {
    const t = novoTexto.trim();
    if (!t) return;
    await criarObsGlobal(t);
    setNovoTexto('');
  };

  const handleSaveEdit = async (id: string) => {
    const t = editTexto.trim();
    if (!t) return;
    await editarObsGlobal(id, { texto: t });
    setEditId(null);
    setEditTexto('');
  };

  const toggleAtivo = async (id: string) => {
    const obs = obsGlobais.find(o => o.id === id);
    if (!obs) return;
    await editarObsGlobal(id, { ativo: !obs.ativo });
  };

  const handleDelete = async (id: string) => {
    await excluirObsGlobal(id);
  };

  const startEdit = (id: string) => {
    const obs = obsGlobais.find(o => o.id === id);
    if (!obs) return;
    setEditId(id);
    setEditTexto(obs.texto);
  };

  const handleSalvarExclusoes = async (excludedItemIds: string[], excludedCategoryIds: string[]) => {
    if (!exclusaoObsId) return;
    await editarObsGlobal(exclusaoObsId, { excludedItemIds, excludedCategoryIds });
    setExclusaoObsId(null);
  };

  // Label de resumo das exclusões para exibir no card
  const getExclusaoLabel = (obs: ObservacaoGlobal): string | null => {
    const totalExc = (obs.excludedItemIds?.length ?? 0) + (obs.excludedCategoryIds?.length ?? 0);
    if (totalExc === 0) return null;
    const partes: string[] = [];
    if (obs.excludedCategoryIds?.length) {
      const nomes = obs.excludedCategoryIds
        .map(id => categorias.find(c => c.id === id)?.nome)
        .filter(Boolean)
        .slice(0, 2);
      if (nomes.length) partes.push(nomes.join(', ') + (obs.excludedCategoryIds.length > 2 ? ` +${obs.excludedCategoryIds.length - 2}` : ''));
    }
    if (obs.excludedItemIds?.length) {
      const nomes = obs.excludedItemIds
        .map(id => itens.find(i => i.id === id)?.nome)
        .filter(Boolean)
        .slice(0, 2);
      if (nomes.length) partes.push(nomes.join(', ') + (obs.excludedItemIds.length > 2 ? ` +${obs.excludedItemIds.length - 2}` : ''));
    }
    return partes.join(' · ');
  };

  const obsEmExclusao = exclusaoObsId ? obsGlobais.find(o => o.id === exclusaoObsId) : null;

  return (
    <div>
      {obsEmExclusao && (
        <ExclusaoSeletor
          obs={obsEmExclusao}
          onSalvar={handleSalvarExclusoes}
          onFechar={() => setExclusaoObsId(null)}
        />
      )}

      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Observações Globais</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Aparecem como opção em <strong>todos os itens</strong> do cardápio em qualquer PDV
          </p>
        </div>
        <div className="flex items-center gap-1.5 bg-orange-50 text-orange-700 text-xs font-medium px-3 py-1.5 rounded-full self-start sm:self-auto">
          <i className="ri-chat-3-line" />
          {ativas} ativas
        </div>
      </div>

      <div className="flex items-start gap-3 bg-amber-50 border border-amber-100 rounded-xl p-3 md:p-4 mb-5">
        <div className="w-5 h-5 flex items-center justify-center flex-shrink-0 mt-0.5">
          <i className="ri-information-line text-amber-500 text-base" />
        </div>
        <div>
          <p className="text-xs font-semibold text-amber-800">Como funcionam as Observações Globais</p>
          <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
            Além das observações específicas de cada item, estas observações aparecem disponíveis em
            <strong> todos os itens</strong> ao realizar um pedido no PDV Caixa, PDV Garçom, Mesa e
            Autoatendimento. Use o botão <strong>Excluir de</strong> para ocultar uma obs em itens ou categorias específicas.
          </p>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row gap-2 mb-5">
        <input
          className="flex-1 border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 transition-colors"
          placeholder="Ex: Sem cebola, Alergia a glúten, Embrulhar separado..."
          value={novoTexto}
          onChange={e => setNovoTexto(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
        />
        <button
          onClick={handleAdd}
          disabled={!novoTexto.trim() || saving}
          className="flex items-center justify-center gap-1.5 bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-medium px-4 py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
        >
          {saving ? <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <i className="ri-add-line text-base" />}
          Adicionar
        </button>
      </div>

      <div className="space-y-2">
        {obsGlobais.map(obs => {
          const exclusaoLabel = getExclusaoLabel(obs);
          const totalExc = (obs.excludedItemIds?.length ?? 0) + (obs.excludedCategoryIds?.length ?? 0);

          return (
            <div
              key={obs.id}
              className={`rounded-xl border transition-all ${obs.ativo ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}
            >
              <div className="flex items-center gap-3 p-3 md:p-3.5">
                <div className="w-8 h-8 flex items-center justify-center bg-orange-50 rounded-lg flex-shrink-0">
                  <i className="ri-chat-3-line text-orange-400 text-sm" />
                </div>

                <div className="flex-1 min-w-0">
                  {editId === obs.id ? (
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                      <input
                        autoFocus
                        className="flex-1 border border-orange-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-orange-400"
                        value={editTexto}
                        onChange={e => setEditTexto(e.target.value)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') handleSaveEdit(obs.id);
                          if (e.key === 'Escape') setEditId(null);
                        }}
                      />
                      <div className="flex gap-2">
                        <button onClick={() => handleSaveEdit(obs.id)} disabled={saving} className="flex-1 sm:flex-none px-3 py-1.5 bg-orange-500 hover:bg-orange-600 text-white text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap">Salvar</button>
                        <button onClick={() => setEditId(null)} className="flex-1 sm:flex-none px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs font-medium rounded-lg cursor-pointer whitespace-nowrap">Cancelar</button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-gray-800 font-medium">{obs.texto}</span>
                        {!obs.ativo && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inativa</span>}
                      </div>
                      {/* Resumo de exclusões */}
                      {exclusaoLabel && (
                        <div className="flex items-center gap-1 mt-1 flex-wrap">
                          <i className="ri-eye-off-line text-[10px] text-red-400" />
                          <span className="text-[10px] text-red-600 font-medium">Oculta em: {exclusaoLabel}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {editId !== obs.id && (
                  <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
                    <button
                      onClick={() => toggleAtivo(obs.id)}
                      disabled={saving}
                      className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${obs.ativo ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                    >
                      <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${obs.ativo ? 'left-5' : 'left-0.5'}`} />
                    </button>

                    {/* Botão de exclusões */}
                    <button
                      onClick={() => setExclusaoObsId(obs.id)}
                      title="Excluir de itens ou categorias"
                      className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer whitespace-nowrap border ${
                        totalExc > 0
                          ? 'text-red-600 bg-red-50 border-red-200 hover:bg-red-100'
                          : 'text-gray-600 hover:text-orange-600 hover:bg-orange-50 border-gray-200 hover:border-orange-200'
                      }`}
                    >
                      <i className="ri-eye-off-line text-sm" />
                      {totalExc > 0 ? `Excluída (${totalExc})` : 'Excluir de'}
                    </button>

                    {/* Desktop: text buttons */}
                    <button onClick={() => startEdit(obs.id)} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 border border-gray-200 hover:border-orange-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                      <i className="ri-pencil-line text-sm" />Editar
                    </button>
                    <button onClick={() => handleDelete(obs.id)} disabled={saving} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                      <i className="ri-delete-bin-line text-sm" />Excluir
                    </button>

                    {/* Mobile: icon buttons */}
                    <button onClick={() => setExclusaoObsId(obs.id)} className={`sm:hidden w-8 h-8 flex items-center justify-center rounded-lg transition-colors cursor-pointer ${totalExc > 0 ? 'text-red-500 bg-red-50' : 'text-gray-400 hover:text-orange-600 hover:bg-orange-50'}`}>
                      <i className="ri-eye-off-line text-sm" />
                    </button>
                    <button onClick={() => startEdit(obs.id)} className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer">
                      <i className="ri-pencil-line text-sm" />
                    </button>
                    <button onClick={() => handleDelete(obs.id)} disabled={saving} className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40">
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {obsGlobais.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-full mx-auto mb-3">
              <i className="ri-chat-3-line text-gray-400 text-xl" />
            </div>
            <p className="text-sm text-gray-500">Nenhuma observação global cadastrada</p>
            <p className="text-xs text-gray-400 mt-1">Adicione observações que se aplicam a todos os itens</p>
          </div>
        )}
      </div>
    </div>
  );
}
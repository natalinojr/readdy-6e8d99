import { useState, useMemo } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import ConfirmModal from '@/components/base/ConfirmModal';
import type { Item } from '@/types/cardapio';

type Canal = 'casa' | 'ambos' | 'delivery';
const canalLabel = (val: Canal) =>
  val === 'delivery' ? 'apenas no delivery' : val === 'casa' ? 'apenas no balcão (casa)' : 'no balcão e no delivery';
const canalIcon = (val: Canal) =>
  val === 'delivery' ? 'ri-e-bike-2-line' : val === 'casa' ? 'ri-home-4-line' : 'ri-restaurant-2-line';

// Canal de um item (espelha disponibilidadeDe do ItensTab/CardapioContext).
function canalDoItem(item: Item): Canal {
  if (item.somenteDelivery) return 'delivery';
  if (item.delivery?.ativo === false) return 'casa';
  return 'ambos';
}

interface ModalState {
  open: boolean;
  editId: string | null;
  nome: string;
  estacaoId: string;
}

export default function CategoriasTab() {
  const { itens, categorias, estacoes, criarCategoria, editarCategoria, excluirCategoria, reordenarCategorias, definirCanalCategoria, saving } = useCardapio();

  // Canal "atual" de cada categoria: derivado dos itens. Se todos compartilham o
  // mesmo canal → esse canal (botão fica laranja). Se misturados/vazia → null.
  const canalDaCategoria = useMemo(() => {
    const map: Record<string, Canal | null> = {};
    for (const cat of categorias) {
      const its = itens.filter(i => i.categoriaId === cat.id);
      if (its.length === 0) { map[cat.id] = null; continue; }
      const primeiro = canalDoItem(its[0]);
      map[cat.id] = its.every(i => canalDoItem(i) === primeiro) ? primeiro : null;
    }
    return map;
  }, [itens, categorias]);

  const primeiraEstacao = estacoes[0]?.id ?? '';
  const initialModal: ModalState = { open: false, editId: null, nome: '', estacaoId: primeiraEstacao };
  const [modal, setModal] = useState<ModalState>(initialModal);

  const openCreate = () => setModal({ open: true, editId: null, nome: '', estacaoId: primeiraEstacao });
  const openEdit = (id: string) => {
    const cat = categorias.find(c => c.id === id);
    if (!cat) return;
    setModal({ open: true, editId: id, nome: cat.nome, estacaoId: cat.estacaoId ?? primeiraEstacao });
  };

  const handleSave = async () => {
    if (!modal.nome.trim()) return;
    if (modal.editId) {
      await editarCategoria(modal.editId, { nome: modal.nome, estacaoId: modal.estacaoId || undefined });
    } else {
      await criarCategoria({ nome: modal.nome, estacaoId: modal.estacaoId || undefined });
    }
    setModal(initialModal);
  };

  const handleToggleAtivo = async (id: string) => {
    const cat = categorias.find(c => c.id === id);
    if (!cat) return;
    await editarCategoria(id, { ativo: !cat.ativo });
  };

  const moveUp = async (idx: number) => {
    if (idx === 0) return;
    const arr = [...categorias];
    [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
    const items = arr.map((c, i) => ({ id: c.id, sortOrder: i + 1 }));
    await reordenarCategorias(items);
  };

  const moveDown = async (idx: number) => {
    if (idx === categorias.length - 1) return;
    const arr = [...categorias];
    [arr[idx], arr[idx + 1]] = [arr[idx + 1], arr[idx]];
    const items = arr.map((c, i) => ({ id: c.id, sortOrder: i + 1 }));
    await reordenarCategorias(items);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir esta categoria? Os itens vinculados serão afetados.')) return;
    await excluirCategoria(id);
  };

  // Confirmação (modal bonito) para aplicar o canal a todos os itens da categoria.
  const [canalConfirm, setCanalConfirm] = useState<{ id: string; nome: string; total: number; val: Canal } | null>(null);

  const getEstacaoNome = (id?: string) => estacoes.find(e => e.id === id)?.nome ?? '—';

  const CANAIS: { key: Canal; icon: string; title: string }[] = [
    { key: 'casa', icon: 'ri-home-4-line', title: 'Só no balcão (casa)' },
    { key: 'ambos', icon: 'ri-restaurant-2-line', title: 'Balcão e delivery' },
    { key: 'delivery', icon: 'ri-e-bike-2-line', title: 'Só delivery' },
  ];

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Categorias do Cardápio</h2>
          <p className="text-xs text-gray-500 mt-0.5">{categorias.length} categorias cadastradas</p>
        </div>
        <button
          onClick={openCreate}
          className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
        >
          <i className="ri-add-line text-base" />
          Nova Categoria
        </button>
      </div>

      <div className="space-y-2">
        {categorias.length === 0 && (
          <div className="text-center py-16">
            <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-full mx-auto mb-3">
              <i className="ri-layout-grid-line text-gray-400 text-xl" />
            </div>
            <p className="text-sm text-gray-500">Nenhuma categoria cadastrada</p>
            <p className="text-xs text-gray-400 mt-1">Crie categorias para organizar o seu cardápio</p>
          </div>
        )}
        {categorias.map((cat, idx) => (
          <div
            key={cat.id}
            className={`flex items-center gap-2 md:gap-4 p-3 md:p-4 rounded-xl border transition-all ${cat.ativo ? 'bg-white border-gray-100' : 'bg-gray-50 border-gray-100 opacity-60'}`}
          >
            <div className="flex flex-col gap-0.5 flex-shrink-0">
              <button onClick={() => moveUp(idx)} disabled={idx === 0 || saving} className="w-6 h-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer text-gray-400 transition-colors">
                <i className="ri-arrow-up-s-line text-sm" />
              </button>
              <button onClick={() => moveDown(idx)} disabled={idx === categorias.length - 1 || saving} className="w-6 h-5 flex items-center justify-center rounded hover:bg-gray-100 disabled:opacity-30 cursor-pointer text-gray-400 transition-colors">
                <i className="ri-arrow-down-s-line text-sm" />
              </button>
            </div>

            <div className="w-7 h-7 flex items-center justify-center bg-orange-50 rounded-lg flex-shrink-0">
              <span className="text-xs font-bold text-orange-500">{idx + 1}</span>
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-gray-800">{cat.nome}</span>
                {!cat.ativo && <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">Inativo</span>}
              </div>
              <div className="flex items-center gap-2 md:gap-3 mt-0.5 flex-wrap">
                <span className="text-xs text-gray-500">
                  <i className="ri-restaurant-line mr-1" />{getEstacaoNome(cat.estacaoId)}
                </span>
                <span className="text-xs text-gray-500">
                  <i className="ri-file-list-3-line mr-1" />{cat.totalItens} itens
                </span>
              </div>
              {/* Canal: aplica casa/ambos/delivery a todos os itens da categoria.
                  O botão do canal atual fica laranja (null = itens com canais mistos). */}
              <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                <span className="text-[11px] text-gray-400">Canal:</span>
                <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                  {CANAIS.map(c => {
                    const selecionado = canalDaCategoria[cat.id] === c.key;
                    return (
                      <button
                        key={c.key}
                        type="button"
                        title={cat.totalItens === 0 ? 'Categoria sem itens' : c.title}
                        disabled={saving || cat.totalItens === 0}
                        onClick={() => setCanalConfirm({ id: cat.id, nome: cat.nome, total: cat.totalItens, val: c.key })}
                        className={`w-7 h-7 flex items-center justify-center text-sm transition-colors disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer ${
                          selecionado ? 'bg-orange-500 text-white' : 'text-gray-400 hover:bg-orange-50 hover:text-orange-600'
                        }`}
                      >
                        <i className={c.icon} />
                      </button>
                    );
                  })}
                </div>
                {cat.totalItens > 0 && canalDaCategoria[cat.id] === null && (
                  <span className="text-[10px] text-gray-400 italic">misto</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1.5 md:gap-2 flex-shrink-0">
              <button
                onClick={() => handleToggleAtivo(cat.id)}
                disabled={saving}
                className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${cat.ativo ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
              >
                <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${cat.ativo ? 'left-5' : 'left-0.5'}`} />
              </button>
              {/* Desktop: text buttons */}
              <button
                onClick={() => openEdit(cat.id)}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 border border-gray-200 hover:border-orange-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-pencil-line text-sm" />Editar
              </button>
              <button
                onClick={() => handleDelete(cat.id)}
                disabled={saving}
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap"
              >
                <i className="ri-delete-bin-line text-sm" />Excluir
              </button>
              {/* Mobile: icon buttons */}
              <button
                onClick={() => openEdit(cat.id)}
                className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer"
              >
                <i className="ri-pencil-line text-sm" />
              </button>
              <button
                onClick={() => handleDelete(cat.id)}
                disabled={saving}
                className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40"
              >
                <i className="ri-delete-bin-line text-sm" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md p-5 md:p-6">
            <h3 className="text-base font-semibold text-gray-800 mb-5">
              {modal.editId ? 'Editar Categoria' : 'Nova Categoria'}
            </h3>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Nome da Categoria</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-orange-400 transition-colors"
                  placeholder="Ex: Lanches, Bebidas..."
                  value={modal.nome}
                  onChange={e => setModal(s => ({ ...s, nome: e.target.value }))}
                  autoFocus
                  onKeyDown={e => e.key === 'Enter' && handleSave()}
                />
              </div>
              {estacoes.length > 0 && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1.5">Estação da Cozinha</label>
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm text-gray-800 focus:outline-none focus:border-orange-400 transition-colors cursor-pointer"
                    value={modal.estacaoId}
                    onChange={e => setModal(s => ({ ...s, estacaoId: e.target.value }))}
                  >
                    <option value="">Sem estação</option>
                    {estacoes.map(e => <option key={e.id} value={e.id}>{e.nome}</option>)}
                  </select>
                </div>
              )}
            </div>
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setModal(initialModal)}
                className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap"
              >
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!modal.nome.trim() || saving}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
              >
                {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {modal.editId ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmação de canal por categoria */}
      <ConfirmModal
        isOpen={!!canalConfirm}
        icon={canalConfirm ? canalIcon(canalConfirm.val) : 'ri-restaurant-2-line'}
        title="Aplicar canal à categoria"
        message={canalConfirm ? `Definir todos os ${canalConfirm.total} itens de "${canalConfirm.nome}" para aparecerem ${canalLabel(canalConfirm.val)}?` : ''}
        confirmLabel="Aplicar"
        onConfirm={async () => {
          if (canalConfirm) await definirCanalCategoria(canalConfirm.id, canalConfirm.val);
          setCanalConfirm(null);
        }}
        onCancel={() => setCanalConfirm(null)}
      />
    </div>
  );
}

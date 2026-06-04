import { useState, useRef } from 'react';
import { useCardapio } from '@/contexts/CardapioContext';
import { useAuth } from '@/contexts/AuthContext';
import { uploadMenuImage } from '@/lib/supabase';
import type { Combo, ComboItem } from '@/types/cardapio';

interface ModalState {
  open: boolean;
  editId: string | null;
  nome: string;
  descricao: string;
  preco: string;
  ativo: boolean;
  fotoUrl: string;
  itens: ComboItem[];
}

const initialModal: ModalState = {
  open: false, editId: null, nome: '', descricao: '', preco: '', ativo: true, fotoUrl: '', itens: [],
};

export default function CombosTab() {
  const { combos, itens, salvarCombo, excluirCombo, saving } = useCardapio();
  const { user } = useAuth();
  const [modal, setModal] = useState<ModalState>(initialModal);
  const [vistaLista, setVistaLista] = useState(true);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const openCreate = () => { setModal({ ...initialModal, open: true }); setUploadError(''); };
  const openEdit = (combo: Combo) => {
    setModal({ open: true, editId: combo.id, nome: combo.nome, descricao: combo.descricao, preco: String(combo.preco), ativo: combo.ativo, fotoUrl: combo.fotoUrl, itens: combo.itens });
    setUploadError('');
  };

  const handleImageSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user?.tenantId) return;

    const MAX_SIZE = 5 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      setUploadError('Imagem muito grande. Máximo 5MB.');
      return;
    }
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowed.includes(file.type)) {
      setUploadError('Formato inválido. Use JPEG, PNG, WebP ou GIF.');
      return;
    }

    setUploadError('');
    setUploadingImg(true);
    try {
      const comboId = modal.editId ?? `combo-new-${Date.now()}`;
      const { url, error } = await uploadMenuImage(file, user.tenantId, comboId);
      if (error || !url) {
        setUploadError(error?.message ?? 'Erro ao enviar imagem');
      } else {
        setModal(m => ({ ...m, fotoUrl: url }));
      }
    } finally {
      setUploadingImg(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSave = async () => {
    if (!modal.nome.trim() || !modal.preco) return;
    const combo: Combo = {
      id: modal.editId ?? `combo-${Date.now()}`,
      nome: modal.nome, descricao: modal.descricao,
      preco: parseFloat(modal.preco), fotoUrl: modal.fotoUrl, ativo: modal.ativo, itens: modal.itens,
    };
    await salvarCombo(combo);
    setModal(initialModal);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Excluir este combo?')) return;
    await excluirCombo(id);
  };

  const handleToggleAtivo = async (combo: Combo) => {
    await salvarCombo({ ...combo, ativo: !combo.ativo });
  };

  const addItemCombo = () => setModal(m => ({
    ...m,
    itens: [...m.itens, { itemId: itens[0]?.id ?? null, nome: itens[0]?.nome ?? '', quantidade: 1 }],
  }));

  const removeItemCombo = (idx: number) =>
    setModal(m => ({ ...m, itens: m.itens.filter((_, i) => i !== idx) }));

  const updateItemCombo = (idx: number, patch: Partial<ComboItem>) =>
    setModal(m => ({
      ...m,
      itens: m.itens.map((it, i) => {
        if (i !== idx) return it;
        const updated = { ...it, ...patch };
        if (patch.itemId !== undefined) {
          const found = itens.find(x => x.id === patch.itemId);
          updated.nome = found?.nome ?? '';
        }
        return updated;
      }),
    }));

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h2 className="text-base font-semibold text-gray-800">Combos</h2>
          <p className="text-xs text-gray-500 mt-0.5">{combos.length} combos cadastrados</p>
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
            onClick={openCreate}
            className="flex items-center gap-1.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium px-4 py-2 rounded-lg transition-colors cursor-pointer whitespace-nowrap self-start sm:self-auto"
          >
            <i className="ri-add-line text-base" />
            Novo Combo
          </button>
        </div>
      </div>

      {/* Vista em Grade */}
      {!vistaLista && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4">
          {combos.length === 0 && (
            <div className="col-span-full text-center py-16">
              <div className="w-12 h-12 flex items-center justify-center bg-gray-100 rounded-full mx-auto mb-3">
                <i className="ri-gift-2-line text-gray-400 text-xl" />
              </div>
              <p className="text-sm text-gray-500">Nenhum combo cadastrado</p>
            </div>
          )}
          {combos.map(combo => (
            <div key={combo.id} className={`bg-white rounded-xl border border-gray-100 overflow-hidden transition-all hover:border-gray-200 ${!combo.ativo ? 'opacity-60' : ''}`}>
              {/* Imagem do combo */}
              {combo.fotoUrl ? (
                <div className="h-32 w-full overflow-hidden">
                  <img src={combo.fotoUrl} alt={combo.nome} className="w-full h-full object-cover object-top" />
                </div>
              ) : (
                <div className="h-32 w-full bg-gray-50 flex items-center justify-center">
                  <i className="ri-gift-2-line text-gray-300 text-3xl" />
                </div>
              )}
              <div className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <h3 className="font-semibold text-sm text-gray-800">{combo.nome}</h3>
                    <span className="text-base font-bold text-orange-600">R$ {combo.preco.toFixed(2).replace('.', ',')}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${combo.ativo ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
                    {combo.ativo ? 'Ativo' : 'Inativo'}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mb-3 line-clamp-2">{combo.descricao}</p>
                <div className="space-y-1 mb-3">
                  {combo.itens.map((it, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-gray-600">
                      <i className="ri-arrow-right-s-line text-orange-400" />
                      <span>{it.quantidade}x {it.nome || 'Item à escolha'}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3 border-t border-gray-50 gap-2">
                  <button
                    onClick={() => handleToggleAtivo(combo)}
                    disabled={saving}
                    className={`relative flex-shrink-0 w-10 h-5 rounded-full transition-colors cursor-pointer ${combo.ativo ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                  >
                    <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${combo.ativo ? 'left-5' : 'left-0.5'}`} />
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => openEdit(combo)} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 hover:text-orange-600 hover:bg-orange-50 border border-gray-200 hover:border-orange-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                      <i className="ri-pencil-line text-sm" />Editar
                    </button>
                    <button onClick={() => handleDelete(combo.id)} disabled={saving} className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-red-600 hover:bg-red-50 border border-gray-200 hover:border-red-200 rounded-lg transition-colors cursor-pointer whitespace-nowrap">
                      <i className="ri-delete-bin-line text-sm" />Excluir
                    </button>
                    <button onClick={() => openEdit(combo)} className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer">
                      <i className="ri-pencil-line text-sm" />
                    </button>
                    <button onClick={() => handleDelete(combo.id)} disabled={saving} className="sm:hidden w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40">
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Vista em Lista */}
      {vistaLista && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          {combos.length === 0 ? (
            <div className="text-center py-16">
              <i className="ri-gift-2-line text-3xl text-gray-300 block mb-2" />
              <p className="text-sm text-gray-500">Nenhum combo cadastrado</p>
            </div>
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Combo</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500">Itens</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Preço</th>
                      <th className="text-center px-4 py-3 text-xs font-semibold text-gray-500">Status</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-gray-500">Ações</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {combos.map(combo => (
                      <tr key={combo.id} className={`hover:bg-gray-50 transition-colors ${!combo.ativo ? 'opacity-60' : ''}`}>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                              {combo.fotoUrl ? (
                                <img src={combo.fotoUrl} alt={combo.nome} className="w-full h-full object-cover object-top" />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center">
                                  <i className="ri-gift-2-line text-gray-300 text-sm" />
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-gray-800 truncate">{combo.nome}</p>
                              <p className="text-xs text-gray-400 line-clamp-1 max-w-[200px]">{combo.descricao}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-0.5">
                            {combo.itens.slice(0, 3).map((it, i) => (
                              <p key={i} className="text-xs text-gray-500">{it.quantidade}x {it.nome || 'Item à escolha'}</p>
                            ))}
                            {combo.itens.length > 3 && (
                              <p className="text-xs text-gray-400">+{combo.itens.length - 3} itens</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="font-bold text-orange-600">R$ {combo.preco.toFixed(2).replace('.', ',')}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <button
                            onClick={() => handleToggleAtivo(combo)}
                            disabled={saving}
                            className={`relative w-10 h-5 rounded-full transition-colors cursor-pointer ${combo.ativo ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                          >
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${combo.ativo ? 'left-5' : 'left-0.5'}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => openEdit(combo)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer" title="Editar">
                              <i className="ri-pencil-line text-sm" />
                            </button>
                            <button onClick={() => handleDelete(combo.id)} disabled={saving} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40" title="Excluir">
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
                {combos.map(combo => (
                  <div key={combo.id} className={`flex items-center gap-3 px-3 py-3 ${!combo.ativo ? 'opacity-60' : ''}`}>
                    <div className="w-12 h-12 rounded-lg overflow-hidden flex-shrink-0 bg-gray-100">
                      {combo.fotoUrl ? (
                        <img src={combo.fotoUrl} alt={combo.nome} className="w-full h-full object-cover object-top" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <i className="ri-gift-2-line text-gray-300 text-lg" />
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm text-gray-800 truncate">{combo.nome}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className="text-xs text-orange-600 font-bold">R$ {combo.preco.toFixed(2).replace('.', ',')}</span>
                        <span className="text-xs text-gray-400">{combo.itens.length} item{combo.itens.length !== 1 ? 's' : ''}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <button
                        onClick={() => handleToggleAtivo(combo)}
                        disabled={saving}
                        className={`relative w-9 h-5 rounded-full transition-colors cursor-pointer ${combo.ativo ? 'bg-orange-500' : 'bg-gray-200'} disabled:opacity-50`}
                      >
                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${combo.ativo ? 'left-4' : 'left-0.5'}`} />
                      </button>
                      <button onClick={() => openEdit(combo)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors cursor-pointer">
                        <i className="ri-pencil-line text-sm" />
                      </button>
                      <button onClick={() => handleDelete(combo.id)} disabled={saving} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-40">
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

      {/* Modal */}
      {modal.open && (
        <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-2xl w-full sm:max-w-lg p-5 md:p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-semibold text-gray-800">{modal.editId ? 'Editar Combo' : 'Novo Combo'}</h3>
              <button onClick={() => setModal(initialModal)} className="w-8 h-8 flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg cursor-pointer">
                <i className="ri-close-line text-lg" />
              </button>
            </div>
            <div className="space-y-4">
              {/* Upload de imagem */}
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Foto do Combo</label>
                <div className="flex items-center gap-3">
                  <div className="w-20 h-20 flex-shrink-0 rounded-xl overflow-hidden bg-gray-100 border border-gray-200">
                    {modal.fotoUrl ? (
                      <img src={modal.fotoUrl} alt="Preview" className="w-full h-full object-cover object-top" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <i className="ri-image-line text-gray-300 text-2xl" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleImageSelect}
                    />
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={uploadingImg}
                      className="flex items-center gap-2 px-3 py-2 text-xs font-medium text-gray-600 hover:text-orange-600 border border-gray-200 hover:border-orange-300 rounded-lg transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
                    >
                      {uploadingImg ? (
                        <>
                          <span className="w-3.5 h-3.5 border-2 border-orange-400/30 border-t-orange-500 rounded-full animate-spin" />
                          Enviando...
                        </>
                      ) : (
                        <>
                          <i className="ri-upload-2-line" />
                          {modal.fotoUrl ? 'Trocar foto' : 'Adicionar foto'}
                        </>
                      )}
                    </button>
                    {modal.fotoUrl && !uploadingImg && (
                      <button
                        type="button"
                        onClick={() => setModal(m => ({ ...m, fotoUrl: '' }))}
                        className="mt-1.5 flex items-center gap-1 text-xs text-red-400 hover:text-red-600 cursor-pointer"
                      >
                        <i className="ri-delete-bin-line text-xs" />
                        Remover foto
                      </button>
                    )}
                    {uploadError && <p className="mt-1 text-xs text-red-500">{uploadError}</p>}
                    <p className="mt-1 text-[10px] text-gray-400">JPEG, PNG, WebP ou GIF. Máx. 5MB.</p>
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Nome do Combo *</label>
                <input
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                  placeholder="Ex: Combo Clássico"
                  value={modal.nome}
                  onChange={e => setModal(m => ({ ...m, nome: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Preço (R$) *</label>
                <input
                  type="number" step="0.01"
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400"
                  placeholder="0,00"
                  value={modal.preco}
                  onChange={e => setModal(m => ({ ...m, preco: e.target.value }))}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1.5">Descrição</label>
                <textarea
                  className="w-full border border-gray-200 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-orange-400 resize-none"
                  rows={2}
                  value={modal.descricao}
                  onChange={e => setModal(m => ({ ...m, descricao: e.target.value }))}
                />
              </div>
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-medium text-gray-600">Itens do Combo</label>
                  <button onClick={addItemCombo} className="text-xs text-orange-500 hover:text-orange-600 font-medium flex items-center gap-1 cursor-pointer">
                    <i className="ri-add-line" /> Adicionar item
                  </button>
                </div>
                <div className="space-y-2">
                  {modal.itens.map((it, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <input
                        type="number" min="1"
                        className="w-14 border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:border-orange-400 text-center"
                        value={it.quantidade}
                        onChange={e => updateItemCombo(idx, { quantidade: parseInt(e.target.value, 10) })}
                      />
                      <select
                        className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-400 cursor-pointer"
                        value={it.itemId ?? ''}
                        onChange={e => updateItemCombo(idx, { itemId: e.target.value || null })}
                      >
                        <option value="">À escolha do cliente</option>
                        {itens.map(i => <option key={i.id} value={i.id}>{i.nome}</option>)}
                      </select>
                      <button onClick={() => removeItemCombo(idx)} className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-red-500 rounded cursor-pointer">
                        <i className="ri-close-line text-sm" />
                      </button>
                    </div>
                  ))}
                  {modal.itens.length === 0 && (
                    <p className="text-xs text-gray-400 italic text-center py-2">Nenhum item adicionado ao combo</p>
                  )}
                </div>
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={() => setModal(initialModal)} className="flex-1 border border-gray-200 text-gray-600 text-sm font-medium py-2.5 rounded-lg hover:bg-gray-50 transition-colors cursor-pointer whitespace-nowrap">
                Cancelar
              </button>
              <button
                onClick={handleSave}
                disabled={!modal.nome.trim() || !modal.preco || saving || uploadingImg}
                className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-medium py-2.5 rounded-lg transition-colors cursor-pointer whitespace-nowrap flex items-center justify-center gap-2"
              >
                {saving && <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
                {modal.editId ? 'Salvar' : 'Criar'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

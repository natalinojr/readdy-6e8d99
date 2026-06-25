import { useState } from 'react';
import SeletorDataNascimento from '@/components/base/SeletorDataNascimento';
import type { SavedAddress } from '../useDeliveryData';

type Neighborhood = {
  id: string;
  name: string;
  delivery_fee: number;
};

interface Props {
  phone: string;
  nome: string;
  onNomeChange: (v: string) => void;
  nascimento: string;
  onNascimentoChange: (v: string) => void;
  genero: string;
  onGeneroChange: (v: string) => void;
  bairroId: string;
  onBairroChange: (id: string) => void;
  rua: string;
  onRuaChange: (v: string) => void;
  numero: string;
  onNumeroChange: (v: string) => void;
  complemento: string;
  onComplementoChange: (v: string) => void;
  referencia: string;
  onReferenciaChange: (v: string) => void;
  neighborhoods: Neighborhood[];
  savedAddresses: SavedAddress[];
  selectedAddressId: string | null;
  isExistingCustomer: boolean;
  onSalvar: (nome: string, bairroId: string, rua: string, num: string, comp: string, ref: string) => void;
  onSelecionarEndereco: (addressId: string) => void;
  onSalvarNovoEndereco: (label: string, bairroId: string, rua: string, num: string, comp: string, ref: string, editAddressId?: string | null) => Promise<void>;
  onDeletarEndereco: (addressId: string) => void;
  onSetDefaultAddress: (addressId: string) => void;
  onIrParaCardapio: () => void;
  onVoltar: () => void;
  enviando: boolean;
  error: string;
  city?: string;
}

type FormMode = 'list' | 'add' | 'edit';

// ── Tipos de endereço ─────────────────────────────────────────────────────────

type AddressType = {
  id: string;
  label: string;
  icon: string;
};

const ADDRESS_TYPES: AddressType[] = [
  { id: 'casa', label: 'Casa', icon: 'ri-home-4-line' },
  { id: 'trabalho', label: 'Trabalho', icon: 'ri-briefcase-line' },
  { id: 'escritorio', label: 'Escritório', icon: 'ri-building-line' },
  { id: 'faculdade', label: 'Faculdade', icon: 'ri-graduation-cap-line' },
  { id: 'pais', label: 'Casa dos pais', icon: 'ri-heart-line' },
  { id: 'outro', label: 'Outro', icon: 'ri-more-line' },
];

function getAddressTypeByLabel(label: string): AddressType | null {
  const normalized = label.trim();
  for (const t of ADDRESS_TYPES) {
    if (t.label.toLowerCase() === normalized.toLowerCase() && t.id !== 'outro') return t;
  }
  return ADDRESS_TYPES[ADDRESS_TYPES.length - 1]; // "Outro"
}

export default function EnderecoDelivery(props: Props) {
  const {
    phone, nome, onNomeChange, nascimento, onNascimentoChange, genero, onGeneroChange,
    bairroId, onBairroChange, rua, onRuaChange,
    numero, onNumeroChange, complemento, onComplementoChange, referencia, onReferenciaChange,
    neighborhoods, savedAddresses, selectedAddressId, isExistingCustomer,
    onSalvar, onSelecionarEndereco, onSalvarNovoEndereco, onDeletarEndereco, onSetDefaultAddress,
    onIrParaCardapio, onVoltar, enviando, error, city,
  } = props;

  // Modo do formulário: lista | adicionar | editar
  const [formMode, setFormMode] = useState<FormMode>(
    isExistingCustomer && savedAddresses.length > 0 ? 'list' : 'add',
  );

  // Estados do formulário inline (add/edit)
  const [formLabel, setFormLabel] = useState('');
  const [formAddressType, setFormAddressType] = useState('casa');
  const [formCustomLabel, setFormCustomLabel] = useState('');
  const [formBairroId, setFormBairroId] = useState('');
  const [formRua, setFormRua] = useState('');
  const [formNumero, setFormNumero] = useState('');
  const [formComplemento, setFormComplemento] = useState('');
  const [formReferencia, setFormReferencia] = useState('');
  const [editingAddressId, setEditingAddressId] = useState<string | null>(null);

  // Confirmação de deletar
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // Erros de validação do formulário inline
  const [formErrors, setFormErrors] = useState<{ bairro?: boolean; rua?: boolean; numero?: boolean; label?: boolean }>({});

  function resetForm() {
    setFormLabel('');
    setFormAddressType('casa');
    setFormCustomLabel('');
    setFormBairroId('');
    setFormRua('');
    setFormNumero('');
    setFormComplemento('');
    setFormReferencia('');
    setEditingAddressId(null);
    setFormErrors({});
  }

  function openAddForm() {
    resetForm();
    setFormMode('add');
  }

  function openEditForm(addr: SavedAddress) {
    const labelText = addr.label || '';
    const matchedType = getAddressTypeByLabel(labelText);
    setFormAddressType(matchedType.id);
    setFormLabel(matchedType.id !== 'outro' ? matchedType.label : labelText);
    setFormCustomLabel(matchedType.id === 'outro' ? labelText : '');
    setFormBairroId(addr.neighborhood_id || '');
    setFormRua(addr.street || '');
    setFormNumero(addr.number || '');
    setFormComplemento(addr.complement || '');
    setFormReferencia(addr.reference_point || '');
    setEditingAddressId(addr.id);
    setFormMode('edit');
  }

  function cancelForm() {
    resetForm();
    if (savedAddresses.length > 0) {
      setFormMode('list');
    } else {
      onVoltar();
    }
  }

  function getEffectiveLabel(): string {
    if (formAddressType === 'outro') {
      return formCustomLabel.trim();
    }
    const type = ADDRESS_TYPES.find(function (t) { return t.id === formAddressType; });
    return type ? type.label : formLabel.trim();
  }

  function validateInlineForm(): boolean {
    const errors: { bairro?: boolean; rua?: boolean; numero?: boolean; label?: boolean } = {};
    if (!formBairroId) errors.bairro = true;
    if (!formRua.trim()) errors.rua = true;
    if (!formNumero.trim()) errors.numero = true;

    if (formAddressType === 'outro') {
      if (!formCustomLabel.trim()) errors.label = true;
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSaveForm() {
    if (!validateInlineForm()) return;
    const effectiveLabel = getEffectiveLabel();
    if (!effectiveLabel) return;

    try {
      await onSalvarNovoEndereco(
        effectiveLabel, formBairroId, formRua, formNumero, formComplemento, formReferencia,
        editingAddressId,
      );
      resetForm();
      setFormMode('list');
    } catch (_err) {
      // erro já é tratado no hook (setErrorMsg) — não faz nada aqui
    }
  }

  function handleSalvarNovoCliente() {
    const nomeTrimmed = nome.trim();
    if (!nomeTrimmed || !bairroId || !rua.trim() || !numero.trim()) return;
    onSalvar(nomeTrimmed, bairroId, rua, numero, complemento, referencia);
  }

  function formatAddressLine(addr: SavedAddress): string {
    const parts: string[] = [];
    if (addr.street) parts.push(addr.street);
    if (addr.number) parts.push(addr.number);
    if (addr.complement) parts.push('(' + addr.complement + ')');
    return parts.join(', ') || 'Endereço incompleto';
  }

  function getNeighborhoodName(nbId: string | null): string {
    if (!nbId) return 'Sem bairro';
    const nb = neighborhoods.find(function (n) { return n.id === nbId; });
    return nb ? nb.name : 'Sem bairro';
  }

  function getAddressIcon(label: string): string {
    const type = getAddressTypeByLabel(label);
    return type ? type.icon : 'ri-map-pin-line';
  }

  const isNewCustomerFormValid = nome.trim().length > 0 && bairroId.length > 0 && rua.trim().length > 0 && numero.trim().length > 0;
  const selectedAddr = selectedAddressId
    ? savedAddresses.find(function (a) { return a.id === selectedAddressId; }) || null
    : null;

  // ── Modo: novo cliente (formulário simples) ──
  if (!isExistingCustomer && formMode === 'add') {
    return (
      <div className="min-h-screen flex flex-col bg-white">
        {/* Header */}
        <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-4 pt-6 pb-4 shrink-0">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onVoltar}
              className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-xl text-white hover:bg-white/30 cursor-pointer transition-colors"
            >
              <i className="ri-arrow-left-line" />
            </button>
            <div>
              <h1 className="text-white text-lg font-black leading-tight">Seu endereço</h1>
              <p className="text-white/80 text-xs">{city || 'Complete para continuar'}</p>
            </div>
          </div>
        </div>

        <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-5">
          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Celular</label>
            <input
              type="tel"
              value={phone}
              readOnly
              className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg bg-zinc-50 text-zinc-600"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Seu nome <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={nome}
              onChange={function (e) { onNomeChange(e.target.value); }}
              placeholder="Ex: João Silva"
              className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              maxLength={60}
            />
          </div>

          <div className="space-y-3">
            {/* Data ocupa a linha inteira — em meia largura o ano ficava cortado. */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Nascimento</label>
              <SeletorDataNascimento value={nascimento} onChange={onNascimentoChange} />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Gênero</label>
              <select
                value={genero}
                onChange={function (e) { onGeneroChange(e.target.value); }}
                className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-white"
              >
                <option value="">Prefiro não dizer</option>
                <option value="masculino">Masculino</option>
                <option value="feminino">Feminino</option>
                <option value="outro">Outro</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
              Bairro <span className="text-red-500">*</span>
            </label>
            <select
              value={bairroId}
              onChange={function (e) { onBairroChange(e.target.value); }}
              className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-white cursor-pointer ' +
                (!bairroId ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
              }
            >
              <option value="">Selecione um bairro</option>
              {neighborhoods.map(function (nb) {
                return (
                  <option key={nb.id} value={nb.id}>{nb.name}</option>
                );
              })}
            </select>
            {bairroId ? (
              <p className="text-[10px] text-amber-600 mt-1 font-medium">
                {(() => {
                  const nb = neighborhoods.find(function (n) { return n.id === bairroId; });
                  return nb ? 'Taxa de entrega: ' + (nb.delivery_fee > 0 ? 'R$ ' + nb.delivery_fee.toFixed(2) : 'Grátis') : '';
                })()}
              </p>
            ) : (
              <p className="text-[10px] text-red-500 mt-1 font-medium">Obrigatório</p>
            )}
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Rua <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={rua}
                onChange={function (e) { onRuaChange(e.target.value); }}
                placeholder="Ex: Av. Paulista"
                className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                  (!rua.trim() ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
                }
                maxLength={100}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Número <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={numero}
                onChange={function (e) { onNumeroChange(e.target.value); }}
                placeholder="123"
                className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                  (!numero.trim() ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
                }
                maxLength={10}
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Complemento</label>
            <input
              type="text"
              value={complemento}
              onChange={function (e) { onComplementoChange(e.target.value); }}
              placeholder="Ex: Apto 42, Bloco B"
              className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              maxLength={60}
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Ponto de referência</label>
            <input
              type="text"
              value={referencia}
              onChange={function (e) { onReferenciaChange(e.target.value); }}
              placeholder="Ex: Próximo ao mercado"
              className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
              maxLength={100}
            />
          </div>

          {error ? (
            <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
              <i className="ri-error-warning-line text-red-500 text-sm" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          ) : null}

          <div className="pt-4 pb-8 space-y-2">
            <button
              type="button"
              onClick={handleSalvarNovoCliente}
              disabled={!isNewCustomerFormValid || enviando}
              className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
            >
              {enviando ? (
                <>
                  <i className="ri-loader-4-line animate-spin" />
                  Salvando...
                </>
              ) : (
                <>
                  <i className="ri-map-pin-line text-sm" />
                  Salvar e ver cardápio
                </>
              )}
            </button>
            {!isNewCustomerFormValid && !enviando ? (
              <p className="text-center text-[11px] text-red-500 font-medium">
                Preencha os campos obrigatórios: nome, bairro, rua e número
              </p>
            ) : null}
            <button
              type="button"
              onClick={onVoltar}
              className="w-full text-sm text-zinc-500 font-bold py-3 cursor-pointer hover:text-zinc-700 transition-colors bg-zinc-100 rounded-xl hover:bg-zinc-200"
            >
              Voltar
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ── Modo: lista de endereços salvos ──
  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* Header */}
      <div className="bg-gradient-to-br from-amber-500 to-orange-500 px-4 pt-6 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={function () {
              if (formMode !== 'list') {
                cancelForm();
              } else {
                onVoltar();
              }
            }}
            className="w-9 h-9 flex items-center justify-center bg-white/20 rounded-xl text-white hover:bg-white/30 cursor-pointer transition-colors"
          >
            <i className="ri-arrow-left-line" />
          </button>
          <div>
            <h1 className="text-white text-lg font-black leading-tight">
              {formMode === 'list' ? 'Seus endereços' : formMode === 'edit' ? 'Editar endereço' : 'Novo endereço'}
            </h1>
            <p className="text-white/80 text-xs">{city || 'Escolha ou adicione um endereço'}</p>
          </div>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 max-w-lg mx-auto w-full space-y-5">
        {/* Lista de endereços */}
        {formMode === 'list' ? (
          <>
            {savedAddresses.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 flex items-center justify-center mx-auto mb-4 bg-amber-50 rounded-2xl border border-amber-100">
                  <i className="ri-map-pin-line text-2xl text-amber-400" />
                </div>
                <p className="text-sm font-bold text-zinc-700 mb-2">Nenhum endereço salvo</p>
                <p className="text-xs text-zinc-500 mb-5">Adicione seu primeiro endereço de entrega</p>
              </div>
            ) : (
              <div className="space-y-3">
                {savedAddresses.map(function (addr) {
                  const isSelected = addr.id === selectedAddressId;
                  const showDeleteConfirm = deleteConfirmId === addr.id;
                  const addrIcon = getAddressIcon(addr.label);

                  return (
                    <div key={addr.id}>
                      <div
                        onClick={function () { onSelecionarEndereco(addr.id); }}
                        className={'relative bg-white rounded-xl border-2 cursor-pointer transition-all duration-200 overflow-hidden ' +
                          (isSelected
                            ? 'border-amber-400 bg-amber-50/50 ring-2 ring-amber-200/50'
                            : 'border-zinc-100 hover:border-amber-200/60')
                        }
                      >
                        <div className="p-4">
                          <div className="flex items-start justify-between mb-2">
                            <div className="flex items-center gap-2">
                              {/* Radio visual */}
                              <div className={'w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 ' +
                                (isSelected ? 'bg-amber-500 border-amber-500' : 'border-zinc-300')
                              }>
                                {isSelected ? <i className="ri-check-line text-white text-[10px]" /> : null}
                              </div>
                              <div className="flex items-center gap-1.5">
                                <div className="w-6 h-6 flex items-center justify-center bg-zinc-100 rounded-lg">
                                  <i className={addrIcon + ' text-zinc-500 text-xs'} />
                                </div>
                                <span className="text-sm font-bold text-zinc-800">{addr.label}</span>
                              </div>
                              {addr.is_default ? (
                                <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-amber-500 text-white text-[10px] font-bold rounded-full shadow-sm">
                                  <i className="ri-star-fill text-[10px]" />
                                  Principal
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={function (e) {
                                    e.stopPropagation();
                                    onSetDefaultAddress(addr.id);
                                  }}
                                  disabled={enviando}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 bg-zinc-100 hover:bg-amber-100 text-zinc-400 hover:text-amber-600 text-[10px] font-bold rounded-full border border-zinc-200 hover:border-amber-300 cursor-pointer transition-all whitespace-nowrap"
                                  title="Tornar endereço principal"
                                >
                                  <i className="ri-star-line text-[9px]" />
                                  Tornar principal
                                </button>
                              )}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={function (e) { e.stopPropagation(); openEditForm(addr); }}
                                className="w-7 h-7 flex items-center justify-center bg-zinc-100 hover:bg-zinc-200 rounded-lg text-zinc-400 hover:text-zinc-600 cursor-pointer transition-colors"
                                title="Editar endereço"
                              >
                                <i className="ri-pencil-line text-xs" />
                              </button>
                              {savedAddresses.length > 1 ? (
                                <button
                                  type="button"
                                  onClick={function (e) {
                                    e.stopPropagation();
                                    if (showDeleteConfirm) {
                                      onDeletarEndereco(addr.id);
                                      setDeleteConfirmId(null);
                                    } else {
                                      setDeleteConfirmId(addr.id);
                                    }
                                  }}
                                  className={'w-7 h-7 flex items-center justify-center rounded-lg cursor-pointer transition-colors ' +
                                    (showDeleteConfirm
                                      ? 'bg-red-500 text-white hover:bg-red-600'
                                      : 'bg-zinc-100 hover:bg-red-100 text-zinc-400 hover:text-red-500')
                                  }
                                  title={showDeleteConfirm ? 'Confirmar exclusão' : 'Excluir endereço'}
                                >
                                  <i className={(showDeleteConfirm ? 'ri-check-line' : 'ri-delete-bin-line') + ' text-xs'} />
                                </button>
                              ) : null}
                            </div>
                          </div>

                          <div className="ml-7 space-y-1">
                            <p className="text-sm text-zinc-700">
                              <i className="ri-road-map-line text-zinc-400 text-xs mr-1.5" />
                              {formatAddressLine(addr)}
                            </p>
                            <p className="text-xs text-zinc-500">
                              <i className="ri-map-pin-2-line text-zinc-400 text-[10px] mr-1.5" />
                              {addr.neighborhood_name || getNeighborhoodName(addr.neighborhood_id)}
                            </p>
                            <p className="text-[11px] font-medium text-amber-600">
                              {addr.neighborhood_delivery_fee > 0
                                ? 'Taxa de entrega: R$ ' + addr.neighborhood_delivery_fee.toFixed(2)
                                : 'Entrega grátis'}
                            </p>
                          </div>
                        </div>
                      </div>

                      {/* Confirmação de deletar */}
                      {showDeleteConfirm ? (
                        <div className="mt-2 flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-100 rounded-lg">
                          <i className="ri-error-warning-line text-red-500 text-sm shrink-0" />
                          <p className="text-[11px] text-red-600 flex-1">Tem certeza? Clique no ícone vermelho novamente para confirmar.</p>
                          <button
                            type="button"
                            onClick={function () { setDeleteConfirmId(null); }}
                            className="text-[10px] font-bold text-red-500 hover:text-red-700 cursor-pointer whitespace-nowrap"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}

            {/* Botão adicionar novo */}
            <button
              type="button"
              onClick={openAddForm}
              className="w-full flex items-center justify-center gap-2 px-4 py-3.5 border-2 border-dashed border-amber-300 rounded-xl text-amber-600 hover:border-amber-400 hover:bg-amber-50/50 text-sm font-bold cursor-pointer transition-all whitespace-nowrap"
            >
              <i className="ri-add-line text-lg" />
              Adicionar novo endereço
            </button>

            {error ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                <i className="ri-error-warning-line text-red-500 text-sm" />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            ) : null}

            {/* Botão usar este endereço */}
            <div className="pt-2 pb-8">
              <button
                type="button"
                onClick={onIrParaCardapio}
                disabled={!selectedAddressId || enviando}
                className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <i className="ri-arrow-right-line text-sm" />
                    {selectedAddr ? 'Usar "' + selectedAddr.label + '" e ver cardápio' : 'Selecione um endereço'}
                  </>
                )}
              </button>
            </div>
          </>
        ) : (
          /* Formulário inline (add/edit) */
          <div className="space-y-4">
            {/* Tipo de endereço */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-2">
                Tipo de endereço <span className="text-red-500">*</span>
              </label>
              <div className="grid grid-cols-3 gap-2">
                {ADDRESS_TYPES.map(function (type) {
                  const isSelected = formAddressType === type.id;
                  return (
                    <button
                      key={type.id}
                      type="button"
                      onClick={function () {
                        setFormAddressType(type.id);
                        if (type.id !== 'outro') {
                          setFormLabel(type.label);
                        }
                        setFormErrors(function (prev) { return { ...prev, label: false }; });
                      }}
                      className={'flex flex-col items-center gap-1 px-3 py-2.5 rounded-xl border-2 cursor-pointer transition-all duration-200 ' +
                        (isSelected
                          ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200/50'
                          : 'border-zinc-100 hover:border-amber-200/60 bg-white')
                      }
                    >
                      <div className={'w-8 h-8 flex items-center justify-center rounded-lg ' +
                        (isSelected ? 'bg-amber-500 text-white' : 'bg-zinc-100 text-zinc-400')
                      }>
                        <i className={type.icon + ' text-sm'} />
                      </div>
                      <span className={'text-[11px] font-bold whitespace-nowrap ' +
                        (isSelected ? 'text-amber-700' : 'text-zinc-600')
                      }>
                        {type.label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {formAddressType === 'outro' ? (
                <div className="mt-2">
                  <input
                    type="text"
                    value={formCustomLabel}
                    onChange={function (e) {
                      setFormCustomLabel(e.target.value);
                      if (e.target.value.trim()) {
                        setFormErrors(function (prev) { return { ...prev, label: false }; });
                      }
                    }}
                    placeholder="Digite um nome para este endereço"
                    className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                      (formErrors.label ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
                    }
                    maxLength={40}
                  />
                  {formErrors.label ? (
                    <p className="text-[10px] text-red-500 mt-1 font-medium">Obrigatório</p>
                  ) : null}
                </div>
              ) : null}
            </div>

            {/* Bairro */}
            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                Bairro <span className="text-red-500">*</span>
              </label>
              <select
                value={formBairroId}
                onChange={function (e) {
                  setFormBairroId(e.target.value);
                  if (e.target.value) {
                    setFormErrors(function (prev) { return { ...prev, bairro: false }; });
                  }
                }}
                className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all bg-white cursor-pointer ' +
                  (formErrors.bairro ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
                }
              >
                <option value="">Selecione um bairro</option>
                {neighborhoods.map(function (nb) {
                  return (
                    <option key={nb.id} value={nb.id}>{nb.name}</option>
                  );
                })}
              </select>
              {formBairroId ? (
                <p className="text-[10px] text-amber-600 mt-1 font-medium">
                  {(() => {
                    const nb = neighborhoods.find(function (n) { return n.id === formBairroId; });
                    return nb ? 'Taxa de entrega: ' + (nb.delivery_fee > 0 ? 'R$ ' + nb.delivery_fee.toFixed(2) : 'Grátis') : '';
                  })()}
                </p>
              ) : (
                formErrors.bairro ? <p className="text-[10px] text-red-500 mt-1 font-medium">Obrigatório</p> : null
              )}
            </div>

            {/* Rua + Número */}
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Rua <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formRua}
                  onChange={function (e) {
                    setFormRua(e.target.value);
                    if (e.target.value.trim()) {
                      setFormErrors(function (prev) { return { ...prev, rua: false }; });
                    }
                  }}
                  placeholder="Ex: Av. Paulista"
                  className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                    (formErrors.rua ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
                  }
                  maxLength={100}
                />
                {formErrors.rua ? <p className="text-[10px] text-red-500 mt-1 font-medium">Obrigatório</p> : null}
              </div>
              <div>
                <label className="block text-xs font-semibold text-zinc-600 mb-1.5">
                  Número <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  value={formNumero}
                  onChange={function (e) {
                    setFormNumero(e.target.value);
                    if (e.target.value.trim()) {
                      setFormErrors(function (prev) { return { ...prev, numero: false }; });
                    }
                  }}
                  placeholder="123"
                  className={'w-full px-3.5 py-2.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all ' +
                    (formErrors.numero ? 'border-red-200 bg-red-50/30' : 'border-zinc-200')
                  }
                  maxLength={10}
                />
                {formErrors.numero ? <p className="text-[10px] text-red-500 mt-1 font-medium">Obrigatório</p> : null}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Complemento</label>
              <input
                type="text"
                value={formComplemento}
                onChange={function (e) { setFormComplemento(e.target.value); }}
                placeholder="Ex: Apto 42, Bloco B"
                className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                maxLength={60}
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-zinc-600 mb-1.5">Ponto de referência</label>
              <input
                type="text"
                value={formReferencia}
                onChange={function (e) { setFormReferencia(e.target.value); }}
                placeholder="Ex: Próximo ao mercado"
                className="w-full px-3.5 py-2.5 text-sm border border-zinc-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent transition-all"
                maxLength={100}
              />
            </div>

            {error ? (
              <div className="flex items-center gap-2 px-3 py-2.5 bg-red-50 border border-red-100 rounded-lg">
                <i className="ri-error-warning-line text-red-500 text-sm" />
                <p className="text-xs text-red-600">{error}</p>
              </div>
            ) : null}

            <div className="pt-3 pb-8 space-y-2">
              <button
                type="button"
                onClick={handleSaveForm}
                disabled={enviando}
                className="w-full bg-gradient-to-br from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-60 disabled:hover:from-amber-500 disabled:hover:to-orange-500 text-white text-sm font-bold py-3.5 rounded-xl cursor-pointer transition-all whitespace-nowrap flex items-center justify-center gap-2"
              >
                {enviando ? (
                  <>
                    <i className="ri-loader-4-line animate-spin" />
                    Salvando...
                  </>
                ) : (
                  <>
                    <i className="ri-save-line text-sm" />
                    {editingAddressId ? 'Salvar alterações' : 'Salvar endereço'}
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                className="w-full text-sm text-zinc-500 font-bold py-3 cursor-pointer hover:text-zinc-700 transition-colors bg-zinc-100 rounded-xl hover:bg-zinc-200"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
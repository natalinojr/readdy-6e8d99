import { useState } from 'react';
import { X, Plus, Edit2, Phone, Mail, MapPin, Building2 } from 'lucide-react';
import { useSuppliers, type Supplier } from '@/hooks/useSuppliers';

interface Props {
  onClose: () => void;
  onSelect?: (supplier: Supplier) => void;
  selectMode?: boolean;
}

interface SupplierFormData {
  id?: string;
  name: string;
  cnpj: string;
  phone: string;
  email: string;
  address: string;
}

const emptyForm: SupplierFormData = {
  name: '', cnpj: '', phone: '', email: '', address: '',
};

function SupplierForm({
  initial,
  onSave,
  onCancel,
}: {
  initial?: SupplierFormData;
  onSave: (data: SupplierFormData) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<SupplierFormData>(initial ?? emptyForm);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  const f = (field: keyof SupplierFormData, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  return (
    <div className="space-y-3 p-4 bg-zinc-50 border border-zinc-200 rounded-xl">
      <p className="text-xs font-bold text-zinc-700 flex items-center gap-1.5">
        <Building2 size={13} className="text-amber-500" />
        {form.id ? 'Editar Fornecedor' : 'Novo Fornecedor'}
      </p>
      <div>
        <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Nome *</label>
        <input
          value={form.name}
          onChange={(e) => f('name', e.target.value)}
          placeholder="Distribuidora XYZ"
          className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-amber-400"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Telefone</label>
          <input
            value={form.phone}
            onChange={(e) => f('phone', e.target.value)}
            placeholder="(11) 99999-9999"
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-amber-400"
          />
        </div>
        <div>
          <label className="block text-[10px] font-semibold text-zinc-500 mb-1">CNPJ</label>
          <input
            value={form.cnpj}
            onChange={(e) => f('cnpj', e.target.value)}
            placeholder="00.000.000/0001-00"
            className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-amber-400"
          />
        </div>
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-zinc-500 mb-1">E-mail</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => f('email', e.target.value)}
          placeholder="contato@fornecedor.com"
          className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-amber-400"
        />
      </div>
      <div>
        <label className="block text-[10px] font-semibold text-zinc-500 mb-1">Endereço</label>
        <input
          value={form.address}
          onChange={(e) => f('address', e.target.value)}
          placeholder="Rua, número, bairro, cidade"
          className="w-full text-sm border border-zinc-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:border-amber-400"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          onClick={onCancel}
          className="flex-1 py-2 text-xs font-semibold text-zinc-600 bg-white border border-zinc-200 rounded-lg hover:bg-zinc-100 cursor-pointer whitespace-nowrap"
        >
          Cancelar
        </button>
        <button
          onClick={handleSave}
          disabled={!form.name.trim() || saving}
          className="flex-1 py-2 text-xs font-semibold text-white bg-amber-500 rounded-lg hover:bg-amber-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer whitespace-nowrap"
        >
          {saving ? <i className="ri-loader-4-line animate-spin" /> : 'Salvar'}
        </button>
      </div>
    </div>
  );
}

export default function GerenciarFornecedoresModal({ onClose, onSelect, selectMode }: Props) {
  const { suppliers, loading, upsert, remove } = useSuppliers();
  const [showForm, setShowForm] = useState(false);
  const [editSupplier, setEditSupplier] = useState<Supplier | null>(null);
  const [busca, setBusca] = useState('');
  const [confirmRemove, setConfirmRemove] = useState<Supplier | null>(null);

  const filtered = busca
    ? suppliers.filter((s) =>
        s.name.toLowerCase().includes(busca.toLowerCase()) ||
        (s.phone || '').includes(busca) ||
        (s.email || '').toLowerCase().includes(busca.toLowerCase())
      )
    : suppliers;

  const handleSave = async (data: SupplierFormData) => {
    await upsert({ ...data, id: data.id });
    setShowForm(false);
    setEditSupplier(null);
  };

  const handleEdit = (s: Supplier) => {
    setEditSupplier(s);
    setShowForm(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg max-h-[88vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100">
          <div>
            <h2 className="text-sm font-bold text-zinc-900">
              {selectMode ? 'Selecionar Fornecedor' : 'Gerenciar Fornecedores'}
            </h2>
            <p className="text-xs text-zinc-400 mt-0.5">
              {suppliers.length} fornecedor{suppliers.length !== 1 ? 'es' : ''} cadastrado{suppliers.length !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer text-zinc-500">
            <X size={16} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-5 space-y-4">
          {/* Busca + novo */}
          <div className="flex gap-2">
            <div className="flex-1 flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-lg px-3 py-2">
              <i className="ri-search-line text-zinc-400 text-sm" />
              <input
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                placeholder="Buscar fornecedor..."
                className="flex-1 text-xs bg-transparent text-zinc-700 placeholder-zinc-400 focus:outline-none"
              />
            </div>
            {!showForm && !editSupplier && (
              <button
                onClick={() => setShowForm(true)}
                className="flex items-center gap-1.5 px-3 py-2 bg-amber-500 text-white text-xs font-bold rounded-lg hover:bg-amber-600 cursor-pointer whitespace-nowrap"
              >
                <Plus size={13} /> Novo
              </button>
            )}
          </div>

          {/* Formulário novo */}
          {showForm && !editSupplier && (
            <SupplierForm
              onSave={handleSave}
              onCancel={() => setShowForm(false)}
            />
          )}

          {/* Lista */}
          {loading ? (
            <div className="flex items-center justify-center py-10 text-zinc-400 gap-2">
              <i className="ri-loader-4-line animate-spin" />
              <span className="text-xs">Carregando...</span>
            </div>
          ) : filtered.length === 0 && !showForm ? (
            <div className="text-center py-10">
              <Building2 size={32} className="text-zinc-200 mx-auto mb-3" />
              <p className="text-sm font-semibold text-zinc-500">
                {busca ? 'Nenhum fornecedor encontrado' : 'Nenhum fornecedor cadastrado'}
              </p>
              {!busca && (
                <p className="text-xs text-zinc-400 mt-1">Clique em "Novo" para adicionar o primeiro.</p>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filtered.map((s) => (
                <div key={s.id}>
                  {/* Formulário de edição inline */}
                  {editSupplier?.id === s.id ? (
                    <SupplierForm
                      initial={{
                        id: s.id,
                        name: s.name,
                        cnpj: s.cnpj ?? '',
                        phone: s.phone ?? '',
                        email: s.email ?? '',
                        address: s.address ?? '',
                      }}
                      onSave={handleSave}
                      onCancel={() => setEditSupplier(null)}
                    />
                  ) : (
                    <div
                      className={`flex items-start gap-3 p-3 rounded-xl border transition-all ${
                        selectMode
                          ? 'cursor-pointer hover:border-amber-300 hover:bg-amber-50 border-zinc-200'
                          : 'border-zinc-100 bg-zinc-50'
                      }`}
                      onClick={selectMode && onSelect ? () => onSelect(s) : undefined}
                    >
                      <div className="w-9 h-9 flex items-center justify-center rounded-lg bg-amber-100 flex-shrink-0 mt-0.5">
                        <Building2 size={16} className="text-amber-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-zinc-800">{s.name}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {s.phone && (
                            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                              <Phone size={9} />
                              {s.phone}
                            </span>
                          )}
                          {s.email && (
                            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                              <Mail size={9} />
                              {s.email}
                            </span>
                          )}
                          {s.address && (
                            <span className="flex items-center gap-1 text-[10px] text-zinc-500">
                              <MapPin size={9} />
                              <span className="truncate max-w-[160px]">{s.address}</span>
                            </span>
                          )}
                        </div>
  
                      </div>
                      {!selectMode && (
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <button
                            onClick={() => handleEdit(s)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white text-zinc-400 hover:text-amber-500 cursor-pointer"
                          >
                            <Edit2 size={12} />
                          </button>
                          <button
                            onClick={() => setConfirmRemove(s)}
                            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white text-zinc-400 hover:text-red-500 cursor-pointer"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                      {selectMode && (
                        <i className="ri-arrow-right-s-line text-zinc-300 text-sm mt-0.5" />
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-zinc-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-zinc-600 bg-zinc-100 rounded-lg hover:bg-zinc-200 cursor-pointer whitespace-nowrap">
            Fechar
          </button>
        </div>
      </div>

      {/* Confirmar remoção */}
      {confirmRemove && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl p-5 w-full max-w-sm mx-4">
            <p className="text-sm font-bold text-zinc-900 mb-2">Remover Fornecedor?</p>
            <p className="text-xs text-zinc-500 mb-4">
              "{confirmRemove.name}" será removido da lista. Esta ação não afeta as compras já registradas.
            </p>
            <div className="flex gap-2">
              <button onClick={() => setConfirmRemove(null)} className="flex-1 py-2 text-xs font-semibold text-zinc-600 bg-zinc-100 rounded-lg cursor-pointer">Cancelar</button>
              <button
                onClick={() => { remove(confirmRemove.id); setConfirmRemove(null); }}
                className="flex-1 py-2 text-xs font-semibold text-white bg-red-500 rounded-lg hover:bg-red-600 cursor-pointer"
              >
                Remover
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

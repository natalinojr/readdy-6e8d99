// ... existing code ...
import { useState, useEffect, useCallback } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useSuppliers } from '@/hooks/useSuppliers';
import ImportExportTemplatesModal from '@/components/ImportExportTemplatesModal';

interface DRECategory {
  id: string;
  name: string;
  group_type: string;
}

interface CatalogItem {
  id: string;
  name: string;
  description?: string;
  default_unit: string;
  dre_category_id?: string | null;
  default_supplier?: string | null;
  supplier_id?: string | null;
  notes?: string | null;
  is_active: boolean;
  dre_category?: { id: string; name: string; group_type: string } | null;
}

const UNIT_OPTIONS = [
  'un', 'kg', 'g', 'L', 'mL', 'cx', 'fardo', 'pacote', 'saco', 'lata',
  'garrafa', 'bandeja', 'dúzia', 'rolo', 'par', 'resma',
];

const emptyForm = {
  name: '',
  description: '',
  default_unit: 'un',
  dre_category_id: '',
  default_supplier: '',
  supplier_id: '',
  notes: '',
};

interface Props {
  onClose: () => void;
}

export default function CatalogoComprasModal({ onClose }: Props) {
  const { user } = useAuth();
  const { names: supplierNames, suppliers: supplierList } = useSuppliers();

  const [items, setItems] = useState<CatalogItem[]>([]);
  const [dreCategories, setDreCategories] = useState<DRECategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [supplierOpen, setSupplierOpen] = useState(false);
  const [supplierSearch, setSupplierSearch] = useState('');
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  const loadData = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const [catRes, dreRes] = await Promise.all([
      supabase
        .from('fin_purchase_catalog')
        .select('id, name, description, default_unit, dre_category_id, default_supplier, supplier_id, notes, is_active, dre_category:fin_dre_categories(id, name, group_type)')
        .eq('tenant_id', user.tenantId)
        .order('name'),
      supabase
        .from('fin_dre_categories')
        .select('id, name, group_type')
        .eq('tenant_id', user.tenantId)
        .eq('is_active', true)
        .order('group_type')
        .order('sort_order'),
    ]);
    setItems((catRes.data ?? []) as CatalogItem[]);
    setDreCategories(dreRes.data ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { loadData(); }, [loadData]);

  const openNew = () => {
    setEditingId(null);
    setForm(emptyForm);
    setSupplierSearch('');
    setShowForm(true);
  };

  const openEdit = (item: CatalogItem) => {
    setEditingId(item.id);
    setForm({
      name: item.name,
      description: item.description ?? '',
      default_unit: item.default_unit,
      dre_category_id: item.dre_category_id ?? '',
      default_supplier: item.default_supplier ?? '',
      supplier_id: item.supplier_id ?? '',
      notes: item.notes ?? '',
    });
    setSupplierSearch(item.default_supplier ?? '');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !user?.tenantId) return;
    setSaving(true);

    const payload = {
      name: form.name.trim(),
      description: form.description.trim() || null,
      default_unit: form.default_unit,
      dre_category_id: form.dre_category_id || null,
      default_supplier: form.default_supplier.trim() || null,
      supplier_id: form.supplier_id || null,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    if (editingId) {
      const { error } = await invokeWithAuth<{ error?: string; data?: unknown }>('financial-write', {
        body: {
          action: 'upsert_purchase_catalog',
          tenant_id: user.tenantId,
          payload: { id: editingId, ...payload },
        },
      });
      if (error) {
        console.error('[CatalogoCompras] erro ao salvar edição:', error);
      }
    } else {
      const { error } = await invokeWithAuth<{ error?: string; data?: unknown }>('financial-write', {
        body: {
          action: 'upsert_purchase_catalog',
          tenant_id: user.tenantId,
          payload: { ...payload, is_active: true },
        },
      });
      if (error) {
        console.error('[CatalogoCompras] erro ao salvar novo:', error);
      }
    }

    setSaving(false);
    setShowForm(false);
    loadData();
  };

  const handleToggleActive = async (item: CatalogItem) => {
    if (!user?.tenantId) return;
    const { error } = await invokeWithAuth<{ error?: string }>('financial-write', {
      body: {
        action: 'upsert_purchase_catalog',
        tenant_id: user.tenantId,
        payload: { id: item.id, is_active: !item.is_active },
      },
    });
    if (error) {
      console.error('[CatalogoCompras] erro ao ativar/desativar:', error);
    }
    loadData();
  };

  const handleDelete = async (id: string) => {
    if (!user?.tenantId) return;
    const { error } = await invokeWithAuth<{ error?: string }>('financial-write', {
      body: {
        action: 'delete_purchase_catalog',
        tenant_id: user.tenantId,
        payload: { id },
      },
    });
    if (error) {
      console.error('[CatalogoCompras] erro ao excluir:', error);
    }
    loadData();
  };

  const filteredItems = items.filter((i) =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    (i.description ?? '').toLowerCase().includes(search.toLowerCase()),
  );

  const filteredSuppliers = supplierNames.filter((s) =>
    s.toLowerCase().includes(supplierSearch.toLowerCase()),
  );

  const getDRELabel = (item: CatalogItem) => {
    if (!item.dre_category_id) return null;
    const cat = item.dre_category;
    if (!cat) return null;
    const color = cat.group_type === 'expense'
      ? 'bg-violet-100 text-violet-700'
      : cat.group_type === 'cost'
        ? 'bg-orange-100 text-orange-700'
        : 'bg-zinc-100 text-zinc-600';
    return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${color}`}>{cat.name}</span>;
  };

  const costCats = dreCategories.filter((c) => c.group_type === 'cost');
  const expenseCats = dreCategories.filter((c) => c.group_type === 'expense');

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-3">
      <div className="bg-white rounded-2xl w-full max-w-2xl flex flex-col" style={{ maxHeight: 'calc(100vh - 24px)' }}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100 flex-shrink-0">
          <div>
            <h3 className="font-semibold text-zinc-900 text-sm">Catálogo de Itens de Compra</h3>
            <p className="text-xs text-zinc-400 mt-0.5">
              Cadastre qualquer item que você compra e defina sua classificação no DRE
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        {/* Toolbar */}
        <div className="px-6 py-3 border-b border-zinc-100 flex items-center gap-3 flex-shrink-0">
          <div className="relative flex-1">
            <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar item..."
              className="w-full pl-9 pr-3 py-2 border border-zinc-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
            />
          </div>
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            title="Importar/Exportar Templates"
          >
            <i className="ri-file-transfer-line text-amber-500" /> Templates
          </button>
          <button
            onClick={openNew}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-line" /> Novo Item
          </button>
        </div>

        {/* Formulário inline */}
        {showForm && (
          <div className="px-6 py-4 border-b border-amber-100 bg-amber-50/50 flex-shrink-0">
            <p className="text-xs font-bold text-zinc-700 mb-3 flex items-center gap-1.5">
              <i className="ri-edit-line text-amber-500" />
              {editingId ? 'Editar Item' : 'Novo Item'}
            </p>
            <div className="space-y-3">
              {/* Nome + Unidade */}
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-2">
                  <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Nome do Item *</label>
                  <input
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    placeholder="Ex: Detergente, Embalagem, Papel Toalha..."
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Unidade padrão</label>
                  <select
                    value={form.default_unit}
                    onChange={(e) => setForm((f) => ({ ...f, default_unit: e.target.value }))}
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  >
                    {UNIT_OPTIONS.map((u) => <option key={u} value={u}>{u}</option>)}
                  </select>
                </div>
              </div>

              {/* Classificação DRE — campo principal */}
              <div>
                <label className="text-[10px] font-semibold text-zinc-500 block mb-1">
                  <i className="ri-folder-chart-line text-amber-500 mr-0.5" />
                  Classificação DRE *
                  <span className="text-zinc-400 font-normal ml-1">— onde este item aparece no DRE</span>
                </label>
                <select
                  value={form.dre_category_id}
                  onChange={(e) => setForm((f) => ({ ...f, dre_category_id: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                >
                  <option value="">CMV — Custo de Mercadoria Vendida (padrão)</option>
                  {costCats.length > 0 && (
                    <optgroup label="Custos">
                      {costCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  )}
                  {expenseCats.length > 0 && (
                    <optgroup label="Despesas Operacionais">
                      {expenseCats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </optgroup>
                  )}
                </select>
                <p className="text-[10px] text-zinc-400 mt-1">
                  Alimentos/bebidas = CMV &nbsp;·&nbsp; Limpeza/embalagem = Despesa Operacional
                </p>
              </div>

              {/* Fornecedor padrão */}
              <div className="relative">
                <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Fornecedor padrão (opcional)</label>
                <input
                  value={supplierSearch}
                  onChange={(e) => {
                    setSupplierSearch(e.target.value);
                    setForm((f) => ({ ...f, default_supplier: e.target.value, supplier_id: '' }));
                    setSupplierOpen(true);
                  }}
                  onFocus={() => setSupplierOpen(true)}
                  placeholder="Selecionar ou digitar..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                />
                {supplierOpen && filteredSuppliers.length > 0 && (
                  <div className="absolute z-10 top-full left-0 right-0 mt-1 bg-white border border-zinc-200 rounded-xl shadow-lg max-h-40 overflow-y-auto">
                    {filteredSuppliers.map((s) => {
                      const sup = supplierList.find((sl) => sl.name === s);
                      return (
                        <button
                          key={s}
                          type="button"
                          onClick={() => {
                            setSupplierSearch(s);
                            setForm((f) => ({ ...f, default_supplier: s, supplier_id: sup?.id ?? '' }));
                            setSupplierOpen(false);
                          }}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-amber-50 cursor-pointer"
                        >
                          {s}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Descrição + Obs */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Descrição (opcional)</label>
                  <input
                    value={form.description}
                    onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                    placeholder="Detalhes adicionais..."
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-zinc-500 block mb-1">Observações (opcional)</label>
                  <input
                    value={form.notes}
                    onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                    placeholder="Obs. internas..."
                    className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 bg-white"
                  />
                </div>
              </div>

              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="flex-1 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving || !form.name.trim()}
                  className="flex-1 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold cursor-pointer whitespace-nowrap transition-colors"
                >
                  {saving ? 'Salvando...' : editingId ? 'Salvar' : 'Cadastrar'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Lista */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-16 text-zinc-400 text-sm">
              <i className="ri-loader-4-line animate-spin mr-2" /> Carregando...
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-center px-6">
              <div className="w-14 h-14 flex items-center justify-center bg-zinc-100 rounded-2xl mb-3">
                <i className="ri-archive-line text-2xl text-zinc-400" />
              </div>
              <p className="text-zinc-600 font-semibold text-sm">
                {search ? 'Nenhum item encontrado' : 'Catálogo vazio'}
              </p>
              <p className="text-zinc-400 text-xs mt-1 max-w-xs">
                {search
                  ? 'Tente outro termo de busca'
                  : 'Cadastre itens como produtos de limpeza, embalagens, materiais de escritório e defina onde cada um aparece no DRE'}
              </p>
              {!search && (
                <button
                  onClick={openNew}
                  className="mt-4 flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap"
                >
                  <i className="ri-add-line" /> Cadastrar primeiro item
                </button>
              )}
            </div>
          ) : (
            <div className="divide-y divide-zinc-50">
              {filteredItems.map((item) => (
                <div
                  key={item.id}
                  className={`flex items-center gap-3 px-6 py-3 hover:bg-zinc-50 transition-colors ${!item.is_active ? 'opacity-50' : ''}`}
                >
                  <div className="w-9 h-9 flex items-center justify-center bg-zinc-100 rounded-xl flex-shrink-0">
                    <i className="ri-archive-line text-zinc-500 text-sm" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-semibold text-zinc-800">{item.name}</p>
                      <span className="text-[10px] bg-zinc-100 text-zinc-500 px-2 py-0.5 rounded-full font-semibold">
                        {item.default_unit}
                      </span>
                      {getDRELabel(item)}
                      {!item.dre_category_id && (
                        <span className="text-[10px] bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full font-semibold">
                          CMV
                        </span>
                      )}
                    </div>
                    {item.description && (
                      <p className="text-xs text-zinc-400 mt-0.5 truncate">{item.description}</p>
                    )}
                    {item.default_supplier && (
                      <p className="text-xs text-zinc-400 flex items-center gap-1 mt-0.5">
                        <i className="ri-store-2-line text-[10px]" />
                        {item.default_supplier}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={() => openEdit(item)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                      title="Editar"
                    >
                      <i className="ri-edit-line text-sm" />
                    </button>
                    <button
                      onClick={() => handleToggleActive(item)}
                      className={`w-8 h-8 flex items-center justify-center rounded-lg cursor-pointer transition-colors ${
                        item.is_active
                          ? 'hover:bg-amber-50 text-zinc-400 hover:text-amber-600'
                          : 'hover:bg-green-50 text-zinc-300 hover:text-green-600'
                      }`}
                      title={item.is_active ? 'Desativar' : 'Ativar'}
                    >
                      <i className={`text-sm ${item.is_active ? 'ri-eye-off-line' : 'ri-eye-line'}`} />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-300 hover:text-red-500 cursor-pointer"
                      title="Excluir"
                    >
                      <i className="ri-delete-bin-line text-sm" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-zinc-100 flex items-center justify-between flex-shrink-0">
          <p className="text-xs text-zinc-400">
            {items.filter((i) => i.is_active).length} item{items.filter((i) => i.is_active).length !== 1 ? 's' : ''} ativo{items.filter((i) => i.is_active).length !== 1 ? 's' : ''}
          </p>
          <button onClick={onClose} className="px-4 py-2 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap">
            Fechar
          </button>
        </div>

        {showTemplatesModal && (
          <ImportExportTemplatesModal
            open={showTemplatesModal}
            defaultTab="catalog_items"
            catalogItemsData={items.filter(i => i.is_active).map(i => ({
              name: i.name,
              description: i.description,
              default_unit: i.default_unit,
              dre_category_id: i.dre_category_id,
              default_supplier: i.default_supplier,
              notes: i.notes,
            }))}
            onClose={() => setShowTemplatesModal(false)}
            onSuccess={() => loadData()}
          />
        )}
      </div>
    </div>
  );
}

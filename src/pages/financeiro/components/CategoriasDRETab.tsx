import { useState, useCallback, useEffect } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import ImportExportTemplatesModal from '@/components/ImportExportTemplatesModal';

async function callFinancialWrite(action: string, tenantId: string, payload: Record<string, unknown>) {
  const { data, error } = await invokeWithAuth<{ error?: string; data?: unknown }>('financial-write', {
    body: { action, tenant_id: tenantId, payload },
  });
  if (error) throw new Error(error.message ?? 'Erro na edge function');
  if ((data as Record<string, unknown>)?.error) throw new Error((data as Record<string, unknown>).error as string);
  return data;
}

interface DRECat {
  id: string;
  tenant_id: string;
  group_type: string;
  name: string;
  sort_order: number;
  parent_id: string | null;
  is_active: boolean;
  created_at: string;
  children?: DRECat[];
}

const DEFAULT_GROUP_LABELS: Record<string, { label: string; color: string; bg: string; icon: string }> = {
  revenue: { label: 'Receitas', color: 'text-green-700', bg: 'bg-green-50 border-green-200', icon: 'ri-arrow-down-circle-line' },
  cost: { label: 'Custos', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200', icon: 'ri-shopping-bag-line' },
  expense: { label: 'Despesas Operacionais', color: 'text-red-700', bg: 'bg-red-50 border-red-200', icon: 'ri-money-dollar-circle-line' },
  tax: { label: 'Impostos e Taxas', color: 'text-zinc-700', bg: 'bg-zinc-50 border-zinc-200', icon: 'ri-government-line' },
};

const FALLBACK_GROUP = { label: '', color: 'text-zinc-700', bg: 'bg-zinc-50 border-zinc-200', icon: 'ri-folder-line' };

function getGroupMeta(groupType: string, customGroups: CustomGroup[]) {
  if (DEFAULT_GROUP_LABELS[groupType]) return DEFAULT_GROUP_LABELS[groupType];
  const custom = customGroups.find(g => g.key === groupType);
  if (custom) return { label: custom.label, color: 'text-zinc-700', bg: 'bg-zinc-50 border-zinc-200', icon: custom.icon || 'ri-folder-line' };
  return { ...FALLBACK_GROUP, label: groupType };
}

const STANDARD_GROUPS = Object.keys(DEFAULT_GROUP_LABELS);

interface CustomGroup {
  key: string;
  label: string;
  icon: string;
}

const ICON_OPTIONS = [
  'ri-folder-line', 'ri-building-line', 'ri-car-line', 'ri-tools-line',
  'ri-computer-line', 'ri-store-line', 'ri-service-line', 'ri-bank-line',
  'ri-briefcase-line', 'ri-home-line', 'ri-leaf-line', 'ri-heart-line',
];

function buildTree(cats: DRECat[]): DRECat[] {
  const map: Record<string, DRECat> = {};
  cats.forEach(c => { map[c.id] = { ...c, children: [] }; });
  const roots: DRECat[] = [];
  cats.forEach(c => {
    if (c.parent_id && map[c.parent_id]) {
      map[c.parent_id].children!.push(map[c.id]);
    } else {
      roots.push(map[c.id]);
    }
  });
  return roots;
}

interface CatNodeProps {
  cat: DRECat;
  depth: number;
  allCats: DRECat[];
  onEdit: (cat: DRECat) => void;
  onDelete: (id: string) => void;
  onAddChild: (parent: DRECat) => void;
  customGroups: CustomGroup[];
}

function CatNode({ cat, depth, allCats, onEdit, onDelete, onAddChild, customGroups }: CatNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (cat.children?.length ?? 0) > 0;
  const indent = depth * 24;
  const groupMeta = getGroupMeta(cat.group_type, customGroups);

  return (
    <>
      <tr className="hover:bg-zinc-50 transition-colors group">
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2" style={{ paddingLeft: indent }}>
            {hasChildren ? (
              <button
                onClick={() => setExpanded(e => !e)}
                className="w-5 h-5 flex items-center justify-center rounded cursor-pointer text-zinc-400 hover:text-zinc-700 flex-shrink-0"
              >
                <i className={`${expanded ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm`} />
              </button>
            ) : (
              <div className="w-5 h-5 flex items-center justify-center flex-shrink-0">
                <div className="w-1.5 h-1.5 rounded-full bg-zinc-300" />
              </div>
            )}
            <span className={`text-sm ${depth === 0 ? 'font-semibold text-zinc-800' : depth === 1 ? 'font-medium text-zinc-700' : 'text-zinc-600'}`}>
              {cat.name}
            </span>
            {depth > 0 && (
              <span className="text-xs text-zinc-400 ml-1">
                {'└'.repeat(1)} nível {depth + 1}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-2.5">
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${groupMeta.bg} ${groupMeta.color}`}>
            {groupMeta.label}
          </span>
        </td>
        <td className="px-4 py-2.5 text-xs text-zinc-400">
          {cat.parent_id ? allCats.find(c => c.id === cat.parent_id)?.name ?? '—' : <span className="text-zinc-500 font-medium">Raiz</span>}
        </td>
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onClick={() => onAddChild(cat)}
              className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-1 rounded-lg cursor-pointer hover:bg-amber-100 whitespace-nowrap"
              title="Adicionar subcategoria"
            >
              <i className="ri-add-line" /> Sub
            </button>
            <button
              onClick={() => onEdit(cat)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 cursor-pointer"
            >
              <i className="ri-edit-line text-xs" />
            </button>
            <button
              onClick={() => onDelete(cat.id)}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
            >
              <i className="ri-delete-bin-line text-xs" />
            </button>
          </div>
        </td>
      </tr>
      {expanded && hasChildren && cat.children!.map(child => (
        <CatNode
          key={child.id}
          cat={child}
          depth={depth + 1}
          allCats={allCats}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          customGroups={customGroups}
        />
      ))}
    </>
  );
}

const emptyForm = { name: '', group_type: 'expense', parent_id: '' };
const emptyGroupForm = { key: '', label: '', icon: 'ri-folder-line' };

export default function CategoriasDRETab() {
  const { user } = useAuth();
  const [cats, setCats] = useState<DRECat[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<DRECat | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filterGroup, setFilterGroup] = useState('all');

  // Grupos customizados (armazenados em localStorage por tenant)
  const storageKey = user?.tenantId ? `dre_custom_groups_${user.tenantId}` : null;
  const [customGroups, setCustomGroups] = useState<CustomGroup[]>(() => {
    if (!storageKey) return [];
    try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]'); } catch { return []; }
  });
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  const saveCustomGroups = (groups: CustomGroup[]) => {
    setCustomGroups(groups);
    if (storageKey) localStorage.setItem(storageKey, JSON.stringify(groups));
  };

  const allGroups = [...STANDARD_GROUPS, ...customGroups.map(g => g.key)];
  const getGroupMeta2 = (g: string) => getGroupMeta(g, customGroups);

  const fetchCats = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    const { data } = await supabase
      .from('fin_dre_categories')
      .select('*')
      .eq('tenant_id', user.tenantId)
      .eq('is_active', true)
      .order('group_type')
      .order('sort_order');
    setCats(data ?? []);
    setLoading(false);
  }, [user?.tenantId]);

  useEffect(() => { fetchCats(); }, [fetchCats]);

  const openNew = (parent?: DRECat) => {
    setEditing(null);
    setSaveError(null);
    setForm({
      name: '',
      group_type: parent?.group_type ?? 'expense',
      parent_id: parent?.id ?? '',
    });
    setShowModal(true);
  };

  const openEdit = (cat: DRECat) => {
    setEditing(cat);
    setSaveError(null);
    setForm({ name: cat.name, group_type: cat.group_type, parent_id: cat.parent_id ?? '' });
    setShowModal(true);
  };

  const handleDelete = async (id: string) => {
    if (!user?.tenantId) return;
    try {
      await callFinancialWrite('delete_dre_category', user.tenantId, { id });
    } catch {
      // silently ignore
    }
    fetchCats();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.tenantId) return;
    setSaving(true);
    setSaveError(null);

    // Validação local de duplicata (mesmo nome + mesmo grupo + mesmo pai)
    const trimmedName = form.name.trim().toLowerCase();
    const isDuplicate = cats.some(
      c =>
        c.name.trim().toLowerCase() === trimmedName &&
        c.group_type === form.group_type &&
        (c.parent_id ?? '') === (form.parent_id ?? '') &&
        c.id !== editing?.id
    );
    if (isDuplicate) {
      setSaving(false);
      setSaveError('Já existe uma categoria com este nome neste grupo. Escolha outro nome.');
      return;
    }

    const payload = {
      id: editing?.id,
      name: form.name,
      group_type: form.group_type,
      parent_id: form.parent_id || null,
      sort_order: cats.filter(c => c.group_type === form.group_type).length,
      is_active: true,
    };

    try {
      await callFinancialWrite('upsert_dre_category', user.tenantId, payload);
      setShowModal(false);
      fetchCats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        setSaveError('Já existe uma categoria com este nome neste grupo. Escolha outro nome.');
      } else {
        setSaveError(msg);
      }
    } finally {
      setSaving(false);
    }
  };

  const filteredCats = filterGroup === 'all' ? cats : cats.filter(c => c.group_type === filterGroup);
  const tree = buildTree(filteredCats);

  // Group tree by group_type
  const groupedTree: Record<string, DRECat[]> = {};
  tree.forEach(node => {
    if (!groupedTree[node.group_type]) groupedTree[node.group_type] = [];
    groupedTree[node.group_type].push(node);
  });

  // Todos os grupos que aparecem nas categorias (padrão + custom + novos)
  const usedGroups = [...new Set(cats.map(c => c.group_type))];
  const allGroupsToShow = [...new Set([...allGroups, ...usedGroups])];

  const totalByGroup = allGroupsToShow.reduce((acc, g) => {
    acc[g] = cats.filter(c => c.group_type === g).length;
    return acc;
  }, {} as Record<string, number>);

  const handleAddGroup = () => {
    setGroupError(null);
    setGroupForm(emptyGroupForm);
    setShowGroupModal(true);
  };

  const handleSaveGroup = () => {
    const key = groupForm.key.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || !groupForm.label.trim()) {
      setGroupError('Preencha o nome e a chave do grupo.');
      return;
    }
    if (STANDARD_GROUPS.includes(key) || customGroups.some(g => g.key === key)) {
      setGroupError('Já existe um grupo com esta chave.');
      return;
    }
    saveCustomGroups([...customGroups, { key, label: groupForm.label.trim(), icon: groupForm.icon }]);
    setShowGroupModal(false);
  };

  const handleDeleteGroup = (key: string) => {
    saveCustomGroups(customGroups.filter(g => g.key !== key));
    if (filterGroup === key) setFilterGroup('all');
  };

  return (
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-zinc-800">Categorias do DRE</h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Crie categorias e subcategorias ilimitadas para estruturar seu DRE
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
            title="Importar/Exportar Templates"
          >
            <i className="ri-file-transfer-line text-amber-500" /> Templates
          </button>
          <button
            onClick={handleAddGroup}
            className="flex items-center gap-2 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-circle-line text-amber-500" /> Novo Grupo
          </button>
          <button
            onClick={() => openNew()}
            className="flex items-center gap-2 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors"
          >
            <i className="ri-add-line" /> Nova Categoria
          </button>
        </div>
      </div>

      {/* Group KPIs */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {allGroupsToShow.map(g => {
          const meta = getGroupMeta2(g);
          const isCustom = customGroups.some(cg => cg.key === g);
          return (
            <div key={g} className="relative group/card">
              <button
                onClick={() => setFilterGroup(filterGroup === g ? 'all' : g)}
                className={`w-full rounded-xl border p-4 text-left cursor-pointer transition-all ${filterGroup === g ? meta.bg + ' ring-2 ring-amber-400' : 'bg-white border-zinc-200 hover:border-zinc-300'}`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <i className={`${meta.icon} ${meta.color} text-base`} />
                  <span className={`text-xs font-semibold ${meta.color} truncate`}>{meta.label}</span>
                </div>
                <p className="text-xl font-bold text-zinc-800">{totalByGroup[g] ?? 0}</p>
                <p className="text-xs text-zinc-400">categorias</p>
              </button>
              {isCustom && (
                <button
                  onClick={() => handleDeleteGroup(g)}
                  className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full bg-red-100 text-red-500 hover:bg-red-200 cursor-pointer opacity-0 group-hover/card:opacity-100 transition-opacity"
                  title="Remover grupo"
                >
                  <i className="ri-close-line text-xs" />
                </button>
              )}
            </div>
          );
        })}
      </div>

      {/* Info box */}
      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
        <div className="w-7 h-7 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
          <i className="ri-information-line text-amber-600 text-sm" />
        </div>
        <div>
          <p className="text-xs font-semibold text-amber-800">Como funciona a hierarquia</p>
          <p className="text-xs text-amber-700 mt-0.5">
            Crie categorias raiz (ex: <strong>Despesas Operacionais</strong>) e adicione subcategorias ilimitadas (ex: Folha de Pagamento → Salários → Funcionário X).
            As categorias aparecem no DRE agrupadas e as contas a pagar podem ser vinculadas a qualquer nível.
          </p>
        </div>
      </div>

      {/* Tabela em árvore */}
      {loading ? (
        <div className="bg-white rounded-xl border border-zinc-200 p-8 text-center text-zinc-400 text-sm">
          Carregando categorias...
        </div>
      ) : cats.length === 0 ? (
        <div className="bg-white rounded-xl border border-zinc-200 p-12 text-center">
          <i className="ri-folder-chart-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-zinc-500 font-medium">Nenhuma categoria cadastrada</p>
          <p className="text-zinc-400 text-sm mt-1">Crie categorias para estruturar seu DRE</p>
          <button
            onClick={() => openNew()}
            className="mt-4 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-semibold cursor-pointer transition-colors"
          >
            Criar primeira categoria
          </button>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-zinc-200 overflow-hidden">
          <table className="w-full">
            <thead className="bg-zinc-50 border-b border-zinc-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Nome</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Grupo</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Categoria Pai</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-zinc-500">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {allGroupsToShow.filter(g => filterGroup === 'all' || filterGroup === g).map(g => {
                const groupNodes = groupedTree[g] ?? [];
                if (groupNodes.length === 0) return null;
                const meta = getGroupMeta2(g);
                return (
                  <>
                    <tr key={`header-${g}`} className={`${meta.bg}`}>
                      <td colSpan={4} className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          <i className={`${meta.icon} ${meta.color} text-sm`} />
                          <span className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                          <span className="text-xs text-zinc-400 ml-1">({cats.filter(c => c.group_type === g).length} categorias)</span>
                        </div>
                      </td>
                    </tr>
                    {groupNodes.map(node => (
                      <CatNode
                        key={node.id}
                        cat={node}
                        depth={0}
                        allCats={cats}
                        onEdit={openEdit}
                        onDelete={handleDelete}
                        onAddChild={openNew}
                        customGroups={customGroups}
                      />
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal Novo Grupo */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">Novo Grupo DRE</h3>
              <button onClick={() => setShowGroupModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Nome do Grupo *</label>
                <input
                  value={groupForm.label}
                  onChange={e => setGroupForm(f => ({ ...f, label: e.target.value, key: e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '') }))}
                  placeholder="Ex: Investimentos, Outros..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Chave interna (gerada automaticamente)</label>
                <input
                  value={groupForm.key}
                  onChange={e => setGroupForm(f => ({ ...f, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') }))}
                  placeholder="ex: investimentos"
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono"
                />
                <p className="text-xs text-zinc-400 mt-1">Usada internamente para identificar o grupo. Não pode ser alterada depois.</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Ícone</label>
                <div className="grid grid-cols-6 gap-2">
                  {ICON_OPTIONS.map(icon => (
                    <button
                      key={icon}
                      type="button"
                      onClick={() => setGroupForm(f => ({ ...f, icon }))}
                      className={`w-9 h-9 flex items-center justify-center rounded-lg border cursor-pointer transition-colors ${
                        groupForm.icon === icon ? 'bg-amber-100 border-amber-400 text-amber-700' : 'border-zinc-200 text-zinc-500 hover:bg-zinc-50'
                      }`}
                    >
                      <i className={`${icon} text-base`} />
                    </button>
                  ))}
                </div>
              </div>
              {groupError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-600">{groupError}</p>
                </div>
              )}
              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowGroupModal(false)}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveGroup}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
                >
                  Criar Grupo
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal Categoria */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">
                {editing ? 'Editar Categoria' : form.parent_id ? 'Nova Subcategoria' : 'Nova Categoria'}
              </h3>
              <button onClick={() => setShowModal(false)} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Nome da Categoria *</label>
                <input
                  required
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  placeholder="Ex: Folha de Pagamento, Energia Elétrica..."
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Grupo do DRE *</label>
                <select
                  value={form.group_type}
                  onChange={e => setForm(f => ({ ...f, group_type: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  {allGroupsToShow.map(g => (
                    <option key={g} value={g}>{getGroupMeta2(g).label || g}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Categoria Pai (opcional)</label>
                <select
                  value={form.parent_id}
                  onChange={e => setForm(f => ({ ...f, parent_id: e.target.value }))}
                  className="w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                >
                  <option value="">Nenhuma (categoria raiz)</option>
                  {cats
                    .filter(c => c.group_type === form.group_type && c.id !== editing?.id)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.parent_id ? '  └ ' : ''}{c.name}
                      </option>
                    ))}
                </select>
                <p className="text-xs text-zinc-400 mt-1">
                  Deixe vazio para criar uma categoria de nível raiz. Selecione uma categoria pai para criar uma subcategoria.
                </p>
              </div>

              {form.parent_id && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                  <p className="text-xs text-amber-700">
                    <i className="ri-corner-down-right-line mr-1" />
                    Esta será uma subcategoria de: <strong>{cats.find(c => c.id === form.parent_id)?.name}</strong>
                  </p>
                </div>
              )}

              {saveError && (
                <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                  <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                  <p className="text-xs text-red-600">{saveError}</p>
                </div>
              )}

              <div className="flex gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap disabled:opacity-60 flex items-center justify-center gap-2"
                >
                  {saving ? <><i className="ri-loader-4-line animate-spin" /> Salvando...</> : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Templates Modal */}
      {showTemplatesModal && (
        <ImportExportTemplatesModal
          open={showTemplatesModal}
          defaultTab="dre_categories"
          dreCategoriesData={cats.map(c => ({
            name: c.name,
            group_type: c.group_type,
            parent_id: c.parent_id,
            sort_order: c.sort_order,
          }))}
          onClose={() => setShowTemplatesModal(false)}
          onSuccess={() => fetchCats()}
        />
      )}
    </div>
  );
}

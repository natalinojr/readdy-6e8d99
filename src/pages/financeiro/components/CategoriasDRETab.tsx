import { useState, useCallback, useEffect, Fragment } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import ImportExportTemplatesModal from '@/components/ImportExportTemplatesModal';
import { useDreGroups, type DreGroup } from '@/hooks/useDreGroups';

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

// As cores continuam vindo da tabela fixa; o nome e o ícone vêm do que a loja
// gravou, quando gravou (inclusive para grupo padrão renomeado).
function getGroupMeta(groupType: string, groups: DreGroup[]) {
  const base = DEFAULT_GROUP_LABELS[groupType] ?? { ...FALLBACK_GROUP, label: groupType };
  const g = groups.find(x => x.key === groupType);
  return g ? { ...base, label: g.label, icon: g.icon || base.icon } : base;
}

/**
 * "Custos" e "Impostos e Taxas" foram aposentados em 2026-09-05 a pedido do dono:
 * custo era redundante com o CMV (o padrão de todo item sem classificação) e
 * imposto nunca foi somado pela DRE. Os rótulos continuam acima só para que
 * categorias antigas ainda apareçam com nome, mas os grupos não são mais
 * oferecidos ao criar categoria nem viram card fixo na tela.
 */
const GRUPOS_APOSENTADOS = ['cost', 'tax'];

/** Grupos padrão oferecidos hoje. */
const STANDARD_GROUPS = Object.keys(DEFAULT_GROUP_LABELS).filter(
  g => !GRUPOS_APOSENTADOS.includes(g),
);

/** Chaves que ninguém pode reusar ao criar um grupo, aposentados incluídos. */
const RESERVED_GROUP_KEYS = Object.keys(DEFAULT_GROUP_LABELS);

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
  onEdit: (cat: DRECat) => void;
  onDelete: (cat: DRECat) => void;
  onAddChild: (parent: DRECat) => void;
  /** Com busca ativa a árvore fica toda aberta, para mostrar onde o resultado está. */
  forceOpen?: boolean;
}

function CatNode({ cat, depth, onEdit, onDelete, onAddChild, forceOpen }: CatNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const hasChildren = (cat.children?.length ?? 0) > 0;
  const open = forceOpen || expanded;

  return (
    <>
      <div
        className="group flex items-center gap-2 pr-3 py-2 hover:bg-zinc-50 transition-colors"
        style={{ paddingLeft: 12 + depth * 22 }}
      >
        {hasChildren ? (
          <button
            onClick={() => setExpanded(e => !e)}
            className="w-5 h-5 flex items-center justify-center rounded cursor-pointer text-zinc-400 hover:text-zinc-700 flex-shrink-0"
            title={open ? 'Recolher' : 'Expandir'}
          >
            <i className={`${open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line'} text-sm`} />
          </button>
        ) : (
          <span className="w-5 h-5 flex items-center justify-center flex-shrink-0">
            <span className={`w-1.5 h-1.5 rounded-full ${depth === 0 ? 'bg-zinc-400' : 'bg-zinc-300'}`} />
          </span>
        )}
        <span className={`flex-1 min-w-0 truncate text-sm ${depth === 0 ? 'font-semibold text-zinc-800' : 'text-zinc-600'}`}>
          {cat.name}
        </span>
        {hasChildren && (
          <span className="text-[10px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded-full whitespace-nowrap">
            {cat.children!.length} sub
          </span>
        )}
        <div className="flex items-center gap-0.5 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
          <button
            onClick={() => onAddChild(cat)}
            className="flex items-center gap-0.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 px-1.5 py-1 rounded-md cursor-pointer whitespace-nowrap"
            title="Adicionar subcategoria"
          >
            <i className="ri-add-line" /> Sub
          </button>
          <button
            onClick={() => onEdit(cat)}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer"
            title="Editar"
          >
            <i className="ri-edit-line text-xs" />
          </button>
          <button
            onClick={() => onDelete(cat)}
            className="w-7 h-7 flex items-center justify-center rounded-md hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
            title="Excluir"
          >
            <i className="ri-delete-bin-line text-xs" />
          </button>
        </div>
      </div>
      {open && hasChildren && cat.children!.map(child => (
        <CatNode
          key={child.id}
          cat={child}
          depth={depth + 1}
          onEdit={onEdit}
          onDelete={onDelete}
          onAddChild={onAddChild}
          forceOpen={forceOpen}
        />
      ))}
    </>
  );
}

// Como o DRE usa cada grupo — mostrado no cabeçalho do grupo para a loja saber
// se classificar ali muda o resultado (ver GRUPOS_FORA_DA_DRE em useDreGroups).
function papelDoGrupo(key: string) {
  if (key === 'revenue') return { label: 'Não soma no resultado', cls: 'bg-zinc-100 text-zinc-500', title: 'Categorias de receita não são somadas pela DRE; a receita vem das fontes de Receitas › Fontes.' };
  if (key === 'cost' || key === 'tax') return { label: 'Grupo antigo', cls: 'bg-amber-50 text-amber-700', title: 'Grupo aposentado em 2026-09-05. Custo = CMV; imposto nunca entrou no resultado. Mova as categorias para outro grupo.' };
  return { label: 'Subtrai do resultado', cls: 'bg-rose-50 text-rose-600', title: 'Contas a pagar e itens de compra classificados aqui entram como despesa na DRE.' };
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
  const [busca, setBusca] = useState('');
  // Confirmação inline de exclusão (nada de window.confirm)
  const [deleteTarget, setDeleteTarget] = useState<DRECat | null>(null);
  const [deleteUsage, setDeleteUsage] = useState<number | null>(null);
  const [countingUsage, setCountingUsage] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Grupos customizados: agora vivem no banco (fin_dre_groups). Antes eram
  // localStorage, então ficavam presos a um navegador e invisíveis para o resto
  // da loja — e o item de compra classificado neles não tinha como ser lido de
  // outra máquina.
  const storageKey = user?.tenantId ? `dre_custom_groups_${user.tenantId}` : null;
  const { gruposComLegado, customGroups, refetch: refetchGroups } = useDreGroups();

  // Migração única do que já existia no navegador desta máquina.
  useEffect(() => {
    if (!storageKey || !user?.tenantId) return;
    let antigos: CustomGroup[] = [];
    try { antigos = JSON.parse(localStorage.getItem(storageKey) ?? '[]'); } catch { return; }
    if (!antigos.length) return;
    (async () => {
      for (const g of antigos) {
        await callFinancialWrite('upsert_dre_group', user.tenantId!, {
          key: g.key, label: g.label, icon: g.icon || 'ri-folder-line',
        }).catch((e) => console.error('[CategoriasDRE] migração de grupo falhou:', e));
      }
      localStorage.removeItem(storageKey);
      refetchGroups();
    })();
  }, [storageKey, user?.tenantId, refetchGroups]);
  const [showGroupModal, setShowGroupModal] = useState(false);
  const [editingGroup, setEditingGroup] = useState<string | null>(null);
  const [groupForm, setGroupForm] = useState(emptyGroupForm);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [showTemplatesModal, setShowTemplatesModal] = useState(false);

  const allGroups = [...STANDARD_GROUPS, ...customGroups.map(g => g.key)];
  const getGroupMeta2 = (g: string) => getGroupMeta(g, gruposComLegado);

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

  // Exclusão de categoria é DELETE FÍSICO. Antes o erro era engolido (o botão
  // "não fazia nada" quando havia FK) e, quando passava, o histórico da categoria
  // sumia de DREs já fechadas sem aviso. Agora: contamos o uso, confirmamos inline
  // (sem window.confirm) e EXIBIMOS qualquer erro.
  const requestDelete = async (cat: DRECat) => {
    if (!user?.tenantId) return;
    setDeleteError(null);
    setDeleteTarget(cat);
    setDeleteUsage(null);
    setCountingUsage(true);
    const { count, error } = await supabase
      .from('fin_accounts_payable')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', user.tenantId)
      .eq('dre_category_id', cat.id);
    setCountingUsage(false);
    if (error) {
      setDeleteError(`Não foi possível verificar o uso da categoria: ${error.message}`);
      return;
    }
    setDeleteUsage(count ?? 0);
  };

  const confirmDelete = async () => {
    if (!user?.tenantId || !deleteTarget) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await callFinancialWrite('delete_dre_category', user.tenantId, { id: deleteTarget.id });
      setDeleteTarget(null);
      fetchCats();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      // FK RESTRICT costuma vir como violação de chave estrangeira — traduzimos.
      setDeleteError(
        /foreign key|violates|23503/i.test(msg)
          ? 'Esta categoria não pode ser excluída porque está vinculada a lançamentos. Reclassifique os lançamentos antes de excluir.'
          : msg
      );
    } finally {
      setDeleting(false);
    }
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

    // sort_order só é calculado na CRIAÇÃO. Na edição ele era recalculado como
    // "quantidade de categorias do grupo", o que jogava a categoria para o fim da
    // lista só por renomeá-la (e criava colisões de posição). Na edição preservamos
    // o valor atual.
    const payload = {
      id: editing?.id,
      name: form.name,
      group_type: form.group_type,
      parent_id: form.parent_id || null,
      sort_order: editing
        ? editing.sort_order
        : cats.filter(c => c.group_type === form.group_type).length,
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
    setEditingGroup(null);
    setGroupForm(emptyGroupForm);
    setShowGroupModal(true);
  };

  // A chave nunca muda na edição: é ela que as categorias guardam em
  // `group_type`, então trocá-la deixaria todas elas órfãs.
  const handleEditGroup = (key: string) => {
    const meta = getGroupMeta2(key);
    setGroupError(null);
    setEditingGroup(key);
    setGroupForm({ key, label: meta.label || key, icon: meta.icon });
    setShowGroupModal(true);
  };

  const handleSaveGroup = async () => {
    const key = editingGroup ?? groupForm.key.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || !groupForm.label.trim()) {
      setGroupError('Preencha o nome e a chave do grupo.');
      return;
    }
    if (!editingGroup && (RESERVED_GROUP_KEYS.includes(key) || customGroups.some(g => g.key === key))) {
      setGroupError('Já existe um grupo com esta chave.');
      return;
    }
    if (!user?.tenantId) return;
    try {
      // Grava por (tenant, key): cria o grupo novo e, num grupo padrão, vira o
      // rótulo próprio da loja para ele.
      await callFinancialWrite('upsert_dre_group', user.tenantId, {
        key, label: groupForm.label.trim(), icon: groupForm.icon,
      });
      await refetchGroups();
      setShowGroupModal(false);
      setEditingGroup(null);
    } catch (e) {
      setGroupError(e instanceof Error ? e.message : 'Erro ao salvar o grupo.');
    }
  };

  // Num grupo customizado apaga o grupo; num grupo padrão renomeado apaga só o
  // apelido, devolvendo o nome de fábrica.
  const handleDeleteGroup = async (key: string) => {
    const grupo = gruposComLegado.find(g => g.key === key);
    if (!grupo?.id || !user?.tenantId) return;
    try {
      await callFinancialWrite('delete_dre_group', user.tenantId, { id: grupo.id });
      await refetchGroups();
      if (filterGroup === key) setFilterGroup('all');
    } catch (e) {
      // O backend recusa (409) apagar grupo que ainda tem categorias; antes o
      // erro só ia pro console e o clique parecia não fazer nada.
      console.error('[CategoriasDRE] erro ao excluir grupo:', e);
      alert(e instanceof Error ? e.message : 'Não foi possível remover o grupo.');
    }
  };

  // Busca por nome: mantém o nó que casa (com todos os filhos) ou o que tem
  // descendente que casa (só com os filhos que casam), para a hierarquia não sumir.
  const q = busca.trim().toLowerCase();
  const filtrarArvore = (nodes: DRECat[]): DRECat[] => nodes.flatMap(n => {
    if (!q) return [n];
    const casa = n.name.toLowerCase().includes(q);
    const filhos = filtrarArvore(n.children ?? []);
    return casa ? [n] : filhos.length ? [{ ...n, children: filhos }] : [];
  });

  const gruposVisiveis = allGroupsToShow
    .filter(g => filterGroup === 'all' || filterGroup === g)
    .map(g => ({ g, nodes: filtrarArvore(groupedTree[g] ?? []) }))
    .filter(({ nodes }) => !q || nodes.length > 0);

  const novaNoGrupo = (g: string) => {
    setEditing(null);
    setSaveError(null);
    setForm({ name: '', group_type: g, parent_id: '' });
    setShowModal(true);
  };

  return (
    <div className="p-6 space-y-5 max-w-[1400px] mx-auto">
      {/* ── Cabeçalho ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-100 text-amber-600 flex items-center justify-center">
            <i className="ri-folder-chart-line text-lg" />
          </span>
          <div>
            <h3 className="text-sm font-bold text-zinc-900">Estrutura do DRE</h3>
            <p className="text-xs text-zinc-400">
              {cats.length} categoria{cats.length !== 1 ? 's' : ''} em {allGroupsToShow.length} grupo{allGroupsToShow.length !== 1 ? 's' : ''} · subcategorias ilimitadas
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setShowTemplatesModal(true)}
            className="flex items-center gap-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
            title="Importar/Exportar Templates"
          >
            <i className="ri-file-transfer-line text-zinc-400" /> Templates
          </button>
          <button
            onClick={handleAddGroup}
            className="flex items-center gap-1.5 bg-white border border-zinc-200 hover:bg-zinc-50 text-zinc-700 px-3 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
          >
            <i className="ri-add-circle-line text-zinc-400" /> Novo grupo
          </button>
          <button
            onClick={() => openNew()}
            className="flex items-center gap-1.5 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors shadow-sm"
          >
            <i className="ri-add-line" /> Nova categoria
          </button>
        </div>
      </div>

      {/* ── Busca + filtro por grupo ── */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative w-full sm:w-64">
          <i className="ri-search-line absolute left-3 top-1/2 -translate-y-1/2 text-zinc-400 text-sm" />
          <input
            value={busca}
            onChange={e => setBusca(e.target.value)}
            placeholder="Buscar categoria..."
            className="w-full bg-white border border-zinc-200 rounded-xl pl-9 pr-8 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
          />
          {busca && (
            <button onClick={() => setBusca('')} className="absolute right-2 top-1/2 -translate-y-1/2 w-5 h-5 flex items-center justify-center text-zinc-400 hover:text-zinc-700 cursor-pointer" title="Limpar">
              <i className="ri-close-line text-sm" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[{ key: 'all', label: 'Todos', count: cats.length }, ...allGroupsToShow.map(g => ({ key: g, label: getGroupMeta2(g).label || g, count: totalByGroup[g] ?? 0 }))].map(chip => (
            <button
              key={chip.key}
              onClick={() => setFilterGroup(chip.key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold cursor-pointer transition-colors whitespace-nowrap ${
                filterGroup === chip.key ? 'bg-zinc-900 text-white' : 'bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-50'
              }`}
            >
              {chip.label}
              <span className={`text-[10px] tabular-nums ${filterGroup === chip.key ? 'text-zinc-300' : 'text-zinc-400'}`}>{chip.count}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ── Como o DRE usa os grupos ── */}
      <div className="flex items-start gap-2 text-[11px] text-zinc-500 bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-2.5">
        <i className="ri-information-line text-zinc-400 mt-px" />
        <span>
          <strong className="text-zinc-700">Despesas operacionais</strong> e os <strong className="text-zinc-700">grupos criados por você</strong> são subtraídos do resultado da DRE.
          Contas a pagar e itens de compra podem apontar para qualquer nível; a linha-mãe soma as subcategorias.
          Compra sem classificação vai para o CMV.
        </span>
      </div>

      {/* ── Grupos ── */}
      {loading ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center text-zinc-400 text-sm flex items-center justify-center gap-2">
          <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
          Carregando categorias...
        </div>
      ) : cats.length === 0 && allGroupsToShow.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-12 text-center">
          <i className="ri-folder-chart-line text-4xl text-zinc-300 block mb-3" />
          <p className="text-zinc-500 font-medium">Nenhuma categoria cadastrada</p>
          <p className="text-zinc-400 text-sm mt-1">Crie categorias para estruturar seu DRE</p>
          <button
            onClick={() => openNew()}
            className="mt-4 bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-xl text-sm font-semibold cursor-pointer transition-colors"
          >
            Criar primeira categoria
          </button>
        </div>
      ) : gruposVisiveis.length === 0 ? (
        <div className="bg-white rounded-2xl border border-zinc-200 p-8 text-center">
          <i className="ri-search-line text-3xl text-zinc-300 block mb-2" />
          <p className="text-sm text-zinc-500">Nenhuma categoria encontrada para "{busca}"</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-start">
          {gruposVisiveis.map(({ g, nodes }) => {
            const meta = getGroupMeta2(g);
            const isCustom = customGroups.some(cg => cg.key === g);
            // Grupo padrão que a loja renomeou tem linha própria, e por isso um id.
            const temApelido = !isCustom && !!gruposComLegado.find(x => x.key === g)?.id;
            const papel = papelDoGrupo(g);
            const total = totalByGroup[g] ?? 0;
            return (
              <div key={g} className="bg-white rounded-2xl border border-zinc-200 overflow-hidden">
                <div className="group/head flex items-center gap-3 px-4 py-3 border-b border-zinc-100">
                  <span className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${meta.bg} ${meta.color}`}>
                    <i className={`${meta.icon} text-lg`} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <p className="text-sm font-bold text-zinc-900 truncate">{meta.label || g}</p>
                      {isCustom && <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-50 text-indigo-600 whitespace-nowrap">Personalizado</span>}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-zinc-400">{total} categoria{total !== 1 ? 's' : ''}</span>
                      <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full whitespace-nowrap cursor-help ${papel.cls}`} title={papel.title}>{papel.label}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-0.5 flex-shrink-0">
                    <button
                      onClick={() => novaNoGrupo(g)}
                      className="flex items-center gap-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-50 px-2 py-1.5 rounded-lg cursor-pointer whitespace-nowrap"
                      title="Nova categoria neste grupo"
                    >
                      <i className="ri-add-line" /> Categoria
                    </button>
                    <button
                      onClick={() => handleEditGroup(g)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-zinc-100 text-zinc-400 hover:text-zinc-700 cursor-pointer"
                      title="Renomear grupo"
                    >
                      <i className="ri-edit-line text-xs" />
                    </button>
                    {(isCustom || temApelido) && (
                      <button
                        onClick={() => handleDeleteGroup(g)}
                        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-red-50 text-zinc-400 hover:text-red-500 cursor-pointer"
                        title={isCustom ? 'Remover grupo' : 'Voltar ao nome padrão'}
                      >
                        <i className={`${isCustom ? 'ri-delete-bin-line' : 'ri-arrow-go-back-line'} text-xs`} />
                      </button>
                    )}
                  </div>
                </div>
                {nodes.length > 0 ? (
                  <div className="divide-y divide-zinc-50 py-1">
                    {nodes.map(node => (
                      <CatNode
                        key={node.id}
                        cat={node}
                        depth={0}
                        onEdit={openEdit}
                        onDelete={requestDelete}
                        onAddChild={openNew}
                        forceOpen={!!q}
                      />
                    ))}
                  </div>
                ) : (
                  <button
                    onClick={() => novaNoGrupo(g)}
                    className="w-full px-4 py-6 text-center text-xs text-zinc-400 hover:text-amber-700 hover:bg-amber-50/40 cursor-pointer transition-colors"
                  >
                    <i className="ri-add-circle-line mr-1" /> Nenhuma categoria — adicionar a primeira
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal Novo Grupo */}
      {showGroupModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">{editingGroup ? 'Editar Grupo DRE' : 'Novo Grupo DRE'}</h3>
              <button onClick={() => { setShowGroupModal(false); setEditingGroup(null); }} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-xs font-semibold text-zinc-600 block mb-1">Nome do Grupo *</label>
                <input
                  value={groupForm.label}
                  onChange={e => setGroupForm(f => ({
                    ...f,
                    label: e.target.value,
                    key: editingGroup ?? e.target.value.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, ''),
                  }))}
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
                  disabled={!!editingGroup}
                  className={`w-full border border-zinc-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400 font-mono ${editingGroup ? 'bg-zinc-100 text-zinc-500' : ''}`}
                />
                <p className="text-xs text-zinc-400 mt-1">
                  {editingGroup
                    ? 'É o que as categorias guardam para saber a qual grupo pertencem, por isso não muda. O nome acima pode mudar à vontade.'
                    : 'Usada internamente para identificar o grupo. Não pode ser alterada depois.'}
                </p>
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
                  onClick={() => { setShowGroupModal(false); setEditingGroup(null); }}
                  className="flex-1 py-2.5 border border-zinc-200 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-50 cursor-pointer whitespace-nowrap"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSaveGroup}
                  className="flex-1 py-2.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap"
                >
                  {editingGroup ? 'Salvar' : 'Criar Grupo'}
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

      {/* Confirmação de exclusão (inline — nunca window.confirm) */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
              <h3 className="font-semibold text-zinc-900">Excluir categoria</h3>
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer"
              >
                <i className="ri-close-line text-zinc-500" />
              </button>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-sm text-zinc-700">
                Excluir <strong>{deleteTarget.name}</strong>? Esta exclusão é <strong>definitiva</strong> (não é arquivamento).
              </p>
              {(() => {
                const subCount = cats.filter(c => c.parent_id === deleteTarget.id).length;
                return subCount > 0 ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                    Esta categoria tem <strong>{subCount}</strong> subcategoria(s). Elas também serão afetadas.
                  </div>
                ) : null;
              })()}
              {countingUsage ? (
                <p className="text-xs text-zinc-400">Verificando lançamentos vinculados...</p>
              ) : deleteUsage === null ? null : deleteUsage > 0 ? (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  <strong>{deleteUsage}</strong> lançamento(s) em Contas a Pagar usam esta categoria.
                  Excluí-la afeta o <strong>histórico</strong>: esses lançamentos ficam sem categoria e
                  somem das DREs já fechadas (ou a exclusão será bloqueada pelo banco).
                  O recomendado é reclassificar os lançamentos antes.
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-700">
                  Nenhum lançamento de Contas a Pagar usa esta categoria.
                </div>
              )}
              {deleteError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                  {deleteError}
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 px-6 py-4 border-t border-zinc-100">
              <button
                onClick={() => { setDeleteTarget(null); setDeleteError(null); }}
                className="px-4 py-2 rounded-lg text-sm font-semibold text-zinc-600 hover:bg-zinc-100 cursor-pointer"
              >
                Cancelar
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting || countingUsage}
                className="px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 cursor-pointer"
              >
                {deleting ? 'Excluindo...' : 'Excluir definitivamente'}
              </button>
            </div>
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

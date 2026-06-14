import { useState, useRef, useCallback, useEffect } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/contexts/ToastContext';

type GroupKey = 'stations' | 'categories' | 'ingredients' | 'items' | 'optionGroups' | 'options' | 'presetObservations' | 'globalObservations' | 'promotions' | 'itemIngredients' | 'itemProductionParts' | 'combos' | 'comboItems' | 'comboIngredients' | 'optionGroupTemplates' | 'productionRecipes' | 'productionRecipeItems' | 'productionRecipeSteps' | 'ingredientCategories';

type RenameMap = Record<string, Record<string, string>>;

type DupType = 'categorias' | 'itens' | 'combos' | 'insumos' | 'producoes';

interface GroupConfig {
  key: GroupKey;
  label: string;
  icon: string;
  color: string;
  count: number;
}

interface TemplatePreview {
  name: string;
  count: number;
}

interface ObsPreview {
  text: string;
}

interface PromoPreview {
  itemName: string;
  price: number;
}

interface PresetObsPreview {
  itemName: string;
  text: string;
}

interface FichaPreview {
  itemName: string;
  ingredientName: string;
  quantity: number;
  unit: string;
}

interface ProductionPartPreview {
  itemName: string;
  name: string;
}

interface PreviewData {
  estacoes: number;
  categorias: string[];
  insumos: string[];
  itens: string[];
  combos: string[];
  opcoes: number;
  gruposOpcoes: number;
  observacoesGlobais: number;
  fichasTecnicas: number;
  producoes: string[];
  templates: number;
  tenant_origem: string;
  data_exportacao: string;
  presetObservations: number;
  promotions: number;
  itemProductionParts: number;
  ingredientCategories: number;
  productionRecipeItems: number;
  productionRecipeSteps: number;
  comboItems: number;
  comboIngredients: number;
  templateList: TemplatePreview[];
  globalObsList: ObsPreview[];
  promoList: PromoPreview[];
  presetObsList: PresetObsPreview[];
  fichaList: FichaPreview[];
  partList: ProductionPartPreview[];
}

interface DuplicateMap {
  categorias: string[];
  itens: string[];
  combos: string[];
  insumos: string[];
  producoes: string[];
}

interface Props {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

const ALL_GROUPS: GroupKey[] = [
  'stations',
  'categories',
  'ingredients',
  'items',
  'optionGroups',
  'options',
  'presetObservations',
  'globalObservations',
  'promotions',
  'itemIngredients',
  'itemProductionParts',
  'combos',
  'comboItems',
  'comboIngredients',
  'optionGroupTemplates',
  'productionRecipes',
  'productionRecipeItems',
  'productionRecipeSteps',
  'ingredientCategories',
];

const DUP_TYPES: DupType[] = ['categorias', 'itens', 'combos', 'insumos', 'producoes'];

const TYPE_TO_GROUP: Record<DupType, GroupKey> = {
  categorias: 'categories',
  itens: 'items',
  combos: 'combos',
  insumos: 'ingredients',
  producoes: 'productionRecipes',
};

export default function CardapioExportImportModal({ open, onClose, onSuccess }: Props) {
  const { user } = useAuth();
  const { addToast } = useToast();
  const [activeTab, setActiveTab] = useState<'export' | 'import'>('export');
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [fileContent, setFileContent] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState(false);
  const [exportResult, setExportResult] = useState<Record<string, number> | null>(null);
  const [importErrors, setImportErrors] = useState<Record<string, string> | null>(null);
  const [preview, setPreview] = useState<PreviewData | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [duplicates, setDuplicates] = useState<DuplicateMap | null>(null);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [selectedGroups, setSelectedGroups] = useState<Record<GroupKey, boolean>>(() => {
    const initial: Record<string, boolean> = {};
    ALL_GROUPS.forEach((g) => { initial[g] = true; });
    return initial as Record<GroupKey, boolean>;
  });
  const [skipDuplicates, setSkipDuplicates] = useState(false);
  const [renamedItems, setRenamedItems] = useState<RenameMap>();
  const [editingName, setEditingName] = useState<{ type: DupType; original: string } | null>(null);
  const [editValue, setEditValue] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [rawPayload, setRawPayload] = useState<Record<string, unknown> | null>(null);

  const buildPreview = useCallback((payload: Record<string, unknown>): PreviewData => {
    const stations = (payload.stations as Array<Record<string, unknown>>) ?? [];
    const categories = (payload.categories as Array<Record<string, unknown>>) ?? [];
    const ingredients = (payload.ingredients as Array<Record<string, unknown>>) ?? [];
    const items = (payload.items as Array<Record<string, unknown>>) ?? [];
    const combos = (payload.combos as Array<Record<string, unknown>>) ?? [];
    const optionGroups = (payload.optionGroups as Array<Record<string, unknown>>) ?? [];
    const options = (payload.options as Array<Record<string, unknown>>) ?? [];
    const globalObservations = (payload.globalObservations as Array<Record<string, unknown>>) ?? [];
    const itemIngredients = (payload.itemIngredients as Array<Record<string, unknown>>) ?? [];
    const productionRecipes = (payload.productionRecipes as Array<Record<string, unknown>>) ?? [];
    const optionGroupTemplates = (payload.optionGroupTemplates as Array<Record<string, unknown>>) ?? [];
    const presetObservations = (payload.presetObservations as Array<Record<string, unknown>>) ?? [];
    const promotions = (payload.promotions as Array<Record<string, unknown>>) ?? [];
    const itemProductionParts = (payload.itemProductionParts as Array<Record<string, unknown>>) ?? [];
    const ingredientCategories = (payload.ingredientCategories as Array<Record<string, unknown>>) ?? [];
    const productionRecipeItems = (payload.productionRecipeItems as Array<Record<string, unknown>>) ?? [];
    const productionRecipeSteps = (payload.productionRecipeSteps as Array<Record<string, unknown>>) ?? [];
    const comboItems = (payload.comboItems as Array<Record<string, unknown>>) ?? [];
    const comboIngredients = (payload.comboIngredients as Array<Record<string, unknown>>) ?? [];

    const itemNameMap: Record<string, string> = {};
    items.forEach((i) => { itemNameMap[i.id as string] = (i.name as string) || 'Sem nome'; });

    return {
      estacoes: stations.length,
      categorias: categories.map((c) => (c.name as string) || (c.title as string) || 'Sem nome').filter(Boolean),
      insumos: ingredients.map((i) => (i.name as string) || 'Sem nome').filter(Boolean),
      itens: items.map((i) => (i.name as string) || 'Sem nome').filter(Boolean),
      combos: combos.map((c) => (c.name as string) || (c.title as string) || 'Sem nome').filter(Boolean),
      opcoes: options.length,
      gruposOpcoes: optionGroups.length,
      observacoesGlobais: globalObservations.length,
      fichasTecnicas: itemIngredients.length,
      producoes: productionRecipes.map((r) => (r.name as string) || 'Sem nome').filter(Boolean),
      templates: optionGroupTemplates.length,
      tenant_origem: (payload.tenant_id as string) || 'Desconhecido',
      data_exportacao: (payload.exported_at as string) || (payload.created_at as string) || 'Desconhecida',
      presetObservations: presetObservations.length,
      promotions: promotions.length,
      itemProductionParts: itemProductionParts.length,
      ingredientCategories: ingredientCategories.length,
      productionRecipeItems: productionRecipeItems.length,
      productionRecipeSteps: productionRecipeSteps.length,
      comboItems: comboItems.length,
      comboIngredients: comboIngredients.length,
      templateList: optionGroupTemplates.map((t) => ({
        name: (t.name as string) || 'Sem nome',
        count: ((t.template_data as Array<unknown>)?.length ?? 0),
      })),
      globalObsList: globalObservations.map((o) => ({ text: (o.text as string) || 'Sem texto' })),
      promoList: promotions.map((p) => ({
        itemName: itemNameMap[p.item_id as string] || 'Item desconhecido',
        price: (p.promotional_price as number) ?? 0,
      })),
      presetObsList: presetObservations.map((o) => ({
        itemName: itemNameMap[o.item_id as string] || 'Item desconhecido',
        text: (o.text as string) || 'Sem texto',
      })),
      fichaList: itemIngredients.map((f) => ({
        itemName: itemNameMap[f.item_id as string] || 'Item desconhecido',
        ingredientName: (f.ingredient_name as string) || (ingredients.find((i) => i.id === f.ingredient_id)?.name as string) || 'Insumo desconhecido',
        quantity: (f.quantity as number) ?? 0,
        unit: (f.unit as string) || 'unit',
      })),
      partList: itemProductionParts.map((p) => ({
        itemName: itemNameMap[p.item_id as string] || 'Item desconhecido',
        name: (p.name as string) || 'Parte',
      })),
    };
  }, []);

  const getGroupConfigs = useCallback((p: PreviewData): GroupConfig[] => [
    { key: 'stations', label: 'Estações de cozinha', icon: 'ri-fire-line', color: 'text-orange-600', count: p.estacoes },
    { key: 'categories', label: 'Categorias', icon: 'ri-folder-line', color: 'text-amber-600', count: p.categorias.length },
    { key: 'ingredients', label: 'Insumos', icon: 'ri-archive-line', color: 'text-blue-600', count: p.insumos.length },
    { key: 'items', label: 'Itens do cardápio', icon: 'ri-restaurant-line', color: 'text-green-600', count: p.itens.length },
    { key: 'combos', label: 'Combos', icon: 'ri-stack-line', color: 'text-purple-600', count: p.combos.length },
    { key: 'productionRecipes', label: 'Produções', icon: 'ri-flask-line', color: 'text-red-500', count: p.producoes.length },
    { key: 'optionGroups', label: 'Grupos de opções', icon: 'ri-list-check', color: 'text-cyan-600', count: p.gruposOpcoes },
    { key: 'options', label: 'Opções', icon: 'ri-checkbox-circle-line', color: 'text-cyan-500', count: p.opcoes },
    { key: 'itemIngredients', label: 'Fichas técnicas', icon: 'ri-file-list-line', color: 'text-blue-500', count: p.fichasTecnicas },
    { key: 'presetObservations', label: 'Obs. pré-cadastradas', icon: 'ri-chat-1-line', color: 'text-zinc-500', count: p.presetObservations },
    { key: 'globalObservations', label: 'Obs. globais', icon: 'ri-earth-line', color: 'text-zinc-500', count: p.observacoesGlobais },
    { key: 'promotions', label: 'Promoções', icon: 'ri-percent-line', color: 'text-pink-500', count: p.promotions },
    { key: 'itemProductionParts', label: 'Partes de produção', icon: 'ri-puzzle-line', color: 'text-orange-500', count: p.itemProductionParts },
    { key: 'comboItems', label: 'Itens dos combos', icon: 'ri-stack-line', color: 'text-purple-400', count: p.comboItems },
    { key: 'comboIngredients', label: 'Ingredientes dos combos', icon: 'ri-flask-line', color: 'text-purple-400', count: p.comboIngredients },
    { key: 'optionGroupTemplates', label: 'Templates de opções', icon: 'ri-file-copy-line', color: 'text-teal-500', count: p.templates },
    { key: 'productionRecipeItems', label: 'Itens das produções', icon: 'ri-flask-line', color: 'text-red-400', count: p.productionRecipeItems },
    { key: 'productionRecipeSteps', label: 'Passos das produções', icon: 'ri-list-ordered', color: 'text-red-400', count: p.productionRecipeSteps },
    { key: 'ingredientCategories', label: 'Categorias de insumos', icon: 'ri-folders-line', color: 'text-blue-400', count: p.ingredientCategories },
  ], []);

  const toggleGroup = (key: GroupKey) => {
    setSelectedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const selectAll = () => {
    const all: Record<string, boolean> = {};
    ALL_GROUPS.forEach((g) => { all[g] = true; });
    setSelectedGroups(all as Record<GroupKey, boolean>);
  };

  const selectNone = () => {
    const none: Record<string, boolean> = {};
    ALL_GROUPS.forEach((g) => { none[g] = false; });
    setSelectedGroups(none as Record<GroupKey, boolean>);
  };

  const selectedCount = preview ? getGroupConfigs(preview).filter((g) => selectedGroups[g.key]).reduce((sum, g) => sum + g.count, 0) : 0;
  const totalCount = preview ? getGroupConfigs(preview).reduce((sum, g) => sum + g.count, 0) : 0;

  const dupCount = duplicates
    ? DUP_TYPES.reduce((sum, t) => sum + duplicates[t].length, 0)
    : 0;

  const checkDuplicates = useCallback(async (previewData: PreviewData) => {
    if (!user?.tenantId) return;
    setCheckingDuplicates(true);
    try {
      const [catsRes, itemsRes, combosRes, ingRes, prodRes] = await Promise.all([
        supabase.from('menu_categories').select('name').eq('tenant_id', user.tenantId),
        supabase.from('menu_items').select('name').eq('tenant_id', user.tenantId),
        supabase.from('combos').select('name').eq('tenant_id', user.tenantId),
        supabase.from('ingredients').select('name').eq('tenant_id', user.tenantId),
        supabase.from('production_recipes').select('name').eq('tenant_id', user.tenantId),
      ]);

      const existing = {
        categorias: (catsRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []),
        itens: (itemsRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []),
        combos: (combosRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []),
        insumos: (ingRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []),
        producoes: (prodRes.data?.map((r) => (r.name as string).toLowerCase().trim()) ?? []),
      };

      const d: DuplicateMap = {
        categorias: previewData.categorias.filter((n) => existing.categorias.includes(n.toLowerCase().trim())),
        itens: previewData.itens.filter((n) => existing.itens.includes(n.toLowerCase().trim())),
        combos: previewData.combos.filter((n) => existing.combos.includes(n.toLowerCase().trim())),
        insumos: previewData.insumos.filter((n) => existing.insumos.includes(n.toLowerCase().trim())),
        producoes: previewData.producoes.filter((n) => existing.producoes.includes(n.toLowerCase().trim())),
      };
      setDuplicates(d);
    } catch (err) {
      console.error('Erro ao verificar duplicados:', err);
    } finally {
      setCheckingDuplicates(false);
    }
  }, [user?.tenantId]);

  useEffect(() => {
    if (preview && showPreview) {
      checkDuplicates(preview);
    }
  }, [preview, showPreview, checkDuplicates]);

  const handleExport = useCallback(async () => {
    if (!user?.tenantId) return;
    setExporting(true);
    setExportResult(null);
    try {
      const { data, error } = await invokeWithAuth<{ success: boolean; data: Record<string, unknown> }>('export-menu-template', {
        body: { tenant_id: user.tenantId },
      });
      if (error) throw new Error(error.message ?? 'Erro ao exportar');
      if (!data?.success || !data.data) throw new Error('Resposta inválida do servidor');

      const payload = data.data;
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cardapio_estoque_${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);

      const counts: Record<string, number> = {
        estacoes: (payload.stations as Array<unknown>)?.length ?? 0,
        categorias: (payload.categories as Array<unknown>)?.length ?? 0,
        insumos: (payload.ingredients as Array<unknown>)?.length ?? 0,
        itens: (payload.items as Array<unknown>)?.length ?? 0,
        combos: (payload.combos as Array<unknown>)?.length ?? 0,
        gruposOpcoes: (payload.optionGroups as Array<unknown>)?.length ?? 0,
        opcoes: (payload.options as Array<unknown>)?.length ?? 0,
        observacoesGlobais: (payload.globalObservations as Array<unknown>)?.length ?? 0,
        fichasTecnicas: (payload.itemIngredients as Array<unknown>)?.length ?? 0,
        producoes: (payload.productionRecipes as Array<unknown>)?.length ?? 0,
        templates: (payload.optionGroupTemplates as Array<unknown>)?.length ?? 0,
      };
      setExportResult(counts);
      addToast({ type: 'success', message: 'Cardápio exportado com sucesso! Verifique o download do arquivo.' });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast({ type: 'error', message: `Erro ao exportar: ${msg}` });
    } finally {
      setExporting(false);
    }
  }, [user?.tenantId, addToast]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportError(null);
    setImportSuccess(false);
    setPreview(null);
    setShowPreview(false);
    setDuplicates(null);
    setRawPayload(null);
    setSkipDuplicates(false);
    setRenamedItems({});
    setEditingName(null);
    const all: Record<string, boolean> = {};
    ALL_GROUPS.forEach((g) => { all[g] = true; });
    setSelectedGroups(all as Record<GroupKey, boolean>);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setFileContent(text);
      try {
        const payload = JSON.parse(text) as Record<string, unknown>;
        if (!payload.version || !payload.tenant_id) {
          setImportError('Arquivo JSON inválido. Use um arquivo exportado pelo sistema.');
          return;
        }
        setRawPayload(payload);
        const p = buildPreview(payload);
        setPreview(p);
        setShowPreview(true);
      } catch {
        setImportError('Arquivo JSON inválido. Use um arquivo exportado pelo sistema.');
      }
    };
    reader.readAsText(file);
  };

  const startRename = (type: DupType, original: string) => {
    setEditingName({ type, original });
    setEditValue(renamedItems[type]?.[original] || original);
  };

  const saveRename = () => {
    if (!editingName || !editValue.trim() || editValue.trim() === editingName.original) {
      setEditingName(null);
      return;
    }
    setRenamedItems((prev) => ({
      ...prev,
      [editingName.type]: {
        ...prev[editingName.type],
        [editingName.original]: editValue.trim(),
      },
    }));
    setEditingName(null);
  };

  const cancelRename = () => {
    setEditingName(null);
    setEditValue('');
  };

  const getDisplayName = (type: DupType, name: string) => {
    return renamedItems[type]?.[name] || name;
  };

  const handleImport = async () => {
    if (!fileContent || !user?.tenantId || !rawPayload) return;
    setImporting(true);
    setImportError(null);
    setImportSuccess(false);

    try {
      const payload = JSON.parse(fileContent) as Record<string, unknown>;
      if (!payload.version || !payload.tenant_id) {
        throw new Error('Arquivo JSON inválido. Use um arquivo exportado pelo sistema.');
      }

      const include = ALL_GROUPS.filter((g) => selectedGroups[g]);

      const { data, error } = await invokeWithAuth<{ success: boolean; results: Record<string, number>; errors?: Record<string, string>; warnings?: string[] }>('import-menu-template', {
        body: {
          tenant_id: user.tenantId,
          data: payload,
          include,
          skipDuplicates,
          renamedItems,
        },
      });

      if (error) throw new Error(error.message ?? 'Erro ao importar');
      if (!data?.success) throw new Error('Falha na importação');

      if (data.errors && Object.keys(data.errors).length > 0) {
        setImportErrors(data.errors);
        throw new Error('Alguns itens não foram importados. Veja os detalhes abaixo.');
      }

      // Show warnings if items were skipped
      if (data.warnings && data.warnings.length > 0) {
        setImportError(data.warnings.join('\n'));
      }

      setImportSuccess(true);
      setImportErrors(null);
      setFileContent(null);
      // Keep fileName so warnings can be shown
      // setFileName(null);
      // Keep preview for results display
      // setPreview(null);
      setShowPreview(false);
      setDuplicates(null);
      setRawPayload(null);
      setRenamedItems({});
      setSkipDuplicates(false);
      setExportResult(data.results ?? null);
      addToast({ type: 'success', message: 'Cardápio importado com sucesso! Recarregue a página para ver os dados.' });
      onSuccess?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setImportError(msg);
      addToast({ type: 'error', message: `Erro ao importar: ${msg}` });
    } finally {
      setImporting(false);
    }
  };

  const clearFile = () => {
    setFileName(null);
    setFileContent(null);
    setImportError(null);
    setPreview(null);
    setShowPreview(false);
    setDuplicates(null);
    setRawPayload(null);
    setRenamedItems({});
    setSkipDuplicates(false);
    setEditingName(null);
    const all: Record<string, boolean> = {};
    ALL_GROUPS.forEach((g) => { all[g] = true; });
    setSelectedGroups(all as Record<GroupKey, boolean>);
    if (fileRef.current) fileRef.current.value = '';
  };

  const renderNameList = (type: DupType, names: string[], groupKey: GroupKey) => {
    if (!names.length || !selectedGroups[groupKey]) return null;
    const titleMap: Record<DupType, string> = {
      categorias: 'Categorias',
      itens: 'Itens do cardápio',
      combos: 'Combos',
      insumos: 'Insumos',
      producoes: 'Produções',
    };
    const iconMap: Record<DupType, string> = {
      categorias: 'ri-folder-line',
      itens: 'ri-restaurant-line',
      combos: 'ri-stack-line',
      insumos: 'ri-archive-line',
      producoes: 'ri-flask-line',
    };

    return (
      <div>
        <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">{titleMap[type]}</p>
        <div className={names.length > 8 ? 'max-h-32 overflow-y-auto border border-zinc-200 rounded-lg bg-white' : 'flex flex-wrap gap-1'}>
          {names.map((name, i) => {
            const isDup = duplicates?.[type].includes(name);
            const displayName = getDisplayName(type, name);
            const isEditing = editingName?.type === type && editingName?.original === name;

            if (names.length > 8) {
              return (
                <div
                  key={i}
                  className={`px-2 py-1.5 text-[10px] border-b border-zinc-100 last:border-0 flex items-center gap-1.5 ${isDup ? 'bg-red-50/50 text-red-700' : 'text-zinc-600'}`}
                >
                  <i className={`${iconMap[type]} text-[10px] ${isDup ? 'text-red-300' : 'text-zinc-300'}`} />
                  {isEditing ? (
                    <div className="flex items-center gap-1 flex-1">
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') saveRename();
                          if (e.key === 'Escape') cancelRename();
                        }}
                        className="flex-1 min-w-0 text-[10px] px-1.5 py-0.5 border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
                        autoFocus
                      />
                      <button onClick={saveRename} className="text-green-600 hover:text-green-700 cursor-pointer">
                        <i className="ri-check-line text-xs" />
                      </button>
                      <button onClick={cancelRename} className="text-red-400 hover:text-red-600 cursor-pointer">
                        <i className="ri-close-line text-xs" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <span className={displayName !== name ? 'text-amber-700 font-semibold' : ''}>{displayName}</span>
                      {isDup && (
                        <>
                          <span className="ml-auto text-[9px] bg-red-100 text-red-600 px-1.5 py-0 rounded-full font-bold">JÁ EXISTE</span>
                          <button
                            onClick={() => startRename(type, name)}
                            className="text-amber-500 hover:text-amber-600 cursor-pointer ml-1"
                            title="Renomear"
                          >
                            <i className="ri-edit-line text-xs" />
                          </button>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            }

            return (
              <span
                key={i}
                className={`text-[10px] px-2 py-0.5 rounded-md border whitespace-nowrap inline-flex items-center gap-1 ${
                  isDup ? 'bg-red-50 text-red-700 border-red-200' : 'bg-zinc-50 text-zinc-600 border-zinc-200'
                }`}
              >
                {isEditing ? (
                  <div className="flex items-center gap-1">
                    <input
                      type="text"
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') saveRename();
                        if (e.key === 'Escape') cancelRename();
                      }}
                      className="w-24 text-[10px] px-1 py-0.5 border border-amber-300 rounded focus:outline-none focus:ring-1 focus:ring-amber-400"
                      autoFocus
                    />
                    <button onClick={saveRename} className="text-green-600 hover:text-green-700 cursor-pointer">
                      <i className="ri-check-line text-xs" />
                    </button>
                    <button onClick={cancelRename} className="text-red-400 hover:text-red-600 cursor-pointer">
                      <i className="ri-close-line text-xs" />
                    </button>
                  </div>
                ) : (
                  <>
                    <span className={displayName !== name ? 'text-amber-700 font-semibold' : ''}>{displayName}</span>
                    {isDup && (
                      <>
                        <i className="ri-error-warning-line text-red-500" />
                        <button
                          onClick={() => startRename(type, name)}
                          className="text-amber-500 hover:text-amber-600 cursor-pointer"
                          title="Renomear"
                        >
                          <i className="ri-edit-line text-xs" />
                        </button>
                      </>
                    )}
                  </>
                )}
              </span>
            );
          })}
        </div>
      </div>
    );
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-100">
          <h3 className="font-semibold text-zinc-900 text-sm">Exportar / Importar Cardápio & Estoque</h3>
          <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-zinc-100 cursor-pointer">
            <i className="ri-close-line text-zinc-500" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Tabs */}
          <div className="flex bg-zinc-100 rounded-lg p-1">
            <button
              onClick={() => {
                setActiveTab('export');
                setImportError(null);
                setImportSuccess(false);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'export' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Exportar
            </button>
            <button
              onClick={() => {
                setActiveTab('import');
                setExportResult(null);
              }}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-md cursor-pointer transition-colors whitespace-nowrap ${
                activeTab === 'import' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Importar
            </button>
          </div>

          {/* ── Exportar ── */}
          {activeTab === 'export' && (
            <div className="space-y-4">
              <div className="border border-zinc-200 rounded-xl p-4 bg-zinc-50/50">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-amber-100 rounded-xl">
                    <i className="ri-upload-line text-amber-600 text-lg" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-700">Exportar cardápio completo</p>
                    <p className="text-[10px] text-zinc-400">Gera um arquivo JSON com categorias, itens, combos, insumos, produção e templates.</p>
                  </div>
                </div>
                <button
                  onClick={handleExport}
                  disabled={exporting}
                  className="w-full py-2.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
                >
                  {exporting ? (
                    <><i className="ri-loader-4-line animate-spin" /> Exportando...</>
                  ) : (
                    <><i className="ri-download-line" /> Baixar JSON</>
                  )}
                </button>
              </div>

              {exportResult && (
                <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                  <p className="text-xs font-bold text-green-700 mb-2">Exportação concluída!</p>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(exportResult)
                      .filter(([, value]) => (value as number) > 0)
                      .map(([key, value]) => (
                        <div key={key} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-green-100">
                          <span className="text-[10px] text-zinc-500 capitalize">{key}</span>
                          <span className="text-xs font-bold text-green-700">{value as number}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Importar ── */}
          {activeTab === 'import' && (
            <div className="space-y-4">
              <div className="border border-zinc-200 rounded-xl p-4">
                <div className="flex items-center gap-3 mb-3">
                  <div className="w-10 h-10 flex items-center justify-center bg-green-100 rounded-xl">
                    <i className="ri-download-line text-green-600 text-lg" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-zinc-700">Importar em outra loja</p>
                    <p className="text-[10px] text-zinc-400">Selecione o arquivo JSON exportado de outra loja para importar todos os dados.</p>
                  </div>
                </div>

                <input
                  type="file"
                  ref={fileRef}
                  accept=".json,application/json"
                  onChange={handleFileSelect}
                  className="hidden"
                />

                {!fileName ? (
                  <button
                    onClick={() => fileRef.current?.click()}
                    className="w-full py-3 border-2 border-dashed border-zinc-300 rounded-xl text-xs text-zinc-500 hover:border-amber-400 hover:text-amber-600 transition-colors cursor-pointer flex items-center justify-center gap-2"
                  >
                    <i className="ri-file-upload-line text-sm" /> Clique para selecionar arquivo JSON
                  </button>
                ) : (
                  <div className="flex items-center gap-2 bg-zinc-50 border border-zinc-200 rounded-xl px-3 py-2">
                    <i className="ri-file-text-line text-zinc-400 text-sm" />
                    <span className="text-xs text-zinc-700 flex-1 truncate">{fileName}</span>
                    <button
                      onClick={clearFile}
                      className="w-6 h-6 flex items-center justify-center text-zinc-400 hover:text-red-500 cursor-pointer"
                    >
                      <i className="ri-close-line text-xs" />
                    </button>
                  </div>
                )}

                {/* PREVIEW */}
                {showPreview && preview && (
                  <div className="mt-4 space-y-3">
                    <div className="bg-zinc-50 border border-zinc-200 rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <p className="text-xs font-bold text-zinc-700">Preview do conteúdo</p>
                        <span className="text-[10px] text-zinc-400 bg-white px-2 py-0.5 rounded-full border border-zinc-200">
                          {preview.tenant_origem.slice(0, 8)}... • {preview.data_exportacao.slice(0, 10)}
                        </span>
                      </div>

                      {/* Alerta de duplicados */}
                      {duplicates && (
                        <div className="mb-3">
                          {dupCount > 0 ? (
                            <div className="bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex items-start gap-2">
                              <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0 text-sm" />
                              <div className="flex-1">
                                <p className="text-[10px] font-bold text-red-700">Atenção: {dupCount} itens já existentes na loja</p>
                                <p className="text-[10px] text-red-600 mt-0.5">
                                  {duplicates.categorias.length > 0 && `${duplicates.categorias.length} categorias, `}
                                  {duplicates.itens.length > 0 && `${duplicates.itens.length} itens, `}
                                  {duplicates.combos.length > 0 && `${duplicates.combos.length} combos, `}
                                  {duplicates.insumos.length > 0 && `${duplicates.insumos.length} insumos, `}
                                  {duplicates.producoes.length > 0 && `${duplicates.producoes.length} produções`}
                                  já existem com o mesmo nome.
                                </p>
                                {/* Toggle pular duplicados */}
                                <label className="flex items-center gap-2 mt-2 cursor-pointer">
                                  <input
                                    type="checkbox"
                                    checked={skipDuplicates}
                                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                                    className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                                  />
                                  <span className="text-[10px] font-semibold text-amber-700">Pular itens duplicados (não importar os que já existem)</span>
                                </label>
                                <p className="text-[9px] text-zinc-500 mt-1">
                                  Ou clique no ícone <i className="ri-edit-line text-amber-500" /> ao lado dos itens marcados para renomeá-los antes de importar.
                                </p>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-start gap-2">
                              <i className="ri-checkbox-circle-line text-green-500 mt-0.5 flex-shrink-0 text-sm" />
                              <p className="text-[10px] text-green-700 font-semibold">Nenhum item duplicado encontrado na loja atual. Pode importar com segurança!</p>
                            </div>
                          )}
                        </div>
                      )}
                      {checkingDuplicates && (
                        <div className="mb-3 flex items-center gap-2 text-[10px] text-zinc-400">
                          <i className="ri-loader-4-line animate-spin" />
                          Verificando duplicados na loja atual...
                        </div>
                      )}

                      {/* Seleção de grupos */}
                      <div className="mb-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide">Selecionar grupos para importar</p>
                          <div className="flex gap-1">
                            <button onClick={selectAll} className="text-[10px] text-amber-600 hover:text-amber-700 font-semibold cursor-pointer px-2 py-0.5 rounded hover:bg-amber-50 transition-colors">
                              Todos
                            </button>
                            <span className="text-[10px] text-zinc-300">|</span>
                            <button onClick={selectNone} className="text-[10px] text-zinc-400 hover:text-zinc-600 font-semibold cursor-pointer px-2 py-0.5 rounded hover:bg-zinc-50 transition-colors">
                              Nenhum
                            </button>
                          </div>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {getGroupConfigs(preview).map((g) => (
                            <label
                              key={g.key}
                              className={`flex items-center gap-2 px-2 py-1.5 rounded-lg border cursor-pointer transition-colors ${
                                selectedGroups[g.key]
                                  ? 'bg-white border-zinc-200'
                                  : 'bg-zinc-50 border-zinc-100 opacity-60'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={selectedGroups[g.key]}
                                onChange={() => toggleGroup(g.key)}
                                className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
                              />
                              <div className={`w-5 h-5 flex items-center justify-center ${g.color}`}>
                                <i className={`${g.icon} text-xs`} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] font-semibold text-zinc-700 truncate">{g.label}</p>
                                <p className="text-[9px] text-zinc-400">{g.count} itens</p>
                              </div>
                            </label>
                          ))}
                        </div>
                        <p className="text-[9px] text-zinc-400 mt-1.5 text-right">
                          {selectedCount} de {totalCount} itens selecionados
                        </p>
                      </div>

                      {/* Listas detalhadas */}
                      <div className="space-y-3">
                        {renderNameList('categorias', preview.categorias, 'categories')}
                        {renderNameList('itens', preview.itens, 'items')}
                        {renderNameList('combos', preview.combos, 'combos')}
                        {renderNameList('producoes', preview.producoes, 'productionRecipes')}
                        {renderNameList('insumos', preview.insumos, 'ingredients')}

                        {/* Templates */}
                        {preview.templateList.length > 0 && selectedGroups.optionGroupTemplates && (
                          <div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Templates de opções</p>
                            <div className="flex flex-wrap gap-1">
                              {preview.templateList.map((t, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md border bg-teal-50 text-teal-700 border-teal-100 whitespace-nowrap">
                                  {t.name} <span className="text-teal-400">({t.count} opções)</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Observações globais */}
                        {preview.globalObsList.length > 0 && selectedGroups.globalObservations && (
                          <div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Observações globais</p>
                            <div className="max-h-32 overflow-y-auto border border-zinc-200 rounded-lg bg-white">
                              {preview.globalObsList.map((o, i) => (
                                <div key={i} className="px-2 py-1.5 text-[10px] border-b border-zinc-100 last:border-0 text-zinc-600 flex items-center gap-1.5">
                                  <i className="ri-earth-line text-[10px] text-zinc-300" />
                                  {o.text}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Observações pré-cadastradas */}
                        {preview.presetObsList.length > 0 && selectedGroups.presetObservations && (
                          <div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Observações pré-cadastradas</p>
                            <div className="max-h-32 overflow-y-auto border border-zinc-200 rounded-lg bg-white">
                              {preview.presetObsList.map((o, i) => (
                                <div key={i} className="px-2 py-1.5 text-[10px] border-b border-zinc-100 last:border-0 text-zinc-600 flex items-center gap-1.5">
                                  <i className="ri-chat-1-line text-[10px] text-zinc-300" />
                                  <span className="text-zinc-400">{o.itemName}:</span>
                                  {o.text}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Promoções */}
                        {preview.promoList.length > 0 && selectedGroups.promotions && (
                          <div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Promoções</p>
                            <div className="flex flex-wrap gap-1">
                              {preview.promoList.map((p, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md border bg-pink-50 text-pink-700 border-pink-100 whitespace-nowrap">
                                  {p.itemName} <span className="text-pink-400">R$ {p.price.toFixed(2)}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Fichas técnicas */}
                        {preview.fichaList.length > 0 && selectedGroups.itemIngredients && (
                          <div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Fichas técnicas</p>
                            <div className="max-h-32 overflow-y-auto border border-zinc-200 rounded-lg bg-white">
                              {preview.fichaList.map((f, i) => (
                                <div key={i} className="px-2 py-1.5 text-[10px] border-b border-zinc-100 last:border-0 text-zinc-600 flex items-center gap-1.5">
                                  <i className="ri-file-list-line text-[10px] text-blue-300" />
                                  <span className="font-semibold text-zinc-700">{f.itemName}</span>
                                  <span className="text-zinc-400">→</span>
                                  {f.ingredientName} <span className="text-zinc-400">({f.quantity} {f.unit})</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Partes de produção */}
                        {preview.partList.length > 0 && selectedGroups.itemProductionParts && (
                          <div>
                            <p className="text-[10px] font-bold text-zinc-500 uppercase tracking-wide mb-1">Partes de produção</p>
                            <div className="flex flex-wrap gap-1">
                              {preview.partList.map((p, i) => (
                                <span key={i} className="text-[10px] px-2 py-0.5 rounded-md border bg-orange-50 text-orange-700 border-orange-100 whitespace-nowrap">
                                  {p.itemName} <span className="text-orange-400">→ {p.name}</span>
                                </span>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Extras compactos */}
                        {(preview.observacoesGlobais > 0 && !selectedGroups.globalObservations) || (preview.templates > 0 && !selectedGroups.optionGroupTemplates) || (preview.opcoes > 0 && !selectedGroups.options) || (preview.gruposOpcoes > 0 && !selectedGroups.optionGroups) ? (
                          <div className="flex flex-wrap gap-2 pt-1">
                            {preview.gruposOpcoes > 0 && !selectedGroups.optionGroups && (
                              <span className="text-[10px] bg-zinc-50 text-zinc-500 px-2 py-0.5 rounded-md border border-zinc-200">
                                {preview.gruposOpcoes} grupos de opções (não selecionado)
                              </span>
                            )}
                            {preview.opcoes > 0 && !selectedGroups.options && (
                              <span className="text-[10px] bg-zinc-50 text-zinc-500 px-2 py-0.5 rounded-md border border-zinc-200">
                                {preview.opcoes} opções (não selecionado)
                              </span>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </div>

                    {/* Confirmar importação */}
                    <div className="flex items-center gap-2">
                      <button
                        onClick={clearFile}
                        className="flex-1 py-2.5 border border-zinc-300 text-zinc-600 rounded-lg text-xs font-semibold cursor-pointer hover:bg-zinc-50 transition-colors whitespace-nowrap"
                      >
                        Cancelar
                      </button>
                      <button
                        onClick={handleImport}
                        disabled={importing || selectedCount === 0}
                        className="flex-[2] py-2.5 bg-green-500 hover:bg-green-600 disabled:opacity-40 text-white rounded-lg text-sm font-semibold cursor-pointer transition-colors whitespace-nowrap flex items-center justify-center gap-2"
                      >
                        {importing ? (
                          <><i className="ri-loader-4-line animate-spin" /> Importando...</>
                        ) : (
                          <><i className="ri-import-line" /> Importar {selectedCount} itens</>
                        )}
                      </button>
                    </div>
                  </div>
                )}

                {!showPreview && importError && (
                  <div className={`mt-3 rounded-lg px-3 py-2 flex items-start gap-2 whitespace-pre-line ${importSuccess ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
                    <i className={`${importSuccess ? 'ri-alert-line text-amber-500' : 'ri-error-warning-line text-red-500'} mt-0.5 flex-shrink-0`} />
                    <p className={`text-xs ${importSuccess ? 'text-amber-700' : 'text-red-700'}`}>{importError}</p>
                  </div>
                )}

                {importErrors && !importSuccess && (
                  <div className="mt-3 bg-red-50 border border-red-200 rounded-lg px-3 py-2 space-y-1.5">
                    <div className="flex items-start gap-2">
                      <i className="ri-error-warning-line text-red-500 mt-0.5 flex-shrink-0" />
                      <p className="text-xs text-red-700 font-semibold">Erros na importação:</p>
                    </div>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {Object.entries(importErrors).map(([key, msg]) => (
                        <div key={key} className="bg-white border border-red-100 rounded px-2 py-1 flex items-start gap-2">
                          <span className="text-[10px] font-bold text-red-600 whitespace-nowrap">{key}:</span>
                          <span className="text-[10px] text-red-500 break-all">{msg}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {importSuccess && (
                  <div className="mt-3 space-y-3">
                    <div className="bg-green-50 border border-green-200 rounded-lg px-3 py-2 flex items-start gap-2">
                      <i className="ri-checkbox-circle-line text-green-500 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs text-green-700 font-semibold">Importação concluída com sucesso!</p>
                        <p className="text-[10px] text-green-600 mt-0.5">Recarregue a página para ver os dados importados.</p>
                      </div>
                    </div>
                    {exportResult && (
                      <div className="bg-green-50 border border-green-200 rounded-xl p-4">
                        <p className="text-xs font-bold text-green-700 mb-2">Resumo da importação</p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {preview ? getGroupConfigs(preview).filter((g) => (exportResult[g.key] ?? 0) > 0 || selectedGroups[g.key]).map((g) => {
                            const imported = (exportResult[g.key] ?? 0) as number;
                            return (
                              <div key={g.key} className={`flex items-center justify-between bg-white rounded-lg px-3 py-2 border ${imported > 0 ? 'border-green-100' : 'border-amber-100 bg-amber-50/30'}`}>
                                <div className="flex items-center gap-1.5 min-w-0">
                                  <div className={`w-4 h-4 flex items-center justify-center flex-shrink-0 ${g.color}`}>
                                    <i className={`${g.icon} text-[10px]`} />
                                  </div>
                                  <span className="text-[10px] text-zinc-600 truncate">{g.label}</span>
                                </div>
                                <span className={`text-xs font-bold ml-1 flex-shrink-0 ${imported > 0 ? 'text-green-700' : 'text-amber-600'}`}>
                                  {imported > 0 ? imported : '0'}
                                </span>
                              </div>
                            );
                          }) : Object.entries(exportResult).filter(([, v]) => (v as number) > 0).map(([key, value]) => (
                            <div key={key} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 border border-green-100">
                              <span className="text-[10px] text-zinc-600 capitalize">{key}</span>
                              <span className="text-xs font-bold text-green-700">{value as number}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Aviso */}
              <div className="flex items-start gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <div className="w-4 h-4 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <i className="ri-alert-line text-amber-500 text-sm" />
                </div>
                <p className="text-[10px] text-amber-700 leading-relaxed">
                  <strong>Atenção:</strong> A importação cria novos registros na loja atual. IDs são regenerados automaticamente. Dados existentes não são sobrescritos. Verifique se está na loja correta antes de importar.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
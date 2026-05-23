import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase, invokeWithAuth, ensureFreshSession } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import type { ProductionRecipe, ProductionBatch, ProductionRecipeItem, ProductionRecipeStep } from '@/types/estoque';

const LS_RECIPES_KEY = 'erpos_producao_recipes';
const LS_BATCHES_KEY = 'erpos_producao_batches';

/* ─── Offline cache helpers ───────────────────────────────────────────────── */

function loadRecipesFromLS(): ProductionRecipe[] | null {
  try {
    const raw = localStorage.getItem(LS_RECIPES_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProductionRecipe[];
  } catch {
    return null;
  }
}

function saveRecipesToLS(recipes: ProductionRecipe[]) {
  try {
    localStorage.setItem(LS_RECIPES_KEY, JSON.stringify(recipes));
  } catch {
    /* ignore quota exceeded */
  }
}

function loadBatchesFromLS(): ProductionBatch[] | null {
  try {
    const raw = localStorage.getItem(LS_BATCHES_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ProductionBatch[];
  } catch {
    return null;
  }
}

function saveBatchesToLS(batches: ProductionBatch[]) {
  try {
    localStorage.setItem(LS_BATCHES_KEY, JSON.stringify(batches));
  } catch {
    /* ignore quota exceeded */
  }
}

/* ─── DB → Frontend mappers (snake_case → camelCase) ──────────────────────── */

function dbItemToFrontend(db: Record<string, unknown>): ProductionRecipeItem {
  return {
    id: String(db.id ?? ''),
    ingredientId: String(db.ingredient_id ?? db.ingredientId ?? ''),
    ingredientName: String(db.ingredient_name ?? db.ingredientName ?? ''),
    quantity: Number(db.quantity ?? 0),
    unit: String(db.unit ?? 'kg'),
    unitCost: Number(db.unit_cost ?? db.unitCost ?? 0),
  };
}

function dbStepToFrontend(db: Record<string, unknown>): ProductionRecipeStep {
  return {
    id: String(db.id ?? ''),
    text: String(db.text ?? ''),
  };
}

function dbRecipeToFrontend(db: Record<string, unknown>): ProductionRecipe {
  const items = ((db.items as Record<string, unknown>[]) ?? (db.production_recipe_items as Record<string, unknown>[]) ?? [])
    .map(dbItemToFrontend);
  const steps = ((db.steps as Record<string, unknown>[]) ?? (db.production_recipe_steps as Record<string, unknown>[]) ?? [])
    .map(dbStepToFrontend)
    .sort((a, b) => {
      const orderA = ((db.steps as Record<string, unknown>[]) ?? []).find((s) => s.id === a.id)?.step_order ?? 0;
      const orderB = ((db.steps as Record<string, unknown>[]) ?? []).find((s) => s.id === b.id)?.step_order ?? 0;
      return Number(orderA) - Number(orderB);
    });

  return {
    id: String(db.id ?? ''),
    tenantId: String(db.tenant_id ?? db.tenantId ?? ''),
    name: String(db.name ?? ''),
    unit: String(db.unit ?? 'kg') as ProductionRecipe['unit'],
    instructions: String(db.instructions ?? ''),
    steps,
    items,
    isActive: Boolean(db.is_active ?? db.isActive ?? true),
    createdAt: String(db.created_at ?? db.createdAt ?? new Date().toISOString()),
    category: (db.category as string) || undefined,
    minStock: db.min_stock != null ? Number(db.min_stock) : undefined,
    outputIngredientId: (db.output_ingredient_id as string) || undefined,
  };
}

function dbBatchToFrontend(db: Record<string, unknown>): ProductionBatch {
  const rawItems = (db.items as Record<string, unknown>[]) ?? (db.production_batch_items as Record<string, unknown>[]) ?? [];
  return {
    id: String(db.id ?? ''),
    tenantId: String(db.tenant_id ?? db.tenantId ?? ''),
    recipeId: String(db.recipe_id ?? db.recipeId ?? ''),
    recipeName: String(db.recipe_name ?? db.recipeName ?? '—'),
    producedQuantity: Number(db.produced_quantity ?? db.producedQuantity ?? 0),
    unit: String(db.unit ?? 'kg') as ProductionBatch['unit'],
    yieldPercentActual: db.yield_percent_actual != null ? Number(db.yield_percent_actual) : null,
    yieldPercentExpected: db.yield_percent_expected != null ? Number(db.yield_percent_expected) : null,
    totalCost: Number(db.total_cost ?? db.totalCost ?? 0),
    unitCost: Number(db.unit_cost ?? db.unitCost ?? 0),
    producedBy: String(db.produced_by ?? db.producedBy ?? ''),
    producedAt: String(db.produced_at ?? db.producedAt ?? new Date().toISOString()),
    notes: String(db.notes ?? ''),
    stepsCompleted: ((db.steps_completed ?? db.stepsCompleted) as string[]) ?? [],
    lossQuantityKg: db.loss_quantity_kg != null ? Number(db.loss_quantity_kg) : null,
    lossValue: db.loss_value != null ? Number(db.loss_value) : null,
    items: rawItems.map((it) => ({
      ingredientId: String(it.ingredient_id ?? it.ingredientId ?? ''),
      ingredientName: String(it.ingredient_name ?? it.ingredientName ?? ''),
      quantityUsed: Number(it.quantity_used ?? it.quantityUsed ?? 0),
      unit: String(it.unit ?? 'kg'),
      unitCost: Number(it.unit_cost ?? it.unitCost ?? 0),
      totalCost: Number(it.total_cost ?? it.totalCost ?? 0),
    })),
  };
}

/* ─── Types ───────────────────────────────────────────────────────────────── */

export interface NovaFichaProducao {
  name: string;
  unit: 'kg' | 'g' | 'l' | 'ml' | 'un';
  instructions: string;
  steps: Array<{ id?: string; text: string }>;
  items: Array<{
    ingredientId: string;
    ingredientName: string;
    quantity: number;
    unit: string;
  }>;
  category?: string;
  minStock?: number;
}

export interface NovaBatelada {
  recipeId: string;
  producedQuantity: number;
  yieldPercentActual: number | null;
  yieldPercentExpected: number | null;
  lossQuantityKg: number | null;
  lossValue: number | null;
  notes: string;
  stepsCompleted: string[];
  items: Array<{
    ingredientId: string;
    ingredientName: string;
    quantityUsed: number;
    unit: string;
    unitCost: number;
  }>;
}

export interface NovaBateladaComEstoque {
  recipeId: string;
  recipeName: string;
  producedQuantity: number;
  unit: string;
  yieldPercentActual: number | null;
  yieldPercentExpected: number | null;
  lossQuantityKg: number | null;
  lossValue: number | null;
  notes: string;
  stepsCompleted: string[];
  totalCost: number;
  unitCost: number;
  producedBy: string;
  items: Array<{
    ingredientId: string;
    ingredientName: string;
    quantityUsed: number;
    unit: string;
    unitCost: number;
    totalCost: number;
  }>;
  outputIngredientId: string | null;
}

interface ProducaoContextValue {
  recipes: ProductionRecipe[];
  batches: ProductionBatch[];
  loading: boolean;
  error: string | null;
  addRecipe: (recipe: NovaFichaProducao) => Promise<string>;
  updateRecipe: (id: string, recipe: Partial<ProductionRecipe>) => Promise<void>;
  deleteRecipe: (id: string) => Promise<void>;
  addBatch: (batch: NovaBatelada, operador: string) => Promise<string>;
  addBatchWithStock: (batch: NovaBateladaComEstoque) => Promise<string>;
  deleteBatch: (id: string) => Promise<void>;
  getRecipeById: (id: string) => ProductionRecipe | undefined;
  getBatchesByRecipeId: (recipeId: string) => ProductionBatch[];
  getBatchById: (id: string) => ProductionBatch | undefined;
  reload: () => Promise<void>;
}

const ProducaoContext = createContext<ProducaoContextValue | null>(null);

/* ─── Provider ──────────────────────────────────────────────────────────────── */

export function ProducaoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [recipes, setRecipes] = useState<ProductionRecipe[]>(() => loadRecipesFromLS() ?? []);
  const [batches, setBatches] = useState<ProductionBatch[]>(() => loadBatchesFromLS() ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const tenantIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (user?.tenantId) tenantIdRef.current = user.tenantId;
  }, [user?.tenantId]);

  // ── Load from backend ─────────────────────────────────────────────────
  const loadFromBackend = useCallback(async () => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) return;

    // Se sessao nao estiver ativa, nao tenta carregar do backend
    const freshSession = await ensureFreshSession();
    if (!freshSession) {
      // Mantem dados do localStorage em cache sem gerar erro na tela
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch recipes
      const { data: recipesData, error: recipesErr } = await invokeWithAuth<{
        success: boolean;
        data: Record<string, unknown>[];
        error?: string;
      }>('production-write', {
        body: { action: 'list_recipes', tenant_id: tenantId },
      });

      if (recipesErr) throw recipesErr;
      if (!recipesData?.success) throw new Error(recipesData?.error ?? 'Erro ao carregar fichas');

      const loadedRecipes = (recipesData.data ?? []).map(dbRecipeToFrontend);
      setRecipes(loadedRecipes);
      saveRecipesToLS(loadedRecipes);

      // Fetch batches
      const { data: batchesData, error: batchesErr } = await invokeWithAuth<{
        success: boolean;
        data: Record<string, unknown>[];
        error?: string;
      }>('production-write', {
        body: { action: 'list_batches', tenant_id: tenantId },
      });

      if (batchesErr) throw batchesErr;
      if (!batchesData?.success) throw new Error(batchesData?.error ?? 'Erro ao carregar produções');

      const loadedBatches = (batchesData.data ?? []).map(dbBatchToFrontend);
      setBatches(loadedBatches);
      saveBatchesToLS(loadedBatches);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);

      // Se for erro de sessao expirada/revogada, ignora silenciosamente
      // (o sistema de auth ja redirecionara ou renovara)
      const isSessionError = /sess[ãa]o.*expirada|sess[ãa]o.*revogada|invalid.*session|sess[ãa]o.*inv[áa]lida/i.test(msg);
      if (isSessionError) {
        console.warn('[ProducaoContext] Sessao expirada — mantendo cache local');
        setError(null);
      } else {
        setError(msg);
        console.error('[ProducaoContext] loadFromBackend error:', msg);
      }
      // Mantém os dados do localStorage como fallback
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  // ── Initial load ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.tenantId) return;
    loadFromBackend();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId]);

  // ── Realtime sync ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!user?.tenantId) return;
    const tenantId = user.tenantId;

    const channel = supabase
      .channel(`producao-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_recipes', filter: `tenant_id=eq.${tenantId}` }, () => {
        loadFromBackend();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_recipe_items' }, () => {
        loadFromBackend();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_recipe_steps' }, () => {
        loadFromBackend();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_batches', filter: `tenant_id=eq.${tenantId}` }, () => {
        loadFromBackend();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'production_batch_items' }, () => {
        loadFromBackend();
      })
      .subscribe();

    channelRef.current = channel;

    return () => {
      channel.unsubscribe();
      channelRef.current = null;
    };
  }, [user?.tenantId, loadFromBackend]);

  // ── Persist to localStorage on change ──────────────────────────────────
  useEffect(() => {
    saveRecipesToLS(recipes);
  }, [recipes]);

  useEffect(() => {
    saveBatchesToLS(batches);
  }, [batches]);

  // ── Cross-tab sync via storage event ────────────────────────────────────
  useEffect(() => {
    const handleStorage = (e: StorageEvent) => {
      if (e.key === LS_RECIPES_KEY) {
        const updated = loadRecipesFromLS();
        if (updated) setRecipes(updated);
      }
      if (e.key === LS_BATCHES_KEY) {
        const updated = loadBatchesFromLS();
        if (updated) setBatches(updated);
      }
    };
    window.addEventListener('storage', handleStorage);
    return () => window.removeEventListener('storage', handleStorage);
  }, []);

  // ── CRUD operations ───────────────────────────────────────────────────

  const addRecipe = useCallback(async (nova: NovaFichaProducao): Promise<string> => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');

    const { data, error: apiErr } = await invokeWithAuth<{
      success: boolean;
      data: { id: string };
      error?: string;
    }>('production-write', {
      body: {
        action: 'create_recipe',
        tenant_id: tenantId,
        name: nova.name,
        unit: nova.unit,
        output_quantity: 1,
        instructions: nova.instructions,
        category: nova.category,
        min_stock: nova.minStock ?? 0,
        items: nova.items.map((it) => ({
          ingredient_id: it.ingredientId,
          ingredient_name: it.ingredientName,
          quantity: it.quantity,
          unit: it.unit,
          unit_cost: 0,
        })),
        steps: nova.steps.map((s) => ({ text: s.text })),
      },
    });

    if (apiErr) throw apiErr;
    if (!data?.success) throw new Error(data?.error ?? 'Erro ao criar ficha');

    await loadFromBackend();
    return data.data.id;
  }, [user?.tenantId, loadFromBackend]);

  const updateRecipe = useCallback(async (id: string, changes: Partial<ProductionRecipe>) => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');

    const items = changes.items?.map((it) => ({
      ingredient_id: it.ingredientId,
      ingredient_name: it.ingredientName,
      quantity: it.quantity,
      unit: it.unit,
      unit_cost: it.unitCost,
    }));

    const steps = changes.steps?.map((s) => ({ text: s.text }));

    const { data, error: apiErr } = await invokeWithAuth<{
      success: boolean;
      error?: string;
    }>('production-write', {
      body: {
        action: 'update_recipe',
        tenant_id: tenantId,
        recipe_id: id,
        name: changes.name,
        unit: changes.unit,
        output_quantity: 1,
        instructions: changes.instructions,
        category: changes.category,
        min_stock: changes.minStock,
        is_active: changes.isActive,
        items,
        steps,
      },
    });

    if (apiErr) throw apiErr;
    if (!data?.success) throw new Error(data?.error ?? 'Erro ao atualizar ficha');

    await loadFromBackend();
  }, [user?.tenantId, loadFromBackend]);

  const deleteRecipe = useCallback(async (id: string) => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');

    // Soft-delete the associated ingredient (semi-finished product) if it exists
    const recipe = recipes.find((r) => r.id === id);
    if (recipe) {
      const { error: updErr } = await supabase
        .from('ingredients')
        .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('name', recipe.name)
        .eq('tenant_id', tenantId)
        .is('deleted_at', null);
      if (updErr) console.warn('[ProducaoContext] soft-delete ingredient error:', updErr.message);
    }

    const { data, error: apiErr } = await invokeWithAuth<{
      success: boolean;
      error?: string;
    }>('production-write', {
      body: {
        action: 'delete_recipe',
        tenant_id: tenantId,
        recipe_id: id,
      },
    });

    if (apiErr) throw apiErr;
    if (!data?.success) throw new Error(data?.error ?? 'Erro ao excluir ficha');

    await loadFromBackend();
  }, [recipes, user?.tenantId, loadFromBackend]);

  const addBatch = useCallback(async (nova: NovaBatelada, operador: string): Promise<string> => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');

    const recipe = recipes.find((r) => r.id === nova.recipeId);
    const totalCost = nova.items.reduce((s, it) => s + it.quantityUsed * it.unitCost, 0);
    const unitCost = nova.producedQuantity > 0 ? totalCost / nova.producedQuantity : 0;

    const { data, error: apiErr } = await invokeWithAuth<{
      success: boolean;
      data: { id: string };
      error?: string;
    }>('production-write', {
      body: {
        action: 'create_batch',
        tenant_id: tenantId,
        recipe_id: nova.recipeId,
        recipe_name: recipe?.name ?? '—',
        produced_quantity: nova.producedQuantity,
        unit: recipe?.unit ?? 'kg',
        yield_percent_actual: nova.yieldPercentActual,
        yield_percent_expected: nova.yieldPercentExpected,
        total_cost: totalCost,
        unit_cost: unitCost,
        produced_by: operador,
        notes: nova.notes,
        steps_completed: nova.stepsCompleted,
        loss_quantity_kg: nova.lossQuantityKg,
        loss_value: nova.lossValue,
        items: nova.items.map((it) => ({
          ingredient_id: it.ingredientId,
          ingredient_name: it.ingredientName,
          quantity_used: it.quantityUsed,
          unit: it.unit,
          unit_cost: it.unitCost,
          total_cost: it.quantityUsed * it.unitCost,
        })),
      },
    });

    if (apiErr) throw apiErr;
    if (!data?.success) throw new Error(data?.error ?? 'Erro ao registrar produção');

    await loadFromBackend();
    return data.data.id;
  }, [recipes, user?.tenantId, loadFromBackend]);

  const addBatchWithStock = useCallback(async (nova: NovaBateladaComEstoque): Promise<string> => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');

    console.log('[ProducaoContext] addBatchWithStock START:', {
      recipeId: nova.recipeId,
      recipeName: nova.recipeName,
      producedQuantity: nova.producedQuantity,
      unit: nova.unit,
      outputIngredientId: nova.outputIngredientId,
      itemsCount: nova.items.length,
    });

    const { data, error: apiErr } = await invokeWithAuth<{
      success: boolean;
      data: { id: string };
      error?: string;
      movements_count?: number;
      debug_log?: Array<Record<string, unknown>>;
    }>('production-write', {
      body: {
        action: 'create_batch_with_stock',
        tenant_id: tenantId,
        recipe_id: nova.recipeId,
        recipe_name: nova.recipeName,
        produced_quantity: nova.producedQuantity,
        unit: nova.unit,
        yield_percent_actual: nova.yieldPercentActual,
        yield_percent_expected: nova.yieldPercentExpected,
        loss_quantity_kg: nova.lossQuantityKg,
        loss_value: nova.lossValue,
        total_cost: nova.totalCost,
        unit_cost: nova.unitCost,
        produced_by: nova.producedBy,
        notes: nova.notes,
        steps_completed: nova.stepsCompleted,
        items: nova.items.map((it) => ({
          ingredient_id: it.ingredientId,
          ingredient_name: it.ingredientName,
          quantity_used: it.quantityUsed,
          unit: it.unit,
          unit_cost: it.unitCost,
          total_cost: it.totalCost,
        })),
        output_ingredient_id: nova.outputIngredientId,
      },
    });

    console.log('[ProducaoContext] addBatchWithStock response:', {
      success: data?.success,
      batchId: data?.data?.id,
      movements_count: data?.movements_count,
      debug_log: data?.debug_log,
      apiErr: apiErr?.message,
    });

    if (apiErr) throw apiErr;
    if (!data?.success) throw new Error(data?.error ?? 'Erro ao registrar produção com estoque');

    await loadFromBackend();
    return data.data.id;
  }, [user?.tenantId, loadFromBackend]);

  const deleteBatch = useCallback(async (id: string) => {
    const tenantId = tenantIdRef.current ?? user?.tenantId;
    if (!tenantId) throw new Error('Tenant não identificado');

    const { data, error: apiErr } = await invokeWithAuth<{
      success: boolean;
      error?: string;
    }>('production-write', {
      body: {
        action: 'delete_batch',
        tenant_id: tenantId,
        batch_id: id,
      },
    });

    if (apiErr) throw apiErr;
    if (!data?.success) throw new Error(data?.error ?? 'Erro ao excluir produção');

    await loadFromBackend();
  }, [user?.tenantId, loadFromBackend]);

  const getRecipeById = useCallback(
    (id: string) => recipes.find((r) => r.id === id),
    [recipes],
  );

  const getBatchesByRecipeId = useCallback(
    (recipeId: string) => batches.filter((b) => b.recipeId === recipeId),
    [batches],
  );

  const getBatchById = useCallback(
    (id: string) => batches.find((b) => b.id === id),
    [batches],
  );

  const reload = useCallback(async () => {
    await loadFromBackend();
  }, [loadFromBackend]);

  return (
    <ProducaoContext.Provider
      value={{
        recipes,
        batches,
        loading,
        error,
        addRecipe,
        updateRecipe,
        deleteRecipe,
        addBatch,
        addBatchWithStock,
        deleteBatch,
        getRecipeById,
        getBatchesByRecipeId,
        getBatchById,
        reload,
      }}
    >
      {children}
    </ProducaoContext.Provider>
  );
}

export function useProducao(): ProducaoContextValue {
  const ctx = useContext(ProducaoContext);
  if (!ctx) throw new Error('useProducao must be used within ProducaoProvider');
  return ctx;
}
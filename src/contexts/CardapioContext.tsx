import { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { ReactNode, Dispatch, SetStateAction } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useKioskAuth } from '@/contexts/KioskAuthContext';
import { useToast } from '@/contexts/ToastContext';
import { useAuditoria } from '@/contexts/AuditoriaContext';
import { notifyReload } from '@/lib/reloadSignal';
import type { Categoria, Item, Combo, ObservacaoGlobal, GrupoOpcoes, OpcaoItem, PromocaoItem } from '@/types/cardapio';
import type { ItemCardapioPublico } from '@/types/mesaCliente';
import { saveMenuCache, getMenuCache } from '@/lib/offlineDB';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface EstacaoCozinha {
  id: string;
  nome: string;
  cor: string;
  sortOrder: number;
  slaMinutos: number;
  ativo: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function isUuid(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
}

// ── DB Row Types ───────────────────────────────────────────────────────────────

interface DBStation {
  id: string;
  name: string;
  color?: string | null;
  sort_order?: number | null;
  sla_minutes?: number | null;
  is_active?: boolean | null;
}

interface DBOpcao {
  id: string;
  name: string;
  additional_price?: number | null;
  is_active?: boolean | null;
  ingredient_id?: string | null;
  production_recipe_id?: string | null;
  consumption_quantity?: number | null;
}

interface DBGrupoOpcoes {
  id: string;
  name: string;
  is_required?: boolean | null;
  min_selections?: number | null;
  max_selections?: number | null;
  sort_order?: number | null;
  options?: DBOpcao[];
}

interface DBPromocao {
  id: string;
  promotional_price?: number | null;
  is_recurring?: boolean | null;
  days_of_week?: number[] | null;
  specific_date?: string | null;
  is_active?: boolean | null;
}

interface DBPresetObs {
  text: string;
}

interface DBDeliveryConfig {
  ativo?: boolean;
  preco?: number | null;
  slaMinutos?: number | null;
  quantidadeMinima?: number | null;
  quantidadeMaxima?: number | null;
  embalagem?: string | null;
  descricao?: string | null;
}

interface DBItem {
  id: string;
  category_id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  photo_url?: string | null;
  sla_minutes?: number | null;
  is_active?: boolean | null;
  skip_kds?: boolean | null;
  channels?: Record<string, boolean> | null;
  delivery_config?: DBDeliveryConfig | null;
  option_groups?: DBGrupoOpcoes[];
  promotions?: DBPromocao[];
  preset_observations?: DBPresetObs[];
  production_parts?: Array<Record<string, unknown>>;
}

interface DBCategoria {
  id: string;
  name: string;
  station_name?: string | null;
  station_id?: string | null;
  sort_order?: number | null;
  is_active?: boolean | null;
  item_count?: number | null;
}

interface DBObsGlobal {
  id: string;
  text: string;
  is_active?: boolean | null;
  excluded_item_ids?: string[] | null;
  excluded_category_ids?: string[] | null;
}

interface DBComboItem {
  item_id: string;
  name: string;
  quantity: number;
}

interface DBCombo {
  id: string;
  name: string;
  description?: string | null;
  price?: number | null;
  photo_url?: string | null;
  is_active?: boolean | null;
  items?: DBComboItem[];
}

// ── DB → Frontend Mappers ──────────────────────────────────────────────────────

function mapStation(s: DBStation): EstacaoCozinha {
  return {
    id: s.id, nome: s.name, cor: s.color ?? '#6b7280',
    sortOrder: s.sort_order ?? 0, slaMinutos: s.sla_minutes ?? 15, ativo: s.is_active ?? true,
  };
}

function mapCategoria(c: DBCategoria): Categoria {
  return {
    id: c.id, nome: c.name, estacao: c.station_name ?? '', estacaoId: c.station_id ?? undefined,
    ordem: c.sort_order ?? 0, ativo: c.is_active ?? true, totalItens: c.item_count ?? 0,
  };
}

function mapOpcao(o: DBOpcao, ingredientNameMap?: Map<string, string>): OpcaoItem {
  const resolvedName = (o.name && o.name.trim() !== '')
    ? o.name
    : (o.ingredient_id && ingredientNameMap?.get(o.ingredient_id)) || o.name || '';
  return {
    id: o.id, nome: resolvedName, precoAdicional: Number(o.additional_price ?? 0), ativo: o.is_active ?? true,
    ingredientId: o.ingredient_id ?? null,
    productionRecipeId: o.production_recipe_id ?? null,
    consumptionQuantity: o.consumption_quantity ? Number(o.consumption_quantity) : undefined,
  };
}

function mapGrupoOpcoes(g: DBGrupoOpcoes, ingredientNameMap?: Map<string, string>): GrupoOpcoes {
  return {
    id: g.id, nome: g.name, obrigatorio: g.is_required ?? false,
    minSelecao: g.min_selections ?? 0, maxSelecao: g.max_selections ?? 1,
    ordem: g.sort_order ?? 0, opcoes: (g.options ?? []).map((o) => mapOpcao(o, ingredientNameMap)),
  };
}

function mapPromocao(p: DBPromocao): PromocaoItem {
  return {
    id: p.id, precoPromocional: Number(p.promotional_price ?? 0),
    tipo: p.is_recurring ? 'semanal' : 'pontual',
    diasSemana: p.days_of_week ?? [], dataEspecifica: p.specific_date ?? undefined,
    ativo: p.is_active ?? true,
  };
}

function mapDeliveryConfig(dc: DBDeliveryConfig | null | undefined, precoBase: number, slaBase: number): import('@/types/cardapio').ConfiguracaoDelivery | undefined {
  if (!dc) return undefined;
  return {
    ativo: dc.ativo ?? false,
    preco: dc.preco != null ? Number(dc.preco) : precoBase,
    slaMinutos: dc.slaMinutos != null ? Number(dc.slaMinutos) : slaBase,
    quantidadeMinima: dc.quantidadeMinima ?? 1,
    quantidadeMaxima: dc.quantidadeMaxima ?? undefined,
    embalagem: dc.embalagem ?? '',
    descricao: dc.descricao ?? '',
    fichaTecnica: [],
  };
}

function mapItem(i: DBItem, ingredientNameMap?: Map<string, string>): Item {
  const ch = i.channels ?? {};
  const somenteDelivery = ch.delivery === true
    && ch.cashier === false
    && ch.waiter === false
    && ch.table_qr === false
    && ch.self_service === false;
  const precoBase = Number(i.price ?? 0);
  const slaBase = i.sla_minutes ?? 10;
  return {
    id: i.id, categoriaId: i.category_id, nome: i.name, descricao: i.description ?? '',
    preco: precoBase, fotoUrl: i.photo_url ?? '', slaMinutos: slaBase,
    status: i.is_active ? 'ativo' : 'inativo', semPreparo: i.skip_kds ?? false,
    somenteDelivery,
    canais: ch,
    ordem: i.sort_order ?? 0,
    gruposOpcoes: (i.option_groups ?? []).map((g) => mapGrupoOpcoes(g, ingredientNameMap)),
    promocoes: (i.promotions ?? []).map(mapPromocao),
    observacoesPadrao: (i.preset_observations ?? []).map((o) => o.text),
    fichaTecnica: [],
    subproducao: (i.production_parts ?? []).map((p: Record<string, unknown>) => ({
      id: String(p.id ?? `sp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
      nome: String(p.name ?? ''),
      estacao: String(p.station_name ?? ''),
      estacaoId: p.station_id ? String(p.station_id) : undefined,
      slaMinutos: Number(p.sla_minutes ?? 10),
    })),
    delivery: mapDeliveryConfig(i.delivery_config, precoBase, slaBase),
  };
}

function mapObsGlobal(o: DBObsGlobal): ObservacaoGlobal {
  return {
    id: o.id,
    texto: o.text,
    ativo: o.is_active ?? true,
    excludedItemIds: o.excluded_item_ids ?? [],
    excludedCategoryIds: o.excluded_category_ids ?? [],
  };
}

function mapCombo(c: DBCombo): Combo {
  return {
    id: c.id, nome: c.name, descricao: c.description ?? '', preco: Number(c.price ?? 0),
    fotoUrl: c.photo_url ?? '', ativo: c.is_active ?? true,
    itens: (c.items ?? []).map((ci) => ({
      itemId: ci.item_id ?? null, nome: ci.name ?? '', quantidade: ci.quantity ?? 1,
    })),
  };
}

// ── Menu Write Helper ──────────────────────────────────────────────────────────

async function menuWrite(action: string, payload: Record<string, unknown>, tenantId?: string): Promise<{ success?: boolean } | null> {
  try {
    const body: Record<string, unknown> = { action, payload };
    if (tenantId) body.active_tenant_id = tenantId;
    const { data, error } = await invokeWithAuth<{ success?: boolean }>('menu-write', { body });
    if (error) {
      const detail = error.message ?? String(error);
      console.error('[Cardapio] menuWrite error:', action, detail);
      throw new Error(detail);
    }
    return data;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error('[Cardapio] menuWrite threw:', action, msg);
    throw err;
  }
}

// ── Context Interface ──────────────────────────────────────────────────────────

interface CardapioContextValue {
  itens: Item[];
  categorias: Categoria[];
  combos: Combo[];
  obsGlobais: ObservacaoGlobal[];
  estacoes: EstacaoCozinha[];
  loading: boolean;
  saving: boolean;

  // Backward compat setters
  setItens: Dispatch<SetStateAction<Item[]>>;
  setCategorias: Dispatch<SetStateAction<Categoria[]>>;
  setCombos: Dispatch<SetStateAction<Combo[]>>;
  setObsGlobais: Dispatch<SetStateAction<ObservacaoGlobal[]>>;

  recarregar: () => Promise<void>;
  recarregarEstacoes: () => Promise<void>;

  // Category CRUD
  criarCategoria: (data: { nome: string; estacaoId?: string }) => Promise<void>;
  editarCategoria: (id: string, data: { nome?: string; estacaoId?: string; ativo?: boolean }) => Promise<void>;
  excluirCategoria: (id: string) => Promise<void>;
  reordenarCategorias: (items: Array<{ id: string; sortOrder: number }>) => Promise<void>;

  // Item CRUD
  salvarItem: (item: Item) => Promise<void>;
  excluirItem: (id: string) => Promise<void>;
  reordenarItens: (items: Array<{ id: string; sortOrder: number }>) => Promise<void>;

  // Global Obs CRUD
  criarObsGlobal: (texto: string) => Promise<void>;
  editarObsGlobal: (id: string, data: { texto?: string; ativo?: boolean; excludedItemIds?: string[]; excludedCategoryIds?: string[] }) => Promise<void>;
  excluirObsGlobal: (id: string) => Promise<void>;

  // Combo CRUD
  salvarCombo: (combo: Combo) => Promise<void>;
  excluirCombo: (id: string) => Promise<void>;

  // Derived
  itensAtivos: Item[];      // itens ativos para canais presenciais (exclui somenteDelivery)
  itensDelivery: Item[];    // itens ativos para o canal delivery
  itensPublicos: ItemCardapioPublico[];
  numerosMap: Map<string, number>;
}

const CardapioContext = createContext<CardapioContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function CardapioProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { kioskSession } = useKioskAuth();
  const { addToast } = useToast();
  const { registrarEvento } = useAuditoria();

  const [itens, setItens] = useState<Item[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [combos, setCombos] = useState<Combo[]>([]);
  const [obsGlobais, setObsGlobais] = useState<ObservacaoGlobal[]>([]);
  const [estacoes, setEstacoes] = useState<EstacaoCozinha[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const effectiveTenantId = user?.tenantId ?? kioskSession?.tenantId ?? null;

  // Reload only kitchen stations (fast — used after create/update/delete station)
  const recarregarEstacoes = useCallback(async () => {
    if (!effectiveTenantId) return;
    try {
      const { data, error } = await supabase
        .from('kitchen_stations')
        .select('id, name, color, sla_minutes, is_active, sort_order')
        .eq('tenant_id', effectiveTenantId)
        .order('sort_order', { ascending: true });
      if (!error && data) {
        setEstacoes(data.map(mapStation));
        // Notify other consumers (e.g. KDS, PDV) that stations changed
        notifyReload('kitchen_stations');
      }
    } catch (err) {
      console.error('[Cardapio] recarregarEstacoes error:', err);
    }
  }, [effectiveTenantId]);

  const recarregar = useCallback(async () => {
    if (!effectiveTenantId) {
      setCategorias([]);
      setItens([]);
      setCombos([]);
      setObsGlobais([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('fn_get_full_menu', { p_tenant_id: effectiveTenantId });
      if (error || !data) {
        console.warn('[Cardapio] DB load failed:', error?.message);

        // ── OFFLINE FALLBACK: tenta carregar do cache local ───────────────
        const cached = await getMenuCache(effectiveTenantId);
        if (cached) {
          console.info('[Cardapio] Usando cache offline do cardápio');
          setEstacoes((cached.stations as Parameters<typeof mapStation>[0][] ?? []).map(mapStation));
          setCategorias((cached.categories as Parameters<typeof mapCategoria>[0][] ?? []).map(mapCategoria));
          setItens((cached.items as Parameters<typeof mapItem>[0][] ?? []).map(mapItem));
          setCombos((cached.combos as Parameters<typeof mapCombo>[0][] ?? []).map(mapCombo));
          setObsGlobais((cached.globalObservations as Parameters<typeof mapObsGlobal>[0][] ?? []).map(mapObsGlobal));
        } else {
          setCategorias([]);
          setItens([]);
          setCombos([]);
          setObsGlobais([]);
        }
      } else {
        // ── Fallback: buscar nomes de ingredientes para opções com name vazio ──
        const ingredientIdsToFetch: string[] = [];
        const rawItems = (data.items ?? []) as DBItem[];
        for (const item of rawItems) {
          for (const grp of (item.option_groups ?? [])) {
            for (const opt of (grp.options ?? [])) {
              if (opt.ingredient_id && (!opt.name || String(opt.name).trim() === '')) {
                ingredientIdsToFetch.push(opt.ingredient_id);
              }
            }
          }
        }
        let ingredientNameMap = new Map<string, string>();
        if (ingredientIdsToFetch.length > 0) {
          const uniqueIds = [...new Set(ingredientIdsToFetch)];
          const { data: ingRows, error: ingError } = await supabase
            .from('ingredients')
            .select('id, name')
            .in('id', uniqueIds)
            .eq('tenant_id', effectiveTenantId);
          if (!ingError && ingRows) {
            for (const row of ingRows) {
              if (row.id && row.name) ingredientNameMap.set(row.id, row.name);
            }
          }
        }

        setEstacoes((data.stations ?? []).map(mapStation));
        setCategorias((data.categories ?? []).map(mapCategoria));
        setItens((data.items ?? []).map((i: DBItem) => mapItem(i, ingredientNameMap)));
        setCombos((data.combos ?? []).map(mapCombo));
        setObsGlobais((data.global_observations ?? []).map(mapObsGlobal));

        // ── Salva no cache offline após carregamento bem-sucedido ─────────
        saveMenuCache(effectiveTenantId, {
          categories: data.categories ?? [],
          items: data.items ?? [],
          combos: data.combos ?? [],
          globalObservations: data.global_observations ?? [],
          stations: data.stations ?? [],
        }).catch((e) => console.warn('[Cardapio] Falha ao salvar cache offline:', e));
      }
    } catch (err) {
      console.error('[Cardapio] Error loading:', err);

      // ── OFFLINE FALLBACK em exceção ───────────────────────────────────
      try {
        const cached = await getMenuCache(effectiveTenantId);
        if (cached) {
          console.info('[Cardapio] Usando cache offline do cardápio (exceção)');
          setEstacoes((cached.stations as Parameters<typeof mapStation>[0][] ?? []).map(mapStation));
          setCategorias((cached.categories as Parameters<typeof mapCategoria>[0][] ?? []).map(mapCategoria));
          setItens((cached.items as Parameters<typeof mapItem>[0][] ?? []).map(mapItem));
          setCombos((cached.combos as Parameters<typeof mapCombo>[0][] ?? []).map(mapCombo));
          setObsGlobais((cached.globalObservations as Parameters<typeof mapObsGlobal>[0][] ?? []).map(mapObsGlobal));
        }
      } catch (cacheErr) {
        console.error('[Cardapio] Cache offline também falhou:', cacheErr);
      }
    } finally {
      setLoading(false);
    }
  }, [effectiveTenantId]);

  useEffect(() => { recarregar(); }, [recarregar]);

  // ── Category CRUD ─────────────────────────────────────────────────────────

  const criarCategoria = async (data: { nome: string; estacaoId?: string }) => {
    setSaving(true);
    const maxOrdem = categorias.length > 0 ? Math.max(...categorias.map(c => c.ordem)) : 0;
    try {
      const result = await menuWrite('upsert_category', {
        name: data.nome, station_id: data.estacaoId ?? null,
        sort_order: maxOrdem + 1, is_active: true,
      }, user?.tenantId);
      if (result?.success) await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao criar categoria: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const editarCategoria = async (id: string, data: { nome?: string; estacaoId?: string; ativo?: boolean }) => {
    const cat = categorias.find(c => c.id === id);
    if (!cat) return;
    setSaving(true);
    try {
      await menuWrite('upsert_category', {
        id, name: data.nome ?? cat.nome,
        station_id: data.estacaoId ?? cat.estacaoId ?? null,
        sort_order: cat.ordem, is_active: data.ativo ?? cat.ativo,
      }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao editar categoria: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const excluirCategoria = async (id: string) => {
    setSaving(true);
    try {
      await menuWrite('delete_category', { id }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao excluir categoria: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const reordenarCategorias = async (items: Array<{ id: string; sortOrder: number }>) => {
    const mapped: Record<string, number> = {};
    items.forEach(({ id, sortOrder }) => { mapped[id] = sortOrder; });
    setCategorias(prev =>
      prev.map(c => ({ ...c, ordem: mapped[c.id] ?? c.ordem })).sort((a, b) => a.ordem - b.ordem)
    );
    try {
      await menuWrite('reorder_categories', {
        items: items.map(({ id, sortOrder }) => ({ id, sort_order: sortOrder })),
      }, user?.tenantId);
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao reordenar: ${err instanceof Error ? err.message : String(err)}` });
      await recarregar();
    }
  };

  // ── Item CRUD ─────────────────────────────────────────────────────────────

  const salvarItem = async (item: Item) => {
    setSaving(true);
    const idToSend = isUuid(item.id) ? item.id : undefined;
    const isNew = !idToSend;
    const existing = idToSend ? itens.find((i) => i.id === idToSend) : null;
    try {
      const channels = item.somenteDelivery
        ? { cashier: false, waiter: false, delivery: true, table_qr: false, self_service: false }
        : { cashier: true, waiter: true, delivery: true, table_qr: true, self_service: true };

      // Serializa delivery_config para salvar no banco
      const deliveryConfigPayload = item.delivery ? {
        ativo: item.delivery.ativo,
        preco: item.delivery.preco,
        slaMinutos: item.delivery.slaMinutos,
        quantidadeMinima: item.delivery.quantidadeMinima,
        quantidadeMaxima: item.delivery.quantidadeMaxima ?? null,
        embalagem: item.delivery.embalagem ?? '',
        descricao: item.delivery.descricao ?? '',
      } : null;

      const productionPartsPayload = (item.subproducao ?? []).map((sp, idx) => ({
        id: isUuid(sp.id) ? sp.id : undefined,
        name: sp.nome,
        station_name: sp.estacao,
        station_id: sp.estacaoId ?? null,
        sla_minutes: sp.slaMinutos,
        sort_order: idx,
      }));

      console.log('[CardapioContext] salvarItem production_parts:', productionPartsPayload);

      await menuWrite('upsert_item', {
        id: idToSend,
        category_id: item.categoriaId,
        name: item.nome,
        description: item.descricao,
        price: item.preco,
        photo_url: item.fotoUrl,
        sla_minutes: item.slaMinutos,
        is_active: item.status === 'ativo',
        skip_kds: item.semPreparo ?? false,
        channels,
        delivery_config: deliveryConfigPayload,
        option_groups: item.gruposOpcoes.map((g, gi) => ({
          id: isUuid(g.id) ? g.id : undefined,
          name: g.nome, is_required: g.obrigatorio,
          min_selections: g.minSelecao, max_selections: g.maxSelecao, sort_order: gi,
          options: g.opcoes.map((o, oi) => ({
            id: isUuid(o.id) ? o.id : undefined,
            name: o.nome, additional_price: o.precoAdicional, is_active: o.ativo, sort_order: oi,
            ingredient_id: o.ingredientId ?? null,
            production_recipe_id: o.productionRecipeId ?? null,
            consumption_quantity: o.consumptionQuantity ?? null,
          })),
        })),
        promotions: item.promocoes.map(p => ({
          id: isUuid(p.id) ? p.id : undefined,
          promotional_price: p.precoPromocional,
          days_of_week: p.diasSemana,
          is_recurring: p.tipo === 'semanal',
          specific_date: p.dataEspecifica ?? null,
          is_active: p.ativo,
        })),
        preset_observations: item.observacoesPadrao.map(text => ({ text })),
        production_parts: productionPartsPayload,
      }, user?.tenantId);

      if (user) {
        if (isNew) {
          registrarEvento({
            tipo: 'item_editado',
            severidade: 'info',
            usuario: user.nome,
            perfil: user.perfil,
            descricao: `Item criado no cardápio: "${item.nome}" — R$ ${item.preco.toFixed(2)}`,
            entidade: 'Cardápio',
            entidadeId: item.nome,
            depois: { nome: item.nome, preco: item.preco, status: item.status },
          });
        } else if (existing && existing.preco !== item.preco) {
          registrarEvento({
            tipo: 'preco_alterado',
            severidade: 'aviso',
            usuario: user.nome,
            perfil: user.perfil,
            descricao: `Preço alterado: "${item.nome}" de R$ ${existing.preco.toFixed(2)} → R$ ${item.preco.toFixed(2)}`,
            entidade: 'Cardápio',
            entidadeId: item.nome,
            antes: { preco: existing.preco },
            depois: { preco: item.preco },
          });
        } else if (!isNew) {
          registrarEvento({
            tipo: 'item_editado',
            severidade: 'info',
            usuario: user.nome,
            perfil: user.perfil,
            descricao: `Item editado no cardápio: "${item.nome}"`,
            entidade: 'Cardápio',
            entidadeId: item.nome,
            antes: existing ? { preco: existing.preco, status: existing.status } : undefined,
            depois: { preco: item.preco, status: item.status },
          });
        }
      }

      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao salvar item: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const excluirItem = async (id: string) => {
    setSaving(true);
    const item = itens.find((i) => i.id === id);
    try {
      await menuWrite('delete_item', { id }, user?.tenantId);
      if (user && item) {
        registrarEvento({
          tipo: 'item_editado',
          severidade: 'aviso',
          usuario: user.nome,
          perfil: user.perfil,
          descricao: `Item excluído do cardápio: "${item.nome}"`,
          entidade: 'Cardápio',
          entidadeId: item.nome,
          antes: { preco: item.preco, status: item.status },
        });
      }
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao excluir item: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const reordenarItens = async (items: Array<{ id: string; sortOrder: number }>) => {
    const mapped: Record<string, number> = {};
    items.forEach(({ id, sortOrder }) => { mapped[id] = sortOrder; });
    setItens(prev =>
      prev.map(i => ({ ...i, ordem: mapped[i.id] ?? i.ordem })).sort((a, b) => a.ordem - b.ordem)
    );
    try {
      await menuWrite('reorder_items', {
        items: items.map(({ id, sortOrder }) => ({ id, sort_order: sortOrder })),
      }, user?.tenantId);
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao reordenar itens: ${err instanceof Error ? err.message : String(err)}` });
      await recarregar();
    }
  };

  // ── Global Obs CRUD ───────────────────────────────────────────────────────

  const criarObsGlobal = async (texto: string) => {
    setSaving(true);
    try {
      await menuWrite('upsert_global_obs', { text: texto, is_active: true }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao criar observação: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const editarObsGlobal = async (id: string, data: { texto?: string; ativo?: boolean; excludedItemIds?: string[]; excludedCategoryIds?: string[] }) => {
    const obs = obsGlobais.find(o => o.id === id);
    if (!obs) return;
    setSaving(true);
    try {
      await menuWrite('upsert_global_obs', {
        id,
        text: data.texto ?? obs.texto,
        is_active: data.ativo ?? obs.ativo,
        excluded_item_ids: data.excludedItemIds ?? obs.excludedItemIds,
        excluded_category_ids: data.excludedCategoryIds ?? obs.excludedCategoryIds,
      }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao editar observação: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const excluirObsGlobal = async (id: string) => {
    setSaving(true);
    try {
      await menuWrite('delete_global_obs', { id }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao excluir observação: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  // ── Combo CRUD ────────────────────────────────────────────────────────────

  const salvarCombo = async (combo: Combo) => {
    setSaving(true);
    try {
      await menuWrite('upsert_combo', {
        id: isUuid(combo.id) ? combo.id : undefined,
        name: combo.nome, description: combo.descricao, photo_url: combo.fotoUrl,
        price: combo.preco, is_active: combo.ativo,
        items: combo.itens.map(ci => ({ item_id: ci.itemId ?? null, name: ci.nome, quantity: ci.quantidade })),
      }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao salvar combo: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  const excluirCombo = async (id: string) => {
    setSaving(true);
    try {
      await menuWrite('delete_combo', { id }, user?.tenantId);
      await recarregar();
    } catch (err) {
      addToast({ type: 'error', message: `Erro ao excluir combo: ${err instanceof Error ? err.message : String(err)}` });
    } finally {
      setSaving(false);
    }
  };

  // ── Derived ───────────────────────────────────────────────────────────────

  // Itens para canais presenciais: ativos e NÃO exclusivos de delivery
  const itensAtivos = useMemo(
    () => itens.filter(i => i.status === 'ativo' && !i.somenteDelivery),
    [itens],
  );

  // Itens para o canal delivery: ativos e com delivery habilitado (inclui somenteDelivery)
  const itensDelivery = useMemo(
    () => itens.filter(i => i.status === 'ativo'),
    [itens],
  );

  const numerosMap = useMemo(
    () => new Map<string, number>(itensAtivos.map((item, idx) => [item.id, idx + 1])),
    [itensAtivos],
  );

  const itensPublicos = useMemo<ItemCardapioPublico[]>(() => {
    // Só categorias ativas (não deletadas) — categorias deletadas não aparecem no cardápio público
    const categoriasAtivasIds = new Set(categorias.filter(c => c.ativo).map(c => c.id));

    // Itens normais ativos que permitem mesa_qr (ou sem canais configurados — retrocompatibilidade)
    const itensAtivosMesaQR = itensAtivos.filter(item =>
      item.canais?.mesa_qr === true || item.canais === null || item.canais === undefined
    );

    const itensNormais: ItemCardapioPublico[] = itensAtivosMesaQR
      .filter(item => categoriasAtivasIds.has(item.categoriaId))
      .map((item) => {
        const promoAtiva = item.promocoes.find(p => p.ativo);
        const categoriaNome = categorias.find(c => c.id === item.categoriaId)?.nome ?? 'Outros';

        // Verifica se o item tem observações configuradas (pré-definidas do próprio item)
        const observacoesPadrao = item.observacoesPadrao;

        const cat = categorias.find(c => c.id === item.categoriaId);
        return {
          id: item.id, nome: item.nome, descricao: item.descricao,
          preco: promoAtiva ? promoAtiva.precoPromocional : item.preco,
          foto: item.fotoUrl,
          categoria: categoriaNome,
          slaMinutos: item.slaMinutos, popular: promoAtiva != null,
          semPreparo: item.semPreparo ?? false,
          isCombo: false,
          observacoesPadrao,
          stationId: cat?.estacaoId ?? null,
          opcoes: item.gruposOpcoes.map(g => ({
            grupo: g.nome, obrigatorio: g.obrigatorio,
            itens: g.opcoes.filter(o => o.ativo).map(o => ({ nome: o.nome, precoAdicional: o.precoAdicional })),
          })),
        };
      });

    // Combos ativos (não deletados) — aparecem como categoria 'Combos'
    const combosAtivos: ItemCardapioPublico[] = combos
      .filter(c => c.ativo)
      .map((combo) => ({
        id: combo.id,
        nome: combo.nome,
        descricao: combo.descricao || '',
        preco: combo.preco,
        foto: combo.fotoUrl || '',
        categoria: 'Combos',
        slaMinutos: 15,
        popular: false,
        semPreparo: false,
        isCombo: true,
        observacoesPadrao: [],
        opcoes: [],
      }));

    return [...itensNormais, ...combosAtivos];
  },
    [itensAtivos, categorias, combos],
  );

  return (
    <CardapioContext.Provider value={{
      itens, categorias, combos, obsGlobais, estacoes, loading, saving,
      setItens, setCategorias, setCombos, setObsGlobais,
      recarregar, recarregarEstacoes,
      criarCategoria, editarCategoria, excluirCategoria, reordenarCategorias,
      salvarItem, excluirItem, reordenarItens,
      criarObsGlobal, editarObsGlobal, excluirObsGlobal,
      salvarCombo, excluirCombo,
      itensAtivos, itensDelivery, itensPublicos, numerosMap,
    }}>
      {children}
    </CardapioContext.Provider>
  );
}

export function useCardapio(): CardapioContextValue {
  const ctx = useContext(CardapioContext);
  if (!ctx) throw new Error('useCardapio must be within CardapioProvider');
  return ctx;
}

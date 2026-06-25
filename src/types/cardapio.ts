export interface Categoria {
  id: string;
  nome: string;
  estacao: string;
  estacaoId?: string;
  ordem: number;
  ativo: boolean;
  totalItens: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface OpcaoItem {
  id: string;
  nome: string;
  precoAdicional: number;
  ativo: boolean;
  /** Descrição explicativa da opção (ex: "Pão artesanal com gergelim") */
  descricao?: string;
  /** ID do insumo do estoque vinculado a esta opção */
  ingredientId?: string | null;
  /** Nome do insumo (cache local) */
  ingredientName?: string;
  /** ID da receita de produção vinculada */
  productionRecipeId?: string | null;
  /** Quantidade consumida quando esta opção é selecionada */
  consumptionQuantity?: number;
  /** Unidade de consumo */
  consumptionUnit?: string;
  /** Origem do vínculo: insumo direto ou produto de produção */
  source?: 'ingredient' | 'production';
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface GrupoOpcoes {
  id: string;
  nome: string;
  obrigatorio: boolean;
  minSelecao: number;
  maxSelecao: number;
  ordem: number;
  opcoes: OpcaoItem[];
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ─── Promoções de Item (item_promotions — legado) ─────────────────────────────

export interface PromocaoItem {
  id: string;
  precoPromocional: number;
  tipo: 'semanal' | 'pontual';
  diasSemana: number[];
  dataEspecifica?: string;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

// ─── Ficha Técnica ────────────────────────────────────────────────────────────

export interface FichaTecnicaItem {
  id: string;
  insumoId: string;
  insumoNome: string;
  unidade: string;
  gramagem: number;
  precoUnitario: number;
  modoPreparo?: string;
}

export interface SubproducaoItem {
  id: string;
  nome: string;
  estacao: string;
  estacaoId?: string;
  slaMinutos: number;
}

export interface ConfiguracaoDelivery {
  ativo: boolean;
  preco?: number;
  descricao?: string;
  quantidadeMinima?: number;
  quantidadeMaxima?: number;
  embalagem?: string;
  slaMinutos?: number;
  fichaTecnica?: FichaTecnicaItem[];
}

export interface Item {
  id: string;
  categoriaId: string;
  codigo?: string;
  nome: string;
  descricao: string;
  preco: number;
  fotoUrl: string;
  slaMinutos: number;
  status: 'ativo' | 'inativo';
  semPreparo?: boolean;
  somenteDelivery?: boolean;
  /** Canais de venda habilitados para o item (cashier, waiter, delivery, table_qr, self_service) */
  canais?: Record<string, boolean> | null;
  /** Ordem de exibição no cardápio (sort_order) */
  ordem: number;
  gruposOpcoes: GrupoOpcoes[];
  promocoes: PromocaoItem[];
  observacoesPadrao: string[];
  fichaTecnica: FichaTecnicaItem[];
  subproducao?: SubproducaoItem[];
  delivery?: ConfiguracaoDelivery;
  deleted_at?: string | null;
}

// ─── Combos ───────────────────────────────────────────────────────────────────

export interface ComboItem {
  itemId: string | null;
  nome: string;
  quantidade: number;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

export interface Combo {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  fotoUrl: string;
  ativo: boolean;
  itens: ComboItem[];
  deleted_at?: string | null;
}

// ─── Observações Globais ──────────────────────────────────────────────────────

export interface ObservacaoGlobal {
  id: string;
  texto: string;
  ativo: boolean;
  /** IDs de itens onde esta obs NÃO deve aparecer */
  excludedItemIds: string[];
  /** IDs de categorias onde esta obs NÃO deve aparecer */
  excludedCategoryIds: string[];
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ─── Destaques ────────────────────────────────────────────────────────────────

export interface Destaque {
  id: string;
  itemId: string;
  itemNome: string;
  itemDescricao: string;
  itemPreco: number;
  itemFotoUrl: string;
  itemCategoriaId: string;
  itemCategoriaNome: string;
  customPrice?: number | null;
  customDescription?: string | null;
  ordem: number;
  ativo: boolean;
  // Canal onde o destaque aparece: 'casa' (só presencial), 'delivery' (só delivery)
  // ou 'ambos' (padrão). Filtra em itensPublicos (casa) e nas Edge Functions.
  canal: 'casa' | 'ambos' | 'delivery';
}

// ─── Ficha Técnica de Combos (combo_ingredients) ─────────────────────────────

/**
 * Ingrediente vinculado diretamente a um combo (ficha técnica direta).
 * Se não houver registros aqui, o sistema deduz pelos item_ingredients
 * de cada combo_item individualmente.
 */
export interface ComboIngredient {
  id: string;
  tenant_id: string;
  combo_id: string;
  ingredient_id: string;
  /** Quantidade do ingrediente por unidade do combo */
  quantity: number;
  unit: string;
  created_at: string;
}

// ─── Tipos do banco (snake_case) ──────────────────────────────────────────────

/** Representa uma linha da tabela menu_items */
export interface MenuItem {
  id: string;
  tenant_id: string;
  category_id: string | null;
  name: string;
  description: string | null;
  price: number;
  photo_url: string | null;
  sla_minutes: number;
  is_active: boolean;
  skip_kds: boolean;
  station_id: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Representa uma linha da tabela menu_categories */
export interface MenuCategory {
  id: string;
  tenant_id: string;
  name: string;
  station_id: string | null;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Representa uma linha da tabela option_groups */
export interface OptionGroup {
  id: string;
  tenant_id: string;
  item_id: string;
  name: string;
  required: boolean;
  min_selections: number;
  max_selections: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Representa uma linha da tabela options */
export interface Option {
  id: string;
  tenant_id: string;
  group_id: string;
  name: string;
  description?: string | null;
  additional_price: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Representa uma linha da tabela global_observations */
export interface GlobalObservation {
  id: string;
  tenant_id: string;
  text: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

/** Representa uma linha da tabela item_preset_observations */
export interface ItemPresetObservation {
  id: string;
  tenant_id: string;
  item_id: string;
  text: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

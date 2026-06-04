export type UnidadeEstoque = 'kg' | 'g' | 'l' | 'ml' | 'un';

// ─── Ingredientes ─────────────────────────────────────────────────────────────

export interface Ingredient {
  id: string;
  tenant_id: string;
  name: string;
  unit: string;
  current_stock: number;
  min_stock: number;
  max_stock?: number | null;
  unit_cost: number;
  category_id?: string | null;
  supplier_id?: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface IngredientCategory {
  id: string;
  tenant_id: string;
  name: string;
  color?: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

// ─── Lotes de Ingredientes (ingredient_batches) ───────────────────────────────

export type IngredientBatchStatus = 'active' | 'depleted' | 'expired' | 'recalled';

/** Nivel de alerta de validade calculado pela view ingredient_expiry_alerts */
export type ExpiryAlertLevel = 'ok' | 'warning' | 'critical' | 'expired';

/**
 * Representa um lote fisico de um ingrediente recebido de um fornecedor.
 * Permite rastrear validade, custo por lote e saldo restante.
 */
export interface IngredientBatch {
  id: string;
  tenant_id: string;
  ingredient_id: string;

  /** Codigo do lote impresso pelo fornecedor (ex.: "LOT2024-01") */
  batch_code: string | null;
  supplier_id: string | null;

  quantity_received: number;
  quantity_remaining: number;
  unit: string;

  /** Custo unitario especifico deste lote */
  unit_cost: number;

  received_date: string;      // date ISO (YYYY-MM-DD)
  /** NULL = ingrediente nao perecivel */
  expiry_date: string | null;

  status: IngredientBatchStatus;

  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Resultado da view `ingredient_expiry_alerts`.
 * Inclui campos calculados: days_until_expiry e alert_level.
 */
export interface IngredientExpiryAlert extends IngredientBatch {
  ingredient_name: string;
  /** Dias restantes ate o vencimento (negativo = ja vencido) */
  days_until_expiry: number;
  /** Nivel de severidade: ok / warning (<=7d) / critical (<=3d) / expired */
  alert_level: ExpiryAlertLevel;
}

// ─── Movimentacoes de Estoque (stock_movements) ───────────────────────────────

export type StockMovementType =
  | 'in'              // entrada manual
  | 'out'             // saida manual
  | 'theoretical_out' // saida teorica por venda
  | 'adjustment'      // ajuste de inventario
  | 'transfer_in'     // transferencia recebida
  | 'transfer_out'    // transferencia enviada
  | 'loss'            // perda/descarte
  | 'return';         // devolucao ao fornecedor

export interface StockMovement {
  id: string;
  tenant_id: string;
  ingredient_id: string;
  type: StockMovementType;
  quantity: number;
  unit: string;
  reason?: string | null;
  order_id?: string | null;
  operator_id?: string | null;
  batch_id?: string | null;
  unit_cost?: number | null;
  created_at: string;
}

// ─── Tipos de UI (camelCase — legado) ────────────────────────────────────────

export interface Movimentacao {
  id: string;
  insumoId: string;
  insumoNome: string;
  tipo: 'entrada' | 'saida_venda' | 'saida_manual' | 'perda' | 'entrada_producao' | 'saida_producao' | 'ajuste_inventario';
  quantidade: number;
  unidade: UnidadeEstoque;
  motivo?: string;
  operador: string;
  data: string;
  hora: string;
  custo?: number;
  /** Numero do pedido que gerou a baixa (ex: P2504260001) */
  pedidoNumero?: string | null;
  /** Nome do item vendido que gerou a baixa do insumo */
  itemVendidoNome?: string | null;
}

export interface InventarioItemContado {
  insumoId: string;
  insumoNome: string;
  unidade: UnidadeEstoque;
  qtdTeorica: number;
  qtdContada: number;
  diferenca: number;
  precoUnitario: number;
}

export interface InventarioSession {
  id: string;
  numero: number;
  data: string;
  hora: string;
  operador: string;
  status: 'confirmado';
  itens: InventarioItemContado[];
  itensContados: number;
  itensComDiferenca: number;
  valorAjusteLiquido: number;
}

// ─── Producao (Semi-acabados) ────────────────────────────────────────────────

export interface ProductionRecipeItem {
  id: string;
  ingredientId: string;
  ingredientName: string;
  /** Quantidade de insumo por unidade de produto (a ficha sempre define para 1 unidade) */
  quantity: number;
  unit: string;          // unidade do insumo
  unitCost: number;      // custo unitario no momento da consulta
}

export interface ProductionRecipeStep {
  id: string;
  text: string;
}

export interface ProductionRecipe {
  id: string;
  tenantId: string;
  name: string;
  unit: UnidadeEstoque;
  instructions: string;        // modo de preparo resumido (legado / opcional)
  steps: ProductionRecipeStep[];
  items: ProductionRecipeItem[];
  isActive: boolean;
  createdAt: string;
  /** Categoria do produto semi-acabado no estoque */
  category?: string;
  /** Quantidade minima de estoque para o produto semi-acabado */
  minStock?: number;
  /** ID do ingrediente (semi-acabado) no estoque vinculado a esta ficha */
  outputIngredientId?: string;
}

export interface ProductionBatch {
  id: string;
  tenantId: string;
  recipeId: string;
  recipeName: string;
  producedQuantity: number;  // quantidade produzida
  unit: UnidadeEstoque;
  yieldPercentActual: number | null;  // calculado automaticamente ou null se nao aplicavel
  /** Rendimento esperado baseado na ficha (para comparacao) */
  yieldPercentExpected: number | null;
  totalCost: number;           // custo total dos insumos usados
  unitCost: number;            // custo unitario do produto gerado
  producedBy: string;          // nome do operador
  producedAt: string;
  notes: string;
  stepsCompleted: string[];    // ids dos passos que foram marcados como concluidos
  /** Quantidade total de perda em kg */
  lossQuantityKg: number | null;
  /** Valor da perda em reais */
  lossValue: number | null;
  items: Array<{
    ingredientId: string;
    ingredientName: string;
    quantityUsed: number;
    unit: string;
    unitCost: number;
    totalCost: number;
  }>;
}
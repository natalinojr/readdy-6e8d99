// ─── Cost Centers ─────────────────────────────────────────────────────────────
export interface CostCenter {
  id: string;
  tenant_id: string;
  name: string;
  color: string;
  icon: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ─── Suppliers ────────────────────────────────────────────────────────────────
export interface Supplier {
  id: string;
  tenant_id: string;
  name: string;
  cnpj?: string;
  phone?: string;
  email?: string;
  address?: string;
  category?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ─── DRE Categories ───────────────────────────────────────────────────────────
export type DREGroupType = 'revenue' | 'cost' | 'expense' | 'tax';

export interface DRECategory {
  id: string;
  tenant_id: string;
  group_type: DREGroupType;
  name: string;
  sort_order: number;
  cost_center_id?: string;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

// ─── Cash Flow ────────────────────────────────────────────────────────────────
export type CashFlowType = 'income' | 'expense';
export type CashFlowOrigin = 'manual' | 'auto_sale' | 'auto_purchase' | 'auto_sangria' | 'auto_anticipation';

export interface CashFlowEntry {
  id: string;
  tenant_id: string;
  type: CashFlowType;
  amount: number;
  description: string;
  category: string;
  cost_center_id?: string;
  origin: CashFlowOrigin;
  reference_id?: string;
  date: string;
  notes?: string;
  created_at: string;
  cost_center?: CostCenter;
  payment_method_id?: string;
}

// ─── Bills Payable ────────────────────────────────────────────────────────────
export type BillStatus = 'pending' | 'paid' | 'overdue' | 'partial';

export interface BillPayable {
  id: string;
  tenant_id: string;
  supplier?: string;
  description: string;
  category: string;
  cost_center_id?: string;
  amount: number;
  due_date: string;
  paid_date?: string;
  paid_amount?: number;
  payment_method?: string;
  status: BillStatus;
  is_recurring: boolean;
  installments?: number;
  installment_number?: number;
  parent_id?: string;
  notes?: string;
  reference_id?: string;
  reference_type?: 'purchase' | 'manual' | 'recurring' | 'hr_payroll';
  created_at: string;
  updated_at: string;
  cost_center?: CostCenter;
  // Confirmação de recebimento da mercadoria
  delivery_confirmed?: boolean;
  delivery_confirmed_at?: string | null;
}

// ─── Purchases ────────────────────────────────────────────────────────────────
export type PurchaseStatus = 'paid' | 'pending' | 'partial';

export interface PurchaseItem {
  id: string;
  purchase_id: string;
  tenant_id: string;
  ingredient_id?: string;
  description: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  unit_label?: string;          // ex: 'fardo', 'caixa', 'kg', 'un'
  units_per_package?: number;   // ex: 12 (unidades por fardo)
  cost_center_id?: string;      // centro de custo por item
  freight_allocated?: number;   // frete rateado neste item
  ingredient?: { id: string; name: string; unit: string };
}

export interface Purchase {
  id: string;
  tenant_id: string;
  supplier: string;
  invoice_number?: string;
  cost_center_id?: string;
  total_amount: number;
  freight_amount?: number;      // valor do frete
  payment_method: string;
  payment_status: PurchaseStatus;
  purchase_date: string;
  due_date?: string;
  notes?: string;
  created_by?: string;
  created_at: string;
  items?: PurchaseItem[];
  cost_center?: CostCenter;
  // Confirmação de recebimento
  delivery_confirmed_at?: string | null;
  delivery_notes?: string | null;
}

// ─── Receivable Installments ──────────────────────────────────────────────────
export type InstallmentStatus = 'pending' | 'partial' | 'received';

export interface ReceivableInstallment {
  id: string;
  tenant_id: string;
  order_id?: string;
  installment_number: number;
  total_installments: number;
  amount: number;
  due_date?: string;
  received_at?: string;
  status: InstallmentStatus;
  created_at: string;
  // Campos de antecipação
  is_anticipated?: boolean;
  anticipation_id?: string;
  anticipated_at?: string;
  // Campos enriquecidos (join)
  order_number?: string | null;
  payment_method_name?: string | null;
}

// ─── Income Routing ───────────────────────────────────────────────────────────
// Roteamento automático de receita para contas bancárias
// source_type='payment_method' + source_id=payment_method_id → aplica em D+0
// source_type='origin' + source_id=canal → roteamento por canal de venda
export interface IncomeRouting {
  id: string;
  tenant_id: string;
  source_type: 'payment_method' | 'origin';
  source_id?: string;
  source_label: string;
  bank_account_id?: string;
  is_active: boolean;
  created_at?: string;
  updated_at?: string;
}

// ─── Anticipations ────────────────────────────────────────────────────────────
export interface Anticipation {
  id: string;
  tenant_id: string;
  gross_amount: number;
  fee_percent: number;
  net_amount: number;
  notes?: string;
  installment_ids?: string[];
  status?: 'active' | 'settled';
  settled_at?: string;
  created_by?: string;
  created_at: string;
  updated_at?: string;
}

// ─── Implementation ───────────────────────────────────────────────────────────
export type ColumnFieldType = 'text' | 'number' | 'date' | 'select';

export interface ImplementationColumn {
  id: string;
  tenant_id: string;
  name: string;
  field_type: ColumnFieldType;
  options: string[];
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at?: string;
}

export interface ImplementationCost {
  id: string;
  tenant_id: string;
  date: string;
  description: string;
  amount: number;
  custom_fields: Record<string, string | number>;
  created_at: string;
  updated_at?: string;
}

export interface InvestmentSettings {
  id?: string;
  tenant_id: string;
  inauguration_date?: string;
  total_investment: number;
  profit_distribution: ProfitDistribution[];
  created_at?: string;
  updated_at?: string;
}

export interface ProfitDistribution {
  name: string;
  percent: number;
}

// ─── DRE ─────────────────────────────────────────────────────────────────────
export interface DRELine {
  id: string;
  name: string;
  value: number;
  prevValue?: number;
  prevYearValue?: number;
  isTotal?: boolean;
  isSubtotal?: boolean;
  isNegative?: boolean;
  categoryId?: string;
}

export interface DREGroup {
  type: DREGroupType | 'subtotal';
  label: string;
  lines: DRELine[];
  total: number;
  prevTotal?: number;
}

// ─── Dashboard Metrics ────────────────────────────────────────────────────────
export interface FinanceiroDashboard {
  receitaHoje: number;
  receitaMes: number;
  ticketMedio: number;
  lucroEstimado: number;
  saldoCaixa: number;
  crescimentoMes: number;
  totalAPagar: number;
  totalAReceber: number;
  totalComprometido: number;
  contasVencendo: BillPayable[];
  receitaDiaria: { date: string; value: number }[];
  receitaPorPagamento: { name: string; value: number; color: string }[];
}

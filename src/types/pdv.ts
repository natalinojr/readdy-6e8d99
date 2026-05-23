// ─── Formas de Pagamento ──────────────────────────────────────────────────────

export interface FormaPagamento {
  id: string;
  nome: string;
  tipo: 'dinheiro' | 'credito' | 'debito' | 'pix' | 'vale';
  ativo: boolean;
  icone: string;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ─── Mesa (UI) ────────────────────────────────────────────────────────────────

export interface Mesa {
  id: string;
  numero: number;
  capacidade: number;
  status: 'livre' | 'ocupada' | 'reservada';
  clienteNome?: string;
  totalConsumo?: number;
  abertaEm?: string;
  abertaEmTimestamp?: number;
  garcomNome?: string;
  numeroPessoas?: number;
  deleted_at?: string | null;
}

export type OrigemPedido = 'caixa' | 'garcom' | 'mesa' | 'autoatendimento' | 'delivery';

// ─── Unidades de Item (order_item_units) ──────────────────────────────────────

export interface UnidadeItem {
  unidade: number;
  status: 'aguardando' | 'preparo' | 'pronto' | 'entregue';
  /** true quando o item não passa pela cozinha (sem estação de preparo) */
  semCozinha?: boolean;
  operadorCozinha?: string;
  ficouProntoEm?: string;
  entregueEm?: string;
  entregoPor?: string;
  _iniciadoPreparoTs?: string | null;
  _prontoTs?: string | null;
  _entregueTs?: string | null;
  _criadoTs?: string | null;
}

// ─── Detalhe de Item de Pedido ────────────────────────────────────────────────

export interface PedidoItemDetalhe {
  id: string;
  menuItemId?: string;
  nome: string;
  categoriaNome?: string;
  quantidade: number;
  preco: number;
  estacao: string;
  opcoes: string[];
  observacao?: string;
  unidades: UnidadeItem[];
}

// ─── Bill Splitting (table_session_participants) ──────────────────────────────

export type ParticipantStatus = 'pending' | 'partial' | 'paid';

export interface TableSessionParticipant {
  id: string;
  tenant_id: string;
  table_session_id: string;
  /** Nome do participante na divisão */
  name: string;
  seat_number?: number | null;
  customer_id?: string | null;
  amount_due: number;
  amount_paid: number;
  status: ParticipantStatus;
  created_at: string;
  updated_at: string;
}

// ─── Order Item Assignments (order_item_assignments) ─────────────────────────

export interface OrderItemAssignment {
  id: string;
  tenant_id: string;
  order_item_id: string;
  participant_id: string;
  units_assigned: number;
  amount_assigned: number;
  created_at: string;
}

// ─── Refunds (refunds) ────────────────────────────────────────────────────────

export type RefundReasonType =
  | 'customer_request'
  | 'wrong_order'
  | 'quality_issue'
  | 'long_wait'
  | 'item_unavailable'
  | 'billing_error'
  | 'other';

export type RefundMethod = 'same_method' | 'cash' | 'credit' | 'voucher';
export type RefundStatus = 'pending' | 'approved' | 'processed' | 'rejected';

export interface Refund {
  id: string;
  tenant_id: string;
  order_id: string;
  payment_id?: string | null;
  refund_amount: number;
  reason_type: RefundReasonType;
  notes?: string | null;
  refund_method: RefundMethod;
  restock_items: boolean;
  requested_by: string;
  approved_by?: string | null;
  approved_at?: string | null;
  status: RefundStatus;
  processed_at?: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Order Discounts (order_discounts) ───────────────────────────────────────

export type OrderDiscountType =
  | 'manual_percent'
  | 'manual_value'
  | 'coupon'
  | 'loyalty'
  | 'promotion'
  | 'manager_override';

export interface OrderDiscount {
  id: string;
  tenant_id: string;
  order_id: string;
  discount_type: OrderDiscountType;
  /** Valor absoluto já calculado */
  discount_value: number;
  original_percent?: number | null;
  coupon_code?: string | null;
  promotion_id?: string | null;
  requires_approval: boolean;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_notes?: string | null;
  applied_by: string;
  reason?: string | null;
  created_at: string;
}

// ─── Payments (payments) ──────────────────────────────────────────────────────

export interface Payment {
  id: string;
  tenant_id: string;
  order_id: string | null;
  table_session_id: string | null;
  cash_register_id: string | null;
  payment_method_id: string | null;
  participant_id: string | null;
  /** Voucher usado neste pagamento */
  voucher_id: string | null;
  amount: number;
  change_amount: number;
  is_refunded: boolean;
  created_at: string;
}

// ─── Pedido Recente (UI) ──────────────────────────────────────────────────────

export interface PagamentoPedido {
  id: string;
  amount: number;
  change_amount: number;
  is_refunded: boolean;
  payment_method_name: string | null;
  /** Tipo da forma de pagamento: 'dinheiro' | 'credito' | 'debito' | 'pix' | 'vale' */
  payment_method_type?: string | null;
  /** Operador que registrou o pagamento */
  operator_name?: string | null;
  /** Nome do PDV/caixa que registrou */
  cash_register_name?: string | null;
  /** ID do caixa que registrou */
  cash_register_id?: string | null;
  /** Origin type do pedido — indica o canal onde o pagamento foi registrado */
  origin_type?: string | null;
  /** PDV de origem: 'cashier' | 'waiter' | 'table' | 'self_service' | etc. */
  paid_by_pdv?: string | null;
}

export type PedidoStatus =
  | 'aberto'
  | 'pronto'
  | 'entregue'
  | 'cancelado'
  | 'new'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'cancelled';

export interface PedidoRecente {
  deliveryPlatform?: string | null;
  deliveryFee?: number | null;
  id: string;
  numero: number;
  numeroCodigo?: string;
  /** Full formatted number string e.g. "P060426001" — mirrors KDSPedido.numeroStr */
  numeroStr?: string;
  /** KDS-level pedido status — kept in sync with KDSContext, used for accurate badge labels */
  kdsStatus?: import('@/types/kds').KDSPedidoStatus;
  /** BUG 2.3: training mode — shows badge */
  isTraining?: boolean;
  destino: 'hora' | 'mesa' | 'delivery' | 'nome' | 'senha' | 'na_hora';
  mesaNumero?: number;
  nomeCliente?: string;
  senha?: string;
  status: PedidoStatus;
  pago?: boolean;
  total: number;
  criadoEm: string;
  dataPedido?: string;
  minutosAtras: number;
  itensProntos: number;
  itensTotal: number;
  origem: OrigemPedido;
  garcomNome?: string;
  tempoAberto?: number;
  itensDetalhes: PedidoItemDetalhe[];
  slaEspera?: number;
  slaCozinha?: number;
  slaEntrega?: number;
  slaAlvo?: number;
  atrasado?: boolean;
  cancelReason?: string;
  desconto?: number;
  subtotal?: number;
  serviceFee?: number;
  tipAmount?: number;
  pagamentos?: PagamentoPedido[];
  /** Timestamp ISO do momento em que o pedido foi criado — usado para SLA em tempo real */
  _criadoTs?: string | null;
  /** Timestamp ISO do primeiro item que iniciou preparo — fase "Espera" ao vivo */
  _iniciouPreparoTs?: string | null;
  /** Timestamp ISO do primeiro item que ficou pronto — fase "Cozinha" ao vivo */
  _ficouProntoTs?: string | null;
  /** Timestamp ISO do momento de entrega do pedido — para TempoCell parar de contar */
  _entregueTs?: string | null;
  session_id?: string | null;
}

// ─── Table Session ────────────────────────────────────────────────────────────

export type TableSessionStatus = 'open' | 'closed' | 'cancelled';

export interface TableSession {
  id: string;
  tenant_id: string;
  table_id: string | null;
  session_id: string | null;
  customer_name: string | null;
  status: TableSessionStatus;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Cash Register ────────────────────────────────────────────────────────────

export type CashRegisterStatus = 'open' | 'closed';

export interface CashRegister {
  id: string;
  tenant_id: string;
  session_id: string;
  operator_id: string;
  opening_value: number;
  closing_value_actual?: number | null;
  opening_method: string;
  status: CashRegisterStatus;
  opened_at: string;
  closed_at?: string | null;
  created_at: string;
}

export type CashMovementType = 'out' | 'in';

export interface CashMovement {
  id: string;
  tenant_id: string;
  cash_register_id: string;
  type: CashMovementType;
  amount: number;
  reason: string | null;
  operator_id: string | null;
  created_at: string;
}

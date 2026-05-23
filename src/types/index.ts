/**
 * Barrel export de todos os tipos do projeto ERPOS V2.
 * Importe de '@/types' para acessar qualquer tipo.
 */

// ── Cardápio ──────────────────────────────────────────────────────────────────
export type {
  Categoria,
  OpcaoItem,
  GrupoOpcoes,
  PromocaoItem,
  FichaTecnicaItem,
  SubproducaoItem,
  ConfiguracaoDelivery,
  Item,
  ComboItem,
  Combo,
  ObservacaoGlobal,
  ComboIngredient,
  MenuItem,
  MenuCategory,
  OptionGroup,
  Option,
  GlobalObservation,
  ItemPresetObservation,
} from './cardapio';

// ── Clientes & Fidelidade ─────────────────────────────────────────────────────
export type {
  LoyaltyTier,
  LoyaltyTransactionType,
  Customer,
  LoyaltyTransaction,
  ClienteUI,
} from './clientes';

// ── Configurações ─────────────────────────────────────────────────────────────
export type {
  VisaoCozinha,
  ConfigOperacao,
  PDVTerminalId,
  PDVTerminal,
  OrigemPedido as OrigemPedidoConfig,
} from './configuracoes';

// ── Estoque ───────────────────────────────────────────────────────────────────
export type {
  UnidadeEstoque,
  Ingredient,
  IngredientCategory,
  IngredientBatchStatus,
  ExpiryAlertLevel,
  IngredientBatch,
  IngredientExpiryAlert,
  StockMovementType,
  StockMovement,
  Movimentacao,
  InventarioItemContado,
  InventarioSession,
} from './estoque';

// ── Financeiro ────────────────────────────────────────────────────────────────
export type {
  CostCenter,
  Supplier,
  DREGroupType,
  DRECategory,
  CashFlowType,
  CashFlowOrigin,
  CashFlowEntry,
  BillStatus,
  BillPayable,
  PurchaseStatus,
  PurchaseItem,
  Purchase,
  InstallmentStatus,
  ReceivableInstallment,
  Anticipation,
  ColumnFieldType,
  ImplementationColumn,
  ImplementationCost,
  InvestmentSettings,
  ProfitDistribution,
  DRELine,
  DREGroup,
  FinanceiroDashboard,
} from './financeiro';

// ── KDS ───────────────────────────────────────────────────────────────────────
export type {
  KDSItemStatus,
  KDSPedidoStatus,
  KDSOrigem,
  KDSItemOpcao,
  KDSSubParte,
  KDSUnidade,
  KDSItem,
  KDSPedido,
} from './kds';

// ── Mesa (cliente QR) ─────────────────────────────────────────────────────────
export type {
  ItemCardapioPublico,
  ItemPedidoCliente,
} from './mesaCliente';

// ── PDV ───────────────────────────────────────────────────────────────────────
export type {
  FormaPagamento,
  Mesa,
  OrigemPedido,
  UnidadeItem,
  PedidoItemDetalhe,
  ParticipantStatus,
  TableSessionParticipant,
  OrderItemAssignment,
  RefundReasonType,
  RefundMethod,
  RefundStatus,
  Refund,
  OrderDiscountType,
  OrderDiscount,
  Payment,
  PagamentoPedido,
  PedidoStatus,
  PedidoRecente,
  TableSessionStatus,
  TableSession,
  CashRegisterStatus,
  CashRegister,
  CashMovementType,
  CashMovement,
} from './pdv';

// ── Promoções ─────────────────────────────────────────────────────────────────
export type {
  PromoType,
  PromotionChannels,
  PromotionChannel,
  PromotionRule,
  AppliedPromotion,
  OrderItemForPromotion,
  ApplyPromotionsPayload,
  CreatePromotionRulePayload,
  UpdatePromotionRulePayload,
  DeletePromotionRulePayload,
  ListPromotionRulesPayload,
} from './promotions';

// ── Reservas de Mesa ──────────────────────────────────────────────────────────
export type {
  ReservationStatus,
  ReservationOccasion,
  TableReservation,
  TableAvailability,
  CreateReservationPayload,
  ConfirmReservationPayload,
  SeatReservationPayload,
  CancelReservationPayload,
  ListReservationsPayload,
} from './reservations';

// ── Vouchers & Gift Cards ─────────────────────────────────────────────────────
export type {
  VoucherType,
  VoucherStatus,
  VoucherDiscountType,
  VoucherTransactionType,
  Voucher,
  VoucherTransaction,
  IssueVoucherPayload,
  ValidateVoucherPayload,
  ValidateVoucherResult,
  RedeemVoucherPayload,
  RedeemVoucherResult,
  CancelVoucherPayload,
  ListVouchersPayload,
  GetVoucherTransactionsPayload,
} from './vouchers';

// ── RPC / Supabase raw rows ───────────────────────────────────────────────────
export type {
  RPCSessionRow,
  RPCRevenueRow,
  RPCSessionOrderRow,
  RPCCustomerOrderRow,
  RPCCustomerOrderPreviousRow,
  RPCOrderRow,
  RPCOrderItemRow,
  RPCOrderItemOptionRow,
  RPCOrderItemObservationRow,
  RPCOrderItemUnitRow,
  RPCPaymentRow,
  RPCOrderDiscountRow,
  RPCUserRow,
  RPCStationRow,
  RPCVoucherRow,
  RPCReservationRow,
  RPCPromotionRuleRow,
} from './rpc';

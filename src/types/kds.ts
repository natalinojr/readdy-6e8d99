// KDS types — used throughout the system

export type KDSItemStatus = 'novo' | 'preparo' | 'pronto' | 'entregue';
export type KDSPedidoStatus = 'novo' | 'preparo' | 'pronto' | 'em_rota' | 'entregue';
export type KDSOrigem = 'caixa' | 'garcom' | 'mesa' | 'autoatendimento' | 'delivery';

export interface KDSItemOpcao {
  grupoNome: string;
  opcaoNome: string;
  /** BUG 3.2 FIX: preço adicional da opção — ex: "Queijo extra (+R$ 3,00)" */
  additional_price?: number;
}

export interface KDSSubParte {
  id: string;
  nome: string;
  estacao: string;
  slaMinutos: number;
  status: KDSItemStatus;
  iniciouPreparoEm?: number;
  ficouProntoEm?: number;
  entregueEm?: number;
  operadorPreparo?: string;
}

/** Represents an individual unit of an item with quantity > 1 */
export interface KDSUnidade {
  id: string;
  numero: number;
  status: KDSItemStatus;
  operadorPreparo?: string;
  iniciouPreparoEm?: number;
  ficouProntoEm?: number;
  entregueEm?: number;
  quemEntregou?: string;
  /** Observação específica desta unidade (ex: salva como "Un.1: sem cebola") */
  observacao?: string;
}

/** Combo child item — displayed indented below the parent in KDS */
export interface KDSComboChild {
  /** combo_items.item_name or menu_items.name */
  nome: string;
  quantidade: number;
  /** Unit price of this child item, if relevant */
  unitPrice?: number;
}

export interface KDSItem {
  id: string;
  /** Reference to menu_items.id — needed for ficha técnica / stock deduction lookups */
  menuItemId?: string;
  nome: string;
  /** Category name for display in cards */
  categoriaNome?: string;
  quantidade: number;
  estacao: string;
  slaMinutos: number;
  status: KDSItemStatus;
  /** When true, item skips preparation and enters as READY (e.g., soda, water) */
  semPreparo?: boolean;
  skip_kds?: boolean;
  /** BUG 3.3: combo ID — when set, comboChildren contains the decomposed combo items */
  comboId?: string;
  /** BUG 3.3: decomposed combo items to show indented in KDS */
  comboChildren?: KDSComboChild[];
  opcoes: KDSItemOpcao[];
  observacoes: string[];
  /** Free-text observation added by the KDS operator */
  observacaoLivre?: string;
  entroKdsEm: number;
  iniciouPreparoEm?: number;
  ficouProntoEm?: number;
  entregueEm?: number;
  operadorPreparo?: string;
  quemEntregou?: string;
  partes?: KDSSubParte[];
  observacoesChecadas?: string[];
  unidades?: KDSUnidade[];
  /** Unit price — populated from DB, used in receipt/panel views */
  item_price?: number;
}

/** Single payment record attached to an order */
export interface KDSPagamento {
  id: string;
  amount: number;
  change_amount: number;
  is_refunded: boolean;
  payment_method_id: string | null;
  payment_method_name: string | null;
  operator_name?: string | null;
  cash_register_id?: string | null;
  cash_register_name?: string | null;
  /** Origin type of the order when the payment was registered */
  origin_type?: string | null;
}

export interface KDSPedido {
  id: string;
  numero: number;
  /** Full formatted number string e.g. "P060426001" */
  numeroStr?: string;
  /** BUG 3.8: customer CPF — optional */
  customerCpf?: string;
  /** BUG 3.8: customer email — optional */
  customerEmail?: string;
  /** BUG 3.8: customer phone — optional */
  customerPhone?: string;
  status: KDSPedidoStatus;
  destino: 'hora' | 'mesa' | 'nome' | 'senha' | 'delivery';
  mesaNumero?: number;
  nomeCliente?: string;
  senha?: string;
  itens: KDSItem[];
  criadoEm: number;
  origem: KDSOrigem;
  garcomNome?: string;
  /** Total order amount — populated from DB */
  totalAmount: number;
  /** Whether the order has been paid */
  isPaid: boolean;
  /** Whether the order was cancelled */
  isCancelled: boolean;
  /** Cancellation reason if cancelled */
  cancelReason?: string;
  /** Payment method name — populated for kiosk orders with "pay on delivery" */
  paymentMethodName?: string;
  /** BUG 2.3: Training mode flag — populated from orders.is_training */
  isTraining?: boolean;
  /** BUG 3.4: All payments for this order — used for split payment display */
  pagamentos?: KDSPagamento[];
}

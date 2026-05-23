/**
 * Tipos relacionados a clientes e programa de fidelidade.
 * Convenção: snake_case para campos que espelham o banco, camelCase para campos de UI.
 */

export type LoyaltyTier = 'bronze' | 'prata' | 'ouro' | 'vip';

export type LoyaltyTransactionType =
  | 'earned'      // pontos ganhos por compra (1 ponto por R$1,00)
  | 'redeemed'    // pontos resgatados
  | 'expired'     // pontos expirados por inatividade
  | 'manual_add'  // adição manual pelo gerente
  | 'manual_sub'; // subtração manual pelo gerente

// ─── Customer ─────────────────────────────────────────────────────────────────

export interface Customer {
  id: string;
  tenant_id: string;

  name: string;
  phone?: string | null;
  email?: string | null;
  /** CPF para nota fiscal */
  cpf?: string | null;
  birthday?: string | null;

  address?: string | null;
  neighborhood?: string | null;
  city?: string | null;

  /** Observações internas do estabelecimento */
  notes?: string | null;

  // ─── Histórico de compras ─────────────────────────────────────────────
  total_spent?: number | null;
  visit_count?: number;
  average_ticket?: number | null;
  first_visit_at?: string | null;
  last_visit_at?: string | null;

  // ─── Fidelidade ───────────────────────────────────────────────────────
  loyalty_points: number;
  loyalty_tier: LoyaltyTier;

  // ─── Consentimento (LGPD) ─────────────────────────────────────────────
  accepts_marketing: boolean;
  gdpr_consent_at?: string | null;

  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
}

// ─── LoyaltyTransaction ───────────────────────────────────────────────────────

export interface LoyaltyTransaction {
  id: string;
  tenant_id: string;
  customer_id: string;
  transaction_type: LoyaltyTransactionType;
  /** Valor de pontos da transação (positivo = crédito, negativo = débito) */
  points: number;
  /** Saldo do cliente após esta transação */
  balance_after: number;
  /** Pedido que gerou/usou os pontos (quando aplicável) */
  order_id?: string | null;
  notes?: string | null;
  created_by?: string | null;
  created_at: string;
}

// ─── Tipos de UI (camelCase) ──────────────────────────────────────────────────

/** Shape usado nas listagens de clientes no frontend */
export interface ClienteUI {
  id: string;
  nome: string;
  telefone: string;
  email?: string;
  totalGasto: number;
  totalVisitas: number;
  ticketMedio: number;
  ultimaVisita?: string;
  pontosFidelidade: number;
  nivelFidelidade: LoyaltyTier;
  aceitaMarketing: boolean;
}

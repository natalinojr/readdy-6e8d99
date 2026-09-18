/**
 * printAgents.ts
 * Lógica pura de status do agente de impressão remoto e alertas por loja.
 * Sem chamadas de rede — apenas cálculo a partir dos dados já carregados.
 */

export const AGENT_ONLINE_THRESHOLD_MS = 120_000;

export type AgentStatus = 'revogado' | 'aguardando' | 'online' | 'offline';

export interface PrintAgentRow {
  id: string;
  apelido: string;
  version: string | null;
  last_seen_at: string | null;
  last_ticket_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  created_at: string;
  revoked_at: string | null;
  tenant_ids: string[];
}

export interface PrintAgentStoreRow {
  tenant_id: string;
  name: string;
  agent_id: string | null;
  require_print_agent_token: boolean;
}

/**
 * Deriva o status do agente: revogado > aguardando (nunca sinalizou) >
 * online (último sinal há menos de AGENT_ONLINE_THRESHOLD_MS) > offline.
 */
export function agentStatus(
  a: Pick<PrintAgentRow, 'revoked_at' | 'last_seen_at'>,
  nowMs: number
): AgentStatus {
  if (a.revoked_at) return 'revogado';
  if (!a.last_seen_at) return 'aguardando';
  const elapsed = nowMs - new Date(a.last_seen_at).getTime();
  return elapsed < AGENT_ONLINE_THRESHOLD_MS ? 'online' : 'offline';
}

/**
 * Deriva o alerta de uma loja em relação ao seu agente de impressão vinculado.
 */
export function storeWarning(
  s: PrintAgentStoreRow,
  agents: PrintAgentRow[],
  nowMs: number
): 'bloqueada_sem_agente' | 'agente_offline' | null {
  if (!s.agent_id) {
    return s.require_print_agent_token ? 'bloqueada_sem_agente' : null;
  }
  const agent = agents.find((a) => a.id === s.agent_id);
  if (!agent || agentStatus(agent, nowMs) !== 'online') {
    return 'agente_offline';
  }
  return null;
}

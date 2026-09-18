import { describe, it, expect } from 'vitest';
import {
  agentStatus,
  storeWarning,
  AGENT_ONLINE_THRESHOLD_MS,
  type PrintAgentRow,
  type PrintAgentStoreRow,
} from '@/lib/printAgents';

const NOW = 1_700_000_000_000;

function makeAgent(overrides: Partial<PrintAgentRow> = {}): PrintAgentRow {
  return {
    id: 'agent-1',
    apelido: 'Caixa 1',
    version: '2.57.4',
    last_seen_at: null,
    last_ticket_at: null,
    last_error: null,
    last_error_at: null,
    created_at: new Date(NOW).toISOString(),
    revoked_at: null,
    tenant_ids: ['tenant-1'],
    ...overrides,
  };
}

describe('agentStatus', () => {
  it('revogado tem prioridade sobre qualquer outro estado', () => {
    const a = makeAgent({
      revoked_at: new Date(NOW).toISOString(),
      last_seen_at: new Date(NOW).toISOString(),
    });
    expect(agentStatus(a, NOW)).toBe('revogado');
  });

  it('aguardando quando last_seen_at é null e não está revogado', () => {
    const a = makeAgent({ last_seen_at: null });
    expect(agentStatus(a, NOW)).toBe('aguardando');
  });

  it('online no limite exato de 119999ms desde o último sinal', () => {
    const a = makeAgent({ last_seen_at: new Date(NOW - 119999).toISOString() });
    expect(agentStatus(a, NOW)).toBe('online');
  });

  it('offline no limite exato de 120000ms desde o último sinal', () => {
    const a = makeAgent({ last_seen_at: new Date(NOW - AGENT_ONLINE_THRESHOLD_MS).toISOString() });
    expect(agentStatus(a, NOW)).toBe('offline');
  });

  it('offline bem além do limite', () => {
    const a = makeAgent({ last_seen_at: new Date(NOW - 600_000).toISOString() });
    expect(agentStatus(a, NOW)).toBe('offline');
  });
});

describe('storeWarning', () => {
  it('bloqueada_sem_agente quando não há agente vinculado e o token é exigido', () => {
    const store: PrintAgentStoreRow = {
      tenant_id: 't1',
      name: 'Loja 1',
      agent_id: null,
      require_print_agent_token: true,
    };
    expect(storeWarning(store, [], NOW)).toBe('bloqueada_sem_agente');
  });

  it('null quando não há agente vinculado mas o token não é exigido', () => {
    const store: PrintAgentStoreRow = {
      tenant_id: 't1',
      name: 'Loja 1',
      agent_id: null,
      require_print_agent_token: false,
    };
    expect(storeWarning(store, [], NOW)).toBeNull();
  });

  it('agente_offline quando o agente vinculado não está online', () => {
    const agent = makeAgent({ id: 'a1', last_seen_at: new Date(NOW - 600_000).toISOString() });
    const store: PrintAgentStoreRow = {
      tenant_id: 't1',
      name: 'Loja 1',
      agent_id: 'a1',
      require_print_agent_token: true,
    };
    expect(storeWarning(store, [agent], NOW)).toBe('agente_offline');
  });

  it('null quando o agente vinculado está online', () => {
    const agent = makeAgent({ id: 'a1', last_seen_at: new Date(NOW - 1000).toISOString() });
    const store: PrintAgentStoreRow = {
      tenant_id: 't1',
      name: 'Loja 1',
      agent_id: 'a1',
      require_print_agent_token: false,
    };
    expect(storeWarning(store, [agent], NOW)).toBeNull();
  });
});

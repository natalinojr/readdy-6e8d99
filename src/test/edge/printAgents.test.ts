// @vitest-environment node
// _shared/print-agents.ts: token de agente de impressão remoto (RF-01/02/06/07/08).
// Módulo puro (só Web APIs) — precisa rodar em Deno (Edge) e em Node 20 (vitest).
import { describe, it, expect } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// Import por caminho montado em tempo de execução: o tsc do app não passa a checar código Deno.
const MOD_PATH = pathToFileURL(resolve(__dirname, '../../../supabase/functions/_shared/print-agents.ts')).href;

type AgentAuth = { mode: 'anon' } | { mode: 'token'; token: string } | { mode: 'token-invalid' };
type AgentRemoteConfig = {
  agent_id: string;
  apelido: string;
  tenant_ids: string[];
  supabase_anon_key: string;
  print_queue_enabled: true;
  polling_enabled: true;
  poll_interval_ms: 3000;
  realtime_enabled: true;
  realtime_debounce_ms: 250;
  safety_poll_interval_ms: 60000;
  realtime_watchdog_ms: 60000;
  config_refresh_ms: 60000;
};

type Mod = {
  AGENT_TOKEN_PREFIX: string;
  HEARTBEAT_MIN_INTERVAL_MS: number;
  AGENT_CONFIG_DEFAULTS: Record<string, unknown>;
  generateAgentToken: () => string;
  isWellFormedAgentToken: (t: unknown) => t is string;
  hashAgentToken: (token: string) => Promise<string>;
  readAgentAuth: (headers: Headers) => AgentAuth;
  decidePoll: (i: {
    mode: 'anon' | 'token';
    callerAgentId: string | null;
    assignedAgentId: string | null;
    requireToken: boolean;
  }) => 'serve' | 'empty_assigned' | 'empty_require_token' | 'forbidden';
  decideConfirm: (i: {
    mode: 'anon' | 'token';
    callerAgentId: string | null;
    assignedAgentId: string | null;
  }) => 'ok' | 'forbidden';
  buildAgentConfig: (i: { agentId: string; apelido: string; tenantIds: string[]; anonKey: string }) => AgentRemoteConfig;
  shouldHeartbeat: (lastSeenIso: string | null, nowMs: number) => boolean;
  sanitizeVersion: (v: unknown) => string | null;
  truncateError: (s: unknown, max?: number) => string | null;
};
const load = () => import(/* @vite-ignore */ MOD_PATH) as Promise<Mod>;

describe('generateAgentToken', () => {
  it('gera token com prefixo epa_ e 47 caracteres', async () => {
    const m = await load();
    const t = m.generateAgentToken();
    expect(t.startsWith('epa_')).toBe(true);
    expect(t.length).toBe(47);
    expect(m.isWellFormedAgentToken(t)).toBe(true);
  });

  it('gera tokens distintos a cada chamada', async () => {
    const m = await load();
    const a = m.generateAgentToken();
    const b = m.generateAgentToken();
    expect(a).not.toBe(b);
  });
});

describe('isWellFormedAgentToken', () => {
  it('aceita formato válido e rejeita malformados', async () => {
    const m = await load();
    expect(m.isWellFormedAgentToken('epa_' + 'a'.repeat(43))).toBe(true);
    expect(m.isWellFormedAgentToken('epa_' + 'a'.repeat(42))).toBe(false); // curto
    expect(m.isWellFormedAgentToken('epa_' + 'a'.repeat(44))).toBe(false); // longo
    expect(m.isWellFormedAgentToken('xyz_' + 'a'.repeat(43))).toBe(false); // prefixo errado
    expect(m.isWellFormedAgentToken('epa_' + '!'.repeat(43))).toBe(false); // char inválido
    expect(m.isWellFormedAgentToken(undefined)).toBe(false);
    expect(m.isWellFormedAgentToken(123)).toBe(false);
    expect(m.isWellFormedAgentToken('')).toBe(false);
  });
});

describe('hashAgentToken', () => {
  it('gera sha256 hex minúsculo de 64 chars, conhecido para "epa_x"', async () => {
    const m = await load();
    const hash = await m.hashAgentToken('epa_x');
    expect(hash).toBe('c8cc5c1485e59c9bf9dcc2603690efe7a85ad8f480ad4e30c4985309ca60a449'.slice(0, 64));
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hash é diferente do token original', async () => {
    const m = await load();
    const hash = await m.hashAgentToken('epa_x');
    expect(hash).not.toBe('epa_x');
  });

  it('tokens diferentes geram hashes diferentes', async () => {
    const m = await load();
    const h1 = await m.hashAgentToken('epa_a');
    const h2 = await m.hashAgentToken('epa_b');
    expect(h1).not.toBe(h2);
  });
});

describe('readAgentAuth', () => {
  it('sem header x-agent-token -> anon', async () => {
    const m = await load();
    expect(m.readAgentAuth(new Headers())).toEqual({ mode: 'anon' });
  });

  it('header vazio -> anon', async () => {
    const m = await load();
    const h = new Headers();
    h.set('x-agent-token', '');
    expect(m.readAgentAuth(h)).toEqual({ mode: 'anon' });
  });

  it('header malformado -> token-invalid', async () => {
    const m = await load();
    const h = new Headers();
    h.set('x-agent-token', 'lixo-nao-token');
    expect(m.readAgentAuth(h)).toEqual({ mode: 'token-invalid' });
  });

  it('header válido -> token', async () => {
    const m = await load();
    const token = 'epa_' + 'a'.repeat(43);
    const h = new Headers();
    h.set('x-agent-token', token);
    expect(m.readAgentAuth(h)).toEqual({ mode: 'token', token });
  });
});

describe('decidePoll', () => {
  it('token atribuído ao próprio agente -> serve', async () => {
    const m = await load();
    expect(
      m.decidePoll({ mode: 'token', callerAgentId: 'ag1', assignedAgentId: 'ag1', requireToken: false }),
    ).toBe('serve');
  });

  it('token atribuído a outro agente -> forbidden', async () => {
    const m = await load();
    expect(
      m.decidePoll({ mode: 'token', callerAgentId: 'ag1', assignedAgentId: 'ag2', requireToken: false }),
    ).toBe('forbidden');
  });

  it('token sem fila atribuída (assignedAgentId null) -> forbidden', async () => {
    const m = await load();
    expect(
      m.decidePoll({ mode: 'token', callerAgentId: 'ag1', assignedAgentId: null, requireToken: false }),
    ).toBe('forbidden');
  });

  it('anon com fila atribuída a alguém -> empty_assigned', async () => {
    const m = await load();
    expect(
      m.decidePoll({ mode: 'anon', callerAgentId: null, assignedAgentId: 'ag1', requireToken: false }),
    ).toBe('empty_assigned');
    expect(
      m.decidePoll({ mode: 'anon', callerAgentId: null, assignedAgentId: 'ag1', requireToken: true }),
    ).toBe('empty_assigned');
  });

  it('anon sem fila atribuída + requireToken -> empty_require_token', async () => {
    const m = await load();
    expect(
      m.decidePoll({ mode: 'anon', callerAgentId: null, assignedAgentId: null, requireToken: true }),
    ).toBe('empty_require_token');
  });

  it('anon sem fila atribuída + sem exigir token -> serve', async () => {
    const m = await load();
    expect(
      m.decidePoll({ mode: 'anon', callerAgentId: null, assignedAgentId: null, requireToken: false }),
    ).toBe('serve');
  });
});

describe('decideConfirm', () => {
  it('anon sempre ok (RF-08: retrocompat)', async () => {
    const m = await load();
    expect(m.decideConfirm({ mode: 'anon', callerAgentId: null, assignedAgentId: null })).toBe('ok');
    expect(m.decideConfirm({ mode: 'anon', callerAgentId: null, assignedAgentId: 'ag1' })).toBe('ok');
  });

  it('token do dono do job -> ok', async () => {
    const m = await load();
    expect(m.decideConfirm({ mode: 'token', callerAgentId: 'ag1', assignedAgentId: 'ag1' })).toBe('ok');
  });

  it('token de outro agente -> forbidden', async () => {
    const m = await load();
    expect(m.decideConfirm({ mode: 'token', callerAgentId: 'ag1', assignedAgentId: 'ag2' })).toBe('forbidden');
  });

  it('token sem assignedAgentId -> forbidden', async () => {
    const m = await load();
    expect(m.decideConfirm({ mode: 'token', callerAgentId: 'ag1', assignedAgentId: null })).toBe('forbidden');
  });
});

describe('buildAgentConfig', () => {
  it('preenche defaults e dados do agente', async () => {
    const m = await load();
    const cfg = m.buildAgentConfig({ agentId: 'ag1', apelido: 'Caixa 1', tenantIds: ['t1'], anonKey: 'key' });
    expect(cfg.agent_id).toBe('ag1');
    expect(cfg.apelido).toBe('Caixa 1');
    expect(cfg.tenant_ids).toEqual(['t1']);
    expect(cfg.supabase_anon_key).toBe('key');
    expect(cfg.print_queue_enabled).toBe(true);
    expect(cfg.polling_enabled).toBe(true);
    expect(cfg.poll_interval_ms).toBe(3000);
    expect(cfg.realtime_enabled).toBe(true);
    expect(cfg.realtime_debounce_ms).toBe(250);
    expect(cfg.safety_poll_interval_ms).toBe(60000);
    expect(cfg.realtime_watchdog_ms).toBe(60000);
    expect(cfg.config_refresh_ms).toBe(60000);
  });

  it('dedup e ordena tenant_ids', async () => {
    const m = await load();
    const cfg = m.buildAgentConfig({ agentId: 'ag1', apelido: 'X', tenantIds: ['b', 'a', 'b', 'c'], anonKey: 'k' });
    expect(cfg.tenant_ids).toEqual(['a', 'b', 'c']);
  });
});

describe('shouldHeartbeat', () => {
  it('lastSeenIso null -> true', async () => {
    const m = await load();
    expect(m.shouldHeartbeat(null, Date.now())).toBe(true);
  });

  it('29s atrás -> false (abaixo do mínimo)', async () => {
    const m = await load();
    const now = Date.parse('2026-09-18T12:00:29.000Z');
    const last = '2026-09-18T12:00:00.000Z';
    expect(m.shouldHeartbeat(last, now)).toBe(false);
  });

  it('30s atrás -> true (limite inclusivo)', async () => {
    const m = await load();
    const now = Date.parse('2026-09-18T12:00:30.000Z');
    const last = '2026-09-18T12:00:00.000Z';
    expect(m.shouldHeartbeat(last, now)).toBe(true);
  });
});

describe('sanitizeVersion', () => {
  it('aceita versão semver-like', async () => {
    const m = await load();
    expect(m.sanitizeVersion('2.57.4')).toBe('2.57.4');
    expect(m.sanitizeVersion('1.0.0-beta.1')).toBe('1.0.0-beta.1');
  });

  it('rejeita valores inválidos', async () => {
    const m = await load();
    expect(m.sanitizeVersion(undefined)).toBe(null);
    expect(m.sanitizeVersion(null)).toBe(null);
    expect(m.sanitizeVersion(123)).toBe(null);
    expect(m.sanitizeVersion('')).toBe(null);
    expect(m.sanitizeVersion('a'.repeat(33))).toBe(null);
    expect(m.sanitizeVersion('1.0.0; DROP TABLE')).toBe(null);
  });
});

describe('truncateError', () => {
  it('retorna null para valores vazios', async () => {
    const m = await load();
    expect(m.truncateError(undefined)).toBe(null);
    expect(m.truncateError(null)).toBe(null);
    expect(m.truncateError('')).toBe(null);
  });

  it('mantém string curta intacta', async () => {
    const m = await load();
    expect(m.truncateError('erro TCP')).toBe('erro TCP');
  });

  it('trunca no limite padrão de 500', async () => {
    const m = await load();
    const long = 'x'.repeat(600);
    const out = m.truncateError(long);
    expect(out?.length).toBe(500);
  });

  it('respeita max customizado', async () => {
    const m = await load();
    expect(m.truncateError('abcdefgh', 3)).toBe('abc');
  });

  it('converte valores não-string com String()', async () => {
    const m = await load();
    expect(m.truncateError(42)).toBe('42');
  });
});

// Regras puras do agente local (sem I/O, sem rede, sem fs).
// Usado pelo index.js do agente para decidir o modo de operação (token x anon)
// e para validar/mesclar configuração. Ver specs/2026-09-agente-impressao-remoto.

'use strict';

const AGENT_VERSION = '3.4.0';

const AGENT_TOKEN_RE = /^epa_[A-Za-z0-9_-]{43}$/;
const SUPABASE_URL_RE = /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/;

function isWellFormedAgentToken(token) {
  return typeof token === 'string' && AGENT_TOKEN_RE.test(token);
}

function isValidSupabaseUrl(url) {
  return typeof url === 'string' && SUPABASE_URL_RE.test(url);
}

function resolveMode(cfg) {
  cfg = cfg || {};
  if (typeof cfg.agent_token === 'string' && cfg.agent_token.trim() !== '') {
    return 'token';
  }
  const hasTenants =
    (Array.isArray(cfg.tenant_ids) && cfg.tenant_ids.length > 0) ||
    (typeof cfg.tenant_id === 'string' && cfg.tenant_id.trim() !== '');
  if (typeof cfg.supabase_anon_key === 'string' && cfg.supabase_anon_key.trim() !== '' && hasTenants) {
    return 'anon';
  }
  return 'none';
}

function buildMinimalConfig(opts) {
  opts = opts || {};
  const supabaseUrl = typeof opts.supabase_url === 'string' ? opts.supabase_url.replace(/\/+$/, '') : opts.supabase_url;
  if (!isValidSupabaseUrl(supabaseUrl)) {
    throw new Error('url_invalida');
  }
  if (!isWellFormedAgentToken(opts.agent_token)) {
    throw new Error('token_invalido');
  }
  let port = opts.agent_port === undefined || opts.agent_port === null ? 9876 : Number(opts.agent_port);
  if (!Number.isFinite(port) || !Number.isInteger(port) || port < 1024 || port > 65535) {
    throw new Error('porta_invalida');
  }
  return {
    supabase_url: supabaseUrl,
    agent_token: opts.agent_token,
    agent_port: port,
    print_queue_enabled: true,
  };
}

const REMOTE_FIELDS = [
  'tenant_ids',
  'supabase_anon_key',
  'polling_enabled',
  'poll_interval_ms',
  'realtime_enabled',
  'realtime_debounce_ms',
  'safety_poll_interval_ms',
  'realtime_watchdog_ms',
  'print_queue_enabled',
  'config_refresh_ms',
];

function applyRemoteConfig(localCfg, remote) {
  const result = Object.assign({}, localCfg || {});
  delete result.tenant_id;
  remote = remote || {};
  for (const field of REMOTE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(remote, field)) {
      result[field] = remote[field];
    }
  }
  return result;
}

function tenantsChanged(prev, next) {
  const prevSet = new Set(Array.isArray(prev) ? prev : []);
  const nextSet = new Set(Array.isArray(next) ? next : []);
  if (prevSet.size !== nextSet.size) return true;
  for (const id of prevSet) {
    if (!nextSet.has(id)) return true;
  }
  return false;
}

module.exports = {
  AGENT_VERSION,
  resolveMode,
  isWellFormedAgentToken,
  isValidSupabaseUrl,
  buildMinimalConfig,
  applyRemoteConfig,
  tenantsChanged,
};

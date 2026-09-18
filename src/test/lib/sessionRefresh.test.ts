import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// 2026-09-17: a sessão caía no meio do uso quando o refresh falhava por rede.
// Só "token inválido de verdade" pode deslogar; oscilação de rede mantém a sessão.

vi.mock('@/lib/errorReporter', () => ({ reportEdgeFailure: vi.fn() }));

type Mod = typeof import('@/lib/supabase');
let mod: Mod;

beforeEach(async () => {
  vi.stubEnv('VITE_PUBLIC_SUPABASE_URL', 'https://example.supabase.co');
  vi.stubEnv('VITE_PUBLIC_SUPABASE_ANON_KEY', 'anon-key-de-teste');
  mod = await vi.importActual<Mod>('@/lib/supabase');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('classificação do erro de refresh', () => {
  it('reconhece token realmente inválido', () => {
    for (const msg of [
      'Invalid Refresh Token: Refresh Token Not Found',
      'invalid refresh token: already used',
      'Token has been revoked',
      'Session not found',
    ]) {
      expect(mod.isRefreshTokenInvalidError(msg)).toBe(true);
    }
  });

  it('não confunde falha de rede com token inválido', () => {
    for (const msg of [
      'TypeError: Failed to fetch',
      'NetworkError when attempting to fetch resource.',
      'The operation was aborted due to timeout',
      'connect ECONNRESET',
    ]) {
      expect(mod.isRefreshTokenInvalidError(msg)).toBe(false);
      expect(mod.isTransientRefreshError(msg)).toBe(true);
    }
  });

  it('"jwt expired" sozinho é do access token (o refresh resolve), não desloga', () => {
    expect(mod.isRefreshTokenInvalidError('JWT expired')).toBe(false);
  });
});

describe('logout intencional', () => {
  it('a marca de logout pode ser lida e limpa', () => {
    mod.clearLogoutIntencional();
    expect(mod.isLogoutIntencional()).toBe(false);
  });
});

describe('classifyRefreshError (fail-safe)', () => {
  it('erro desconhecido do Auth desloga (usuário desativado não fica preso)', () => {
    expect(mod.classifyRefreshError({ message: 'User is banned', status: 400 })).toBe('invalid');
    expect(mod.classifyRefreshError({ message: 'invalid_grant', status: 400 })).toBe('invalid');
    expect(mod.classifyRefreshError({ message: 'algo novo que ninguém previu', status: 403 })).toBe('invalid');
  });

  it('rede, timeout, 5xx e 429 mantêm a sessão', () => {
    expect(mod.classifyRefreshError({ message: 'Failed to fetch', status: 0 })).toBe('transient');
    expect(mod.classifyRefreshError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe('transient');
    expect(mod.classifyRefreshError({ message: 'Bad Gateway', status: 502 })).toBe('transient');
    expect(mod.classifyRefreshError({ message: 'Too many requests', status: 429 })).toBe('transient');
    expect(mod.classifyRefreshError(new Error('The operation was aborted due to timeout'))).toBe('transient');
  });
});

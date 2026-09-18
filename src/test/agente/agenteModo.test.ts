// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const require = createRequire(import.meta.url);
const m = require(resolve(__dirname, '../../../agente-local/lib/modo.js'));

describe('agente-local/lib/modo.js', () => {
  it('expõe AGENT_VERSION 3.4.0', () => {
    expect(m.AGENT_VERSION).toBe('3.4.0');
  });

  describe('resolveMode', () => {
    it('retorna "token" quando agent_token é string não vazia (mesmo com anon presente)', () => {
      expect(
        m.resolveMode({
          agent_token: 'epa_abc',
          supabase_anon_key: 'anon-key',
          tenant_ids: ['t1'],
        })
      ).toBe('token');
    });

    it('retorna "token" quando só agent_token está presente', () => {
      expect(m.resolveMode({ agent_token: 'epa_abc' })).toBe('token');
    });

    it('ignora agent_token vazio ou só espaços', () => {
      expect(
        m.resolveMode({ agent_token: '   ', supabase_anon_key: 'anon', tenant_ids: ['t1'] })
      ).toBe('anon');
      expect(m.resolveMode({ agent_token: '' })).toBe('none');
    });

    it('retorna "anon" quando supabase_anon_key e tenant_ids não vazio', () => {
      expect(m.resolveMode({ supabase_anon_key: 'anon-key', tenant_ids: ['t1'] })).toBe('anon');
    });

    it('retorna "anon" quando supabase_anon_key e tenant_id (legado) presentes', () => {
      expect(m.resolveMode({ supabase_anon_key: 'anon-key', tenant_id: 't1' })).toBe('anon');
    });

    it('retorna "none" quando não há token nem anon válido', () => {
      expect(m.resolveMode({})).toBe('none');
      expect(m.resolveMode({ supabase_anon_key: 'anon-key', tenant_ids: [] })).toBe('none');
      expect(m.resolveMode({ supabase_anon_key: 'anon-key' })).toBe('none');
    });
  });

  describe('isWellFormedAgentToken', () => {
    const valid = 'epa_' + 'A'.repeat(43);

    it('aceita token bem formado (epa_ + 43 chars base64url)', () => {
      expect(m.isWellFormedAgentToken(valid)).toBe(true);
    });

    it('rejeita token sem prefixo, tamanho errado ou caracteres inválidos', () => {
      expect(m.isWellFormedAgentToken('abc_' + 'A'.repeat(43))).toBe(false);
      expect(m.isWellFormedAgentToken('epa_' + 'A'.repeat(42))).toBe(false);
      expect(m.isWellFormedAgentToken('epa_' + 'A'.repeat(43) + '!')).toBe(false);
      expect(m.isWellFormedAgentToken('')).toBe(false);
      expect(m.isWellFormedAgentToken(undefined)).toBe(false);
    });
  });

  describe('isValidSupabaseUrl', () => {
    it('aceita URL https no domínio supabase.co', () => {
      expect(m.isValidSupabaseUrl('https://mdghhjemzdmeuqpzuyzx.supabase.co')).toBe(true);
      expect(m.isValidSupabaseUrl('https://mdghhjemzdmeuqpzuyzx.supabase.co/')).toBe(true);
    });

    it('rejeita URL http, outro domínio ou vazia', () => {
      expect(m.isValidSupabaseUrl('http://mdghhjemzdmeuqpzuyzx.supabase.co')).toBe(false);
      expect(m.isValidSupabaseUrl('https://example.com')).toBe(false);
      expect(m.isValidSupabaseUrl('')).toBe(false);
      expect(m.isValidSupabaseUrl(undefined)).toBe(false);
    });
  });

  describe('buildMinimalConfig', () => {
    const url = 'https://mdghhjemzdmeuqpzuyzx.supabase.co';
    const token = 'epa_' + 'B'.repeat(43);

    it('caso feliz: monta config mínimo sem "/" final na URL e porta default', () => {
      const cfg = m.buildMinimalConfig({ supabase_url: url + '/', agent_token: token });
      expect(cfg).toEqual({
        supabase_url: url,
        agent_token: token,
        agent_port: 9876,
        print_queue_enabled: true,
      });
    });

    it('usa agent_port informado quando é número válido', () => {
      const cfg = m.buildMinimalConfig({ supabase_url: url, agent_token: token, agent_port: 9877 });
      expect(cfg.agent_port).toBe(9877);
    });

    it('lança url_invalida para URL fora do padrão', () => {
      expect(() =>
        m.buildMinimalConfig({ supabase_url: 'https://outro.com', agent_token: token })
      ).toThrow('url_invalida');
    });

    it('lança token_invalido para token mal formado', () => {
      expect(() => m.buildMinimalConfig({ supabase_url: url, agent_token: 'xyz' })).toThrow(
        'token_invalido'
      );
    });

    it('lança porta_invalida fora do intervalo 1024..65535', () => {
      expect(() =>
        m.buildMinimalConfig({ supabase_url: url, agent_token: token, agent_port: 80 })
      ).toThrow('porta_invalida');
      expect(() =>
        m.buildMinimalConfig({ supabase_url: url, agent_token: token, agent_port: 70000 })
      ).toThrow('porta_invalida');
    });
  });

  describe('applyRemoteConfig', () => {
    it('mescla campos remotos, descarta tenant_id legado e preserva locais', () => {
      const local = {
        agent_port: 9877,
        agent_token: 'epa_xxx',
        supabase_url: 'https://mdghhjemzdmeuqpzuyzx.supabase.co',
        impressoras: [{ nome: 'Cozinha', ip: '192.168.0.10' }],
        default_timeout_ms: 5000,
        tenant_id: 'legado-deve-sumir',
      };
      const remote = {
        tenant_ids: ['t1', 't2'],
        supabase_anon_key: 'anon-key',
        polling_enabled: true,
        poll_interval_ms: 3000,
        realtime_enabled: true,
        realtime_debounce_ms: 200,
        safety_poll_interval_ms: 15000,
        realtime_watchdog_ms: 60000,
        print_queue_enabled: true,
        config_refresh_ms: 60000,
      };

      const result = m.applyRemoteConfig(local, remote);

      expect(result).toEqual({
        agent_port: 9877,
        agent_token: 'epa_xxx',
        supabase_url: 'https://mdghhjemzdmeuqpzuyzx.supabase.co',
        impressoras: [{ nome: 'Cozinha', ip: '192.168.0.10' }],
        default_timeout_ms: 5000,
        tenant_ids: ['t1', 't2'],
        supabase_anon_key: 'anon-key',
        polling_enabled: true,
        poll_interval_ms: 3000,
        realtime_enabled: true,
        realtime_debounce_ms: 200,
        safety_poll_interval_ms: 15000,
        realtime_watchdog_ms: 60000,
        print_queue_enabled: true,
        config_refresh_ms: 60000,
      });
      expect(result.tenant_id).toBeUndefined();
      expect(result).not.toBe(local);
    });
  });

  describe('tenantsChanged', () => {
    it('false quando os conjuntos são iguais (ordem irrelevante)', () => {
      expect(m.tenantsChanged(['a', 'b'], ['b', 'a'])).toBe(false);
      expect(m.tenantsChanged([], [])).toBe(false);
    });

    it('true quando os conjuntos diferem', () => {
      expect(m.tenantsChanged(['a'], ['a', 'b'])).toBe(true);
      expect(m.tenantsChanged(['a', 'b'], ['a'])).toBe(true);
      expect(m.tenantsChanged(undefined, ['a'])).toBe(true);
      expect(m.tenantsChanged(['a'], undefined)).toBe(true);
    });
  });
});

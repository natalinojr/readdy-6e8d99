// Abas de Configurações liberadas por papel (2026-09-21).
//
// O que estes testes protegem:
//  - toda aba da tela tem chave (aba nova sem chave ficaria invisível para todo
//    mundo, porque a página só mostra o que casa com uma permissão);
//  - o Gerente nunca nasce com a aba Permissões (quem a tem se dá qualquer
//    outra permissão);
//  - Admin continua com tudo;
//  - permissão nova nunca salva cai no padrão do papel (é o que evita ter de
//    migrar as linhas já gravadas em `permissions`).
import { describe, it, expect } from 'vitest';
import {
  CFG_ABAS,
  CFG_KEYS,
  CFG_KEYS_GERENTE,
  cfgKeyDaAba,
} from '@/constants/permissoesAbas';
import { DEFAULT_PERMISSOES, mesclarComPadrao } from '@/hooks/usePermissoes';

// Abas de verdade da tela, na ordem em que aparecem (src/pages/configuracoes/page.tsx).
const ABAS_DA_TELA = [
  'loja', 'fiscal', 'mesas', 'estacoes',
  'impressoras', 'modelos-impressao', 'operacao', 'permissoes',
];

describe('permissões das abas de Configurações', () => {
  it('toda aba da tela tem uma chave de permissão', () => {
    for (const aba of ABAS_DA_TELA) {
      expect(cfgKeyDaAba(aba), `aba "${aba}" sem chave`).toBeTruthy();
    }
    expect(CFG_ABAS.length).toBe(ABAS_DA_TELA.length);
  });

  it('aba desconhecida não vira permissão', () => {
    expect(cfgKeyDaAba('inexistente')).toBeUndefined();
  });

  it('o Admin tem todas as abas', () => {
    for (const key of CFG_KEYS) {
      expect(DEFAULT_PERMISSOES.admin).toContain(key);
    }
  });

  it('o Gerente não nasce com a aba Permissões', () => {
    expect(CFG_KEYS_GERENTE).not.toContain('cfg_permissoes');
    expect(DEFAULT_PERMISSOES.gerente).not.toContain('cfg_permissoes');
    // …mas tem as outras, para o caso de o dono liberar a tela para ele.
    expect(DEFAULT_PERMISSOES.gerente).toContain('cfg_loja');
    expect(DEFAULT_PERMISSOES.gerente).toContain('cfg_impressoras');
  });

  it('papéis de operação não têm aba de Configurações nenhuma', () => {
    for (const papel of ['caixa', 'garcom', 'cozinha'] as const) {
      for (const key of CFG_KEYS) {
        expect(DEFAULT_PERMISSOES[papel], `${papel} não deveria ter ${key}`).not.toContain(key);
      }
    }
  });

  it('chave nunca salva fica no padrão do papel (sem migrar dados)', () => {
    // Simula uma matriz salva ANTES de as chaves cfg_* existirem: nenhuma linha
    // cfg_* no banco. O Gerente tem que continuar com o padrão dele.
    const linhasAntigas = [
      { permission_key: 'pdv_abrir_caixa', allowed: true },
      { permission_key: 'clientes_ver', allowed: false },
    ];
    const resultado = mesclarComPadrao(DEFAULT_PERMISSOES.gerente, linhasAntigas);
    expect(resultado).toContain('cfg_loja');
    expect(resultado).not.toContain('clientes_ver');
  });

  it('linha salva com allowed=false tira a aba', () => {
    const resultado = mesclarComPadrao(DEFAULT_PERMISSOES.gerente, [
      { permission_key: 'cfg_fiscal', allowed: false },
    ]);
    expect(resultado).not.toContain('cfg_fiscal');
    expect(resultado).toContain('cfg_loja');
  });
});

import { describe, it, expect } from 'vitest';
import { GESTAO_KEYS, GESTAO_ENTRADA_KEYS, primeiraRotaGestao } from '@/constants/permissoesGestao';

const has = (permissoes: string[]) => (k: string) => permissoes.includes(k);

describe('permissões do módulo Gestão', () => {
  it('caixa sem nenhuma permissão de Gestão não entra no módulo', () => {
    const caixa = ['pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_cancelar_item'];
    expect(GESTAO_ENTRADA_KEYS.some(has(caixa))).toBe(false);
  });

  it('uma única tela liberada já dá entrada no módulo', () => {
    const caixa = ['pdv_abrir_caixa', 'gestao_pedidos'];
    expect(GESTAO_ENTRADA_KEYS.some(has(caixa))).toBe(true);
  });

  it('abre na primeira tela que o papel pode ver, não em /dashboard', () => {
    expect(primeiraRotaGestao(has(['gestao_pedidos']))).toBe('/pedidos');
    expect(primeiraRotaGestao(has(['gestao_dashboard', 'gestao_pedidos']))).toBe('/dashboard');
    expect(primeiraRotaGestao(has(['estoque_movimentar']))).toBe('/estoque');
  });

  it('as chaves de tela de Gestão são todas chaves de entrada', () => {
    for (const k of GESTAO_KEYS) expect(GESTAO_ENTRADA_KEYS).toContain(k);
  });
});

// Aviso de estoque crítico da equipe (2026-10-05): um por loja, com nomes, só quando entra insumo novo.
import { describe, it, expect } from 'vitest';
import { decidirAvisoEstoque, resumoEstoque, painelEstoque, ordenarCriticos, ROTA_COMPRAR, type InsumoCritico } from '../../../supabase/functions/_shared/estoque-aviso';

const ins = (id: string, nome: string, atual = 1, minimo = 5): InsumoCritico => ({ id, nome, atual, minimo, unidade: 'kg' });
const A = ins('a', 'Barril Pilsen'), B = ins('b', 'Queijo'), C = ins('c', 'Tortilha');

describe('decidirAvisoEstoque', () => {
  it('primeira vez com insumos críticos: avisa com todos como novos', () => {
    const d = decidirAvisoEstoque(undefined, [A, B]);
    expect(d.avisar).toBe(true);
    expect(d.novos.map((i) => i.id)).toEqual(['a', 'b']);
  });
  it('mesma lista de ontem: não repete', () => {
    expect(decidirAvisoEstoque(['a', 'b'], [A, B])).toMatchObject({ avisar: false, motivo: 'sem_novidade' });
  });
  it('só saiu insumo da lista (melhorou): não avisa', () => {
    expect(decidirAvisoEstoque(['a', 'b', 'c'], [A])).toMatchObject({ avisar: false });
  });
  it('entrou um novo: avisa e marca só ele como novo', () => {
    const d = decidirAvisoEstoque(['a'], [A, C]);
    expect(d.avisar).toBe(true);
    expect(d.novos.map((i) => i.id)).toEqual(['c']);
  });
  it('normalizou tudo: não avisa; voltar a cair depois conta como novo', () => {
    expect(decidirAvisoEstoque(['a'], [])).toMatchObject({ avisar: false, motivo: 'normalizou' });
    expect(decidirAvisoEstoque([], [A]).avisar).toBe(true);
  });
});

describe('resumoEstoque', () => {
  it('uma frase com a loja e os nomes', () => {
    expect(resumoEstoque('Paranaguá', [A, B, C], [A, B, C])).toBe('3 insumos acabando em Paranaguá: Barril Pilsen, Queijo, Tortilha');
  });
  it('singular e "e mais N" acima de 3 nomes', () => {
    expect(resumoEstoque('Vila', [B], [B])).toBe('1 insumo acabando em Vila: Queijo');
    expect(resumoEstoque('Vila', [A, B, C, ins('d', 'Zebu')], [])).toBe('4 insumos acabando em Vila: Barril Pilsen, Queijo, Tortilha e mais 1');
  });
  it('zerado vem primeiro, depois os novos', () => {
    const zero = ins('z', 'Sal', 0);
    expect(ordenarCriticos([A, B, zero], [B]).map((i) => i.id)).toEqual(['z', 'b', 'a']);
  });
});

describe('painelEstoque', () => {
  it('traz o botão Comprar apontando para a lista de compras do Início', () => {
    const p = painelEstoque('Paranaguá', [A, ins('z', 'Sal', 0)], [A]);
    expect(p.bt[0]).toMatchObject({ l: 'Comprar', r: ROTA_COMPRAR });
    expect(ROTA_COMPRAR).toBe('/estoque?tab=inicio&ir=comprar');
    expect(p.lin[0].i[0]).toMatchObject({ l: 'Sal', st: 'perigo' });
    expect(p.kpi.p.v).toBe('2');
  });
});

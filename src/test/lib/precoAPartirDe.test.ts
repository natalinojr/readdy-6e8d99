import { describe, it, expect } from 'vitest';
import { extraMinimoOpcoes, precoAPartirDe } from '../../lib/precoAPartirDe';

const opcoes = [
  { id: 'a', option_group_id: 'g1', additional_price: 45 },
  { id: 'b', option_group_id: 'g1', additional_price: 38 },
  { id: 'c', option_group_id: 'g2', additional_price: 19 },
  { id: 'd', option_group_id: 'g2', additional_price: 25 },
  { id: 'e', option_group_id: 'g3', additional_price: 5 },
  { id: 'f', option_group_id: 'g4', additional_price: 2 },
  { id: 'g', option_group_id: 'g4', additional_price: 3 },
  { id: 'h', option_group_id: 'g4', additional_price: 9 },
];

describe('precoAPartirDe', () => {
  it('soma a mais barata de cada grupo obrigatório', () => {
    const grupos = [
      { id: 'g1', is_required: true, min_selections: 1 },
      { id: 'g2', is_required: true, min_selections: 1 },
    ];
    const r = precoAPartirDe(0, grupos, opcoes);
    expect(r.preco).toBe(57);
    expect(r.aPartirDe).toBe(true);
  });
  it('grupo opcional (min 0) não entra', () => {
    const r = precoAPartirDe(10, [{ id: 'g3', is_required: false, min_selections: 0 }], opcoes);
    expect(r).toEqual({ preco: 10, extra: 0, aPartirDe: false });
  });
  it('min 2 soma as 2 mais baratas', () => {
    expect(extraMinimoOpcoes([{ id: 'g4', is_required: true, min_selections: 2 }], opcoes)).toBe(5);
  });
  it('promoção entra como preço efetivo', () => {
    expect(precoAPartirDe(8, [{ id: 'g3', is_required: true, min_selections: 1 }], opcoes).preco).toBe(13);
  });
  it('opção inativa ou indisponível é ignorada', () => {
    const ops = [
      { id: 'x', option_group_id: 'g', additional_price: 1, is_active: false },
      { id: 'y', option_group_id: 'g', additional_price: 2 },
      { id: 'z', option_group_id: 'g', additional_price: 6 },
    ];
    const g = [{ id: 'g', is_required: true, min_selections: 1 }];
    expect(extraMinimoOpcoes(g, ops)).toBe(2);
    expect(extraMinimoOpcoes(g, ops, ['y'])).toBe(6);
  });
});

import { pendenciasCardapio } from '../../lib/cardapioLista';
describe('pendenciasCardapio x a partir de', () => {
  it('destaque R$ 0,00 de item com preço nas opções obrigatórias não é pendência', () => {
    const item: any = { id: 'i', status: 'ativo', preco: 0, promocoes: [], gruposOpcoes: [{ obrigatorio: true, minSelecao: 1, opcoes: [{ precoAdicional: 38, ativo: true }] }] };
    const dest: any = { id: 'd', itemId: 'i', ativo: true, customPrice: 0 };
    expect(pendenciasCardapio([item], [dest], null)).toEqual([]);
    item.gruposOpcoes = [];
    expect(pendenciasCardapio([item], [dest], null).map((p) => p.tipo)).toEqual(['destaque_zero']);
  });
});

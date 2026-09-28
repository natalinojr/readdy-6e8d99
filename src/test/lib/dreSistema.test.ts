import { describe, it, expect } from 'vitest';
import { aplicarCategoriasSistema, somaDeducoes } from '@/lib/dreSistema';

const cats = [
  { id: 'imp', group_type: 'tax', system_key: 'impostos' },
  { id: 'pes', group_type: 'expense', system_key: 'pessoal' },
  { id: 'car', group_type: 'fixas', system_key: 'taxas_cartao' },
  { id: 'ifd', group_type: 'tax', system_key: 'taxas_ifood' },
  { id: 'alu', group_type: 'expense', system_key: null },
];

describe('aplicarCategoriasSistema', () => {
  it('folha e taxas vão para a categoria do sistema, onde quer que ela esteja', () => {
    const r = aplicarCategoriasSistema({ imp: 500, alu: 1000 }, cats, { pessoal: 8000, taxasCartao: 300, taxasIfood: 200 });
    expect(r.despesas).toEqual({ imp: 500, alu: 1000, pes: 8000, car: 300, ifd: 200 });
    expect(r.soltos).toEqual({ pessoal: 0, taxasCartao: 0, taxasIfood: 0 });
  });

  it('sem a categoria o valor fica solto (linha fixa) e não some', () => {
    const r = aplicarCategoriasSistema({}, [cats[0]], { pessoal: 8000, taxasCartao: 300, taxasIfood: 200 });
    expect(r.despesas).toEqual({});
    expect(r.soltos).toEqual({ pessoal: 8000, taxasCartao: 300, taxasIfood: 200 });
  });

  it('o total nunca muda: categorias + soltos = entrada', () => {
    const v = { pessoal: 1, taxasCartao: 2, taxasIfood: 4 };
    const base = { alu: 10 };
    for (const lista of [cats, cats.slice(0, 2), []]) {
      const r = aplicarCategoriasSistema(base, lista, v);
      const soma = Object.values(r.despesas).reduce((s, x) => s + x, 0) + r.soltos.pessoal + r.soltos.taxasCartao + r.soltos.taxasIfood;
      expect(soma).toBe(17);
    }
  });
});

describe('somaDeducoes', () => {
  it('soma só o grupo Deduções (tax), inclusive categoria do sistema movida para lá', () => {
    const r = aplicarCategoriasSistema({ imp: 500, alu: 1000 }, cats, { pessoal: 8000, taxasCartao: 300, taxasIfood: 200 });
    expect(somaDeducoes(r.despesas, cats)).toBe(700);
  });
});

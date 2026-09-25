import { describe, it, expect } from 'vitest';
import { custoLinhaFicha, qtdFichaNoEstoque } from './unitConversion';

// CMV/Fichas (2026-09-25): ficha em g × preço do insumo em R$/kg tem que converter antes de multiplicar.
describe('custoLinhaFicha', () => {
  it('ficha em g, insumo em kg', () => {
    expect(custoLinhaFicha(150, 'g', 'kg', 45)).toBeCloseTo(6.75, 6); // não R$ 6.750
  });
  it('mesma unidade', () => {
    expect(custoLinhaFicha(2, 'unit', 'unit', 2.5)).toBeCloseTo(5, 6);
    expect(custoLinhaFicha(10, 'g', 'g', 0.0428)).toBeCloseTo(0.428, 6);
  });
  it('ml → L', () => {
    expect(custoLinhaFicha(500, 'ml', 'L', 8)).toBeCloseTo(4, 6);
  });
  it('sem conversão possível usa a quantidade como está (igual à baixa de estoque)', () => {
    expect(custoLinhaFicha(1, 'unit', 'L', 8)).toBeCloseTo(8, 6);
  });
  it('quantidade na unidade do estoque', () => {
    expect(qtdFichaNoEstoque(150, 'g', 'kg')).toBeCloseTo(0.15, 6);
  });
});

/**
 * src/lib/estoqueProducao.ts — contas da aba Estoque › Produção (2026-10-04).
 * Casos da El Patron Paranaguá: Cheddar produzido (1,2 kg esperado 1,25 kg), Guacamole (1,8 kg esperado 2 kg).
 */
import { describe, it, expect } from 'vitest';
import { unidadeBanco, esperadoDaProducao, rendimentoMedio, receitasParaProduzir, fichaDoInsumo } from '@/lib/estoqueProducao';
import type { ProductionRecipe } from '@/types/estoque';

function ficha(p: Partial<ProductionRecipe>): ProductionRecipe {
  return { id: 'f', tenantId: 't', name: 'Ficha', unit: 'kg', outputQuantity: 1, instructions: '', steps: [], items: [], isActive: true, createdAt: '2026-10-01', ...p };
}

describe('unidade', () => {
  it('un/l da ficha viram unit/L do banco; o resto fica', () => {
    expect(unidadeBanco('un')).toBe('unit');
    expect(unidadeBanco('l')).toBe('L');
    expect(unidadeBanco('kg')).toBe('kg');
    expect(unidadeBanco('g')).toBe('g');
    expect(unidadeBanco('ml')).toBe('ml');
  });
});

describe('esperado × real', () => {
  it('Cheddar: saiu 96% do esperado (1,25 kg)', () => {
    const e = esperadoDaProducao({ producedQuantity: 1.2, yieldPercentActual: 96, yieldPercentExpected: 100 })!;
    expect(e.esperadoQtd).toBeCloseTo(1.25, 6);
    expect(e.pct).toBeCloseTo(96, 6);
  });
  it('Guacamole: 90% do esperado (2 kg)', () => {
    const e = esperadoDaProducao({ producedQuantity: 1.8, yieldPercentActual: 72, yieldPercentExpected: 80 })!;
    expect(e.esperadoQtd).toBeCloseTo(2, 6);
    expect(Math.round(e.pct)).toBe(90);
  });
  it('rendeu mais que o esperado passa de 100%', () => {
    expect(esperadoDaProducao({ producedQuantity: 2.1, yieldPercentActual: 84, yieldPercentExpected: 80 })!.pct).toBeCloseTo(105, 6);
  });
  it('primeira produção (sem esperado) ou sem rendimento: não há o que comparar', () => {
    expect(esperadoDaProducao({ producedQuantity: 1, yieldPercentActual: 90, yieldPercentExpected: null })).toBeNull();
    expect(esperadoDaProducao({ producedQuantity: 1, yieldPercentActual: null, yieldPercentExpected: 90 })).toBeNull();
    expect(esperadoDaProducao({ producedQuantity: 0, yieldPercentActual: 90, yieldPercentExpected: 90 })).toBeNull();
    expect(esperadoDaProducao({ producedQuantity: 1, yieldPercentActual: 0, yieldPercentExpected: 90 })).toBeNull();
  });
});

describe('rendimento médio', () => {
  it('média só das que têm rendimento; vazio é null (não 0%)', () => {
    expect(rendimentoMedio([{ yieldPercentActual: 90 }, { yieldPercentActual: null }, { yieldPercentActual: 94 }])).toBe(92);
    expect(rendimentoMedio([{ yieldPercentActual: null }])).toBeNull();
    expect(rendimentoMedio([])).toBeNull();
  });
});

describe('quantas receitas fazer', () => {
  const ultima = { producedQuantity: 1.2, unit: 'kg' as const };
  it('arredonda para cima de meia em meia receita', () => {
    expect(receitasParaProduzir(1, 'kg', ultima)).toBe(1); // 0,83 receita
    expect(receitasParaProduzir(2, 'kg', ultima)).toBe(2); // 1,67
    expect(receitasParaProduzir(0.5, 'kg', ultima)).toBe(0.5);
    expect(receitasParaProduzir(0.1, 'kg', ultima)).toBe(0.5); // nunca menos que meia receita
  });
  it('converte a unidade (alvo em g, ficha em kg)', () => {
    expect(receitasParaProduzir(2400, 'g', ultima)).toBe(2);
    expect(receitasParaProduzir(2500, 'g', ultima)).toBe(2.5);
  });
  it('sem como saber, devolve undefined e o registro abre com 1', () => {
    expect(receitasParaProduzir(1, 'kg', undefined)).toBeUndefined(); // ficha nunca produzida
    expect(receitasParaProduzir(0, 'kg', ultima)).toBeUndefined();
    expect(receitasParaProduzir(5, 'unit', ultima)).toBeUndefined(); // unidade incompatível
    expect(receitasParaProduzir(1, 'kg', { producedQuantity: 0, unit: 'kg' })).toBeUndefined();
    expect(receitasParaProduzir(100, 'kg', ultima)).toBeUndefined(); // 84 receitas: conta absurda
  });
});

describe('ficha do insumo', () => {
  const guaca = ficha({ id: 'g', name: 'Guacamole', outputIngredientId: 'ins-guaca' });
  const pasta = ficha({ id: 'p', name: 'Pasta de abacate' }); // sem vínculo
  const inativa = ficha({ id: 'x', name: 'Cheddar produzido', outputIngredientId: 'ins-ched', isActive: false });
  const recipes = [guaca, pasta, inativa];

  it('acha pelo vínculo (outputIngredientId)', () => {
    expect(fichaDoInsumo(recipes, { id: 'ins-guaca', nome: 'Outro nome' })?.id).toBe('g');
  });
  it('sem vínculo, acha pelo nome sem diferenciar maiúscula nem acento', () => {
    expect(fichaDoInsumo(recipes, { id: 'ins-pasta', nome: 'PASTA DE ABAÇATE' })?.id).toBe('p');
  });
  it('só cai no nome se a ficha ainda não tem vínculo com outro insumo', () => {
    expect(fichaDoInsumo(recipes, { id: 'outro', nome: 'Guacamole' })).toBeUndefined();
  });
  it('ficha inativa só serve se for o vínculo', () => {
    expect(fichaDoInsumo(recipes, { id: 'ins-ched', nome: 'Cheddar produzido' })?.id).toBe('x');
    expect(fichaDoInsumo([ficha({ id: 'y', name: 'Cheddar produzido', isActive: false })], { id: 'q', nome: 'Cheddar produzido' })).toBeUndefined();
  });
  it('sem ficha nenhuma: undefined (o botão vira "Criar ficha")', () => {
    expect(fichaDoInsumo(recipes, { id: 'z', nome: 'Sal' })).toBeUndefined();
  });
});

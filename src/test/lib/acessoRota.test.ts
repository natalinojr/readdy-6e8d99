import { describe, it, expect } from 'vitest';
import { rotaForcada } from '../../lib/acessoRota';

describe('rotaForcada', () => {
  it('prende o papel financeiro ao Financeiro', () => {
    expect(rotaForcada('financeiro', '/dashboard')).toBe('/financeiro');
    expect(rotaForcada('financeiro', '/pdv/caixa')).toBe('/financeiro');
    expect(rotaForcada('financeiro', '/estoque')).toBe('/financeiro');
    expect(rotaForcada('financeiro', '/modulos')).toBe('/financeiro');
  });

  it('deixa o papel financeiro em paz dentro do Financeiro', () => {
    expect(rotaForcada('financeiro', '/financeiro')).toBe(null);
    expect(rotaForcada('financeiro', '/financeiro?tab=dre')).toBe(null);
  });

  it('mantém o comportamento dos papéis que já eram presos', () => {
    expect(rotaForcada('gestor_entregas', '/financeiro')).toBe('/gestor-entregas');
    expect(rotaForcada('gestor_entregas', '/gestor-entregas')).toBe(null);
    expect(rotaForcada('tarefas', '/dashboard')).toBe('/tarefas');
    expect(rotaForcada('tarefas', '/tarefas/123')).toBe(null);
  });

  it('não prende quem não é papel restrito', () => {
    for (const p of ['admin', 'gerente', 'caixa', 'garcom', 'cozinha', undefined]) {
      expect(rotaForcada(p, '/dashboard')).toBe(null);
    }
  });
});

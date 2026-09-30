import { describe, it, expect } from 'vitest';
import { orCompetenciaConta, mesCompetencia, rotuloMes, SEM_COMPRA_E_FOLHA } from '@/lib/competenciaConta';

describe('competenciaConta', () => {
  it('monta o filtro: sem competência pelo vencimento, com competência pelo mês', () => {
    expect(orCompetenciaConta('2026-08-01', '2026-08-31')).toBe(
      'and(competence_month.is.null,due_date.gte.2026-08-01,due_date.lte.2026-08-31),'
      + 'and(competence_month.gte.2026-08-01,competence_month.lte.2026-08-31)',
    );
  });

  it('período no meio do mês pega a competência do mês inteiro; aceita timestamp', () => {
    expect(orCompetenciaConta('2026-08-10T00:00:00', '2026-08-20T23:59:59')).toContain('competence_month.gte.2026-08-01,competence_month.lte.2026-08-20');
  });

  it('condição extra vale para os dois ramos', () => {
    const f = orCompetenciaConta('2026-08-01', '2026-08-31', SEM_COMPRA_E_FOLHA);
    expect(f.split(SEM_COMPRA_E_FOLHA).length - 1).toBe(2);
  });

  it('mês efetivo e rótulo', () => {
    expect(mesCompetencia({ competence_month: '2026-08-01', due_date: '2026-07-31' })).toBe('2026-08');
    expect(mesCompetencia({ competence_month: null, due_date: '2026-07-31' })).toBe('2026-07');
    expect(rotuloMes('2026-08')).toBe('ago/2026');
  });
});

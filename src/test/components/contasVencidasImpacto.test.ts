import { describe, it, expect } from 'vitest';
import { rotuloImpactoMargem } from '../../lib/impactoMargem';

describe('impacto na margem', () => {
  it('não finge que está tudo bem quando não houve receita', () => {
    expect(rotuloImpactoMargem(1500, 0)).toBe('sem receita no período');
    expect(rotuloImpactoMargem(0, 0)).toBe('sem receita no período');
    expect(rotuloImpactoMargem(1500, -1)).toBe('sem receita no período');
  });

  it('mostra o percentual quando há receita', () => {
    expect(rotuloImpactoMargem(1000, 10000)).toBe('10,0%');
    expect(rotuloImpactoMargem(1234, 10000)).toBe('12,3%');
  });
});

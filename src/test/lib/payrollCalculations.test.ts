import { describe, it, expect } from 'vitest';
import { calcFGTS, calcParcela13 } from '@/lib/payrollCalculations';

describe('payrollCalculations › 13º salário (calcParcela13)', () => {
  it('FGTS é 8% da parcela: 81,91 por parcela para salário de R$ 2.047,74 (não 163,82)', () => {
    expect(calcParcela13(2047.74, 'first').fgts).toBe(81.91);
    expect(calcParcela13(2047.74, 'second').fgts).toBe(81.91);
  });

  it('as duas parcelas somam o FGTS de 8% do 13º inteiro', () => {
    const soma = calcParcela13(2047.74, 'first').fgts + calcParcela13(2047.74, 'second').fgts;
    expect(Math.round(soma * 100) / 100).toBe(calcFGTS(2047.74));
  });

  it('1ª parcela sem desconto; 2ª leva o INSS (estimativa antiga mantida)', () => {
    const p1 = calcParcela13(2000, 'first');
    expect(p1).toMatchObject({ valor: 1000, inss: 0, net: 1000 });
    const p2 = calcParcela13(2000, 'second');
    expect(p2.valor).toBe(1000);
    expect(p2.inss).toBeCloseTo(90, 5);
    expect(p2.net).toBeCloseTo(910, 5);
  });
});

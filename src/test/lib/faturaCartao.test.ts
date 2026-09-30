import { describe, it, expect } from 'vitest';
import { parcelasCartao } from '@/lib/faturaCartao';

describe('parcelasCartao', () => {
  it('compra antes do fechamento cai na fatura do mês', () => {
    // fecha dia 25, vence dia 5: compra em 21/09 → fatura fecha 25/09, vence 05/10
    expect(parcelasCartao('2026-09-21', 100, 1, 25, 5)).toEqual([{ numero: '1', vencimento: '2026-10-05', valor: 100 }]);
  });
  it('compra no dia do fechamento ou depois vai para a fatura seguinte', () => {
    expect(parcelasCartao('2026-09-25', 100, 1, 25, 5)[0].vencimento).toBe('2026-11-05');
    expect(parcelasCartao('2026-09-28', 100, 1, 25, 5)[0].vencimento).toBe('2026-11-05');
  });
  it('vencimento depois do fechamento no mesmo mês', () => {
    // fecha 3, vence 10: compra 01/09 → vence 10/09; compra 05/09 → vence 10/10
    expect(parcelasCartao('2026-09-01', 50, 1, 3, 10)[0].vencimento).toBe('2026-09-10');
    expect(parcelasCartao('2026-09-05', 50, 1, 3, 10)[0].vencimento).toBe('2026-10-10');
  });
  it('parcela mês a mês, virando o ano, e a sobra de centavos fica na 1ª', () => {
    const p = parcelasCartao('2026-11-10', 3921.86, 3, 25, 5);
    expect(p.map((x) => x.vencimento)).toEqual(['2026-12-05', '2027-01-05', '2027-02-05']);
    expect(p.map((x) => x.valor)).toEqual([1307.3, 1307.28, 1307.28]);
    expect(Math.round(p.reduce((s, x) => s + x.valor, 0) * 100) / 100).toBe(3921.86);
  });
  it('dia 31 em mês curto usa o último dia do mês', () => {
    // fecha 20, vence 31: compra 10/01 → vence 31/01; a 2ª cai em fevereiro (28)
    expect(parcelasCartao('2026-01-10', 90, 2, 20, 31).map((x) => x.vencimento)).toEqual(['2026-01-31', '2026-02-28']);
  });
});

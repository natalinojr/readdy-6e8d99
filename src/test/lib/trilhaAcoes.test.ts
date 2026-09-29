import { describe, it, expect } from 'vitest';
import { dividirParcelas, vencimentosPadrao, somaFecha, linkWhatsApp, diasAtraso, somarDias } from '@/lib/trilhaAcoes';

describe('trilhaAcoes', () => {
  it('divide igual e a última leva os centavos', () => {
    expect(dividirParcelas(100, 3)).toEqual([33.33, 33.33, 33.34]);
    expect(dividirParcelas(96, 1)).toEqual([96]);
    expect(dividirParcelas(100, 3).reduce((s, v) => s + v, 0)).toBeCloseTo(100, 2);
  });
  it('vencimentos padrão a cada 30 dias', () => {
    expect(vencimentosPadrao('2026-09-25', 2)).toEqual(['2026-10-25', '2026-11-24']);
    expect(somarDias('2026-12-20', 30)).toBe('2027-01-19');
  });
  it('soma que não fecha bloqueia', () => {
    expect(somaFecha([50, 40], 100)).toBe(false);
    expect(somaFecha([33.33, 33.33, 33.34], 100)).toBe(true);
  });
  it('link do WhatsApp não duplica o 55', () => {
    expect(linkWhatsApp('(41) 99812-4471', 'oi Ana')).toBe('https://wa.me/5541998124471?text=oi%20Ana');
    expect(linkWhatsApp('+55 41 99812-4471', 'x')).toBe('https://wa.me/5541998124471?text=x');
    expect(linkWhatsApp('123', 'x')).toBeNull();
  });
  it('dias de atraso', () => {
    expect(diasAtraso('2026-09-01', '2026-09-29')).toBe(28);
    expect(diasAtraso('2026-10-01', '2026-09-29')).toBe(0);
  });
});

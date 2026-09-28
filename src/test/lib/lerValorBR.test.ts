import { describe, it, expect } from 'vitest';
import { lerValorBR } from '@/lib/formatters';

describe('lerValorBR', () => {
  it('lê valores em reais digitados de vários jeitos', () => {
    expect(lerValorBR('1.500')).toBe(1500);
    expect(lerValorBR('1.500,50')).toBe(1500.5);
    expect(lerValorBR('1500,5')).toBe(1500.5);
    expect(lerValorBR('1500.50')).toBe(1500.5);
    expect(lerValorBR('R$ 2.000')).toBe(2000);
    expect(lerValorBR('85')).toBe(85);
    expect(Number.isNaN(lerValorBR(''))).toBe(true);
    expect(Number.isNaN(lerValorBR('abc'))).toBe(true);
  });
});

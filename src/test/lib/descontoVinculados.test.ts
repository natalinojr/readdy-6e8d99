import { describe, it, expect } from 'vitest';
import { descontoDoVinculado, descontoQueFecha } from '@/lib/descontoVinculados';

describe('descontoDoVinculado', () => {
  it('parte do desconto = total do pedido − o que ele recebe', () => {
    // Principal R$ 60 + vinculado R$ 40, desconto R$ 10 → paga R$ 90; vinculado recebe 36
    expect(descontoDoVinculado(40, [36])).toBe(4);
  });

  it('nunca fica negativo nem passa do total do pedido', () => {
    expect(descontoDoVinculado(40, [40.01])).toBe(0);
    expect(descontoDoVinculado(40, [-5])).toBe(40);
  });

  it('sobe 1 centavo quando a soma em ponto flutuante do servidor não alcançaria o total', () => {
    // 2,06 + 4,88 = 6,9399999… no JS; com total 6,94 o order-write não marcaria pago
    expect(2.06 + 4.88 < 6.94).toBe(true);
    const d = descontoDoVinculado(10, [2.06, 4.88]);
    expect(d).toBe(3.07);
    expect(2.06 + 4.88 >= Math.round((10 - d) * 100) / 100).toBe(true);
  });
});

describe('descontoQueFecha', () => {
  it('mantém o desconto quando a soma já fecha', () => {
    expect(descontoQueFecha(60, 6, [54])).toBe(6);
  });

  it('sem desconto não inventa desconto', () => {
    expect(descontoQueFecha(6.94, 0, [2.06, 4.88])).toBe(0);
  });

  it('ajusta o principal também (2 formas de pagamento)', () => {
    const d = descontoQueFecha(10, 3.06, [2.06, 4.88]);
    expect(2.06 + 4.88 >= Math.round((10 - d) * 100) / 100).toBe(true);
  });
});

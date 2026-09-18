import { describe, it, expect } from 'vitest';
import { distribuirPagamentoRodadas } from '@/lib/distribuirPagamentoRodadas';

describe('distribuirPagamentoRodadas', () => {
  it('valor cabe na primeira rodada em aberto', () => {
    expect(distribuirPagamentoRodadas(30, [{ orderId: 'a', restante: 50 }, { orderId: 'b', restante: 40 }]))
      .toEqual([{ orderId: 'a', amount: 30, change: 0 }]);
  });

  it('pula rodada já coberta', () => {
    expect(distribuirPagamentoRodadas(30, [{ orderId: 'a', restante: 0 }, { orderId: 'b', restante: 40 }]))
      .toEqual([{ orderId: 'b', amount: 30, change: 0 }]);
  });

  it('divide entre rodadas quando excede o restante', () => {
    expect(distribuirPagamentoRodadas(45, [{ orderId: 'a', restante: 20 }, { orderId: 'b', restante: 40 }]))
      .toEqual([{ orderId: 'a', amount: 20, change: 0 }, { orderId: 'b', amount: 25, change: 0 }]);
  });

  it('pula rodada bloqueada (409 order_already_paid)', () => {
    expect(distribuirPagamentoRodadas(10, [{ orderId: 'a', restante: 20, bloqueada: true }, { orderId: 'b', restante: 40 }]))
      .toEqual([{ orderId: 'b', amount: 10, change: 0 }]);
  });

  it('excesso sobre o total em aberto fica na última parcela e troco só na última', () => {
    expect(distribuirPagamentoRodadas(70, [{ orderId: 'a', restante: 20 }, { orderId: 'b', restante: 40 }], 5))
      .toEqual([{ orderId: 'a', amount: 20, change: 0 }, { orderId: 'b', amount: 50, change: 5 }]);
  });

  it('sem saldo conhecido tenta a última rodada disponível', () => {
    expect(distribuirPagamentoRodadas(10, [{ orderId: 'a', restante: 0 }, { orderId: 'b', restante: 0 }]))
      .toEqual([{ orderId: 'b', amount: 10, change: 0 }]);
  });

  it('todas bloqueadas ou valor zero → plano vazio', () => {
    expect(distribuirPagamentoRodadas(10, [{ orderId: 'a', restante: 5, bloqueada: true }])).toEqual([]);
    expect(distribuirPagamentoRodadas(0, [{ orderId: 'a', restante: 5 }])).toEqual([]);
  });

  it('arredonda centavos', () => {
    const plano = distribuirPagamentoRodadas(33.33, [{ orderId: 'a', restante: 10.1 }, { orderId: 'b', restante: 100 }]);
    expect(plano).toEqual([{ orderId: 'a', amount: 10.1, change: 0 }, { orderId: 'b', amount: 23.23, change: 0 }]);
  });
});

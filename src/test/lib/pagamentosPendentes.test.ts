import { describe, it, expect } from 'vitest';
import { indicesPagamentosFaltantes } from '@/lib/pagamentosPendentes';

const AGORA = Date.parse('2026-09-17T15:00:00Z');
const min = (m: number) => new Date(AGORA - m * 60_000).toISOString();

describe('indicesPagamentosFaltantes', () => {
  const planejados = [
    { formaId: 'pix', valor: 30 },
    { formaId: 'dinheiro', valor: 20 },
  ];

  it('sem pagamentos existentes grava tudo', () => {
    expect(indicesPagamentosFaltantes(planejados, [], AGORA)).toEqual([0, 1]);
    expect(indicesPagamentosFaltantes(planejados, null, AGORA)).toEqual([0, 1]);
  });

  it('pula a forma já gravada (mesma forma e valor ±0,01)', () => {
    const existentes = [{ payment_method_id: 'pix', amount: '30.01', created_at: min(2) }];
    expect(indicesPagamentosFaltantes(planejados, existentes, AGORA)).toEqual([1]);
  });

  it('não pula quando valor difere mais que 0,01 ou forma diferente', () => {
    expect(indicesPagamentosFaltantes(planejados, [{ payment_method_id: 'pix', amount: 30.02, created_at: min(1) }], AGORA)).toEqual([0, 1]);
    expect(indicesPagamentosFaltantes(planejados, [{ payment_method_id: 'credito', amount: 30, created_at: min(1) }], AGORA)).toEqual([0, 1]);
  });

  it('ignora pagamentos fora da janela de 30 min ou sem data', () => {
    const existentes = [
      { payment_method_id: 'pix', amount: 30, created_at: min(31) },
      { payment_method_id: 'dinheiro', amount: 20, created_at: null },
    ];
    expect(indicesPagamentosFaltantes(planejados, existentes, AGORA)).toEqual([0, 1]);
    expect(indicesPagamentosFaltantes(planejados, [{ payment_method_id: 'pix', amount: 30, created_at: min(30) }], AGORA)).toEqual([1]);
  });

  it('consome cada pagamento existente no máximo uma vez', () => {
    const iguais = [{ formaId: 'pix', valor: 10 }, { formaId: 'pix', valor: 10 }];
    expect(indicesPagamentosFaltantes(iguais, [{ payment_method_id: 'pix', amount: 10, created_at: min(1) }], AGORA)).toEqual([1]);
    expect(indicesPagamentosFaltantes(iguais, [
      { payment_method_id: 'pix', amount: 10, created_at: min(1) },
      { payment_method_id: 'pix', amount: 10, created_at: min(1) },
    ], AGORA)).toEqual([]);
  });
});

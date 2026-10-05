import { describe, it, expect } from 'vitest';
import { valorEntregaAcerto, contaPorFaixa, resumoDoPeriodo } from '@/pages/config-delivery/acertoConta';
import { ACERTO_PADRAO, type AcertoCfg } from '@/pages/config-delivery/acertoCfg';

const regra = (p: Partial<AcertoCfg>): AcertoCfg => ({ ...ACERTO_PADRAO, ativo: true, ...p });

describe('valorEntregaAcerto', () => {
  it('valor fixo por entrega ignora distância e taxa', () => {
    const c = regra({ modo: 'por_entrega', valor_entrega: 6.5 });
    expect(valorEntregaAcerto(c, 9, 20)).toBe(6.5);
    expect(valorEntregaAcerto(c, null, 0)).toBe(6.5);
  });

  it('diária + entrega paga só o valor da entrega (a diária não entra por pedido)', () => {
    const c = regra({ modo: 'diaria_mais_entrega', valor_entrega: 4, diaria: 50 });
    expect(valorEntregaAcerto(c, 2, 8)).toBe(4);
  });

  it('percentual da taxa, limitado a 100%', () => {
    expect(valorEntregaAcerto(regra({ modo: 'percentual_taxa', percentual: 50 }), 3, 9)).toBe(4.5);
    expect(valorEntregaAcerto(regra({ modo: 'percentual_taxa', percentual: 150 }), 3, 9)).toBe(9);
    expect(valorEntregaAcerto(regra({ modo: 'percentual_taxa', percentual: 33.3 }), 3, 10)).toBe(3.33);
  });

  it('por faixa de km: primeira faixa que cobre; além da última vale a maior', () => {
    const c = regra({ modo: 'faixa_km', valor_entrega: 5, faixas: [{ ate_km: 6, valor: 9 }, { ate_km: 3, valor: 6 }] });
    expect(valorEntregaAcerto(c, 2.5, 8)).toBe(6);
    expect(valorEntregaAcerto(c, 3, 8)).toBe(6);
    expect(valorEntregaAcerto(c, 3.1, 8)).toBe(9);
    expect(valorEntregaAcerto(c, 20, 8)).toBe(9);
  });

  it('por faixa de km sem distância (ou sem faixas) paga o valor "sem distância"', () => {
    const c = regra({ modo: 'faixa_km', valor_entrega: 5, faixas: [{ ate_km: 3, valor: 6 }] });
    expect(valorEntregaAcerto(c, null, 8)).toBe(5);
    expect(valorEntregaAcerto(regra({ modo: 'faixa_km', valor_entrega: 5, faixas: [] }), 4, 8)).toBe(5);
  });

  it('faixa com 0 km não conta (o salvar também descarta)', () => {
    const c = regra({ modo: 'faixa_km', valor_entrega: 5, faixas: [{ ate_km: 0, valor: 99 }, { ate_km: 3, valor: 6 }] });
    expect(valorEntregaAcerto(c, 1, 8)).toBe(6);
  });
});

describe('contaPorFaixa', () => {
  const faixas = [{ ate_km: 3, taxa: 8, tempo_max_min: 30 }, { ate_km: 6, taxa: 12, tempo_max_min: 45 }];

  it('fixo: sobra = taxa − valor (pode ficar negativa)', () => {
    const linhas = contaPorFaixa(faixas, regra({ modo: 'por_entrega', valor_entrega: 10 }));
    expect(linhas.map((l) => l.entregador)).toEqual([10, 10]);
    expect(linhas.map((l) => l.sobra)).toEqual([-2, 2]);
  });

  it('por faixa de km usa o limite da faixa de entrega como distância', () => {
    const c = regra({ modo: 'faixa_km', faixas: [{ ate_km: 3, valor: 5 }, { ate_km: 6, valor: 9 }] });
    expect(contaPorFaixa(faixas, c).map((l) => l.entregador)).toEqual([5, 9]);
  });

  it('percentual: entregador = taxa × %', () => {
    const linhas = contaPorFaixa(faixas, regra({ modo: 'percentual_taxa', percentual: 50 }));
    expect(linhas.map((l) => l.entregador)).toEqual([4, 6]);
    expect(linhas.map((l) => l.sobra)).toEqual([4, 6]);
  });
});

describe('resumoDoPeriodo', () => {
  it('soma taxa e o que os entregadores receberiam', () => {
    const pedidos = [
      { delivery_fee: 8, delivery_distance_km: 2 },
      { delivery_fee: '12', delivery_distance_km: '5.5' },
      { delivery_fee: null, delivery_distance_km: null },
    ];
    const r = resumoDoPeriodo(regra({ modo: 'por_entrega', valor_entrega: 6 }), pedidos);
    expect(r).toEqual({ entregas: 3, taxa: 20, entregador: 18 });
  });

  it('sem pedidos dá zero', () => {
    expect(resumoDoPeriodo(regra({}), [])).toEqual({ entregas: 0, taxa: 0, entregador: 0 });
  });

  it('por faixa: pedido sem distância cai no valor "sem distância"', () => {
    const c = regra({ modo: 'faixa_km', valor_entrega: 4, faixas: [{ ate_km: 3, valor: 6 }] });
    const r = resumoDoPeriodo(c, [{ delivery_fee: 8, delivery_distance_km: 2 }, { delivery_fee: 8, delivery_distance_km: null }]);
    expect(r.entregador).toBe(10);
  });
});

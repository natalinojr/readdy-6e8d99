import { describe, it, expect } from 'vitest';
import { diasComparacao, horaBrasilia, montarVendasHora } from '@/lib/vendasHoraComparativo';

describe('diasComparacao', () => {
  it('ontem, semana passada e mesmo dia do mês passado', () => {
    expect(diasComparacao('2026-09-27')).toEqual({ ontem: '2026-09-26', semana: '2026-09-20', mes: '2026-08-27' });
  });
  it('dia que não existe no mês passado vira o último dia dele', () => {
    expect(diasComparacao('2026-03-31').mes).toBe('2026-02-28');
    expect(diasComparacao('2026-10-31').mes).toBe('2026-09-30');
  });
  it('janeiro volta para dezembro do ano anterior', () => {
    expect(diasComparacao('2026-01-15')).toEqual({ ontem: '2026-01-14', semana: '2026-01-08', mes: '2025-12-15' });
  });
});

describe('horaBrasilia', () => {
  it('converte UTC para a hora de Brasília', () => {
    expect(horaBrasilia('2026-09-27T01:30:00Z')).toBe('22');
    expect(horaBrasilia('2026-09-27T15:05:00Z')).toBe('12');
  });
});

describe('montarVendasHora', () => {
  it('une as horas, preenche zero e para hoje na hora atual', () => {
    const pts = montarVendasHora({ '18': 100 }, { '19': 50 }, { ontem: { '18': 80, '22': 40 }, mes: {} }, 19);
    expect(pts.map((p) => p.hora)).toEqual(['18:00', '19:00', '20:00', '21:00', '22:00']);
    expect(pts[0]).toEqual({ hora: '18:00', valor: 100, ifood: 0, ontem: 80, mes: 0 });
    expect(pts[1]).toEqual({ hora: '19:00', valor: 50, ifood: 50, ontem: 0, mes: 0 });
    expect(pts[4].valor).toBeUndefined();
    expect(pts[4].ontem).toBe(40);
    expect(pts[0].semana).toBeUndefined();
  });
  it('sem venda em nenhuma série → vazio', () => {
    expect(montarVendasHora({}, {}, { ontem: {} }, 12)).toEqual([]);
  });
});

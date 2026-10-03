import { describe, it, expect } from 'vitest';
import {
  agoraBrasilia, visivelEm, visivelAgora, cruzamNaSemana, normalizarHorario, resumoHorario, resumoDias, erroHorario, idsForaDoHorario,
  horarioDoCanal,
} from '@/lib/horarioExibicao';

const SEG_SEX_ALMOCO = [{ days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00' }];
const NOITE_SEX = [{ days: [5], start: '18:00', end: '02:00' }];

describe('horarioExibicao', () => {
  it('sem horário = aparece sempre', () => {
    expect(visivelEm(null, 0, 0)).toBe(true);
    expect(visivelEm([], 3, 900)).toBe(true);
    expect(visivelAgora([null, undefined], 'casa')).toBe(true);
  });

  it('faixa no mesmo dia: início inclusivo, fim exclusivo', () => {
    expect(visivelEm(SEG_SEX_ALMOCO, 1, 11 * 60)).toBe(true);
    expect(visivelEm(SEG_SEX_ALMOCO, 1, 14 * 60 + 59)).toBe(true);
    expect(visivelEm(SEG_SEX_ALMOCO, 1, 15 * 60)).toBe(false);
    expect(visivelEm(SEG_SEX_ALMOCO, 1, 10 * 60 + 59)).toBe(false);
    expect(visivelEm(SEG_SEX_ALMOCO, 6, 12 * 60)).toBe(false); // sábado
  });

  it('passa da meia-noite: madrugada conta para o dia em que começou', () => {
    expect(visivelEm(NOITE_SEX, 5, 23 * 60)).toBe(true);   // sex 23h
    expect(visivelEm(NOITE_SEX, 6, 1 * 60 + 59)).toBe(true); // sáb 01:59
    expect(visivelEm(NOITE_SEX, 6, 2 * 60)).toBe(false);   // sáb 02:00
    expect(visivelEm(NOITE_SEX, 5, 1 * 60)).toBe(false);   // sex 01h (é madrugada de quinta)
    expect(visivelEm([{ days: [0], start: '22:00', end: '03:00' }], 1, 60)).toBe(true); // dom→seg
  });

  it('início igual ao fim = dia inteiro', () => {
    expect(visivelEm([{ days: [2], start: '00:00', end: '00:00' }], 2, 23 * 60 + 59)).toBe(true);
    expect(visivelEm([{ days: [2], start: '00:00', end: '00:00' }], 3, 0)).toBe(false);
  });

  it('item E categoria precisam bater juntos', () => {
    // 2026-10-02 é sexta. 13:00 em Brasília = 16:00 UTC.
    const sexta13h = new Date('2026-10-02T16:00:00Z');
    expect(visivelAgora([SEG_SEX_ALMOCO, null], 'casa', sexta13h)).toBe(true);
    expect(visivelAgora([SEG_SEX_ALMOCO, NOITE_SEX], 'delivery', sexta13h)).toBe(false);
  });

  it('usa o relógio de Brasília, não o do aparelho', () => {
    // 2026-10-03 02:30 UTC = sexta 23:30 em Brasília
    expect(agoraBrasilia(new Date('2026-10-03T02:30:00Z'))).toEqual({ dia: 5, minuto: 23 * 60 + 30 });
  });

  it('cruzamNaSemana detecta destaque que nunca aparece', () => {
    expect(cruzamNaSemana([SEG_SEX_ALMOCO, [{ days: [3], start: '14:00', end: '18:00' }]])).toBe(true);
    expect(cruzamNaSemana([SEG_SEX_ALMOCO, [{ days: [3], start: '18:00', end: '22:00' }]])).toBe(false);
    expect(cruzamNaSemana([SEG_SEX_ALMOCO, null])).toBe(true);
    // janela curta (menor que 15 min) também conta
    expect(cruzamNaSemana([[{ days: [2], start: '10:00', end: '10:05' }], [{ days: [2], start: '10:03', end: '11:00' }]])).toBe(true);
    // madrugada de quem vira o dia × faixa da manhã seguinte
    expect(cruzamNaSemana([NOITE_SEX, [{ days: [6], start: '01:00', end: '03:00' }]])).toBe(true);
    expect(cruzamNaSemana([NOITE_SEX, [{ days: [6], start: '02:00', end: '03:00' }]])).toBe(false);
  });

  it('normaliza o jsonb do banco descartando faixa inválida', () => {
    expect(normalizarHorario(null)).toBeNull();
    expect(normalizarHorario([])).toBeNull();
    expect(normalizarHorario([{ days: [1, 1, 9, 2], start: '08:00', end: '10:30' }, { start: 'x', end: '10:00' }]))
      .toEqual([{ days: [1, 2], start: '08:00', end: '10:30' }]);
  });

  it('resumo legível', () => {
    expect(resumoDias([1, 2, 3, 4, 5])).toBe('Seg a Sex');
    expect(resumoDias([5, 6, 0])).toBe('Sex a Dom');
    expect(resumoDias([6, 0])).toBe('Sáb, Dom');
    expect(resumoDias([0, 1, 2, 3, 4, 5, 6])).toBe('Todos os dias');
    expect(resumoHorario(null)).toBe('Sempre');
    expect(resumoHorario([...SEG_SEX_ALMOCO, ...NOITE_SEX])).toBe('Seg a Sex 11:00–15:00 · Sex 18:00–02:00');
  });

  it('idsForaDoHorario: categoria, item (o dele e o da categoria) e destaque', () => {
    const sexta13h = new Date('2026-10-02T16:00:00Z');
    const base = {
      categories: [{ id: 'cNoite', availability_schedule: NOITE_SEX }, { id: 'cLivre' }],
      items: [
        { id: 'iDaNoite', category_id: 'cNoite' },
        { id: 'iAlmoco', category_id: 'cLivre', availability_schedule: SEG_SEX_ALMOCO },
        { id: 'iCafe', category_id: 'cLivre', availability_schedule: [{ days: [5], start: '07:00', end: '10:00' }] },
      ],
      highlights: [{ id: 'd1', availability_schedule: NOITE_SEX }, { id: 'd2' }],
    };
    expect(idsForaDoHorario(base, 'casa', sexta13h)).toEqual(['cNoite', 'h:d1', 'iCafe', 'iDaNoite']);
  });

  describe('horário por canal (casa × delivery)', () => {
    // Almoço só na casa; noite só no delivery; sábado o dia todo nos dois.
    const MISTO = [
      { days: [1, 2, 3, 4, 5], start: '11:00', end: '15:00', channel: 'casa' as const },
      { days: [5], start: '18:00', end: '02:00', channel: 'delivery' as const },
      { days: [6], start: '00:00', end: '00:00' },
    ];
    const sexta13h = new Date('2026-10-02T16:00:00Z');
    const sexta20h = new Date('2026-10-02T23:00:00Z');

    it('cada canal vê só as faixas dele (e as sem canal)', () => {
      expect(horarioDoCanal(MISTO, 'casa')).toEqual([MISTO[0], MISTO[2]]);
      expect(horarioDoCanal(MISTO, 'delivery')).toEqual([MISTO[1], MISTO[2]]);
      expect(visivelAgora([MISTO], 'casa', sexta13h)).toBe(true);
      expect(visivelAgora([MISTO], 'delivery', sexta13h)).toBe(false);
      expect(visivelAgora([MISTO], 'casa', sexta20h)).toBe(false);
      expect(visivelAgora([MISTO], 'delivery', sexta20h)).toBe(true);
    });

    it('canal sem nenhuma faixa = aparece sempre nele', () => {
      const soCasa = [{ days: [1], start: '11:00', end: '12:00', channel: 'casa' as const }];
      expect(horarioDoCanal(soCasa, 'delivery')).toBeNull();
      expect(visivelAgora([soCasa], 'delivery', sexta20h)).toBe(true);
      expect(visivelAgora([soCasa], 'casa', sexta20h)).toBe(false);
    });

    it('idsForaDoHorario por canal', () => {
      const base = { categories: [{ id: 'c' }], items: [{ id: 'i', category_id: 'c', availability_schedule: MISTO }], highlights: [] };
      expect(idsForaDoHorario(base, 'casa', sexta13h)).toEqual([]);
      expect(idsForaDoHorario(base, 'delivery', sexta13h)).toEqual(['i']);
    });

    it('normaliza e resume com o canal', () => {
      expect(normalizarHorario([{ days: [1], start: '08:00', end: '09:00', channel: 'balcao' }])).toEqual([{ days: [1], start: '08:00', end: '09:00' }]);
      expect(normalizarHorario([{ days: [1], start: '08:00', end: '09:00', channel: 'delivery' }])?.[0].channel).toBe('delivery');
      expect(resumoHorario(MISTO)).toBe('Casa: Seg a Sex 11:00–15:00 · Sáb dia todo | Delivery: Sex 18:00–02:00 · Sáb dia todo');
      expect(resumoHorario([{ days: [1], start: '11:00', end: '12:00', channel: 'casa' }])).toBe('Casa: Seg 11:00–12:00 | Delivery: sempre');
      expect(resumoHorario(MISTO, ['delivery'])).toBe('Delivery: Sex 18:00–02:00 · Sáb dia todo');
    });
  });

  it('erro de preenchimento', () => {
    expect(erroHorario(null)).toBeNull();
    expect(erroHorario([{ days: [], start: '10:00', end: '11:00' }])).toMatch(/dia/);
    expect(erroHorario([{ days: [1], start: '', end: '11:00' }])).toMatch(/início/);
  });
});

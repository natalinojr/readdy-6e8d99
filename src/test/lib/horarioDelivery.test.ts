import { describe, it, expect } from 'vitest';
import {
  dentroDoHorario, minutosAteFechar, proximaAbertura, janelaAgora, normalizarHorarioDelivery, resumoHorario,
  type HorarioDelivery,
} from '../../../supabase/functions/_shared/horario-delivery';

// Brasília = UTC-3 (sem horário de verão). 2026-10-06 é terça.
const sp = (ymd: string, hm: string) => new Date(`${ymd}T${hm}:00-03:00`);

const ALMOCO_JANTAR = { enabled: true, intervals: [{ open: '11:00', close: '14:30' }, { open: '18:00', close: '23:00' }] };
const H: HorarioDelivery = {
  enabled: true,
  days: {
    '0': { enabled: true, intervals: [{ open: '18:00', close: '23:30' }] },
    '1': { enabled: false },
    '2': ALMOCO_JANTAR, '3': ALMOCO_JANTAR, '4': ALMOCO_JANTAR,
    '5': { enabled: true, intervals: [{ open: '11:00', close: '14:30' }, { open: '18:00', close: '00:30' }] },
    '6': { enabled: true, intervals: [{ open: '18:00', close: '00:30' }] },
  },
  exceptions: [
    { date: '2026-12-25', closed: true, label: 'Natal' },
    { date: '2026-12-31', intervals: [{ open: '18:00', close: '21:00' }] },
  ],
};

describe('horário do delivery com vários horários no dia', () => {
  it('abre no almoço, fecha à tarde e reabre à noite', () => {
    expect(dentroDoHorario(H, sp('2026-10-06', '12:00'))).toBe(true);
    expect(dentroDoHorario(H, sp('2026-10-06', '14:30'))).toBe(false);
    expect(dentroDoHorario(H, sp('2026-10-06', '16:00'))).toBe(false);
    expect(dentroDoHorario(H, sp('2026-10-06', '18:00'))).toBe(true);
    expect(dentroDoHorario(H, sp('2026-10-06', '23:00'))).toBe(false);
  });

  it('fechar agora no almoço pausa só até o fim do almoço', () => {
    expect(minutosAteFechar(H, sp('2026-10-06', '13:30'))).toBe(60);
    expect(minutosAteFechar(H, sp('2026-10-06', '16:00'))).toBeNull();
  });

  it('horário que passa da meia-noite vale na madrugada seguinte', () => {
    expect(dentroDoHorario(H, sp('2026-10-10', '00:10'))).toBe(true); // sábado 00:10 (sexta até 00:30)
    expect(dentroDoHorario(H, sp('2026-10-10', '00:30'))).toBe(false);
    expect(janelaAgora(H, sp('2026-10-10', '00:10'))?.deOntem).toBe(true);
    // segunda 00:10: domingo fecha 23:30, não passa da meia-noite
    expect(dentroDoHorario(H, sp('2026-10-12', '00:10'))).toBe(false);
  });

  it('dia fechado e próxima abertura', () => {
    expect(dentroDoHorario(H, sp('2026-10-05', '19:00'))).toBe(false); // segunda
    expect(proximaAbertura(H, sp('2026-10-05', '19:00'))).toMatchObject({ emDias: 1, hora: '11:00' });
    expect(proximaAbertura(H, sp('2026-10-06', '15:00'))).toMatchObject({ emDias: 0, hora: '18:00' });
  });

  it('data especial troca o dia da semana', () => {
    expect(dentroDoHorario(H, sp('2026-12-25', '19:00'))).toBe(false); // sexta, Natal fechado
    expect(dentroDoHorario(H, sp('2026-12-31', '20:00'))).toBe(true);  // quinta especial
    expect(dentroDoHorario(H, sp('2026-12-31', '12:00'))).toBe(false); // sem almoço nesse dia
    expect(dentroDoHorario(H, sp('2026-12-31', '22:00'))).toBe(false);
    // 26/12 madrugada: o Natal (fechado) não deixa a sexta normal invadir o sábado
    expect(dentroDoHorario(H, sp('2026-12-26', '00:10'))).toBe(false);
  });

  it('lê o formato antigo (um horário por dia)', () => {
    const antigo: HorarioDelivery = { enabled: true, days: { '2': { enabled: true, open: '19:00', close: '02:00' } } };
    expect(dentroDoHorario(antigo, sp('2026-10-06', '20:00'))).toBe(true);
    expect(dentroDoHorario(antigo, sp('2026-10-07', '01:00'))).toBe(true);
    expect(dentroDoHorario(antigo, sp('2026-10-07', '03:00'))).toBe(false);
  });

  it('horários encostados contam como um só, mesmo passando da meia-noite', () => {
    const enc: HorarioDelivery = { enabled: true, days: {
      '2': { enabled: true, intervals: [{ open: '11:00', close: '18:00' }, { open: '18:00', close: '01:00' }] },
      '3': { enabled: true, intervals: [{ open: '00:30', close: '02:00' }] },
    } };
    // terça 17:50: fecha só à 01:00 de quarta (e emenda no 00:30–02:00 de quarta) = 02:00
    expect(minutosAteFechar(enc, sp('2026-10-06', '17:50'))).toBe(490);
    expect(janelaAgora(enc, sp('2026-10-06', '17:50'))?.janela).toEqual({ o: 660, c: 120 });
    // sobrepostos: 18:00–23:00 + 22:00–02:00
    const sob: HorarioDelivery = { enabled: true, days: { '2': { enabled: true, intervals: [{ open: '18:00', close: '23:00' }, { open: '22:00', close: '02:00' }] } } };
    expect(minutosAteFechar(sob, sp('2026-10-06', '21:00'))).toBe(300);
    expect(dentroDoHorario(sob, sp('2026-10-07', '01:30'))).toBe(true);
  });

  it('agenda desligada nunca abre sozinha', () => {
    expect(dentroDoHorario({ ...H, enabled: false }, sp('2026-10-06', '12:00'))).toBe(false);
  });

  it('normaliza o que a tela manda e espelha open/close', () => {
    const n = normalizarHorarioDelivery({
      enabled: true,
      days: { '2': { enabled: true, intervals: [{ open: '11:00', close: '14:30' }, { open: 'xx', close: '1' }, { open: '18:00', close: '23:00' }] }, '3': { enabled: true, intervals: [] } },
      exceptions: [{ date: '2026-12-25' }, { date: '25/12' }, { date: '2026-12-31', intervals: [{ open: '18:00', close: '21:00' }], label: 'Réveillon' }],
    });
    expect(n.days?.['2']).toMatchObject({ enabled: true, open: '11:00', close: '23:00' });
    expect(n.days?.['2'].intervals).toHaveLength(2);
    expect(n.days?.['3'].enabled).toBe(false); // ligado sem horário = fechado
    expect(n.exceptions).toEqual([
      { date: '2026-12-25', closed: true },
      { date: '2026-12-31', closed: false, intervals: [{ open: '18:00', close: '21:00' }], label: 'Réveillon' },
    ]);
  });

  it('resumo para o assistente', () => {
    const r = resumoHorario(H, sp('2026-12-01', '10:00'));
    expect(r).toContain('Terça: 11:00–14:30 e 18:00–23:00');
    expect(r).toContain('Segunda: fechado');
    expect(r).toContain('25/12 (Natal): fechado');
  });
});

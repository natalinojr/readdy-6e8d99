import { describe, it, expect } from 'vitest';
import { agoraBR, dentroDoHorario, fechouSozinha, avaliacoesRuins, avisoRepasse } from '../../../supabase/functions/ifood-avisos/regras';
import { promptResposta } from '../../../supabase/functions/ifood-ia/prompt';

// Segunda 05/10/2026 19:30 em Brasília = 22:30 UTC.
const seg1930 = new Date('2026-10-05T22:30:00Z');
const agora = agoraBR(seg1930);
const horario = { shifts: [{ dayOfWeek: 'MONDAY', start: '18:00:00', duration: 330 }, { dayOfWeek: 'SUNDAY', start: '18:00:00', duration: 400 }] };

describe('ifood-avisos', () => {
  it('lê data e hora de Brasília', () => {
    expect(agora).toMatchObject({ dia: '2026-10-05', semana: 1, hhmm: '19:30' });
  });

  it('horário de funcionamento, inclusive turno que passa da meia-noite', () => {
    expect(dentroDoHorario(horario, agora)).toBe(true);
    expect(dentroDoHorario(horario, agoraBR(new Date('2026-10-05T03:30:00Z')))).toBe(true); // dom 18h + 400 min = seg 00:40 → 00:30 ainda aberto
    expect(dentroDoHorario(horario, agoraBR(new Date('2026-10-05T15:00:00Z')))).toBe(false); // seg 12h
  });

  it('fechada sem pausa e sem ser o horário = fechou sozinha', () => {
    const status = [{ available: false, state: 'CLOSED', message: { title: 'Loja fechada', subtitle: 'Sem conexão com o sistema' }, validations: [{ id: 'is-connected', state: 'CLOSED' }] }];
    expect(fechouSozinha(status, [], horario, agora, seg1930.getTime())).toEqual({ fechou: true, motivo: 'Sem conexão com o sistema' });
  });

  it('pausa da própria loja ou motivo de horário não avisa', () => {
    const status = [{ available: false, state: 'CLOSED', validations: [{ id: 'is-connected', state: 'CLOSED' }] }];
    const pausa = [{ start: '2026-10-05T22:00:00Z', end: '2026-10-05T23:00:00Z' }];
    expect(fechouSozinha(status, pausa, horario, agora, seg1930.getTime()).fechou).toBe(false);
    const fora = [{ available: false, state: 'CLOSED', validations: [{ id: 'opening-hours', state: 'CLOSED' }] }];
    expect(fechouSozinha(fora, [], horario, agora, seg1930.getTime()).fechou).toBe(false);
    expect(fechouSozinha([{ available: true, state: 'OK' }], [], horario, agora, seg1930.getTime()).fechou).toBe(false);
  });

  it('avaliações: só nota ≤ 2 sem resposta', () => {
    const r = avaliacoesRuins({ reviews: [
      { id: 'a', score: 2, comment: 'Chegou frio', customerName: 'Gabriel Souza', order: { shortId: '1588' }, replies: [] },
      { id: 'b', score: 1, comment: 'x', replies: [{ text: 'desculpe' }] },
      { id: 'c', score: 5, comment: 'top' },
    ] });
    expect(r).toEqual([{ id: 'a', nota: 2, comentario: 'Chegou frio', cliente: 'Gabriel', pedido: '1588' }]);
  });

  it('repasse: o de hoje que bateu e o de ontem que faltou', () => {
    const ok = avisoRepasse([{ data_repasse: '2026-10-07', esperado: 1842.1, recebido_inter: 1842.1 }], '2026-10-07', '2026-10-06');
    expect(ok?.ok).toBe(true);
    expect(ok?.resumo).toContain('Bateu');
    const falta = avisoRepasse([{ data_repasse: '2026-10-06', esperado: 1000, recebido_inter: 880 }], '2026-10-07', '2026-10-06');
    expect(falta?.ok).toBe(false);
    expect(falta?.resumo).toContain('faltam');
    expect(avisoRepasse([{ data_repasse: '2026-10-07', esperado: 1000, recebido_inter: 0 }], '2026-10-07', '2026-10-06')).toBeNull();
    expect(avisoRepasse([{ data_repasse: '2026-10-07', esperado: 1000, recebido_inter: 1000, detalhe: { sem_conta: true } }], '2026-10-07', '2026-10-06')).toBeNull();
  });
});

describe('ifood-ia', () => {
  it('prompt não deixa a IA prometer brinde nem pedir dados', () => {
    const p = promptResposta({ nota: 2, comentario: 'frio', cliente: 'Gabriel', loja: 'El Patrón' });
    expect(p).toContain('NÃO prometa brinde');
    expect(p).toContain('NÃO peça telefone');
    expect(p).toContain('2 de 5');
  });
});

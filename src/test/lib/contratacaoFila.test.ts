import { describe, it, expect } from 'vitest';
import { montarFila, agendaDosProximosDias, faseEfetiva } from '../../pages/contratacao/fila';
import type { Candidate, Interview, Stage } from '../../pages/contratacao/shared';

const stages: Stage[] = [
  { id: 's-novo', name: 'Novo', color: 'zinc', sort_order: 10, native_kind: 'novo' },
  { id: 's-triagem', name: 'Triagem', color: 'sky', sort_order: 15, native_kind: null },
  { id: 's-agendar', name: 'Chamar p/ entrevista', color: 'violet', sort_order: 20, native_kind: 'agendar' },
  { id: 's-desc', name: 'Descartado', color: 'zinc', sort_order: 90, native_kind: 'descartado' },
];
const iv = (over: Partial<Interview>): Interview => ({
  id: over.id ?? 'iv1', candidate_id: over.candidate_id ?? 'c1', company_id: null,
  scheduled_at: over.scheduled_at ?? '2026-09-21T15:00:00Z', duration_min: 30, format: 'presencial', location: null,
  interviewer: null, status: over.status ?? 'agendada', scores: {}, answers: {}, recommendation: null, notes: null,
  created_at: '2026-09-01T00:00:00Z',
});
const cand = (over: Partial<Candidate>): Candidate => ({
  id: over.id ?? 'c1', company_id: null, stage_id: over.stage_id ?? null, full_name: over.full_name ?? 'Fulana', email: null,
  phone: '41999999999', city: null, neighborhood: null, address: null, marital_status: null, decision: over.decision ?? null,
  lat: null, lng: null, geo_label: null, geo_precision: null, birth_date: null, age: null, desired_role: null, summary: null,
  experiences: [], education: [], skills: [], languages: [], courses: [], availability: null, salary_expectation: null,
  driver_license: null, total_experience_months: null, strengths: [], concerns: [], rating: null, notes: null, file_path: null,
  file_name: null, file_type: null, raw_text: null, ai_processed: false,
  created_at: over.created_at ?? '2026-09-21T12:00:00Z',
} as Candidate);

// 2026-09-21 12:00 em Brasília
const agora = new Date('2026-09-21T15:00:00Z');

describe('faseEfetiva', () => {
  it('sem fase ou com fase apagada conta como "novo"', () => {
    expect(faseEfetiva(cand({ stage_id: null }), stages)).toBe('s-novo');
    expect(faseEfetiva(cand({ stage_id: 'apagada' }), stages)).toBe('s-novo');
    expect(faseEfetiva(cand({ stage_id: 's-triagem' }), stages)).toBe('s-triagem');
  });
});

describe('montarFila', () => {
  it('separa entrevistas de hoje (ainda por vir) das que passaram sem registro', () => {
    const f = montarFila({
      stages, agora,
      candidates: [cand({ id: 'a', stage_id: 's-agendar' }), cand({ id: 'b', stage_id: 's-agendar' }), cand({ id: 'c', stage_id: 's-agendar' })],
      interviews: [
        iv({ id: 'futura-hoje', candidate_id: 'a', scheduled_at: '2026-09-21T22:40:00Z' }), // 19h40 BR
        iv({ id: 'passou-hoje', candidate_id: 'b', scheduled_at: '2026-09-21T13:00:00Z' }), // 10h BR
        iv({ id: 'amanha', candidate_id: 'c', scheduled_at: '2026-09-22T13:00:00Z' }),
      ],
    });
    expect(f.hoje.map((x) => x.iv.id)).toEqual(['futura-hoje']);
    expect(f.registrar.map((x) => x.iv.id)).toEqual(['passou-hoje']);
  });

  it('"hoje" usa o dia de Brasília: 23h30 BR ainda é hoje mesmo com UTC já no dia seguinte', () => {
    const f = montarFila({
      stages, agora,
      candidates: [cand({ id: 'a' })],
      interviews: [iv({ candidate_id: 'a', scheduled_at: '2026-09-22T02:30:00Z' })], // 21/09 23h30 BR
    });
    expect(f.hoje).toHaveLength(1);
  });

  it('decidir: última realizada sem decisão, fora quem foi descartado', () => {
    const f = montarFila({
      stages, agora,
      candidates: [
        cand({ id: 'sem-dec', stage_id: 's-triagem' }),
        cand({ id: 'com-dec', stage_id: 's-triagem', decision: 'gpc' }),
        cand({ id: 'desc', stage_id: 's-desc' }),
      ],
      interviews: [
        iv({ id: 'x', candidate_id: 'sem-dec', status: 'realizada', scheduled_at: '2026-09-20T15:00:00Z' }),
        iv({ id: 'y', candidate_id: 'com-dec', status: 'realizada', scheduled_at: '2026-09-20T15:00:00Z' }),
        iv({ id: 'z', candidate_id: 'desc', status: 'realizada', scheduled_at: '2026-09-20T15:00:00Z' }),
      ],
    });
    expect(f.decidir.map((x) => x.c.id)).toEqual(['sem-dec']);
  });

  it('triar: fase "novo" (ou sem fase) e sem decisão, mais novo primeiro', () => {
    const f = montarFila({
      stages, agora, interviews: [],
      candidates: [
        cand({ id: 'velho', stage_id: 's-novo', created_at: '2026-09-01T00:00:00Z' }),
        cand({ id: 'sem-fase', stage_id: null, created_at: '2026-09-20T00:00:00Z' }),
        cand({ id: 'guardado', stage_id: 's-novo', decision: 'r' }),
        cand({ id: 'triagem', stage_id: 's-triagem' }),
      ],
    });
    expect(f.triar.map((c) => c.id)).toEqual(['sem-fase', 'velho']);
  });

  it('entrevista de candidato apagado não entra', () => {
    const f = montarFila({ stages, agora, candidates: [], interviews: [iv({ scheduled_at: '2026-09-21T22:00:00Z' })] });
    expect(f.hoje).toHaveLength(0);
  });
});

describe('agendaDosProximosDias', () => {
  it('agrupa por dia de Brasília, só agendadas que não passaram, até 7 dias', () => {
    const r = agendaDosProximosDias([
      iv({ id: 'a', scheduled_at: '2026-09-21T22:00:00Z' }),
      iv({ id: 'passou', scheduled_at: '2026-09-21T12:00:00Z' }),
      iv({ id: 'b', scheduled_at: '2026-09-23T13:00:00Z' }),
      iv({ id: 'cancel', status: 'cancelada', scheduled_at: '2026-09-23T14:00:00Z' }),
      iv({ id: 'longe', scheduled_at: '2026-10-05T13:00:00Z' }),
    ], agora);
    expect(r.map((d) => [d.diaKey, d.itens.map((x) => x.id)])).toEqual([['2026-09-21', ['a']], ['2026-09-23', ['b']]]);
  });
});

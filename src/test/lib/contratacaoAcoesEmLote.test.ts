import { describe, it, expect } from 'vitest';
import { candidatosTravadosNoLote } from '../../pages/contratacao/components/AcoesEmLote';
import type { Candidate, Stage } from '../../pages/contratacao/shared';

const stage = (id: string, native_kind: Stage['native_kind']): Stage => ({ id, name: id, color: 'zinc', sort_order: 0, native_kind });
const stages: Stage[] = [stage('novo', 'novo'), stage('agendar', 'agendar'), stage('entrevista', 'entrevista'), stage('descartado', 'descartado')];

const cand = (id: string, stage_id: string | null): Candidate => ({
  id, company_id: null, stage_id, full_name: `Candidato ${id}`, email: null, phone: null, city: null, neighborhood: null,
  address: null, marital_status: null, decision: null, lat: null, lng: null, geo_label: null, geo_precision: null,
  birth_date: null, age: null, desired_role: null, summary: null, experiences: [], education: [], skills: [], languages: [],
  courses: [], availability: null, salary_expectation: null, driver_license: null, total_experience_months: null,
  strengths: [], concerns: [], rating: null, notes: null, file_path: null, file_name: null, file_type: null, raw_text: null,
  ai_processed: false, created_at: '2026-09-01T00:00:00Z',
});

describe('candidatosTravadosNoLote', () => {
  const faltasDe = (m: Record<string, number>) => (c: Candidate) => m[c.id] ?? 0;

  it('candidato em "novo" indo para "agendar" com ficha incompleta: travado', () => {
    const r = candidatosTravadosNoLote([cand('c1', 'novo')], 'agendar', stages, faltasDe({ c1: 1 }));
    expect(r.map((c) => c.id)).toEqual(['c1']);
  });

  it('candidato em "novo" indo para "agendar" com ficha completa: não travado', () => {
    const r = candidatosTravadosNoLote([cand('c1', 'novo')], 'agendar', stages, faltasDe({ c1: 0 }));
    expect(r).toEqual([]);
  });

  it('indo para "descartado" nunca trava, mesmo com ficha incompleta', () => {
    const r = candidatosTravadosNoLote([cand('c1', 'novo')], 'descartado', stages, faltasDe({ c1: 3 }));
    expect(r).toEqual([]);
  });

  it('candidato que não está em "novo" nunca trava', () => {
    const r = candidatosTravadosNoLote([cand('c1', 'entrevista')], 'agendar', stages, faltasDe({ c1: 5 }));
    expect(r).toEqual([]);
  });

  it('candidato já no destino não conta (nada a mover)', () => {
    const r = candidatosTravadosNoLote([cand('c1', 'agendar')], 'agendar', stages, faltasDe({ c1: 5 }));
    expect(r).toEqual([]);
  });

  it('lote misto: só quem está em "novo" com ficha incompleta é travado', () => {
    const candidatos = [cand('c1', 'novo'), cand('c2', 'novo'), cand('c3', 'entrevista')];
    const r = candidatosTravadosNoLote(candidatos, 'agendar', stages, faltasDe({ c1: 1, c2: 0, c3: 9 }));
    expect(r.map((c) => c.id)).toEqual(['c1']);
  });
});

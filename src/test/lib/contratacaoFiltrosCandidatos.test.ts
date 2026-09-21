import { describe, it, expect } from 'vitest';
import { aplicarFiltrosNovos, ordenarPorAderencia } from '../../pages/contratacao/components/FiltrosCandidatos';
import type { Aderencia } from '../../pages/contratacao/aderencia';
import type { Candidate } from '../../pages/contratacao/shared';

const cand = (over: Partial<Candidate> & { id: string }): Candidate => ({
  company_id: null, stage_id: null, full_name: over.full_name ?? 'Fulana', email: null, phone: null, city: null,
  neighborhood: null, address: null, marital_status: null, decision: null, lat: null, lng: null, geo_label: null,
  geo_precision: null, birth_date: null, age: null, desired_role: null, summary: null, experiences: [], education: [],
  skills: [], languages: [], courses: [], availability: null, salary_expectation: null, driver_license: null,
  total_experience_months: null, strengths: [], concerns: [], rating: null, notes: null, file_path: null,
  file_name: null, file_type: null, raw_text: null, ai_processed: false, created_at: '2026-09-01T00:00:00Z',
  ...over,
});
const vagaIdsDe = (map: Record<string, string[]>) => (c: Candidate) => map[c.id] ?? [];
const faltasDe = (map: Record<string, number>) => (c: Candidate) => map[c.id] ?? 0;
const aderenciaDe = (map: Record<string, number | undefined>) => (c: Candidate): Aderencia | null =>
  map[c.id] == null ? null : { score: map[c.id]!, fit: 'alta', jobId: 'j1', jobTitle: 'Vaga' };

describe('aplicarFiltrosNovos', () => {
  const items = [cand({ id: 'c1' }), cand({ id: 'c2' }), cand({ id: 'c3' })];

  it('sem filtro nenhum, devolve a lista inteira', () => {
    expect(aplicarFiltrosNovos(items, { vaga: null, fichaIncompleta: false }, vagaIdsDe({}), faltasDe({}))).toEqual(items);
  });

  it('filtra por vaga (job_id exato)', () => {
    const vd = vagaIdsDe({ c1: ['job-atendente'], c2: ['job-caixa'], c3: ['job-atendente', 'job-caixa'] });
    const r = aplicarFiltrosNovos(items, { vaga: 'job-atendente', fichaIncompleta: false }, vd, faltasDe({}));
    expect(r.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  // Bug real corrigido: filtro comparava por título da vaga, então duas vagas de empresas
  // diferentes chamadas "Atendente" viravam uma etiqueta só e misturavam candidatos das duas.
  // Comparando por job_id, filtrar por uma não traz candidatos da outra mesmo com título igual.
  it('duas vagas com o mesmo título em empresas diferentes não se misturam (filtro por job_id)', () => {
    const vd = vagaIdsDe({ c1: ['job-empresa-a-atendente'], c2: ['job-empresa-b-atendente'], c3: ['job-empresa-a-atendente'] });
    const r = aplicarFiltrosNovos(items, { vaga: 'job-empresa-a-atendente', fichaIncompleta: false }, vd, faltasDe({}));
    expect(r.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('filtra por ficha incompleta (faltasDe > 0)', () => {
    const fd = faltasDe({ c1: 2, c2: 0, c3: 1 });
    const r = aplicarFiltrosNovos(items, { vaga: null, fichaIncompleta: true }, vagaIdsDe({}), fd);
    expect(r.map((c) => c.id)).toEqual(['c1', 'c3']);
  });

  it('combina vaga + ficha incompleta (E lógico)', () => {
    const vd = vagaIdsDe({ c1: ['job-atendente'], c2: ['job-atendente'], c3: ['job-caixa'] });
    const fd = faltasDe({ c1: 1, c2: 0, c3: 1 });
    const r = aplicarFiltrosNovos(items, { vaga: 'job-atendente', fichaIncompleta: true }, vd, fd);
    expect(r.map((c) => c.id)).toEqual(['c1']);
  });
});

describe('ordenarPorAderencia', () => {
  const items = [cand({ id: 'c1' }), cand({ id: 'c2' }), cand({ id: 'c3' })];

  it('ordena decrescente pelo score de aderência', () => {
    const ad = aderenciaDe({ c1: 50, c2: 90, c3: 70 });
    expect(ordenarPorAderencia(items, ad).map((c) => c.id)).toEqual(['c2', 'c3', 'c1']);
  });

  it('candidato sem candidatura válida (aderência null) vai para o fim', () => {
    const ad = aderenciaDe({ c1: 60, c2: undefined, c3: 80 });
    expect(ordenarPorAderencia(items, ad).map((c) => c.id)).toEqual(['c3', 'c1', 'c2']);
  });

  it('não muta o array recebido', () => {
    const original = [...items];
    ordenarPorAderencia(items, aderenciaDe({ c1: 10, c2: 90, c3: 50 }));
    expect(items).toEqual(original);
  });
});

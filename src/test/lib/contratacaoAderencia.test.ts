import { describe, it, expect } from 'vitest';
import { melhorAderencia } from '../../pages/contratacao/aderencia';
import type { Application, Job } from '../../pages/contratacao/shared';

const job = (id: string, title: string, status: Job['status'] = 'aberta'): Job => ({
  id, company_id: null, title, description: null, requirements: null, desirable: null,
  schedule: null, salary: null, benefits: null, contract_type: null, openings: 1,
  status, notes: null, opened_at: '2026-01-01', closed_at: status === 'fechada' ? '2026-01-02' : null, created_at: '2026-01-01',
});

const app = (over: Partial<Application>): Application => ({
  id: over.id ?? 'a1', job_id: over.job_id ?? 'j1', candidate_id: 'c1',
  score: over.score ?? null, fit: over.fit ?? null, analysis: null,
  analyzed_at: over.analyzed_at ?? null, error: over.error ?? null,
  created_at: over.created_at ?? '2026-01-01',
});

describe('melhorAderencia', () => {
  const jobs = [job('j1', 'Atendente'), job('j2', 'Caixa')];

  it('sem candidatura, sem aderência', () => {
    expect(melhorAderencia([], jobs)).toBeNull();
  });

  it('escolhe a maior nota entre várias candidaturas', () => {
    const apps = [app({ id: 'a1', job_id: 'j1', score: 60 }), app({ id: 'a2', job_id: 'j2', score: 85 })];
    const r = melhorAderencia(apps, jobs);
    expect(r).toEqual({ score: 85, fit: 'alta', jobId: 'j2', jobTitle: 'Caixa' });
  });

  it('ignora candidatura com score nulo (ainda não analisada)', () => {
    const apps = [app({ id: 'a1', job_id: 'j1', score: null }), app({ id: 'a2', job_id: 'j2', score: 55 })];
    expect(melhorAderencia(apps, jobs)).toEqual({ score: 55, fit: 'media', jobId: 'j2', jobTitle: 'Caixa' });
  });

  it('ignora candidatura com erro mesmo se tiver score residual', () => {
    const apps = [app({ id: 'a1', job_id: 'j1', score: 90, error: 'timeout' })];
    expect(melhorAderencia(apps, jobs)).toBeNull();
  });

  it('empate de score: vence a candidatura mais recente', () => {
    const apps = [
      app({ id: 'a1', job_id: 'j1', score: 70, created_at: '2026-01-01T10:00:00Z' }),
      app({ id: 'a2', job_id: 'j2', score: 70, created_at: '2026-01-02T10:00:00Z' }),
    ];
    expect(melhorAderencia(apps, jobs)?.jobId).toBe('j2');
  });

  it('vaga apagada não inventa título: candidatura é ignorada', () => {
    const apps = [app({ id: 'a1', job_id: 'j-apagada', score: 95 }), app({ id: 'a2', job_id: 'j1', score: 40 })];
    expect(melhorAderencia(apps, jobs)).toEqual({ score: 40, fit: 'baixa', jobId: 'j1', jobTitle: 'Atendente' });
  });

  it('só candidatura de vaga apagada: sem aderência', () => {
    const apps = [app({ id: 'a1', job_id: 'j-apagada', score: 95 })];
    expect(melhorAderencia(apps, jobs)).toBeNull();
  });

  // Vaga fechada não é mais uma opção real: exibir "Aderência: X · Vaga" de uma vaga que já
  // saiu do ar anunciaria uma vaga inexistente pro candidato. Mesmo tratamento de vaga apagada.
  it('só candidatura de vaga fechada: sem aderência', () => {
    const jobsComFechada = [...jobs, job('j3', 'Cozinha', 'fechada')];
    const apps = [app({ id: 'a1', job_id: 'j3', score: 95 })];
    expect(melhorAderencia(apps, jobsComFechada)).toBeNull();
  });

  it('uma vaga aberta e uma fechada com score maior: vence a aberta', () => {
    const jobsComFechada = [...jobs, job('j3', 'Cozinha', 'fechada')];
    const apps = [app({ id: 'a1', job_id: 'j1', score: 40 }), app({ id: 'a2', job_id: 'j3', score: 90 })];
    expect(melhorAderencia(apps, jobsComFechada)).toEqual({ score: 40, fit: 'baixa', jobId: 'j1', jobTitle: 'Atendente' });
  });
});

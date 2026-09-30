import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } } }));

import TriagemCurriculos from '@/pages/contratacao/components/TriagemCurriculos';
import { mergeSettings, type Application, type Candidate, type Stage } from '@/pages/contratacao/shared';

const stages: Stage[] = [
  { id: 's-novo', name: 'Novo', color: 'zinc', sort_order: 10, native_kind: 'novo' },
  { id: 's-agendar', name: 'Chamar p/ entrevista', color: 'violet', sort_order: 20, native_kind: 'agendar' },
  { id: 's-desc', name: 'Descartado', color: 'zinc', sort_order: 90, native_kind: 'descartado' },
];
const cand = (id: string, full_name: string, created_at: string) => ({
  id, full_name, created_at, stage_id: 's-novo', decision: null, company_id: null, experiences: [], strengths: [], concerns: [],
  education: [], courses: [], skills: [], languages: [], extra_fields: {}, phone: '41999999999',
} as unknown as Candidate);
const app = (candidate_id: string, score: number) => ({ id: `a-${candidate_id}`, job_id: 'j1', candidate_id, score, fit: null, analysis: null, error: null, created_at: '' } as unknown as Application);

function montar(onUpdate = vi.fn(async () => true)) {
  const fila = [cand('c1', 'Bia Nota Baixa', '2026-09-20T00:00:00Z'), cand('c2', 'Carla Nota Alta', '2026-09-01T00:00:00Z')];
  render(<TriagemCurriculos fila={fila} stages={stages} companies={[]} jobs={[]} applications={[app('c1', 40), app('c2', 90)]}
    ficha={{ required_fields: [], custom_fields: [] }} distancia={() => null}
    onUpdate={onUpdate} onAgendar={vi.fn()} onOpenFicha={vi.fn()} onClose={vi.fn()} />);
  return { onUpdate };
}

describe('TriagemCurriculos', () => {
  it('começa pela melhor nota e "Chamar" move para a fase de agendamento', async () => {
    const { onUpdate } = montar();
    expect(screen.getByText('Carla Nota Alta')).toBeTruthy();
    fireEvent.click(screen.getByText('Chamar p/ entrevista'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('c2', { stage_id: 's-agendar' }));
    await waitFor(() => expect(screen.getByText('Bia Nota Baixa')).toBeTruthy());
  });

  it('"Guardar" marca R; "Desfazer" devolve como estava', async () => {
    const { onUpdate } = montar();
    fireEvent.click(screen.getByText('Guardar'));
    await waitFor(() => expect(onUpdate).toHaveBeenCalledWith('c2', { decision: 'r' }));
    fireEvent.click(await screen.findByText('Desfazer'));
    await waitFor(() => expect(onUpdate).toHaveBeenLastCalledWith('c2', { stage_id: 's-novo', decision: null }));
  });

  it('se o sistema não gravou (ficha incompleta recusada), a pessoa continua na tela', async () => {
    montar(vi.fn(async () => false));
    fireEvent.click(screen.getByText('Descartar'));
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.getByText('Carla Nota Alta')).toBeTruthy();
  });

  it('usa mergeSettings sem quebrar (sanidade do import)', () => {
    expect(mergeSettings(null).questions.length).toBeGreaterThan(0);
  });
});

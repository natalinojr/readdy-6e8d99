import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const updates: { tabela: string; valores: Record<string, unknown> }[] = [];
vi.mock('@/lib/supabase', () => {
  const tabela = (nome: string) => {
    let valores: Record<string, unknown> = {};
    const cadeia: Record<string, unknown> = {};
    cadeia.update = (v: Record<string, unknown>) => { valores = v; updates.push({ tabela: nome, valores: v }); return cadeia; };
    for (const k of ['select', 'eq', 'in', 'order', 'limit']) cadeia[k] = () => cadeia;
    cadeia.single = async () => ({ data: { id: 'iv1', candidate_id: 'c1', scheduled_at: '2026-09-21T15:00:00Z', ...valores }, error: null });
    cadeia.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok);
    return cadeia;
  };
  return { supabase: { from: tabela, storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) } } };
});

import ModoEntrevista from '@/pages/contratacao/components/ModoEntrevista';
import { mergeSettings, type Candidate, type Interview } from '@/pages/contratacao/shared';

const iv: Interview = {
  id: 'iv1', candidate_id: 'c1', company_id: null, scheduled_at: '2020-01-01T15:00:00Z', duration_min: 30, format: 'presencial',
  location: null, interviewer: null, status: 'agendada', scores: {}, answers: {}, recommendation: null, notes: null, created_at: '2020-01-01T00:00:00Z',
} as Interview;
const c = {
  id: 'c1', full_name: 'Ana Teste', company_id: null, stage_id: null, decision: null, experiences: [], strengths: [], concerns: [],
  education: [], courses: [], skills: [], languages: [], extra_fields: {},
} as unknown as Candidate;
const settings = { ...mergeSettings(null), questions: [{ id: 'q1', label: 'Filhos?' }, { id: 'q2', label: 'Salário pretendido?' }], criteria: [] };

function montar(extra: Partial<Parameters<typeof ModoEntrevista>[0]> = {}) {
  const onSaved = vi.fn(); const onClose = vi.fn();
  render(<ModoEntrevista iv={iv} c={c} companies={[]} stages={[]} settings={settings} applications={[]} jobs={[]}
    onSaved={onSaved} onClose={onClose} {...extra} />);
  return { onSaved, onClose };
}

beforeEach(() => { updates.length = 0; try { localStorage.clear(); } catch { /* sem storage */ } });

describe('ModoEntrevista', () => {
  it('mostra uma pergunta por vez e avança até o fechamento', () => {
    montar();
    expect(screen.getByText('Filhos?')).toBeTruthy();
    fireEvent.click(screen.getByText(/Próxima/));
    expect(screen.getByText('Salário pretendido?')).toBeTruthy();
    fireEvent.click(screen.getByText(/Próxima/));
    expect(screen.getByText('Fechamento')).toBeTruthy();
  });

  it('salva respostas e a decisão na entrevista e no candidato', async () => {
    const { onSaved, onClose } = montar();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Dois' } });
    fireEvent.click(screen.getByText(/Próxima/));
    fireEvent.click(screen.getByText(/Próxima/));
    fireEvent.click(screen.getByText('GPC'));
    fireEvent.click(screen.getByText('Salvar registro'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const ent = updates.find((u) => u.tabela === 'hiring_interviews')!.valores;
    expect(ent.status).toBe('realizada');
    expect(ent.answers).toEqual({ q1: 'Dois' });
    expect(ent.recommendation).toBe('gpc');
    expect(updates.find((u) => u.tabela === 'hiring_candidates')?.valores.decision).toBe('gpc');
    expect(onSaved.mock.calls[0][1]).toEqual({ id: 'c1', decision: 'gpc' });
  });

  it('recupera o rascunho guardado no aparelho', () => {
    localStorage.setItem('contratacao_rascunho_entrevista_iv1', JSON.stringify({
      status: 'realizada', answers: { q1: 'Um filho' }, scores: {}, notes: '', decision: null, novaFase: '', at: Date.now(),
    }));
    montar();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Um filho');
    expect(screen.getByText(/Rascunho recuperado/)).toBeTruthy();
  });
});

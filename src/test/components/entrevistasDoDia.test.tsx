// Aba Entrevistas aberta por link ("Abrir entrevista de Fulana", botão do chat do assistente).
// Bug de 2026-09-16: o botão caía só na aba — a regra "trocou o dia → abre a 1ª do dia" rodava na mesma
// passada do link e sobrescrevia a escolha (no computador abria a 1ª do dia; no celular fechava tudo).
// Reproduz a ordem real: a aba monta com o link ANTES das entrevistas carregarem.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

vi.mock('@/lib/supabase', () => {
  // Cadeia qualquer (from().select().in()...) que resolve vazio.
  const cadeia: Record<string, unknown> = {};
  const fim = Promise.resolve({ data: [], error: null });
  for (const k of ['select', 'in', 'eq', 'order', 'limit', 'maybeSingle', 'single']) cadeia[k] = () => cadeia;
  cadeia.then = (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => fim.then(ok, erro);
  return {
    supabase: {
      from: () => cadeia,
      storage: { from: () => ({ createSignedUrl: async () => ({ data: null, error: null }) }) },
      rpc: async () => ({ data: null, error: null }),
    },
  };
});

import EntrevistasDoDia from '@/pages/contratacao/components/EntrevistasDoDia';
import { mergeSettings, type Candidate, type Interview } from '@/pages/contratacao/shared';

const hojeAs = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
const iv = (id: string, candidate_id: string, iso: string): Interview => ({
  id, candidate_id, company_id: null, scheduled_at: iso, duration_min: 30, format: 'presencial', location: null,
  interviewer: null, status: 'agendada', scores: {}, answers: {}, recommendation: null, notes: null, created_at: iso,
} as Interview);
const cand = (id: string, full_name: string) => ({
  id, full_name, experiences: [], strengths: [], concerns: [], education: [], courses: [], skills: [], languages: [], extra_fields: {},
} as unknown as Candidate);

const ENTREVISTAS = [iv('iv-a', 'c-a', hojeAs(14, 0)), iv('iv-b', 'c-b', hojeAs(14, 20))];
const CANDIDATOS = [cand('c-a', 'Ana Primeira'), cand('c-b', 'Bruna Do Link')];

function montar(interviews: Interview[], focoId: string | null, onFocoUsado = () => {}) {
  const props = {
    candidates: CANDIDATOS, companies: [], stages: [], settings: mergeSettings(null), applications: [], jobs: [],
    onSaved: () => {}, onOpenCandidate: () => {}, onNewInterview: () => {}, focoId, onFocoUsado,
  };
  const r = render(<EntrevistasDoDia interviews={interviews} {...props} />);
  return { ...r, recarregar: (novas: Interview[]) => r.rerender(<EntrevistasDoDia interviews={novas} {...props} />) };
}
const telaDe = (largura: 'computador' | 'celular') => {
  window.matchMedia = ((q: string) => ({ matches: largura === 'computador' && /min-width/.test(q), media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
};
// A pessoa selecionada tem o botão da lista destacado.
const selecionada = (nome: string) => screen.getAllByText(nome)[0].closest('button')?.className.includes('bg-violet-50');

beforeEach(() => { try { localStorage.clear(); } catch { /* sem storage */ } });

describe('EntrevistasDoDia — aberta por link', () => {
  it('no computador abre a entrevista DO LINK, não a primeira do dia', async () => {
    telaDe('computador');
    const usado = vi.fn();
    const { recarregar } = montar([], 'iv-b', usado);
    recarregar(ENTREVISTAS); // as entrevistas chegam depois, como na tela real
    await waitFor(() => expect(usado).toHaveBeenCalled());
    await waitFor(() => expect(selecionada('Bruna Do Link')).toBe(true));
    expect(selecionada('Ana Primeira')).toBe(false);
  });

  it('no celular abre o registro da pessoa do link (antes fechava e mostrava só a lista)', async () => {
    telaDe('celular');
    const { recarregar } = montar([], 'iv-b');
    recarregar(ENTREVISTAS);
    // No celular, com alguém aberto a lista fica escondida (classe "hidden") e aparece só o registro.
    // No bug, a seleção era apagada: a lista voltava a aparecer e ninguém ficava aberto.
    await waitFor(() => expect(selecionada('Bruna Do Link')).toBe(true));
    const lista = screen.getAllByText('Ana Primeira')[0].closest('ul')?.parentElement;
    expect(lista?.className).toMatch(/\bhidden\b/);
  });

  it('sem link, trocar para um dia continua abrindo a primeira entrevista (computador)', async () => {
    telaDe('computador');
    const { recarregar } = montar([], null);
    recarregar(ENTREVISTAS);
    await waitFor(() => expect(selecionada('Ana Primeira')).toBe(true));
  });
});

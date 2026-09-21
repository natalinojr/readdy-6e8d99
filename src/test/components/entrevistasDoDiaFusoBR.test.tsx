// Revisão da Fase 5 (P1): EntrevistasDoDia.tsx usava dayKey (shared.ts), que corta o dia pelo fuso da
// MÁQUINA (getFullYear/getMonth/getDate), enquanto hoje.ts (atalho "Ir para a próxima", tela Hoje) usa
// diaKeyBR, fuso de Brasília fixo. Numa máquina com fuso diferente (ex.: servidor em UTC), uma entrevista
// tarde da noite em Brasília (ainda "hoje" em Brasília) caía no dia UTC seguinte para dayKey — a lista do
// dia "Hoje" aparecia vazia mesmo havendo entrevista, e o atalho apontava para um dia que a lista via
// diferente. Este teste força TZ=UTC (processo Node) para reproduzir isso independente da máquina que
// roda a suíte, e comprova que a lista usa a mesma chave de dia (diaKeyBR) que a tela Hoje/atalho.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@/lib/supabase', () => {
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

const TZ_ORIGINAL = process.env.TZ;

const iv = (id: string, candidate_id: string, iso: string): Interview => ({
  id, candidate_id, company_id: null, scheduled_at: iso, duration_min: 30, format: 'presencial', location: null,
  interviewer: null, status: 'agendada', scores: {}, answers: {}, recommendation: null, notes: null, created_at: iso,
} as Interview);
const cand = (id: string, full_name: string) => ({
  id, full_name, experiences: [], strengths: [], concerns: [], education: [], courses: [], skills: [], languages: [], extra_fields: {},
} as unknown as Candidate);

describe('EntrevistasDoDia — mesma chave de dia da tela Hoje, mesmo em máquina com outro fuso', () => {
  beforeEach(() => {
    process.env.TZ = 'UTC'; // simula servidor/PC fora de Brasília, não depende de onde a suíte roda
    // Só o relógio (Date), sem mexer em setTimeout/setInterval — findByText usa timers reais para poll.
    vi.setSystemTime(new Date('2026-09-20T16:00:00Z')); // 2026-09-20T13:00 em Brasília: mesmo dia civil nos dois fusos
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = TZ_ORIGINAL;
  });

  it('entrevista às 23h30 em Brasília (já é 21/09 em UTC) aparece na aba "Hoje", não no dia seguinte', async () => {
    // 2026-09-21T02:30:00Z = 2026-09-20T23:30 em Brasília: ainda HOJE em Brasília, mas já 21/09 em UTC.
    const entrevistas = [iv('iv-noite', 'c1', '2026-09-21T02:30:00Z')];
    const candidatos = [cand('c1', 'Zeca da Meia-Noite')];
    render(
      <EntrevistasDoDia
        interviews={entrevistas} candidates={candidatos} companies={[]} stages={[]} settings={mergeSettings(null)}
        applications={[]} jobs={[]} onSaved={() => {}} onOpenCandidate={() => {}} onNewInterview={() => {}}
      />
    );
    // Com o bug (dayKey/fuso da máquina), a aba abre em "hoje" = 21/09 (UTC) e a lista aparece vazia
    // ("Ninguém agendado neste dia"), enquanto a entrevista foi agrupada em 21/09 também — mas o valor
    // usado por AreaHoje/atalho (diaKeyBR) chamaria esse mesmo horário de "20/09". A asserção abaixo
    // confirma que, com diaKeyBR nos dois lugares, a pessoa aparece na aba que abre por padrão (hoje).
    expect(await screen.findByText('Zeca da Meia-Noite')).toBeInTheDocument();
    expect(screen.queryByText('Ninguém agendado neste dia.')).not.toBeInTheDocument();
  });
});

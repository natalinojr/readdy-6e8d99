// Mesma correção de fuso do teste-irmão entrevistasDoDiaFusoBR.test.tsx, agora para o Calendário
// (sub-aba "Calendário" de Entrevistas, AgendaEntrevistas.tsx — ver AreaEntrevistas.tsx). O arquivo
// tinha ficado de fora da unificação em diaKeyBR (hoje.ts) por engano ("código morto" — não é: está
// no ar). Ele usava dayKey (shared.ts), que corta o dia pelo fuso da MÁQUINA, enquanto a lista "Do
// dia" (EntrevistasDoDia.tsx) já usa diaKeyBR (fuso fixo de Brasília). Resultado: numa máquina fora
// de Brasília, uma entrevista tarde da noite (ainda "hoje" em Brasília) caía num QUADRADO do mês
// diferente do dia que a lista "Do dia" mostrava. Este teste força TZ=UTC (processo Node) e comprova
// que o quadrado do calendário em que a entrevista aparece é o mesmo dia civil de Brasília (diaKeyBR),
// não o dia UTC da máquina.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import AgendaEntrevistas from '@/pages/contratacao/components/AgendaEntrevistas';
import type { Candidate, Interview } from '@/pages/contratacao/shared';

const TZ_ORIGINAL = process.env.TZ;

const iv = (id: string, candidate_id: string, iso: string): Interview => ({
  id, candidate_id, company_id: null, scheduled_at: iso, duration_min: 30, format: 'presencial', location: null,
  interviewer: null, status: 'agendada', scores: {}, answers: {}, recommendation: null, notes: null, created_at: iso,
} as Interview);
const cand = (id: string, full_name: string) => ({
  id, full_name, experiences: [], strengths: [], concerns: [], education: [], courses: [], skills: [], languages: [], extra_fields: {},
} as unknown as Candidate);

describe('AgendaEntrevistas — o quadrado do dia é o mesmo dia civil de Brasília, mesmo em máquina com outro fuso', () => {
  beforeEach(() => {
    process.env.TZ = 'UTC'; // simula servidor/PC fora de Brasília
    // 10/09 meio-dia UTC: longe da virada de mês/dia, só fixa em que mês o calendário abre.
    vi.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
  });
  afterEach(() => {
    vi.useRealTimers();
    process.env.TZ = TZ_ORIGINAL;
  });

  it('entrevista às 23h30 em Brasília (já é dia seguinte em UTC) aparece no quadrado do dia de Brasília, não no dia seguinte', () => {
    // 2026-09-21T02:30:00Z = 2026-09-20T23:30 em Brasília: dia civil 20 em Brasília, mas já dia 21 em UTC.
    const entrevistas = [iv('iv-noite', 'c1', '2026-09-21T02:30:00Z')];
    const candidatos = [cand('c1', 'Zeca da Virada')];
    render(
      <AgendaEntrevistas
        interviews={entrevistas} candidates={candidatos} companies={[]} mostrarEmpresa={false}
        onOpenInterview={() => {}} onNew={() => {}}
      />
    );

    // Com o bug (dayKey/fuso da máquina), a entrevista cairia no quadrado "21"; com diaKeyBR (Brasília),
    // cai no quadrado "20" — mesmo dia que a lista "Do dia" (EntrevistasDoDia.tsx) mostraria.
    const quadroDia20 = screen.getByText('20', { selector: 'p' }).parentElement as HTMLElement;
    const quadroDia21 = screen.getByText('21', { selector: 'p' }).parentElement as HTMLElement;
    expect(within(quadroDia20).queryByText(/Zeca/)).toBeInTheDocument();
    expect(within(quadroDia21).queryByText(/Zeca/)).not.toBeInTheDocument();
  });
});

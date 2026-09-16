// Aba Financeiro › Freelancers contra um banco falso: lista, diárias do mês, pendentes e "informar dias".
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';

const h = vi.hoisted(() => ({
  rpc: vi.fn(),
  dados: {
    hr_freelancers: [] as unknown[],
    registradas: [] as unknown[],
    pendentes: [] as unknown[],
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1' } }) }));
vi.mock('@/lib/supabase', () => {
  const from = (tabela: string) => {
    const filtros: Record<string, unknown> = {};
    const q: Record<string, unknown> = {};
    for (const k of ['select', 'gte', 'lte', 'order']) q[k] = () => q;
    q.eq = (col: string, v: unknown) => { filtros[col] = v; return q; };
    q.then = (ok: (v: unknown) => unknown) => {
      const data = tabela === 'hr_freelancers' ? h.dados.hr_freelancers
        : filtros.status === 'aguardando_dias' ? h.dados.pendentes : h.dados.registradas;
      return Promise.resolve({ data, error: null }).then(ok);
    };
    return q;
  };
  return { supabase: { from, rpc: h.rpc } };
});

import FreelancersTab from '@/pages/financeiro/components/FreelancersTab';

beforeEach(() => {
  h.rpc.mockReset();
  h.rpc.mockResolvedValue({ data: null, error: null });
  h.dados.hr_freelancers = [
    { id: 'f1', name: 'Marcelle de Melo Martins', role: 'garçom', phone: null, cpf: null, daily_rate: 100, is_active: true, notes: null },
    { id: 'f2', name: 'Joziane Veiga dos Santos', role: null, phone: null, cpf: null, daily_rate: null, is_active: true, notes: null },
  ];
  h.dados.registradas = [
    { id: 's1', freelancer_id: 'f1', work_date: '2026-09-15', amount: 100, status: 'registrada', payment_id: 'p1', created_at: '2026-09-16T15:55:00Z', hr_freelancers: { name: 'Marcelle de Melo Martins', role: 'garçom' } },
  ];
  h.dados.pendentes = [
    { id: 's2', freelancer_id: 'f2', work_date: null, amount: 100, status: 'aguardando_dias', payment_id: 'p2', created_at: '2026-09-16T15:55:00Z', hr_freelancers: { name: 'Joziane Veiga dos Santos', role: null } },
  ];
});

describe('Financeiro › Freelancers', () => {
  it('mostra quem trabalhou em quais dias e quem está aguardando os dias', async () => {
    render(<FreelancersTab />);
    expect(await screen.findByText(/Aguardando os dias trabalhados \(1\)/)).toBeInTheDocument();
    expect(screen.getAllByText('Marcelle de Melo Martins').length).toBeGreaterThan(0);
    expect(screen.getByText(/Trabalhou:/)).toBeInTheDocument();
    expect(screen.getAllByText('Joziane Veiga dos Santos').length).toBeGreaterThan(0);
  });

  it('informar dois dias chama a função do banco com as datas e mostra o valor por dia', async () => {
    render(<FreelancersTab />);
    await screen.findByText(/Aguardando os dias trabalhados/);
    const campo = screen.getByLabelText('Dia trabalhado');
    fireEvent.change(campo, { target: { value: '2026-09-14' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Dia' }));
    fireEvent.change(campo, { target: { value: '2026-09-15' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Dia' }));
    const salvar = screen.getByRole('button', { name: /Salvar 2 dias/ });
    expect(salvar.textContent).toMatch(/50,00 cada/);
    fireEvent.click(salvar);
    await waitFor(() => expect(h.rpc).toHaveBeenCalledWith('fn_freelancer_informar_dias', { p_payment_id: 'p2', p_dias: ['2026-09-14', '2026-09-15'] }));
  });
});

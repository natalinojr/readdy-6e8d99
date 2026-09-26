// "Vincular Categorias DRE" (dono, 2026-09-25): a categoria escolhida voltava sozinha para
// "— Não vincular —". O efeito dependia de um array recriado a cada render: laço infinito de
// consultas que reescrevia as escolhas. E "51 alterações pendentes" contava o que já estava salvo.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { BillPayable } from '@/types/financeiro';

const h = vi.hoisted(() => ({ consultas: 0 }));

vi.mock('@/lib/supabase', () => {
  const cats = [
    { id: 'c-aluguel', name: 'Aluguel', group_type: 'expense', parent_id: null },
    { id: 'c-energia', name: 'Energia', group_type: 'expense', parent_id: null },
  ];
  const q: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'order']) q[m] = () => q;
  q.then = (ok: (r: unknown) => unknown) => { h.consultas++; return Promise.resolve({ data: cats, error: null }).then(ok); };
  return {
    supabase: { from: () => q, auth: { getSession: async () => ({ data: { session: null } }) } },
    SUPABASE_URL: 'http://x',
  };
});
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't-1' } }) }));

import ContasPagarDREModal from '@/pages/financeiro/components/ContasPagarDREModal';

const conta = (id: string, desc: string, dre: string | null, ref: string | null = null) =>
  ({ id, description: desc, supplier: 'X', category: 'Outros', amount: 100, due_date: '2026-10-05', status: 'pending', reference_type: ref, dre_category_id: dre }) as unknown as BillPayable;

describe('Vincular Categorias DRE', () => {
  beforeEach(() => { h.consultas = 0; });

  it('a categoria escolhida fica no seletor e só ela conta como alteração', async () => {
    render(<ContasPagarDREModal bills={[conta('a', 'Boleto Estação Mall', null), conta('b', 'Já vinculada', 'c-energia')]} onClose={() => {}} onSaved={() => {}} />);
    await screen.findAllByText('Aluguel');
    // Já vinculada não é "pendente"
    expect(screen.queryByText(/alteraç/)).toBeNull();

    const select = screen.getAllByRole('combobox')[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'c-aluguel' } });
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });

    expect((screen.getAllByRole('combobox')[0] as HTMLSelectElement).value).toBe('c-aluguel');
    expect(screen.getByText('1 alteração pendente')).toBeInTheDocument();
    // Uma consulta de categorias, não um laço
    expect(h.consultas).toBe(1);
  });

  it('guias da folha (hr_payroll) não pedem categoria: entram na DRE pela folha', async () => {
    render(<ContasPagarDREModal bills={[conta('a', 'Boleto Estação Mall', null), conta('f', 'DARF INSS (previdência) — competência 08/2026', null, 'hr_payroll')]} onClose={() => {}} onSaved={() => {}} />);
    await screen.findAllByText('Aluguel');
    expect(screen.queryByText(/DARF INSS/)).toBeNull();
    expect(screen.getByText('1 sem categoria DRE')).toBeInTheDocument();
    expect(screen.getByText(/1 guia da folha/)).toBeInTheDocument();
  });
});

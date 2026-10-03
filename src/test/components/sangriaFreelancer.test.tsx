// Sangria "Freelancer" no PDV (dono, 2026-10-03): dia trabalhado obrigatório; vários dias com o valor de cada um
// e total = soma. O dia vai no motivo, que fn_freelancer_diaria_dinheiro lê. Servidor falso; nada vai para produção.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@/lib/supabase', () => ({ invokeWithAuth: h.invoke, supabase: {} }));
vi.mock('@/contexts/SessaoContext', () => ({ useSessao: () => ({ caixa: { id: 'cx1' } }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { tenantId: 't1', nome: 'Caixa', perfil: 'operador' } }) }));
vi.mock('@/contexts/AuditoriaContext', () => ({ useAuditoria: () => ({ registrarEvento: vi.fn() }) }));
vi.mock('@/hooks/useCaixaPing', () => ({ useCaixaPing: () => {} }));
vi.mock('@/components/base/Dialogos', () => ({ confirmar: vi.fn() }));

import SangriaSuprimentoModal from '@/pages/pdv/caixa/components/SangriaSuprimentoModal';

// Relógio fixo (só o Date): 03/10/2026 15h em Brasília.
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(new Date('2026-10-03T18:00:00Z'));

const movimento = () => h.invoke.mock.calls.map((c) => c[1].body).find((b) => b.action === 'add_cash_movement');

function abrir() {
  render(<SangriaSuprimentoModal historico={[]} onRegistrar={() => {}} onClose={() => {}} />);
}
async function escolherMarcelle() {
  fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'Freelancer' } });
  const sel = await screen.findByDisplayValue('Escolha o freelancer...');
  fireEvent.change(sel, { target: { value: 'f1' } });
}

beforeEach(() => {
  h.invoke.mockReset();
  h.invoke.mockImplementation((_fn: string, { body }: { body: { action: string } }) => {
    if (body.action === 'list_freelancers') return Promise.resolve({ data: { data: [{ id: 'f1', name: 'Marcelle', daily_rate: 100 }] } });
    if (body.action === 'list_sangrias_previstas') return Promise.resolve({ data: { data: [] } });
    return Promise.resolve({ data: { data: { id: 'm1' } } });
  });
});

describe('Sangria de freelancer', () => {
  it('não registra sem o dia trabalhado', async () => {
    abrir();
    await escolherMarcelle();
    fireEvent.click(screen.getByText('Registrar retirada'));
    expect(await screen.findByText('Informe o dia que o freelancer trabalhou.')).toBeTruthy();
    expect(movimento()).toBeUndefined();
  });

  it('um dia: manda "diária de DD/MM/AAAA" e o valor digitado', async () => {
    abrir();
    await escolherMarcelle();
    fireEvent.change(screen.getByLabelText('Dia 1'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Registrar retirada'));
    await waitFor(() => expect(movimento()).toBeTruthy());
    expect(movimento().reason).toBe('Freelancer: Marcelle · diária de 01/10/2026');
    expect(movimento().amount).toBe(100);
    expect(movimento().freelancer).toEqual({ id: 'f1' });
  });

  it('vários dias: valor de cada um, total = soma, dias em ordem', async () => {
    abrir();
    await escolherMarcelle();
    fireEvent.change(screen.getByLabelText('Dia 1'), { target: { value: '2026-10-02' } });
    fireEvent.click(screen.getByText('Adicionar outro dia'));
    fireEvent.change(screen.getByLabelText('Dia 2'), { target: { value: '2026-10-01' } });
    fireEvent.change(screen.getByLabelText('Valor do dia 2'), { target: { value: '40' } });
    expect(screen.getByText('R$ 140,00', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByText('Registrar retirada'));
    await waitFor(() => expect(movimento()).toBeTruthy());
    expect(movimento().reason).toBe('Freelancer: Marcelle · diárias de 01/10/2026 (R$ 40,00), 02/10/2026 (R$ 100,00)');
    expect(movimento().amount).toBe(140);
  });

  it('vários dias: recusa dia repetido, dia futuro e dia sem valor', async () => {
    abrir();
    await escolherMarcelle();
    fireEvent.change(screen.getByLabelText('Dia 1'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Adicionar outro dia'));
    fireEvent.change(screen.getByLabelText('Dia 2'), { target: { value: '2026-10-01' } });
    fireEvent.click(screen.getByText('Registrar retirada'));
    expect(await screen.findByText('Tem dia repetido.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dia 2'), { target: { value: '2026-10-05' } });
    fireEvent.click(screen.getByText('Registrar retirada'));
    expect(await screen.findByText(/não pode ser no futuro/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Dia 2'), { target: { value: '2026-09-30' } });
    fireEvent.change(screen.getByLabelText('Valor do dia 2'), { target: { value: '' } });
    fireEvent.click(screen.getByText('Registrar retirada'));
    expect(await screen.findByText('Informe o valor de cada dia.')).toBeTruthy();
    expect(movimento()).toBeUndefined();
  });
});

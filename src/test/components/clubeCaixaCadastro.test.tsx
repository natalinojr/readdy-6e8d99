// Clube no caixa (2026-10-09): CPF fora do clube abre o cadastro ali mesmo. O aceite começa
// desmarcado (o operador pergunta ao cliente); cadastrou → o pedido passa a ficar no nome dele.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const invoke = vi.fn();
vi.mock('@/lib/supabase', () => ({ invokeWithAuth: (...a: unknown[]) => invoke(...a) }));

import ClubeCaixa from '@/components/fidelidade/ClubeCaixa';

const CPF = '52998224725';
const resumo = {
  customer_id: 'c1', primeiro_nome: 'Ana', saldo: 20, nivel: null, compras_janela: 0, proximo: null,
  faltam_compras: 0, beneficios: [], recompensas: [], tem_celular: true,
};

function corpo(i: number) { return (invoke.mock.calls[i][1] as { body: Record<string, unknown> }).body; }

describe('ClubeCaixa — cadastro de CPF novo', () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(async (_fn: string, { body }: { body: { action: string } }) => {
      if (body.action === 'clube_status') return { data: { ativo: true, bonus_cadastro: 20 } };
      if (body.action === 'clube_buscar') return { data: { ativo: true, encontrado: false } };
      if (body.action === 'clube_cadastrar') return { data: { ativo: true, encontrado: true, novo: true, resumo } };
      return { data: {} };
    });
  });

  async function abrirCadastro() {
    const onChange = vi.fn();
    render(<ClubeCaixa tenantId="t1" orderId={null} manterReservas onChange={onChange} />);
    fireEvent.click(await screen.findByText(/Clube de fidelidade/));
    fireEvent.change(screen.getByPlaceholderText('CPF do cliente'), { target: { value: CPF } });
    fireEvent.click(screen.getByText('Buscar'));
    await screen.findByText('Cadastrar no clube');
    return onChange;
  }

  it('sem o aceite do cliente não cadastra', async () => {
    await abrirCadastro();
    fireEvent.change(screen.getByPlaceholderText('Nome do cliente'), { target: { value: 'Ana Souza' } });
    fireEvent.change(screen.getByPlaceholderText('Celular com DDD'), { target: { value: '41999998888' } });
    fireEvent.click(screen.getByText('Cadastrar no clube'));
    expect(await screen.findByText(/marque que ele aceita/)).toBeTruthy();
    expect(invoke.mock.calls.some((c) => (c[1] as { body: { action: string } }).body.action === 'clube_cadastrar')).toBe(false);
  });

  it('com aceite cadastra e avisa o modal com o cliente e o CPF', async () => {
    const onChange = await abrirCadastro();
    fireEvent.change(screen.getByPlaceholderText('Nome do cliente'), { target: { value: 'Ana Souza' } });
    fireEvent.change(screen.getByPlaceholderText('Celular com DDD'), { target: { value: '(41) 99999-8888' } });
    fireEvent.click(screen.getByText(/aceita participar do clube/));
    fireEvent.click(screen.getByText('Cadastrar no clube'));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ customerId: 'c1', cpf: CPF })));
    const i = invoke.mock.calls.findIndex((c) => (c[1] as { body: { action: string } }).body.action === 'clube_cadastrar');
    expect(corpo(i)).toMatchObject({ cpf: CPF, nome: 'Ana Souza', celular: '41999998888', aceita_termos: true, aceita_ofertas: false });
    expect(await screen.findByText(/Cadastrado no clube/)).toBeTruthy();
  });
});

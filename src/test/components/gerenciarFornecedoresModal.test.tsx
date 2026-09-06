import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GerenciarFornecedoresModal from '@/components/GerenciarFornecedoresModal';

const upsert = vi.fn();
const remove = vi.fn();
const load = vi.fn();

const SUPPLIERS = [
  {
    id: 's1', name: 'Zé das Bebidas', legal_name: 'José Distribuidora de Bebidas LTDA',
    cnpj: '11.222.333/0001-44', phone: '', email: '', is_active: true, created_at: '',
  },
];

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: SUPPLIERS, names: ['Ambev'], loading: false, load, upsert, remove }),
}));

describe('GerenciarFornecedoresModal', () => {
  beforeEach(() => { upsert.mockReset().mockResolvedValue({ id: 's2' }); remove.mockReset(); });

  it('mostra o nome de identificação com a razão social abaixo', () => {
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    expect(screen.getByText('Zé das Bebidas')).toBeInTheDocument();
    expect(screen.getByText('José Distribuidora de Bebidas LTDA')).toBeInTheDocument();
  });

  // O nome da nota costuma ser o único que a pessoa tem em mãos ao conferir a NF.
  it('acha o fornecedor buscando pela razão social ou pelo CNPJ', () => {
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    const busca = screen.getByPlaceholderText(/Buscar por nome/);

    fireEvent.change(busca, { target: { value: 'José Distribuidora' } });
    expect(screen.getByText('Zé das Bebidas')).toBeInTheDocument();

    fireEvent.change(busca, { target: { value: '11.222.333' } });
    expect(screen.getByText('Zé das Bebidas')).toBeInTheDocument();

    fireEvent.change(busca, { target: { value: 'Ambev' } });
    expect(screen.queryByText('Zé das Bebidas')).not.toBeInTheDocument();
  });

  it('grava razão social e nome de identificação separados', async () => {
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }));
    fireEvent.change(screen.getByPlaceholderText(/Zé das Bebidas/), { target: { value: 'Coca do Bairro' } });
    fireEvent.change(screen.getByPlaceholderText(/José Distribuidora/), { target: { value: 'Recofarma Ind LTDA' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({
      name: 'Coca do Bairro',
      legal_name: 'Recofarma Ind LTDA',
    });
  });

  it('cadastra um fornecedor novo pela mesma tabela do estoque', async () => {
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }));
    fireEvent.change(screen.getByPlaceholderText(/Zé das Bebidas/), { target: { value: 'Coca-Cola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({ name: 'Coca-Cola' });
  });

  // Falha silenciosa foi o que fez um item do catálogo sumir sem explicação.
  it('falha ao salvar aparece na tela em vez de sumir', async () => {
    upsert.mockRejectedValueOnce(new Error('permission denied for table fin_suppliers'));
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }));
    fireEvent.change(screen.getByPlaceholderText(/Zé das Bebidas/), { target: { value: 'Coca-Cola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });
});

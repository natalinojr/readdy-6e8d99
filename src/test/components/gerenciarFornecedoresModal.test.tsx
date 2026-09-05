import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import GerenciarFornecedoresModal from '@/components/GerenciarFornecedoresModal';

const upsert = vi.fn();
const remove = vi.fn();
const load = vi.fn();

const SUPPLIERS = [
  { id: 's1', name: 'Ambev', phone: '', email: '', is_active: true, created_at: '' },
];

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ suppliers: SUPPLIERS, names: ['Ambev'], loading: false, load, upsert, remove }),
}));

describe('GerenciarFornecedoresModal', () => {
  beforeEach(() => { upsert.mockReset().mockResolvedValue({ id: 's2' }); remove.mockReset(); });

  it('lista os fornecedores cadastrados', () => {
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    expect(screen.getByText('Ambev')).toBeInTheDocument();
  });

  it('cadastra um fornecedor novo pela mesma tabela do estoque', async () => {
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }));
    fireEvent.change(screen.getByPlaceholderText("Distribuidora XYZ"), { target: { value: 'Coca-Cola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    await waitFor(() => expect(upsert).toHaveBeenCalled());
    expect(upsert.mock.calls[0][0]).toMatchObject({ name: 'Coca-Cola' });
  });

  // Falha silenciosa foi o que fez um item do catálogo sumir sem explicação.
  it('falha ao salvar aparece na tela em vez de sumir', async () => {
    upsert.mockRejectedValueOnce(new Error('permission denied for table fin_suppliers'));
    render(<GerenciarFornecedoresModal onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Novo/ }));
    fireEvent.change(screen.getByPlaceholderText("Distribuidora XYZ"), { target: { value: 'Coca-Cola' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar' }));

    expect(await screen.findByText(/permission denied/)).toBeInTheDocument();
  });
});

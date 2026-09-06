import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import NovaCompraModal from '@/pages/financeiro/components/compras/NovaCompraModal';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenantId: 't1', nome: 'Teste', perfil: 'admin' } }),
}));

function chain() {
  const c: Record<string, unknown> = {
    then: (r: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(r),
  };
  for (const m of ['select', 'eq', 'order', 'in', 'range', 'neq']) c[m] = () => c;
  return c;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: () => chain() },
  invokeWithAuth: vi.fn().mockResolvedValue({ data: {}, error: null }),
  SUPABASE_URL: 'http://localhost',
}));

vi.mock('@/hooks/useMerchandiseCategories', () => ({
  useMerchandiseCategories: () => ({ categories: [], loading: false }),
}));

const props = {
  suppliers: ['Ambev', 'Coca-Cola'],
  ingredients: [],
  centers: [{ id: 'c1', name: 'Cozinha' }],
  bankAccounts: [{ id: 'b1', name: 'Itaú' }],
  onLoadIngredients: () => {},
  onSubmit: async () => {},
  onClose: () => {},
} as unknown as React.ComponentProps<typeof NovaCompraModal>;

describe('NovaCompraModal — layout', () => {
  it('mantém os campos essenciais depois do redesenho', () => {
    const { container } = render(<NovaCompraModal {...props} />);

    // Campos que a compra não pode perder.
    expect(screen.getByPlaceholderText('Nome do fornecedor')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Nº da NF')).toBeInTheDocument();
    expect(screen.getByText('Frete')).toBeInTheDocument();
    expect(screen.getByText('Centro de Custo')).toBeInTheDocument();
    expect(screen.getByText('Debitar da Conta')).toBeInTheDocument();
    expect(screen.getByText('Observações')).toBeInTheDocument();
    expect(screen.getByText(/Itens da Compra/)).toBeInTheDocument();

    // O botão de salvar vive fora do <form> agora, e precisa continuar ligado a ele.
    const salvar = screen.getByRole('button', { name: /Salvar Compra/ });
    const form = container.querySelector('form');
    expect(salvar.getAttribute('form')).toBe(form?.getAttribute('id'));

    // Total continua visível, agora na barra fixa.
    expect(screen.getByText('Total')).toBeInTheDocument();

    // Com frete lançado, aparecem as opções de rateio.
    // O primeiro campo com este placeholder e o do frete.
    fireEvent.change(screen.getAllByPlaceholderText('0,00')[0], { target: { value: '50' } });
    expect(screen.getByRole('button', { name: /Automático/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Manual/ })).toBeInTheDocument();

  });
});

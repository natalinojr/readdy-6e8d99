import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import CatalogoComprasModal from '@/pages/financeiro/components/compras/CatalogoComprasModal';

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenantId: 't1', nome: 'Teste', perfil: 'admin' } }),
}));

vi.mock('@/hooks/useSuppliers', () => ({
  useSuppliers: () => ({ names: ['Ambev'], suppliers: [{ id: 's1', name: 'Ambev' }] }),
}));

vi.mock('@/hooks/useMerchandiseCategories', () => ({
  useMerchandiseCategories: () => ({
    categories: [{ id: 'cat-limpeza-merc', name: 'Limpeza', sort_order: 1, is_active: true, created_at: '' }],
    loading: false,
  }),
}));

vi.mock('@/components/ImportExportTemplatesModal', () => ({ default: () => null }));

const DRE_CATS = [
  { id: 'dre-cmv', name: 'Mercadoria', group_type: 'cost' },
  { id: 'dre-limpeza', name: 'Limpeza', group_type: 'expense' },
];
const INGREDIENTS = [{ id: 'ing-requeijao', name: 'Requeijão', unit: 'kg' }];

const invokeWithAuth = vi.fn().mockResolvedValue({ data: {}, error: null });

// Cada tabela devolve um "chain" thenable: qualquer método encadeia, o await resolve.
function chainFor(table: string) {
  const data = table === 'fin_dre_categories' ? DRE_CATS : table === 'ingredients' ? INGREDIENTS : [];
  const chain: Record<string, unknown> = {
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data, error: null }).then(resolve),
  };
  for (const m of ['select', 'eq', 'order', 'in', 'range', 'neq']) {
    chain[m] = () => chain;
  }
  return chain;
}

vi.mock('@/lib/supabase', () => ({
  supabase: { from: (table: string) => chainFor(table) },
  invokeWithAuth: (...args: unknown[]) => invokeWithAuth(...args),
  SUPABASE_URL: 'http://localhost',
}));

async function abrirFormulario() {
  render(<CatalogoComprasModal onClose={() => {}} />);
  fireEvent.click(await screen.findByRole('button', { name: /Novo Item/ }));
}

const selectPorRotulo = (re: RegExp) =>
  screen.getAllByRole('combobox').find((el) => {
    const label = el.closest('div')?.querySelector('label')?.textContent ?? '';
    return re.test(label);
  });

describe('CatalogoComprasModal', () => {
  beforeEach(() => invokeWithAuth.mockClear());

  it('abre em "não entra no estoque", com classificação DRE e sem vínculo de insumo', async () => {
    await abrirFormulario();
    expect(selectPorRotulo(/Classificação DRE/)).toBeTruthy();
    expect(screen.queryByPlaceholderText('Buscar insumo do estoque...')).not.toBeInTheDocument();
    // A categoria de mercadoria existe nos dois modos
    expect(selectPorRotulo(/Categoria de mercadoria/)).toBeTruthy();
  });

  it('no modo estoque troca a classificação DRE pelo vínculo com o insumo', async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Entra no estoque/ }));

    expect(selectPorRotulo(/Classificação DRE/)).toBeUndefined();
    expect(screen.getByPlaceholderText('Buscar insumo do estoque...')).toBeInTheDocument();
    expect(screen.getByText(/Entra no DRE como/)).toBeInTheDocument();
  });

  it('não deixa salvar item de estoque sem insumo vinculado', async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Entra no estoque/ }));
    fireEvent.change(screen.getByPlaceholderText(/Requeijão/), { target: { value: 'Requeijão cx' } });

    const salvar = screen.getByRole('button', { name: 'Cadastrar' });
    expect(salvar).toBeDisabled();

    fireEvent.focus(screen.getByPlaceholderText('Buscar insumo do estoque...'));
    fireEvent.click(await screen.findByRole('button', { name: /Requeijão\s+kg/ }));
    expect(salvar).toBeEnabled();
  });

  it('item de consumo grava a classificação DRE e nunca o vínculo de estoque', async () => {
    await abrirFormulario();
    fireEvent.change(screen.getByPlaceholderText(/Detergente/), { target: { value: 'Detergente' } });
    fireEvent.change(selectPorRotulo(/Classificação DRE/)!, { target: { value: 'dre-limpeza' } });
    fireEvent.change(selectPorRotulo(/Categoria de mercadoria/)!, { target: { value: 'cat-limpeza-merc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(invokeWithAuth).toHaveBeenCalled());
    const payload = invokeWithAuth.mock.calls[0][1].body.payload;
    expect(payload).toMatchObject({
      name: 'Detergente',
      dre_category_id: 'dre-limpeza',
      merchandise_category_id: 'cat-limpeza-merc',
      ingredient_id: null,
      purchase_unit: null,
    });
  });

  it('item de estoque grava o insumo e não grava categoria DRE', async () => {
    await abrirFormulario();
    fireEvent.click(screen.getByRole('button', { name: /Entra no estoque/ }));
    fireEvent.change(screen.getByPlaceholderText(/Requeijão/), { target: { value: 'Requeijão cx 12x1,5kg' } });
    fireEvent.focus(screen.getByPlaceholderText('Buscar insumo do estoque...'));
    fireEvent.click(await screen.findByRole('button', { name: /Requeijão\s+kg/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Cadastrar' }));

    await waitFor(() => expect(invokeWithAuth).toHaveBeenCalled());
    const payload = invokeWithAuth.mock.calls[0][1].body.payload;
    expect(payload).toMatchObject({
      name: 'Requeijão cx 12x1,5kg',
      ingredient_id: 'ing-requeijao',
      dre_category_id: null,
    });
  });
});

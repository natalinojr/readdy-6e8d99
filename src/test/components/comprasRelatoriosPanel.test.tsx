import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

import ComprasRelatoriosPanel from '@/pages/financeiro/components/compras/ComprasRelatoriosPanel';
import type { Purchase } from '@/types/financeiro';

// Nomes de categoria/fornecedor aparecem também nos <option> dos filtros —
// estes helpers olham só para as CÉLULAS das tabelas.
const cells = (text: string) => screen.queryAllByText(text, { selector: 'td *, td' });
const findCell = (text: string) => screen.findAllByText(text, { selector: 'td *, td' }).then((els) => els[0]);

vi.mock('@/contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenantId: 't1', nome: 'Teste', perfil: 'admin' } }),
}));

vi.mock('@/hooks/useMerchandiseCategories', () => ({
  useMerchandiseCategories: () => ({
    categories: [
      { id: 'cat-bebidas', name: 'Bebidas', sort_order: 1, is_active: true, created_at: '' },
      { id: 'cat-carnes', name: 'Carnes', sort_order: 2, is_active: true, created_at: '' },
    ],
    loading: false,
  }),
}));

// Insumos: dão categoria de fallback ao item que não tem merchandise_category_id
vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          range: () => Promise.resolve({
            data: [{ id: 'ing-picanha', name: 'Picanha', unit: 'kg', merchandise_category_id: 'cat-carnes' }],
            error: null,
          }),
        }),
      }),
    }),
  },
  SUPABASE_URL: 'http://localhost',
}));

// ResponsiveContainer do recharts não mede nada no jsdom — evita ruído no console
vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return { ...actual, ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div> };
});

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const hoje = new Date();
const mesAtual = iso(new Date(hoje.getFullYear(), hoje.getMonth(), 1));
const mesAnterior = iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 15));

function compra(over: Partial<Purchase> & { items: Purchase['items'] }): Purchase {
  return {
    id: 'p', tenant_id: 't1', supplier: 'Forn', total_amount: 0, payment_method: 'PIX',
    payment_status: 'paid', purchase_date: mesAtual, created_at: '', ...over,
  } as Purchase;
}

const purchases: Purchase[] = [
  compra({
    id: 'p1', supplier: 'Ambev', total_amount: 600, purchase_date: mesAtual,
    items: [
      { id: 'i1', purchase_id: 'p1', tenant_id: 't1', description: 'Cerveja lata', quantity: 10, unit_price: 50, total_price: 500,
        unit_label: 'cx', units_per_package: 12, cost_per_base_unit: 500 / 120, merchandise_category_id: 'cat-bebidas' },
      // Sem categoria no item nem insumo → "Sem categoria"
      { id: 'i2', purchase_id: 'p1', tenant_id: 't1', description: 'Gelo', quantity: 10, unit_price: 10, total_price: 100, unit_label: 'saco' },
    ],
  }),
  compra({
    id: 'p2', supplier: 'Frigorífico X', total_amount: 900, purchase_date: mesAtual, payment_status: 'pending',
    items: [
      // Categoria vem do insumo (fallback)
      { id: 'i3', purchase_id: 'p2', tenant_id: 't1', ingredient_id: 'ing-picanha', description: 'Picanha', quantity: 15, unit_price: 60, total_price: 900,
        unit_label: 'kg', units_per_package: 1, cost_per_base_unit: 60 },
    ],
  }),
  compra({
    id: 'p3', supplier: 'Ambev', total_amount: 400, purchase_date: mesAnterior,
    items: [
      { id: 'i4', purchase_id: 'p3', tenant_id: 't1', description: 'Cerveja lata', quantity: 8, unit_price: 50, total_price: 400,
        unit_label: 'cx', units_per_package: 12, cost_per_base_unit: 400 / 96, merchandise_category_id: 'cat-bebidas' },
    ],
  }),
];

describe('ComprasRelatoriosPanel', () => {
  it('agrupa por categoria no mês atual, com fallback do insumo e "Sem categoria"', async () => {
    render(<ComprasRelatoriosPanel purchases={purchases} />);

    // Espera a categoria via insumo (fetch mockado resolve assíncrono)
    await findCell('Carnes');
    expect(cells('Bebidas').length).toBeGreaterThan(0);
    expect(cells('Sem categoria').length).toBeGreaterThan(0);

    // Total do mês atual = 500 + 100 + 900 (p3 é do mês anterior)
    const totais = screen.getAllByText('R$ 1.500,00');
    expect(totais.length).toBeGreaterThan(0);

    // Drill-down: expandir Bebidas mostra o item e a variação de custo
    fireEvent.click(cells('Bebidas')[0]);
    const item = await findCell('Cerveja lata');
    expect(item).toBeInTheDocument();

    // Abrir o item mostra a compra individual com o fornecedor
    fireEvent.click(item);
    expect(cells('Ambev').length).toBeGreaterThan(0);
  });

  it('troca agrupamento para fornecedor e filtra por status', async () => {
    render(<ComprasRelatoriosPanel purchases={purchases} />);
    await findCell('Carnes');

    fireEvent.click(screen.getByRole('button', { name: /Fornecedor/ }));
    expect(cells('Frigorífico X').length).toBeGreaterThan(0);

    // Só "A Pagar" → fica apenas o frigorífico (R$ 900)
    const selects = screen.getAllByRole('combobox');
    const statusSelect = selects.find((s) => within(s).queryByText('Todos os status'))!;
    fireEvent.change(statusSelect, { target: { value: 'pending' } });
    expect(cells('Ambev').length).toBe(0);
    expect(screen.getAllByText('R$ 900,00').length).toBeGreaterThan(0);
  });

  it('período "3 meses" inclui o mês anterior e monta a matriz categoria × mês', async () => {
    render(<ComprasRelatoriosPanel purchases={purchases} />);
    await findCell('Carnes');

    fireEvent.click(screen.getByRole('button', { name: '3 meses' }));
    expect(screen.getByText('Categoria × Mês')).toBeInTheDocument();
    // 1.500 + 400
    expect(screen.getAllByText('R$ 1.900,00').length).toBeGreaterThan(0);
  });
});

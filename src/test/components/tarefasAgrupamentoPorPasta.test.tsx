// Agrupamento da lista salvo por pasta: trocar numa pasta não muda a outra, e
// voltar pra pasta traz o agrupamento que ela tinha.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const lista = (id: string, name: string) => ({
  id, name, color: '#6366f1', icon: null, parent_list_id: null, sort_order: 0, created_by: 'eu',
  statuses: [{ id: `${id}-s`, name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 }],
});

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));
vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 'eu', nome: 'Natalino', tenantId: 't1' } }) }));
vi.mock('@/contexts/AppModeContext', () => ({ useAppMode: () => ({ setMode: vi.fn() }) }));
vi.mock('@/hooks/useModuleAccess', () => ({ useModuleAccess: () => ({ hasModule: () => true, loading: false }) }));
vi.mock('@/hooks/useUsuarios', () => ({ useUsuarios: () => ({ usuarios: [] }) }));
vi.mock('@/lib/pwa', () => ({ atualizarBadge: vi.fn() }));
vi.mock('@/pages/tarefas/hooks/useTarefas', async (orig) => ({
  ...(await orig<object>()),
  useTarefas: () => ({
    lists: [lista('A', 'Pasta A'), lista('B', 'Pasta B')], tasks: [], tags: [], campos: [], notificacoes: [],
    views: [], templates: [], loading: false, error: null, reload: vi.fn(), write: vi.fn(),
    fetchDetail: vi.fn(), fetchAnexos: vi.fn(), enviarAnexo: vi.fn(), abrirAnexo: vi.fn(),
  }),
}));

import TarefasPage from '@/pages/tarefas/page';

describe('Agrupamento por pasta', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  });

  it('cada pasta lembra o seu agrupamento', () => {
    render(<MemoryRouter><TarefasPage /></MemoryRouter>);
    const agrupar = () => screen.getAllByTitle(/^Agrupar por/)[0] as HTMLSelectElement;

    fireEvent.click(screen.getAllByText('Pasta A')[0]);
    fireEvent.change(agrupar(), { target: { value: 'priority' } });
    expect(agrupar().value).toBe('priority');

    fireEvent.click(screen.getAllByText('Pasta B')[0]);
    expect(agrupar().value).toBe('status'); // a B não herdou o da A

    fireEvent.change(agrupar(), { target: { value: 'assignee' } });
    fireEvent.click(screen.getAllByText('Pasta A')[0]);
    expect(agrupar().value).toBe('priority'); // a A voltou como estava
    fireEvent.click(screen.getAllByText('Pasta B')[0]);
    expect(agrupar().value).toBe('assignee');
  });
});

describe('Responsável: eu sempre na lista', () => {
  it('o filtro de responsável oferece o próprio usuário mesmo sem vir da equipe da loja', () => {
    render(<MemoryRouter><TarefasPage /></MemoryRouter>);
    fireEvent.click(screen.getAllByText('Pasta A')[0]);
    fireEvent.change(screen.getAllByTitle(/^Agrupar por/)[0], { target: { value: 'assignee' } });
    // Sem nenhuma tarefa não há grupo; o que importa é o nome estar entre as opções do filtro.
    fireEvent.click(screen.getAllByRole('button', { name: /Filtr/ })[0]);
    expect(screen.getAllByText('Natalino').length).toBeGreaterThan(0);
  });
});

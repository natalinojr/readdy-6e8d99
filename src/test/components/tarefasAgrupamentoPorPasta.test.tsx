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
    views: [], templates: [], dependencias: [], loading: false, error: null, reload: vi.fn(), write: vi.fn(),
    fetchDetail: vi.fn(), fetchAnexos: vi.fn(), enviarAnexo: vi.fn(), abrirAnexo: vi.fn(),
  }),
}));
// O mural da Visão geral fala com a Edge; aqui não interessa.
vi.mock('@/pages/tarefas/components/visaoGeral/muralApi', async (orig) => ({
  ...(await orig<object>()),
  listarMural: async () => ({ ok: true, data: { items: [], can_edit: false } }),
}));

import TarefasPage from '@/pages/tarefas/page';

/** Pasta-mãe e as origens Minhas/Que atribuí abrem (ou ficam) na Visão geral: estes testes são da Lista. */
const abrirLista = () => fireEvent.click(screen.getAllByRole('button').find((b) => b.textContent?.trim() === 'Lista')!);
const abrirPasta = (nome: string) => { fireEvent.click(screen.getAllByText(nome)[0]); abrirLista(); };

describe('Agrupamento por pasta', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  });

  it('cada pasta lembra o seu agrupamento', () => {
    render(<MemoryRouter><TarefasPage /></MemoryRouter>);
    const agrupar = () => screen.getAllByTitle(/^Agrupar por/)[0] as HTMLSelectElement;

    abrirPasta('Pasta A');
    fireEvent.change(agrupar(), { target: { value: 'priority' } });
    expect(agrupar().value).toBe('priority');

    abrirPasta('Pasta B');
    expect(agrupar().value).toBe('status'); // a B não herdou o da A

    fireEvent.change(agrupar(), { target: { value: 'assignee' } });
    abrirPasta('Pasta A');
    expect(agrupar().value).toBe('priority'); // a A voltou como estava
    abrirPasta('Pasta B');
    expect(agrupar().value).toBe('assignee');
  });
});

describe('Responsável: eu sempre na lista', () => {
  it('o filtro de responsável oferece o próprio usuário mesmo sem vir da equipe da loja', () => {
    render(<MemoryRouter><TarefasPage /></MemoryRouter>);
    abrirPasta('Pasta A');
    fireEvent.change(screen.getAllByTitle(/^Agrupar por/)[0], { target: { value: 'assignee' } });
    // Sem nenhuma tarefa não há grupo; o que importa é o nome estar entre as opções do filtro.
    fireEvent.click(screen.getAllByRole('button', { name: /Filtr/ })[0]);
    expect(screen.getAllByText('Natalino').length).toBeGreaterThan(0);
  });
});

describe('Visão geral', () => {
  beforeEach(() => {
    localStorage.clear();
    window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} })) as unknown as typeof window.matchMedia;
  });

  it('pasta-mãe abre na Visão geral; Minhas tarefas também tem a aba; Todas não', () => {
    render(<MemoryRouter><TarefasPage /></MemoryRouter>);
    const ativa = () => screen.getAllByRole('button').find((b) => b.className.includes('bg-white border border-slate-200 text-indigo-600'))?.textContent?.trim();
    expect(ativa()).toBe('Visão geral'); // a primeira pasta (mãe) já abre nela
    fireEvent.click(screen.getAllByText('Pasta B')[0]);
    expect(ativa()).toBe('Visão geral');
    expect(screen.getByText('Mural da pasta')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Minhas tarefas')[0].closest('button')!);
    expect(ativa()).toBe('Visão geral');
    expect(screen.getByText('Minha carga')).toBeTruthy();
    expect(screen.queryByText('Mural da pasta')).toBeNull();
    fireEvent.click(screen.getAllByText('Todas as tarefas')[0].closest('button')!);
    expect(ativa()).toBe('Lista'); // Todas não tem Visão geral
  });
});

describe('Tarefas que atribuí', () => {
  it('lista o que eu criei e passei pra outra pessoa, agrupado por responsável, com contagem', async () => {
    const mod = await import('@/pages/tarefas/hooks/useTarefas');
    const tarefa = (id: string, extra: Record<string, unknown>) => ({
      id, list_id: 'A', list_name: 'Pasta A', list_color: '#000', parent_task_id: null, title: `T ${id}`, status_id: 'A-s',
      status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null, start_date: null, due_date: null,
      due_has_time: false, sort_order: 0, recurrence: null, completed_at: null, created_at: '2026-09-01T12:00:00Z',
      created_by: 'eu', tags: [], checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
      time_estimate_minutes: null, time_tracked_seconds: 0, timer_started_at: null, ...extra,
    });
    vi.spyOn(mod, 'useTarefas').mockReturnValue({
      lists: [lista('A', 'Pasta A')], tags: [], campos: [], notificacoes: [], views: [], templates: [], dependencias: [],
      loading: false, error: null, reload: vi.fn(), write: vi.fn(), fetchDetail: vi.fn(), fetchAnexos: vi.fn(),
      enviarAnexo: vi.fn(), abrirAnexo: vi.fn(),
      tasks: [
        tarefa('delegada', { assignee_id: 'ana', assignee_name: 'Ana Souza', due_date: '2020-01-01T12:00:00Z' }),
        tarefa('minha', { assignee_id: 'eu', assignee_name: 'Natalino' }),
        tarefa('dos-outros', { created_by: 'bruno', assignee_id: 'ana', assignee_name: 'Ana Souza' }),
      ],
    } as never);
    render(<MemoryRouter><TarefasPage /></MemoryRouter>);
    const botao = screen.getAllByText('Tarefas que atribuí')[0].closest('button')!;
    expect(botao.textContent).toContain('1'); // 1 em aberto (e atrasada)
    fireEvent.click(botao);
    abrirLista();
    expect(screen.getByText('T delegada')).toBeTruthy();
    expect(screen.queryByText('T minha')).toBeNull();
    expect(screen.queryByText('T dos-outros')).toBeNull();
    expect(screen.getAllByText('Ana Souza').length).toBeGreaterThan(0); // grupo do responsável
  });
});

// Lista de Tarefas: menus das células abrem direto no clique, comentário pela
// coluna, ordenação pelo título e largura ajustável da coluna.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import ViewLista from '@/pages/tarefas/components/ViewLista';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';

const lista = {
  id: 'L1', name: 'Pasta', color: '#000',
  statuses: [{ id: 'S1', name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 }],
} as unknown as TaskList;

function tarefa(id: string, title: string, extra: Partial<TaskRow> = {}): TaskRow {
  return {
    id, list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null, title,
    status_id: 'S1', status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null,
    start_date: null, due_date: null, due_has_time: false, sort_order: 0, recurrence: null,
    completed_at: null, created_at: '2026-09-01T12:00:00Z', created_by: null, tags: [],
    checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
    ...extra,
  } as TaskRow;
}

const tasks = [
  tarefa('a', 'Tarefa Alta', { priority: 3 }),
  tarefa('b', 'Tarefa Sem'),
  tarefa('c', 'Tarefa Urgente', { priority: 4 }),
];

function montar(write = vi.fn().mockResolvedValue({ success: true })) {
  render(
    <ViewLista
      list={lista} tasks={tasks} campos={[]} tags={[]}
      usuarios={[{ id: 'u1', nome: 'Maria Silva' }]}
      groupBy="status" write={write} onOpenTask={vi.fn()}
    />,
  );
  return write;
}

const titulos = () => screen.getAllByText(/^Tarefa /).map((el) => el.textContent);

// jsdom não tem PointerEvent — sem isto o clientX do arraste chega undefined.
if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;

describe('ViewLista (tarefas)', () => {
  beforeEach(() => localStorage.clear());

  it('ordena pela coluna ao clicar no título: asc → desc → ordem original', () => {
    montar();
    expect(titulos()).toEqual(['Tarefa Alta', 'Tarefa Sem', 'Tarefa Urgente']);
    const cab = screen.getByRole('button', { name: 'Prioridade' });
    fireEvent.click(cab);
    expect(titulos()).toEqual(['Tarefa Alta', 'Tarefa Urgente', 'Tarefa Sem']);
    fireEvent.click(cab);
    expect(titulos()).toEqual(['Tarefa Urgente', 'Tarefa Alta', 'Tarefa Sem']);
    fireEvent.click(cab);
    expect(titulos()).toEqual(['Tarefa Alta', 'Tarefa Sem', 'Tarefa Urgente']);
  });

  it('clique no responsável abre a lista direto e grava ao escolher', () => {
    const write = montar();
    const linha = screen.getByText('Tarefa Sem').parentElement!;
    const celulas = within(linha).getAllByRole('button').filter((b) => b.textContent === '—');
    fireEvent.click(celulas[0]); // Responsável é a primeira coluna padrão
    fireEvent.click(screen.getByText('Maria Silva'));
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'b', assignee_id: 'u1' });
  });

  it('coluna de comentários aceita digitar direto', async () => {
    localStorage.setItem('erpos_tarefas_colunas_L1', JSON.stringify(['comentarios']));
    const write = montar();
    const linha = screen.getByText('Tarefa Sem').parentElement!;
    fireEvent.click(within(linha).getByText('Comentar'));
    const input = screen.getByPlaceholderText(/coment/i);
    fireEvent.change(input, { target: { value: 'Olá' } });
    expect(document.activeElement).toBe(input);
    fireEvent.submit(input.closest('form')!);
    await vi.waitFor(() =>
      expect(write).toHaveBeenCalledWith('add_comment', { task_id: 'b', body: 'Olá', mentions: [] }));
  });

  it('arrastar a borda do título muda a largura e salva', () => {
    montar();
    const alca = screen.getAllByTitle(/Arraste para ajustar/)[0];
    fireEvent.pointerDown(alca, { clientX: 500 });
    fireEvent.pointerMove(window, { clientX: 440 });
    fireEvent.pointerUp(window);
    const salvo = JSON.parse(localStorage.getItem('erpos_tarefas_larguras_L1') ?? '{}');
    expect(salvo.responsavel).toBe(200); // 140 + 60
  });
});

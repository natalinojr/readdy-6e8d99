// Janela da tarefa: tempo estimado e cronômetro dentro dela.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import TaskDrawer from '@/pages/tarefas/components/TaskDrawer';
import type { TaskDetail, TaskRow } from '@/pages/tarefas/hooks/useTarefas';

const detalhe = {
  id: 't1', list_id: 'L1', parent_task_id: null, title: 'Trocar filtro', description: null, status_id: 'S1',
  priority: 0, assignee_id: null, assignee_name: null, start_date: null, due_date: null, due_has_time: false,
  recurrence: null, completed_at: null, created_at: '2026-09-20T12:00:00Z', created_by: 'u1', created_by_name: 'Natalino',
  tags: [], checklist: [], comments: [], activity: [], subtasks: [], field_values: {},
} as TaskDetail;

const linha = {
  id: 't1', list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null, title: 'Trocar filtro',
  status_id: 'S1', status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null, start_date: null,
  due_date: null, due_has_time: false, sort_order: 0, recurrence: null, completed_at: null, created_at: '2026-09-20T12:00:00Z',
  created_by: 'u1', tags: [], checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
  time_estimate_minutes: 90, time_tracked_seconds: 1800, timer_started_at: null,
} as TaskRow;

describe('TaskDrawer: tempo', () => {
  it('mostra estimado e cronometrado; play inicia; estimado abre o editor', async () => {
    const write = vi.fn().mockResolvedValue({ success: true });
    render(
      <TaskDrawer
        taskId="t1" task={linha} lists={[]} tags={[]} campos={[]} templates={[]} usuarios={[]} write={write}
        fetchDetail={vi.fn().mockResolvedValue(detalhe)} fetchAnexos={vi.fn().mockResolvedValue([])}
        enviarAnexo={vi.fn()} abrirAnexo={vi.fn()} onClose={vi.fn()}
      />,
    );
    expect(await screen.findByText('1h 30m')).toBeTruthy(); // estimado
    expect(screen.getByText('30m')).toBeTruthy();           // cronometrado
    fireEvent.click(screen.getByTitle('Iniciar'));
    expect(write).toHaveBeenCalledWith('start_timer', { task_id: 't1' });

    fireEvent.click(screen.getByText('1h 30m'));
    expect(screen.getByPlaceholderText(/1h30/)).toBeTruthy();
  });
});

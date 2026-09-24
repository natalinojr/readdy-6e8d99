// Tarefas com mais de um responsável.
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import ViewLista from '@/pages/tarefas/components/ViewLista';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { agruparTarefas, aplicarFiltros, FILTROS_VAZIOS } from '@/pages/tarefas/lib/agrupamento';
import { calcularCarga, minutosNoDia, CAPACIDADE_PADRAO } from '@/pages/tarefas/lib/carga';
import { responsaveis, rotuloResponsaveis } from '@/pages/tarefas/lib/responsaveis';

const lista = { id: 'L1', name: 'Pasta', color: '#000', statuses: [{ id: 'S1', name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 }] } as unknown as TaskList;
const t = (id: string, extra: Partial<TaskRow> = {}) => ({
  id, list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null, title: `Tarefa ${id}`, status_id: 'S1',
  status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null, start_date: null, due_date: null,
  due_has_time: false, sort_order: 0, recurrence: null, completed_at: null, created_at: '2026-09-01T12:00:00Z',
  created_by: 'eu', tags: [], checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
  time_estimate_minutes: null, time_tracked_seconds: 0, timer_started_at: null, ...extra,
}) as TaskRow;
const dupla = { assignee_id: 'ana', assignee_name: 'Ana Souza', assignees: [{ id: 'ana', name: 'Ana Souza' }, { id: 'bruno', name: 'Bruno Lima' }] };

describe('vários responsáveis', () => {
  it('tarefa antiga (só o principal) continua funcionando', () => {
    expect(responsaveis(t('x', { assignee_id: 'ana', assignee_name: 'Ana Souza' }))).toEqual([{ id: 'ana', name: 'Ana Souza' }]);
    expect(rotuloResponsaveis(t('x', dupla))).toBe('Ana e Bruno');
  });

  it('aparece no grupo de cada responsável e o filtro acha por qualquer um', () => {
    const grupos = agruparTarefas([t('a', dupla)], 'assignee', lista, [], []);
    expect(grupos.filter((g) => g.tasks.length).map((g) => g.label)).toEqual(['Ana Souza', 'Bruno Lima']);
    expect(aplicarFiltros([t('a', dupla)], { ...FILTROS_VAZIOS, assigneeIds: ['bruno'] })).toHaveLength(1);
  });

  it('na Carga o tempo é dividido entre os responsáveis', () => {
    const r = calcularCarga([t('a', { ...dupla, time_estimate_minutes: 120, due_date: '2026-09-25T12:00:00Z' })], new Date(2026, 8, 23), () => CAPACIDADE_PADRAO);
    expect(minutosNoDia(r, 'ana', '2026-09-25')).toBe(60);
    expect(minutosNoDia(r, 'bruno', '2026-09-25')).toBe(60);
  });

  it('menu de responsável marca vários e grava a lista a cada toque', () => {
    const write = vi.fn().mockResolvedValue({ success: true });
    render(<ViewLista list={lista} tasks={[t('a')]} campos={[]} tags={[]} groupBy="status" write={write} onOpenTask={vi.fn()}
      usuarios={[{ id: 'ana', nome: 'Ana Souza' }, { id: 'bruno', nome: 'Bruno Lima' }]} />);
    const linha = screen.getByText('Tarefa a').closest('.group') as HTMLElement;
    fireEvent.click(within(linha).getAllByText('—')[0]);
    fireEvent.click(screen.getByText('Ana Souza'));
    fireEvent.click(screen.getByText('Bruno Lima'));
    expect(write).toHaveBeenLastCalledWith('update_task', { task_id: 'a', assignee_ids: ['ana', 'bruno'] });
    expect(screen.getByText('principal')).toBeTruthy();
    fireEvent.click(screen.getByText('Pronto'));
  });
});

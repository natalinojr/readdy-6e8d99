import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const rpc = vi.hoisted(() => vi.fn(() => Promise.resolve({ data: {}, error: null })));
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ViewLinhaTempo from '@/pages/tarefas/components/linhaTempo/ViewLinhaTempo';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';

const hoje = new Date();
const dia = (n: number) => {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const tarefa = (id: string, extra: Partial<TaskRow> = {}): TaskRow => ({
  id, list_id: 'l1', list_name: 'Cozinha', list_color: '#f59e0b', parent_task_id: null, title: `Tarefa ${id}`,
  status_id: 's1', status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null, assignees: [],
  start_date: null, due_date: null, due_has_time: false, sort_order: 0, recurrence: null, completed_at: null,
  created_at: '2026-09-01T00:00:00Z', created_by: null, tags: [], checklist_total: 0, checklist_done: 0,
  subtask_total: 0, comment_count: 0, field_values: {}, time_estimate_minutes: null, time_tracked_seconds: 0,
  timer_started_at: null, ...extra,
} as TaskRow);
const lists = [{
  id: 'l1', name: 'Cozinha', color: '#f59e0b', icon: null, sort_order: 0, parent_list_id: null, open_count: 0, access: 'owner',
  statuses: [{ id: 's1', name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 }],
}] as TaskList[];

const montar = (tasks: TaskRow[], write = vi.fn(() => Promise.resolve({ success: true })), onOpenTask = vi.fn()) => {
  render(
    <ViewLinhaTempo
      list={null}
      lists={lists}
      tasks={tasks}
      usuarios={[{ id: 'u1', nome: 'Ana' }]}
      write={write}
      onOpenTask={onOpenTask}
      chave={`teste-${Math.random()}`}
      agruparPadrao="pessoa"
    />,
  );
  return { write, onOpenTask };
};

// jsdom não tem PointerEvent: o suficiente para o arrasto (pointerId/pointerType).
class PointerEventFake extends MouseEvent {
  pointerId: number;
  pointerType: string;
  constructor(tipo: string, init: PointerEventInit = {}) {
    super(tipo, init);
    this.pointerId = init.pointerId ?? 0;
    this.pointerType = init.pointerType ?? 'mouse';
  }
}
if (!('PointerEvent' in window)) (window as unknown as { PointerEvent: unknown }).PointerEvent = PointerEventFake;

describe('Linha do tempo (tela)', () => {
  beforeEach(() => { localStorage.clear(); rpc.mockClear(); });

  it('agrupa por pessoa, mostra atraso e não esconde a tarefa sem data', () => {
    montar([
      tarefa('a', { title: 'Trocar óleo', assignee_id: 'u1', assignees: [{ id: 'u1', name: 'Ana' }], due_date: `${dia(-2)}T12:00:00Z` }),
      tarefa('b', { title: 'Pintar parede', assignee_id: 'u1', assignees: [{ id: 'u1', name: 'Ana' }] }),
      tarefa('c', { title: 'Revisar extintores', due_date: `${dia(3)}T12:00:00Z` }),
    ]);
    expect(screen.getAllByText('Ana').length).toBeGreaterThan(0);
    expect(screen.getByText('Sem responsável')).toBeTruthy();
    expect(screen.getAllByText(/2d atrasada/).length).toBeGreaterThan(0);
    // Sem data: contador no topo e gaveta no grupo — não some.
    expect(screen.getByText('1 sem data', { selector: 'button' })).toBeTruthy();
    fireEvent.click(screen.getByText('1 sem data', { selector: 'span' }));
    expect(screen.getByText('Pintar parede')).toBeTruthy();
  });

  it('clicar na barra abre a tarefa (sem gravar nada)', () => {
    const { write, onOpenTask } = montar([tarefa('a', { title: 'Trocar óleo', due_date: `${dia(1)}T12:00:00Z` })]);
    const barra = document.querySelector('[data-barra]')!.firstElementChild!;
    barra.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse', button: 0, pointerId: 1, clientX: 100, clientY: 10 }));
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, clientX: 100, clientY: 10 }));
    expect(onOpenTask).toHaveBeenCalledWith('a');
    expect(write).not.toHaveBeenCalled();
  });

  it('pasta só para ver: a barra não tem alças de esticar', () => {
    montar([tarefa('a', { list_id: 'l2', due_date: `${dia(1)}T12:00:00Z`, start_date: dia(-1) })]);
    expect(screen.queryByTitle('Arraste para mudar o vencimento')).toBeTruthy(); // pasta fora da minha lista: o backend decide
    lists.push({ ...lists[0], id: 'l2', access: 'view' } as TaskList);
    try {
      montar([tarefa('b', { list_id: 'l2', due_date: `${dia(1)}T12:00:00Z`, start_date: dia(-1) })]);
      expect(screen.getAllByTitle('Arraste para mudar o vencimento')).toHaveLength(1); // só a da 1ª montagem
    } finally {
      lists.pop();
    }
  });
});

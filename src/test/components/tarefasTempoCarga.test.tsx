// Tarefas: tempo estimado, cronômetro (total do grupo) e cálculo da Carga de trabalho.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ error: vi.fn(), success: vi.fn() }) }));

import ViewLista from '@/pages/tarefas/components/ViewLista';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { lerDuracao, formatarDuracao } from '@/pages/tarefas/lib/tempo';
import { calcularCarga, minutosNoDia, CAPACIDADE_PADRAO, type Capacidade } from '@/pages/tarefas/lib/carga';

const lista = {
  id: 'L1', name: 'Pasta', color: '#000',
  statuses: [{ id: 'S1', name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 }],
} as unknown as TaskList;

function tarefa(id: string, extra: Partial<TaskRow> = {}): TaskRow {
  return {
    id, list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null, title: `Tarefa ${id}`,
    status_id: 'S1', status_category: 'todo', priority: 0, assignee_id: 'u1', assignee_name: 'Maria',
    start_date: null, due_date: null, due_has_time: false, sort_order: 0, recurrence: null,
    completed_at: null, created_at: '2026-09-01T12:00:00Z', created_by: null, tags: [],
    checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
    time_estimate_minutes: null, time_tracked_seconds: 0, timer_started_at: null,
    ...extra,
  };
}

describe('lerDuracao', () => {
  it.each([
    ['1h30', 90], ['1h 30m', 90], ['1:30', 90], ['90m', 90], ['90', 90], ['1,5h', 90],
    ['2h', 120], ['45min', 45], ['1d', 480], ['1d2h', 600],
  ])('"%s" = %i min', (texto, min) => expect(lerDuracao(texto)).toBe(min));

  it.each(['abc', 'h', '1x'])('"%s" não é duração', (texto) => expect(lerDuracao(texto)).toBeNull());

  it('formata', () => {
    expect(formatarDuracao(5400)).toBe('1h 30m');
    expect(formatarDuracao(7200)).toBe('2h');
    expect(formatarDuracao(600)).toBe('10m');
  });
});

describe('calcularCarga', () => {
  // quarta-feira, 23/09/2026
  const hoje = new Date(2026, 8, 23);
  const cap = (): Capacidade => CAPACIDADE_PADRAO;

  it('estimativa sem início cai inteira no dia do prazo', () => {
    const r = calcularCarga([tarefa('a', { time_estimate_minutes: 120, due_date: '2026-09-25T12:00:00Z' })], hoje, cap);
    expect(minutosNoDia(r, 'u1', '2026-09-25')).toBe(120);
  });

  it('conta só o que falta (estimado − cronometrado)', () => {
    const r = calcularCarga([tarefa('a', { time_estimate_minutes: 120, time_tracked_seconds: 3600, due_date: '2026-09-25T12:00:00Z' })], hoje, cap);
    expect(minutosNoDia(r, 'u1', '2026-09-25')).toBe(60);
  });

  it('espalha do início ao prazo pelos dias de trabalho, pulando a folga', () => {
    // sex 25 → seg 28: sábado e domingo têm capacidade 0
    const r = calcularCarga([tarefa('a', { time_estimate_minutes: 240, start_date: '2026-09-25', due_date: '2026-09-28T12:00:00Z' })], hoje, cap);
    expect(minutosNoDia(r, 'u1', '2026-09-25')).toBe(120);
    expect(minutosNoDia(r, 'u1', '2026-09-26')).toBe(0);
    expect(minutosNoDia(r, 'u1', '2026-09-28')).toBe(120);
  });

  it('proporcional à capacidade do dia (meio período recebe metade)', () => {
    const meio = (): Capacidade => [0, 8, 8, 8, 8, 4, 0]; // sexta = 4h
    const r = calcularCarga([tarefa('a', { time_estimate_minutes: 180, start_date: '2026-09-24', due_date: '2026-09-25T12:00:00Z' })], hoje, meio);
    expect(minutosNoDia(r, 'u1', '2026-09-24')).toBe(120);
    expect(minutosNoDia(r, 'u1', '2026-09-25')).toBe(60);
  });

  it('atrasada conta em hoje; sem estimativa, sem prazo e concluída ficam fora', () => {
    const r = calcularCarga([
      tarefa('atrasada', { time_estimate_minutes: 60, due_date: '2026-09-20T12:00:00Z' }),
      tarefa('semEst', { due_date: '2026-09-25T12:00:00Z' }),
      tarefa('semData', { time_estimate_minutes: 30 }),
      tarefa('feita', { time_estimate_minutes: 30, due_date: '2026-09-25T12:00:00Z', status_category: 'done' }),
    ], hoje, cap);
    expect(minutosNoDia(r, 'u1', '2026-09-23')).toBe(60);
    expect(r.atrasadas.map((t) => t.id)).toEqual(['atrasada']);
    expect(r.semEstimativa.map((t) => t.id)).toEqual(['semEst']);
    expect(r.semData.map((t) => t.id)).toEqual(['semData']);
    expect(minutosNoDia(r, 'u1', '2026-09-25')).toBe(0);
  });
});

describe('Lista: colunas de tempo', () => {
  beforeEach(() => localStorage.clear());

  function montar(tasks: TaskRow[], write = vi.fn().mockResolvedValue({ success: true })) {
    localStorage.setItem('erpos_tarefas_colunas_L1', JSON.stringify(['estimado', 'cronometro']));
    render(
      <ViewLista list={lista} tasks={tasks} campos={[]} tags={[]} usuarios={[]}
        groupBy="status" write={write} onOpenTask={vi.fn()} />,
    );
    return write;
  }

  it('soma estimado e cronometrado no fim do grupo, incluindo subtarefas', () => {
    montar([
      tarefa('a', { time_estimate_minutes: 60, time_tracked_seconds: 1800 }),
      tarefa('b', { time_estimate_minutes: 30 }),
      tarefa('c'),
      tarefa('sub', { parent_task_id: 'a', time_estimate_minutes: 30, time_tracked_seconds: 600 }),
    ]);
    const total = screen.getByText('Total').parentElement!;
    expect(within(total).getByText('2h')).toBeTruthy();          // 60 + 30 + 30
    expect(within(total).getByText(/40m/)).toBeTruthy();        // 30m + 10m
    expect(within(total).getByText(/1 sem estimativa/)).toBeTruthy();
  });

  it('play na linha inicia o cronômetro e o estimado grava pelo texto', () => {
    const write = montar([tarefa('a')]);
    fireEvent.click(screen.getByTitle('Iniciar cronômetro'));
    expect(write).toHaveBeenCalledWith('start_timer', { task_id: 'a' });

    const linha = screen.getByText('Tarefa a').parentElement!;
    fireEvent.click(within(linha).getAllByText('—')[0]);
    const input = screen.getByPlaceholderText(/1h30/);
    fireEvent.change(input, { target: { value: '1h30' } });
    fireEvent.submit(input.closest('form')!);
    expect(write).toHaveBeenCalledWith('update_task', { task_id: 'a', time_estimate_minutes: 90 });
  });
});

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('@/lib/supabase', () => ({ supabase: { rpc } }));
vi.mock('@/contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));

import ViewCarga from '@/pages/tarefas/components/ViewCarga';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { calcularCarga, minutosNoDia, CAPACIDADE_PADRAO } from '@/pages/tarefas/lib/carga';
import { moverDia, sugerirRedistribuicao, trocarPessoa } from '@/pages/tarefas/lib/cargaAcoes';

const tarefa = (id: string, extra: Partial<TaskRow> = {}): TaskRow => ({
  id, list_id: 'l1', parent_task_id: null, title: `Tarefa ${id}`, description: null,
  status_id: 's1', status_name: 'A fazer', status_color: '#999', status_category: 'todo', priority: 0,
  assignee_id: null, assignee_name: null, start_date: null, due_date: null, due_has_time: false,
  sort_order: 0, recurrence: null, completed_at: null, created_at: '2026-09-01T00:00:00Z', created_by: null,
  tags: [], checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
  time_estimate_minutes: null, time_tracked_seconds: 0, timer_started_at: null,
  ...extra,
} as TaskRow);

describe('trocarPessoa', () => {
  it('troca só aquela pessoa e mantém as outras', () => {
    const t = tarefa('a', { assignee_id: 'u1', assignees: [{ id: 'u1', name: 'A' }, { id: 'u2', name: 'B' }] });
    expect(trocarPessoa(t, 'u1', 'u3')).toEqual(['u2', 'u3']);
    expect(trocarPessoa(t, 'u1', 'u2')).toEqual(['u2']);
    expect(trocarPessoa(tarefa('b'), '__sem_responsavel', 'u9')).toEqual(['u9']);
  });
});

describe('moverDia', () => {
  it('tarefa de um dia: muda o vencimento', () => {
    expect(moverDia(tarefa('a', { due_date: '2026-09-24T12:00:00Z' }), '2026-09-24', '2026-09-26'))
      .toEqual({ due_date: '2026-09-26T12:00:00Z', due_has_time: false });
  });
  it('vários dias sem plano: o período anda junto', () => {
    expect(moverDia(tarefa('a', { start_date: '2026-09-22', due_date: '2026-09-24T12:00:00Z' }), '2026-09-23', '2026-09-25'))
      .toEqual({ due_date: '2026-09-26T12:00:00Z', due_has_time: false, start_date: '2026-09-24' });
  });
  it('com horas por dia: leva só os minutos do dia e ajusta início/fim', () => {
    const t = tarefa('a', {
      start_date: '2026-09-22', due_date: '2026-09-24T12:00:00Z',
      time_plan: { dias: { '2026-09-22': 60, '2026-09-23': 120, '2026-09-24': 60 } },
    });
    expect(moverDia(t, '2026-09-24', '2026-09-25')).toEqual({
      time_plan: { dias: { '2026-09-22': 60, '2026-09-23': 120, '2026-09-25': 60 } },
      due_date: '2026-09-25T12:00:00Z', due_has_time: false, start_date: '2026-09-22',
    });
  });
});

describe('sugerirRedistribuicao', () => {
  it('sugere a maior tarefa aberta pra quem tem mais folga', () => {
    const p = (id: string, minutos: number, concluida = false) => ({ task: tarefa(id), minutos, feitos: concluida ? minutos : 0, atrasada: false, concluida });
    const s = sugerirRedistribuicao([p('a', 60), p('b', 180), p('c', 240, true)], 120, ['u2', 'u3'], (x) => (x === 'u2' ? 200 : 100));
    expect(s[0].parcela.task.id).toBe('b');
    expect(s[0].para).toBe('u2');
    expect(s[0].sobra).toBe(20);
    expect(sugerirRedistribuicao([p('a', 60)], 0, ['u2'], () => 999)).toEqual([]);
  });
});

describe('folga no dia', () => {
  it('dia de folga não recebe horas: vão pros outros dias do período', () => {
    const hoje = new Date(2026, 8, 21); // segunda
    const t = tarefa('a', { assignee_id: 'u1', time_estimate_minutes: 480, start_date: '2026-09-21', due_date: '2026-09-22T12:00:00Z' });
    const semFolga = calcularCarga([t], hoje, () => CAPACIDADE_PADRAO);
    expect(minutosNoDia(semFolga, 'u1', '2026-09-21')).toBe(240);
    const comFolga = calcularCarga([t], hoje, () => CAPACIDADE_PADRAO, (p, d) => (p === 'u1' && d === '2026-09-21' ? 0 : undefined));
    expect(minutosNoDia(comFolga, 'u1', '2026-09-21')).toBe(0);
    expect(minutosNoDia(comFolga, 'u1', '2026-09-22')).toBe(480);
  });
});

describe('ViewCarga: totais da equipe e agrupar por pasta', () => {
  beforeEach(() => { localStorage.clear(); rpc.mockReset(); rpc.mockResolvedValue({ data: {}, error: null }); });

  it('mostra a linha Equipe e troca para uma linha por pasta', async () => {
    const hojeIso = new Date().toISOString();
    render(<ViewCarga
      tasks={[
        tarefa('a', { assignee_id: 'u1', assignee_name: 'Ana', time_estimate_minutes: 60, due_date: hojeIso }),
        tarefa('b', { assignee_id: 'u2', assignee_name: 'Bia', time_estimate_minutes: 120, due_date: hojeIso, list_id: 'l2' }),
      ]}
      lists={[
        { id: 'l1', name: 'Cozinha', color: '#f00', icon: null, sort_order: 0, parent_list_id: null, statuses: [], open_count: 0 },
        { id: 'l2', name: 'Salão', color: '#0f0', icon: null, sort_order: 1, parent_list_id: null, statuses: [], open_count: 0 },
      ]}
      usuarios={[]} write={vi.fn().mockResolvedValue({ success: true })} onOpenTask={vi.fn()} />);

    const equipe = (await screen.findByText('Equipe')).closest('td')!;
    expect(within(equipe).getByText(/3h/)).toBeTruthy();
    expect(rpc).toHaveBeenCalledWith('fn_get_task_absences', expect.objectContaining({ p_user_ids: ['u1', 'u2'] }));

    fireEvent.click(screen.getByRole('button', { name: /Pastas/ }));
    expect(await screen.findByText('Todas as pastas')).toBeTruthy();
    expect(screen.getAllByText('Salão').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Cozinha').length).toBeGreaterThan(0);
  });

  it('marca folga no dia pelo painel', async () => {
    const write = vi.fn().mockResolvedValue({ success: true });
    const hojeIso = new Date().toISOString();
    render(<ViewCarga
      tasks={[tarefa('a', { assignee_id: 'u1', assignee_name: 'Ana', time_estimate_minutes: 60, due_date: hojeIso })]}
      usuarios={[]} write={write} onOpenTask={vi.fn()} />);
    const mini = await screen.findByTitle(/Tarefa a — 1h/);
    fireEvent.click(mini.closest('[role=button]')!);
    fireEvent.click(await screen.findByText('Marcar folga neste dia'));
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('set_absence', expect.objectContaining({ user_id: 'u1', horas: 0 })));
  });
});

describe('ocupacaoRestante (régua do aviso de sobrecarga)', () => {
  it('soma o que falta e as horas disponíveis, com folga contando zero', async () => {
    const { ocupacaoRestante } = await import('@/pages/tarefas/lib/carga');
    const hoje = new Date(2026, 8, 21); // segunda
    const ate = new Date(2026, 8, 27);
    const t = tarefa('a', { assignee_id: 'u1', time_estimate_minutes: 2700, start_date: '2026-09-21', due_date: '2026-09-25T12:00:00Z' });
    const folga = (p: string, d: string) => (d === '2026-09-23' ? 0 : undefined);
    const r = calcularCarga([t], hoje, () => CAPACIDADE_PADRAO, folga);
    const o = ocupacaoRestante(r, 'u1', hoje, ate, CAPACIDADE_PADRAO, folga);
    expect(o.faltam).toBe(2700);
    expect(o.disponivel).toBe(4 * 8 * 60); // 5 dias úteis − 1 folga
    expect(o.faltam > o.disponivel * 1.1).toBe(true);
  });
});

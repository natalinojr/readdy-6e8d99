import { describe, it, expect } from 'vitest';
import { estimativasEfetivas } from '@/pages/tarefas/lib/tempo';
import { calcularCarga, CAPACIDADE_PADRAO } from '@/pages/tarefas/lib/carga';

const t = (id: string, min: number | null, parent: string | null = null, status: 'todo' | 'done' | 'cancelled' = 'todo') =>
  ({ id, parent_task_id: parent, time_estimate_minutes: min, status_category: status });

describe('estimativa da tarefa-pai = soma das subtarefas', () => {
  it('soma só as subtarefas estimadas e ignora a própria', () => {
    const m = estimativasEfetivas([t('p', 120), t('a', 30, 'p'), t('b', null, 'p'), t('c', 45, 'p')]);
    expect(m.get('p')).toEqual({ minutos: 75, somada: true });
    expect(m.get('b')).toEqual({ minutos: null, somada: false });
  });

  it('sem subtarefa estimada vale a própria; cancelada não soma; neto sobe até a raiz', () => {
    expect(estimativasEfetivas([t('p', 60), t('a', null, 'p')]).get('p')).toEqual({ minutos: 60, somada: false });
    expect(estimativasEfetivas([t('p', 60), t('a', 30, 'p', 'cancelled')]).get('p')).toEqual({ minutos: 60, somada: false });
    expect(estimativasEfetivas([t('p', 10), t('m', null, 'p'), t('n', 20, 'm')]).get('p')).toEqual({ minutos: 20, somada: true });
  });

  it('Carga não conta a pai de novo quando a subtarefa tem estimativa', () => {
    const base = { start_date: null, due_date: '2026-10-05T12:00:00Z', assignee_id: 'u1' };
    const r = calcularCarga(
      [{ ...t('p', 120), ...base }, { ...t('a', 30, 'p'), ...base }],
      new Date(2026, 9, 1), () => CAPACIDADE_PADRAO,
    );
    const total = [...r.porPessoa.values()].flatMap((m) => [...m.values()].flat()).reduce((s, p) => s + p.minutos, 0);
    expect(Math.round(total)).toBe(30);
  });
});

describe('tempo padrão do responsável', () => {
  it('tarefa sem tempo vale o padrão; com tempo próprio, não; subtarefas com padrão somam na pai', () => {
    const padrao = () => 30;
    const m = estimativasEfetivas([t('a', null), t('b', 90), t('p', null), t('s1', null, 'p'), t('s2', 15, 'p')], padrao);
    expect(m.get('a')).toEqual({ minutos: 30, somada: false, padrao: true });
    expect(m.get('b')).toEqual({ minutos: 90, somada: false });
    expect(m.get('p')).toEqual({ minutos: 45, somada: true }); // s1 = 30 (padrão) + s2 = 15
  });
});

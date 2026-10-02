import { describe, expect, it } from 'vitest';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import {
  atrasoDaTarefa, criaCiclo, empurrarSeguintes, marcasCabecalho, montarLinhas, payloadDoPeriodo,
  periodoDaTarefa, periodoRapido, planoParaPeriodo, progressoDaTarefa, puxarPonta,
  type Dependencia, type Periodo,
} from '@/pages/tarefas/lib/gantt';

const t = (id: string, extra: Partial<TaskRow> = {}) => ({
  id, title: id, list_id: 'p', parent_task_id: null, start_date: null, due_date: null, due_has_time: false,
  status_category: 'todo', sort_order: 0, assignee_id: null, assignees: [], checklist_total: 0, checklist_done: 0,
  time_estimate_minutes: null, time_tracked_seconds: 0, completed_at: null, time_plan: null, ...extra,
}) as unknown as TaskRow;
const P = (inicio: string, fim: string): Periodo => ({ inicio, fim });

describe('cronograma: período da tarefa', () => {
  it('início → vencimento; só vencimento ou só início = um dia', () => {
    expect(periodoDaTarefa({ start_date: '2026-10-01', due_date: '2026-10-05T12:00:00Z' })).toEqual(P('2026-10-01', '2026-10-05'));
    expect(periodoDaTarefa({ start_date: null, due_date: '2026-10-05T12:00:00Z' })).toEqual(P('2026-10-05', '2026-10-05'));
    expect(periodoDaTarefa({ start_date: '2026-10-03', due_date: null })).toEqual(P('2026-10-03', '2026-10-03'));
    expect(periodoDaTarefa({ start_date: '2026-10-09', due_date: '2026-10-05T12:00:00Z' })).toEqual(P('2026-10-05', '2026-10-05'));
    expect(periodoDaTarefa({ start_date: null, due_date: null })).toBeNull();
  });

  it('puxar a ponta nunca inverte o período', () => {
    expect(puxarPonta(P('2026-10-01', '2026-10-05'), 'inicio', 10)).toEqual(P('2026-10-05', '2026-10-05'));
    expect(puxarPonta(P('2026-10-01', '2026-10-05'), 'fim', -10)).toEqual(P('2026-10-01', '2026-10-01'));
    expect(puxarPonta(P('2026-10-01', '2026-10-05'), 'fim', 2)).toEqual(P('2026-10-01', '2026-10-07'));
  });

  it('grava um dia só sem start_date e mantém a hora do vencimento', () => {
    expect(payloadDoPeriodo({ due_date: null, due_has_time: false }, P('2026-10-02', '2026-10-02')))
      .toEqual({ start_date: null, due_date: '2026-10-02T12:00:00Z', due_has_time: false });
    const comHora = payloadDoPeriodo({ due_date: new Date('2026-10-02T15:30:00').toISOString(), due_has_time: true }, P('2026-10-04', '2026-10-06'));
    expect(comHora.start_date).toBe('2026-10-04');
    expect(comHora.due_has_time).toBe(true);
    const d = new Date(comHora.due_date!);
    expect([d.getDate(), d.getHours(), d.getMinutes()]).toEqual([6, 15, 30]);
  });

  it('tarefa só com início continua só com início ao mover', () => {
    expect(payloadDoPeriodo({ due_date: null, due_has_time: false, start_date: '2026-10-01' }, P('2026-10-03', '2026-10-03')))
      .toEqual({ start_date: '2026-10-03', due_date: null, due_has_time: false });
    // esticou: vira período com vencimento
    expect(payloadDoPeriodo({ due_date: null, due_has_time: false, start_date: '2026-10-01' }, P('2026-10-01', '2026-10-03')).due_date)
      .toBe('2026-10-03T12:00:00Z');
  });

  it('atalhos: esta semana vai até sábado; próxima semana = seg a sáb', () => {
    // 2026-10-02 é sexta-feira
    expect(periodoRapido('semana', '2026-10-02')).toEqual(P('2026-10-02', '2026-10-03'));
    expect(periodoRapido('proxima', '2026-10-02')).toEqual(P('2026-10-05', '2026-10-10'));
    expect(periodoRapido('amanha', '2026-10-02')).toEqual(P('2026-10-03', '2026-10-03'));
  });
});

describe('cronograma: ligações', () => {
  const deps: Dependencia[] = [
    { predecessor_id: 'a', successor_id: 'b' },
    { predecessor_id: 'b', successor_id: 'c' },
  ];

  it('recusa ciclo, direto ou por cadeia', () => {
    expect(criaCiclo(deps, 'c', 'a')).toBe(true);
    expect(criaCiclo(deps, 'b', 'a')).toBe(true);
    expect(criaCiclo(deps, 'a', 'a')).toBe(true);
    expect(criaCiclo(deps, 'a', 'c')).toBe(false);
  });

  it('empurra a cadeia só o necessário, nunca para trás', () => {
    const periodos = new Map([
      ['a', P('2026-10-01', '2026-10-02')],
      ['b', P('2026-10-03', '2026-10-04')],
      ['c', P('2026-10-10', '2026-10-11')],
    ]);
    // a passa a terminar dia 5 → b começa dia 5 (mesmo dia pode) e termina 6; c já está depois.
    const r = empurrarSeguintes(periodos, deps, new Map([['a', P('2026-10-01', '2026-10-05')]]));
    expect(r.get('b')).toEqual(P('2026-10-05', '2026-10-06'));
    expect(r.has('c')).toBe(false);
    // a para antes: ninguém é puxado.
    expect(empurrarSeguintes(periodos, deps, new Map([['a', P('2026-09-20', '2026-09-21')]])).size).toBe(0);
  });

  it('não mexe em concluída nem passa por ela', () => {
    const periodos = new Map([
      ['a', P('2026-10-01', '2026-10-02')],
      ['b', P('2026-10-03', '2026-10-04')],
      ['c', P('2026-10-05', '2026-10-06')],
    ]);
    const r = empurrarSeguintes(periodos, deps, new Map([['a', P('2026-10-01', '2026-10-08')]]), new Set(['b']));
    expect(r.size).toBe(0);
  });
});

describe('cronograma: horas por dia acompanham a barra', () => {
  const plano = { dias: { '2026-10-01': 120, '2026-10-02': 60 } };
  it('barra andou inteira: os dias andam junto', () => {
    expect(planoParaPeriodo(plano, P('2026-10-01', '2026-10-02'), P('2026-10-05', '2026-10-06')))
      .toEqual({ dias: { '2026-10-05': 120, '2026-10-06': 60 } });
  });
  it('encurtou: o que caiu fora vai para a ponta, sem perder horas', () => {
    expect(planoParaPeriodo(plano, P('2026-10-01', '2026-10-02'), P('2026-10-02', '2026-10-02')))
      .toEqual({ dias: { '2026-10-02': 180 } });
  });
  it('encurtou e a ponta passaria de 24h: reparte igual pelo período', () => {
    const cheio = { dias: { '2026-10-01': 900, '2026-10-02': 900, '2026-10-03': 900 } };
    expect(planoParaPeriodo(cheio, P('2026-10-01', '2026-10-03'), P('2026-10-01', '2026-10-02')))
      .toEqual({ dias: { '2026-10-01': 1350, '2026-10-02': 1350 } });
  });
  it('sem plano ou sem mudança: não mexe', () => {
    expect(planoParaPeriodo(null, P('2026-10-01', '2026-10-02'), P('2026-10-05', '2026-10-06'))).toBeNull();
    expect(planoParaPeriodo(plano, P('2026-10-01', '2026-10-02'), P('2026-10-01', '2026-10-03'))).toBeNull();
  });
});

describe('cronograma: progresso e atraso', () => {
  it('checklist > subtarefas > tempo', () => {
    expect(progressoDaTarefa(t('x', { checklist_total: 4, checklist_done: 1 })).fracao).toBe(0.25);
    expect(progressoDaTarefa(t('x'), [t('s1', { status_category: 'done' }), t('s2')]).fracao).toBe(0.5);
    expect(progressoDaTarefa(t('x', { time_estimate_minutes: 120, time_tracked_seconds: 3600 })).fracao).toBe(0.5);
    expect(progressoDaTarefa(t('x', { status_category: 'done' })).fracao).toBe(1);
  });

  it('aberta vencida = cauda até hoje; concluída depois do prazo = até o dia em que terminou', () => {
    const vence = (d: string) => t('x', { due_date: `${d}T12:00:00Z` });
    expect(atrasoDaTarefa(vence('2026-09-30'), P('2026-09-28', '2026-09-30'), '2026-10-02')).toEqual({ tipo: 'atrasada', ate: '2026-10-02', dias: 2 });
    expect(atrasoDaTarefa(vence('2026-10-02'), P('2026-09-28', '2026-10-02'), '2026-10-02')).toBeNull();
    // só início, já começou: não é atraso
    expect(atrasoDaTarefa(t('x', { start_date: '2026-09-20' }), P('2026-09-20', '2026-09-20'), '2026-10-02')).toBeNull();
    const feita = t('x', { status_category: 'done', completed_at: '2026-10-01T15:00:00Z', due_date: '2026-09-29T12:00:00Z' });
    expect(atrasoDaTarefa(feita, P('2026-09-28', '2026-09-29'), '2026-10-02')?.tipo).toBe('terminou_depois');
    expect(atrasoDaTarefa(feita, P('2026-09-28', '2026-10-05'), '2026-10-02')).toBeNull();
  });
});

describe('cronograma: linhas', () => {
  const lista = (id: string, parent: string | null, sort = 0) =>
    ({ id, name: id.toUpperCase(), color: '#000', parent_list_id: parent, sort_order: sort, statuses: [], access: 'owner' }) as unknown as TaskList;
  const lists = [lista('obra', null), lista('compras', 'obra', 1), lista('pintura', 'obra', 0)];
  const base = { lists, usuarios: [], recolhidos: new Set<string>(), ordem: 'manual' as const, mostrarSemData: true };

  it('pasta aberta: tarefas dela soltas, subpastas viram grupos aninhados e subtarefa fica embaixo da pai', () => {
    const tasks = [
      t('t1', { list_id: 'obra', sort_order: 1 }),
      t('t2', { list_id: 'compras' }),
      t('t3', { list_id: 'pintura' }),
      t('sub', { list_id: 'obra', parent_task_id: 't1' }),
    ];
    const linhas = montarLinhas({ ...base, tasks, modo: 'pasta', raizId: 'obra', podeCriarEm: () => true });
    expect(linhas.map((l) => l.key)).toEqual([
      't:t1', 't:sub', 'n:obra',
      'g:pasta:pintura', 't:t3', 'n:pintura',
      'g:pasta:compras', 't:t2', 'n:compras',
    ]);
    const pai = linhas[0];
    expect(pai.tipo === 'tarefa' && pai.temFilhas).toBe(true);
  });

  it('esconder sem data some com elas; grupo recolhido não mostra as tarefas', () => {
    const tasks = [t('com', { list_id: 'compras', due_date: '2026-10-05T12:00:00Z' }), t('sem', { list_id: 'compras' })];
    const sem = montarLinhas({ ...base, tasks, modo: 'pasta', raizId: null, mostrarSemData: false });
    expect(sem.map((l) => l.key)).toEqual(['g:pasta:obra', 'g:pasta:compras', 't:com']);
    const recolhido = montarLinhas({ ...base, tasks, modo: 'pasta', raizId: null, recolhidos: new Set(['g:pasta:compras']) });
    expect(recolhido.map((l) => l.key)).toEqual(['g:pasta:obra', 'g:pasta:compras']);
  });

  it('por pessoa: tarefa de dois responsáveis aparece nos dois grupos', () => {
    const tasks = [t('x', { assignees: [{ id: 'ana', name: 'Ana' }, { id: 'bia', name: 'Bia' }] }), t('y')];
    const linhas = montarLinhas({ ...base, tasks, modo: 'responsavel', raizId: null });
    expect(linhas.map((l) => l.key)).toEqual([
      'g:pessoa:ana', 'g:pessoa:ana|t:x', 'g:pessoa:bia', 'g:pessoa:bia|t:x', 'g:pessoa:nenhum', 'g:pessoa:nenhum|t:y',
    ]);
  });
});

describe('cronograma: cabeçalho', () => {
  it('semana começa na segunda e marca a semana de hoje', () => {
    const { baixo } = marcasCabecalho('2026-09-28', 14, 'semana', '2026-10-02');
    expect(baixo.map((m) => m.rotulo)).toEqual(['28 set', '5 out']);
    expect(baixo[0].destaque).toBe(true);
    expect(baixo[1].destaque).toBe(false);
  });
});

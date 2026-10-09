import { describe, it, expect } from 'vitest';
import { calcularVisaoGeral, resumoEmFrases, SEM_PESSOA, inicioSemana } from '@/pages/tarefas/lib/visaoGeral';
import { montarArvorePastas } from '@/pages/tarefas/lib/pastas';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';

// Quinta-feira, 09/10/2026, 10h (horário local).
const AGORA = new Date(2026, 9, 9, 10, 0, 0);
const dia = (offset: number) => {
  const d = new Date(2026, 9, 9 + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const prazo = (offset: number) => `${dia(offset)}T12:00:00Z`;

const pasta = (id: string, parent: string | null): TaskList => ({
  id, name: id, color: '#000', icon: null, sort_order: 0, parent_list_id: parent, open_count: 0,
  statuses: [
    { id: `${id}-todo`, name: 'A fazer', color: '#94a3b8', category: 'todo', sort_order: 0 },
    { id: `${id}-doing`, name: 'Em andamento', color: '#3b82f6', category: 'in_progress', sort_order: 1 },
    { id: `${id}-done`, name: 'Concluído', color: '#22c55e', category: 'done', sort_order: 2 },
  ],
});
const LISTS = [pasta('mae', null), pasta('a', 'mae'), pasta('a1', 'a'), pasta('b', 'mae'), pasta('outra', null)];
const RAIZ = montarArvorePastas(LISTS).find((n) => n.id === 'mae')!;

let seq = 0;
const t = (p: Partial<TaskRow> & { list_id: string }): TaskRow => {
  const cat = p.status_category ?? 'todo';
  return {
    id: `t${seq++}`, title: 'x', list_name: p.list_id, list_color: '#000', parent_task_id: null,
    status_id: `${p.list_id}-${cat === 'in_progress' ? 'doing' : cat}`, status_category: cat, priority: 0,
    assignee_id: null, assignee_name: null, assignees: [], start_date: null, due_date: null, due_has_time: false,
    sort_order: 0, recurrence: null, completed_at: null, created_at: `${dia(-1)}T12:00:00Z`, created_by: 'eu', tags: [],
    checklist_total: 0, checklist_done: 0, subtask_total: 0, comment_count: 0, field_values: {},
    time_estimate_minutes: null, time_tracked_seconds: 0, timer_started_at: null,
    ...p,
  } as TaskRow;
};
const ana = { id: 'ana', name: 'Ana' };
const beto = { id: 'beto', name: 'Beto' };

describe('Visão geral da pasta-mãe', () => {
  it('conta atrasadas, hoje, próximos 7 dias e sem responsável só nas tarefas principais em aberto', () => {
    const tarefas = [
      t({ list_id: 'mae', due_date: prazo(-2), assignees: [ana] }),               // atrasada
      t({ list_id: 'a', due_date: prazo(0), assignees: [ana] }),                  // hoje
      t({ list_id: 'a1', due_date: prazo(3), assignees: [beto] }),                // semana
      t({ list_id: 'b', due_date: prazo(9) }),                                    // depois, sem responsável
      t({ list_id: 'b', due_date: prazo(-5), status_category: 'done', completed_at: `${dia(-1)}T15:00:00Z` }),
      t({ list_id: 'b', due_date: prazo(-5), status_category: 'cancelled' }),     // ignorada
      t({ list_id: 'a', due_date: prazo(-3), parent_task_id: 'x' }),              // subtarefa: ignorada
      t({ list_id: 'a', due_date: `${dia(0)}T12:30:00Z`, due_has_time: true }),    // hoje com hora (UTC 12:30 = 09:30 BRT → já passou às 10h)
    ];
    const v = calcularVisaoGeral(tarefas, RAIZ, { agora: AGORA, todas: tarefas, dependencias: [], lists: LISTS });
    expect(v.total).toBe(6);
    expect(v.abertas).toBe(5);
    expect(v.concluidas).toBe(1);
    // Com horário: a de 12:30 UTC só conta como atrasada se já passou no fuso de quem roda o teste.
    const comHoraAtrasada = new Date(`${dia(0)}T12:30:00Z`).getTime() < AGORA.getTime();
    expect(v.hoje).toHaveLength(comHoraAtrasada ? 1 : 2);
    expect(v.semana).toHaveLength(comHoraAtrasada ? 2 : 3); // hoje + daqui a 3 dias
    expect(v.semResponsavel).toHaveLength(2);
    expect(v.concluidas7).toBe(1);
    expect(v.atrasadas).toHaveLength(comHoraAtrasada ? 2 : 1);
  });

  it('cada subpasta soma a subárvore dela; tarefas soltas na mãe viram linha própria', () => {
    const tarefas = [
      t({ list_id: 'mae' }),
      t({ list_id: 'a', status_category: 'done', completed_at: `${dia(-1)}T15:00:00Z` }),
      t({ list_id: 'a1', status_category: 'in_progress', due_date: prazo(2), assignees: [ana] }),
      t({ list_id: 'a1', due_date: prazo(-1), assignees: [ana, beto] }),
    ];
    const v = calcularVisaoGeral(tarefas, RAIZ, { agora: AGORA, todas: tarefas, dependencias: [], lists: LISTS });
    expect(v.subpastas.map((s) => s.id)).toEqual(['mae', 'a', 'b']);
    const a = v.subpastas.find((s) => s.id === 'a')!;
    expect(a).toMatchObject({ total: 3, concluidas: 1, andamento: 1, aFazer: 1, atrasadas: 1, subpastas: 1, proximoPrazo: dia(2) });
    expect(a.pessoas.map((p) => p.id)).toEqual(['ana', 'beto']);
    expect(v.subpastas.find((s) => s.id === 'b')!.total).toBe(0);
    expect(v.subpastas[0].direta).toBe(true);
  });

  it('por pessoa: vários responsáveis contam para cada um e dividem o tempo que falta', () => {
    const tarefas = [
      t({ list_id: 'a', assignees: [ana, beto], time_estimate_minutes: 120, time_tracked_seconds: 1800, due_date: prazo(-1) }),
      t({ list_id: 'a', assignees: [beto], time_estimate_minutes: 60, due_date: prazo(2) }),
      t({ list_id: 'a' }),
    ];
    const v = calcularVisaoGeral(tarefas, RAIZ, { agora: AGORA, todas: tarefas, dependencias: [], lists: LISTS });
    const p = Object.fromEntries(v.pessoas.map((x) => [x.id, x]));
    expect(p.ana).toMatchObject({ abertas: 1, atrasadas: 1, minutosRestantes: 45 });
    expect(p.beto).toMatchObject({ abertas: 2, atrasadas: 1, semana: 1, minutosRestantes: 105 });
    expect(v.pessoas[v.pessoas.length - 1].id).toBe(SEM_PESSOA);
    expect(v.minutosRestantes).toBe(150);
  });

  it('bloqueada = depende de tarefa ainda aberta', () => {
    const antes = t({ list_id: 'a' });
    const feita = t({ list_id: 'a', status_category: 'done', completed_at: `${dia(-2)}T10:00:00Z` });
    const espera = t({ list_id: 'b' });
    const liberada = t({ list_id: 'b' });
    const tarefas = [antes, feita, espera, liberada];
    const v = calcularVisaoGeral(tarefas, RAIZ, {
      agora: AGORA, todas: tarefas, lists: LISTS,
      dependencias: [{ predecessor_id: antes.id, successor_id: espera.id }, { predecessor_id: feita.id, successor_id: liberada.id }],
    });
    expect(v.bloqueadas.map((x) => x.id)).toEqual([espera.id]);
  });

  it('ritmo por semana (segunda a domingo) e previsão pelas últimas 4 semanas', () => {
    expect(inicioSemana(AGORA).getDate()).toBe(5); // segunda, 05/10
    const tarefas = [
      ...Array.from({ length: 8 }, (_, i) => t({
        list_id: 'a', status_category: 'done', created_at: `${dia(-20 - i)}T12:00:00Z`, completed_at: `${dia(-i * 3)}T12:00:00Z`,
      })),
      ...Array.from({ length: 6 }, () => t({ list_id: 'b', created_at: `${dia(-3)}T12:00:00Z` })),
    ];
    const v = calcularVisaoGeral(tarefas, RAIZ, { agora: AGORA, todas: tarefas, dependencias: [], lists: LISTS });
    expect(v.ritmo).toHaveLength(8);
    expect(v.ritmo[7].atual).toBe(true);
    expect(v.ritmo[7].inicio).toBe(dia(-4));
    expect(v.ritmo.reduce((s, w) => s + w.concluidas, 0)).toBe(8);
    expect(v.sairam4).toBe(8);
    expect(v.previsao).toMatchObject({ porSemana: 2, semanas: 3, data: dia(21) });
    expect(v.entraram4).toBe(14);
  });

  it('frase de resumo fala primeiro do que pede ação', () => {
    const tarefas = [
      t({ list_id: 'a', due_date: prazo(-1) }),
      t({ list_id: 'a', due_date: prazo(0) }),
      t({ list_id: 'a', due_date: prazo(4) }),
    ];
    const v = calcularVisaoGeral(tarefas, RAIZ, { agora: AGORA, todas: tarefas, dependencias: [], lists: LISTS });
    const r = resumoEmFrases(v);
    expect(r.tom).toBe('atraso');
    expect(r.frases[0]).toBe('1 tarefa atrasada e 1 vence hoje.');
    expect(r.frases[1]).toBe('Nos próximos 6 dias vence mais 1.');
    const vazio = calcularVisaoGeral([], RAIZ, { agora: AGORA, todas: [], dependencias: [], lists: LISTS });
    expect(resumoEmFrases(vazio).frases).toEqual(['Ainda não há tarefas aqui.']);
  });
});

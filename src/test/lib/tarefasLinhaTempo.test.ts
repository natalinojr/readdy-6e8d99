import { describe, it, expect } from 'vitest';
import {
  diasAtraso, faixaDaLinha, linhasDoGrupo, montarGrupos, payloadAjustar, payloadMarcar, payloadMover,
  periodoDaTarefa, periodoPrevisto, progressoDaTarefa,
} from '@/pages/tarefas/lib/linhaTempo';
import type { TaskList, TaskRow } from '@/pages/tarefas/hooks/useTarefas';

const t = (id: string, p: Partial<TaskRow> = {}) => ({
  id, title: id, list_id: 'L1', list_name: 'Pasta', list_color: '#000', parent_task_id: null, status_id: 's1',
  status_category: 'todo', priority: 0, assignee_id: null, assignee_name: null, assignees: [], start_date: null,
  due_date: null, due_has_time: false, sort_order: 0, tags: [], checklist_total: 0, checklist_done: 0,
  time_estimate_minutes: null, time_tracked_seconds: 0, ...p,
} as unknown as TaskRow);
const prazo = (dia: string) => `${dia}T12:00:00Z`;
const agora = new Date(2026, 9, 8, 10, 0); // qui 08/10/2026 10h

describe('linha do tempo — período de cada tarefa', () => {
  it('início→vencimento, só vencimento, só início e sem data', () => {
    expect(periodoDaTarefa(t('a', { start_date: '2026-10-05', due_date: prazo('2026-10-09') }))).toEqual({ inicio: '2026-10-05', fim: '2026-10-09', tipo: 'periodo' });
    expect(periodoDaTarefa(t('b', { due_date: prazo('2026-10-09') }))).toEqual({ inicio: '2026-10-09', fim: '2026-10-09', tipo: 'dia' });
    expect(periodoDaTarefa(t('c', { start_date: '2026-10-05' }))).toEqual({ inicio: '2026-10-05', fim: '2026-10-05', tipo: 'soInicio' });
    expect(periodoDaTarefa(t('d'))).toBeNull();
    // Início depois do vencimento (dado torto) não vira barra ao contrário.
    expect(periodoDaTarefa(t('e', { start_date: '2026-10-12', due_date: prazo('2026-10-09') }))?.tipo).toBe('dia');
  });

  it('atraso conta dias e vencimento com hora já passado', () => {
    expect(diasAtraso(t('a', { due_date: prazo('2026-10-05') }), agora)).toBe(3);
    expect(diasAtraso(t('b', { due_date: prazo('2026-10-05'), status_category: 'done' }), agora)).toBe(0);
    expect(diasAtraso(t('c', { due_date: new Date(2026, 9, 8, 9, 0).toISOString(), due_has_time: true }), agora)).toBe(1);
    expect(diasAtraso(t('d', { due_date: new Date(2026, 9, 8, 18, 0).toISOString(), due_has_time: true }), agora)).toBe(0);
  });

  it('progresso: concluída, checklist, cronômetro', () => {
    expect(progressoDaTarefa(t('a', { status_category: 'done' }))).toBe(1);
    expect(progressoDaTarefa(t('b', { checklist_total: 4, checklist_done: 1 }))).toBe(0.25);
    expect(progressoDaTarefa(t('c', { time_estimate_minutes: 60, time_tracked_seconds: 1800 }))).toBe(0.5);
    expect(progressoDaTarefa(t('d'))).toBeNull();
  });
});

describe('linha do tempo — o que gravar', () => {
  it('mover leva início e vencimento juntos e mantém a hora', () => {
    expect(payloadMover(t('a', { start_date: '2026-10-05', due_date: prazo('2026-10-09') }), 3))
      .toEqual({ start_date: '2026-10-08', due_date: prazo('2026-10-12'), due_has_time: false });
    const comHora = new Date(2026, 9, 9, 14, 30).toISOString();
    const r = payloadMover(t('b', { due_date: comHora, due_has_time: true }), -2)!;
    const d = new Date(r.due_date as string);
    expect([d.getDate(), d.getHours(), d.getMinutes(), r.due_has_time]).toEqual([7, 14, 30, true]);
    expect(payloadMover(t('c', { start_date: '2026-10-05' }), 1)).toEqual({ start_date: '2026-10-06' });
    // Um dia só, mas com início gravado no mesmo dia: o início anda junto (não vira período).
    expect(payloadMover(t('e', { start_date: '2026-10-09', due_date: prazo('2026-10-09') }), 2))
      .toEqual({ start_date: '2026-10-11', due_date: prazo('2026-10-11'), due_has_time: false });
    expect(payloadMover(t('d', { due_date: prazo('2026-10-09') }), 0)).toBeNull();
  });

  it('esticar: um dia vira período; ponta não cruza a outra', () => {
    const umDia = t('a', { due_date: prazo('2026-10-09') });
    expect(payloadAjustar(umDia, 'fim', '2026-10-11')?.payload).toEqual({ start_date: '2026-10-09', due_date: prazo('2026-10-11'), due_has_time: false });
    expect(payloadAjustar(umDia, 'inicio', '2026-10-06')?.payload).toEqual({ start_date: '2026-10-06' });
    const periodo = t('b', { start_date: '2026-10-05', due_date: prazo('2026-10-09') });
    expect(payloadAjustar(periodo, 'fim', '2026-10-03')?.erro).toBeTruthy();
    expect(payloadAjustar(t('c', { start_date: '2026-10-05' }), 'fim', '2026-10-07')?.payload)
      .toEqual({ due_date: prazo('2026-10-07'), due_has_time: false });
  });

  it('marcar data na tarefa sem data (clique = 1 dia; arrastar ao contrário também vale)', () => {
    expect(payloadMarcar('2026-10-09', '2026-10-09')).toEqual({ due_date: prazo('2026-10-09'), due_has_time: false });
    expect(payloadMarcar('2026-10-12', '2026-10-09')).toEqual({ start_date: '2026-10-09', due_date: prazo('2026-10-12'), due_has_time: false });
  });

  it('prévia do arrasto não deixa o início passar do vencimento', () => {
    const p = { inicio: '2026-10-05', fim: '2026-10-09', tipo: 'periodo' as const };
    expect(periodoPrevisto(p, 'mover', 2)).toEqual({ inicio: '2026-10-07', fim: '2026-10-11' });
    expect(periodoPrevisto(p, 'inicio', 10)).toEqual({ inicio: '2026-10-09', fim: '2026-10-09' });
    expect(periodoPrevisto(p, 'fim', -10)).toEqual({ inicio: '2026-10-05', fim: '2026-10-05' });
  });
});

describe('linha do tempo — grupos e linhas', () => {
  it('sem data vai pra gaveta; subtarefa fica embaixo da mãe só quando aberta', () => {
    const tarefas = [
      t('mae', { due_date: prazo('2026-10-10') }),
      t('filha', { parent_task_id: 'mae', due_date: prazo('2026-10-09') }),
      t('cedo', { due_date: prazo('2026-10-02') }),
      t('semdata'),
    ];
    const fechado = linhasDoGrupo(tarefas, new Set(), agora);
    expect(fechado.linhas.map((l) => l.task.id)).toEqual(['cedo', 'mae']);
    expect(fechado.linhas.find((l) => l.task.id === 'mae')?.filhas).toBe(1);
    expect(fechado.semData.map((x) => x.id)).toEqual(['semdata']);
    // Concluída sem data não entra na gaveta.
    expect(linhasDoGrupo([t('feita', { status_category: 'done' })], new Set(), agora).semData).toEqual([]);
    expect(fechado.resumo).toEqual({ inicio: '2026-10-02', fim: '2026-10-10' });
    expect(fechado.atrasadas).toBe(1);
    const aberto = linhasDoGrupo(tarefas, new Set(['mae']), agora);
    expect(aberto.linhas.map((l) => [l.task.id, l.nivel])).toEqual([['cedo', 0], ['mae', 0], ['filha', 1]]);
  });

  it('mãe sem data mas com subtarefa datada não vai pra gaveta', () => {
    const r = linhasDoGrupo([t('mae'), t('filha', { parent_task_id: 'mae', due_date: prazo('2026-10-09') })], new Set(), agora);
    expect(r.linhas.map((l) => l.task.id)).toEqual(['mae']);
    expect(r.semData).toEqual([]);
  });

  it('por pessoa: vários responsáveis aparecem em cada grupo; sem responsável no fim', () => {
    const tarefas = [
      t('a', { assignee_id: 'u2', assignees: [{ id: 'u2', name: 'Bruno' }, { id: 'u1', name: 'Ana' }] }),
      t('b', { assignee_id: 'u1', assignees: [{ id: 'u1', name: 'Ana' }] }),
      t('c'),
    ];
    const g = montarGrupos(tarefas, { agrupar: 'pessoa', list: null, lists: [], usuarios: [{ id: 'u1', nome: 'Ana' }, { id: 'u2', nome: 'Bruno' }], abertas: new Set(), agora });
    expect(g.map((x) => [x.label, x.total])).toEqual([['Ana', 2], ['Bruno', 1], ['Sem responsável', 1]]);
  });

  it('por pasta: mostra o caminho e segue a ordem da árvore', () => {
    const lists = [
      { id: 'L1', name: 'Cozinha', color: '#f00', parent_list_id: null, sort_order: 0, statuses: [] },
      { id: 'L2', name: 'Compras', color: '#0f0', parent_list_id: 'L1', sort_order: 0, statuses: [] },
    ] as unknown as TaskList[];
    const g = montarGrupos([t('a', { list_id: 'L2' }), t('b', { list_id: 'L1' })], { agrupar: 'pasta', list: null, lists, usuarios: [], abertas: new Set(), agora });
    expect(g.map((x) => x.label)).toEqual(['Cozinha', 'Cozinha › Compras']);
    expect(g[1].listId).toBe('L2');
  });

  it('faixa cobre hoje e as tarefas, com folga', () => {
    const f = faixaDaLinha([t('a', { due_date: prazo('2027-03-01') })], agora);
    expect(f.de <= '2026-09-17').toBe(true);
    expect(f.ate >= '2027-03-01').toBe(true);
  });
});

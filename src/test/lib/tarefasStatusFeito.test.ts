import { describe, it, expect } from 'vitest';
import { someDaTela, statusPorCategoria } from '@/pages/tarefas/lib/statusFeito';
import { agruparTarefas, aplicarFiltros, payloadMoverGrupo, FILTROS_VAZIOS } from '@/pages/tarefas/lib/agrupamento';
import type { TaskRow, TaskStatus } from '@/pages/tarefas/hooks/useTarefas';

const statuses: TaskStatus[] = [
  { id: 'a', name: 'A fazer', color: '#000', category: 'todo', sort_order: 0 },
  { id: 'f', name: 'Feito', color: '#000', category: 'done', keep_visible: true, sort_order: 1 },
  { id: 'c', name: 'Concluído', color: '#000', category: 'done', sort_order: 2 },
];
const t = (id: string, cat: TaskStatus['category'], vis = false) =>
  ({ id, title: id, status_category: cat, status_keep_visible: vis, sort_order: 0, tags: [], assignees: [] } as unknown as TaskRow);

describe('status "Feito" (concluída que fica na tela)', () => {
  it('só some da tela o Concluído de verdade e o Cancelado', () => {
    expect(someDaTela(t('1', 'done', true))).toBe(false);
    expect(someDaTela(t('2', 'done'))).toBe(true);
    expect(someDaTela(t('3', 'cancelled'))).toBe(true);
    expect(someDaTela(t('4', 'todo'))).toBe(false);
  });

  it('ocultar concluídas mantém o Feito', () => {
    const r = aplicarFiltros([t('1', 'done', true), t('2', 'done'), t('3', 'todo')], { ...FILTROS_VAZIOS, ocultarConcluidas: true });
    expect(r.map((x) => x.id)).toEqual(['1', '3']);
  });

  it('checkbox/categoria done vai pro Concluído; pedido de visível vai pro Feito', () => {
    expect(statusPorCategoria(statuses, 'done')?.id).toBe('c');
    expect(statusPorCategoria(statuses, 'done', true)?.id).toBe('f');
    expect(statusPorCategoria(statuses.filter((s) => s.id !== 'f'), 'done', true)?.id).toBe('c');
  });

  it('visão de várias pastas separa o grupo Feito do Concluído', () => {
    const g = agruparTarefas([t('1', 'done', true), t('2', 'done'), t('3', 'todo')], 'status', null, [], []);
    expect(g.find((x) => x.key === 'feito')?.tasks.map((x) => x.id)).toEqual(['1']);
    expect(g.find((x) => x.key === 'done')?.tasks.map((x) => x.id)).toEqual(['2']);
    expect(payloadMoverGrupo('status', 'feito', null)?.patch).toEqual({ status_category: 'done', status_keep_visible: true });
  });
});

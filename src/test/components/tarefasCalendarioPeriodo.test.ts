import { describe, expect, it } from 'vitest';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { diasDaTarefa, diferencaDias, tarefasPorDia } from '@/pages/tarefas/lib/calendario';

const t = (id: string, start: string | null, due: string | null) =>
  ({ id, title: id, start_date: start, due_date: due }) as unknown as TaskRow;

describe('calendário: tarefa de vários dias', () => {
  it('ocupa todos os dias do início ao vencimento', () => {
    expect(diasDaTarefa(t('a', '2026-09-28', '2026-10-02T12:00:00Z'))).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
    ]);
  });

  it('sem início ou início depois do vencimento → só o vencimento', () => {
    expect(diasDaTarefa(t('a', null, '2026-09-28T12:00:00Z'))).toEqual(['2026-09-28']);
    expect(diasDaTarefa(t('a', '2026-10-05', '2026-09-28T12:00:00Z'))).toEqual(['2026-09-28']);
    expect(diasDaTarefa(t('a', '2026-09-28', null))).toEqual([]);
  });

  it('marca o trecho e põe as de vários dias primeiro', () => {
    const mapa = tarefasPorDia([
      t('um-dia', null, '2026-09-29T12:00:00Z'),
      t('periodo', '2026-09-28', '2026-09-30T12:00:00Z'),
    ]);
    expect(mapa.get('2026-09-28')?.map((o) => o.task.id)).toEqual(['periodo']);
    const dia29 = mapa.get('2026-09-29')!;
    expect(dia29.map((o) => o.task.id)).toEqual(['periodo', 'um-dia']);
    expect(dia29[0].trecho).toEqual({ dia: 2, total: 3 });
    expect(dia29[1].trecho).toBeNull();
    expect(mapa.get('2026-09-30')?.[0].trecho).toEqual({ dia: 3, total: 3 });
  });

  it('diferença de dias entre chaves', () => {
    expect(diferencaDias('2026-09-28', '2026-10-02')).toBe(4);
    expect(diferencaDias('2026-10-02', '2026-09-28')).toBe(-4);
  });
});

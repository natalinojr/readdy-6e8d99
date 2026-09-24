import { describe, expect, it } from 'vitest';
import type { TaskRow } from '@/pages/tarefas/hooks/useTarefas';
import { ajustarPeriodo, diasDaTarefa, diferencaDias, linhasDoDia, tarefasPorDia } from '@/pages/tarefas/lib/calendario';

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

describe('calendário: puxar as pontas', () => {
  const um = t('a', null, '2026-09-28T12:00:00Z');
  const periodo = t('b', '2026-09-28', '2026-09-30T12:00:00Z');

  it('tarefa de um dia vira período pelas duas pontas', () => {
    expect(ajustarPeriodo(um, 'fim', '2026-10-01')).toEqual({ start_date: '2026-09-28', diaVencimento: '2026-10-01' });
    expect(ajustarPeriodo(um, 'inicio', '2026-09-25')).toEqual({ start_date: '2026-09-25' });
    expect(ajustarPeriodo(um, 'fim', '2026-09-28')).toBeNull();
  });

  it('período: muda só a ponta puxada e recusa inverter', () => {
    expect(ajustarPeriodo(periodo, 'inicio', '2026-09-29')).toEqual({ start_date: '2026-09-29' });
    expect(ajustarPeriodo(periodo, 'inicio', '2026-09-30')).toEqual({ start_date: null });
    expect(ajustarPeriodo(periodo, 'fim', '2026-10-03')).toEqual({ diaVencimento: '2026-10-03' });
    expect(ajustarPeriodo(periodo, 'fim', '2026-09-28')).toEqual({ start_date: null, diaVencimento: '2026-09-28' });
    expect(ajustarPeriodo(periodo, 'inicio', '2026-10-01')?.erro).toBeTruthy();
    expect(ajustarPeriodo(periodo, 'fim', '2026-09-27')?.erro).toBeTruthy();
  });
});

describe('calendário: faixas da barra contínua', () => {
  it('cada tarefa de vários dias fica na mesma linha em todo o período', () => {
    const mapa = tarefasPorDia([
      t('A', '2026-09-25', '2026-09-27T12:00:00Z'),
      t('B', '2026-09-26', '2026-09-28T12:00:00Z'),
      t('solta', null, '2026-09-28T12:00:00Z'),
    ]);
    const nomes = (d: string) => linhasDoDia(mapa.get(d)!).map((o) => o?.task.id ?? null);
    expect(nomes('2026-09-26')).toEqual(['A', 'B']);
    expect(nomes('2026-09-27')).toEqual(['A', 'B']);
    // A já acabou: B continua na 2ª linha, com um buraco em cima.
    expect(nomes('2026-09-28')).toEqual([null, 'B', 'solta']);
  });
});

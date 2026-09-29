import { describe, it, expect } from 'vitest';
import { montarArvorePastas, reordenarIrmas } from '@/pages/tarefas/lib/pastas';
import type { TaskList } from '@/pages/tarefas/hooks/useTarefas';

const pasta = (id: string, sort_order: number, parent_list_id: string | null = null): TaskList => ({
  id, name: id, color: '#000', icon: null, sort_order, parent_list_id, statuses: [], open_count: 0,
});

describe('ordem das pastas', () => {
  it('reordenarIrmas põe antes/depois do alvo', () => {
    expect(reordenarIrmas(['a', 'b', 'c'], 'c', 'a', 'antes')).toEqual(['c', 'a', 'b']);
    expect(reordenarIrmas(['a', 'b', 'c'], 'a', 'b', 'depois')).toEqual(['b', 'a', 'c']);
    expect(reordenarIrmas(['a', 'b', 'c'], 'a', 'c', 'depois')).toEqual(['b', 'c', 'a']);
  });

  it('reordenarIrmas ignora pasta de outro nível', () => {
    expect(reordenarIrmas(['a', 'b'], 'x', 'a', 'antes')).toEqual(['a', 'b']);
  });

  it('montarArvorePastas ordena raízes e filhas por sort_order (empate mantém ordem)', () => {
    const arvore = montarArvorePastas([
      pasta('a', 20), pasta('b', 10), pasta('c', 10),
      pasta('f1', 30, 'a'), pasta('f2', 0, 'a'),
    ]);
    expect(arvore.map((n) => n.id)).toEqual(['b', 'c', 'a']);
    expect(arvore[2].filhas.map((n) => n.id)).toEqual(['f2', 'f1']);
  });
});

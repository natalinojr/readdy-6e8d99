import type { TaskRow, TaskStatus } from '../hooks/useTarefas';

/**
 * "Feito" = status da categoria done com `keep_visible`: conta como concluída
 * (data de conclusão, recorrência, carga, avisos), mas a tarefa CONTINUA na tela.
 * Só some (grupo recolhido / "ocultar concluídas") quando vai pra um "Concluído" de verdade.
 */
export const GRUPO_FEITO = { key: 'feito', label: 'Feito', color: '#14b8a6' } as const;

/** Some da tela: concluída de verdade (não "Feito") ou cancelada. */
export function someDaTela(t: Pick<TaskRow, 'status_category' | 'status_keep_visible'>): boolean {
  return (t.status_category === 'done' && !t.status_keep_visible) || t.status_category === 'cancelled';
}

/** É um "Feito" (concluída que fica na tela). */
export function ehFeito(t: Pick<TaskRow, 'status_category' | 'status_keep_visible'>): boolean {
  return t.status_category === 'done' && !!t.status_keep_visible;
}

/** Status da pasta para uma categoria — mesma regra do task-write: na categoria done,
 *  `querVisivel` escolhe entre "Feito" e "Concluído"; sem o tipo pedido, qualquer um da categoria. */
export function statusPorCategoria(statuses: TaskStatus[], cat: string, querVisivel = false): TaskStatus | undefined {
  const daCategoria = [...statuses].sort((a, b) => a.sort_order - b.sort_order).filter((s) => s.category === cat);
  return daCategoria.find((s) => !!s.keep_visible === querVisivel) ?? daCategoria[0];
}

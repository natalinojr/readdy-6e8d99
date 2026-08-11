import type { CampoCustom, TaskList, TaskRow } from '../hooks/useTarefas';
import { PRIORIDADES } from '../hooks/useTarefas';

export interface UsuarioOption {
  id: string;
  nome: string;
}

/** Um "balde" de agrupamento — vira coluna no Kanban e seção na Lista. */
export interface Grupo {
  /** Valor do campo agrupado. `null` = sem valor (ex.: sem responsável). */
  key: string | null;
  label: string;
  color: string;
  tasks: TaskRow[];
}

/**
 * Como agrupar. `status` é o padrão; os demais permitem reorganizar as mesmas
 * tarefas por qualquer outra dimensão (ideia do Notion).
 */
export type GroupBy = 'status' | 'priority' | 'assignee' | `field:${string}`;

export interface Filtros {
  busca: string;
  assigneeIds: string[];
  prioridades: number[];
  tagIds: string[];
  ocultarConcluidas: boolean;
}

export const FILTROS_VAZIOS: Filtros = {
  busca: '',
  assigneeIds: [],
  prioridades: [],
  tagIds: [],
  ocultarConcluidas: false,
};

export function filtrosAtivos(f: Filtros): number {
  return (
    (f.busca.trim() ? 1 : 0) +
    f.assigneeIds.length +
    f.prioridades.length +
    f.tagIds.length +
    (f.ocultarConcluidas ? 1 : 0)
  );
}

export function aplicarFiltros(tasks: TaskRow[], f: Filtros): TaskRow[] {
  const busca = f.busca.trim().toLowerCase();
  return tasks.filter((t) => {
    if (busca && !t.title.toLowerCase().includes(busca)) return false;
    if (f.assigneeIds.length && !f.assigneeIds.includes(t.assignee_id ?? '')) return false;
    if (f.prioridades.length && !f.prioridades.includes(t.priority)) return false;
    if (f.tagIds.length && !t.tags.some((tag) => f.tagIds.includes(tag.id))) return false;
    if (f.ocultarConcluidas && (t.status_category === 'done' || t.status_category === 'cancelled')) return false;
    return true;
  });
}

/** Campos que valem para uma lista: os dela + os globais do tenant. */
export function camposDaLista(campos: CampoCustom[], listId: string | null): CampoCustom[] {
  return campos
    .filter((c) => c.list_id === null || c.list_id === listId)
    .sort((a, b) => a.sort_order - b.sort_order);
}

/** Só campos que fazem sentido como eixo de agrupamento. */
export function camposAgrupaveis(campos: CampoCustom[], listId: string | null): CampoCustom[] {
  return camposDaLista(campos, listId).filter((c) => c.field_type === 'dropdown');
}

export function rotuloAgrupamento(
  groupBy: GroupBy,
  campos: CampoCustom[],
): string {
  if (groupBy === 'status') return 'Status';
  if (groupBy === 'priority') return 'Prioridade';
  if (groupBy === 'assignee') return 'Responsável';
  const campo = campos.find((c) => c.id === groupBy.slice('field:'.length));
  return campo?.name ?? 'Campo';
}

/**
 * Monta os grupos na ordem de exibição. Grupos vazios são mantidos para o
 * Kanban ter colunas estáveis (você precisa poder soltar um card numa coluna vazia).
 */
export function agruparTarefas(
  tasks: TaskRow[],
  groupBy: GroupBy,
  list: TaskList | null,
  usuarios: UsuarioOption[],
  campos: CampoCustom[],
): Grupo[] {
  const ordenar = (arr: TaskRow[]) => [...arr].sort((a, b) => a.sort_order - b.sort_order);

  if (groupBy === 'status') {
    const statuses = list?.statuses ?? [];
    return statuses.map((s) => ({
      key: s.id,
      label: s.name,
      color: s.color,
      tasks: ordenar(tasks.filter((t) => t.status_id === s.id)),
    }));
  }

  if (groupBy === 'priority') {
    // Urgente primeiro — é a ordem que importa quando se olha por prioridade.
    return [...PRIORIDADES].reverse().map((p) => ({
      key: String(p.value),
      label: p.label,
      color: p.color,
      tasks: ordenar(tasks.filter((t) => t.priority === p.value)),
    }));
  }

  if (groupBy === 'assignee') {
    const comResponsavel = usuarios
      .filter((u) => tasks.some((t) => t.assignee_id === u.id))
      .map((u) => ({
        key: u.id,
        label: u.nome,
        color: '#6366f1',
        tasks: ordenar(tasks.filter((t) => t.assignee_id === u.id)),
      }));
    return [
      ...comResponsavel,
      {
        key: null,
        label: 'Sem responsável',
        color: '#94a3b8',
        tasks: ordenar(tasks.filter((t) => !t.assignee_id)),
      },
    ];
  }

  // field:<id> — dropdown personalizado
  const fieldId = groupBy.slice('field:'.length);
  const campo = campos.find((c) => c.id === fieldId);
  if (!campo) return [];
  const grupos: Grupo[] = campo.options.map((o) => ({
    key: o.id,
    label: o.label,
    color: o.color,
    tasks: ordenar(tasks.filter((t) => t.field_values?.[fieldId] === o.id)),
  }));
  grupos.push({
    key: null,
    label: 'Sem valor',
    color: '#94a3b8',
    tasks: ordenar(tasks.filter((t) => !t.field_values?.[fieldId])),
  });
  return grupos;
}

/**
 * Payload de escrita para mover uma tarefa de grupo. Retorna null quando o
 * agrupamento não é editável por arrasto.
 */
export function payloadMoverGrupo(
  groupBy: GroupBy,
  destino: string | null,
): { action: 'update_task' | 'set_field_value'; patch: Record<string, unknown> } | null {
  if (groupBy === 'status') {
    if (!destino) return null; // status é obrigatório
    return { action: 'update_task', patch: { status_id: destino } };
  }
  if (groupBy === 'priority') {
    return { action: 'update_task', patch: { priority: Number(destino ?? 0) } };
  }
  if (groupBy === 'assignee') {
    return { action: 'update_task', patch: { assignee_id: destino } };
  }
  if (groupBy.startsWith('field:')) {
    return {
      action: 'set_field_value',
      patch: { field_id: groupBy.slice('field:'.length), value: destino },
    };
  }
  return null;
}

/**
 * sort_order fracionário: média entre os vizinhos, para não reescrever a lista
 * inteira a cada arrasto.
 */
export function calcularSortOrder(anterior: TaskRow | undefined, proxima: TaskRow | undefined): number {
  if (!anterior && !proxima) return Date.now();
  if (!anterior) return proxima!.sort_order - 1000;
  if (!proxima) return anterior.sort_order + 1000;
  return (anterior.sort_order + proxima.sort_order) / 2;
}

import type { TaskRow } from '../hooks/useTarefas';

/**
 * Responsáveis de uma tarefa. Desde 2026-09-24 uma tarefa pode ter vários
 * (`assignees`, vindo de task_assignees); `assignee_id` continua sendo o
 * PRINCIPAL (o primeiro). Tarefa vinda de resposta antiga, sem `assignees`,
 * cai no principal.
 */
export interface Responsavel { id: string; name: string | null }

type ComResponsaveis = Pick<TaskRow, 'assignee_id' | 'assignee_name'> & { assignees?: Responsavel[] | null };

export function responsaveis(t: ComResponsaveis): Responsavel[] {
  if (t.assignees && t.assignees.length) return t.assignees;
  return t.assignee_id ? [{ id: t.assignee_id, name: t.assignee_name }] : [];
}

export function idsResponsaveis(t: ComResponsaveis): string[] {
  return responsaveis(t).map((r) => r.id);
}

export function ehResponsavel(t: ComResponsaveis, userId: string | null | undefined): boolean {
  return !!userId && idsResponsaveis(t).includes(userId);
}

/** "Ana", "Ana e Bruno", "Ana +2". */
export function rotuloResponsaveis(t: ComResponsaveis): string | null {
  const r = responsaveis(t);
  if (!r.length) return null;
  const primeiro = (r[0].name ?? 'Usuário').split(' ')[0];
  if (r.length === 1) return r[0].name ?? 'Usuário';
  if (r.length === 2) return `${primeiro} e ${(r[1].name ?? 'Usuário').split(' ')[0]}`;
  return `${primeiro} +${r.length - 1}`;
}

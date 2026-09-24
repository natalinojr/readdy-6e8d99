// Recorrência de tarefas — a lógica mora em supabase/functions/_shared/recorrencia.ts
// (a Edge task-write usa a mesma pra criar a próxima ocorrência ao concluir).
export * from '../../../../supabase/functions/_shared/recorrencia';
import { descreverRecorrencia, type Recorrencia } from '../../../../supabase/functions/_shared/recorrencia';

/** Texto curto pra explicar a recorrência de uma tarefa (tooltip do ícone 🔁). */
export function rotuloRecorrencia(rec: Recorrencia | null | undefined): string | null {
  const t = descreverRecorrencia(rec);
  return t ? `Repete: ${t.charAt(0).toLowerCase()}${t.slice(1)}` : null;
}

export const DICA_RECORRENCIA = 'Ao concluir, a próxima ocorrência é criada automaticamente com a mesma descrição.';

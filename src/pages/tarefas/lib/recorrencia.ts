/** Texto curto pra explicar a recorrência de uma tarefa (tooltip do ícone 🔁). */
export function rotuloRecorrencia(rec: { freq?: string; interval?: number } | null | undefined): string | null {
  if (!rec?.freq) return null;
  const n = Math.max(1, Number(rec.interval) || 1);
  switch (rec.freq) {
    case 'daily': return n === 1 ? 'Repete todo dia' : `Repete a cada ${n} dias`;
    case 'weekly': return n === 1 ? 'Repete toda semana' : `Repete a cada ${n} semanas`;
    case 'monthly': return n === 1 ? 'Repete todo mês' : `Repete a cada ${n} meses`;
    default: return 'Tarefa recorrente';
  }
}

export const DICA_RECORRENCIA = 'Ao concluir, a próxima ocorrência é criada automaticamente com a mesma descrição.';

// Carga de trabalho — a conta mora em supabase/functions/_shared/carga.ts (a Edge
// do aviso de sobrecarga usa a mesma). Aqui: tipos com TaskRow + migração das
// horas antigas do localStorage.
import type { TaskRow } from '../hooks/useTarefas';
import type {
  Capacidade,
  Parcela as ParcelaBase,
  ResultadoCarga as ResultadoBase,
} from '../../../../supabase/functions/_shared/carga';

export {
  CAPACIDADE_PADRAO, SEM_RESPONSAVEL, calcularCarga, chaveDia, diaLocal, feitosNoDia, horasNoDia,
  minutosNoDia, minutosRestantes, ocupacaoRestante, somarDias,
} from '../../../../supabase/functions/_shared/carga';
export type { Capacidade, ExcecaoDe } from '../../../../supabase/functions/_shared/carga';

export type Parcela = ParcelaBase<TaskRow>;
export type ResultadoCarga = ResultadoBase<TaskRow>;

// ── Capacidade antiga no localStorage ──
// Até 2026-09-23 as horas ficavam só no navegador de quem configurava. Hoje
// ficam no banco (task_user_capacity); isto só serve pra levar o que já tinha
// sido configurado pro banco na primeira vez que a Carga abre.
const CHAVE_CAPACIDADE_LOCAL = 'erpos_tarefas_capacidade';

export function capacidadesLocaisAntigas(): Record<string, Capacidade> {
  try {
    const obj = JSON.parse(localStorage.getItem(CHAVE_CAPACIDADE_LOCAL) ?? '{}');
    return obj && typeof obj === 'object' ? obj as Record<string, Capacidade> : {};
  } catch {
    return {};
  }
}

export function esquecerCapacidadesLocais(ids: string[]): void {
  try {
    const resto = capacidadesLocaisAntigas();
    for (const id of ids) delete resto[id];
    if (Object.keys(resto).length) localStorage.setItem(CHAVE_CAPACIDADE_LOCAL, JSON.stringify(resto));
    else localStorage.removeItem(CHAVE_CAPACIDADE_LOCAL);
  } catch {
    /* sem localStorage */
  }
}

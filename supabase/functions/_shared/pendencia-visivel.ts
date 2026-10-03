// Quem vê o quê na caixa de pendências (2026-09-28) — mora em _shared (2026-10-03) para a tela e o
// servidor (bom dia e aviso no celular da tela Hoje) usarem a MESMA regra.
// Aprovação (cancelamento/desconto do PDV) é de quem pode aprovar; o operacional é de todos;
// o resto é dinheiro e continua com a turma do Financeiro.
export const PERFIS_APROVAM = ['admin', 'gerente', 'supervisao'];
export const PERFIS_FINANCEIRO = ['admin', 'gerente', 'financeiro'];
const KINDS_OPERACIONAIS = new Set(['estoque_critico', 'recebimento_sem_nota', 'recebimento_parado']);
// "N tarefas vencidas" (2026-09-29, caso Thatiele): o cron conta as tarefas DO DONO na loja
// (criadas por ele ou dele), então a linha é só dele.
export const DONO_EMAIL = 'natalinojr.engel@gmail.com';
/** Papel do banco (inglês) → papel da tela (português). Mesmo mapa do AuthContext. */
export const PAPEL_DO_BANCO: Record<string, string> = {
  admin: 'admin', manager: 'gerente', supervisor: 'supervisao', cashier: 'caixa', waiter: 'garcom',
  kitchen: 'cozinha', delivery_manager: 'gestor_entregas', tasks_only: 'tarefas', tablet: 'totem',
  financeiro: 'financeiro', accountant: 'contabilidade',
};
export function pendenciaVisivelPara(kind: string, perfil: string | undefined, email?: string | null): boolean {
  if (kind === 'tarefa_vencida') return email?.toLowerCase() === DONO_EMAIL;
  if (!perfil) return false;
  if (kind === 'aprovacao') return PERFIS_APROVAM.includes(perfil);
  if (KINDS_OPERACIONAIS.has(kind)) return true;
  return PERFIS_FINANCEIRO.includes(perfil);
}

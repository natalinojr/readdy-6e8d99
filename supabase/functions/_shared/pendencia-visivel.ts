// Quem vê o quê na caixa de pendências (2026-09-28) — mora em _shared (2026-10-03) para a tela e o
// servidor (bom dia e aviso no celular da tela Hoje) usarem a MESMA regra.
// Aprovação (cancelamento/desconto do PDV) é de quem pode aprovar; o operacional é de todos;
// o resto é dinheiro e continua com a turma do Financeiro.
export const PERFIS_APROVAM = ['admin', 'gerente', 'supervisao'];
export const PERFIS_FINANCEIRO = ['admin', 'gerente', 'financeiro'];
// insumo_antes_do_pico (2026-10-03): insumo que não chega ao pico de hoje — é de quem está na loja.
const KINDS_OPERACIONAIS = new Set(['estoque_critico', 'recebimento_sem_nota', 'recebimento_parado', 'insumo_antes_do_pico']);
// Vendas × meta (2026-10-03): o que o Dashboard mostra é de quem vê o Dashboard (gestao_dashboard: admin e gerente).
export const PERFIS_GESTAO = ['admin', 'gerente'];
const KINDS_GESTAO = new Set(['vendas_abaixo_ritmo']);
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
  if (KINDS_GESTAO.has(kind)) return PERFIS_GESTAO.includes(perfil);
  return PERFIS_FINANCEIRO.includes(perfil);
}

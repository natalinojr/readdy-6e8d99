// Competência da conta a pagar (2026-09-30). `fin_accounts_payable.competence_month` (1º dia do mês)
// diz a que mês o gasto pertence — ex.: vale alimentação de agosto pago no fim de julho. Preenchida,
// é ela que põe a conta na DRE por competência; vazia, vale o mês do vencimento (como sempre foi).
// A DRE caixa não muda: segue pela data do pagamento.

/** Contas que caem no período [inicio, fim] (YYYY-MM-DD) pela competência. Filtro para `.or(...)`;
 *  `extra` (condição PostgREST, ex.: or(...)) vale para os dois ramos. */
export function orCompetenciaConta(inicio: string, fim: string, extra?: string): string {
  const ini = inicio.slice(0, 10);
  const end = fim.slice(0, 10);
  const mesIni = ini.slice(0, 7) + '-01';
  const x = extra ? `,${extra}` : '';
  return `and(competence_month.is.null,due_date.gte.${ini},due_date.lte.${end}${x}),`
    + `and(competence_month.gte.${mesIni},competence_month.lte.${end}${x})`;
}

/** Mesmo critério da DRE: conta de compra (custo via CMV) e guia de encargo da folha ficam de fora. */
export const SEM_COMPRA_E_FOLHA = 'or(reference_type.is.null,reference_type.not.in.(purchase,hr_payroll))';

/** 'YYYY-MM' da competência efetiva da conta. */
export function mesCompetencia(b: { competence_month?: string | null; due_date?: string | null }): string {
  return (b.competence_month || b.due_date || '').slice(0, 7);
}

/** 'ago/2026' a partir de 'YYYY-MM'. */
export function rotuloMes(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return '';
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  return `${nomes[m - 1]}/${y}`;
}

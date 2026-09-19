// Permissão por aba do Financeiro e dos Relatórios (Configurações › Permissões, 2026-09-19).
// A chave é gravada em `permissions.permission_key`; não renomear sem migrar as linhas salvas.
// O Financeiro continua só para Admin/Gerente (página e edges financial-write/purchase-write):
// as abas dele servem para limitar o Gerente. Os Relatórios valem para qualquer papel.

export const FIN_ABAS = [
  { aba: 'visao', key: 'fin_visao', label: 'Visão Geral' },
  { aba: 'receitas', key: 'fin_receitas', label: 'Receitas' },
  { aba: 'ifood', key: 'fin_ifood', label: 'iFood' },
  { aba: 'despesas', key: 'fin_despesas', label: 'Despesas' },
  { aba: 'fluxo', key: 'fin_fluxo', label: 'Fluxo de Caixa' },
  { aba: 'pagar', key: 'fin_pagar', label: 'Contas a Pagar' },
  { aba: 'receber', key: 'fin_receber', label: 'Contas a Receber' },
  { aba: 'orcamentos', key: 'fin_orcamentos', label: 'Orçamentos' },
  { aba: 'compras', key: 'fin_compras', label: 'Compras' },
  { aba: 'notas-entrada', key: 'fin_notas_entrada', label: 'Notas de Entrada' },
  { aba: 'itens', key: 'fin_itens', label: 'Classificação de Itens' },
  { aba: 'rh', key: 'fin_rh', label: 'RH / Folha' },
  { aba: 'rh-relatorio', key: 'fin_rh_relatorio', label: 'Relatório RH' },
  { aba: 'freelancers', key: 'fin_freelancers', label: 'Freelancers' },
  { aba: 'centros', key: 'fin_centros', label: 'Centro de Custos' },
  { aba: 'dre', key: 'fin_dre', label: 'DRE' },
  { aba: 'contas-vencidas', key: 'fin_contas_vencidas', label: 'Contas Vencidas' },
  { aba: 'bancos', key: 'fin_bancos', label: 'Bancos e Contas' },
  { aba: 'conciliacao', key: 'fin_conciliacao', label: 'Conciliação' },
  { aba: 'implantacao', key: 'fin_implantacao', label: 'Implantação' },
] as const;

export const REL_ABAS = [
  { aba: 'geral', key: 'rel_geral', label: 'Visão Geral' },
  { aba: 'calendario', key: 'rel_calendario', label: 'Calendário' },
  { aba: 'produtos', key: 'rel_produtos', label: 'Produtos & Ranking' },
  { aba: 'origem', key: 'rel_origem', label: 'Origem dos Pedidos' },
  { aba: 'cmv', key: 'rel_cmv', label: 'CMV & Margem' },
  { aba: 'delivery', key: 'rel_delivery', label: 'Delivery' },
  { aba: 'sla', key: 'rel_sla', label: 'SLA da Cozinha' },
  { aba: 'caixa', key: 'rel_caixa', label: 'Relatório de Caixa' },
  { aba: 'cancelamentos', key: 'rel_cancelamentos', label: 'Cancelamentos' },
  { aba: 'clientes', key: 'rel_clientes', label: 'Clientes / CRM' },
] as const;

export type FinPermissaoKey = (typeof FIN_ABAS)[number]['key'];
export type RelPermissaoKey = (typeof REL_ABAS)[number]['key'];

export const FIN_KEYS: FinPermissaoKey[] = FIN_ABAS.map((a) => a.key);
export const REL_KEYS: RelPermissaoKey[] = REL_ABAS.map((a) => a.key);

const FIN_POR_ABA: Record<string, FinPermissaoKey> = Object.fromEntries(FIN_ABAS.map((a) => [a.aba, a.key]));
const REL_POR_ABA: Record<string, RelPermissaoKey> = Object.fromEntries(REL_ABAS.map((a) => [a.aba, a.key]));

/** Chave da aba do Financeiro ('previsao' é apelido antigo do Fluxo de Caixa). */
export function finKeyDaAba(aba: string): FinPermissaoKey | undefined {
  return FIN_POR_ABA[aba === 'previsao' ? 'fluxo' : aba];
}

export function relKeyDaAba(aba: string): RelPermissaoKey | undefined {
  return REL_POR_ABA[aba];
}

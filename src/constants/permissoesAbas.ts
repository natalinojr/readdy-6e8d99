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
  { aba: 'guias', key: 'fin_guias', label: 'Guias e impostos' },
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
  { aba: 'ifood', key: 'rel_ifood', label: 'iFood' },
  { aba: 'sla', key: 'rel_sla', label: 'SLA da Cozinha' },
  { aba: 'caixa', key: 'rel_caixa', label: 'Relatório de Caixa' },
  { aba: 'cancelamentos', key: 'rel_cancelamentos', label: 'Cancelamentos' },
  { aba: 'clientes', key: 'rel_clientes', label: 'Clientes / CRM' },
] as const;

// Abas de Configurações (2026-09-21). Antes, `configuracoes_editar` era tudo ou
// nada: quem entrava na tela via as oito abas, inclusive Fiscal e a própria
// matriz de Permissões. Agora a tela é liberada aba a aba.
// Regra: as abas de Configurações só valem para Admin/Gerente (a tela inteira
// ainda exige `configuracoes_editar`), e a aba Permissões é só do Admin — quem
// a tem pode se dar qualquer outra permissão.
export const CFG_ABAS = [
  { aba: 'loja', key: 'cfg_loja', label: 'Dados da Loja' },
  { aba: 'fiscal', key: 'cfg_fiscal', label: 'Fiscal (NFC-e)' },
  { aba: 'mesas', key: 'cfg_mesas', label: 'Mesas & QR Codes' },
  { aba: 'estacoes', key: 'cfg_estacoes', label: 'Estações & Pagamentos' },
  { aba: 'impressoras', key: 'cfg_impressoras', label: 'Impressoras' },
  { aba: 'modelos-impressao', key: 'cfg_modelos_impressao', label: 'Modelos de Impressão' },
  { aba: 'operacao', key: 'cfg_operacao', label: 'Operação & Integrações' },
  { aba: 'permissoes', key: 'cfg_permissoes', label: 'Permissões' },
] as const;

export type CfgPermissaoKey = (typeof CFG_ABAS)[number]['key'];

// A maquininha (Mercado Pago Point) tem chave PRÓPRIA, fora das abas: quem só tem
// ela chega na configuração da máquina sem receber o resto de Estações & Pagamentos
// (formas de pagamento, taxas, Stone, Inter, Pix) e sem precisar ser Admin/Gerente —
// é a configuração que a loja mexe sozinha quando troca a máquina do balcão.
export const CFG_MAQUININHA_KEY = 'cfg_maquininha_mp';
export type CfgMaquininhaKey = typeof CFG_MAQUININHA_KEY;

export type FinPermissaoKey = (typeof FIN_ABAS)[number]['key'];
export type RelPermissaoKey = (typeof REL_ABAS)[number]['key'];

export const CFG_KEYS: CfgPermissaoKey[] = CFG_ABAS.map((a) => a.key);

/** Abas de Configurações que um Gerente pode ter: tudo menos a matriz de
 *  Permissões (senão ele se promove sozinho). */
export const CFG_KEYS_GERENTE: CfgPermissaoKey[] = CFG_KEYS.filter((k) => k !== 'cfg_permissoes');

export const FIN_KEYS: FinPermissaoKey[] = FIN_ABAS.map((a) => a.key);
export const REL_KEYS: RelPermissaoKey[] = REL_ABAS.map((a) => a.key);

/** Abas que o papel Contabilidade recebe de fábrica (2026-09-25): conferir (DRE, receitas,
 *  despesas, contas, notas, folha) e dar entrada nos documentos do mês (folha do Domínio e guias
 *  DAS/INSS/FGTS). O dono tira ou põe aba em Configurações › Permissões. */
export const FIN_KEYS_CONTABILIDADE: FinPermissaoKey[] = [
  'fin_guias', 'fin_rh', 'fin_dre', 'fin_receitas', 'fin_despesas',
  'fin_pagar', 'fin_contas_vencidas', 'fin_notas_entrada',
];

const CFG_POR_ABA: Record<string, CfgPermissaoKey> = Object.fromEntries(CFG_ABAS.map((a) => [a.aba, a.key]));
const FIN_POR_ABA: Record<string, FinPermissaoKey> = Object.fromEntries(FIN_ABAS.map((a) => [a.aba, a.key]));
const REL_POR_ABA: Record<string, RelPermissaoKey> = Object.fromEntries(REL_ABAS.map((a) => [a.aba, a.key]));

/** Chave da aba do Financeiro ('previsao' é apelido antigo do Fluxo de Caixa). */
export function finKeyDaAba(aba: string): FinPermissaoKey | undefined {
  // 'rh-relatorio' era aba própria até 2026-09-25; hoje é a subaba Relatórios dentro de RH / Folha.
  return FIN_POR_ABA[aba === 'previsao' ? 'fluxo' : aba === 'rh-relatorio' ? 'rh' : aba];
}

export function relKeyDaAba(aba: string): RelPermissaoKey | undefined {
  return REL_POR_ABA[aba];
}

export function cfgKeyDaAba(aba: string): CfgPermissaoKey | undefined {
  return CFG_POR_ABA[aba];
}

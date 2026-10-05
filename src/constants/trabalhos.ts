// "O que essa pessoa faz?" (acesso por pessoa, 2026-10-03). Cada trabalho, em português do dia a dia,
// liga um conjunto das permissões que já existem (usePermissoes / Configurações › Permissões) — nada de
// chave nova. A tela Usuários › Acesso mostra estes trabalhos; por baixo grava o ajuste da pessoa naquela
// loja (tabela user_permissions) em cima do padrão do cargo. Protótipo aprovado pelo dono:
// docs/prototipos/acesso-por-pessoa-proposta.html.
import { FIN_KEYS } from './permissoesAbas';
import { KEYS_SO_DONO, PAPEIS_PRESOS, ajustesDaPessoa, chaveForaDoCargo } from '../../supabase/functions/_shared/acesso-pessoa';

export { KEYS_SO_DONO, PAPEIS_PRESOS, ajustesDaPessoa, chaveForaDoCargo };

export type EstadoTrabalho = 'on' | 'parcial' | 'off';

export interface Trabalho {
  id: string;
  grupo: 'No atendimento' | 'Cuidando da loja' | 'Gestão' | 'Dinheiro';
  icone: string;
  titulo: string;
  /** o que a pessoa passa a poder, em uma linha */
  pode: string;
  keys: readonly string[];
  /** só o dono liga (o gerente não dá, mesmo tendo) */
  soDono?: boolean;
  /** só aparece para estes cargos: o servidor confere o cargo nesses trabalhos (ex.: o Financeiro
   *  grava só para admin/gerente/financeiro), então liberar para outro cargo não funcionaria */
  papeis?: readonly string[];
  /** nestes cargos o trabalho vem do cargo e não se ajusta por pessoa: o servidor confere o cargo
   *  (ex.: Financeiro do Supervisor, autorizar pelo PIN da Líder). Tirar aqui só esconderia a tela. */
  doCargo?: readonly string[];
}

/** Visão do dinheiro (ver) × lançar: as abas do Financeiro divididas pelo uso. */
export const FIN_VER = ['fin_visao', 'fin_receitas', 'fin_despesas', 'fin_fluxo', 'fin_dre', 'fin_contas_vencidas', 'fin_ifood', 'fin_bancos'] as const;
export const FIN_LANCAR = FIN_KEYS.filter((k) => !(FIN_VER as readonly string[]).includes(k));

const REL_VENDAS = ['rel_geral', 'rel_calendario', 'rel_produtos', 'rel_origem', 'rel_cmv', 'rel_delivery', 'rel_ifood', 'rel_clientes'] as const;

export const TRABALHOS: readonly Trabalho[] = [
  { grupo: 'No atendimento', id: 'vender', icone: 'ri-computer-line', titulo: 'Vende no caixa', pode: 'Abre e fecha o caixa, faz sangria, tira item do pedido', keys: ['pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_cancelar_item'] },
  { grupo: 'No atendimento', id: 'mesas', icone: 'ri-restaurant-line', titulo: 'Atende mesas', pode: 'Fecha a conta da mesa e troca pedido de mesa', keys: ['garcom_fechar_mesa', 'garcom_transferir_mesa'] },
  { grupo: 'No atendimento', id: 'cozinha', icone: 'ri-fire-line', titulo: 'Trabalha na cozinha', pode: 'Vê a tela da cozinha e marca o pedido como pronto', keys: ['kds_acessar', 'gestor_pedidos_acessar', 'gestor_pedidos_entregar'] },
  { grupo: 'No atendimento', id: 'entregas', icone: 'ri-e-bike-2-line', titulo: 'Despacha as entregas', pode: 'Chama o motoboy e acompanha os pedidos de entrega', keys: ['gestor_entregas_acessar', 'gestao_pedidos'] },

  { grupo: 'Cuidando da loja', id: 'autoriza', icone: 'ri-shield-check-line', titulo: 'Autoriza desconto e cancelamento', pode: 'Aprova com o PIN o que o caixa pede — o aviso chega no celular', keys: ['pdv_desconto', 'pdv_cancelar_pedido', 'gestao_aprovacoes'], papeis: ['supervisao', 'gerente'], doCargo: ['supervisao', 'gerente'] },
  { grupo: 'Cuidando da loja', id: 'turno', icone: 'ri-file-list-3-line', titulo: 'Confere o turno', pode: 'Relatórios do caixa, cancelamentos e cozinha; telas Pedidos e Mesas', keys: ['rel_caixa', 'rel_cancelamentos', 'rel_sla', 'gestao_pedidos', 'gestao_mesas'] },
  { grupo: 'Cuidando da loja', id: 'receber', icone: 'ri-truck-line', titulo: 'Recebe mercadoria', pode: 'Confere o que o fornecedor entregou, pelo celular', keys: ['estoque_receber'] },
  { grupo: 'Cuidando da loja', id: 'contar', icone: 'ri-scales-3-line', titulo: 'Conta o estoque', pode: 'Faz a contagem no dia marcado e diz o que contar em cada dia', keys: ['estoque_inventario'] },
  { grupo: 'Cuidando da loja', id: 'estoque', icone: 'ri-archive-line', titulo: 'Cuida do estoque', pode: 'Entradas, perdas, fichas técnicas e o que comprar', keys: ['estoque_movimentar', 'relatorio_estoque'] },
  { grupo: 'Cuidando da loja', id: 'pedir', icone: 'ri-hand-coin-line', titulo: 'Pede pagamentos', pode: 'Reembolso, freelancer, fornecedor sem nota, compra online — o Administrador aprova', keys: ['pag_reembolso', 'pag_freelancer', 'pag_fornecedor', 'pag_compra_online', 'pag_beneficio'] },

  { grupo: 'Gestão', id: 'vendas', icone: 'ri-line-chart-line', titulo: 'Acompanha as vendas', pode: 'Loja ao vivo, faturamento e relatórios de produto e de canal', keys: ['gestao_dashboard', ...REL_VENDAS] },
  { grupo: 'Gestão', id: 'cardapio', icone: 'ri-book-open-line', titulo: 'Cuida do cardápio e dos preços', pode: 'Itens, fotos, preços, horários e promoções', keys: ['cardapio_editar', 'cardapio_alterar_preco', 'gestao_promocoes'] },
  { grupo: 'Gestão', id: 'clientes', icone: 'ri-megaphone-line', titulo: 'Clientes e marketing', pode: 'Base de clientes, vouchers, tráfego pago e artes', keys: ['clientes_ver', 'gestao_vouchers', 'relatorio_financeiro', 'marketing_estudio'], papeis: ['gerente'], doCargo: ['gerente'] },
  { grupo: 'Gestão', id: 'equipe', icone: 'ri-team-line', titulo: 'Cadastra pessoas da equipe', pode: 'Nunca com mais acesso do que ela mesma tem', keys: ['usuarios_gerenciar'], soDono: true, papeis: ['gerente'] },
  { grupo: 'Gestão', id: 'config', icone: 'ri-settings-3-line', titulo: 'Configura a loja', pode: 'Impressoras, mesas e QR, maquininha, delivery', keys: ['configuracoes_editar', 'cfg_loja', 'cfg_mesas', 'cfg_impressoras', 'cfg_modelos_impressao', 'cfg_operacao', 'cfg_maquininha_mp', 'gestao_delivery'], papeis: ['gerente'], doCargo: ['gerente'] },

  { grupo: 'Dinheiro', id: 'finver', icone: 'ri-money-dollar-circle-line', titulo: 'Vê o financeiro', pode: 'Visão geral, DRE, fluxo de caixa, bancos, contas vencidas', keys: FIN_VER, soDono: true, papeis: ['gerente', 'financeiro', 'contabilidade'], doCargo: ['gerente', 'financeiro', 'contabilidade'] },
  { grupo: 'Dinheiro', id: 'finlancar', icone: 'ri-file-add-line', titulo: 'Lança notas, compras e contas', pode: 'Notas de entrada, classificação, folha, guias, conciliação', keys: FIN_LANCAR, soDono: true, papeis: ['gerente', 'financeiro'], doCargo: ['gerente', 'financeiro'] },
  { grupo: 'Dinheiro', id: 'aprovar', icone: 'ri-checkbox-circle-line', titulo: 'Aprova pedidos de pagamento', pode: 'O pedido aprovado vira conta a pagar (ainda não paga)', keys: ['pag_aprovar'], soDono: true },
];

/** O trabalho aparece para este cargo? Cargo preso a uma área só vê o que é da área dele. */
export const trabalhoDoCargo = (t: Trabalho, papel: string) =>
  (!t.papeis || t.papeis.includes(papel)) && (!PAPEIS_PRESOS.includes(papel) || (t.doCargo ?? []).includes(papel));

/** O trabalho vem do cargo (não se liga nem se desliga por pessoa) neste cargo? */
export const trabalhoFixoNoCargo = (t: Trabalho, papel: string) => (t.doCargo ?? []).includes(papel);

export const GRUPOS_TRABALHO: readonly Trabalho['grupo'][] = ['No atendimento', 'Cuidando da loja', 'Gestão', 'Dinheiro'];

/** Ligado (todas as permissões), em parte (algumas) ou desligado. */
export function estadoTrabalho(t: Trabalho, keys: ReadonlySet<string>): EstadoTrabalho {
  const n = t.keys.filter((k) => keys.has(k)).length;
  return n === 0 ? 'off' : n === t.keys.length ? 'on' : 'parcial';
}

/**
 * Liga ou desliga um trabalho no conjunto de permissões da pessoa. Desligar tira só as permissões
 * que nenhum outro trabalho ligado usa (ex.: "Tela Pedidos" é de "Despacha as entregas" e de
 * "Confere o turno").
 */
export function alternarTrabalho(t: Trabalho, keys: ReadonlySet<string>, ligar: boolean): Set<string> {
  const novo = new Set(keys);
  if (ligar) { t.keys.forEach((k) => novo.add(k)); return novo; }
  const usadasPorOutros = new Set<string>();
  for (const o of TRABALHOS) {
    if (o.id !== t.id && estadoTrabalho(o, keys) === 'on') o.keys.forEach((k) => usadasPorOutros.add(k));
  }
  t.keys.forEach((k) => { if (!usadasPorOutros.has(k)) novo.delete(k); });
  return novo;
}

// Papéis, chaves e o padrão de permissão de cada cargo — movido de src/hooks/usePermissoes.ts
// (2026-10-03, acesso por pessoa) para a tela e as Edge Functions usarem a MESMA regra. Camadas:
// padrão do cargo (aqui) → ajuste do cargo na loja (tabela permissions) → ajuste da pessoa na loja
// (tabela user_permissions). Puro: roda no Vite e no Deno. O front reexporta em usePermissoes.
import { FIN_KEYS, FIN_KEYS_CONTABILIDADE, REL_KEYS, CFG_KEYS, CFG_KEYS_GERENTE, CFG_MAQUININHA_KEY, type FinPermissaoKey, type RelPermissaoKey, type CfgPermissaoKey, type CfgMaquininhaKey } from './permissoes-abas.ts';
import { GESTAO_KEYS, type GestaoPermissaoKey } from './permissoes-gestao.ts';

export type Papel = 'admin' | 'gerente' | 'caixa' | 'garcom' | 'cozinha' | 'gestor_entregas' | 'tarefas' | 'financeiro' | 'supervisao' | 'contabilidade';

export type PermissaoKey =
  | 'pdv_abrir_caixa'
  | 'pdv_fechar_caixa'
  | 'pdv_sangria'
  | 'pdv_desconto'
  | 'pdv_cancelar_pedido'
  | 'pdv_cancelar_item'
  | 'pdv_editar_item_pos_kds'
  | 'pdv_estornar_pagamento'
  | 'garcom_fechar_mesa'
  | 'garcom_transferir_mesa'
  | 'cardapio_editar'
  | 'cardapio_alterar_preco'
  | 'estoque_movimentar'
  | 'estoque_inventario'
  | 'estoque_receber'
  | PedidoPermissaoKey
  | 'kds_acessar'
  | 'gestor_pedidos_acessar'
  | 'gestor_pedidos_entregar'
  | 'gestor_entregas_acessar'
  | 'relatorio_financeiro'
  | 'marketing_estudio'
  | 'relatorio_estoque'
  | 'clientes_ver'
  | 'usuarios_gerenciar'
  | 'configuracoes_editar'
  | 'auditoria_ver'
  | FinPermissaoKey
  | RelPermissaoKey
  | CfgPermissaoKey
  | CfgMaquininhaKey
  | GestaoPermissaoKey;

/** Pedidos de pagamento no módulo Recebimentos e pagamentos (/receber) — 2026-09-24.
 *  Pedir: qualquer papel pode ter (padrão Admin/Gerente). Aprovar: padrão só Admin.
 *  O servidor confere de novo (Edge pedidos-pagamento, _shared/pedidos-pagamento.ts). */
export const PEDIDO_KEYS = ['pag_reembolso', 'pag_freelancer', 'pag_fornecedor', 'pag_compra_online', 'pag_beneficio', 'pag_aprovar'] as const;
export type PedidoPermissaoKey = typeof PEDIDO_KEYS[number];
/** Quem entra no módulo /receber: quem recebe mercadoria ou faz/aprova pedido de pagamento. */
export const RECEBER_MODULO_KEYS = ['estoque_receber', 'estoque_movimentar', ...PEDIDO_KEYS] as const;

/** Papel do frontend (PT) → role no banco (enum user_role, em inglês).
 *  A tabela `permissions` grava o role em inglês (manager/cashier/waiter/kitchen),
 *  então o filtro precisa traduzir antes de comparar. */
export const PAPEL_TO_DB_ROLE: Record<string, string> = {
  admin: 'admin',
  gerente: 'manager',
  supervisao: 'supervisor',
  caixa: 'cashier',
  garcom: 'waiter',
  cozinha: 'kitchen',
  gestor_entregas: 'delivery_manager',
  tarefas: 'tasks_only',
  financeiro: 'financeiro',
  contabilidade: 'accountant',
};

/** Permissões padrão por papel (fallback quando não há dados no banco) */
export const DEFAULT_PERMISSOES: Record<Papel, PermissaoKey[]> = {
  admin: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item', 'pdv_editar_item_pos_kds', 'pdv_estornar_pagamento',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'cardapio_editar', 'cardapio_alterar_preco',
    'estoque_movimentar', 'estoque_inventario', 'estoque_receber', 'kds_acessar', 'gestor_pedidos_acessar',
    'gestor_pedidos_entregar', 'gestor_entregas_acessar', 'relatorio_financeiro', 'marketing_estudio', 'relatorio_estoque', 'clientes_ver',
    'usuarios_gerenciar', 'configuracoes_editar', 'auditoria_ver', ...PEDIDO_KEYS,
    ...FIN_KEYS, ...REL_KEYS, ...CFG_KEYS, CFG_MAQUININHA_KEY, ...GESTAO_KEYS,
  ],
  gerente: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item', 'pdv_estornar_pagamento',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'cardapio_editar',
    'estoque_movimentar', 'estoque_inventario', 'estoque_receber', 'kds_acessar', 'gestor_pedidos_acessar',
    'gestor_pedidos_entregar', 'gestor_entregas_acessar', 'relatorio_financeiro', 'marketing_estudio', 'relatorio_estoque', 'clientes_ver', 'auditoria_ver',
    'pag_reembolso', 'pag_freelancer', 'pag_fornecedor', 'pag_compra_online', 'pag_beneficio',
    // As abas de Configurações só entram em cena se o dono ligar
    // `configuracoes_editar` para o Gerente — a tela inteira depende dela.
    ...FIN_KEYS, ...REL_KEYS, ...CFG_KEYS_GERENTE, CFG_MAQUININHA_KEY, ...GESTAO_KEYS,
  ],
  // Entre caixa e gerente: tudo do caixa + desconto/cancelamento (e autoriza os
  // do caixa pelo PIN), mesas, cozinha e os relatórios do turno. Sem cardápio,
  // estoque, financeiro, usuários nem configurações.
  supervisao: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_desconto',
    'pdv_cancelar_pedido', 'pdv_cancelar_item',
    'garcom_fechar_mesa', 'garcom_transferir_mesa', 'kds_acessar', 'gestor_pedidos_acessar',
    'gestor_pedidos_entregar', 'gestor_entregas_acessar', 'clientes_ver',
    'rel_caixa', 'rel_cancelamentos', 'rel_sla', 'gestao_pedidos', 'gestao_mesas',
    // Quem autoriza desconto/cancelamento pelo PIN vê também a tela Aprovações (2026-10-03,
    // acesso por pessoa: antes a supervisão aprovava no caixa mas não via a lista).
    'gestao_aprovacoes',
  ],
  caixa: [
    'pdv_abrir_caixa', 'pdv_fechar_caixa', 'pdv_sangria', 'pdv_cancelar_item',
  ],
  garcom: [
    'garcom_fechar_mesa', 'garcom_transferir_mesa',
  ],
  cozinha: [
    'kds_acessar', 'gestor_pedidos_acessar', 'gestor_pedidos_entregar',
  ],
  gestor_entregas: [
    'gestor_entregas_acessar',
  ],
  // Sem PermissaoKey nenhuma — o módulo de Tarefas não usa esse sistema, e o
  // resto do app fica bloqueado pelo hard-lock de rota (RotaProtegida).
  tarefas: [],
  // Nasce com todas as abas do Financeiro e nada além — o papel é preso ao
  // módulo pelo hard-lock de rota (RotaProtegida / acessoRota.ts).
  financeiro: [...FIN_KEYS],
  // Contador(a) — 2026-09-25. Preso ao Financeiro como o papel 'financeiro', mas só com as
  // abas de conferência e de entrada de documento. No servidor ele lê e só grava a folha e as
  // guias (financial-write › ACOES_CONTABILIDADE, Edge contabilidade): pagar é sempre do dono.
  contabilidade: [...FIN_KEYS_CONTABILIDADE],
};

/** Padrão + linhas salvas (allowed true acrescenta, false tira). */
export function mesclarComPadrao<K extends string>(padrao: readonly K[], linhas: { permission_key: string; allowed: boolean }[]): K[] {
  const set = new Set<string>(padrao);
  for (const r of linhas) {
    if (r.allowed) set.add(r.permission_key);
    else set.delete(r.permission_key);
  }
  return [...set] as K[];
}

/** role do banco (enum user_role, em inglês) → papel do app. */
export const DB_ROLE_TO_PAPEL: Record<string, string> = Object.fromEntries(Object.entries(PAPEL_TO_DB_ROLE).map(([pt, en]) => [en, pt]));

type Linha = { permission_key: string; allowed: boolean };

/**
 * Permissões de uma pessoa numa loja: padrão do cargo → ajuste do cargo na loja → ajuste da pessoa.
 * Admin tem tudo (o dono não é ajustado). `papel` aceita o papel do app (PT) ou o role do banco (EN).
 */
export function permissoesDaPessoa(papel: string, linhasCargo: readonly Linha[], linhasPessoa: readonly Linha[] = []): PermissaoKey[] {
  const pt = (DB_ROLE_TO_PAPEL[papel] ?? papel) as Papel;
  if (pt === 'admin') return [...DEFAULT_PERMISSOES.admin];
  const doCargo = mesclarComPadrao<PermissaoKey>(DEFAULT_PERMISSOES[pt] ?? [], linhasCargo as Linha[]);
  return mesclarComPadrao<PermissaoKey>(doCargo, linhasPessoa as Linha[]);
}

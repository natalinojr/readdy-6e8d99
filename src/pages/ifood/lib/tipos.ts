import type { LojaIfood, useIfoodDados } from './useIfoodDados';

// Contrato entre a página /ifood e as abas (protótipo docs/prototipos/ifood-proposta.html).

export type AbaIfood = 'hoje' | 'pedidos' | 'itens' | 'dinheiro' | 'resultados' | 'loja' | 'conexao';

/** O que a pessoa pode ver/fazer na área iFood (mesmas chaves de permissão do resto do sistema). */
export interface AcessoIfood {
  /** Valores de dinheiro do pedido (chega, sobra): fin_ifood ou rel_ifood. */
  dinheiro: boolean;
  /** Aba Dinheiro (repasses, conferência com o banco): fin_ifood. */
  financeiro: boolean;
  /** Itens e CMV (custo da comida): fin_ifood, rel_ifood, rel_cmv ou cardapio_editar. */
  itens: boolean;
  /** Ligar item do iFood à ficha (a RPC aceita admin/gerente/financeiro). */
  ligar: boolean;
  /** Resultados (relatório): rel_ifood ou fin_ifood. */
  resultados: boolean;
  /** Conectar e ligar (configuração): admin ou gerente. */
  configurar: boolean;
  /** Impressão dos pedidos do iFood (botão da impressora no cabeçalho; quem configura usa a Conexão): admin, gerente, líder e caixa. */
  imprimir: boolean;
}

export type DadosIfood = ReturnType<typeof useIfoodDados>;

export interface AbaProps {
  tenantId: string;
  /** Loja do iFood escolhida no topo (merchant uuid); null = todas. */
  loja: string | null;
  lojas: LojaIfood[];
  /** Período no formato de getPeriodDates ('Hoje', '7 dias', '30 dias', 'Este mês', 'custom:…'). */
  periodo: string;
  acesso: AcessoIfood;
  /** Dados do período (pedidos + dinheiro + custo). Hoje e Pedidos usam; as outras podem buscar o próprio período. */
  dados: DadosIfood;
  /** Últimos 30 dias (mesma leitura para a Hoje e a bolinha da aba Itens). */
  dados30: DadosIfood;
  irPara: (aba: AbaIfood, params?: Record<string, string>) => void;
  /** Abre a folha de um pedido (id do iFood). */
  abrirPedido: (id: string) => void;
}

export const nomeLoja = (lojas: LojaIfood[], id: string | null | undefined) =>
  (id && lojas.find((l) => l.id === id)?.nome) || 'Loja iFood';

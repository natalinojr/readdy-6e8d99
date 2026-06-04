export interface ItemCardapioPublico {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  foto: string;
  categoria: string;
  slaMinutos: number;
  popular?: boolean;
  /** Quando true, o item não passa pela cozinha e vai direto para pronto */
  semPreparo?: boolean;
  /** Quando true, este item é um combo (não tem grupos de opções) */
  isCombo?: boolean;
  /** Observações pré-configuradas específicas deste item (cadastradas no cardápio) */
  observacoesPadrao?: string[];
  /** ID da estação de cozinha vinculada a este item (via categoria) */
  stationId?: string | null;
  opcoes?: {
    grupo: string;
    obrigatorio: boolean;
    itens: { nome: string; precoAdicional: number }[];
  }[];
}

export interface ItemPedidoCliente {
  itemId: string;
  nome: string;
  categoria?: string;
  preco: number;
  quantidade: number;
  opcoesSelecionadas: string[];
  observacao: string;
  clienteNome: string;
  enviadoKds: boolean;
  /** Quando true, o item não passa pela cozinha (skip_kds) */
  semPreparo?: boolean;
  /** ID da estação de cozinha para este item (vindo do cardápio via categoria) */
  stationId?: string | null;
  /** Observações por unidade (quando quantidade > 1) */
  obsUnidades?: string[];
}

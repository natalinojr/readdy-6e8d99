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
}

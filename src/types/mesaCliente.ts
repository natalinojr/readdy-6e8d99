export interface ItemCardapioPublico {
  id: string;
  nome: string;
  descricao: string;
  preco: number;
  foto: string;
  categoria: string;
  slaMinutos: number;
  popular?: boolean;
  /** Quando true, o item está marcado como Destaque do cardápio (menu_highlights ativo) */
  destaque?: boolean;
  /** Ordem de exibição entre os destaques (sort_order); menor primeiro */
  destaqueOrdem?: number;
  /** Quando true, o item tem promoção ativa (preco já reflete o promocional) */
  temPromocao?: boolean;
  /** Preço original antes da promoção (null se não tem promoção ativa) */
  precoOriginal?: number | null;
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
    itens: { id?: string; nome: string; precoAdicional: number }[];
  }[];
}

export interface OpcaoSelecionadaCliente {
  id?: string;
  nome: string;
  precoAdicional: number;
  grupoNome: string;
}

export interface ItemPedidoCliente {
  itemId: string;
  nome: string;
  categoria?: string;
  preco: number;
  quantidade: number;
  opcoesSelecionadas: OpcaoSelecionadaCliente[];
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
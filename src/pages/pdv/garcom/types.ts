import type { CarrinhoItem } from '../../../contexts/PDVContext';

export interface Rodada {
  id: string;
  numero: number;
  nomeResponsavel: string;
  hora: string;
  itens: CarrinhoItem[];
  orderId?: string;
  total?: number;
}

export interface PedidoAvulso {
  id: string;
  nomeCliente: string;
  observacoes: string;
  criadoEm: string;
  garcomNome: string;
  rodadas: Rodada[];
}

export interface Chamado {
  id: string;
  mesaNumero: number;
  clienteNome?: string;
  tipo: 'atendimento' | 'pagamento' | 'pedido';
  hora: string;
  timestamp: number;
  atendido: boolean;
}

import type { PedidoRecente } from '@/types/pdv';

// Contrato das ações sobre um pedido (layout novo de /pedidos). Quem implementa é
// usePedidoAcoes (lib/usePedidoAcoes.tsx); a lista, o "Precisa de você" e o detalhe só chamam.

export type TipoImpressao = 'cliente' | 'cozinha' | 'resumo';

export interface AcoesPedido {
  /** Quem tem acesso ao caixa (cobrar pedido pendente). */
  podeCobrar: boolean;
  /** pdv_cancelar_pedido */
  podeCancelar: boolean;
  /** gestor_pedidos_entregar (marcar pedidos esquecidos como entregues) */
  podeEntregar: boolean;
  /** Abre a janela de receber do caixa (PagamentoRapidoModal). Turno do pedido fechado → pergunta o caminho. */
  cobrar: (p: PedidoRecente) => void;
  imprimir: (p: PedidoRecente, tipo: TipoImpressao) => Promise<void>;
  /** CancelamentoModal (motivo + aprovação; pedido pago vai com estorno). */
  cancelar: (p: PedidoRecente) => void;
  /** Vai ao Gestor de pedidos já com este pedido aberto. */
  abrirNoGestor: (p: PedidoRecente) => void;
  /** wa.me do cliente com o resumo do pedido (só quando tem telefone). */
  whatsapp: (p: PedidoRecente) => void;
  copiarNumero: (p: PedidoRecente) => void;
  /** Pedidos esquecidos andando (de outros dias): baixa como entregues. Devolve quantos deram certo. */
  marcarEntregues: (ids: string[]) => Promise<number>;
}

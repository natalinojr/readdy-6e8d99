// ── Autoatendimento: TABLET (totem) × MOBILE (QR do cliente) ─────────────────
// Os dois chegam ao banco como `origin_type = 'self_service'`, mas são operações
// diferentes:
//   • TABLET (totem da loja): o cliente paga ANTES de retirar — por isso o KDS e o
//     Gestor bloqueiam "marcar entregue" enquanto o pedido não estiver pago.
//   • MOBILE (QR universal, celular do cliente): ele pede sentado/na fila e paga
//     depois — no caixa ou pelo Pix do próprio celular. Bloquear a entrega aqui
//     travaria a cozinha.
// O que separa os dois é o PARTICIPANTE: o QR mobile identifica o cliente por
// senha (table_session_participants); o totem não tem participante.

export type PedidoAutoatendimento = {
  origem?: string | null;
  participantToken?: string | null;
};

/** Pedido feito pelo celular do cliente (QR universal), identificado por senha. */
export function isAutoatendimentoMobile(pedido: PedidoAutoatendimento): boolean {
  return pedido.origem === 'autoatendimento' && !!pedido.participantToken;
}

/** Totem da loja: é o único autoatendimento que exige pagamento antes da entrega. */
export function isAutoatendimentoTablet(pedido: PedidoAutoatendimento): boolean {
  return pedido.origem === 'autoatendimento' && !pedido.participantToken;
}

/**
 * Entrega bloqueada por falta de pagamento — vale só para o totem (tablet).
 * No mobile o pagamento pode vir depois da entrega.
 */
export function bloqueiaEntregaSemPagamento(
  pedido: PedidoAutoatendimento & { isPaid?: boolean | null },
  pagoOverride?: boolean,
): boolean {
  const pago = pagoOverride ?? Boolean(pedido.isPaid);
  return isAutoatendimentoTablet(pedido) && !pago;
}

/** Rótulo curto para badges (KDS, Gestor, Caixa). */
export function autoatendimentoBadge(pedido: PedidoAutoatendimento): { label: string; icon: string } | null {
  if (isAutoatendimentoMobile(pedido)) return { label: 'Auto mobile', icon: 'ri-smartphone-line' };
  return null;
}

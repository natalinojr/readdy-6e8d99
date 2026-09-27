import { invokeWithAuth, supabase } from '@/lib/supabase';

/**
 * Desconto manual quando o pagamento junta vários pedidos (pedidos vinculados).
 *
 * Os pagamentos já são repartidos entre os pedidos na proporção do total de cada um;
 * com o desconto, o que sobra de cada pedido vinculado (total − o que ele recebe) é a
 * parte do desconto dele, e o pedido principal fica com o resto.
 *
 * O order-write só marca o pedido como pago quando a soma dos pagamentos (em ponto
 * flutuante, sem tolerância) é ≥ total_amount — ex.: 2,06 + 4,88 = 6,9399… < 6,94.
 * Por isso cada parte passa por `descontoQueFecha`, que sobe o desconto 1 centavo
 * quando a soma do servidor não alcançaria o novo total.
 */

const r2 = (v: number) => Math.round(v * 100) / 100;

/** Mesma soma do order-write (record_payment), nas duas ordens possíveis de leitura. */
function fechaNoServidor(novoTotal: number, valores: number[]): boolean {
  const ida = valores.reduce((s, v) => s + v, 0);
  const volta = [...valores].reverse().reduce((s, v) => s + v, 0);
  return Math.min(ida, volta) >= novoTotal;
}

/** Desconto (≥ o pedido) que faz o pedido fechar como pago com esses pagamentos. */
export function descontoQueFecha(totalPedido: number, desconto: number, valoresRecebidos: number[]): number {
  const teto = Math.max(0, r2(totalPedido));
  let d = Math.min(Math.max(0, r2(desconto)), teto);
  if (d <= 0) return 0;
  for (let i = 0; i < 3 && d < teto && !fechaNoServidor(r2(totalPedido - d), valoresRecebidos); i++) {
    d = Math.min(r2(d + 0.01), teto);
  }
  return d;
}

/** Parte do desconto de um pedido vinculado: total − o que ele recebe (ajustado para fechar). */
export function descontoDoVinculado(totalPedido: number, valoresRecebidos: number[]): number {
  const recebido = valoresRecebidos.reduce((s, v) => s + v, 0);
  return descontoQueFecha(totalPedido, r2(totalPedido - recebido), valoresRecebidos);
}

/**
 * Grava o desconto num pedido já lançado para que o total dele passe a ser
 * `totalOriginal − desconto`. `totalOriginal` deve ser o total de ANTES da primeira
 * tentativa (congelado pelo chamador): assim, num reenvio após falha parcial, o pedido
 * que já está com esse total não recebe desconto de novo. Pedido já pago é pulado.
 */
export async function aplicarDescontoEmPedidoExistente(params: {
  orderId: string;
  tenantId: string | undefined;
  totalOriginal: number;
  desconto: number;
  autorizadoPor: string | null;
  couponCode?: string | null;
  reason?: string;
  /** Pedido principal do Pagamento rápido passa false: no "Valor adicional a pagar" ele já
   *  está is_paid e o desconto sobre a diferença precisa ser gravado mesmo assim. */
  pularSePago?: boolean;
}): Promise<void> {
  const { orderId, tenantId, totalOriginal, desconto, autorizadoPor, couponCode, reason, pularSePago = true } = params;
  if (desconto < 0.005) return;
  const novoTotal = Math.max(0, r2(totalOriginal - desconto));

  const { data: pedido, error: readErr } = await supabase
    .from('orders')
    .select('discount_amount, total_amount, is_paid')
    .eq('id', orderId)
    .maybeSingle();
  if (readErr || !pedido) throw new Error(`Não foi possível ler o pedido para aplicar o desconto: ${readErr?.message ?? 'pedido não encontrado'}`);
  if (pularSePago && pedido.is_paid) return; // quitado (em outro terminal ou numa tentativa anterior): não mexe no total

  const totalAtual = Number(pedido.total_amount ?? 0);
  // Nunca mais que a parte deste pedido (se o total do banco divergir, não vira desconto extra)
  const aplicarAgora = Math.min(r2(desconto), r2(totalAtual - novoTotal));
  if (aplicarAgora < 0.005) return; // já aplicado (reenvio)

  const { error } = await invokeWithAuth('order-write', {
    body: {
      action: 'apply_discount',
      order_id: orderId,
      tenant_id: tenantId,
      discount_type: 'fixed',
      discount_value: aplicarAgora,
      coupon_code: couponCode ?? null,
      // approved_by é UUID (FK users) — a autorização já foi validada na UI;
      // o NOME do autorizador vai em approval_notes/reason (texto).
      requires_approval: false,
      approved_by: null,
      approval_notes: autorizadoPor ? `Desconto autorizado por: ${autorizadoPor}` : null,
      reason: reason ?? `Desconto rateado entre pedidos vinculados${autorizadoPor ? ` — aut. ${autorizadoPor}` : ''}`,
      new_discount_amount: r2(Number(pedido.discount_amount ?? 0) + aplicarAgora),
      new_total_amount: r2(totalAtual - aplicarAgora),
    },
  });
  if (error) throw error;
}

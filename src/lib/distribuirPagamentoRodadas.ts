/**
 * Distribui um valor parcial (divisão de conta do garçom) entre as rodadas/pedidos da mesa.
 *
 * Cada rodada é um pedido separado no servidor; o order-write recusa (409 order_already_paid)
 * pagamento em pedido já coberto. Por isso o valor de cada pessoa vai para a primeira rodada
 * ainda não coberta, sem ultrapassar o restante dela, e o que sobra continua na seguinte.
 * Excesso sobre o total em aberto fica na última parcela planejada (o servidor aceita excesso
 * em pedido não quitado). Troco (dinheiro) vai só na última parcela.
 */
export interface RodadaSaldo {
  orderId: string;
  /** Quanto ainda falta pagar nesta rodada (total − pagamentos não estornados). */
  restante: number;
  /** Servidor já respondeu order_already_paid para esta rodada: não tentar de novo. */
  bloqueada?: boolean;
}

export interface ParcelaPagamento {
  orderId: string;
  amount: number;
  change: number;
}

const cents = (v: number) => Math.round(v * 100) / 100;

export function distribuirPagamentoRodadas(
  valor: number,
  rodadas: RodadaSaldo[],
  troco = 0,
): ParcelaPagamento[] {
  let falta = cents(valor);
  if (!(falta > 0)) return [];
  const disponiveis = rodadas.filter((r) => r.orderId && !r.bloqueada);
  if (disponiveis.length === 0) return [];

  const plano: ParcelaPagamento[] = [];
  for (const r of disponiveis) {
    if (falta <= 0) break;
    const restante = cents(Math.max(0, r.restante));
    if (restante <= 0) continue;
    const amount = cents(Math.min(restante, falta));
    plano.push({ orderId: r.orderId, amount, change: 0 });
    falta = cents(falta - amount);
  }

  if (falta > 0) {
    if (plano.length > 0) {
      const ultima = plano[plano.length - 1];
      ultima.amount = cents(ultima.amount + falta);
    } else {
      // Nenhuma rodada com saldo conhecido: tenta a última disponível (o servidor decide).
      plano.push({ orderId: disponiveis[disponiveis.length - 1].orderId, amount: falta, change: 0 });
    }
  }

  plano[plano.length - 1].change = cents(Math.max(0, troco));
  return plano;
}

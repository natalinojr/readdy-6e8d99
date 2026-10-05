import type { PedidoRecente, PedidoItemDetalhe, PagamentoPedido } from '@/types/pdv';
import { numeroCurto } from '@/lib/pedidosRegras';

// Texto do pedido para as ações da tela Pedidos (WhatsApp, resumo impresso). Puro: sem tela, sem rede.

/** R$ 1.234,56 com espaço comum (o espaço "não quebrável" do toLocaleString vira "á" na térmica e quebra link). */
export function moedaTexto(v: number): string {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/ /g, ' ');
}

/** Cartão de "pagos juntos": vários pedidos num só (pedidoIds com mais de um). */
export function ehGrupo(p: Pick<PedidoRecente, 'pedidoIds'>): boolean {
  return (p.pedidoIds?.length ?? 0) > 1;
}

/** "#048" ou, em pagos juntos, "#048 + #049". */
export function rotuloNumero(p: PedidoRecente): string {
  const originais = p.pedidosOriginais ?? [];
  if (ehGrupo(p) && originais.length > 1) return originais.map((o) => `#${numeroCurto(o)}`).join(' + ');
  return `#${numeroCurto(p)}`;
}

/** Itens que valem: o que foi cancelado fica de fora do que se imprime ou se manda ao cliente. */
export function itensAtivos(p: Pick<PedidoRecente, 'itensDetalhes'>): PedidoItemDetalhe[] {
  return p.itensDetalhes.filter((i) => !i.cancelado);
}

/** Quanto já entrou (pagamentos não estornados). Dinheiro: o valor é o líquido, sem o troco. */
export function totalRecebido(pagamentos?: PagamentoPedido[]): number {
  return (pagamentos ?? []).filter((pg) => !pg.is_refunded).reduce((s, pg) => s + (Number(pg.amount) || 0), 0);
}

/**
 * Mensagem do WhatsApp com o resumo do pedido:
 *   Pedido #048 — Nome da loja
 *   2× Taco al pastor
 *   Total R$ 122,00
 */
export function textoWhatsapp(p: PedidoRecente, nomeLoja?: string): string {
  const cabecalho = `${ehGrupo(p) ? 'Pedidos' : 'Pedido'} ${rotuloNumero(p)}${nomeLoja?.trim() ? ` — ${nomeLoja.trim()}` : ''}`;
  const linhas = itensAtivos(p).map((i) => `${i.quantidade}× ${i.nome}`);
  return [cabecalho, ...linhas, `Total ${moedaTexto(p.total)}`].join('\n');
}

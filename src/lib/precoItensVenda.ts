// Preço unitário efetivo dos itens vendidos, para telas que somam item_price × quantity de VÁRIOS pedidos
// (faturamento por categoria, mais vendidos, ação "Vendas do dia"). order_items.item_price não tem o mesmo
// significado em todo canal: no delivery é só o preço base (combo nasce com 0 e o valor vai nos adicionais),
// nos demais já inclui os adicionais. A regra de decisão está em precoItemPedido.ts (por pedido, pelo subtotal);
// aqui só agrupamos os itens por pedido para aplicá-la.
import { precosEfetivos } from './precoItemPedido';

export interface ItemDeVenda {
  order_id: string;
  item_price: number | string | null;
  quantity: number | null;
  /** adicionais pagos do item (order_item_options) */
  order_item_options?: { additional_price: number | string | null }[] | null;
}

export interface PedidoParaPreco {
  subtotal: number | string | null;
  origin_type: string | null;
}

/** Preço unitário efetivo de cada item, na mesma ordem da entrada. Pedido que não veio no mapa fica com o item_price cru. */
export function precosEfetivosDosItens(itens: ItemDeVenda[], pedidos: Map<string, PedidoParaPreco>): number[] {
  const porPedido = new Map<string, number[]>();
  itens.forEach((it, i) => {
    const l = porPedido.get(it.order_id);
    if (l) l.push(i); else porPedido.set(it.order_id, [i]);
  });
  const out = new Array<number>(itens.length).fill(0);
  for (const [orderId, idx] of porPedido) {
    const ped = pedidos.get(orderId);
    const sub = ped?.subtotal != null ? Number(ped.subtotal) : null;
    const precos = precosEfetivos(
      idx.map((i) => ({
        preco: Number(itens[i].item_price ?? 0) || 0,
        quantidade: itens[i].quantity ?? 1,
        adicionais: (itens[i].order_item_options ?? []).reduce((a, o) => a + (Number(o.additional_price ?? 0) || 0), 0),
      })),
      sub != null && Number.isFinite(sub) ? sub : null,
      ped?.origin_type ?? null,
    );
    idx.forEach((i, k) => { out[i] = precos[k]; });
  }
  return out;
}

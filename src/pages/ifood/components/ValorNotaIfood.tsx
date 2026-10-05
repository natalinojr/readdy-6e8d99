import Ajuda from '@/pages/estoque/components/inicio/Ajuda';
import { brl } from '@/pages/estoque/components/ui/EstoqueUi';
import type { PedidoOrder } from '@/lib/ifoodArea';
import { valorVendaIfood } from '../../../../supabase/functions/_shared/ifood-valores';

/**
 * Valor da nota fiscal (NFC-e) do pedido do iFood, com a conta no (?) (dono, 05/10).
 * Mesma regra da nota emitida: _shared/ifood-valores.ts (usada pela fiscal-write e pelo funil) — a tela nunca
 * diverge da nota. Venda = itens + entrega feita pela loja − desconto bancado pela loja.
 */
export function notaDoPedido(o: PedidoOrder) {
  const descItens = Math.max(0, o.promoLoja - o.promoLojaEntrega);
  const v = valorVendaIfood({
    order_type: o.tipo ?? 'DELIVERY', delivered_by: o.entregaPor,
    total: { subTotal: o.subTotal, deliveryFee: o.entregaCliente },
    benefits: [
      { target: 'ITEM', sponsorshipValues: [{ name: 'MERCHANT', value: descItens }] },
      { target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'MERCHANT', value: o.promoLojaEntrega }] },
    ],
  });
  const entregaLoja = v.taxaLoja > 0;
  return { ...v, descItens, entregaGratisLoja: entregaLoja ? o.promoLojaEntrega : 0, entregaGratisForaNota: entregaLoja ? 0 : o.promoLojaEntrega, entregaLoja };
}

export default function ValorNotaIfood({ o }: { o: PedidoOrder }) {
  const n = notaDoPedido(o);
  const ifoodEntrega = o.tipo === 'DELIVERY' && !n.entregaLoja;
  const candidatos: [string, number][] = [
    ['Desconto pago pelo iFood (volta no repasse)', o.promoIfood],
    [ifoodEntrega ? 'Entrega paga pelo cliente (é do iFood)' : '', ifoodEntrega ? o.entregaCliente : 0],
    ['Entrega grátis paga pela loja (custo cobrado pelo iFood)', n.entregaGratisForaNota],
    ['Taxa de serviço (é do iFood)', o.taxaServico],
  ];
  const fora = candidatos.filter(([r, v]) => r && v > 0.005);
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 mt-1 border-t border-dashed border-zinc-200 text-[13px]">
      <span className="text-zinc-600 inline-flex items-center gap-1">
        Valor da nota fiscal (NFC-e)
        <Ajuda titulo="Como sai o valor da nota">
          <span className="block tabular-nums">
            Itens no iFood: <b>{brl(n.subtotal)}</b>
            {n.entregaLoja && <><br />+ Entrega feita pela loja: <b>{brl(n.taxaLoja)}</b></>}
            {n.descItens > 0.005 && <><br />− Desconto nos itens pago pela loja: <b>{brl(n.descItens)}</b></>}
            {n.entregaGratisLoja > 0.005 && <><br />− Entrega grátis paga pela loja: <b>{brl(n.entregaGratisLoja)}</b></>}
            <br />= <b>{brl(n.valorVenda)}</b>
          </span>
          {fora.length > 0 && (
            <>
              <br /><b>Fora da nota:</b>
              {fora.map(([r, v]) => <span key={r} className="block tabular-nums">· {r}: {brl(v)}</span>)}
            </>
          )}
          <br />Comissão e taxas do iFood também ficam fora: são despesa da loja, não abatem a nota. O que o cliente pagou no app sai como forma "99 – iFood - online". A nota só sai com o pedido concluído no iFood e com a NFC-e do iFood ligada na loja.
        </Ajuda>
      </span>
      <b className="tabular-nums whitespace-nowrap text-zinc-900">{brl(n.valorVenda)}</b>
    </div>
  );
}

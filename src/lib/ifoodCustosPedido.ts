// Custos REAIS de cada pedido do iFood em colunas (aba iFood › Pedidos › Custos; dono 06/10/2026) + custos que a
// loja cria (impostos, royalties…: tabela ifood_custos_extras). Lógica pura — testada em
// src/test/lib/ifoodCustosPedido.test.ts.
//
// A conta fecha com o "chega na loja" da área iFood (ifoodArea.ts):
//   chega = venda − desconto da loja (itens + entrega grátis) − comissão − taxa de pagamento − outras taxas do iFood
//           (entrega sob demanda, outros serviços) + ajustes
// Pedido que o iFood ainda não fechou (estimado): comissão e taxas vêm juntas (média da loja), sem quebra.

import type { PedidoArea } from '@/lib/ifoodArea';
import { valorVendaIfood } from '../../supabase/functions/_shared/ifood-valores';

export type BaseCusto = 'venda' | 'nota' | 'chega' | 'lucro';
export interface CustoExtra { id?: string; nome: string; tipo: 'percentual' | 'fixo'; base: BaseCusto | null; valor: number; ativo: boolean }

export const ROTULO_BASE: Record<BaseCusto, string> = {
  venda: 'vendas no iFood',
  nota: 'valor da nota fiscal',
  chega: 'o que chega na loja',
  lucro: 'lucro bruto',
};

export interface ColunasPedido {
  venda: number;
  /** Desconto da loja nos itens (cupom/promoção da loja). */
  descItens: number;
  /** Entrega grátis paga pela loja. */
  entregaGratis: number;
  /** null quando o iFood ainda não fechou (só o total estimado em comissaoETaxas). */
  comissao: number | null;
  taxaPagamento: number | null;
  /** Entrega sob demanda + outros serviços − ajustes a favor. */
  outrasIfood: number | null;
  comissaoETaxas: number | null;
  chega: number | null;
  /** Valor da nota fiscal (itens + entrega da loja − desconto da loja). */
  nota: number;
  comida: number | null;
  lucroBruto: number | null;
  estimado: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function colunasDoPedido(p: PedidoArea): ColunasPedido {
  const f = p.fin;
  const fechado = !!f && !f.semTaxas && !p.estimado;
  const entregaGratis = r2(Math.min(p.promoLoja, p.promoLojaEntrega ?? 0));
  const descItens = r2(Math.max(0, p.promoLoja - entregaGratis));
  const o = p.order;
  const nota = o
    ? valorVendaIfood({
      order_type: o.tipo ?? 'DELIVERY', delivered_by: o.entregaPor,
      total: { subTotal: o.subTotal, deliveryFee: o.entregaCliente },
      benefits: [
        { target: 'ITEM', sponsorshipValues: [{ name: 'MERCHANT', value: descItens }] },
        { target: 'DELIVERY_FEE', sponsorshipValues: [{ name: 'MERCHANT', value: entregaGratis }] },
      ],
    }).valorVenda
    : r2(Math.max(0, p.venda - descItens));
  return {
    venda: r2(p.venda),
    descItens,
    entregaGratis,
    comissao: fechado ? r2(f!.comissao) : null,
    taxaPagamento: fechado ? r2(f!.transacao) : null,
    outrasIfood: fechado ? r2(f!.entregaSobDemanda + f!.outrosServicos - f!.ajustes) : null,
    comissaoETaxas: p.comissaoETaxas == null ? null : r2(p.comissaoETaxas),
    chega: p.chega == null ? null : r2(p.chega),
    nota: r2(nota),
    comida: p.comida == null ? null : r2(p.comida),
    lucroBruto: p.sobra == null ? null : r2(p.sobra),
    estimado: p.estimado,
  };
}

/** Valor de um custo extra no pedido (null quando a base ainda não existe — ex.: lucro sem ficha). */
export function valorCusto(c: CustoExtra, col: ColunasPedido): number | null {
  if (!c.ativo) return 0;
  if (c.tipo === 'fixo') return r2(c.valor);
  const base = c.base === 'venda' ? col.venda : c.base === 'nota' ? col.nota : c.base === 'chega' ? col.chega : c.base === 'lucro' ? col.lucroBruto : null;
  if (base == null) return null;
  return r2(Math.max(0, base) * c.valor / 100);
}

export interface ResultadoPedido { custos: (number | null)[]; totalCustos: number | null; resultado: number | null; margem: number | null }

/** Resultado = lucro bruto − custos da loja; margem sobre as vendas. Sem lucro bruto (item sem ficha) não fecha. */
export function resultadoDoPedido(col: ColunasPedido, custos: CustoExtra[]): ResultadoPedido {
  const ativos = custos.filter((c) => c.ativo);
  const vals = ativos.map((c) => valorCusto(c, col));
  const totalCustos = vals.some((v) => v == null) ? null : r2(vals.reduce<number>((s, v) => s + (v ?? 0), 0));
  const resultado = col.lucroBruto == null || totalCustos == null ? null : r2(col.lucroBruto - totalCustos);
  const margem = resultado == null || !(col.venda > 0) ? null : Math.round((resultado / col.venda) * 1000) / 10;
  return { custos: vals, totalCustos, resultado, margem };
}

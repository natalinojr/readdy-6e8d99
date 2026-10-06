import { useMemo } from 'react';
import type { PedidoArea } from '@/lib/ifoodArea';
import { brl } from '@/components/kit';
import { colunasDoPedido, resultadoDoPedido, ROTULO_BASE, type ColunasPedido, type CustoExtra } from '@/lib/ifoodCustosPedido';

// Pedidos › Custos (dono 06/10/2026): cada pedido numa linha com TODOS os custos reais em colunas (o que o iFood
// cobrou, as promoções pagas pela loja, a comida) e, no fim, os custos que a loja cadastrou (impostos, royalties…).
// Conta em src/lib/ifoodCustosPedido.ts. Pedido que o iFood ainda não fechou: comissão e taxas estimadas (~).

const SOMAVEIS = ['venda', 'descItens', 'entregaGratis', 'comissao', 'taxaPagamento', 'outrasIfood', 'chega', 'nota', 'comida', 'lucroBruto'] as const;

/** Valor com sinal real. `custo`: positivo é saída ("− R$ x"), negativo é crédito ("+ R$ x"). `parcial`: total sem todos. */
function Num({ v, custo = false, forte = false, tom, parcial = false }: { v: number | null; custo?: boolean; forte?: boolean; tom?: 'red' | 'green'; parcial?: boolean }) {
  if (v == null) return <span className="text-zinc-300">—</span>;
  const zero = Math.abs(v) < 0.005;
  const sinal = zero ? '' : custo ? (v > 0 ? '− ' : '+ ') : v < 0 ? '− ' : '';
  const cor = tom === 'red' ? 'text-red-600' : tom === 'green' ? 'text-emerald-700' : custo && v < 0 ? 'text-emerald-700' : 'text-zinc-900';
  return <span className={`tabular-nums ${forte ? 'font-extrabold' : ''} ${cor}`}>{sinal}{brl(Math.abs(v))}{parcial ? '*' : ''}</span>;
}

/** Soma o que é conhecido; `parcial` quando algum pedido não tem o valor. */
function somar(vals: (number | null)[]): { v: number | null; parcial: boolean } {
  const conhecidos = vals.filter((x): x is number => x != null);
  return { v: conhecidos.length ? conhecidos.reduce((s, x) => s + x, 0) : null, parcial: conhecidos.length > 0 && conhecidos.length < vals.length };
}

export default function CustosPedidosTabela({ pedidos, custos, onAbrir, nomeLoja }: {
  pedidos: PedidoArea[]; custos: CustoExtra[]; onAbrir: (id: string) => void; nomeLoja?: (p: PedidoArea) => string | undefined;
}) {
  const ativos = custos.filter((c) => c.ativo);
  const linhas = useMemo(() => pedidos.filter((p) => !p.cancelado).map((p) => {
    const col = colunasDoPedido(p);
    return { p, col, res: resultadoDoPedido(col, ativos) };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [pedidos, custos]);

  const total = useMemo(() => {
    const t = {} as Record<(typeof SOMAVEIS)[number] | 'comissaoETaxas', { v: number | null; parcial: boolean }>;
    for (const k of SOMAVEIS) t[k] = somar(linhas.map((l) => l.col[k] as number | null));
    t.comissaoETaxas = somar(linhas.map((l) => l.col.comissaoETaxas));
    const custosT = ativos.map((_, i) => somar(linhas.map((l) => l.res.custos[i])));
    const resultado = somar(linhas.map((l) => l.res.resultado));
    // Margem do total só sobre os pedidos que têm resultado.
    const vendaComRes = linhas.filter((l) => l.res.resultado != null).reduce((s, l) => s + l.col.venda, 0);
    const margem = resultado.v == null || !(vendaComRes > 0) ? null : Math.round((resultado.v / vendaComRes) * 1000) / 10;
    const semResultado = linhas.filter((l) => l.res.resultado == null).length;
    return { t, custosT, resultado, margem, semResultado };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linhas]);

  const estimados = linhas.some((l) => l.col.estimado);
  const th = 'px-3 py-2 text-right font-extrabold whitespace-nowrap';
  const td = 'px-3 py-2 text-right whitespace-nowrap text-[12.5px]';
  const comissaoCel = (c: ColunasPedido) => (c.comissao != null ? <Num v={c.comissao} custo /> : c.comissaoETaxas != null ? <span title="Estimado pela média da loja (o iFood fecha no dia seguinte)">~<Num v={c.comissaoETaxas} custo /></span> : <Num v={null} />);

  if (linhas.length === 0) {
    return <p className="text-[13px] text-zinc-500 bg-white border border-zinc-200 rounded-2xl px-4 py-6 text-center">Nenhum pedido válido para a conta de custos (pedido cancelado não entra).</p>;
  }
  return (
    <div className="bg-white border border-zinc-200 rounded-2xl overflow-x-auto min-w-0">
      <table className="text-left min-w-max">
        <thead>
          <tr className="text-[10.5px] uppercase tracking-wide text-zinc-400 border-b border-zinc-100">
            <th className="px-3 py-2 font-extrabold sticky left-0 bg-white z-10">Pedido</th>
            <th className={th}>Vendas</th>
            <th className={th} title="Cupom ou promoção paga pela loja nos itens">Desc. loja</th>
            <th className={th} title="Entrega grátis paga pela loja">Entrega grátis</th>
            <th className={th}>Comissão</th>
            <th className={th}>Taxa pgto.</th>
            <th className={th} title="Entrega sob demanda, outros serviços e ajustes do iFood">Outras iFood</th>
            <th className={`${th} text-zinc-600`}>Chega na loja</th>
            <th className={th}>Comida</th>
            <th className={`${th} text-zinc-600`}>Lucro bruto</th>
            {ativos.map((c, i) => (
              <th key={i} className={`${th} text-amber-700`} title={c.tipo === 'fixo' ? `R$ ${c.valor} por pedido` : `${c.valor}% de ${ROTULO_BASE[c.base ?? 'nota']}`}>
                {c.nome}<span className="block normal-case font-semibold text-[10px] text-amber-600/80">{c.tipo === 'fixo' ? `R$ ${c.valor.toFixed(2).replace('.', ',')}/pedido` : `${String(c.valor).replace('.', ',')}% ${ROTULO_BASE[c.base ?? 'nota']}`}</span>
              </th>
            ))}
            <th className={`${th} text-zinc-700`}>{ativos.length ? 'Resultado' : 'Resultado'}</th>
            <th className={th}>Margem</th>
            <th className={th} title="Valor da nota fiscal (NFC-e): itens + entrega da loja − desconto da loja">Nota fiscal</th>
          </tr>
        </thead>
        <tbody>
          <tr className="bg-zinc-50 border-b border-zinc-200 font-extrabold">
            <td className="px-3 py-2 text-[12.5px] sticky left-0 bg-zinc-50 z-10">Total · {linhas.length}</td>
            <td className={td}><Num v={total.t.venda.v} forte /></td>
            <td className={td}><Num v={total.t.descItens.v} custo /></td>
            <td className={td}><Num v={total.t.entregaGratis.v} custo /></td>
            <td className={td}>{!total.t.comissao.parcial && total.t.comissao.v != null
              ? <Num v={total.t.comissao.v} custo />
              : <span title="Inclui pedidos estimados: comissão + taxas juntas pela média da loja">~<Num v={total.t.comissaoETaxas.v} custo parcial={total.t.comissaoETaxas.parcial} /></span>}</td>
            <td className={td}><Num v={total.t.taxaPagamento.v} custo parcial={total.t.taxaPagamento.parcial} /></td>
            <td className={td}><Num v={total.t.outrasIfood.v} custo parcial={total.t.outrasIfood.parcial} /></td>
            <td className={td}><Num v={total.t.chega.v} forte parcial={total.t.chega.parcial} /></td>
            <td className={td}><Num v={total.t.comida.v} custo parcial={total.t.comida.parcial} /></td>
            <td className={td}><Num v={total.t.lucroBruto.v} forte parcial={total.t.lucroBruto.parcial} tom={total.t.lucroBruto.v == null ? undefined : total.t.lucroBruto.v < 0 ? 'red' : 'green'} /></td>
            {total.custosT.map((c, i) => <td key={i} className={td}><Num v={c.v} custo parcial={c.parcial} /></td>)}
            <td className={td}><Num v={total.resultado.v} forte parcial={total.resultado.parcial} tom={total.resultado.v == null ? undefined : total.resultado.v < 0 ? 'red' : 'green'} /></td>
            <td className={td}>{total.margem == null ? '—' : `${String(total.margem).replace('.', ',')}%`}</td>
            <td className={td}><Num v={total.t.nota.v} /></td>
          </tr>
          {linhas.map(({ p, col, res }) => (
            <tr key={p.id} onClick={() => onAbrir(p.id)} className="border-b border-zinc-100 hover:bg-amber-50/40 cursor-pointer">
              <td className="px-3 py-2 sticky left-0 bg-white z-10">
                <p className="text-[12.5px] font-extrabold text-zinc-900 whitespace-nowrap">#{p.numero ?? '—'} <span className="font-semibold text-zinc-400">{p.at.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span></p>
                <p className="text-[11px] text-zinc-400 truncate max-w-[160px]">{[nomeLoja?.(p), p.cliente].filter(Boolean).join(' · ')}{col.estimado ? ' · estimado' : ''}</p>
              </td>
              <td className={td}><Num v={col.venda} /></td>
              <td className={td}><Num v={col.descItens} custo /></td>
              <td className={td}><Num v={col.entregaGratis} custo /></td>
              <td className={td}>{comissaoCel(col)}</td>
              <td className={td}><Num v={col.taxaPagamento} custo /></td>
              <td className={td}><Num v={col.outrasIfood} custo /></td>
              <td className={td}><Num v={col.chega} forte /></td>
              <td className={td}>{col.comida != null ? <Num v={col.comida} custo /> : p.order ? <span className="text-orange-600 font-bold text-[11.5px]">sem ficha</span> : <span className="text-zinc-300" title="Pedido de antes de ligar os pedidos no ERPOS: sem os itens">—</span>}</td>
              <td className={td}><Num v={col.lucroBruto} forte tom={col.lucroBruto == null ? undefined : col.lucroBruto < 0 ? 'red' : 'green'} /></td>
              {res.custos.map((v, i) => <td key={i} className={td}><Num v={v} custo /></td>)}
              <td className={td}><Num v={res.resultado} forte tom={res.resultado == null ? undefined : res.resultado < 0 ? 'red' : 'green'} /></td>
              <td className={td}>{res.margem == null ? '—' : `${String(res.margem).replace('.', ',')}%`}</td>
              <td className={td}><Num v={col.nota} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {(estimados || total.semResultado > 0) && (
        <p className="text-[11px] text-zinc-400 px-3 py-2 border-t border-zinc-100 space-x-2">
          {estimados && <span>~ estimado: o iFood fecha comissão e taxas no dia seguinte; até lá vale a média da loja nos últimos 30 dias.</span>}
          {total.semResultado > 0 && <span>* total só dos pedidos com o valor — {total.semResultado} pedido{total.semResultado === 1 ? '' : 's'} sem ficha ou sem os itens ficam de fora do lucro e do resultado.</span>}
        </p>
      )}
    </div>
  );
}

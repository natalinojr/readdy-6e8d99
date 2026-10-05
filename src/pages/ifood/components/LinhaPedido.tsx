import { brl } from '@/components/kit';
import { situacaoPedido, rotuloCliente, type PedidoArea } from '@/lib/ifoodArea';

// Uma linha de pedido do iFood (Hoje e Pedidos). Celular: lista; computador: linha de tabela (LinhaPedidoTabela).
// Selo só quando foge do normal: andando, cancelado, promoção paga pela loja, item sem ficha.

const TOM: Record<string, string> = {
  amber: 'bg-amber-50 text-amber-700', blue: 'bg-blue-50 text-blue-700', green: 'bg-emerald-50 text-emerald-700',
  red: 'bg-red-50 text-red-600', zinc: 'bg-zinc-100 text-zinc-600',
};
const hhmm = (d: Date) => d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

export function situacaoDaArea(p: PedidoArea) {
  if (p.order) return situacaoPedido(p.order.status);
  return p.cancelado ? situacaoPedido('cancelled') : situacaoPedido('concluded');
}

export function resumoItens(p: PedidoArea): string {
  if (!p.order) return 'Itens não disponíveis (pedido de antes de ligar os pedidos no ERPOS)';
  return p.order.itens.map((i) => `${i.qtd}× ${i.nome}`).join(' · ') || '—';
}

/** Desconto do pedido dividido: quanto a loja pagou e quanto o iFood pagou. */
export function SeloDesconto({ p }: { p: PedidoArea }) {
  if (p.promoLoja <= 0.005 && p.promoIfood <= 0.005) return null;
  return (
    <span className="text-[11px] font-extrabold rounded-md px-1.5 py-0.5 bg-violet-50 text-violet-700 whitespace-nowrap" title="Desconto dado ao cliente: a parte da loja sai do que chega para você; a parte do iFood não.">
      <i className="ri-coupon-3-line" /> desconto{p.promoLoja > 0.005 ? ` loja ${brl(p.promoLoja)}` : ''}{p.promoLoja > 0.005 && p.promoIfood > 0.005 ? ' ·' : ''}{p.promoIfood > 0.005 ? ` iFood ${brl(p.promoIfood)}` : ''}{p.promoLojaEntrega > 0.005 ? ` (entrega grátis ${brl(p.promoLojaEntrega)} da loja)` : ''}
    </span>
  );
}

/** Selo da sobra: verde, âmbar (até 15%), vermelho (prejuízo) ou cinza (sem ficha / fecha amanhã). */
export function SeloSobra({ p, mostrarDinheiro }: { p: PedidoArea; mostrarDinheiro: boolean }) {
  if (!mostrarDinheiro || p.cancelado) return null;
  if (p.sobra == null) {
    const t = p.semFicha.length ? 'item sem ficha' : p.chega == null ? 'fecha amanhã' : '—';
    return <span className="text-[10.5px] font-extrabold rounded-md px-1.5 py-0.5 bg-zinc-100 text-zinc-500 whitespace-nowrap">{t}</span>;
  }
  const pct = p.venda > 0.005 ? p.sobra / p.venda : 0;
  const cor = p.sobra < -0.005 ? 'bg-red-50 text-red-600' : pct < 0.15 ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700';
  return <span className={`text-[10.5px] font-extrabold rounded-md px-1.5 py-0.5 whitespace-nowrap ${cor}`} title={p.estimado ? 'Estimado: o iFood fecha as taxas no dia seguinte' : undefined}>
    lucro {p.sobra < 0 ? '−' : ''}{brl(Math.abs(p.sobra))}{p.estimado ? '*' : ''}
  </span>;
}

export default function LinhaPedido({ p, onAbrir, mostrarDinheiro, nomeLoja }: {
  p: PedidoArea; onAbrir: (id: string) => void; mostrarDinheiro: boolean; nomeLoja?: string;
}) {
  const s = situacaoDaArea(p);
  return (
    <button type="button" onClick={() => onAbrir(p.id)}
      className={`w-full text-left flex gap-3 items-start py-3 border-t border-zinc-100 first:border-t-0 cursor-pointer ${p.cancelado ? 'opacity-60' : ''}`}>
      <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-none bg-red-50 text-[#EA1D2C]"><i className="ri-e-bike-2-line text-lg" /></div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2 min-w-0">
          <b className="text-[15px] font-extrabold tracking-tight">{p.numero ? `#${p.numero}` : 'iFood'}</b>
          <span className="text-[13.5px] font-bold text-zinc-800 truncate">{p.cliente ?? ''}{nomeLoja ? <span className="text-zinc-400 font-semibold"> · {nomeLoja}</span> : null}</span>
        </div>
        <p className="text-xs text-zinc-400 mt-0.5 truncate">{resumoItens(p)}</p>
        <div className="flex gap-1.5 flex-wrap mt-1.5">
          <span className={`text-[11px] font-extrabold rounded-md px-1.5 py-0.5 ${TOM[s.tom]}`}>{s.rotulo}</span>
          {rotuloCliente(p.pedidosAntes) && <span className={`text-[11px] font-extrabold rounded-md px-1.5 py-0.5 ${p.pedidosAntes === 0 ? 'bg-sky-50 text-sky-700' : 'bg-zinc-100 text-zinc-600'}`}>{p.pedidosAntes === 0 ? <><i className="ri-user-add-line" /> </> : null}{rotuloCliente(p.pedidosAntes)}</span>}
          <SeloDesconto p={p} />
          {p.semFicha.length > 0 && <span className="text-[11px] font-extrabold rounded-md px-1.5 py-0.5 bg-orange-50 text-orange-700">item sem ficha</span>}
        </div>
      </div>
      <div className="text-right flex-none">
        <b className={`block text-[14.5px] font-extrabold whitespace-nowrap ${p.cancelado ? 'line-through text-zinc-400' : ''}`}>{brl(p.order?.subTotal ?? p.venda)}</b>
        <span className="block text-[11px] text-zinc-400 mt-0.5">{hhmm(p.at)}</span>
        <span className="block mt-1"><SeloSobra p={p} mostrarDinheiro={mostrarDinheiro} /></span>
      </div>
    </button>
  );
}

export function LinhaPedidoTabela({ p, onAbrir, mostrarDinheiro, nomeLoja, selecionado }: {
  p: PedidoArea; onAbrir: (id: string) => void; mostrarDinheiro: boolean; nomeLoja?: string; selecionado?: boolean;
}) {
  const s = situacaoDaArea(p);
  return (
    <tr onClick={() => onAbrir(p.id)} className={`cursor-pointer hover:bg-amber-50/40 ${selecionado ? 'bg-amber-50' : ''} ${p.cancelado ? 'opacity-60' : ''}`}>
      <td className="px-3 py-2.5 border-t border-zinc-100 whitespace-nowrap"><b className="text-sm">{p.numero ? `#${p.numero}` : '—'}</b><small className="block text-[11px] text-zinc-400">{hhmm(p.at)}</small></td>
      <td className="px-3 py-2.5 border-t border-zinc-100 max-w-[160px]"><span className="block font-bold text-[13px] truncate">{p.cliente ?? '—'}</span><small className={`block text-[11px] truncate ${p.pedidosAntes === 0 ? 'text-sky-700 font-bold' : 'text-zinc-400'}`}>{rotuloCliente(p.pedidosAntes) ?? nomeLoja ?? ''}</small></td>
      <td className="px-3 py-2.5 border-t border-zinc-100 text-[13px] text-zinc-600 max-w-0 w-full"><span className="block truncate" title={resumoItens(p)}>{resumoItens(p)}</span></td>
      <td className="px-3 py-2.5 border-t border-zinc-100 whitespace-nowrap"><span className={`text-[11px] font-extrabold rounded-md px-1.5 py-0.5 ${TOM[s.tom]}`}>{s.rotulo}</span>{(p.promoLoja > 0.005 || p.promoIfood > 0.005) && <span className="block mt-1"><SeloDesconto p={p} /></span>}</td>
      <td className="px-3 py-2.5 border-t border-zinc-100 text-right whitespace-nowrap"><b className={`text-[13.5px] ${p.cancelado ? 'line-through text-zinc-400' : ''}`}>{brl(p.order?.subTotal ?? p.venda)}</b></td>
      {mostrarDinheiro && <td className="px-3 py-2.5 border-t border-zinc-100 text-right whitespace-nowrap"><SeloSobra p={p} mostrarDinheiro /></td>}
    </tr>
  );
}

import { useNavigate } from 'react-router-dom';
import { rotuloCliente } from '@/lib/ifoodArea';
import { ehCancelado, numeroCurto, ondeQuem, situacaoPedido, entregaDoPedido } from '@/lib/pedidosRegras';
import { Etiqueta, brl, btn } from '@/components/kit';
import { Bloco, Casca, Linha, SeloSituacao, diaDoPedido, hhmm, rotuloDia, type PropsDetalhe } from './PagosJuntos';

// Detalhe de um pedido do iFood que só existe em ifood_orders (loja no modo "Só acompanhar"). Não tem
// cobrar, cancelar, nota nem via do cliente: o pedido é aceito e cobrado no iFood. Mostra o que dá para
// conferir aqui (itens, total, desconto dividido, cliente novo ou quantas vezes já pediu) e leva à área
// iFood para o resto (dinheiro, comida, sobra).

export default function DetalheIfood({ pedido, modo, aberto, onFechar, agoraMs, hoje }: PropsDetalhe) {
  const navigate = useNavigate();
  const ext = pedido.ifoodExterno;
  if (!ext) return null;

  const cancelado = ehCancelado(pedido);
  const sit = situacaoPedido(pedido, agoraMs, hoje);
  const ent = entregaDoPedido(pedido);
  const titulo = `#${numeroCurto(pedido)} · ${ondeQuem(pedido)}`;
  const subtitulo = [
    `${rotuloDia(diaDoPedido(pedido, hoje), hoje)} ${hhmm(pedido._criadoTs) ?? pedido.criadoEm}`,
    `iFood · ${ent.retirada ? 'Retirada' : 'Entrega'}`,
  ].join(' · ');
  const cliente = rotuloCliente(ext.pedidosAntes);
  const temDesconto = ext.promoLoja > 0.005 || ext.promoIfood > 0.005;

  const abrirNoIfood = () => {
    const q = new URLSearchParams({ aba: 'pedidos', pedido: ext.id });
    navigate(`/ifood?${q.toString()}`);
  };

  const rodape = (
    <button type="button" onClick={abrirNoIfood} className={`${btn('p')} flex-1 min-w-0`}>
      <i className="ri-store-2-line" />Abrir no iFood
    </button>
  );

  return (
    <Casca modo={modo} aberto={aberto} onFechar={onFechar} titulo={titulo} subtitulo={subtitulo} rodape={rodape} chave={pedido.id}>
      <div className="flex flex-wrap gap-1.5 mt-1">
        <SeloSituacao sit={sit} />
        <span className="inline-flex items-center gap-1 text-[10.5px] font-bold rounded-md px-1.5 py-0.5 bg-red-50 text-[#EA1D2C]">
          <i className="ri-store-2-line" />iFood
        </span>
        {ext.pedidosAntes === 0 && <Etiqueta tom="green">cliente novo</Etiqueta>}
      </div>

      {cancelado && (
        <div className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-3 mt-3">
          <p className="flex items-center gap-1.5 text-[13.5px] font-extrabold text-red-700">
            <i className="ri-close-circle-line text-base" />Cancelado
          </p>
          {pedido.cancelReason && <p className="text-[12.5px] text-red-800/80 mt-1 leading-relaxed">{pedido.cancelReason}</p>}
        </div>
      )}

      <Bloco titulo="Itens">
        {pedido.itensDetalhes.length === 0 && <p className="text-[12.5px] text-zinc-500">O iFood ainda não mandou os itens deste pedido.</p>}
        {pedido.itensDetalhes.map((item) => (
          <div key={item.id} className="flex gap-2.5 py-2.5 border-t border-zinc-200/70 first:border-t-0">
            <span className="w-6 h-6 rounded-lg bg-white border border-zinc-200 text-xs font-extrabold text-zinc-700 flex items-center justify-center flex-shrink-0 mt-0.5 tabular-nums">
              {item.quantidade}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-[13.5px] font-bold leading-snug text-zinc-900">{item.nome}</p>
              {item.opcoes.length > 0 && <p className="text-[11.5px] text-zinc-500 leading-snug mt-0.5 break-words">{item.opcoes.join(' · ')}</p>}
              {item.observacao && <p className="text-[11.5px] text-amber-700 italic font-semibold leading-snug mt-0.5 break-words">“{item.observacao}”</p>}
            </div>
            <b className="text-[13.5px] font-extrabold tabular-nums text-zinc-900 flex-shrink-0">{brl(item.preco * item.quantidade)}</b>
          </div>
        ))}
      </Bloco>

      <Bloco titulo="Valores">
        <Linha rotulo="Total dos itens" valor={brl(pedido.total)} forte />
        {temDesconto && (
          <>
            <Linha rotulo="Desconto pago pela loja" valor={ext.promoLoja > 0.005 ? `− ${brl(ext.promoLoja)}` : brl(0)} tom={ext.promoLoja > 0.005 ? 'red' : 'neutro'} />
            <Linha rotulo="Desconto pago pelo iFood" valor={ext.promoIfood > 0.005 ? brl(ext.promoIfood) : brl(0)} />
          </>
        )}
        <p className="text-[11.5px] text-zinc-400 mt-2 leading-snug">
          Pago no app ou cobrado pelo entregador. O que chega na loja o iFood fecha no dia seguinte: veja em iFood.
        </p>
      </Bloco>

      <Bloco titulo="Cliente">
        {pedido.nomeCliente && <Linha rotulo="Nome" valor={ent.nome ?? pedido.nomeCliente} />}
        <Linha rotulo="No iFood" valor={cliente ?? 'sem informação'} tom={ext.pedidosAntes === 0 ? 'verde' : 'neutro'} />
        {ent.retirada && <Linha rotulo="Entrega" valor="Retirada no balcão" />}
      </Bloco>
    </Casca>
  );
}

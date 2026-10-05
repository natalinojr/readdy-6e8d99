import { Faixa, brl, brlInteiro, type ItemFaixa } from '@/pages/estoque/components/ui/EstoqueUi';
import { META_PEDIDO_MIN, type FiltroChip, type ResumoPedidos } from '@/lib/pedidosRegras';

// Frase do dia + faixa de números da tela de Pedidos (protótipo docs/prototipos/pedidos-proposta.html).
// Os números vêm prontos de resumoPedidos() (src/lib/pedidosRegras.ts): aqui só se mostra.

/** R$ 742,30; de 10 mil para cima sem centavos, para caber no cartão da faixa. */
const dinheiro = (v: number) => (v >= 10000 ? brlInteiro(v) : brl(v));

export default function PedidosResumo({ titulo, resumo, nPendencias, onChip, carregando = false }: {
  /** "Hoje", "Ontem", "Turno de hoje", "03/10/2026"… */
  titulo: string;
  resumo: ResumoPedidos;
  nPendencias: number;
  onChip: (c: FiltroChip) => void;
  /** Pedidos do filtro novo ainda chegando: não diz "nenhum pedido" com a lista do filtro anterior. */
  carregando?: boolean;
}) {
  const manchete = carregando
    ? `${titulo}: carregando…`
    : resumo.pedidos === 0
    ? `${titulo}: nenhum pedido`
    : `${titulo}: ${resumo.pedidos} ${resumo.pedidos === 1 ? 'pedido' : 'pedidos'}, ${brl(resumo.vendido)}`;
  const doIfood = resumo.doIfood;
  // Pedido do iFood que só a área iFood guardava (modo "Só acompanhar") entra nos números: avisa quanto é.
  const avisoIfood = doIfood.pedidos > 0 ? ` Inclui ${doIfood.pedidos} do iFood (${brl(doIfood.valor)}).` : '';
  const subtitulo = carregando
    ? 'Buscando os pedidos do período.'
    : (nPendencias > 0
    ? `${nPendencias} ${nPendencias === 1 ? 'coisa precisa' : 'coisas precisam'} de você. O resto está certo.`
    : 'Nada para resolver agora.') + avisoIfood;

  const itens: ItemFaixa[] = [
    { valor: resumo.pedidos, rotulo: 'Pedidos' },
    {
      valor: dinheiro(resumo.vendido), rotulo: 'Vendido', tom: 'green',
      ajuda: 'Soma dos pedidos não cancelados, inclusive os que ainda não foram pagos. O Dashboard mostra só o recebido.',
    },
  ];
  if (resumo.naoPagos > 0) {
    itens.push({
      valor: dinheiro(resumo.naoPagoValor), rotulo: `Não pago · ${resumo.naoPagos}`, tom: 'amber',
      onClick: () => onChip('naopago'),
    });
  }
  itens.push({
    valor: dinheiro(resumo.ticket), rotulo: 'Ticket médio',
    ajuda: 'Vendido dividido pelos pedidos com valor. Cortesia (R$ 0,00) fica fora da conta.',
  });
  const tempo = resumo.tempoMedio;
  itens.push({
    valor: tempo != null ? `${tempo} min` : '—',
    rotulo: 'Tempo médio',
    tom: tempo != null && tempo > META_PEDIDO_MIN ? 'red' : 'neutro',
    ajuda: `Minutos do pedido ao entregar, em média, só dos pedidos entregues com tempo registrado. A meta é ${META_PEDIDO_MIN} min.`,
  });
  itens.push({
    valor: resumo.cancelados,
    rotulo: resumo.cancelados > 0
      ? `Cancelados · ${brl(resumo.canceladoValor, Number.isInteger(resumo.canceladoValor) ? 0 : 2)}`
      : 'Cancelados',
    tom: resumo.cancelados > 0 ? 'red' : 'neutro',
    onClick: resumo.cancelados > 0 ? () => onChip('cancelados') : undefined,
  });

  return (
    <div>
      <h2 className="text-[23px] lg:text-[28px] leading-[1.15] font-extrabold tracking-tight text-zinc-900">{manchete}</h2>
      <p className="text-[12.5px] lg:text-[13.5px] text-zinc-500 mt-1 leading-snug">{subtitulo}</p>
      <Faixa itens={itens} className={`mt-3 transition-opacity ${carregando ? "opacity-40" : ""}`} />
    </div>
  );
}

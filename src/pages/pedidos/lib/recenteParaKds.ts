import type { PedidoRecente } from '@/types/pdv';
import type { KDSPedido, KDSItem, KDSItemOpcao } from '@/types/kds';
import { itensAtivos } from './textoPedido';

/**
 * Pedido da tela Pedidos → pedido do KDS, só com o que a reimpressão da comanda usa
 * (reprintPedidoGestor). Fallback para pedido que não está mais no KDS (de outro dia) e cuja
 * sessão não deu para buscar: sem partes de produção nem "opção obrigatória" (vem tudo como "+ opção").
 * Item que nunca passou pela cozinha (semCozinha) vai como skip_kds, igual ao Gestor.
 */
export function recenteParaKds(p: PedidoRecente): KDSPedido {
  const criado = p._criadoTs ? new Date(p._criadoTs).getTime() : NaN;
  const criadoEm = Number.isNaN(criado) ? Date.now() : criado;
  const entrega = p.origem === 'delivery';

  const itens: KDSItem[] = itensAtivos(p).map((i) => {
    const opcoes: KDSItemOpcao[] = i.opcoesDetalhadas && i.opcoesDetalhadas.length > 0
      ? i.opcoesDetalhadas.map((o) => ({ grupoNome: '', opcaoNome: o.nome, additional_price: o.preco }))
      : (i.opcoes ?? []).filter(Boolean).map((nome) => ({ grupoNome: '', opcaoNome: nome }));
    return {
      id: i.id,
      menuItemId: i.menuItemId,
      nome: i.nome,
      categoriaNome: i.categoriaNome,
      quantidade: i.quantidade,
      estacao: i.estacao,
      slaMinutos: 15,
      status: 'novo',
      skip_kds: i.unidades?.[0]?.semCozinha === true ? true : undefined,
      opcoes,
      observacoes: i.observacao ? [i.observacao] : [],
      entroKdsEm: criadoEm,
      item_price: i.preco,
    };
  });

  return {
    id: p.id,
    numero: p.numero,
    numeroStr: p.numeroStr ?? p.numeroCodigo,
    customerPhone: p.telefone ?? undefined,
    status: 'novo',
    destino: entrega ? 'delivery' : p.destino === 'na_hora' ? 'hora' : p.destino,
    mesaNumero: p.mesaNumero,
    nomeCliente: p.nomeCliente,
    senha: p.senha,
    itens,
    criadoEm,
    origem: p.origem,
    garcomNome: p.garcomNome,
    totalAmount: p.total,
    isPaid: !!p.pago,
    isCancelled: false,
    paymentMethodName: p.formaAPagar,
    participantToken: p.participantToken,
    participantName: p.participantName,
    deliveryAddress: p.endereco ?? undefined,
    deliveryFee: p.deliveryFee ?? undefined,
    deliveryPlatform: p.deliveryPlatform ?? undefined,
  };
}

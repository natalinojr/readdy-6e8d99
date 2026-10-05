import type { PedidoItemDetalhe, PedidoRecente, PedidoStatus } from '@/types/pdv';
import type { PedidoOrder } from '@/lib/ifoodArea';

// Pedido do iFood que só existe em ifood_orders (loja no modo "Só acompanhar") visto como PedidoRecente
// "externo" na tela Pedidos. Funções puras (testadas em src/test/pages/ifoodExterno.test.ts).

const TZ = 'America/Sao_Paulo';
/** Pedido do iFood "andando" há mais que isso já terminou (o evento final não chegou): não fica na cozinha para sempre. */
export const ANDANDO_MAX_HORAS = 12;

/** Status do iFood → status do Pedidos. Entregue/concluído e despachado contam como entregues. */
export function statusDoIfood(situacao: string, criadoMs: number, agoraMs: number): PedidoStatus {
  const velho = agoraMs - criadoMs >= ANDANDO_MAX_HORAS * 3_600_000;
  switch (situacao) {
    case 'cancelled': return 'cancelled';
    case 'placed': case 'cancel_requested': return velho ? 'delivered' : 'new';
    case 'confirmed': case 'preparing': return velho ? 'delivered' : 'preparing';
    case 'ready': return velho ? 'delivered' : 'ready';
    default: return 'delivered'; // dispatched, concluded e o que o iFood inventar depois
  }
}

/** Janela (ISO) dos pedidos do iFood que a tela Pedidos mostra: o turno (opened_at → closed_at/agora) ou os dias escolhidos. */
export function janelaIfoodPedidos(opts: {
  dateFrom?: string | null;
  dateTo?: string | null;
  hoje: string;
  /** Modo turno: início/fim da sessão (closed_at null = aberta, vai até agora). */
  sessao?: { opened_at: string; closed_at: string | null } | null;
  /** Modo turno sem sessão carregada: cai no dia de hoje. */
  modoSessao?: boolean;
  agoraMs?: number;
}): { from: string; to: string } | null {
  const { dateFrom, dateTo, hoje, sessao, modoSessao } = opts;
  if (modoSessao) {
    // Turno aberto: fim fixo (abertura + 36 h) — "agora" mudaria a janela a cada minuto e a lista piscava.
    if (sessao?.opened_at) return { from: sessao.opened_at, to: sessao.closed_at ?? new Date(Date.parse(sessao.opened_at) + 36 * 3600_000).toISOString() };
    return { from: `${hoje}T00:00:00-03:00`, to: `${hoje}T23:59:59.999-03:00` };
  }
  if (!dateFrom) return null;
  return { from: `${dateFrom}T00:00:00-03:00`, to: `${dateTo ?? hoje}T23:59:59.999-03:00` };
}

const primeiroNome = (n: string | null) => (n ? n.trim().split(/\s+/)[0] : '');

/** Converte um pedido de ifood_orders (sem `orders` no ERPOS) no formato da lista de Pedidos. */
export function ifoodParaRecente(o: PedidoOrder, agoraMs: number): PedidoRecente {
  const criado = o.at;
  const hhmm = criado.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: TZ });
  const status = statusDoIfood(o.status, criado.getTime(), agoraMs);
  const nome = primeiroNome(o.cliente);
  const retirada = o.tipo === 'TAKEOUT';
  const itens: PedidoItemDetalhe[] = o.itens.map((it, i) => ({
    id: `${o.id}-${i}`,
    nome: it.nome,
    quantidade: it.qtd,
    preco: it.qtd > 0 ? it.total / it.qtd : it.total,
    estacao: '',
    opcoes: it.complementos.map((c) => (c.qtd > 1 ? `${c.qtd}× ${c.nome}` : c.nome)),
    opcoesDetalhadas: it.complementos.map((c) => ({ nome: c.qtd > 1 ? `${c.qtd}× ${c.nome}` : c.nome, preco: c.preco * c.qtd })),
    observacao: it.obs ?? undefined,
    unidades: [],
  }));
  const numero = o.numero ?? '';
  return {
    id: `ifood:${o.id}`,
    numero: Number(numero) || 0,
    numeroCodigo: `iFood #${numero}`.trim(),
    destino: 'delivery',
    origem: 'delivery',
    deliveryPlatform: 'ifood',
    // "Nome - Retirada" é como o Delivery do ERPOS guarda retirada (entregaDoPedido separa)
    nomeCliente: nome ? (retirada ? `${nome} - Retirada` : nome) : undefined,
    status,
    // Pago no app, ou cobrado pelo entregador: nunca é conta aberta da loja.
    pago: true,
    total: o.subTotal,
    criadoEm: hhmm,
    dataPedido: criado.toLocaleDateString('en-CA', { timeZone: TZ }),
    minutosAtras: Math.max(0, Math.floor((agoraMs - criado.getTime()) / 60000)),
    itensProntos: 0,
    itensTotal: itens.length,
    itensDetalhes: itens,
    cancelReason: o.motivoCancelamento ?? undefined,
    _criadoTs: criado.toISOString(),
    ifoodExterno: {
      id: o.id,
      numero: o.numero,
      promoLoja: o.promoLoja,
      promoIfood: o.promoIfood,
      pedidosAntes: o.pedidosAntes,
      situacao: o.status,
    },
  };
}

/** Só os pedidos que NÃO viraram `orders` (os que viraram já aparecem na lista) e que não são de teste. */
export function ifoodSoAcompanhando(orders: PedidoOrder[]): PedidoOrder[] {
  // Pedido de teste fica fora, a não ser que a loja só tenha pedido de teste (a loja de testes).
  const soTeste = orders.length > 0 && orders.every((o) => o.teste);
  return orders.filter((o) => !o.pedidoErpos && (soTeste || !o.teste));
}

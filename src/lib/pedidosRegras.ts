import type { PedidoRecente } from '@/types/pdv';

// Regras da tela de Pedidos (layout novo aprovado em 2026-10-04, protótipo
// docs/prototipos/pedidos-proposta.html). Tudo puro: a tela, os cartões de "Precisa de
// você", os filtros e a busca usam estas funções — um número só para cada coisa.

/** Meta de tempo do pedido (criado → entregue), em minutos. */
export const META_PEDIDO_MIN = 15;
/** Pedido andando há mais que isso não está "atrasado": foi esquecido sem baixa. */
export const PARADO_HORAS = 12;
/** Pedido entregue e não pago só vira pendência depois desse tempo (a conta pode estar sendo fechada). */
export const NAO_PAGO_TOLERANCIA_MIN = 30;

const TZ = 'America/Sao_Paulo';

export function ehCancelado(p: Pick<PedidoRecente, 'status'>): boolean {
  return p.status === 'cancelled' || p.status === 'cancelado';
}
export function ehEntregue(p: Pick<PedidoRecente, 'status'>): boolean {
  return p.status === 'delivered' || p.status === 'entregue';
}
/** Ainda andando: na fila, em preparo ou pronto esperando entrega. */
export function ehAtivo(p: Pick<PedidoRecente, 'status'>): boolean {
  return ['new', 'preparing', 'ready', 'novo', 'preparo', 'aberto', 'pronto'].includes(p.status as string);
}
function ehPronto(p: Pick<PedidoRecente, 'status'>): boolean {
  return p.status === 'ready' || p.status === 'pronto';
}

const ms = (iso?: string | null): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};
const minEntre = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b >= a ? Math.round((b - a) / 60000) : null;

/** Dia (AAAA-MM-DD) de Brasília de um instante. */
export function diaBR(iso: string): string {
  return new Date(iso).toLocaleDateString('en-CA', { timeZone: TZ });
}
const ddmm = (dia: string) => `${dia.slice(8, 10)}/${dia.slice(5, 7)}`;

// ── Número curto ──────────────────────────────────────────────────────────────
/** "P0410260048" → "048" (a sequência do dia, sem o prefixo e a data). Fora do padrão, devolve o código. */
export function numeroCurto(p: Pick<PedidoRecente, 'numeroCodigo' | 'numeroStr' | 'numero'>): string {
  const cod = (p.numeroStr ?? p.numeroCodigo ?? '').trim();
  const m = cod.match(/^[A-Za-z]{0,2}\d{6}(\d+)$/);
  if (m) return String(Number(m[1])).padStart(3, '0');
  if (cod) return cod;
  return String(p.numero ?? 0).padStart(3, '0');
}

// ── Situação (um selo só por pedido) ──────────────────────────────────────────
export type TipoSituacao = 'cozinha' | 'pronto' | 'saiu' | 'entregue' | 'cancelado' | 'parado';
export interface Situacao {
  tipo: TipoSituacao;
  /** Texto do selo: "Na cozinha · 32 min", "Pronto · esperando 6 min", "Parado desde 03/10"… */
  rotulo: string;
  /** Minutos que importam: correndo (andando) ou o total gravado (entregue). */
  minutos: number | null;
  /** Passou da meta (andando: desde a criação; entregue: tempo total). */
  atrasado: boolean;
}

export function situacaoPedido(p: PedidoRecente, agoraMs: number, hoje: string): Situacao {
  if (ehCancelado(p)) return { tipo: 'cancelado', rotulo: 'Cancelado', minutos: null, atrasado: false };
  const criado = ms(p._criadoTs);

  if (ehAtivo(p)) {
    const desdeCriado = criado != null ? Math.max(0, Math.floor((agoraMs - criado) / 60000)) : (p.minutosAtras ?? 0);
    const dia = p._criadoTs ? diaBR(p._criadoTs) : (p.dataPedido ?? hoje);
    if (desdeCriado >= PARADO_HORAS * 60) {
      const rotulo = dia < hoje ? `Parado desde ${ddmm(dia)}` : `Parado há ${Math.floor(desdeCriado / 60)} h`;
      return { tipo: 'parado', rotulo, minutos: desdeCriado, atrasado: true };
    }
    const atrasado = desdeCriado > META_PEDIDO_MIN;
    if (ehPronto(p)) {
      const saiu = ms(p.saiuEntregaTs);
      if (saiu != null) {
        const m = Math.max(0, Math.floor((agoraMs - saiu) / 60000));
        return { tipo: 'saiu', rotulo: `Saiu para entrega · ${m} min`, minutos: m, atrasado };
      }
      const pronto = ms(p._ficouProntoTs);
      const m = pronto != null ? Math.max(0, Math.floor((agoraMs - pronto) / 60000)) : null;
      return { tipo: 'pronto', rotulo: m != null ? `Pronto · esperando ${m} min` : 'Pronto', minutos: m, atrasado };
    }
    return { tipo: 'cozinha', rotulo: `Na cozinha · ${desdeCriado} min`, minutos: desdeCriado, atrasado };
  }

  // Entregue (ou qualquer status final que não seja cancelado)
  const total = p.tempoAberto ?? null;
  return { tipo: 'entregue', rotulo: 'Entregue', minutos: total, atrasado: total != null && total > META_PEDIDO_MIN };
}

// ── Tempo de cada fase (passos do pedido) ─────────────────────────────────────
export type Fase = 'fila' | 'cozinha' | 'entrega';
export interface TempoFases {
  criadoTs: string | null;
  cozinhaTs: string | null;
  prontoTs: string | null;
  entregueTs: string | null;
  /** Minutos em cada fase já terminada (null = não aconteceu / sem registro). */
  fila: number | null;
  cozinha: number | null;
  entrega: number | null;
  /** Criado → entregue (ou o tempo gravado). */
  total: number | null;
  /** Fase que está acontecendo agora (só pedido andando) e há quanto tempo. */
  correndo: Fase | null;
  correndoMin: number | null;
}

/**
 * Horários e minutos de cada fase a partir das unidades (cozinha = 1ª unidade que começou →
 * última que ficou pronta). Unidade sem cozinha (bebida) não conta para fila/cozinha.
 */
export function tempoFases(p: PedidoRecente, agoraMs: number): TempoFases {
  const unidades = p.itensDetalhes.filter((i) => !i.cancelado).flatMap((i) => i.unidades ?? []);
  const comCozinha = unidades.filter((u) => !u.semCozinha);
  const criado = ms(p._criadoTs ?? unidades[0]?._criadoTs ?? null);

  const inicios = comCozinha.map((u) => ms(u._iniciadoPreparoTs)).filter((t): t is number => t != null);
  const cozinha = inicios.length ? Math.min(...inicios) : ms(p._iniciouPreparoTs);

  const todasProntas = comCozinha.length > 0 && comCozinha.every((u) => u.status === 'pronto' || u.status === 'entregue');
  const prontos = comCozinha.map((u) => ms(u._prontoTs)).filter((t): t is number => t != null);
  const pronto = todasProntas && prontos.length ? Math.max(...prontos) : null;

  const entregues = unidades.map((u) => ms(u._entregueTs));
  const todasEntregues = unidades.length > 0 && entregues.every((t) => t != null);
  const entregue = ms(p._entregueTs) ?? (todasEntregues ? Math.max(...(entregues as number[])) : null);

  const fila = minEntre(criado, cozinha);
  const tempoCozinha = minEntre(cozinha, pronto);
  const entrega = minEntre(pronto, entregue);
  const total = minEntre(criado, entregue) ?? (ehEntregue(p) ? (p.tempoAberto ?? null) : null);

  let correndo: Fase | null = null;
  let correndoMin: number | null = null;
  if (ehAtivo(p) && !ehCancelado(p)) {
    const desde = (t: number | null) => (t != null ? Math.max(0, Math.floor((agoraMs - t) / 60000)) : null);
    if (comCozinha.length > 0 && cozinha == null) { correndo = 'fila'; correndoMin = desde(criado); }
    else if (comCozinha.length > 0 && pronto == null) { correndo = 'cozinha'; correndoMin = desde(cozinha); }
    else if (entregue == null) { correndo = 'entrega'; correndoMin = desde(pronto ?? criado); }
  }
  const iso = (t: number | null) => (t != null ? new Date(t).toISOString() : null);
  return {
    criadoTs: iso(criado), cozinhaTs: iso(cozinha), prontoTs: iso(pronto), entregueTs: iso(entregue),
    fila, cozinha: tempoCozinha, entrega, total, correndo, correndoMin,
  };
}

// ── Onde / quem e canal ───────────────────────────────────────────────────────
export type Canal = 'tablet' | 'totem' | 'caixa' | 'garcom' | 'qr' | 'delivery';
export function canalPedido(p: PedidoRecente): Canal {
  if (p.origem === 'delivery') return 'delivery';
  if (p.origem === 'garcom') return 'garcom';
  if (p.origem === 'caixa') return 'caixa';
  if (p.origem === 'mesa') return p.mesaNumero ? 'garcom' : 'qr';
  if (p.origem === 'autoatendimento') {
    if (p.participantToken && !p.mesaNumero) return 'qr';
    return /^P-\d+/i.test(p.senha ?? '') ? 'tablet' : 'totem';
  }
  return 'caixa';
}
export const ROTULO_CANAL: Record<Canal, string> = {
  tablet: 'Tablet', totem: 'Totem', caixa: 'Caixa', garcom: 'Garçom', qr: 'QR do celular', delivery: 'Delivery',
};
export const ICONE_CANAL: Record<Canal, string> = {
  tablet: 'ri-tablet-line', totem: 'ri-computer-line', caixa: 'ri-store-2-line', garcom: 'ri-user-star-line',
  qr: 'ri-qr-code-line', delivery: 'ri-e-bike-2-line',
};

/**
 * Delivery guarda "Nome - endereço" ou "Nome - Retirada" no mesmo campo (destination_name).
 * Separa: nome do cliente, se é retirada e o endereço (orders.delivery_address, ou o resto do nome).
 */
export function entregaDoPedido(p: Pick<PedidoRecente, 'nomeCliente' | 'endereco' | 'deliveryPlatform'>): { nome: string | null; retirada: boolean; endereco: string | null } {
  const bruto = (p.nomeCliente ?? '').trim();
  const i = bruto.indexOf(' - ');
  const nome = (i >= 0 ? bruto.slice(0, i) : bruto).trim() || null;
  const resto = i >= 0 ? bruto.slice(i + 3).trim() : '';
  const retirada = /^retirada$/i.test(resto) || p.deliveryPlatform === 'retirada';
  const endereco = retirada ? null : (p.endereco?.trim() || resto || null);
  return { nome, retirada, endereco };
}

const semPrefixoMesa = (nome?: string | null) => (nome ?? '').replace(/^Mesa\s*\d*\s*[-–.·]?\s*/i, '').trim();

/** Linha principal "onde/quem": "Mesa 12", "Tablet P-14", "Senha 301 · Ana", "João Silva", "Balcão · Ana". */
export function ondeQuem(p: PedidoRecente): string {
  const canal = canalPedido(p);
  if (canal === 'qr') {
    const nome = p.participantName || semPrefixoMesa(p.nomeCliente);
    const senha = p.participantToken ?? p.senha;
    return senha ? `Senha ${senha}${nome ? ` · ${nome}` : ''}` : (nome || 'QR do celular');
  }
  if (p.destino === 'mesa' && p.mesaNumero) return `Mesa ${p.mesaNumero}`;
  if (canal === 'tablet') return `Tablet ${p.senha}`;
  if (p.destino === 'senha') return `Senha ${p.senha ?? ''}`.trim();
  if (canal === 'delivery') return entregaDoPedido(p).nome || 'Delivery';
  if (p.destino === 'nome' && p.nomeCliente) return canal === 'caixa' ? `Balcão · ${p.nomeCliente}` : p.nomeCliente;
  return 'Balcão';
}

// ── Pagamento / nota ─────────────────────────────────────────────────────────
/** Pedido com valor a receber que ainda não foi pago (total 0 = cortesia, não conta). */
export function ehNaoPago(p: PedidoRecente): boolean {
  return !ehCancelado(p) && !p.pago && p.total > 0.005;
}

export type StatusNota = 'authorized' | 'processing' | 'pending' | 'rejected' | 'error' | 'cancelled' | string;
/** Nota viva = autorizada ou em emissão. Sem nota viva, pedido pago fica "sem nota". */
export function notaViva(status?: StatusNota | null): boolean {
  return status === 'authorized' || status === 'processing' || status === 'pending';
}
/** Canal da NFC-e, igual ao fiscal-write: delivery, mesa (sessão de mesa/garçom/mesa) ou balcão. */
export function canalFiscal(p: Pick<PedidoRecente, 'origem' | 'table_session_id'>): 'delivery' | 'mesa' | 'balcao' {
  if (p.origem === 'delivery') return 'delivery';
  if (p.table_session_id || p.origem === 'mesa' || p.origem === 'garcom') return 'mesa';
  return 'balcao';
}

/** Pago, com valor, sem nota viva — só na loja que emite NFC-e (e no canal com emissão ligada). */
export function ehSemNota(
  p: PedidoRecente, fiscalAtivo: boolean, statusNota: (orderId: string) => StatusNota | undefined,
  emiteNota?: (p: PedidoRecente) => boolean,
): boolean {
  if (!fiscalAtivo || ehCancelado(p) || !p.pago || p.total <= 0.005) return false;
  if (emiteNota && !emiteNota(p)) return false;
  const ids = p.pedidoIds?.length ? p.pedidoIds : [p.id];
  return ids.some((id) => !notaViva(statusNota(id)));
}

// ── Filtros (chips) ──────────────────────────────────────────────────────────
export type FiltroChip = 'todos' | 'cozinha' | 'naopago' | 'semnota' | 'cancelados';
export interface ContextoFiltro {
  agoraMs: number;
  hoje: string;
  fiscalAtivo: boolean;
  statusNota: (orderId: string) => StatusNota | undefined;
  /** Canal com emissão ligada na loja (fiscal_settings.emit_on_*). Sem isto, todo canal emite. */
  emiteNota?: (p: PedidoRecente) => boolean;
}
export function passaNoChip(p: PedidoRecente, chip: FiltroChip, ctx: ContextoFiltro): boolean {
  switch (chip) {
    case 'todos': return true;
    case 'cozinha': return ehAtivo(p) && !ehCancelado(p);
    case 'naopago': return ehNaoPago(p);
    case 'semnota': return ehSemNota(p, ctx.fiscalAtivo, ctx.statusNota, ctx.emiteNota);
    case 'cancelados': return ehCancelado(p);
    default: return true;
  }
}

/**
 * Filtra mantendo os pedidos pagos juntos inteiros: o grupo aparece se QUALQUER pedido dele
 * passa (antes o agrupamento vinha depois do filtro e a busca deixava só parte do grupo,
 * com total pela metade).
 */
export function filtrarComGrupos(itens: PedidoRecente[], passa: (p: PedidoRecente) => boolean): PedidoRecente[] {
  return itens.filter((it) => (it.pedidosOriginais?.length ? it.pedidosOriginais.some(passa) : passa(it)));
}

// ── Busca ────────────────────────────────────────────────────────────────────
export const semAcento = (t: string) => t.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/** "42", "42,5", "R$ 42,00", "42.50" → 42 / 42.5 (null se não for valor). */
export function valorDaBusca(termo: string): number | null {
  let t = termo.replace(/r\$\s*/i, '').trim();
  // "1.234,50" → "1234,50" (ponto de milhar)
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d{1,6}([.,]\d{1,2})?$/.test(t)) return null;
  return Number(t.replace(',', '.'));
}

/** Acha por número (inteiro ou final), valor, cliente, mesa, senha/tablet, telefone, item, garçom — sem acento. */
export function buscaPedido(p: PedidoRecente, termo: string): boolean {
  const q = semAcento(termo).replace(/^#/, '');
  if (!q) return true;
  const valor = valorDaBusca(q);
  if (valor != null && Math.abs(p.total - valor) < 0.005) return true;
  const digitos = q.replace(/\D/g, '');
  const ehNumero = /^\d+$/.test(q);
  if (ehNumero) {
    const curto = numeroCurto(p);
    if (curto.replace(/^0+/, '') === q.replace(/^0+/, '') || curto === q) return true;
    const cod = (p.numeroStr ?? p.numeroCodigo ?? '').toLowerCase();
    if (q.length >= 3 && cod.endsWith(q)) return true;
    if (p.mesaNumero != null && String(p.mesaNumero) === q) return true;
    if (digitos.length >= 4 && (p.telefone ?? '').replace(/\D/g, '').includes(digitos)) return true;
  }
  // Número puro não procura dentro do código nem do telefone: "41" achava todo pedido de 04/10
  // (P041026…) e todo telefone com DDD 41.
  const campos = [
    ...(ehNumero ? [] : [p.numeroCodigo, p.numeroStr, p.telefone]), p.nomeCliente, p.participantName, p.garcomNome, p.senha, p.participantToken,
    p.mesaNumero != null ? `mesa ${p.mesaNumero}` : null, p.endereco, p.deliveryPlatform,
    ondeQuem(p), ROTULO_CANAL[canalPedido(p)],
    ...p.itensDetalhes.map((i) => i.nome),
    ...(p.pagamentos ?? []).map((pg) => pg.payment_method_name),
  ];
  return campos.some((c) => c != null && semAcento(String(c)).includes(q));
}

// ── Resumo do período (frase de cima + faixa) ────────────────────────────────
export interface ResumoPedidos {
  /** Pedidos não cancelados. */
  pedidos: number;
  /** Soma dos não cancelados (inclui não pagos). O fechamento do caixa também tira o repasse do iFood. */
  vendido: number;
  /** Soma dos pagos — igual ao "Faturamento" do Dashboard. */
  recebido: number;
  naoPagos: number;
  naoPagoValor: number;
  /** vendido ÷ pedidos com valor (cortesia R$ 0 fica fora, como no Dashboard). */
  ticket: number;
  cancelados: number;
  canceladoValor: number;
  /** Média do tempo total (criado → entregue) dos entregues com tempo gravado. */
  tempoMedio: number | null;
  /** Entregues que passaram da meta. */
  atrasados: number;
}

/** Recebe os pedidos INDIVIDUAIS (sem agrupar): grupo pago junto conta cada pedido uma vez. */
export function resumoPedidos(pedidos: PedidoRecente[]): ResumoPedidos {
  const validos = pedidos.filter((p) => !ehCancelado(p));
  const cancel = pedidos.filter(ehCancelado);
  const comValor = validos.filter((p) => p.total > 0.005);
  const vendido = validos.reduce((a, p) => a + p.total, 0);
  const recebido = validos.filter((p) => p.pago).reduce((a, p) => a + p.total, 0);
  const naoPagos = validos.filter(ehNaoPago);
  const tempos = validos.filter((p) => ehEntregue(p) && p.tempoAberto != null).map((p) => p.tempoAberto as number);
  return {
    pedidos: validos.length,
    vendido,
    recebido,
    naoPagos: naoPagos.length,
    naoPagoValor: naoPagos.reduce((a, p) => a + p.total, 0),
    ticket: comValor.length ? vendido / comValor.length : 0,
    cancelados: cancel.length,
    canceladoValor: cancel.reduce((a, p) => a + p.total, 0),
    tempoMedio: tempos.length ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length) : null,
    atrasados: tempos.filter((t) => t > META_PEDIDO_MIN).length,
  };
}

// ── Precisa de você ──────────────────────────────────────────────────────────
export interface PendenciasPedidos {
  /** Não pagos que já saíram da cozinha há mais de 30 min, ou de outro dia. */
  naoPagos: PedidoRecente[];
  /** Pagos sem nota viva (loja com NFC-e); inclui nota recusada/erro. */
  semNota: PedidoRecente[];
  /** Andando hoje e passou da meta (não inclui os parados). */
  atrasados: PedidoRecente[];
  /** Andando há 12 h ou mais — esquecidos sem baixa. */
  parados: PedidoRecente[];
}

/** Recebe os pedidos INDIVIDUAIS. A lista de cada tipo vem do mais antigo para o mais novo. */
export function pendenciasPedidos(pedidos: PedidoRecente[], ctx: ContextoFiltro): PendenciasPedidos {
  const porIdade = (a: PedidoRecente, b: PedidoRecente) => (ms(a._criadoTs) ?? 0) - (ms(b._criadoTs) ?? 0);
  const naoPagos = pedidos.filter((p) => {
    if (!ehNaoPago(p)) return false;
    const dia = p._criadoTs ? diaBR(p._criadoTs) : (p.dataPedido ?? ctx.hoje);
    if (dia < ctx.hoje) return true;
    if (!ehEntregue(p)) return false;
    const entregue = ms(p._entregueTs) ?? ms(p._criadoTs);
    return entregue != null && ctx.agoraMs - entregue >= NAO_PAGO_TOLERANCIA_MIN * 60000;
  });
  const semNota = pedidos.filter((p) => ehSemNota(p, ctx.fiscalAtivo, ctx.statusNota, ctx.emiteNota));
  const situacoes = pedidos.map((p) => [p, situacaoPedido(p, ctx.agoraMs, ctx.hoje)] as const);
  const parados = situacoes.filter(([, s]) => s.tipo === 'parado').map(([p]) => p);
  const atrasados = situacoes
    .filter(([, s]) => (s.tipo === 'cozinha' || s.tipo === 'pronto') && s.atrasado)
    .map(([p]) => p);
  return {
    naoPagos: naoPagos.sort(porIdade),
    semNota: semNota.sort(porIdade),
    atrasados: atrasados.sort(porIdade),
    parados: parados.sort(porIdade),
  };
}

import { precosEfetivos } from '@/lib/precoItemPedido';
import type { PedidoRecente, OrigemPedido } from '@/types/pdv';
import type { KDSPedido } from '@/types/kds';
import type { DBOrder } from '@/hooks/useOrdersHistory';
import { isQRUniversal, clienteNome } from '../components/utils';

// Conversores da tela de Pedidos (saíram do page.tsx): banco/KDS → PedidoRecente e o
// agrupamento dos pedidos pagos juntos.

// ── Conversor KDS → PedidoRecente ─────────────────────────────────────────────

export function kdsParaRecente(p: KDSPedido): PedidoRecente {
  const now = Date.now();
  const minutosAtras = Math.floor((now - p.criadoEm) / 60000);
  const dtKds = new Date(p.criadoEm);
  const criadoHora = dtKds.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const datePedido = dtKds.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

  const kdsStatusMap: Record<string, PedidoRecente['status']> = {
    novo: 'new', preparo: 'preparing', pronto: 'ready', entregue: 'delivered',
  };
  const origemMap: Record<string, OrigemPedido> = {
    caixa: 'caixa', garcom: 'garcom', mesa: 'mesa', mesa_qr: 'mesa',
    autoatendimento: 'autoatendimento', delivery: 'delivery',
  };

  const itensProntos = p.itens.filter((i) => i.status === 'pronto' || i.status === 'entregue').length;
  const temposPreparo = p.itens
    .filter((i) => i.iniciouPreparoEm && i.ficouProntoEm)
    .map((i) => ((i.ficouProntoEm! - i.iniciouPreparoEm!) / 60000));
  const slaCozinha = temposPreparo.length > 0
    ? Math.round(temposPreparo.reduce((a, b) => a + b, 0) / temposPreparo.length)
    : undefined;
  const slaEsperaMin = p.itens
    .filter((i) => i.iniciouPreparoEm && i.entroKdsEm)
    .map((i) => ((i.iniciouPreparoEm! - i.entroKdsEm!) / 60000));
  const slaEspera = slaEsperaMin.length > 0
    ? Math.round(slaEsperaMin.reduce((a, b) => a + b, 0) / slaEsperaMin.length)
    : undefined;

  const numStr = p.numeroStr ?? String(p.numero);

  // Timestamps para SLA em tempo real
  const primeiroIniciouPreparo = p.itens
    .map((i) => i.iniciouPreparoEm)
    .filter((t): t is number => !!t)
    .sort((a, b) => a - b)[0];
  const primeiroFicouPronto = p.itens
    .map((i) => i.ficouProntoEm)
    .filter((t): t is number => !!t)
    .sort((a, b) => a - b)[0];

  return {
    id: p.id,
    numero: p.numero,
    numeroCodigo: numStr,
    destino: p.destino === 'delivery' ? 'nome' : p.destino,
    mesaNumero: p.mesaNumero,
    nomeCliente: p.nomeCliente ?? (p.destino === 'delivery' ? 'Delivery' : undefined),
    senha: p.senha,
    participantToken: p.participantToken,
    participantName: p.participantName,
    status: p.isCancelled ? 'cancelled' : (kdsStatusMap[p.status] ?? 'new'),
    total: 0, // KDS não tem total — será enriquecido pelo DB quando disponível
    criadoEm: criadoHora,
    dataPedido: datePedido,
    minutosAtras,
    itensProntos,
    itensTotal: p.itens.reduce((sum, i) => sum + i.quantidade, 0),
    origem: origemMap[p.origem] ?? 'caixa',
    garcomNome: p.garcomNome,
    tempoAberto: undefined,
    atrasado: slaCozinha !== undefined && slaCozinha > 15,
    slaCozinha,
    slaEspera,
    slaEntrega: undefined,
    slaAlvo: 15,
    _criadoTs: new Date(p.criadoEm).toISOString(),
    _iniciouPreparoTs: primeiroIniciouPreparo ? new Date(primeiroIniciouPreparo).toISOString() : null,
    _ficouProntoTs: primeiroFicouPronto ? new Date(primeiroFicouPronto).toISOString() : null,
    _entregueTs: p.status === 'entregue' ? (() => { const tsList = p.itens.flatMap((i) => i.unidades?.map((u) => u.entregueEm).filter((t): t is number => typeof t === 'number') ?? (i.ficouProntoEm ? [i.ficouProntoEm] : [])); const latest = tsList.sort((a, b) => b - a)[0]; return latest ? new Date(latest).toISOString() : null; })() : null,
    session_id: p.session_id ?? undefined,
    session_number: p.session_number ?? undefined,
    isTraining: p.isTraining,
    telefone: p.customerPhone ?? null,
    endereco: p.deliveryAddress ?? null,
    pagamentos: p.pagamentos?.map((pg) => ({
      id: pg.id,
      amount: Number(pg.amount),
      change_amount: Number(pg.change_amount ?? 0),
      is_refunded: !!pg.is_refunded,
      payment_method_name: pg.payment_method_name ?? null,
      payment_method_type: (pg as { payment_method_type?: string | null }).payment_method_type ?? null,
      operator_name: pg.operator_name ?? null,
      cash_register_id: pg.cash_register_id ?? null,
      cash_register_name: pg.cash_register_name ?? null,
      origin_type: pg.origin_type ?? null,
      paid_by_pdv: pg.paid_by_pdv ?? null,
      payment_group_id: pg.payment_group_id ?? null,
    })),
    itensDetalhes: p.itens.map((item) => ({
      id: item.id,
      nome: item.nome,
      quantidade: item.quantidade,
      preco: 0,
      estacao: item.estacao,
      opcoes: item.opcoes?.map((o) => o.opcaoNome ?? '') ?? [],
      observacao: item.observacoes?.[0],
      unidades: item.unidades && item.unidades.length > 0
        ? item.unidades.map((u, idx) => ({
            unidade: idx + 1,
            status: (u.status === 'entregue' ? 'entregue'
              : u.status === 'pronto' ? 'pronto'
              : u.status === 'preparo' ? 'preparo'
              : 'aguardando') as 'aguardando' | 'preparo' | 'pronto' | 'entregue',
            operadorCozinha: u.operadorPreparo ?? item.operadorPreparo,
            ficouProntoEm: u.ficouProntoEm
              ? new Date(u.ficouProntoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            entregueEm: u.entregueEm !== undefined
              ? new Date(u.entregueEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            entregoPor: undefined,
            _iniciadoPreparoTs: u.iniciouPreparoEm ? new Date(u.iniciouPreparoEm).toISOString() : null,
            _prontoTs: u.ficouProntoEm ? new Date(u.ficouProntoEm).toISOString() : null,
            _entregueTs: u.entregueEm ? new Date(u.entregueEm).toISOString() : null,
            _criadoTs: new Date(p.criadoEm).toISOString(),
          }))
        : Array.from({ length: item.quantidade }, (_, idx) => ({
            unidade: idx + 1,
            status: (item.status === 'entregue' ? 'entregue'
              : item.status === 'pronto' ? 'pronto'
              : item.status === 'preparo' ? 'preparo'
              : 'aguardando') as 'aguardando' | 'preparo' | 'pronto' | 'entregue',
            operadorCozinha: item.operadorPreparo,
            ficouProntoEm: item.ficouProntoEm
              ? new Date(item.ficouProntoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            _iniciadoPreparoTs: item.iniciouPreparoEm ? new Date(item.iniciouPreparoEm).toISOString() : null,
            _prontoTs: item.ficouProntoEm ? new Date(item.ficouProntoEm).toISOString() : null,
            _entregueTs: null,
            _criadoTs: new Date(p.criadoEm).toISOString(),
          })),
    })),
  };
}

// ── Conversor DB → PedidoRecente ──────────────────────────────────────────────

export function dbParaRecente(o: DBOrder): PedidoRecente {
  // No delivery o item_price não inclui os adicionais (combo nasce com 0): normaliza para a
  // janela mostrar o valor real de cada item (ver src/lib/precoItemPedido.ts).
  const precosItens = precosEfetivos(
    o.itens.map((item) => ({
      preco: Number(item.preco) || 0,
      quantidade: Number(item.quantidade) || 1,
      adicionais: (item.options ?? []).reduce((a, op) => a + Number(op.additional_price ?? 0), 0),
    })),
    typeof o.subtotal === 'number' ? o.subtotal : null,
    o.origin,
  );
  const origemMap: Record<string, OrigemPedido> = {
    cashier: 'caixa', waiter: 'garcom', table: 'mesa', self_service: 'autoatendimento',
    delivery: 'delivery',
  };
  const destinoMap: Record<string, PedidoRecente['destino']> = {
    immediate: 'hora', table: 'mesa', delivery: 'nome', name: 'nome', password: 'senha',
  };
  const dt = new Date(o.created_at);
  const minutosAtras = Math.floor((Date.now() - dt.getTime()) / 60000);
  const dataPedidoBR = dt.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  const destTipo = destinoMap[o.destination] ?? 'hora';

  let nomeCliente: string | undefined;
  let senha: string | undefined;
  if (o.destination === 'name' || o.destination === 'delivery') {
    nomeCliente = o.destination_name ?? undefined;
  } else if (o.destination === 'password') {
    senha = o.destination_name ?? undefined;
  } else if (o.destination === 'table') {
    // QR universal: destination_name pode trazer o nome do cliente (ex.: "Mesa 0 - Angelica")
    nomeCliente = o.destination_name ?? undefined;
  }

  const slaEspera = o.sla_espera_min != null ? Number(o.sla_espera_min) : undefined;
  const slaCozinha = o.sla_cozinha_min != null ? Number(o.sla_cozinha_min) : undefined;
  const slaEntrega = o.sla_entrega_min != null ? Number(o.sla_entrega_min) : undefined;
  // Pedido andando: tempo desde a criação. Entregue: o tempo gravado (criado → último evento).
  // Sem marca da cozinha, entregue/cancelado fica sem tempo — antes virava "45h" e "atrasado".
  const isAtivo = o.status === 'new' || o.status === 'preparing' || o.status === 'ready';
  const tempoTotalCalc = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
  const tempoTotal = isAtivo ? tempoTotalCalc : (o.tempo_total_min != null ? Number(o.tempo_total_min) : undefined);
  const slaAlvo = 15;
  const atrasado = o.status === 'cancelled' ? false : tempoTotal !== undefined ? tempoTotal > slaAlvo : undefined;

  // Coleta timestamps de fases para SLA em tempo real
  const allInicioPreparoTs = o.itens
    .flatMap((item) => [
      item.started_preparing_at,
      ...(item.units?.map((u) => u.started_preparing_at) ?? []),
    ])
    .filter((t): t is string => !!t)
    .sort();
  const allProntoTs = o.itens
    .flatMap((item) => [
      item.ready_at,
      ...(item.units?.map((u) => u.ready_at) ?? []),
    ])
    .filter((t): t is string => !!t)
    .sort();
  const dbPrimeiroIniciouPreparo = allInicioPreparoTs[0] ?? null;
  const dbPrimeiroFicouPronto = allProntoTs[0] ?? null;

  let itensProntos = 0;
  let itensTotal = 0;
  o.itens.forEach((item) => {
    itensTotal += item.quantidade;
    if (item.units && item.units.length > 0) {
      itensProntos += item.units.filter((u) => u.status === 'delivered' || u.status === 'ready').length;
    } else {
      if (item.status === 'delivered' || item.status === 'ready') itensProntos += item.quantidade;
    }
  });

  const mapUnitStatus = (s: string): 'aguardando' | 'preparo' | 'pronto' | 'entregue' => {
    if (s === 'delivered') return 'entregue';
    if (s === 'ready') return 'pronto';
    if (s === 'preparing') return 'preparo';
    return 'aguardando';
  };

  const codigoNum = o.numero ?? '';
  // Sequência do dia ("P0210260003" → 3), igual ao número do KDS. Antes pegava todos os dígitos
  // finais (210260003) e esse número saía no CSV, no comprovante e na janela de receber.
  const numMatch = codigoNum.match(/^[A-Za-z]{0,2}\d{6}(\d+)$/) ?? codigoNum.match(/(\d+)$/);
  const numSequencial = numMatch ? parseInt(numMatch[1], 10) : 0;

  return {
    id: o.id,
    numero: numSequencial,
    numeroCodigo: codigoNum,
    destino: destTipo,
    mesaNumero: o.mesa_numero ?? undefined,
    nomeCliente,
    senha,
    participantToken: o.participant_token ?? undefined,
    participantName: o.participant_name ?? undefined,
    status: o.status as PedidoRecente['status'],
    total: Number(o.total) || 0,
    criadoEm: dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' }),
    dataPedido: dataPedidoBR,
    minutosAtras,
    itensProntos,
    itensTotal,
    origem: origemMap[o.origin] ?? 'caixa',
    garcomNome: o.operador ?? undefined,
    // Defesa dupla: se is_paid do hook for undefined, recalcular dos pagamentos
    pago: o.is_paid ?? (o.pagamentos?.some((p) => !p.is_refunded) ?? false),
    atrasado,
    slaCozinha,
    slaEspera,
    slaEntrega,
    slaAlvo,
    tempoAberto: tempoTotal,
    cancelReason: o.cancel_reason ?? undefined,
    desconto: o.discount_amount > 0 ? o.discount_amount : undefined,
    serviceFee: (o.service_fee_amount ?? 0) > 0 ? o.service_fee_amount : undefined,
    tipAmount: (o.tip_amount ?? 0) > 0 ? o.tip_amount : undefined,
    deliveryPlatform: o.delivery_platform ?? undefined,
    deliveryFee: o.delivery_fee ?? undefined,
    session_id: o.session_id ?? undefined,
    session_number: o.session_number ?? undefined,
    // Só vira "subtotal" quando difere do total (desconto/taxa/gorjeta no pedido). Pedido que veio
    // da RPC traz subtotal = total (a RPC não devolve o subtotal), e aí não há o que detalhar.
    subtotal: o.subtotal > 0 && Math.abs(o.subtotal - Number(o.total)) > 0.005 ? o.subtotal : undefined,
    telefone: o.destination_phone ?? null,
    endereco: o.delivery_address ?? null,
    cortesia: o.is_cortesia ?? undefined,
    canceladoPor: o.cancelled_by_name ?? null,
    canceladoEm: o.cancelled_at ?? null,
    saiuEntregaTs: o.out_for_delivery_at ?? null,
    _criadoTs: o.created_at,
    _iniciouPreparoTs: dbPrimeiroIniciouPreparo,
    _ficouProntoTs: dbPrimeiroFicouPronto,
    _entregueTs: (() => {
      // Coleta todas as unidades
      const allUnits = o.itens.flatMap((item) =>
        item.units?.map((u) => ({
          delivered_at: u.delivered_at,
          semCozinha: !item.station_name && !(
            item.entered_kds_at ||
            item.started_preparing_at ||
            item.ready_at ||
            (item.units && item.units.some((uu) => uu.started_preparing_at || uu.ready_at))
          ),
        })) ?? []
      );
      const unitsComCozinha = allUnits.filter((u) => !u.semCozinha);
      const unitsSemCozinha = allUnits.filter((u) => u.semCozinha);

      if (unitsComCozinha.length > 0) {
        const todasEntregues = unitsComCozinha.every((u) => !!u.delivered_at);
        if (!todasEntregues) return null;
        return unitsComCozinha
          .map((u) => u.delivered_at)
          .filter((t): t is string => !!t)
          .sort()
          .reverse()[0] ?? null;
      }
      if (unitsSemCozinha.length > 0) {
        const todasEntregues = unitsSemCozinha.every((u) => !!u.delivered_at);
        if (!todasEntregues) return null;
        return unitsSemCozinha
          .map((u) => u.delivered_at)
          .filter((t): t is string => !!t)
          .sort()
          .reverse()[0] ?? null;
      }
      return null;
    })(),
    pagamentos: o.pagamentos.filter((p) => !p.is_refunded).map((p) => ({
      id: p.id,
      amount: Number(p.amount) || 0,
      change_amount: p.change_amount != null ? Number(p.change_amount) : 0,
      is_refunded: p.is_refunded ?? false,
      payment_method_name: p.payment_method_name ?? null,
      payment_method_type: p.payment_method_type ?? null,
      operator_name: p.operator_name ?? null,
      cash_register_id: p.cash_register_id ?? null,
      cash_register_name: p.cash_register_name ?? null,
      paid_by_pdv: o.paid_by_pdv ?? null,
      payment_group_id: p.payment_group_id ?? null,
    })),
    itensDetalhes: o.itens.map((item, itemIdx) => {
      const opcoes = item.options?.map((op) => op.option_name) ?? [];
      const opcoesDetalhadas = item.options?.map((op) => ({ nome: op.option_name, preco: Number(op.additional_price ?? 0) })) ?? [];
      const obs = item.notes ?? item.observations?.[0]?.text;
      // Um item "sem cozinha" só é aquele que NUNCA entrou no KDS:
      // não tem estação E não tem nenhum registro de KDS (entered_kds_at, preparo, pronto).
      // Se o item tem timestamps de KDS, mesmo que station_name esteja vazio,
      // ele passou pela cozinha e NÃO é "sem preparo".
      const temRegistroKDS = !!(
        item.entered_kds_at ||
        item.started_preparing_at ||
        item.ready_at ||
        (item.units && item.units.some((u) => u.started_preparing_at || u.ready_at))
      );
      const itemSemCozinha = !item.station_name && !temRegistroKDS;
      const statusItemPai = mapUnitStatus(item.status);

      let unidades: PedidoRecente['itensDetalhes'][0]['unidades'];
      if (item.units && item.units.length > 0) {
        unidades = item.units.map((u) => {
          const unitStatus = mapUnitStatus(u.status);
          // Promove status se a unidade está aguardando mas o item pai já está pronto/entregue
          const resolvedStatus: 'aguardando' | 'preparo' | 'pronto' | 'entregue' =
            unitStatus === 'aguardando' && (statusItemPai === 'pronto' || statusItemPai === 'entregue')
              ? statusItemPai
              : unitStatus;
          return {
            unidade: u.unit_number,
            status: resolvedStatus,
            semCozinha: itemSemCozinha,
            operadorCozinha: u.operator_name,
            ficouProntoEm: u.ready_at
              ? new Date(u.ready_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : resolvedStatus === 'pronto' || resolvedStatus === 'entregue'
              ? item.ready_at
                ? new Date(item.ready_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                : undefined
              : undefined,
            entregueEm: u.delivered_at
              ? new Date(u.delivered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
              : undefined,
            _iniciadoPreparoTs: u.started_preparing_at ?? null,
            _prontoTs: u.ready_at ?? (resolvedStatus === 'pronto' || resolvedStatus === 'entregue' ? item.ready_at ?? null : null),
            _entregueTs: u.delivered_at ?? null,
            _criadoTs: o.created_at,
          };
        });
      } else {
        unidades = Array.from({ length: item.quantidade }, (_, idx) => ({
          unidade: idx + 1,
          status: statusItemPai,
          semCozinha: itemSemCozinha,
          operadorCozinha: item.operator_name,
          ficouProntoEm: item.ready_at
            ? new Date(item.ready_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : undefined,
          entregueEm: item.delivered_at
            ? new Date(item.delivered_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
            : undefined,
          _iniciadoPreparoTs: item.started_preparing_at ?? null,
          _prontoTs: item.ready_at ?? null,
          _entregueTs: item.delivered_at ?? null,
          _criadoTs: o.created_at,
        }));
      }
      return {
        id: item.id,
        nome: item.nome,
        quantidade: item.quantidade,
        preco: precosItens[itemIdx] ?? (Number(item.preco) || 0),
        estacao: item.station_name ?? '',
        opcoes,
        opcoesDetalhadas,
        observacao: obs,
        unidades,
        cancelado: item.status === 'cancelled',
      };
    }),
  };
}

// ─── Agrupamento de pedidos unificados (payment_group_id) ─────────────────────

/** Agrupa pedidos que compartilham o mesmo payment_group_id em um único pedido representativo.
 *  Pedidos sem payment_group_id permanecem individuais. */
export function agruparPedidosUnificados(pedidos: PedidoRecente[]): PedidoRecente[] {
  const grupos = new Map<string, PedidoRecente[]>();
  const individuais: PedidoRecente[] = [];

  // Separa pedidos com payment_group_id dos sem
  pedidos.forEach((p) => {
    const groupId = p.pagamentos?.find((pg) => pg.payment_group_id)?.payment_group_id ?? null;
    if (groupId) {
      if (!grupos.has(groupId)) grupos.set(groupId, []);
      grupos.get(groupId)!.push(p);
    } else {
      individuais.push(p);
    }
  });

  // Para cada grupo, cria um pedido representativo
  const agrupados: PedidoRecente[] = [];
  grupos.forEach((pedidosDoGrupo, groupId) => {
    // Só 1 pedido do grupo no período (o outro ficou em outro dia/canal): é um pedido normal, com o id
    // de verdade — o id sintético "group-…" ia para as ações (NF, cancelar, comanda) e dava erro.
    if (pedidosDoGrupo.length === 1) { individuais.push(pedidosDoGrupo[0]); return; }
    // Ordena por data de criação (mais antigo primeiro)
    pedidosDoGrupo.sort((a, b) => {
      const aTs = a._criadoTs ? new Date(a._criadoTs).getTime() : 0;
      const bTs = b._criadoTs ? new Date(b._criadoTs).getTime() : 0;
      return bTs - aTs; // mais recente primeiro
    });

    const pedidoPrincipal = pedidosDoGrupo[0];
    const todosItens = pedidosDoGrupo.flatMap((p) => p.itensDetalhes.map((item) => ({ ...item, orderId: p.id })));
    const todosPagamentos = pedidosDoGrupo.flatMap((p) => p.pagamentos ?? []);
    // Cancelado (sem estorno) não soma nem decide a situação do grupo
    const ativosDoGrupo = pedidosDoGrupo.filter((p) => p.status !== 'cancelled' && (p.status as string) !== 'cancelado');
    const baseStatus = ativosDoGrupo.length > 0 ? ativosDoGrupo : pedidosDoGrupo;
    const totalGrupo = ativosDoGrupo.reduce((sum, p) => sum + p.total, 0);
    const subtotalGrupo = pedidosDoGrupo.reduce((sum, p) => sum + (p.subtotal ?? p.total), 0);
    const todosPago = pedidosDoGrupo.every((p) => p.pago);
    const todosCancelado = pedidosDoGrupo.every((p) => p.status === 'cancelled' || p.status === 'cancelado');
    const todosEntregue = baseStatus.every((p) => p.status === 'delivered' || p.status === 'entregue');
    const todosPronto = baseStatus.every((p) => p.status === 'ready' || p.status === 'pronto');
    const algumPreparo = baseStatus.some((p) => p.status === 'preparing' || (p.status as string) === 'preparo');
    const algumAberto = baseStatus.some((p) => p.status === 'new' || (p.status as string) === 'novo');

    const statusGrupo: PedidoRecente['status'] = todosCancelado
      ? 'cancelled'
      : todosEntregue
      ? 'delivered'
      : todosPronto
      ? 'ready'
      : algumPreparo
      ? 'preparing'
      : algumAberto
      ? 'new'
      : pedidoPrincipal.status;

    // Número do grupo: concatena os números dos pedidos
    const numerosCodigos = pedidosDoGrupo.map((p) => p.numeroCodigo ?? String(p.numero)).join(', ');
    const numerosStr = pedidosDoGrupo.map((p) => p.numeroStr ?? String(p.numero)).join(', ');

    const pedidoAgrupado: PedidoRecente = {
      ...pedidoPrincipal,
      id: `group-${groupId}`, // ID sintético para o grupo
      numero: pedidoPrincipal.numero,
      numeroCodigo: numerosCodigos,
      numeroStr: numerosStr,
      status: statusGrupo,
      total: totalGrupo,
      subtotal: Math.abs(subtotalGrupo - totalGrupo) > 0.005 ? subtotalGrupo : undefined,
      pago: todosPago,
      itensDetalhes: todosItens,
      pagamentos: todosPagamentos,
      pedidoIds: pedidosDoGrupo.map((p) => p.id),
      pedidosOriginais: pedidosDoGrupo,
    };

    agrupados.push(pedidoAgrupado);
  });

  // Combina: grupos primeiro (ordenados por data), depois individuais
  return [...agrupados, ...individuais].sort((a, b) => {
    const aTs = a._criadoTs ? new Date(a._criadoTs).getTime() : 0;
    const bTs = b._criadoTs ? new Date(b._criadoTs).getTime() : 0;
    return bTs - aTs;
  });
}

// ── Helpers de label ──────────────────────────────────────────────────────────

export function destinoStr(pedido: PedidoRecente): string {
  if (isQRUniversal(pedido)) {
    const nome = clienteNome(pedido);
    return `Senha ${pedido.participantToken}${nome ? ` - ${nome}` : ''}`;
  }
  if (pedido.destino === 'mesa') return `Mesa ${pedido.mesaNumero ?? ''}`;
  if (pedido.destino === 'nome') return pedido.nomeCliente ?? '—';
  if (pedido.destino === 'delivery') return pedido.nomeCliente ?? 'Delivery';
  if (pedido.destino === 'senha') return `Senha ${pedido.senha ?? ''}`;
  return 'Na hora';
}


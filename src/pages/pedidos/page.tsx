import { useState, useMemo, useRef, useEffect } from 'react';
import type { PedidoRecente, OrigemPedido } from '@/types/pdv';
import PedidoDetalheModal from './components/PedidoDetalheModal';
import PedidosLista from './components/PedidosLista';
import PedidosMetricas from './components/PedidosMetricas';
import PedidosFiltros from './components/PedidosFiltros';
import { useKDS } from '@/contexts/KDSContext';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/lib/supabase';
import type { KDSPedido } from '@/types/kds';
import { useOrdersHistory } from '@/hooks/useOrdersHistory';
import type { DBOrder } from '@/hooks/useOrdersHistory';
import { useSessions } from '@/hooks/useSessions';
import { useSessao } from '@/contexts/SessaoContext';
import ModoFaturamentoToggle from '@/components/feature/ModoFaturamentoToggle';
import { useModoFaturamento } from '@/contexts/ModoFaturamentoContext';
import {
  HOJE, somarDias, MESES, STATUS_LABEL as _STATUS_LABEL, DB_STATUS_LABEL, ORIGEM_LABEL,
  formatarDataExibicao, isQRUniversal, clienteNome, origemLabelFor,
} from './components/utils';
import type { FiltroStatus, FiltroOrigem, ModoPeriodo } from './components/utils';

// ── Conversor KDS → PedidoRecente ─────────────────────────────────────────────

function kdsParaRecente(p: KDSPedido): PedidoRecente {
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
    status: kdsStatusMap[p.status] ?? 'new',
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
    pagamentos: p.pagamentos?.map((pg) => ({
      id: pg.id,
      amount: Number(pg.amount),
      change_amount: Number(pg.change_amount ?? 0),
      is_refunded: !!pg.is_refunded,
      payment_method_name: pg.payment_method_name ?? null,
      payment_method_type: pg.payment_method_type ?? null,
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

function dbParaRecente(o: DBOrder): PedidoRecente {
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
  // Calcula tempo total em minutos desde a criação do pedido
  const tempoTotalCalc = Math.floor((Date.now() - new Date(o.created_at).getTime()) / 60000);
  const tempoTotal = o.tempo_total_min != null ? Number(o.tempo_total_min) : tempoTotalCalc;
  const slaAlvo = 15;
  const atrasado = tempoTotal !== undefined ? tempoTotal > slaAlvo : undefined;

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
  const numMatch = codigoNum.match(/(\d+)$/);
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
    itensDetalhes: o.itens.map((item) => {
      const opcoes = item.options?.map((op) => op.option_name) ?? [];
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
        preco: Number(item.preco) || 0,
        estacao: item.station_name ?? '',
        opcoes,
        observacao: obs,
        unidades,
      };
    }),
  };
}

// ─── Agrupamento de pedidos unificados (payment_group_id) ─────────────────────

/** Agrupa pedidos que compartilham o mesmo payment_group_id em um único pedido representativo.
 *  Pedidos sem payment_group_id permanecem individuais. */
function agruparPedidosUnificados(pedidos: PedidoRecente[]): PedidoRecente[] {
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
    // Ordena por data de criação (mais antigo primeiro)
    pedidosDoGrupo.sort((a, b) => {
      const aTs = a._criadoTs ? new Date(a._criadoTs).getTime() : 0;
      const bTs = b._criadoTs ? new Date(b._criadoTs).getTime() : 0;
      return bTs - aTs; // mais recente primeiro
    });

    const pedidoPrincipal = pedidosDoGrupo[0];
    const todosItens = pedidosDoGrupo.flatMap((p) => p.itensDetalhes.map((item) => ({ ...item, orderId: p.id })));
    const todosPagamentos = pedidosDoGrupo.flatMap((p) => p.pagamentos ?? []);
    const totalGrupo = pedidosDoGrupo.reduce((sum, p) => sum + p.total, 0);
    const todosPago = pedidosDoGrupo.every((p) => p.pago);
    const todosCancelado = pedidosDoGrupo.every((p) => p.status === 'cancelled' || p.status === 'cancelado');
    const todosEntregue = pedidosDoGrupo.every((p) => p.status === 'delivered' || p.status === 'entregue');
    const todosPronto = pedidosDoGrupo.every((p) => p.status === 'ready' || p.status === 'pronto');
    const algumPreparo = pedidosDoGrupo.some((p) => p.status === 'preparing' || p.status === 'preparo');
    const algumAberto = pedidosDoGrupo.some((p) => p.status === 'new' || p.status === 'novo');

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

function destinoStr(pedido: PedidoRecente): string {
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

// ── Página ────────────────────────────────────────────────────────────────────

export default function PedidosPage() {
  const [busca, setBusca] = useState('');
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>('todos');
  const [filtroOrigem, setFiltroOrigem] = useState<FiltroOrigem>('todos');
  const [filtroPlataforma, setFiltroPlataforma] = useState<string>('todos');
  const [pedidoDetalheId, setPedidoDetalheId] = useState<string | null>(null);
  const { pedidos: kdsPedidos } = useKDS();
  const { user } = useAuth();
  const { modo } = useModoFaturamento();

  // Sessão atual do SessaoContext (para modo sessão ativa)
  const { sessao: sessaoAtiva } = useSessao();

  // Filtro de data
  const [modoPeriodo, setModoPeriodo] = useState<ModoPeriodo>('preset');
  const [presetAtivo, setPresetAtivo] = useState<string>('hoje');
  const [diaEspecifico, setDiaEspecifico] = useState(HOJE);
  const [periodoInicio, setPeriodoInicio] = useState(somarDias(HOJE, -6));
  const [periodoFim, setPeriodoFim] = useState(HOJE);
  const [mesSelecionado, setMesSelecionado] = useState(new Date().getMonth());
  const [anoSelecionado, setAnoSelecionado] = useState(new Date().getFullYear());
  const [anoApenas, setAnoApenas] = useState(new Date().getFullYear());

  // Sessão histórica selecionada pelo usuário
  const { sessions, loading: loadingSessions } = useSessions(30);
  const [sessaoSelecionadaId, setSessaoSelecionadaId] = useState<string | null>(null);

  /**
   * LÓGICA DE FILTRO PARA O HOOK:
   *
   * Modo SESSÃO:
   *   - sessaoSelecionadaId = null → usa sessão ATIVA atual (sessaoAtiva.id)
   *   - sessaoSelecionadaId = id   → filtra por sessão histórica
   *
   * Modo DATA (Hoje / Ontem / período):
   *   - presetAtivo = 'hoje' SEM filtro de data → usa RPC (últimas 12h) = mais confiável
   *   - presetAtivo = outros → usa filtro de data direto
   */
  const { hookDateFrom, hookDateTo, hookSessionId } = useMemo(() => {
    if (modo === 'sessao') {
      // Sessão histórica selecionada
      if (sessaoSelecionadaId) {
        return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: sessaoSelecionadaId };
      }
      // Sessão ativa atual — passa o ID da sessão para a RPC
      const activeId = sessaoAtiva?.id ?? null;
      return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: activeId };
    }

    // Modo data
    if (modoPeriodo === 'preset') {
      if (presetAtivo === 'hoje') {
        // "Hoje" = filtro de data direto para garantir apenas pedidos do dia atual
        return { hookDateFrom: HOJE, hookDateTo: HOJE, hookSessionId: null };
      }
      if (presetAtivo === 'ontem') {
        const d = somarDias(HOJE, -1);
        return { hookDateFrom: d, hookDateTo: d, hookSessionId: null };
      }
      if (presetAtivo === '7dias') {
        return { hookDateFrom: somarDias(HOJE, -6), hookDateTo: HOJE, hookSessionId: null };
      }
      if (presetAtivo === '30dias') {
        return { hookDateFrom: somarDias(HOJE, -29), hookDateTo: HOJE, hookSessionId: null };
      }
      if (presetAtivo === 'mes') {
        const mesStr = String(new Date().getMonth() + 1).padStart(2, '0');
        return { hookDateFrom: `${HOJE.slice(0, 4)}-${mesStr}-01`, hookDateTo: HOJE, hookSessionId: null };
      }
      if (presetAtivo === 'ano') {
        return { hookDateFrom: `${HOJE.slice(0, 4)}-01-01`, hookDateTo: HOJE, hookSessionId: null };
      }
      // 'todos' = sem filtro
      return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: null };
    }
    if (modoPeriodo === 'dia') {
      return { hookDateFrom: diaEspecifico, hookDateTo: diaEspecifico, hookSessionId: null };
    }
    if (modoPeriodo === 'periodo') {
      return { hookDateFrom: periodoInicio, hookDateTo: periodoFim, hookSessionId: null };
    }
    if (modoPeriodo === 'mes') {
      const mesStr = String(mesSelecionado + 1).padStart(2, '0');
      const lastDay = new Date(anoSelecionado, mesSelecionado + 1, 0).getDate();
      return {
        hookDateFrom: `${anoSelecionado}-${mesStr}-01`,
        hookDateTo: `${anoSelecionado}-${mesStr}-${String(lastDay).padStart(2, '0')}`,
        hookSessionId: null,
      };
    }
    if (modoPeriodo === 'ano') {
      return { hookDateFrom: `${anoApenas}-01-01`, hookDateTo: `${anoApenas}-12-31`, hookSessionId: null };
    }
    return { hookDateFrom: undefined, hookDateTo: undefined, hookSessionId: null };
  }, [
    modo, sessaoSelecionadaId, sessaoAtiva?.id,
    modoPeriodo, presetAtivo, diaEspecifico,
    periodoInicio, periodoFim, mesSelecionado,
    anoSelecionado, anoApenas,
  ]);

  const { orders: dbOrders, loading: loadingSessaoOrders, reload: reloadOrders } = useOrdersHistory(
    hookDateFrom,
    hookDateTo,
    hookSessionId,
  );

  // ── Sincronização em tempo real (orientada a eventos) ─────────────────────
  // Em vez de consultar o banco a cada poucos segundos, escutamos o Supabase
  // Realtime: qualquer INSERT/UPDATE em orders ou payments (do tenant) dispara
  // um reload — agrupado por um debounce para não recarregar em rajada. 100%
  // orientado a eventos (sem poll). O botão de atualizar manual cobre o caso
  // raro de um evento realtime perdido.
  useEffect(() => {
    const shouldLive = modo === 'sessao' || (modoPeriodo === 'preset' && presetAtivo === 'hoje');
    if (!shouldLive || !user?.tenantId) return;

    let debounce: ReturnType<typeof setTimeout> | null = null;
    const agendarReload = () => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => {
        reloadOrders(hookDateFrom, hookDateTo, hookSessionId ?? null);
      }, 800);
    };

    const canal = supabase
      .channel(`pedidos-page-${user.tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${user.tenantId}` }, agendarReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `tenant_id=eq.${user.tenantId}` }, agendarReload)
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(canal);
    };
  }, [user?.tenantId, reloadOrders, hookDateFrom, hookDateTo, hookSessionId, modo, modoPeriodo, presetAtivo]);

  useEffect(() => {
    if (modo !== 'sessao') setSessaoSelecionadaId(null);
  }, [modo]);

  const sessaoSelecionada = useMemo(
    () => sessions.find((s) => s.id === sessaoSelecionadaId) ?? null,
    [sessions, sessaoSelecionadaId],
  );

  // ── Merge: DB (fonte da verdade) + KDS (status em tempo real) ────────────
  const pedidos = useMemo(() => {
    const kdsMap = new Map(kdsPedidos.map((p) => [p.id, p]));

    if (dbOrders.length > 0) {
      const dbMapeados = dbOrders.map((o) => {
        const rec = dbParaRecente(o);
        // Enriquece com dados em tempo real do KDS
        const kds = kdsMap.get(o.id);
        if (kds) {
          const kdsStatusMap: Record<string, PedidoRecente['status']> = {
            novo: 'new', preparo: 'preparing', pronto: 'ready', entregue: 'delivered',
          };
          rec.status = kdsStatusMap[kds.status] ?? rec.status;

          // Senha/nome do participante (QR universal) — só o KDS resolve esses campos
          if (kds.participantToken) rec.participantToken = kds.participantToken;
          if (kds.participantName) rec.participantName = kds.participantName;

          // ── Timestamps para SLA em tempo real: usa KDS que tem os dados mais frescos ──
          const kdsIniciouPreparo = kds.itens
            .map((i) => i.iniciouPreparoEm)
            .filter((t): t is number => !!t)
            .sort((a, b) => a - b)[0];
          const kdsFicouPronto = kds.itens
            .map((i) => i.ficouProntoEm)
            .filter((t): t is number => !!t)
            .sort((a, b) => a - b)[0];

          // Sobrescreve os timestamps com dados do KDS (mais confiáveis em tempo real)
          if (kdsIniciouPreparo) {
            rec._iniciouPreparoTs = new Date(kdsIniciouPreparo).toISOString();
          }
          if (kdsFicouPronto) {
            rec._ficouProntoTs = new Date(kdsFicouPronto).toISOString();
          }
          // Timestamp de criação do KDS (mais preciso que o DB)
          rec._criadoTs = new Date(kds.criadoEm).toISOString();

          const temposPreparo = kds.itens
            .filter((i) => i.iniciouPreparoEm && i.ficouProntoEm)
            .map((i) => (i.ficouProntoEm! - i.iniciouPreparoEm!) / 60000);
          if (temposPreparo.length > 0) {
            rec.slaCozinha = Math.round(temposPreparo.reduce((a, b) => a + b, 0) / temposPreparo.length);
          }
        }
        return rec;
      });

      // Adiciona pedidos do KDS que ainda não existem no DB (recém-criados)
      const dbIds = new Set(dbOrders.map((o) => o.id));
      const apenasKds = kdsPedidos
        .filter((p) => {
          if (dbIds.has(p.id)) return false;
          // Só inclui pedidos do dia atual para não poluir a lista
          return new Date(p.criadoEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) === HOJE;
        })
        .map(kdsParaRecente);

      return [...apenasKds, ...dbMapeados];
    }

    // Enquanto carrega, não mostra KDS (total=0 poluiria a lista)
    if (loadingSessaoOrders) return [];

    // DB vazio após carregamento: usa KDS como fallback, mas filtra por data
    return kdsPedidos
      .filter((p) => {
        const dataBR = new Date(p.criadoEm).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
        if (modo === 'sessao') return true;
        if (modoPeriodo === 'preset') {
          if (presetAtivo === 'hoje') return dataBR === HOJE;
          if (presetAtivo === 'ontem') return dataBR === somarDias(HOJE, -1);
          if (presetAtivo === '7dias') return dataBR >= somarDias(HOJE, -6) && dataBR <= HOJE;
          if (presetAtivo === '30dias') return dataBR >= somarDias(HOJE, -29) && dataBR <= HOJE;
          if (presetAtivo === 'mes') return dataBR.startsWith(HOJE.slice(0, 7));
          if (presetAtivo === 'ano') return dataBR.startsWith(HOJE.slice(0, 4));
          return true;
        }
        if (modoPeriodo === 'dia') return dataBR === diaEspecifico;
        if (modoPeriodo === 'periodo') return dataBR >= periodoInicio && dataBR <= periodoFim;
        if (modoPeriodo === 'mes') {
          const mesStr = String(mesSelecionado + 1).padStart(2, '0');
          return dataBR.startsWith(`${anoSelecionado}-${mesStr}`);
        }
        if (modoPeriodo === 'ano') return dataBR.startsWith(`${anoApenas}`);
        return true;
      })
      .map(kdsParaRecente);
  }, [kdsPedidos, dbOrders, loadingSessaoOrders, modo, modoPeriodo, presetAtivo, diaEspecifico,
      periodoInicio, periodoFim, mesSelecionado, anoSelecionado, anoApenas]);

  // ── Filtro de data no frontend (apenas para filtragem visual) ─────────────
  const filtrarPorData = (p: PedidoRecente): boolean => {
    if (modo === 'sessao') return true;
    const data = p.dataPedido ?? HOJE;
    if (modoPeriodo === 'preset') {
      if (presetAtivo === 'hoje') return data === HOJE;
      if (presetAtivo === 'ontem') return data === somarDias(HOJE, -1);
      if (presetAtivo === '7dias') return data >= somarDias(HOJE, -6) && data <= HOJE;
      if (presetAtivo === '30dias') return data >= somarDias(HOJE, -29) && data <= HOJE;
      if (presetAtivo === 'mes') return data.startsWith(HOJE.slice(0, 7));
      if (presetAtivo === 'ano') return data.startsWith(HOJE.slice(0, 4));
      return true;
    }
    if (modoPeriodo === 'dia') return data === diaEspecifico;
    if (modoPeriodo === 'periodo') return data >= periodoInicio && data <= periodoFim;
    if (modoPeriodo === 'mes') {
      const mesStr = String(mesSelecionado + 1).padStart(2, '0');
      return data.startsWith(`${anoSelecionado}-${mesStr}`);
    }
    if (modoPeriodo === 'ano') return data.startsWith(`${anoApenas}`);
    return true;
  };

  const labelDataAtiva = (): string => {
    if (modo === 'sessao') {
      if (sessaoSelecionadaId && sessaoSelecionada) {
        const dt = new Date(sessaoSelecionada.opened_at);
        return `Sessão ${dt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' })} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}`;
      }
      return 'Sessão atual';
    }
    if (modoPeriodo === 'preset') {
      const map: Record<string, string> = {
        hoje: 'Hoje', ontem: 'Ontem', '7dias': 'Últimos 7 dias',
        '30dias': 'Últimos 30 dias', mes: 'Este mês', ano: 'Este ano', todos: 'Todos os dias',
      };
      return map[presetAtivo] ?? 'Hoje';
    }
    if (modoPeriodo === 'dia') return formatarDataExibicao(diaEspecifico);
    if (modoPeriodo === 'periodo') return `${formatarDataExibicao(periodoInicio)} → ${formatarDataExibicao(periodoFim)}`;
    if (modoPeriodo === 'mes') return `${MESES[mesSelecionado]} ${anoSelecionado}`;
    if (modoPeriodo === 'ano') return `Ano ${anoApenas}`;
    return '';
  };

  const filtrados = useMemo(() => {
    return pedidos
      .filter((p) => {
        const q = busca.toLowerCase().trim();
        const matchBusca =
          !q ||
          String(p.numero).includes(q) ||
          (p.numeroCodigo?.toLowerCase().includes(q) ?? false) ||
          (p.nomeCliente?.toLowerCase().includes(q) ?? false) ||
          (p.participantName?.toLowerCase().includes(q) ?? false) ||
          (p.garcomNome?.toLowerCase().includes(q) ?? false) ||
          (p.senha?.toLowerCase().includes(q) ?? false) ||
          (p.participantToken?.toLowerCase().includes(q) ?? false) ||
          (p.mesaNumero ? `mesa ${p.mesaNumero}`.includes(q) : false) ||
          p.itensDetalhes.some((i) => i.nome.toLowerCase().includes(q));

        // Status filter: olha para unidades individuais, não só o status agregado do pedido
        const matchStatus = (() => {
          if (filtroStatus === 'todos') return true;
          if (filtroStatus === 'aberto') {
            // Em aberto = pedido não cancelado que ainda não foi totalmente entregue
            if (p.status === 'cancelled' || p.status === 'cancelado') return false;
            const totalUnidades = p.itensDetalhes.reduce((acc, item) => acc + item.quantidade, 0);
            const unidadesEntregues = p.itensDetalhes.reduce((acc, item) => {
              return acc + (item.unidades?.filter((u) => u.status === 'entregue').length ?? 0);
            }, 0);
            return unidadesEntregues < totalUnidades;
          }
          if (filtroStatus === 'pronto') {
            // Pelo menos uma unidade está pronta ou entregue
            return p.itensDetalhes.some((item) =>
              item.unidades?.some((u) => u.status === 'pronto' || u.status === 'entregue') ?? false,
            );
          }
          if (filtroStatus === 'entregue') {
            // Pelo menos uma unidade foi entregue
            return p.itensDetalhes.some((item) =>
              item.unidades?.some((u) => u.status === 'entregue') ?? false,
            );
          }
          if (filtroStatus === 'cancelado') {
            return p.status === 'cancelled' || p.status === 'cancelado';
          }
          return false;
        })();

        const matchOrigem = filtroOrigem === 'todos' || p.origem === filtroOrigem;
        const matchData = filtrarPorData(p);

        // Filtro de plataforma de delivery
        const matchPlataforma = filtroPlataforma === 'todos' ||
          (p.origem === 'delivery' && (p as PedidoRecente & { deliveryPlatform?: string }).deliveryPlatform === filtroPlataforma) ||
          (filtroPlataforma === 'unknown' && p.origem === 'delivery' && !(p as PedidoRecente & { deliveryPlatform?: string }).deliveryPlatform);

        return matchBusca && matchStatus && matchOrigem && matchData && matchPlataforma;
      })
      .sort((a, b) => b.minutosAtras === a.minutosAtras ? 0 : a.minutosAtras - b.minutosAtras);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidos, busca, filtroStatus, filtroOrigem, filtroPlataforma, modoPeriodo, presetAtivo, diaEspecifico,
      periodoInicio, periodoFim, mesSelecionado, anoSelecionado, anoApenas, modo]);

  // ── Agrupamento de pedidos unificados para a lista ─────────────────────────
  const pedidosAgrupados = useMemo(() => agruparPedidosUnificados(filtrados), [filtrados]);

  const pedidoDetalhe = useMemo(
    () => (pedidoDetalheId ? pedidosAgrupados.find((p) => p.id === pedidoDetalheId) ?? null : null),
    [pedidoDetalheId, pedidosAgrupados],
  );

  // ── Métricas ──────────────────────────────────────────────────────────────
  const filtradosComTotal = filtrados.filter(
    (p) => (p.total > 0 || p.pago === true) && !['cancelado', 'cancelled'].includes(p.status),
  );
  const totalValor = filtradosComTotal.reduce((acc, p) => acc + (p.total ?? 0), 0);
  const emAberto = filtrados.filter(
    (p) => !p.pago && !['cancelado', 'cancelled'].includes(p.status),
  ).length;
  const entregues = filtrados.filter((p) => p.status === 'delivered').length;
  const cancelados = filtrados.filter((p) => p.status === 'cancelled' || p.status === 'cancelado').length;
  const ticketMedio = filtradosComTotal.length > 0 ? totalValor / filtradosComTotal.length : 0;
  const pedidosComSla = filtrados.filter((p) => p.slaCozinha !== undefined);
  const slaMedio = pedidosComSla.length > 0
    ? Math.round(pedidosComSla.reduce((acc, p) => acc + (p.slaCozinha ?? 0), 0) / pedidosComSla.length)
    : null;
  const pagos = filtrados.filter((p) => p.pago).length;
  const pendentes = filtrados.filter(
    (p) => !p.pago && !['cancelado', 'cancelled'].includes(p.status),
  ).length;
  const valorPago = filtrados
    .filter((p) => p.pago && !['cancelado', 'cancelled'].includes(p.status))
    .reduce((acc, p) => acc + p.total, 0);

  // ── Export CSV ────────────────────────────────────────────────────────────
  const [mostrarMenuExport, setMostrarMenuExport] = useState(false);
  const refMenuExport = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (refMenuExport.current && !refMenuExport.current.contains(e.target as Node)) {
        setMostrarMenuExport(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const exportarCSV = (modoExport: 'resumo' | 'detalhado' = 'resumo') => {
    const label = labelDataAtiva().replace(/[\s→]/g, '_');
    const dateStr = new Date().toISOString().slice(0, 10);
    if (modoExport === 'detalhado') {
      const headers = ['Nº Pedido','Código','Sessão','Data','Hora','Status','Pagamento','Destino','Origem','Operador','Item','Qtd','Preço Unit (R$)','Subtotal Item (R$)','Opções','Observação','Estação','SLA Espera (min)','SLA Cozinha (min)','Tempo Total (min)','Total Pedido (R$)'];
      const rows: string[][] = [];
      filtrados.forEach((p) => {
        p.itensDetalhes.forEach((item) => {
          rows.push([
            String(p.numero).padStart(4, '0'), p.numeroCodigo ?? '', p.session_number ?? '', p.dataPedido ?? '', p.criadoEm,
            DB_STATUS_LABEL[p.status] ?? _STATUS_LABEL[p.status] ?? p.status,
            p.pago ? 'Pago' : 'Pendente',
            destinoStr(p), origemLabelFor(p), p.garcomNome ?? '',
            item.nome, String(item.quantidade),
            item.preco.toFixed(2).replace('.', ','),
            (item.preco * item.quantidade).toFixed(2).replace('.', ','),
            item.opcoes.join(' | '), item.observacao ?? '', item.estacao ?? '',
            p.slaEspera !== undefined ? String(p.slaEspera) : '',
            p.slaCozinha !== undefined ? String(p.slaCozinha) : '',
            p.tempoAberto !== undefined ? String(p.tempoAberto) : '',
            p.total.toFixed(2).replace('.', ','),
          ]);
        });
      });
      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `pedidos_detalhado_${label}_${dateStr}.csv`; a.click();
      URL.revokeObjectURL(url);
    } else {
      const headers = ['Nº Pedido','Código','Sessão','Data','Hora','Status','Pagamento','Destino','Origem','Operador','Itens','SLA Espera (min)','SLA Cozinha (min)','Tempo Total (min)','Total (R$)'];
      const rows = filtrados.map((p) => [
        String(p.numero).padStart(4, '0'), p.numeroCodigo ?? '', p.session_number ?? '', p.dataPedido ?? '', p.criadoEm,
        DB_STATUS_LABEL[p.status] ?? _STATUS_LABEL[p.status] ?? p.status,
        p.pago ? 'Pago' : 'Pendente',
        destinoStr(p), origemLabelFor(p), p.garcomNome ?? '',
        p.itensDetalhes.map((i) => `${i.quantidade}x ${i.nome}`).join(' | '),
        p.slaEspera !== undefined ? String(p.slaEspera) : '',
        p.slaCozinha !== undefined ? String(p.slaCozinha) : '',
        p.tempoAberto !== undefined ? String(p.tempoAberto) : '',
        p.total.toFixed(2).replace('.', ','),
      ]);
      const csv = [headers, ...rows].map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
      const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `pedidos_${label}_${dateStr}.csv`; a.click();
      URL.revokeObjectURL(url);
    }
    setMostrarMenuExport(false);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 md:px-6 py-4 flex-shrink-0" style={{ background: '#ffffff', borderBottom: '1px solid #f4f4f5' }}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center bg-zinc-100 rounded-lg">
              <i className="ri-file-list-3-line text-zinc-600 text-base" />
            </div>
            <div>
              <h1 className="text-base font-bold text-zinc-900">Pedidos</h1>
              <p className="text-xs text-zinc-400 hidden sm:block">Todos os pedidos com informações completas</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <ModoFaturamentoToggle size="sm" showLabel={false} />
            <button
              onClick={() => reloadOrders(hookDateFrom, hookDateTo, hookSessionId ?? null)}
              disabled={loadingSessaoOrders}
              className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-500 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40"
              title="Atualizar pedidos"
            >
              <i className={`ri-refresh-line ${loadingSessaoOrders ? 'animate-spin' : ''}`} />
            </button>
            <span className="text-xs text-zinc-400 bg-zinc-100 px-3 py-1.5 rounded-lg font-medium">
              {pedidosAgrupados.length} pedido{pedidosAgrupados.length !== 1 ? 's' : ''}
            </span>
            <div className="relative" ref={refMenuExport}>
              <button
                onClick={() => setMostrarMenuExport((v) => !v)}
                disabled={filtrados.length === 0}
                className="flex items-center gap-1.5 border border-zinc-200 bg-white hover:bg-zinc-50 text-zinc-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer whitespace-nowrap transition-colors disabled:opacity-40"
              >
                <i className="ri-download-line" /> Exportar CSV
                <i className={`${mostrarMenuExport ? 'ri-arrow-up-s-line' : 'ri-arrow-down-s-line'} text-xs transition-transform`} />
              </button>
              {mostrarMenuExport && (
                <div className="absolute right-0 top-full mt-1.5 w-52 bg-white border border-zinc-100 rounded-xl z-50 overflow-hidden">
                  <button onClick={() => exportarCSV('resumo')}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors text-left">
                    <i className="ri-file-list-line text-zinc-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-zinc-700">Resumo</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">1 linha por pedido</p>
                    </div>
                  </button>
                  <div className="border-t border-zinc-50" />
                  <button onClick={() => exportarCSV('detalhado')}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-zinc-50 cursor-pointer transition-colors text-left">
                    <i className="ri-file-text-line text-zinc-500 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-xs font-semibold text-zinc-700">Detalhado</p>
                      <p className="text-[10px] text-zinc-400 mt-0.5">1 linha por item (com opções, obs, SLA)</p>
                    </div>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-5">
        {/* Métricas */}
        <PedidosMetricas
          totalPedidos={filtrados.length}
          totalValor={totalValor}
          ticketMedio={ticketMedio}
          emAberto={emAberto}
          entregues={entregues}
          cancelados={cancelados}
          pagos={pagos}
          pendentes={pendentes}
          valorPago={valorPago}
          slaMedio={slaMedio}
          filtrados={filtrados}
        />

        {/* Filtros */}
        <PedidosFiltros
          busca={busca}
          setBusca={setBusca}
          filtroStatus={filtroStatus}
          setFiltroStatus={setFiltroStatus}
          filtroOrigem={filtroOrigem}
          setFiltroOrigem={setFiltroOrigem}
          filtroPlataforma={filtroPlataforma}
          setFiltroPlataforma={setFiltroPlataforma}
          modo={modo}
          modoPeriodo={modoPeriodo}
          setModoPeriodo={setModoPeriodo}
          presetAtivo={presetAtivo}
          setPresetAtivo={setPresetAtivo}
          diaEspecifico={diaEspecifico}
          setDiaEspecifico={setDiaEspecifico}
          periodoInicio={periodoInicio}
          setPeriodoInicio={setPeriodoInicio}
          periodoFim={periodoFim}
          setPeriodoFim={setPeriodoFim}
          mesSelecionado={mesSelecionado}
          setMesSelecionado={setMesSelecionado}
          anoSelecionado={anoSelecionado}
          setAnoSelecionado={setAnoSelecionado}
          anoApenas={anoApenas}
          setAnoApenas={setAnoApenas}
          labelDataAtiva={labelDataAtiva()}
          sessions={sessions}
          loadingSessions={loadingSessions}
          sessaoSelecionadaId={sessaoSelecionadaId}
          setSessaoSelecionadaId={setSessaoSelecionadaId}
        />

        {/* Banner sessão anterior */}
        {modo === 'sessao' && sessaoSelecionadaId && sessaoSelecionada && (
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-100 rounded-xl">
            <div className="w-8 h-8 flex items-center justify-center bg-amber-100 rounded-lg flex-shrink-0">
              <i className="ri-archive-line text-amber-600 text-sm" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold text-amber-800">
                Visualizando sessão encerrada —{' '}
                {new Date(sessaoSelecionada.opened_at).toLocaleDateString('pt-BR', {
                  weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
                })}
              </p>
              <p className="text-[10px] text-amber-600 mt-0.5">
                {sessaoSelecionada.num_pedidos} pedidos · R$ {sessaoSelecionada.faturamento.toFixed(2)} faturados
                {sessaoSelecionada.operador && ` · Operador: ${sessaoSelecionada.operador}`}
              </p>
            </div>
            {loadingSessaoOrders && <i className="ri-loader-4-line animate-spin text-amber-500 flex-shrink-0" />}
            <button
              onClick={() => setSessaoSelecionadaId(null)}
              className="flex items-center gap-1 text-xs font-semibold text-amber-700 hover:text-amber-900 cursor-pointer whitespace-nowrap"
            >
              <i className="ri-close-line" /> Voltar à sessão atual
            </button>
          </div>
        )}

        {/* Lista */}
        <PedidosLista
          pedidos={pedidosAgrupados}
          loading={loadingSessaoOrders}
          onSelectPedido={setPedidoDetalheId}
        />
      </div>

      {pedidoDetalhe && (
        <PedidoDetalheModal pedido={pedidoDetalhe} onClose={() => setPedidoDetalheId(null)} />
      )}
    </div>
  );
}

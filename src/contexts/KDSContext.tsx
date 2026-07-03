import { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { supabase, invokeWithAuth } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { useOrdersPing } from '@/hooks/useOrdersPing';
import { useSessao } from '@/contexts/SessaoContext';
import { useSystemSettings } from '@/hooks/useSystemSettings';
import type { KDSPedido, KDSItem, KDSItemStatus, KDSUnidade, KDSPagamento, KDSSubParte } from '../types/kds';
import type { CarrinhoItem, DestinoInfo } from './PDVContext';

/* ─── DB Row Types ─── */

interface DBOrderItemOption {
  option_id?: string | null;
  group_name: string;
  option_name: string;
  additional_price?: number;
  is_required?: boolean;
}

interface DBOrderItemObservation {
  id?: string;
  text: string;
  is_checked?: boolean;
}

interface DBObsCheck {
  observation_index: number;
  observation_text: string;
  checked_by_name?: string | null;
  checked_at?: string | null;
}

interface DBOrderItemUnit {
  id: string;
  unit_number: number;
  status?: string | null;
  operator_id?: string | null;
  operator_name?: string | null;
  delivered_by_user_id?: string | null;
  delivered_by_name?: string | null;
  entered_kds_at?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
}

interface DBPart {
  id: string;
  name: string;
  station_id?: string | null;
  station_name?: string | null;
  sla_minutes?: number | null;
  sort_order?: number | null;
  status?: string | null;
  operator_id?: string | null;
  operator_name?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
}

interface DBComboChild {
  item_name: string;
  quantity: number;
  unit_price?: number | null;
}

interface DBOrderItem {
  id: string;
  /** Referência ao menu_items.id — necessário para lookup de ficha técnica e baixa de estoque */
  item_id?: string | null;
  item_name: string;
  category_name?: string | null;
  quantity: number;
  item_price?: number | null;
  station_id?: string | null;
  skip_kds?: boolean | null;
  combo_id?: string | null;
  combo_children?: DBComboChild[] | null;
  status?: string | null;
  entered_kds_at?: string | null;
  started_preparing_at?: string | null;
  ready_at?: string | null;
  delivered_at?: string | null;
  operator_name?: string | null;
  delivered_by_name?: string | null;
  notes?: string | null;
  options?: DBOrderItemOption[] | null;
  observations?: DBOrderItemObservation[] | null;
  /** BUG 3.10 HYDRATE FIX: checks persistidos no banco — vindos de order_item_observation_checks */
  obs_checks?: DBObsCheck[] | null;
  units?: DBOrderItemUnit[] | null;
  /** Production parts (multi-station items) */
  parts?: DBPart[] | null;
}

interface DBPayment {
  id: string;
  amount: number;
  change_amount: number;
  is_refunded: boolean;
  payment_method_id?: string | null;
  payment_method_name?: string | null;
  payment_method_type?: string | null;
  operator_name?: string | null;
  cash_register_name?: string | null;
  cash_register_id?: string | null;
  origin_type?: string | null;
  created_at?: string | null;
  payment_group_id?: string | null;
}

interface DBOrder {
  id: string;
  number?: string | null;
  destination_type?: string | null;
  destination_name?: string | null;
  table_number?: number | null;
  customer_name?: string | null;
  waiter_name?: string | null;
  origin_type?: string | null;
  created_at: string;
  total_amount?: number | null;
  is_paid?: boolean | null;
  is_training?: boolean | null;
  status?: string | null;
  cancel_reason?: string | null;
  // BUG 3.8: customer contact fields
  destination_phone?: string | null;
  customer_cpf?: string | null;
  customer_email?: string | null;
  /** Session ID that created this order */
  session_id?: string | null;
  /** Session number (e.g. "S001") — human-readable, populated from fn_get_kds_orders */
  session_number?: string | null;
  /** Whether the order is currently being edited */
  is_editing?: boolean | null;
  editing_by_user_id?: string | null;
  editing_started_at?: string | null;
  /** DB user name of editing user — resolved by fn_get_kds_orders */
  editing_by_name?: string | null;
  /** PDV that registered the payment: 'cashier' | 'waiter' | 'table' | 'self_service' | 'delivery' */
  paid_by_pdv?: string | null;
  /** Table session ID — links orders from the same table */
  table_session_id?: string | null;
  /** Participant ID in table_session_participants */
  participant_id?: string | null;
  /** Participant access_token (senha) from table_session_participants */
  participant_token?: string | null;
  /** Participant name from table_session_participants */
  participant_name?: string | null;
  /** Delivery address */
  delivery_address?: string | null;
  /** Delivery fee */
  delivery_fee?: number | null;
  /** Delivery platform */
  delivery_platform?: string | null;
  /** Order notes */
  notes?: string | null;
  /** BUG-09: Timestamp when delivery order was marked as "Em Rota" */
  out_for_delivery_at?: string | null;
  /** Items array from RPC join */
  items?: DBOrderItem[] | null;
  /** Payments array from RPC join */
  payments?: DBPayment[] | null;
}

interface DBStation {
  id: string;
  name: string;
  sla_minutes?: number | null;
}

/* ─── DB → Frontend mappers ─── */
const DB_STATUS: Record<string, KDSItemStatus> = {
  new: 'novo', preparing: 'preparo', ready: 'pronto', delivered: 'entregue',
};
const DB_DEST: Record<string, KDSPedido['destino']> = {
  immediate: 'hora', table: 'mesa', delivery: 'delivery', name: 'nome', password: 'senha',
  // Mapeamentos em português (valores que podem vir do frontend/edge function)
  hora: 'hora', mesa: 'mesa', nome: 'nome', senha: 'senha',
};
const DB_ORIGIN: Record<string, KDSPedido['origem']> = {
  cashier: 'caixa', waiter: 'garcom', table: 'mesa', self_service: 'autoatendimento',
  delivery: 'delivery',
};

// Station map: station_id → { name, sla_minutes }
type StationMap = Map<string, { name: string; sla: number }>;

function dbItemToKDS(oi: DBOrderItem, stationMap: StationMap): KDSItem {
  const opts = oi.options ?? [];
  const obs = oi.observations ?? [];
  const isSkipKds = !!(oi.skip_kds);
  const rawStatus = DB_STATUS[oi.status ?? ''] ?? 'novo';
  const status: KDSItemStatus = isSkipKds && (rawStatus === 'novo' || rawStatus === 'preparo') ? 'pronto' : rawStatus;
  const entroKdsEm = oi.entered_kds_at ? new Date(oi.entered_kds_at).getTime() : Date.now();

  const stationId = oi.station_id ?? null;
  const stationInfo = stationId ? stationMap.get(stationId) : null;
  const estacaoNome = stationInfo?.name ?? 'Cozinha';
  const slaMinutos = stationInfo?.sla ?? 12;

  // Filtra observações internas (ex: "Pagamento na entrega: X") — essas são metadados
  // extraídos no nível do pedido (paymentMethodName) e não devem aparecer como obs de item
  const rawObsTexts = obs
    .map((o) => o.text)
    .filter((t): t is string => !!t && !/^Pagamento na entrega:/i.test(t));
  const notesText = oi.notes ?? '';
  if (notesText && !rawObsTexts.includes(notesText) && !/^Pagamento na entrega:/i.test(notesText)) {
    rawObsTexts.push(notesText);
  }

  // ── Separar obs específicas de unidade ("Un.1: texto", "Un.2: texto", ...) ──
  // Essas obs são criadas quando o cozinheiro/PDV adiciona obs por unidade.
  // Devem ser exibidas apenas na unidade correspondente, NÃO globalmente.
  const unitObsPattern = /^Un\.?(\d+):\s*(.+)$/i;
  // Mapa: unitNumber → texto da obs
  const unitObsMap = new Map<number, string>();
  const obsTexts: string[] = [];
  for (const t of rawObsTexts) {
    const match = t.match(unitObsPattern);
    if (match) {
      const unitNum = parseInt(match[1], 10);
      const obsText = match[2].trim();
      // Se tiver pipe separando várias unidades na mesma string ("Un.1: x | Un.2: y")
      // já foram splitadas pelo filtro acima — mas caso venha junto:
      if (obsText.includes(' | ')) {
        // tenta parsear multi-unidade em linha única
        const parts = t.split(' | ');
        for (const part of parts) {
          const pm = part.trim().match(unitObsPattern);
          if (pm) unitObsMap.set(parseInt(pm[1], 10), pm[2].trim());
          else if (part.trim()) obsTexts.push(part.trim());
        }
      } else {
        unitObsMap.set(unitNum, obsText);
      }
    } else {
      // Verifica se é uma string com múltiplas unidades concatenadas com " | "
      if (t.includes(' | ') && t.match(/Un\.?\d+:/i)) {
        const parts = t.split(' | ');
        for (const part of parts) {
          const pm = part.trim().match(unitObsPattern);
          if (pm) unitObsMap.set(parseInt(pm[1], 10), pm[2].trim());
          else if (part.trim()) obsTexts.push(part.trim());
        }
      } else {
        obsTexts.push(t);
      }
    }
  }

  // Mapear unidades do banco (order_item_units) com todos os timestamps
  // Isso garante que ao recarregar a página os status individuais são preservados
  const dbUnits = oi.units ?? [];
  let unidades: KDSUnidade[] | undefined;

  if (oi.quantity > 1) {
    if (dbUnits.length > 0) {
      // Banco tem registros de unidades — usar status e timestamps reais
      unidades = Array.from({ length: oi.quantity }, (_, idx) => {
        const unitNum = idx + 1;
        const dbUnit = dbUnits.find((u) => u.unit_number === unitNum);
        if (dbUnit) {
          const uRawStatus = DB_STATUS[dbUnit.status ?? ''] ?? status;
          const uStatus: KDSItemStatus = isSkipKds && (uRawStatus === 'novo' || uRawStatus === 'preparo') ? 'pronto' : uRawStatus;
          return {
            id: `${oi.id}-u${unitNum}`,
            numero: unitNum,
            status: uStatus,
            operadorPreparo: dbUnit.operator_name ?? undefined,
            quemEntregou: dbUnit.delivered_by_name ?? undefined,
            iniciouPreparoEm: dbUnit.started_preparing_at
              ? new Date(dbUnit.started_preparing_at).getTime()
              : undefined,
            ficouProntoEm: dbUnit.ready_at
              ? new Date(dbUnit.ready_at).getTime()
              : undefined,
            entregueEm: dbUnit.delivered_at
              ? new Date(dbUnit.delivered_at).getTime()
              : undefined,
            // Obs específica desta unidade (parseada do formato "Un.N: texto")
            observacao: unitObsMap.get(unitNum),
          } as KDSUnidade;
        }
        // Unidade sem registro no banco ainda — usa status agregado do item
        return {
          id: `${oi.id}-u${unitNum}`,
          numero: unitNum,
          status,
          observacao: unitObsMap.get(unitNum),
        } as KDSUnidade;
      });
    } else {
      // Sem registros no banco — cria unidades com status agregado (merge vai preservar local)
      unidades = Array.from({ length: oi.quantity }, (_, idx) => ({
        id: `${oi.id}-u${idx + 1}`,
        numero: idx + 1,
        status,
        observacao: unitObsMap.get(idx + 1),
      } as KDSUnidade));
    }
  }

  // BUG 3.10 HYDRATE FIX: Hidratar observacoesChecadas a partir dos checks persistidos no banco.
  // Mapeia cada registro de obs_checks para o texto da observação correspondente no array obsTexts.
  // Usa tanto observation_text quanto observation_index como fallback para máxima robustez.
  const obsChecks = oi.obs_checks ?? [];
  const observacoesChecadas: string[] = [];
  if (obsChecks.length > 0) {
    for (const ck of obsChecks) {
      // Tenta resolver pelo texto exato primeiro
      const byText = obsTexts.find((t) => t === ck.observation_text);
      if (byText) {
        if (!observacoesChecadas.includes(byText)) observacoesChecadas.push(byText);
      } else {
        // Fallback: usa o índice no array de obsTexts
        const byIndex = obsTexts[ck.observation_index];
        if (byIndex && !observacoesChecadas.includes(byIndex)) {
          observacoesChecadas.push(byIndex);
        }
      }
    }
  }

  // BUG 3.3 FIX: mapear filhos do combo para renderização indentada no KDS
  const comboChildren = oi.combo_children && oi.combo_children.length > 0
    ? oi.combo_children.map((c) => ({
        nome: c.item_name,
        quantidade: c.quantity,
        unitPrice: c.unit_price ?? undefined,
      }))
    : undefined;

  // Mapear partes de produção (multi-estação) do banco
  const dbParts = oi.parts ?? [];
  const partes: KDSSubParte[] | undefined = dbParts.length > 0
    ? dbParts.map((p) => {
        const pStationName = p.station_name ?? (p.station_id ? stationMap.get(p.station_id)?.name ?? 'Cozinha' : 'Cozinha');
        return {
          id: p.id,
          nome: p.name,
          estacao: pStationName,
          estacaoId: p.station_id ?? undefined,
          slaMinutos: p.sla_minutes ?? 10,
          status: DB_STATUS[p.status ?? ''] ?? 'novo',
          iniciouPreparoEm: p.started_preparing_at
            ? new Date(p.started_preparing_at).getTime()
            : undefined,
          ficouProntoEm: p.ready_at
            ? new Date(p.ready_at).getTime()
            : undefined,
          entregueEm: p.delivered_at
            ? new Date(p.delivered_at).getTime()
            : undefined,
          operadorPreparo: p.operator_name ?? undefined,
        };
      })
    : undefined;

  return {
    id: oi.id,
    menuItemId: oi.item_id ?? undefined,
    nome: oi.item_name,
    categoriaNome: oi.category_name ?? undefined,
    quantidade: oi.quantity,
    item_price: oi.item_price ?? 0,
    estacao: estacaoNome,
    slaMinutos,
    status,
    skip_kds: oi.skip_kds ?? false,
    semPreparo: oi.skip_kds ?? false,
    // BUG 3.3: combo fields
    comboId: oi.combo_id ?? undefined,
    comboChildren,
    // BUG 3.2 FIX: preservar additional_price no mapeamento
    opcoes: opts.map((o) => ({
      grupoNome: o.group_name,
      opcaoNome: o.option_name,
      additional_price: (o as { additional_price?: number }).additional_price ?? 0,
      opcaoId: o.option_id ?? undefined,
      obrigatorio: o.is_required ?? false,
    })),
    observacoes: obsTexts,
    // BUG 3.10 HYDRATE FIX: checks do banco → hidrata estado inicial sem necessitar de interação
    observacoesChecadas: observacoesChecadas.length > 0 ? observacoesChecadas : undefined,
    entroKdsEm,
    iniciouPreparoEm: oi.started_preparing_at ? new Date(oi.started_preparing_at).getTime() : undefined,
    ficouProntoEm: oi.ready_at ? new Date(oi.ready_at).getTime() : undefined,
    entregueEm: oi.delivered_at ? new Date(oi.delivered_at).getTime() : undefined,
    operadorPreparo: oi.operator_name ?? undefined,
    quemEntregou: oi.delivered_by_name ?? undefined,
    unidades,
    partes,
  } as KDSItem & { item_price: number };
}

function dbOrderToKDS(o: DBOrder, stationMap: StationMap): KDSPedido {
  const rawItems = o.items ?? [];
  const itens = rawItems.map((item) => dbItemToKDS(item, stationMap));

  const kitchenItens = itens.filter((i) => !i.semPreparo && !i.skip_kds);

  // Status derivado dos itens (source of truth = items)
  // BUGFIX: Itens skip_kds NÃO devem impedir o pedido de ser "entregue".
  // Apenas itens de cozinha determinam o status do pedido.
  let statusDerived: KDSPedido['status'] = 'novo';

  if (itens.length === 0) {
    statusDerived = 'novo';
  } else if (kitchenItens.length > 0) {
    const kitchenStatuses = kitchenItens.map((i) => i.status);
    if (kitchenStatuses.every((s) => s === 'entregue')) {
      statusDerived = 'entregue';
    } else if (kitchenStatuses.every((s) => s === 'pronto' || s === 'entregue')) {
      statusDerived = 'pronto';
    } else if (kitchenStatuses.some((s) => s === 'preparo' || s === 'pronto')) {
      statusDerived = 'preparo';
    } else {
      statusDerived = 'novo';
    }
  } else {
    // Pedido só tem itens skip_kds (sem preparo)
    if (itens.every((i) => i.status === 'entregue')) {
      statusDerived = 'entregue';
    } else if (itens.every((i) => i.status === 'pronto' || i.status === 'entregue')) {
      statusDerived = 'pronto';
    } else {
      statusDerived = 'novo';
    }
  }

  // Use o status do banco como fallback se for mais avançado que o derivado dos itens.
  // Isso garante que pedidos marcados como 'delivered' no banco apareçam como entregues
  // mesmo que os itens ainda não estejam sincronizados localmente.
  const DB_ORDER_STATUS_MAP: Record<string, KDSPedido['status']> = {
    new: 'novo', preparing: 'preparo', ready: 'pronto', delivered: 'entregue',
  };
  const DB_STATUS_RANK: Record<string, number> = { novo: 0, preparo: 1, pronto: 2, entregue: 3 };
  const dbOrderStatusFrontend: KDSPedido['status'] = DB_ORDER_STATUS_MAP[o.status ?? ''] ?? 'novo';
  let status: KDSPedido['status'] =
    DB_STATUS_RANK[dbOrderStatusFrontend as string] > DB_STATUS_RANK[statusDerived as string]
      ? dbOrderStatusFrontend
      : statusDerived;

  // BUG-09 FIX: Se out_for_delivery_at está preenchido (pedido de delivery foi
  // marcado como "Em Rota" no Gestor), promove o status para em_rota.
  // Isso persiste mesmo após refresh/troca de terminal porque o campo
  // out_for_delivery_at está no banco.
  // Só promove se o pedido não está entregue/cancelado e os itens estão prontos.
  if (o.out_for_delivery_at && status === 'pronto') {
    status = 'em_rota';
  }

  const numeroStr = o.number ?? '';
  const numeroSeq = parseInt(numeroStr.replace(/\D/g, '').slice(-4), 10) || 0;

  const destType = o.destination_type ?? '';
  let mesaNumero: number | undefined;
  let nomeCliente: string | undefined;
  let senha: string | undefined;

  // Defensivo: se destination_type estiver ausente mas destination_name existir,
  // tenta inferir o tipo pelo conteúdo para não perder a identificação do cliente
  let effectiveDestType = destType;
  if (!effectiveDestType && o.destination_name) {
    // Se parece senha (ex: P-10, A-01, 123), trata como senha
    if (/^[A-Z]-\d+$/i.test(o.destination_name.trim()) || /^\d+$/.test(o.destination_name.trim())) {
      effectiveDestType = 'password';
    } else {
      effectiveDestType = 'name';
    }
  }

  if (effectiveDestType === 'table') {
    // BUG 3.6 FIX: sempre usar table_number do banco, nunca parsear string
    if (o.table_number != null) {
      mesaNumero = o.table_number;
    }
    // nomeCliente: usar destination_name se não for apenas "Mesa N"
    const rawDestName = o.destination_name ?? '';
    if (rawDestName && !/^Mesa\s*\d*$/i.test(rawDestName.trim())) {
      nomeCliente = rawDestName;
    }
  } else if (effectiveDestType === 'password') {
    senha = o.destination_name ?? undefined;
    nomeCliente = undefined;
  } else if (effectiveDestType === 'name' || effectiveDestType === 'delivery') {
    nomeCliente = o.destination_name ?? undefined;
  } else {
    nomeCliente = o.destination_name ?? undefined;
  }

  // Mesmo quando o destino não é 'mesa' (ex: senha, nome), se o pedido veio de uma mesa
  // (origin_type = 'table'), captura o table_number para exibição no badge de origem
  if (mesaNumero == null && o.table_number != null && o.origin_type === 'table') {
    mesaNumero = o.table_number;
  }

  const garcomNome = o.waiter_name ?? undefined;

  // Extrai forma de pagamento das observações (pedidos de autoatendimento com "pagar na entrega")
  let paymentMethodName: string | undefined;
  if (o.origin_type === 'self_service') {
    for (const item of rawItems) {
      const obs = item.observations ?? [];
      for (const ob of obs) {
        const match = ob.text?.match(/^Pagamento na entrega:\s*(.+)$/i);
        if (match) { paymentMethodName = match[1].trim(); break; }
      }
      if (paymentMethodName) break;
    }
  }

  // BUG 3.5 FIX: Nunca deixar totalAmount = 0 quando o banco tem valor real.
  const totalAmount = typeof o.total_amount === 'number'
    ? o.total_amount
    : o.total_amount != null ? Number(o.total_amount) : 0;

  // BUG 3.4 FIX: Mapear pagamentos da RPC para exibição no split payment
  const pagamentos: KDSPagamento[] | undefined = o.payments && o.payments.length > 0
    ? o.payments.map((p) => ({
        id: p.id,
        amount: Number(p.amount),
        change_amount: Number(p.change_amount ?? 0),
        is_refunded: !!(p.is_refunded),
        payment_method_id: p.payment_method_id ?? null,
        payment_method_name: p.payment_method_name ?? null,
        payment_method_type: p.payment_method_type ?? null,
        operator_name: p.operator_name ?? null,
        cash_register_id: p.cash_register_id ?? null,
        cash_register_name: p.cash_register_name ?? null,
        origin_type: p.origin_type ?? null,
        // Usa paid_by_pdv do pedido para identificar o canal correto — mais confiável que cash_register_id
        paid_by_pdv: o.paid_by_pdv ?? null,
        created_at: p.created_at ? new Date(p.created_at).getTime() : null,
        payment_group_id: p.payment_group_id ?? null,
      }))
    : undefined;

  return {
    id: o.id,
    numero: numeroSeq,
    numeroStr,
    status,
    destino: DB_DEST[effectiveDestType] ?? 'hora',
    mesaNumero,
    nomeCliente,
    senha,
    garcomNome,
    origem: DB_ORIGIN[o.origin_type ?? ''] ?? 'caixa',
    criadoEm: new Date(o.created_at).getTime(),
    itens,
    totalAmount,
    isPaid: !!(o.is_paid),
    // BUG 2.3: badge TREINO
    isTraining: !!(o.is_training),
    isCancelled: o.status === 'cancelled',
    cancelReason: o.cancel_reason ?? undefined,
    paymentMethodName,
    // BUG 3.4: pagamentos para split payment
    pagamentos,
    // paid_by_pdv do pedido — indica qual PDV registrou o pagamento
    paid_by_pdv: o.paid_by_pdv ?? null,
    // BUG 3.8: customer contact fields
    customerPhone: o.destination_phone ?? undefined,
    customerCpf: o.customer_cpf ?? undefined,
    customerEmail: o.customer_email ?? undefined,
    session_id: o.session_id ?? undefined,
    session_number: o.session_number ?? undefined,
    /** Table session ID — links orders from the same table */
    table_session_id: o.table_session_id ?? null,
    /** Participant info (senha / nome) from table_session_participants */
    participantToken: o.participant_token ?? null,
    participantName: o.participant_name ?? null,
    // Delivery fields
    deliveryAddress: o.delivery_address ?? undefined,
    deliveryFee: o.delivery_fee ?? undefined,
    deliveryPlatform: o.delivery_platform ?? undefined,
    notes: o.notes ?? undefined,
    // Order edit lock fields — propagated via Realtime to all PDVs/KDS/Gestor
    isEditing: !!(o.is_editing),
    editingByUserId: o.editing_by_user_id ?? null,
    editingStartedAt: o.editing_started_at ? new Date(o.editing_started_at).getTime() : undefined,
    editingByName: o.editing_by_name ?? undefined,
  } as KDSPedido & { totalAmount: number; isPaid: boolean; isCancelled: boolean; cancelReason?: string };
}

/* ─── Helpers públicos para construção de pedido KDS (usado pelo PDV mock/offline) ─── */
function inferEstacao(nome: string): string {
  const n = nome.toLowerCase();
  if (n.includes('batata') || n.includes('frita') || n.includes('crispy') || n.includes('onion')) return 'Frituras';
  if (n.includes('refrigerante') || n.includes('água') || n.includes('agua') || n.includes('suco de açaí')) return 'Balcão';
  if (n.includes('brownie') || n.includes('sorvete') || n.includes('açaí')) return 'Confeitaria';
  if (n.includes('suco') || n.includes('shake') || n.includes('vitamina')) return 'Balcão';
  return 'Grelha';
}

function inferSLA(nome: string): number {
  const n = nome.toLowerCase();
  if (n.includes('refrigerante') || n.includes('água') || n.includes('agua')) return 2;
  if (n.includes('suco') || n.includes('shake')) return 5;
  if (n.includes('batata') || n.includes('frita')) return 10;
  if (n.includes('brownie') || n.includes('sorvete')) return 8;
  return 12;
}

function gerarNumeroStr(seq: number): string {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, '0');
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const aa = String(now.getFullYear()).slice(2);
  return `P${dd}${mm}${aa}${String(seq).padStart(4, '0')}`;
}

export function buildKDSPedido(params: {
  cart: CarrinhoItem[];
  destino: DestinoInfo | null;
  numeroSeq: number;
  numeroStr?: string;
  origem: KDSPedido['origem'];
  garcomNome?: string;
  /** Station map para resolver UUID → nome de estação (opcional) */
  stationMap?: StationMap;
}): KDSPedido {
  const { cart, destino, numeroSeq, numeroStr, origem, garcomNome, stationMap } = params;
  const nowTs = Date.now();
  let pedidoDestino: KDSPedido['destino'] = 'hora';
  let mesaNumero: number | undefined;
  let nomeCliente: string | undefined;
  let senha: string | undefined;
  if (destino) {
    if (destino.tipo === 'mesa') { pedidoDestino = 'mesa'; mesaNumero = destino.mesaNumero; }
    else if (destino.tipo === 'nome') { pedidoDestino = 'nome'; nomeCliente = destino.nomeCliente; }
    else if (destino.tipo === 'senha') { pedidoDestino = 'senha'; senha = destino.senha; }
    else if (destino.tipo === 'delivery') { pedidoDestino = 'delivery'; nomeCliente = destino.nomeCliente; }
  }
  const finalNumeroStr = numeroStr ?? gerarNumeroStr(numeroSeq);
  return {
    id: `kds-${origem}-${nowTs}`,
    numero: numeroSeq,
    numeroStr: finalNumeroStr,
    status: 'novo',
    destino: pedidoDestino,
    mesaNumero, nomeCliente, senha, origem, garcomNome,
    criadoEm: nowTs,
    totalAmount: 0,
    isPaid: false,
    isCancelled: false,
    itens: cart.map((ci, i) => {
      // Resolve o nome da estação: se stationMap existir e stationId for UUID, resolve pelo nome
      let estacaoNome: string;
      if (ci.stationId && stationMap) {
        const resolved = stationMap.get(ci.stationId);
        estacaoNome = resolved?.name ?? ci.stationId;
      } else if (ci.stationId) {
        estacaoNome = ci.stationId;
      } else {
        estacaoNome = inferEstacao(ci.nome);
      }
      return {
        id: `ki-${origem}-${nowTs}-${i}`,
        nome: ci.nome,
        categoriaNome: ci.categoriaNome,
        quantidade: ci.quantidade,
        estacao: estacaoNome,
        slaMinutos: inferSLA(ci.nome),
        status: 'novo' as KDSItemStatus,
        skip_kds: ci.semPreparo ?? false,
        semPreparo: ci.semPreparo ?? false,
        opcoes: ci.opcoes.map((o) => ({ grupoNome: o.grupoNome, opcaoNome: o.opcaoNome, opcaoId: o.opcaoId, obrigatorio: o.obrigatorio })),
        observacoes: [...(ci.observacoes ?? []), ...(ci.observacaoLivre ? [ci.observacaoLivre] : [])],
        entroKdsEm: nowTs,
      };
    }),
  };
}

/* ─── Context ─── */
interface KDSContextValue {
  pedidos: KDSPedido[];
  loading: boolean;
  addPedido: (pedido: KDSPedido) => void;
  setPedidos: React.Dispatch<React.SetStateAction<KDSPedido[]>>;
  updateItemStatusRemote: (orderItemId: string, orderId: string, newStatus: KDSItemStatus) => Promise<void>;
  /** Atualiza status de uma unidade individual — persiste delivered_by_user_id no banco */
  updateUnitStatusRemote: (orderItemId: string, orderId: string, unitNumber: number, newStatus: KDSItemStatus) => Promise<void>;
  /** Atualiza status de uma parte de produção (multi-estação) — persiste no banco e recalcula status do item */
  updatePartStatusRemote: (orderItemPartId: string, orderItemId: string, orderId: string, newStatus: KDSItemStatus) => Promise<void>;
  /** Cancela um pedido no backend — motivo opcional */
  cancelOrderRemote: (orderId: string, reason?: string) => Promise<{ ok: boolean; error?: string }>;
  /** BUG-38: Marca pedido de delivery como "Em Rota" com retry + queue (padrao BUG-35) */
  markOutForDeliveryRemote: (orderId: string) => Promise<void>;
  /**
   * BUG 3.10 FIX: Persiste a checagem de observação no banco (order_item_observation_checks).
   * Chamado pelo KDSPage após o toggle optimista local.
   */
  toggleObsChecadaRemote: (orderItemId: string, obsText: string, obsIndex: number, checked: boolean, checkedByName?: string) => Promise<void>;
  /** Inicia edição de pedido — bloqueia KDS/Gestor via Realtime */
  startOrderEditRemote: (orderId: string) => Promise<{ ok: boolean; lockedBy?: string; error?: string }>;
  /** Finaliza edição de pedido — libera KDS/Gestor via Realtime */
  finishOrderEditRemote: (orderId: string, wasModified?: boolean, modificationsSummary?: string) => Promise<{ ok: boolean; error?: string }>;
  reloadOrders: () => Promise<void>;
  /** Mapa de estações para resolver UUID → nome (usado por buildKDSPedido) */
  stationMap: StationMap;
  /** Lista de pedidos que estão em salvamento (persiste até o pedido reaparecer no loadOrders) */
  pedidosSalvando: Array<{ id: string; numero: number; numeroStr: string; destino: KDSPedido['destino']; mesaNumero?: number; nomeCliente?: string; senha?: string }>;
  /** BUG-35: Número de atualizações de status pendentes na fila de retry */
  pendingStatusCount: number;
  /** BUG-35: Força retentativa imediata de todos os itens na fila pendente */
  flushPendingStatusQueue: () => Promise<void>;
}

const KDSContext = createContext<KDSContextValue | null>(null);

export function KDSProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { sessao, loadingSession } = useSessao();
  const { settings: sysSettings } = useSystemSettings();
  const defaultPrepTime = sysSettings.default_prep_time ?? 12;
  const [pedidos, setPedidos] = useState<KDSPedido[]>([]);
  const [loading, setLoading] = useState(true);
  const [stationMap, setStationMap] = useState<StationMap>(new Map());
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const consecutiveErrorsRef = useRef(0);
  const MAX_CONSECUTIVE_ERRORS = 5;
  const realtimeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stationMapRef = useRef<StationMap>(new Map());
  const stationsLoadedRef = useRef(false);

  // ── Estado separado para pedidos em salvamento — persiste até o pedido reaparecer no loadOrders
  const pedidosSalvandoRef = useRef<Set<string>>(new Set());
  const [pedidosSalvando, setPedidosSalvando] = useState<Array<{ id: string; numero: number; numeroStr: string; destino: KDSPedido['destino']; mesaNumero?: number; nomeCliente?: string; senha?: string }>>([]);

  // ── BUG-35: Fila de retry para atualizações de status com falha ──
  // Persiste em sessionStorage para sobreviver a reloads da página.
  // Itens na fila são retentados automaticamente via polling e evento online.
  interface PendingStatusUpdate {
    id: string;
    type: 'item' | 'unit' | 'part' | 'out_for_delivery';
    tenantId: string;
    orderItemId: string;
    orderId: string;
    newStatus: KDSItemStatus;
    unitNumber?: number;
    partId?: string;
    timestamp: number;
    retryCount: number;
  }

  const MAX_STATUS_RETRIES = 3;
  const STATUS_RETRY_BASE_DELAY = 500;
  const pendingStatusQueueRef = useRef<PendingStatusUpdate[]>([]);
  // Anti-flicker: timestamp do último set local de status, por item ('i:'+id) e
  // pedido ('o:'+id). Protege contra snapshots atrasados (poll/realtime em voo) que
  // chegam DEPOIS do flush limpar a fila e reverteriam o status pronto→preparo.
  const recentStatusRef = useRef<Map<string, number>>(new Map());
  const [pendingStatusCount, setPendingStatusCount] = useState(0);
  const pendingFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingFlushLockRef = useRef(false);

  // Carrega fila do sessionStorage ao montar (sobrevive a reload)
  useEffect(() => {
    try {
      const tid = user?.tenantId ?? tenantIdRef.current;
      if (!tid) return;
      const key = `kds_pending_status_${tid}`;
      const stored = sessionStorage.getItem(key);
      if (stored) {
        const parsed: PendingStatusUpdate[] = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed.length > 0) {
          pendingStatusQueueRef.current = parsed;
          setPendingStatusCount(parsed.length);
        }
      }
    } catch { /* ignore parse errors */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId]);

  /** Persiste a fila no sessionStorage */
  const persistStatusQueue = useCallback(() => {
    try {
      const tid = user?.tenantId ?? tenantIdRef.current;
      if (!tid) return;
      const key = `kds_pending_status_${tid}`;
      if (pendingStatusQueueRef.current.length === 0) {
        sessionStorage.removeItem(key);
      } else {
        sessionStorage.setItem(key, JSON.stringify(pendingStatusQueueRef.current));
      }
    } catch { /* ignore */ }
  }, [user?.tenantId]);

  /** Detecta erro de rede */
  const isKdsNetworkError = useCallback((err: unknown): boolean => {
    if (!(err instanceof Error)) return !navigator.onLine;
    const msg = err.message.toLowerCase();
    return (
      msg.includes('fetch') ||
      msg.includes('network') ||
      msg.includes('failed to fetch') ||
      msg.includes('load failed') ||
      msg.includes('networkerror') ||
      msg.includes('offline') ||
      msg.includes('timeout') ||
      msg.includes('abort') ||
      !navigator.onLine
    );
  }, []);

  /** Adiciona item à fila pendente e persiste */
  const enqueuePendingStatus = useCallback((update: PendingStatusUpdate) => {
    const exists = pendingStatusQueueRef.current.some(
      (u) => u.orderItemId === update.orderItemId
        && u.orderId === update.orderId && u.newStatus === update.newStatus,
    );
    if (!exists) {
      pendingStatusQueueRef.current.push(update);
      setPendingStatusCount(pendingStatusQueueRef.current.length);
      persistStatusQueue();
    }
  }, [persistStatusQueue]);

  /** Remove item da fila (quando sucesso no retry) */
  const dequeuePendingStatus = useCallback((updateId: string) => {
    pendingStatusQueueRef.current = pendingStatusQueueRef.current.filter((u) => u.id !== updateId);
    setPendingStatusCount(pendingStatusQueueRef.current.length);
    persistStatusQueue();
  }, [persistStatusQueue]);

  /** Flush da fila pendente: retenta cada item */
  const flushPendingStatusQueue = useCallback(async () => {
    if (pendingFlushLockRef.current) return;
    if (pendingStatusQueueRef.current.length === 0) return;
    if (!navigator.onLine) return;

    pendingFlushLockRef.current = true;
    try {
      const queue = [...pendingStatusQueueRef.current];
      for (const update of queue) {
        if (!pendingStatusQueueRef.current.some((u) => u.id === update.id)) continue;

        let success = false;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const body: Record<string, unknown> = {
              order_item_id: update.orderItemId,
              order_id: update.orderId,
              tenant_id: update.tenantId,
              status: update.newStatus,
            };
            if (update.type === 'item') {
              body.action = 'update_order_item_status';
            } else if (update.type === 'unit') {
              body.action = 'update_unit_status';
              body.unit_number = update.unitNumber!;
            } else if (update.type === 'out_for_delivery') {
              body.action = 'mark_out_for_delivery';
              body.order_id = update.orderId;
              delete body.order_item_id;
              delete body.status;
              delete body.unit_number;
            } else {
              body.action = 'update_order_item_part_status';
              body.order_item_part_id = update.partId!;
              body.new_status = update.newStatus;
            }
            const { error } = await invokeWithAuth('order-write', { body });
            if (!error) { success = true; break; }
            if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * attempt));
          } catch {
            if (attempt < 2) await new Promise((r) => setTimeout(r, 400 * attempt));
          }
        }

        if (success) {
          dequeuePendingStatus(update.id);
        }
        await new Promise((r) => setTimeout(r, 150));
      }
    } catch {
      /* non-critical */
    } finally {
      pendingFlushLockRef.current = false;
    }
  }, [dequeuePendingStatus]);

  // Flush automático: ao detectar que voltou online
  useEffect(() => {
    const handleOnline = () => { flushPendingStatusQueue(); };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [flushPendingStatusQueue]);

  // Polling da fila a cada 30s
  useEffect(() => {
    pendingFlushTimerRef.current = setInterval(() => {
      flushPendingStatusQueue();
    }, 30000);
    return () => {
      if (pendingFlushTimerRef.current) {
        clearInterval(pendingFlushTimerRef.current);
        pendingFlushTimerRef.current = null;
      }
    };
  }, [flushPendingStatusQueue]);

  const tenantIdRef = useRef<string | undefined>(undefined);
  // undefined = sessão ainda não resolvida | null = sem sessão | string = sessão ativa
  const sessaoIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (user?.tenantId) {
      tenantIdRef.current = user.tenantId;
    }
  }, [user?.tenantId]);

  // ── Sincroniza sessaoIdRef quando SessaoContext termina de carregar ────────
  useEffect(() => {
    if (loadingSession) return; // ainda carregando — aguarda

    const prevSessionId = sessaoIdRef.current;
    const newSessionId = sessao?.id ?? null;
    sessaoIdRef.current = newSessionId;

    // Sessão mudou após resolução: limpa e recarrega
    // BUG FIX: removida verificação prevSessionId !== undefined que impedia
    // limpeza na primeira sessão — pedidos antigos de sessão=null ficavam presos
    if (prevSessionId !== newSessionId) {
      setPedidos([]);
      loadOrders();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessao?.id, loadingSession]);

  const loadOrders = useCallback(async (currentStationMap?: StationMap) => {
    if (!user?.tenantId) { setLoading(false); return; }
    // Bloqueia se sessão ainda não foi resolvida pelo SessaoContext
    if (sessaoIdRef.current === undefined) { setLoading(false); return; }
    try {
      const currentSessionId = sessaoIdRef.current ?? null;
      const { data, error } = await supabase.rpc('fn_get_kds_orders', {
        p_tenant_id: user.tenantId,
        p_session_id: currentSessionId,
      });
      if (error) throw error;

      consecutiveErrorsRef.current = 0;

      const mapToUse = currentStationMap ?? stationMapRef.current;
      const orders: KDSPedido[] = (data as DBOrder[] ?? []).map(
        (o) => dbOrderToKDS(o, mapToUse)
      );

      const withUnidades = orders;
      const STATUS_ORDER: KDSItemStatus[] = ['novo', 'preparo', 'pronto', 'entregue'];
      const statusRank = (s: KDSItemStatus) => STATUS_ORDER.indexOf(s);

      setPedidos((prevPedidos) => {
        const nowMs = Date.now();
        // Set local nos últimos 15s protege contra downgrade por snapshot atrasado.
        const isRecent = (key: string): boolean => {
          const t = recentStatusRef.current.get(key);
          if (t == null) return false;
          if (nowMs - t < 15000) return true;
          recentStatusRef.current.delete(key);
          return false;
        };
        const prevMap = new Map(prevPedidos.map((p) => [p.id, p]));
        return withUnidades.map((newPedido) => {
          const prev = prevMap.get(newPedido.id);
          if (!prev) return newPedido;

          const prevItemMap = new Map(prev.itens.map((i) => [i.id, i]));
          const mergedItens = newPedido.itens.map((newItem) => {
            const prevItem = prevItemMap.get(newItem.id);
            if (!prevItem) return newItem;

            const iniciouPreparoEm = newItem.iniciouPreparoEm ?? prevItem.iniciouPreparoEm;
            const ficouProntoEm = newItem.ficouProntoEm ?? prevItem.ficouProntoEm;
            const entregueEm = newItem.entregueEm ?? prevItem.entregueEm;

            const mergedUnidades = (() => {
              if (!newItem.unidades || newItem.unidades.length === 0) {
                return prevItem.unidades;
              }
              return newItem.unidades.map((u) => {
                const prevU = prevItem.unidades?.find((pu) => pu.id === u.id);
                if (!prevU) return u;
                const uStatus: KDSItemStatus =
                  statusRank(prevU.status) > statusRank(u.status) && (pendingStatusQueueRef.current.some((q) => q.orderItemId === newItem.id) || isRecent('i:' + newItem.id))
                    ? prevU.status  // BUG-36/flicker: preserva se há gravação pendente OU set recente
                    : u.status;
                return {
                  ...u,
                  status: uStatus,
                  operadorPreparo: u.operadorPreparo ?? prevU.operadorPreparo,
                  iniciouPreparoEm: u.iniciouPreparoEm ?? prevU.iniciouPreparoEm,
                  ficouProntoEm: u.ficouProntoEm ?? prevU.ficouProntoEm,
                  entregueEm: u.entregueEm ?? prevU.entregueEm,
                  // Preserva obs específica da unidade vinda do banco (novo > prev)
                  observacao: u.observacao ?? prevU.observacao,
                };
              });
            })();

            // BUGFIX MULTI-ESTACAO: Mesclar partes de producao entre prev e new,
            // preservando o status otimista local. Sem esse merge, quando o Realtime
            // dispara loadOrders antes do backend persistir a atualizacao da parte,
            // TODAS as partes voltam ao status antigo (ex: ao clicar Iniciar em uma
            // parte especifica, todas as partes do item sao resetadas para novo).
            const mergedPartes = (() => {
              if (!newItem.partes || newItem.partes.length === 0) {
                return prevItem.partes;
              }
              if (!prevItem.partes || prevItem.partes.length === 0) {
                return newItem.partes;
              }
              return newItem.partes.map((newPart) => {
                const prevPart = prevItem.partes!.find((pp) => pp.id === newPart.id);
                if (!prevPart) return newPart;
                const partStatus: KDSItemStatus =
                  statusRank(prevPart.status) > statusRank(newPart.status) && (pendingStatusQueueRef.current.some((q) => q.orderItemId === newItem.id) || isRecent('i:' + newItem.id))
                    ? prevPart.status  // BUG-36/flicker: preserva se há gravação pendente OU set recente
                    : newPart.status;
                return {
                  ...newPart,
                  status: partStatus,
                  iniciouPreparoEm: newPart.iniciouPreparoEm ?? prevPart.iniciouPreparoEm,
                  ficouProntoEm: newPart.ficouProntoEm ?? prevPart.ficouProntoEm,
                  entregueEm: newPart.entregueEm ?? prevPart.entregueEm,
                  operadorPreparo: newPart.operadorPreparo ?? prevPart.operadorPreparo,
                };
              });
            })();

            let effectiveStatus: KDSItemStatus;
            if (mergedUnidades && mergedUnidades.length > 0) {
              const uStatuses = mergedUnidades.map((u) => u.status);
              if (uStatuses.every((s) => s === 'entregue')) effectiveStatus = 'entregue';
              else if (uStatuses.every((s) => s === 'pronto' || s === 'entregue')) effectiveStatus = 'pronto';
              else if (uStatuses.some((s) => s === 'preparo' || s === 'pronto')) effectiveStatus = 'preparo';
              else effectiveStatus = 'novo';
            } else {
              effectiveStatus =
                statusRank(prevItem.status) > statusRank(newItem.status) && (pendingStatusQueueRef.current.some((u) => u.orderItemId === newItem.id) || isRecent('i:' + newItem.id))
                  ? prevItem.status  // BUG-36/flicker: preserva se há gravação pendente OU set recente
                  : newItem.status;
            }

            // BUG 3.10 HYDRATE FIX: Mesclar observacoesChecadas.
            // Se o banco retornou checks (newItem.observacoesChecadas), usar como base.
            // Se o usuário checou algo localmente (prevItem.observacoesChecadas) que
            // ainda não chegou ao banco via Realtime, incluir também (união dos dois sets).
            const dbChecks = newItem.observacoesChecadas ?? [];
            const localChecks = prevItem.observacoesChecadas ?? [];
            const mergedChecks = dbChecks.length > 0 || localChecks.length > 0
              ? [...new Set([...dbChecks, ...localChecks])]
              : undefined;

            return {
              ...newItem,
              status: effectiveStatus,
              iniciouPreparoEm,
              ficouProntoEm,
              entregueEm,
              operadorPreparo: newItem.operadorPreparo ?? prevItem.operadorPreparo,
              observacoesChecadas: mergedChecks,
              observacaoLivre: prevItem.observacaoLivre,
              unidades: mergedUnidades,
              partes: mergedPartes,
            };
          });

          const kitchenItens = mergedItens.filter((i) => !i.semPreparo && !i.skip_kds);
          let mergedPedidoStatus: KDSPedido['status'] = 'novo';
          if (mergedItens.length === 0) {
            mergedPedidoStatus = 'novo';
          } else if (kitchenItens.length > 0) {
            const kStatuses = kitchenItens.map((i) => i.status);
            if (kStatuses.every((s) => s === 'entregue')) {
              mergedPedidoStatus = 'entregue';
            } else if (kStatuses.every((s) => s === 'pronto' || s === 'entregue')) {
              mergedPedidoStatus = 'pronto';
            } else if (kStatuses.some((s) => s === 'preparo' || s === 'pronto')) {
              mergedPedidoStatus = 'preparo';
            }
          } else {
            // Só itens skip_kds
            if (mergedItens.every((i) => i.status === 'entregue')) {
              mergedPedidoStatus = 'entregue';
            } else if (mergedItens.every((i) => i.status === 'pronto' || i.status === 'entregue')) {
              mergedPedidoStatus = 'pronto';
            }
          }

          // Nunca regredir o status do pedido — preserva o mais avançado entre local e banco
          const DB_STATUS_RANK2: Record<string, number> = { novo: 0, preparo: 1, pronto: 2, entregue: 3, em_rota: 2 };
          const prevRank = DB_STATUS_RANK2[prev.status as string] ?? 0;
          const mergedRank = DB_STATUS_RANK2[mergedPedidoStatus as string] ?? 0;

          // BUGFIX: Se o banco retornou o pedido como 'entregue' (newPedido.status === 'entregue'),
          // respeitar sempre o status do banco — o banco é source of truth para status final.
          // Isso evita que o status local 'entregue' seja revertido para 'pronto' por race condition
          // quando o Realtime chega antes do banco confirmar todos os itens skip_kds como delivered.
          const bankSaysDelivered = newPedido.status === 'entregue';

          // BUG-09 FIX: Se o banco retornou out_for_delivery_at (newPedido.status === 'em_rota'
          // via dbOrderToKDS), promover para em_rota mesmo que o estado local ainda não tenha isso.
          // Isso garante que ao recarregar a pagina o pedido ja aparece como Em Rota.
          const bankSaysOnRoute = newPedido.status === 'em_rota';

          // BUG-39 FIX: Race condition ao marcar "Entregue" com múltiplos itens.
          // Quando handleEntregar dispara updateItemStatusRemote para cada item em paralelo,
          // o Realtime do PRIMEIRO item que persiste no banco já dispara loadOrders().
          // Nesse momento os outros itens ainda estão "ready/pronto" no banco, então
          // mergedPedidoStatus = 'pronto' e o pedido regride de 'entregue' para 'pronto'
          // por ~1-2 segundos até o restante dos itens também serem persistidos.
          // Correção: se TODOS os itens locais estão 'entregue' (acabamos de clicar "Entregar")
          // e o merge só deu 'pronto' por item parcial no banco, preserva 'entregue'.
          const allLocalItemsEntregue = prev.status === 'entregue' && prev.itens.length > 0 && prev.itens.every((i) => i.status === 'entregue');

          const finalStatus: KDSPedido['status'] =
            bankSaysDelivered
              ? 'entregue'  // banco diz entregue → sempre entregue, sem regressao
              : prev.status === 'em_rota' && mergedPedidoStatus !== 'entregue'
                ? 'em_rota'
                : bankSaysOnRoute && mergedPedidoStatus !== 'entregue'
                  ? 'em_rota'  // BUG-09: banco diz em_rota (out_for_delivery_at) → promove
                  : allLocalItemsEntregue && mergedPedidoStatus !== 'entregue'
                    ? 'entregue'  // BUG-39: todos os itens locais entregues → preserva durante race condition do Realtime
                    : prevRank > mergedRank && (pendingStatusQueueRef.current.some((u) => u.orderId === newPedido.id) || isRecent('o:' + newPedido.id))
                      ? prev.status  // BUG-36/flicker: preserva status local se há gravação pendente OU set recente
                      : mergedPedidoStatus;

          // Merge editing lock state: preserve local optimistic state if remote hasn't caught up,
          // or use remote if another client locked it
          const isEditing = newPedido.isEditing || prev.isEditing;
          const editingByUserId = newPedido.isEditing ? newPedido.editingByUserId : (isEditing ? prev.editingByUserId : null);
          const editingByName = newPedido.isEditing ? newPedido.editingByName : (isEditing ? prev.editingByName : undefined);
          const editingStartedAt = newPedido.isEditing ? newPedido.editingStartedAt : (isEditing ? prev.editingStartedAt : undefined);

          // Se o pedido estava na lista de salvamento e reapareceu nos dados, limpa isSaving
          const reapareceu = pedidosSalvandoRef.current.has(newPedido.id);
          if (reapareceu) {
            pedidosSalvandoRef.current.delete(newPedido.id);
          }

          return {
            ...newPedido,
            itens: mergedItens,
            status: finalStatus,
            isEditing,
            editingByUserId,
            editingByName,
            editingStartedAt,
            isSaving: reapareceu ? false : prev.isSaving,
          };
        });
      });

      // Sincroniza pedidosSalvando: remove os que reapareceram nos dados
      const idsNosDados = new Set(orders.map((o) => o.id));
      const idsParaRemover = Array.from(pedidosSalvandoRef.current).filter((id) => idsNosDados.has(id));
      if (idsParaRemover.length > 0) {
        idsParaRemover.forEach((id) => pedidosSalvandoRef.current.delete(id));
        setPedidosSalvando((prev) => prev.filter((p) => !idsParaRemover.includes(p.id)));
      }
    } catch (e) {
      consecutiveErrorsRef.current += 1;
      const errorMessage = (e as Error)?.message ?? String(e);
      const isNetworkError =
        errorMessage.toLowerCase().includes('failed to fetch') ||
        errorMessage.toLowerCase().includes('network') ||
        errorMessage.toLowerCase().includes('fetch') ||
        errorMessage.toLowerCase().includes('offline') ||
        errorMessage.toLowerCase().includes('abort') ||
        errorMessage.toLowerCase().includes('timeout');
      if (!isNetworkError && consecutiveErrorsRef.current <= MAX_CONSECUTIVE_ERRORS) {
        console.error('[KDSContext] loadOrders error:', JSON.stringify({
          message: errorMessage,
        }));
      }
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId]);

  // BUG 2.6 FIX: Leading + trailing debounce.
  // Executa imediatamente na primeira chamada e reagenda se novos eventos chegam
  // durante o cooldown, garantindo que o último update também seja processado.
  // ── EDIT LOCK FIX: Agora aceita o payload do Realtime para aplicar mudanças
  // de is_editing instantaneamente no estado local de TODOS os dispositivos.
  const realtimeLeadingFiredRef = useRef(false);
  // Pula o 1o SUBSCRIBED (mount já fez o load); recargas só em RECONEXÕES seguintes.
  const kdsSubscribedOnceRef = useRef(false);

  /** Payload shape vindo do Supabase Realtime postgres_changes */
  interface RealtimePayload {
    eventType: string;
    new: Record<string, unknown>;
    old: Record<string, unknown>;
    schema: string;
    table: string;
  }

  const handleRealtimeChange = useCallback((payload?: RealtimePayload) => {
    if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_ERRORS) return;

    // ── EDIT LOCK FIX: Aplicar mudanças de is_editing instantaneamente ──
    // Quando a edge function order-edit-lock atualiza is_editing no banco,
    // o Realtime entrega o payload com o novo valor. Aplicamos direto no
    // estado local para bloqueio imediato em TODOS os dispositivos.
    if (payload && payload.table === 'orders' && payload.eventType === 'UPDATE') {
      const newRecord = payload.new;
      const oldRecord = payload.old;
      const orderId = newRecord.id as string | undefined;

      if (orderId && typeof newRecord.is_editing === 'boolean') {
        const isEditingNow = newRecord.is_editing === true;
        const wasEditing = oldRecord.is_editing === true;

        // Só atualiza se o valor realmente mudou
        if (isEditingNow !== wasEditing) {
          if (isEditingNow) {
            // Lock ativado: busca o nome do usuário que está editando
            const editingUserId = newRecord.editing_by_user_id as string | undefined;
            setPedidos((prev) =>
              prev.map((p) => {
                if (p.id !== orderId) return p;
                // Se já temos o nome localmente (otimista), preserva
                const existingName = p.editingByName;
                return {
                  ...p,
                  isEditing: true,
                  editingByUserId: editingUserId ?? p.editingByUserId ?? null,
                  editingByName: existingName ?? (editingUserId ? 'Outro usuário' : undefined),
                  editingStartedAt: p.editingStartedAt ?? Date.now(),
                };
              }),
            );
            console.info('[KDSContext] Realtime lock applied for order:', orderId, 'by:', editingUserId);
          } else {
            // Lock liberado
            setPedidos((prev) =>
              prev.map((p) =>
                p.id === orderId
                  ? { ...p, isEditing: false, editingByUserId: null, editingByName: undefined, editingStartedAt: undefined }
                  : p,
              ),
            );
            console.info('[KDSContext] Realtime lock released for order:', orderId);
          }
        }
      }
    }

    // ── Debounce do RPC completo (fallback para consistência) ──
    // Leading edge: executa imediatamente se não há debounce ativo
    if (!realtimeLeadingFiredRef.current) {
      realtimeLeadingFiredRef.current = true;
      loadOrders();
    }

    // Trailing edge: reagenda com debounce reduzido para capturar o último evento
    if (realtimeDebounceRef.current) {
      clearTimeout(realtimeDebounceRef.current);
    }
    realtimeDebounceRef.current = setTimeout(() => {
      realtimeLeadingFiredRef.current = false;
      loadOrders();
    }, 40);
  }, [loadOrders]);

  // ── Ping instantâneo via trigger no banco (canal público orders-ping) ─────
  // Caminho principal de "pedido novo apareceu": não passa por RLS por linha
  // nem pela publicação — mesmo mecanismo que deixou a impressão instantânea.
  // O postgres_changes acima continua como camada de payload (lock de edição).
  useOrdersPing(user?.tenantId, () => handleRealtimeChange());

  // ── Efeito 1: carrega estações quando o tenant muda ───────────────────────
  useEffect(() => {
    if (!user?.tenantId) { setLoading(false); return; }
    const tenantId = user.tenantId;

    consecutiveErrorsRef.current = 0;
    stationsLoadedRef.current = false;
    // Reseta sessão como "não resolvida" ao trocar de tenant
    sessaoIdRef.current = undefined;

    supabase
      .rpc('fn_get_kitchen_stations', { p_tenant_id: tenantId })
      .then(({ data: stData }) => {
        const map = new Map<string, { name: string; sla: number }>();
        (stData ?? []).forEach((s: DBStation) => {
          map.set(s.id, { name: s.name, sla: s.sla_minutes ?? defaultPrepTime });
        });
        stationMapRef.current = map;
        setStationMap(map);
        stationsLoadedRef.current = true;
        // ── KDS FIX: Recarrega pedidos com o stationMap correto assim que estações são carregadas ──
        // Isso garante que os pedidos tenham o nome da estação correto (não o fallback 'Cozinha')
        if (sessaoIdRef.current !== undefined) {
          loadOrders(map);
        }
      })
      .catch((e) => {
        console.error('[KDSContext] loadStations error:', (e as Error)?.message);
        stationsLoadedRef.current = true; // continua mesmo sem estações
      });

    // Realtime channel
    // BUG 2.5 FIX: Adicionar subscriptions em payments e order_discounts
    // para que mudanças de pagamento e desconto propaguem em tempo real.
    // SYNC FIX: Filtrar por tenant_id para garantir que mudanças de unidades
    // entregues em qualquer PDV/KDS/Gestão propagam imediatamente para todos.
    const channel = supabase
      .channel(`kds-orders-${tenantId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_items', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_units', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_parts', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_discounts', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_observation_checks', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'order_item_observations', filter: `tenant_id=eq.${tenantId}` }, handleRealtimeChange)
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          if (!kdsSubscribedOnceRef.current) {
            // 1ª assinatura: o load inicial já rodou no mount, não recarrega de novo.
            kdsSubscribedOnceRef.current = true;
            console.info('[KDSContext] Realtime channel subscribed — all order tables active');
          } else {
            // RECONEXÃO: o Realtime não tem replay — recarrega 1x p/ cobrir o buraco
            // (eventos perdidos durante a queda da internet). Substitui o poll de 30s.
            console.info('[KDSContext] Realtime reconectado — re-sincronizando pedidos');
            if (consecutiveErrorsRef.current < MAX_CONSECUTIVE_ERRORS) loadOrders();
          }
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          console.warn('[KDSContext] Realtime channel error, status:', status);
        }
      });

    // CAMADA 2: Canal de Broadcast para propagação instantânea do lock (~50ms vs ~500ms via banco)
    // Permite que PDV notifique KDS/Gestor imediatamente ao iniciar/finalizar edição
    const lockChannel = supabase
      .channel(`order-lock-${tenantId}`)
      .on('broadcast', { event: 'order_locked' }, ({ payload }: { payload: Record<string, unknown> }) => {
        const orderId = payload.order_id as string | undefined;
        const lockedByName = payload.locked_by_name as string | undefined;
        const lockedBy = payload.locked_by as string | undefined;
        if (!orderId) return;
        setPedidos((prev) =>
          prev.map((p) =>
            p.id === orderId
              ? { ...p, isEditing: true, editingByUserId: lockedBy ?? p.editingByUserId ?? null, editingByName: lockedByName ?? p.editingByName ?? 'PDV' }
              : p,
          ),
        );
        console.info('[KDSContext] Broadcast lock received for order:', orderId, 'by:', lockedByName);
      })
      .on('broadcast', { event: 'order_unlocked' }, ({ payload }: { payload: Record<string, unknown> }) => {
        const orderId = payload.order_id as string | undefined;
        if (!orderId) return;
        setPedidos((prev) =>
          prev.map((p) =>
            p.id === orderId
              ? { ...p, isEditing: false, editingByUserId: null, editingByName: undefined, editingStartedAt: undefined }
              : p,
          ),
        );
        console.info('[KDSContext] Broadcast unlock received for order:', orderId);
      })
      .subscribe();

    // CAMADA 3: Canal de Broadcast para propagação instantânea da edição finalizada
    // Recebe os dados completos do pedido atualizado logo após o PDV salvar + desbloquear
    const orderUpdatesChannel = supabase
      .channel(`order-updates-${tenantId}`)
      .on('broadcast', { event: 'order_saving' }, ({ payload }: { payload: Record<string, unknown> }) => {
        const orderId = payload.order_id as string | undefined;
        if (!orderId) return;
        // Adiciona à lista persistente de salvamento (persiste até o pedido reaparecer no loadOrders)
        const pedidoLocal = pedidos.find((p) => p.id === orderId);
        addPedidoSalvando(orderId, pedidoLocal);
        // Marca isSaving no pedido local (para o card também mostrar)
        setPedidos((prev) =>
          prev.map((p) =>
            p.id === orderId ? { ...p, isSaving: true } : p,
          ),
        );
        console.info('[KDSContext] Broadcast order_saving received for order:', orderId);
        // Timeout de segurança: se o pedido não reaparecer em 10s, limpa tudo
        setTimeout(() => {
          if (pedidosSalvandoRef.current.has(orderId)) {
            removePedidoSalvando(orderId);
            setPedidos((prev) =>
              prev.map((p) =>
                p.id === orderId ? { ...p, isSaving: false } : p,
              ),
            );
          }
        }, 10000);
      })
      .on('broadcast', { event: 'order_edit_finished' }, ({ payload }: { payload: Record<string, unknown> }) => {
        const orderId = payload.order_id as string | undefined;
        const rawOrder = payload.order as DBOrder | null | undefined;
        if (!orderId) return;

        if (rawOrder) {
          // Mapear o pedido completo atualizado para o formato KDS
          const updatedPedido = dbOrderToKDS(rawOrder, stationMapRef.current);
          // NÃO remove de pedidosSalvando aqui — espera o loadOrders confirmar que o pedido reapareceu
          setPedidos((prev) =>
            prev.map((p) => {
              if (p.id !== orderId) return p;
              // Aplica dados atualizados e limpa o lock, mas mantém isSaving se ainda estiver salvando
              const aindaSalvando = pedidosSalvandoRef.current.has(orderId);
              return {
                ...updatedPedido,
                isEditing: false,
                isSaving: aindaSalvando,
                editingByUserId: null,
                editingByName: undefined,
                editingStartedAt: undefined,
              };
            }),
          );
          console.info('[KDSContext] Broadcast order_edit_finished: pedido atualizado instantaneamente', { orderId });
        } else {
          // Fallback: se não veio o pedido completo, só limpa o lock
          // isSaving continua true se o pedido ainda estiver na lista de salvamento
          setPedidos((prev) =>
            prev.map((p) =>
              p.id === orderId
                ? { ...p, isEditing: false, isSaving: pedidosSalvandoRef.current.has(orderId), editingByUserId: null, editingByName: undefined, editingStartedAt: undefined }
                : p,
            ),
          );
          console.info('[KDSContext] Broadcast order_edit_finished (sem dados): lock liberado', { orderId });
        }
      })
      .subscribe();

    channelRef.current = channel;

    // Backstop bem longo (5 min): o tempo real vem do Realtime e a re-sincronização
    // acontece no reconnect (acima) e ao voltar pra aba (abaixo). Esse intervalo é só
    // uma última rede de segurança — antes era 30s (pesava muito na quota do servidor).
    const pollInterval = setInterval(() => {
      if (consecutiveErrorsRef.current < MAX_CONSECUTIVE_ERRORS) {
        loadOrders();
      }
    }, 5 * 60 * 1000);

    // Recarrega ao voltar para a aba, mas com debounce de 2s para evitar
    // sobrescrever estado local de ações recém-executadas (entregar, etc.)
    let visibilityDebounce: ReturnType<typeof setTimeout> | null = null;
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        if (visibilityDebounce) clearTimeout(visibilityDebounce);
        visibilityDebounce = setTimeout(() => {
          if (consecutiveErrorsRef.current < MAX_CONSECUTIVE_ERRORS) {
            loadOrders();
          }
        }, 2000);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      channel.unsubscribe();
      lockChannel.unsubscribe();
      orderUpdatesChannel.unsubscribe();
      channelRef.current = null;
      kdsSubscribedOnceRef.current = false; // próxima montagem/loja recomeça do zero
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      if (visibilityDebounce) clearTimeout(visibilityDebounce);
      if (realtimeDebounceRef.current) {
        clearTimeout(realtimeDebounceRef.current);
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId]);

  // ── Efeito 2: carrega pedidos quando a sessão é resolvida ─────────────────
  // Este efeito dispara APÓS o SessaoContext terminar de restaurar a sessão.
  // Garante que loadOrders() sempre tem o sessao?.id correto.
  useEffect(() => {
    if (!user?.tenantId) return;
    if (loadingSession) return; // aguarda SessaoContext terminar

    // Sessão resolvida — atualiza ref e carrega pedidos
    sessaoIdRef.current = sessao?.id ?? null;
    setLoading(true);
    loadOrders(stationMapRef.current);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.tenantId, loadingSession, sessao?.id]);

  const addPedido = useCallback((pedido: KDSPedido) => {
    setPedidos((prev) => [pedido, ...prev]);
  }, []);

  // Helper: adiciona pedido à lista de salvamento
  const addPedidoSalvando = useCallback((orderId: string, pedido?: KDSPedido) => {
    pedidosSalvandoRef.current.add(orderId);
    if (pedido) {
      setPedidosSalvando((prev) => {
        if (prev.some((s) => s.id === orderId)) return prev;
        return [...prev, {
          id: orderId,
          numero: pedido.numero,
          numeroStr: pedido.numeroStr,
          destino: pedido.destino,
          mesaNumero: pedido.mesaNumero,
          nomeCliente: pedido.nomeCliente,
          senha: pedido.senha,
        }];
      });
    }
  }, []);

  // Helper: remove pedido da lista de salvamento
  const removePedidoSalvando = useCallback((orderId: string) => {
    pedidosSalvandoRef.current.delete(orderId);
    setPedidosSalvando((prev) => prev.filter((p) => p.id !== orderId));
  }, []);

  const updateItemStatusRemote = useCallback(async (
    orderItemId: string,
    orderId: string,
    newStatus: KDSItemStatus,
  ) => {
    recentStatusRef.current.set('i:' + orderItemId, Date.now());
    recentStatusRef.current.set('o:' + orderId, Date.now());
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      console.warn('[KDSContext] updateItemStatusRemote: no tenantId available, skipping remote update');
      return;
    }

    // ── BUG-35: Retry com backoff exponencial antes de enfileirar ──
    let lastError: Error | null = null;
    let isLocked = false;

    for (let attempt = 1; attempt <= MAX_STATUS_RETRIES; attempt++) {
      try {
        if (!navigator.onLine && attempt > 1) {
          throw new Error('offline');
        }
        const { data, error } = await invokeWithAuth('order-write', {
          body: {
            action: 'update_order_item_status',
            order_item_id: orderItemId,
            order_id: orderId,
            tenant_id: resolvedTenantId,
            status: newStatus,
          },
        });
        if (error) {
          const locked =
            error.message?.includes('bloqueado') ||
            error.message?.includes('locked') ||
            (data as Record<string, unknown>)?.code === 'order_locked';
          if (locked) {
            isLocked = true;
            console.warn('[KDSContext] updateItemStatusRemote: order locked by PDV — enfileirando para retry');
            setPedidos((prev) =>
              prev.map((p) =>
                p.id === orderId ? { ...p, isEditing: true } : p,
              ),
            );
            window.dispatchEvent(new CustomEvent('kds:order-locked', {
              detail: { orderId, message: 'Pedido em edicao pelo PDV — acao enfileirada para retry' },
            }));
            // BUG-37 FIX: Enfileira para retry — o lock vai auto-expirar no backend em 5 min
            // e o flush automatico (30s) vai eventualmente aplicar a atualizacao
            enqueuePendingStatus({
              id: `item-${orderItemId}-${Date.now()}`,
              type: 'item',
              tenantId: resolvedTenantId,
              orderItemId,
              orderId,
              newStatus,
              timestamp: Date.now(),
              retryCount: 0,
            });
            window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
              detail: { orderId, orderItemId, newStatus, locked: true, pendingCount: pendingStatusQueueRef.current.length },
            }));
            return;
          }
          throw error;
        }
        // Sucesso — sai do loop
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_STATUS_RETRIES) {
          await new Promise((r) => setTimeout(r, STATUS_RETRY_BASE_DELAY * Math.pow(2, attempt - 1)));
        }
      }
    }

    // ── Esgotou retries — enfileira para retry em background ──
    if (!isLocked && isKdsNetworkError(lastError)) {
      enqueuePendingStatus({
        id: `item-${orderItemId}-${Date.now()}`,
        type: 'item',
        tenantId: resolvedTenantId,
        orderItemId,
        orderId,
        newStatus,
        timestamp: Date.now(),
        retryCount: 0,
      });
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, orderItemId, newStatus, pendingCount: pendingStatusQueueRef.current.length },
      }));
    } else if (!isLocked) {
      console.error('[KDSContext] updateItemStatusRemote: permanent failure after retries',
        lastError?.message);
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, orderItemId, newStatus, permanent: true, pendingCount: pendingStatusQueueRef.current.length },
      }));
    }
  }, [user?.tenantId, isKdsNetworkError, enqueuePendingStatus]);

  /**
   * Atualiza o status de uma unidade individual (order_item_units).
   * Registra delivered_by_user_id quando status = entregue.
   * O backend recalcula o status do item e do pedido automaticamente.
   * O Realtime (order_item_units channel) propaga para todos os PDVs/KDS/Gestor.
   */
  const updateUnitStatusRemote = useCallback(async (
    orderItemId: string,
    orderId: string,
    unitNumber: number,
    newStatus: KDSItemStatus,
  ) => {
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      console.warn('[KDSContext] updateUnitStatusRemote: no tenantId available, skipping remote update');
      return;
    }

    // ── BUG-35: Retry com backoff exponencial antes de enfileirar ──
    let lastError: Error | null = null;
    let isLocked = false;

    for (let attempt = 1; attempt <= MAX_STATUS_RETRIES; attempt++) {
      try {
        if (!navigator.onLine && attempt > 1) {
          throw new Error('offline');
        }
        const { data, error } = await invokeWithAuth('order-write', {
          body: {
            action: 'update_unit_status',
            order_item_id: orderItemId,
            order_id: orderId,
            unit_number: unitNumber,
            tenant_id: resolvedTenantId,
            status: newStatus,
          },
        });
        if (error) {
          const locked =
            error.message?.includes('bloqueado') ||
            error.message?.includes('locked') ||
            (data as Record<string, unknown>)?.code === 'order_locked';
          if (locked) {
            isLocked = true;
            console.warn('[KDSContext] updateUnitStatusRemote: order locked by PDV — enfileirando para retry');
            setPedidos((prev) =>
              prev.map((p) =>
                p.id === orderId ? { ...p, isEditing: true } : p,
              ),
            );
            window.dispatchEvent(new CustomEvent('kds:order-locked', {
              detail: { orderId, message: 'Pedido em edicao pelo PDV — acao enfileirada para retry' },
            }));
            // BUG-37 FIX: Enfileira para retry
            enqueuePendingStatus({
              id: `unit-${orderItemId}-u${unitNumber}-${Date.now()}`,
              type: 'unit',
              tenantId: resolvedTenantId,
              orderItemId,
              orderId,
              newStatus,
              unitNumber,
              timestamp: Date.now(),
              retryCount: 0,
            });
            window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
              detail: { orderId, orderItemId, newStatus, locked: true, pendingCount: pendingStatusQueueRef.current.length },
            }));
            return;
          }
          throw error;
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_STATUS_RETRIES) {
          await new Promise((r) => setTimeout(r, STATUS_RETRY_BASE_DELAY * Math.pow(2, attempt - 1)));
        }
      }
    }

    if (!isLocked && isKdsNetworkError(lastError)) {
      enqueuePendingStatus({
        id: `unit-${orderItemId}-u${unitNumber}-${Date.now()}`,
        type: 'unit',
        tenantId: resolvedTenantId,
        orderItemId,
        orderId,
        newStatus,
        unitNumber,
        timestamp: Date.now(),
        retryCount: 0,
      });
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, orderItemId, newStatus, pendingCount: pendingStatusQueueRef.current.length },
      }));
    } else if (!isLocked) {
      console.error('[KDSContext] updateUnitStatusRemote: permanent failure after retries',
        lastError?.message);
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, orderItemId, newStatus, permanent: true, pendingCount: pendingStatusQueueRef.current.length },
      }));
    }
  }, [user?.tenantId, isKdsNetworkError, enqueuePendingStatus]);

  const updatePartStatusRemote = useCallback(async (
    orderItemPartId: string,
    orderItemId: string,
    orderId: string,
    newStatus: KDSItemStatus,
  ) => {
    recentStatusRef.current.set('i:' + orderItemId, Date.now());
    recentStatusRef.current.set('o:' + orderId, Date.now());
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      console.warn('[KDSContext] updatePartStatusRemote: no tenantId available, skipping remote update');
      return;
    }

    // ── BUG-35: Retry com backoff exponencial antes de enfileirar ──
    let lastError: Error | null = null;
    let isLocked = false;

    for (let attempt = 1; attempt <= MAX_STATUS_RETRIES; attempt++) {
      try {
        if (!navigator.onLine && attempt > 1) {
          throw new Error('offline');
        }
        const { data, error } = await invokeWithAuth('order-write', {
          body: {
            action: 'update_order_item_part_status',
            order_item_part_id: orderItemPartId,
            order_item_id: orderItemId,
            order_id: orderId,
            tenant_id: resolvedTenantId,
            new_status: newStatus,
          },
        });
        if (error) {
          const locked =
            error.message?.includes('bloqueado') ||
            error.message?.includes('locked') ||
            (data as Record<string, unknown>)?.code === 'order_locked';
          if (locked) {
            isLocked = true;
            console.warn('[KDSContext] updatePartStatusRemote: order locked by PDV — enfileirando para retry');
            setPedidos((prev) =>
              prev.map((p) =>
                p.id === orderId ? { ...p, isEditing: true } : p,
              ),
            );
            window.dispatchEvent(new CustomEvent('kds:order-locked', {
              detail: { orderId, message: 'Pedido em edicao pelo PDV — acao enfileirada para retry' },
            }));
            // BUG-37 FIX: Enfileira para retry
            enqueuePendingStatus({
              id: `part-${orderItemPartId}-${Date.now()}`,
              type: 'part',
              tenantId: resolvedTenantId,
              orderItemId,
              orderId,
              newStatus,
              partId: orderItemPartId,
              timestamp: Date.now(),
              retryCount: 0,
            });
            window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
              detail: { orderId, orderItemId, newStatus, locked: true, pendingCount: pendingStatusQueueRef.current.length },
            }));
            return;
          }
          throw error;
        }
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_STATUS_RETRIES) {
          await new Promise((r) => setTimeout(r, STATUS_RETRY_BASE_DELAY * Math.pow(2, attempt - 1)));
        }
      }
    }

    if (!isLocked && isKdsNetworkError(lastError)) {
      enqueuePendingStatus({
        id: `part-${orderItemPartId}-${Date.now()}`,
        type: 'part',
        tenantId: resolvedTenantId,
        orderItemId,
        orderId,
        newStatus,
        partId: orderItemPartId,
        timestamp: Date.now(),
        retryCount: 0,
      });
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, orderItemId, newStatus, pendingCount: pendingStatusQueueRef.current.length },
      }));
    } else if (!isLocked) {
      console.error('[KDSContext] updatePartStatusRemote: permanent failure after retries',
        lastError?.message);
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, orderItemId, newStatus, permanent: true, pendingCount: pendingStatusQueueRef.current.length },
      }));
    }
  }, [user?.tenantId, isKdsNetworkError, enqueuePendingStatus]);

  const toggleObsChecadaRemote = useCallback(async (
    orderItemId: string,
    obsText: string,
    obsIndex: number,
    checked: boolean,
    checkedByName?: string,
  ) => {
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) return;
    const { error } = await invokeWithAuth('order-write', {
      body: {
        action: 'toggle_obs_check',
        tenant_id: resolvedTenantId,
        order_item_id: orderItemId,
        observation_text: obsText,
        observation_index: obsIndex,
        checked,
        checked_by_name: checkedByName ?? null,
      },
    });
    if (error) {
      console.error('[KDSContext] toggleObsChecadaRemote error:', error.message);
    }
  }, [user?.tenantId]);

  const cancelOrderRemote = useCallback(async (orderId: string, reason?: string): Promise<{ ok: boolean; error?: string }> => {
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      return { ok: false, error: 'Tenant não identificado' };
    }
    const { error } = await invokeWithAuth('order-write', {
      body: {
        action: 'cancel_order',
        order_id: orderId,
        tenant_id: resolvedTenantId,
        reason: reason ?? null,
      },
    });
    if (error) {
      console.error('[KDSContext] cancelOrderRemote error:', error.message);
      return { ok: false, error: error.message };
    }
    // Atualiza estado local imediatamente (Realtime reconfirma depois)
    // Mantém o status atual do pedido — não força 'entregue' em cancelados
    setPedidos((prev) =>
      prev.map((p) =>
        p.id === orderId ? { ...p, isCancelled: true, cancelReason: reason } : p,
      ),
    );
    return { ok: true };
  }, [user?.tenantId]);

  /** BUG-38: Marca pedido de delivery como "Em Rota" com retry + queue (padrao BUG-35).
   * Persiste out_for_delivery_at no banco via order-write mark_out_for_delivery.
   * Em caso de falha de rede, enfileira para retry no sessionStorage. */
  const markOutForDeliveryRemote = useCallback(async (orderId: string) => {
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      console.warn('[KDSContext] markOutForDeliveryRemote: no tenantId available');
      return;
    }

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_STATUS_RETRIES; attempt++) {
      try {
        if (!navigator.onLine && attempt > 1) {
          throw new Error('offline');
        }
        const { error } = await invokeWithAuth('order-write', {
          body: {
            action: 'mark_out_for_delivery',
            order_id: orderId,
            tenant_id: resolvedTenantId,
          },
        });
        if (!error) return;
        throw error;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (attempt < MAX_STATUS_RETRIES) {
          await new Promise((r) => setTimeout(r, STATUS_RETRY_BASE_DELAY * Math.pow(2, attempt - 1)));
        }
      }
    }

    // Esgotou retries — enfileira para retry em background
    if (isKdsNetworkError(lastError)) {
      enqueuePendingStatus({
        id: `out-for-delivery-${orderId}-${Date.now()}`,
        type: 'out_for_delivery',
        tenantId: resolvedTenantId,
        orderItemId: orderId,
        orderId,
        newStatus: 'pronto' as KDSItemStatus,
        timestamp: Date.now(),
        retryCount: 0,
      });
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, action: 'em_rota', pendingCount: pendingStatusQueueRef.current.length },
      }));
    } else {
      console.error('[KDSContext] markOutForDeliveryRemote: permanent failure after retries',
        lastError?.message);
      window.dispatchEvent(new CustomEvent('kds:status-update-failed', {
        detail: { orderId, action: 'em_rota', permanent: true, pendingCount: pendingStatusQueueRef.current.length },
      }));
    }
  }, [user?.tenantId, isKdsNetworkError, enqueuePendingStatus]);

  /** Inicia edição de pedido — lock via edge function + Broadcast instantâneo */
  const startOrderEditRemote = useCallback(async (orderId: string): Promise<{ ok: boolean; lockedBy?: string; error?: string }> => {
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      return { ok: false, error: 'Tenant não identificado' };
    }
    try {
      const { data, error } = await invokeWithAuth('order-edit-lock', {
        body: {
          action: 'start',
          order_id: orderId,
          tenant_id: resolvedTenantId,
        },
      });
      if (error) {
        console.error('[KDSContext] startOrderEditRemote error:', error.message);
        return { ok: false, error: error.message };
      }
      // Status 423 = já está sendo editado por outro
      if (data?.ok === false && data?.locked_by) {
        return { ok: false, lockedBy: data.locked_by as string, error: data.message as string };
      }
      // Otimista local: marca como editing
      setPedidos((prev) =>
        prev.map((p) =>
          p.id === orderId ? { ...p, isEditing: true, editingByUserId: user?.id ?? null, editingByName: user?.nome ?? undefined } : p,
        ),
      );
      // CAMADA 2: Broadcast instantâneo para KDS/Gestor (entrega ~50ms vs ~500ms do Realtime via banco)
      const broadcastChannel = supabase.channel(`order-lock-${resolvedTenantId}`);
      broadcastChannel.send({
        type: 'broadcast',
        event: 'order_locked',
        payload: { order_id: orderId, locked_by: user?.id ?? null, locked_by_name: user?.nome ?? 'PDV' },
      }).catch((e: unknown) => console.warn('[KDSContext] broadcast order_locked failed:', e));
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }, [user?.tenantId, user?.id, user?.nome]);

  /** Finaliza edição de pedido — unlock via edge function + Broadcast instantâneo */
  const finishOrderEditRemote = useCallback(async (
    orderId: string,
    wasModified?: boolean,
    modificationsSummary?: string,
  ): Promise<{ ok: boolean; error?: string }> => {
    const resolvedTenantId = user?.tenantId ?? tenantIdRef.current;
    if (!resolvedTenantId) {
      return { ok: false, error: 'Tenant não identificado' };
    }
    try {
      const { error } = await invokeWithAuth('order-edit-lock', {
        body: {
          action: 'finish',
          order_id: orderId,
          tenant_id: resolvedTenantId,
          was_modified: wasModified ?? false,
          modifications_summary: modificationsSummary ?? null,
        },
      });
      if (error) {
        console.error('[KDSContext] finishOrderEditRemote error:', error.message);
        return { ok: false, error: error.message };
      }
      // Otimista local: remove flag de editing
      setPedidos((prev) =>
        prev.map((p) =>
          p.id === orderId ? { ...p, isEditing: false, editingByUserId: null, editingByName: undefined, editingStartedAt: undefined } : p,
        ),
      );
      // CAMADA 2: Broadcast instantâneo de unlock para KDS/Gestor
      const broadcastChannel = supabase.channel(`order-lock-${resolvedTenantId}`);
      broadcastChannel.send({
        type: 'broadcast',
        event: 'order_unlocked',
        payload: { order_id: orderId },
      }).catch((e: unknown) => console.warn('[KDSContext] broadcast order_unlocked failed:', e));
      return { ok: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }, [user?.tenantId]);

  return (
    <KDSContext.Provider value={{ pedidos, loading, addPedido, setPedidos, updateItemStatusRemote, updateUnitStatusRemote, updatePartStatusRemote, cancelOrderRemote, markOutForDeliveryRemote, toggleObsChecadaRemote, startOrderEditRemote, finishOrderEditRemote, reloadOrders: loadOrders, stationMap, pedidosSalvando, pendingStatusCount, flushPendingStatusQueue }}>
      {children}
    </KDSContext.Provider>
  );
}

export function useKDS(): KDSContextValue {
  const ctx = useContext(KDSContext);
  if (!ctx) throw new Error('useKDS must be within KDSProvider');
  return ctx;
}
import { supabase } from './supabase';
import type { TicketPayload, TicketItem } from './printUtils';

export interface OrderItemForPrint {
  item_name: string;
  quantity: number;
  skip_kds?: boolean | null;
  station_id?: string | null;
  options?: Array<{ option_name: string }>;
  observations?: Array<{ text: string }>;
  notes?: string | null;
}

export interface OrderPrintDestino {
  tipo: string;
  destination_name?: string | null;
  table_number?: number | null;
}

function destinoToString(d: OrderPrintDestino): string {
  if (d.tipo === 'table' || d.tipo === 'mesa') {
    return d.table_number ? `Mesa ${d.table_number}` : 'Mesa';
  }
  if (d.tipo === 'name' || d.tipo === 'nome') {
    return d.destination_name ?? 'Cliente';
  }
  if (d.tipo === 'password' || d.tipo === 'senha') {
    return `Senha: ${d.destination_name ?? ''}`;
  }
  if (d.tipo === 'delivery') {
    return `Delivery — ${d.destination_name ?? ''}`;
  }
  return 'Balcao';
}

function buildTicketItems(items: OrderItemForPrint[]): TicketItem[] {
  return items.map((item) => {
    const opcoes = item.options?.map((o) => o.option_name).filter(Boolean) ?? [];
    const observacoesSet = new Set<string>();
    const observacoes: string[] = [];

    const addObs = (text: string | undefined | null) => {
      const t = text?.trim();
      if (!t) return;
      if (observacoesSet.has(t)) return;
      observacoesSet.add(t);
      observacoes.push(t);
    };

    addObs(item.notes);
    item.observations?.forEach((o) => addObs(o.text));

    return {
      quantidade: item.quantity,
      nome: item.item_name,
      opcoes: opcoes.length > 0 ? opcoes : undefined,
      observacoes: observacoes.length > 0 ? observacoes : undefined,
    };
  });
}

function getTicketPayload(
  orderNumber: string,
  origin: string,
  destino: OrderPrintDestino,
  items: TicketItem[],
  extraLabel?: string,
  impressoraId?: string,
): TicketPayload {
  const numeroLimpo = orderNumber.replace(/\D/g, '');
  const numeroSequencial = numeroLimpo.slice(-4);
  const numeroTicket = parseInt(numeroSequencial, 10) || 1;

  const destinoStr = destinoToString(destino);

  return {
    numero: numeroTicket,
    destino: extraLabel ? `${destinoStr} — ${extraLabel}` : destinoStr,
    origem: origin,
    impressora_id: impressoraId || (extraLabel === 'BAR' ? 'bar' : 'cozinha'),
    itens: items,
    data_hora: new Date().toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    ...(destino.tipo === 'table' || destino.tipo === 'mesa'
      ? { mesa: String(destino.table_number ?? '') }
      : {}),
  };
}

async function enqueueTicket(
  tenantId: string,
  orderId: string,
  orderNumber: string,
  stationKey: string,
  stationLabel: string,
  payload: TicketPayload,
): Promise<void> {
  try {
    console.log(`[queueOrderForPrint] Enfileirando ticket [${stationKey}] para pedido #${orderNumber}:`, JSON.stringify({ station_label: stationLabel, itens_count: payload.itens.length, impressora_id: payload.impressora_id }));

    const { data, error } = await supabase.rpc('enqueue_print_ticket', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_order_number: orderNumber,
      p_station_key: stationKey,
      p_station_label: stationLabel,
      p_content_type: 'ticket_json',
      p_payload: payload as unknown as Record<string, unknown>,
      p_paper_style: '80mm',
    });

    if (error) {
      console.warn(`[queueOrderForPrint] RPC enqueue_print_ticket error [${stationKey}]:`, error);
    } else {
      console.log(`[queueOrderForPrint] Ticket [${stationKey}] enfileirado com sucesso:`, data);
    }
  } catch (e) {
    console.warn(`[queueOrderForPrint] Exception ao enfileirar [${stationKey}]:`, e);
  }
}

/**
 * Enfileira um ou mais tickets de impressão na fila centralizada do Supabase.
 * Separa automaticamente por estação de produção:
 *  - Agrupa itens de cozinha (skip_kds = false/null) por station_id → 1 ticket por estação
 *  - Itens sem station_id explícito vão para 'cozinha-padrao'
 *  - Itens de bar (skip_kds = true) → ticket separado na impressora 'bar'
 *
 * Funciona de qualquer dispositivo — o agente local no PC do restaurante
 * faz polling e imprime automaticamente.
 */
export async function queueOrderForPrint(
  tenantId: string,
  orderId: string,
  orderNumber: string,
  origin: string,
  items: OrderItemForPrint[],
  destino: OrderPrintDestino,
  stationToImpressoraId?: Record<string, string>,
): Promise<void> {
  console.log(`[queueOrderForPrint] INICIO pedido #${orderNumber}, ${items.length} itens, origem=${origin}`);
  items.forEach((it, idx) => {
    console.log(`[queueOrderForPrint]   item[${idx}]: ${it.item_name} qty=${it.quantity} skip_kds=${it.skip_kds} station_id=${it.station_id || 'n/a'}`);
  });

  const itensCozinha = items.filter((i) => !i.skip_kds);
  const itensBar = items.filter((i) => i.skip_kds);

  // Agrupa itens de cozinha por station_id
  const groupedByStation = new Map<string, OrderItemForPrint[]>();
  for (const item of itensCozinha) {
    const key = item.station_id ?? 'cozinha-padrao';
    if (!groupedByStation.has(key)) groupedByStation.set(key, []);
    groupedByStation.get(key)!.push(item);
  }

  console.log(`[queueOrderForPrint] Separacao: estacoes_cozinha=${groupedByStation.size}, bar=${itensBar.length}`);
  groupedByStation.forEach((stationItems, stKey) => {
    console.log(`[queueOrderForPrint]   estacao[${stKey}]: ${stationItems.length} itens`);
  });

  // ── Ticket por estação de cozinha ──────────────────────────────────────────
  for (const [estacaoId, stationItems] of groupedByStation.entries()) {
    const impressoraId = stationToImpressoraId?.[estacaoId] ?? estacaoId;

    const payload = getTicketPayload(
      orderNumber,
      origin,
      destino,
      buildTicketItems(stationItems),
      undefined,
      impressoraId,
    );

    await enqueueTicket(
      tenantId,
      orderId,
      orderNumber,
      estacaoId,
      destinoToString(destino),
      payload,
    );
  }

  // ── Ticket do bar (bebidas, sobremesas, etc.) ─────────────────
  if (itensBar.length > 0) {
    const estacaoBar = 'bar';
    const impressoraIdBar = stationToImpressoraId?.[estacaoBar] ?? 'bar';

    const payload = getTicketPayload(
      orderNumber,
      origin,
      destino,
      buildTicketItems(itensBar),
      'BAR',
      impressoraIdBar,
    );

    await enqueueTicket(
      tenantId,
      orderId,
      orderNumber,
      estacaoBar,
      `${destinoToString(destino)} — BAR`,
      payload,
    );
  }

  console.log(`[queueOrderForPrint] FIM pedido #${orderNumber}`);
}
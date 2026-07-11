import { supabase } from './supabase';
import type { TicketPayload, TicketItem } from './printUtils';

export interface OrderItemForPrint {
  item_name: string;
  quantity: number;
  skip_kds?: boolean | null;
  station_id?: string | null;
  /** ID do item no cardápio — usado para buscar partes de produção no DB (fallback) */
  item_id?: string | null;
  /** Partes de produção pré-carregadas do contexto do cardápio (evita query RLS) */
  production_parts?: Array<{ name: string; station_id: string; station_name?: string }>;
  options?: Array<{ option_name: string; obrigatorio?: boolean }>;
  observations?: Array<{ text: string }>;
  notes?: string | null;
  /** Partes de produção a destacar neste ticket (preenchido pelo queueOrderForPrint) */
  partes_destaque?: string[];
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

/** Mapeia nomes de origem do ingles para portugues */
const ORIGEM_PT: Record<string, string> = {
  cashier: 'Caixa',
  waiter: 'Garcom',
  self_service: 'Autoatendimento',
  delivery: 'Delivery',
  table: 'Mesa',
};

function buildTicketItems(items: OrderItemForPrint[]): TicketItem[] {
  return items.map((item) => {
    const opcoes = item.options
      ?.filter((o) => !!o.option_name)
      .map((o) => ({ nome: o.option_name, obrigatorio: o.obrigatorio })) ?? [];
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

    const ticketItem: TicketItem = {
      quantidade: item.quantity,
      nome: item.item_name,
      opcoes: opcoes.length > 0 ? opcoes : undefined,
      observacoes: observacoes.length > 0 ? observacoes : undefined,
    };

    if (item.partes_destaque && item.partes_destaque.length > 0) {
      ticketItem.partes_destaque = item.partes_destaque;
    }

    return ticketItem;
  });
}

function getTicketPayload(
  orderNumber: string,
  origin: string,
  destino: OrderPrintDestino,
  items: TicketItem[],
  extraLabel?: string,
  impressoraId?: string,
  estacaoNome?: string,
  total?: number,
  paraViagem?: boolean,
  senha?: string,
): TicketPayload {
  const numeroLimpo = orderNumber.replace(/\D/g, '');
  const numeroSequencial = numeroLimpo.slice(-4);
  const numeroTicket = parseInt(numeroSequencial, 10) || 1;

  const destinoStr = destinoToString(destino);

  // Preserva o impressora_id escolhido pela configuracao do sistema.
  // O agente local deve apenas resolver esse ID para IP/porta.
  const resolvedImpressoraId = impressoraId;
  const extraLabelText = extraLabel;

  const payload: TicketPayload = {
    numero: numeroTicket,
    destino: extraLabelText ? `${destinoStr} — ${extraLabelText}` : destinoStr,
    origem: ORIGEM_PT[origin] ?? origin,
    impressora_id: resolvedImpressoraId || '',
    itens: items,
    data_hora: new Date().toLocaleString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }),
    ...(destino.tipo === 'table' || destino.tipo === 'mesa'
      ? { mesa: String(destino.table_number ?? '') }
      : {}),
    ...(senha ? { senha } : {}),
    ...(estacaoNome ? { estacao: estacaoNome } : {}),
    ...(total !== undefined ? { total } : {}),
    ...(paraViagem ? { para_viagem: true } : {}),
  };

  // Inclui o ID original da impressora (do sistema) para debug/log
  // O agente tenta usar esse ID como fallback se encontrar no config.json
  if (impressoraId && impressoraId !== resolvedImpressoraId && impressoraId.length <= 20) {
    (payload as Record<string, unknown>).impressora_id_sistema = impressoraId;
  }

  return payload;
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
    const impressoraId = (payload as Record<string, unknown>).impressora_id as string | undefined;
    console.log(`[queueOrderForPrint] 📤 Enfileirando ticket [${stationKey}] para pedido #${orderNumber}:`, JSON.stringify({ station_label: stationLabel, itens_count: payload.itens.length, impressora_id: impressoraId || 'n/a' }));

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
      console.error(`[queueOrderForPrint] ❌ RPC enqueue_print_ticket error [${stationKey}]:`, JSON.stringify(error));
      return;
    }

    const queueId = data as string | null;
    console.log(`[queueOrderForPrint] ✅ Ticket [${stationKey}] enfileirado: queue_id=${queueId}`);

    // Salva impressora_id na coluna dedicada para o agente local encontrar
    // (a RPC atual não extrai do payload, fazemos o update aqui)
    if (queueId && impressoraId) {
      const { error: updateErr } = await supabase
        .from('print_queue')
        .update({ impressora_id: impressoraId })
        .eq('id', queueId);

      if (updateErr) {
        console.warn(`[queueOrderForPrint] ⚠️ Nao conseguiu salvar impressora_id=${impressoraId} na coluna:`, updateErr.message);
      } else {
        console.log(`[queueOrderForPrint] ✅ impressora_id=${impressoraId} salvo na coluna para queue_id=${queueId}`);
      }
    }
  } catch (e) {
    console.error(`[queueOrderForPrint] ❌ Exception ao enfileirar [${stationKey}]:`, e instanceof Error ? e.message : String(e));
  }
}

/**
 * Enfileira um ou mais tickets de impressao na fila centralizada do Supabase.
 * Separa automaticamente por estacao de producao:
 *  - Itens sem partes de producao: vao para a estacao principal do item (comportamento atual)
 *  - Itens com partes de producao (item_production_parts): geram 1 ticket por estacao das partes,
 *    mostrando o item com apenas as partes daquela estacao destacadas
 *  - Itens de bar (skip_kds = true) -> ticket separado na impressora 'bar'
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
  total?: number,
  paraViagem?: boolean,
  senha?: string,
): Promise<void> {
  console.log(`[queueOrderForPrint] INICIO pedido #${orderNumber}, ${items.length} itens, origem=${origin}${senha ? ', senha=' + senha : ''}`);
  items.forEach((it, idx) => {
    console.log(`[queueOrderForPrint]   item[${idx}]: ${it.item_name} qty=${it.quantity} skip_kds=${it.skip_kds} station_id=${it.station_id || 'n/a'} item_id=${it.item_id || 'n/a'}`);
  });

  const itensCozinha = items.filter((i) => !i.skip_kds);
  const itensBar = items.filter((i) => i.skip_kds);

  // — Helper: resolve impressora com fallback inteligente —
  const TODAS_ESTACOES_KEY = 'todas-estacoes';
  const IMPRESSORA_PADRAO_WINDOWS_KEY = 'impressora-padrao-windows';

  function resolveImpressoraId(estacaoId: string): string {
    // 1. Mapeamento especifico passado no parametro
    if (stationToImpressoraId?.[estacaoId]) {
      console.log(`[queueOrderForPrint] Estacao ${estacaoId} -> mapeamento explicito ${stationToImpressoraId[estacaoId]}`);
      return stationToImpressoraId[estacaoId];
    }
    // 2. Fallback geral
    if (stationToImpressoraId?.[TODAS_ESTACOES_KEY]) {
      console.log(`[queueOrderForPrint] Estacao ${estacaoId} -> fallback geral ${stationToImpressoraId[TODAS_ESTACOES_KEY]}`);
      return stationToImpressoraId[TODAS_ESTACOES_KEY];
    }
    // 3. Primeira impressora disponivel (evita usar ID da estacao como impressora)
    const ids = Object.values(stationToImpressoraId ?? {});
    const primeira = ids.find((id) => id && id !== TODAS_ESTACOES_KEY && id !== IMPRESSORA_PADRAO_WINDOWS_KEY);
    if (primeira) {
      console.log(`[queueOrderForPrint] Estacao ${estacaoId} -> fallback primeira disponivel ${primeira}`);
      return primeira;
    }
    // 4. Padrao Windows
    if (ids.includes(IMPRESSORA_PADRAO_WINDOWS_KEY)) {
      console.log(`[queueOrderForPrint] Estacao ${estacaoId} -> fallback padrao Windows`);
      return IMPRESSORA_PADRAO_WINDOWS_KEY;
    }
    // 5. Ultimo recurso
    console.warn(`[queueOrderForPrint] Estacao ${estacaoId} -> NENHUMA impressora encontrada!`);
    return estacaoId;
  }

  // — Construir partesMap: primeiro usa production_parts pre-carregadas, depois fallback DB —
  const partesMap = new Map<string, Array<{ name: string; station_id: string; station_name?: string }>>();
  // Mapa de station_id -> station_name (para o cabecalho do ticket)
  const stationNameMap = new Map<string, string>();

  // Caminho preferencial: production_parts ja vem no payload (sem RLS)
  for (const item of itensCozinha) {
    if (item.production_parts && item.production_parts.length > 0 && item.item_id) {
      if (!partesMap.has(item.item_id)) partesMap.set(item.item_id, []);
      for (const p of item.production_parts) {
        const already = partesMap.get(item.item_id)!.some(x => x.name === p.name && x.station_id === p.station_id);
        if (!already) partesMap.get(item.item_id)!.push({ name: p.name, station_id: p.station_id, station_name: p.station_name });
        if (p.station_name && p.station_id) stationNameMap.set(p.station_id, p.station_name);
      }
    }
  }

  if (partesMap.size > 0) {
    console.log(`[queueOrderForPrint] Partes pre-carregadas: ${partesMap.size} itens`);
    partesMap.forEach((parts, itemId) => {
      console.log(`[queueOrderForPrint]   ${itemId}: ${parts.map(p => `${p.name}->${p.station_id}(${p.station_name || '?'})`).join(', ')}`);
    });
  }

  // Fallback: busca DB para itens que NAO vieram com production_parts pre-carregadas
  // (ex: pedidos do garcom mobile, mesa QR, etc.)
  const idsParaFallback = itensCozinha
    .filter(i => i.item_id && (!i.production_parts || i.production_parts.length === 0))
    .map(i => i.item_id)
    .filter((id): id is string => !!id);

  if (idsParaFallback.length > 0) {
    console.log(`[queueOrderForPrint] Fallback DB para ${idsParaFallback.length} itens sem partes pre-carregadas`);
    try {
      const { data: partesData, error: partesError } = await supabase
        .from('item_production_parts')
        .select('item_id, name, station_id, sort_order')
        .eq('tenant_id', tenantId)
        .in('item_id', idsParaFallback)
        .is('deleted_at', null)
        .order('sort_order');

      if (partesError) {
        console.error('[queueOrderForPrint] Erro fallback DB:', JSON.stringify(partesError));
      } else {
        for (const p of (partesData ?? [])) {
          if (!partesMap.has(p.item_id)) partesMap.set(p.item_id, []);
          partesMap.get(p.item_id)!.push({ name: p.name, station_id: p.station_id });
        }
        console.log(`[queueOrderForPrint] Fallback DB: ${(partesData ?? []).length} registros`);
      }
    } catch (e) {
      console.error('[queueOrderForPrint] Exception fallback DB:', e instanceof Error ? e.message : String(e));
    }
  }

  // — Resolver nomes de estacoes DEPOIS de montar o partesMap completo —
  // Inclui estacoes pre-carregadas sem nome E estacoes vindas do fallback DB
  const stationsWithoutName = new Set<string>();
  stationNameMap.forEach((nome, sid) => { if (!nome) stationsWithoutName.add(sid); });
  partesMap.forEach((parts) => {
    parts.forEach((p) => {
      if (!stationNameMap.has(p.station_id) && p.station_id) stationsWithoutName.add(p.station_id);
    });
  });

  if (stationsWithoutName.size > 0) {
    console.log(`[queueOrderForPrint] Buscando nomes de ${stationsWithoutName.size} estacao(oes) no kitchen_stations...`);
    try {
      const { data: ksData, error: ksError } = await supabase
        .from('kitchen_stations')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .in('id', [...stationsWithoutName]);
      if (!ksError && ksData) {
        for (const ks of ksData) {
          if (ks.id && ks.name) {
            stationNameMap.set(ks.id, ks.name);
            partesMap.forEach((parts) => {
              parts.forEach((p) => {
                if (p.station_id === ks.id && !p.station_name) p.station_name = ks.name;
              });
            });
          }
        }
        console.log(`[queueOrderForPrint] ${ksData.length} nomes resolvidos`);
      }
    } catch (e) {
      console.warn('[queueOrderForPrint] Fallback kitchen_stations falhou:', e);
    }
  }

  console.log(`[queueOrderForPrint] stationNameMap: ${[...stationNameMap.entries()].map(([k,v]) => `${k.slice(0,8)}...=${v}`).join(', ')}`);

  // — Agrupar itens por estacao, considerando partes de producao —
  console.log(`[queueOrderForPrint] Agrupando ${itensCozinha.length} itens de cozinha por estacao...`);
  const groupedByStation = new Map<string, OrderItemForPrint[]>();

  for (const item of itensCozinha) {
    const partes = item.item_id ? partesMap.get(item.item_id) : undefined;
    console.log(`[queueOrderForPrint]   item "${item.item_name}" (id=${item.item_id?.slice(0,8)}...): partes=${partes ? partes.length : 'nenhuma'}`);

    if (!partes || partes.length === 0) {
      // Sem partes de producao: usar estacao principal do item (comportamento atual)
      const key = item.station_id ?? 'cozinha-padrao';
      console.log(`[queueOrderForPrint]     -> fallback: estacao principal ${key}`);
      if (!groupedByStation.has(key)) groupedByStation.set(key, []);
      groupedByStation.get(key)!.push(item);
    } else {
      // Com partes de producao: gerar 1 entrada por estacao das partes
      const stationsInParts = new Set(partes.map((p) => p.station_id));
      console.log(`[queueOrderForPrint]     -> split em ${stationsInParts.size} estacoes: ${[...stationsInParts].join(', ')}`);
      for (const partStationId of stationsInParts) {
        const partesNestaEstacao = partes
          .filter((p) => p.station_id === partStationId)
          .map((p) => p.name);
        const key = partStationId;
        if (!groupedByStation.has(key)) groupedByStation.set(key, []);
        groupedByStation.get(key)!.push({
          ...item,
          partes_destaque: partesNestaEstacao,
        });
      }
    }
  }

  console.log(`[queueOrderForPrint] Separacao: estacoes_cozinha=${groupedByStation.size}, bar=${itensBar.length}`);
  groupedByStation.forEach((stationItems, stKey) => {
    const partesInfo = stationItems.map((si) => {
      if (si.partes_destaque && si.partes_destaque.length > 0) {
        return `${si.item_name}[${si.partes_destaque.join(',')}]`;
      }
      return si.item_name;
    }).join('; ');
    console.log(`[queueOrderForPrint]   estacao[${stKey}]: ${stationItems.length} itens -> ${partesInfo}`);
  });

  // — Coleta todas as promessas de enfileiramento (cozinha + bar) para disparar em paralelo —
  // Isso garante que tickets de bebidas cheguem na fila ao mesmo tempo que os de cozinha,
  // evitando o delay de 1-3s que ocorria por conta do encadeamento sequencial de awaits.
  const enqueuePromises: Promise<void>[] = [];

  // — Ticket por estacao de cozinha —
  console.log(`[queueOrderForPrint] Gerando ${groupedByStation.size} ticket(s) de cozinha...`);
  for (const [estacaoId, stationItems] of groupedByStation.entries()) {
    const impressoraId = resolveImpressoraId(estacaoId);

    const estacaoNome = stationNameMap.get(estacaoId);
    const payload = getTicketPayload(
      orderNumber,
      origin,
      destino,
      buildTicketItems(stationItems),
      undefined,
      impressoraId,
      estacaoNome,
      total,
      paraViagem,
      senha,
    );

    const stationLabel = estacaoNome ? `${estacaoNome}` : destinoToString(destino);
    console.log(`[queueOrderForPrint]   Enfileirando ticket estacao=${estacaoId} (${estacaoNome || '?'}) impressora=${impressoraId} itens=${stationItems.length}`);
    enqueuePromises.push(
      enqueueTicket(
        tenantId,
        orderId,
        orderNumber,
        estacaoId,
        stationLabel,
        payload,
      ),
    );
  }

  // — Ticket do bar (bebidas, sobremesas, etc.) agrupado por station_id real —
  if (itensBar.length > 0) {
    // Agrupar itens de bar pela station_id real (vinda da categoria), nao hardcoded "bar"
    const barGroupedByStation = new Map<string, OrderItemForPrint[]>();
    for (const item of itensBar) {
      const key = item.station_id || 'bar'; // fallback "bar" so se nao tiver station_id
      if (!barGroupedByStation.has(key)) barGroupedByStation.set(key, []);
      barGroupedByStation.get(key)!.push(item);
    }

    for (const [estacaoId, barStationItems] of barGroupedByStation.entries()) {
      const impressoraIdBar = resolveImpressoraId(estacaoId);

      const estacaoNomeBar = stationNameMap.get(estacaoId);
      const payload = getTicketPayload(
        orderNumber,
        origin,
        destino,
        buildTicketItems(barStationItems),
        estacaoNomeBar || 'BAR',
        impressoraIdBar,
        estacaoNomeBar,
        total,
        paraViagem,
        senha,
      );

      const stationLabelBar = estacaoNomeBar
        ? `${destinoToString(destino)} — ${estacaoNomeBar}`
        : `${destinoToString(destino)} — BAR`;

      enqueuePromises.push(
        enqueueTicket(
          tenantId,
          orderId,
          orderNumber,
          estacaoId,
          stationLabelBar,
          payload,
        ),
      );
    }
  }

  // Dispara todos os enqueues em paralelo — cozinha e bar ao mesmo tempo
  await Promise.all(enqueuePromises);

  console.log(`[queueOrderForPrint] FIM pedido #${orderNumber}`);
}

import { supabase } from '@/lib/supabase';
import type { KDSPedido, KDSItem } from '@/types/kds';

/** Payload esperado pelo agente local ERPOS v2 (POST /print) */
export interface AgentPrintPayload {
  numero: number;
  destino: string;
  origem: string;
  impressora_id: string;
  itens: AgentPrintItem[];
  data_hora?: string;
  observacao_geral?: string;
}

export interface AgentPrintItem {
  quantidade: number;
  nome: string;
  categoria?: string;
  opcoes: string[];
  observacoes: string[];
}

function destinoStr(pedido: KDSPedido): string {
  if (pedido.destino === 'mesa') {
    if (pedido.mesaNumero != null) {
      return pedido.nomeCliente
        ? `Mesa ${pedido.mesaNumero} · ${pedido.nomeCliente}`
        : `Mesa ${pedido.mesaNumero}`;
    }
    return pedido.nomeCliente ?? 'Mesa';
  }
  if (pedido.destino === 'nome') return pedido.nomeCliente ?? '';
  if (pedido.destino === 'senha') return `Senha ${pedido.senha ?? ''}`;
  if (pedido.destino === 'delivery') return `Delivery · ${pedido.nomeCliente ?? ''}`;
  return 'Balcão';
}

function buildAgentItem(item: KDSItem): AgentPrintItem {
  const opcoes = item.opcoes?.map((o) => o.opcaoNome).filter(Boolean) ?? [];
  const observacoesSet = new Set<string>();
  const observacoes: string[] = [];

  const addObs = (text: string | undefined | null) => {
    const t = text?.trim();
    if (!t) return;
    if (observacoesSet.has(t)) return;
    observacoesSet.add(t);
    observacoes.push(t);
  };

  (item.observacoes ?? []).forEach((obs) => addObs(obs));
  addObs(item.observacaoLivre);

  return {
    quantidade: item.quantidade,
    nome: item.nome,
    categoria: item.categoriaNome ?? undefined,
    opcoes,
    observacoes,
  };
}

/** Monta o payload JSON que o agente local espera */
export function buildKDSAgentPayload(pedido: KDSPedido): AgentPrintPayload {
  return {
    numero: pedido.numero,
    destino: destinoStr(pedido),
    origem: pedido.origem,
    impressora_id: 'cozinha', // fallback do agente resolve a impressora real
    itens: pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds).map(buildAgentItem),
    data_hora: new Date(pedido.criadoEm).toLocaleString('pt-BR'),
  };
}

/**
 * Monta payloads separados por estação.
 * Retorna um array de { estacaoId, payload } para que cada
 * estação receba seu próprio ticket de impressão.
 */
export function buildKDSAgentPayloadsByStation(
  pedido: KDSPedido,
): Array<{ estacaoId: string; payload: AgentPrintPayload }> {
  const itensCozinha = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);

  // Agrupa por estação
  const byStation = new Map<string, KDSItem[]>();
  for (const item of itensCozinha) {
    // item.estacao pode ser o nome ou o ID — usamos como chave de agrupamento
    const key = item.estacao ?? 'cozinha-padrao';
    if (!byStation.has(key)) byStation.set(key, []);
    byStation.get(key)!.push(item);
  }

  const results: Array<{ estacaoId: string; payload: AgentPrintPayload }> = [];
  for (const [estacaoId, itens] of byStation.entries()) {
    results.push({
      estacaoId,
      payload: {
        numero: pedido.numero,
        destino: destinoStr(pedido),
        origem: pedido.origem,
        impressora_id: estacaoId, // o agente resolve pelo ID
        itens: itens.map(buildAgentItem),
        data_hora: new Date(pedido.criadoEm).toLocaleString('pt-BR'),
      },
    });
  }
  return results;
}

const PRINTED_KEY = 'erpos_kds_printed_ids';

function getPrintedIds(): Set<string> {
  try {
    const raw = sessionStorage.getItem(PRINTED_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function savePrintedId(id: string) {
  try {
    const ids = getPrintedIds();
    ids.add(id);
    sessionStorage.setItem(PRINTED_KEY, JSON.stringify([...ids]));
  } catch {
    // sessionStorage pode estar cheio — ignora silenciosamente
  }
}

/** Envia o pedido para o agente local de impressão.
 *  Retorna true se o agente respondeu sucesso, false se não respondeu (agente offline).
 */
export async function sendToLocalAgent(payload: AgentPrintPayload): Promise<boolean> {
  try {
    const res = await fetch('http://127.0.0.1:9876/print', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) {
      console.warn('[KDS AutoPrint] Agente respondeu erro:', res.status, await res.text());
      return false;
    }
    const data = await res.json();
    if (data.success) {
      console.info('[KDS AutoPrint] Ticket impresso com sucesso via agente local:', data);
      return true;
    }
    console.warn('[KDS AutoPrint] Agente respondeu sem sucesso:', data);
    return false;
  } catch (err) {
    console.warn('[KDS AutoPrint] Agente local não respondeu:', (err as Error)?.message);
    return false;
  }
}

/** Envia os tickets para a fila centralizada do Supabase (print_queue), 1 por estação.
 *  Funciona de qualquer dispositivo — o agente local no PC da cozinha faz polling e imprime.
 */
export async function sendToCentralizedQueue(
  pedido: KDSPedido,
  tenantId: string,
): Promise<boolean> {
  try {
    const payloadsByStation = buildKDSAgentPayloadsByStation(pedido);

    if (payloadsByStation.length === 0) {
      // Nenhum item de cozinha — usa fallback genérico
      const payload = buildKDSAgentPayload(pedido);
      await supabase.rpc('enqueue_print_ticket', {
        p_tenant_id: tenantId,
        p_order_id: pedido.id,
        p_order_number: String(pedido.numero),
        p_station_key: 'cozinha-padrao',
        p_station_label: 'Cozinha',
        p_content_type: 'ticket_json',
        p_payload: payload as unknown as Record<string, unknown>,
        p_paper_style: '80mm',
      });
      return true;
    }

    let anyOk = false;
    for (const { estacaoId, payload } of payloadsByStation) {
      const { data, error } = await supabase.rpc('enqueue_print_ticket', {
        p_tenant_id: tenantId,
        p_order_id: pedido.id,
        p_order_number: String(pedido.numero),
        p_station_key: estacaoId,
        p_station_label: estacaoId,
        p_content_type: 'ticket_json',
        p_payload: payload as unknown as Record<string, unknown>,
        p_paper_style: '80mm',
      });

      if (error) {
        console.warn(`[KDS AutoPrint] Erro ao enfileirar estação [${estacaoId}]:`, error);
      } else {
        console.log(`[KDS AutoPrint] Ticket enfileirado estação [${estacaoId}]:`, data);
        anyOk = true;
      }
    }
    return anyOk;
  } catch (e) {
    console.warn('[KDS AutoPrint] Exception ao enfileirar no Supabase:', e);
    return false;
  }
}

/** Imprime pedido se ainda não foi impresso. Dedup via sessionStorage.
 *  Tenta agente local primeiro; se falhar, enfilera no Supabase (funciona de qualquer dispositivo).
 */
export async function autoPrintPedidoIfNeeded(
  pedido: KDSPedido,
  opts?: { enabled?: boolean; tenantId?: string },
): Promise<boolean> {
  if (opts?.enabled === false) return false;
  if (pedido.status !== 'novo') return false;
  // Não imprime pedidos simulados (mock)
  if (pedido.id.startsWith('kds-')) return false;
  // Não imprime pedidos cancelados
  if (pedido.isCancelled) return false;
  // Não imprime se não tem itens de cozinha
  const itensCozinha = pedido.itens.filter((i) => !i.semPreparo && !i.skip_kds);
  if (itensCozinha.length === 0) return false;

  const ids = getPrintedIds();
  if (ids.has(pedido.id)) return false;

  const payload = buildKDSAgentPayload(pedido);

  // Tentativa 1: agente local (só funciona no PC da impressora)
  const okLocal = await sendToLocalAgent(payload);
  if (okLocal) {
    savePrintedId(pedido.id);
    return true;
  }

  // Tentativa 2: fila centralizada (funciona de qualquer dispositivo)
  if (opts?.tenantId) {
    const okQueue = await sendToCentralizedQueue(pedido, opts.tenantId);
    if (okQueue) {
      savePrintedId(pedido.id);
      return true;
    }
  }

  return false;
}

/** Reseta o registro de impressões (útil ao fechar/reabrir KDS) */
export function clearPrintedIds() {
  try {
    sessionStorage.removeItem(PRINTED_KEY);
  } catch {
    // ignore
  }
}
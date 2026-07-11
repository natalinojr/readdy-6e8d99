import { supabase } from '@/lib/supabase';
import type { KDSPedido } from '@/types/kds';
import type { Impressora, MapaEstacoes } from '@/contexts/ImpressorasContext';
import { sendToPrinter, type TicketPayload, type TicketItem, type PrintResult } from '@/lib/printUtils';
import { queueOrderForPrint, type OrderItemForPrint, type OrderPrintDestino } from '@/lib/printOrderQueue';

/**
 * Impressão manual (reimpressão) de pedido no Gestor de Pedidos.
 *
 * Caminho principal (reprintPedidoGestor): re-executa o MESMO fluxo de impressão
 * que roda quando o pedido chega — enfileira na print_queue via
 * queueOrderForPrint (1 ticket por estação de cozinha, partes de produção,
 * ticket de bar para itens sem preparo) e, para delivery/retirada, também o
 * COMPROVANTE que vai grampeado na sacola (espelho do delivery-write
 * create_delivery_order). O agente local no PC da loja imprime tudo.
 *
 * Fallback (printPedidoGestorLocal): ticket único direto no agente local /
 * janela do navegador, usado se o enfileiramento falhar (ex.: sem rede).
 */

// origem do front → origem do banco (mesma que o useOrderSubmit passa na criação)
const ORIGEM_TO_DB: Record<string, string> = {
  caixa: 'cashier',
  garcom: 'waiter',
  mesa: 'table',
  autoatendimento: 'self_service',
  delivery: 'delivery',
};

const ORIGEM_PT: Record<string, string> = {
  caixa: 'Caixa',
  garcom: 'Garçom',
  mesa: 'Mesa (QR Code)',
  autoatendimento: 'Autoatendimento',
  delivery: 'Delivery',
};

function fmtPrice(v: number): string {
  return 'R$ ' + v.toFixed(2).replace('.', ',');
}

function destinoStr(p: KDSPedido): string {
  if (p.destino === 'mesa') {
    if (p.mesaNumero != null) {
      return p.nomeCliente ? `Mesa ${p.mesaNumero} · ${p.nomeCliente}` : `Mesa ${p.mesaNumero}`;
    }
    return p.nomeCliente ?? 'Mesa';
  }
  if (p.destino === 'nome') return p.nomeCliente ?? 'Cliente';
  if (p.destino === 'senha') return `Senha ${p.participantToken ?? p.senha ?? ''}`;
  if (p.destino === 'delivery') return `Delivery · ${p.nomeCliente ?? ''}`;
  return 'Balcão';
}

/** Mapa nome-da-estação → id (KDSItem só carrega o NOME da estação) */
async function fetchStationNameToId(tenantId: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await supabase.rpc('fn_get_kitchen_stations', { p_tenant_id: tenantId });
    (data ?? []).forEach((s: { id: string; name: string }) => {
      if (s.id && s.name) map.set(s.name.trim().toLowerCase(), s.id);
    });
  } catch {
    /* sem estações resolvidas o queueOrderForPrint cai no fallback 'cozinha-padrao' */
  }
  return map;
}

/** Comprovante de entrega/retirada — espelho do bloco do delivery-write create_delivery_order */
async function enqueueDeliveryReceipt(pedido: KDSPedido, tenantId: string): Promise<void> {
  const isRetirada = !pedido.deliveryAddress;
  const orderNumber = pedido.numeroStr ?? String(pedido.numero);
  const ticketNum = parseInt(orderNumber.replace(/\D/g, '').slice(-4), 10) || pedido.numero || 1;

  const receiptItems: Array<Record<string, unknown>> = pedido.itens.map((item) => {
    const qty = item.quantidade || 1;
    const basePrice = item.item_price ?? 0;
    const receiptItem: Record<string, unknown> = {
      quantidade: qty,
      nome: `${item.nome} - ${fmtPrice(basePrice * qty)}`,
    };
    const opts = (item.opcoes ?? [])
      .filter((o) => o.opcaoNome)
      .map((o) => {
        const addP = o.additional_price ?? 0;
        return addP > 0 ? `${o.opcaoNome} +${fmtPrice(addP)}` : `+ ${o.opcaoNome}`;
      });
    if (opts.length > 0) receiptItem.opcoes = opts;
    return receiptItem;
  });

  const subtotal = pedido.itens.reduce((acc, i) => {
    const optsTotal = (i.opcoes ?? []).reduce((a, o) => a + (o.additional_price ?? 0), 0);
    return acc + ((i.item_price ?? 0) + optsTotal) * (i.quantidade || 1);
  }, 0);
  const deliveryFee = pedido.deliveryFee ?? 0;

  const obsGeralParts = [
    'Cliente: ' + (pedido.nomeCliente || 'Nao informado'),
    pedido.customerPhone ? 'Telefone: ' + pedido.customerPhone : '',
    isRetirada ? 'RETIRADA NA LOJA' : (pedido.deliveryAddress ? 'Endereço: ' + pedido.deliveryAddress : ''),
    deliveryFee > 0 ? 'Taxa de entrega: ' + fmtPrice(deliveryFee) : '',
    'Subtotal: ' + fmtPrice(subtotal),
    'TOTAL: ' + fmtPrice(pedido.totalAmount ?? 0),
    'Pagamento: ' + (pedido.paymentMethodName || (pedido.isPaid ? 'Pago' : 'Nao informado')),
  ].filter(Boolean);

  await supabase.rpc('enqueue_print_ticket', {
    p_tenant_id: tenantId,
    p_order_id: pedido.id,
    p_order_number: orderNumber,
    p_station_key: 'delivery-receipt',
    p_station_label: 'Comprovante',
    p_content_type: 'ticket_json',
    p_payload: {
      numero: ticketNum,
      destino: (pedido.nomeCliente || 'Cliente') + ' - ' + (isRetirada ? 'Retirada' : 'Entrega'),
      origem: isRetirada ? 'retirada' : 'delivery',
      estacao: isRetirada ? 'COMPROVANTE RETIRADA' : 'COMPROVANTE ENTREGA',
      itens: receiptItems,
      data_hora: new Date().toLocaleString('pt-BR', {
        timeZone: 'America/Sao_Paulo',
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }),
      observacao_geral: obsGeralParts.join('\n'),
    },
    p_paper_style: '80mm',
  });
}

export interface ReprintOptions {
  pedido: KDSPedido;
  tenantId: string;
  /** mapaEstacoes do ImpressorasContext — estação → impressora */
  mapaEstacoes: MapaEstacoes;
  /** Impressora do ponto "Gestor de Pedidos" — usada só no fallback local */
  impressoraFallback?: Impressora;
}

/**
 * Reimprime o pedido exatamente como na chegada: tickets por estação de
 * cozinha (com partes de produção), ticket de bar e — quando delivery —
 * o comprovante de entrega/retirada. Tudo via print_queue centralizada.
 */
export async function reprintPedidoGestor(opts: ReprintOptions): Promise<PrintResult> {
  const { pedido, tenantId, mapaEstacoes, impressoraFallback } = opts;

  // Sem tenant (sessão ainda carregando) não dá pra enfileirar — ticket local
  if (!tenantId) return printPedidoGestorLocal(pedido, impressoraFallback);

  try {
    const nameToId = await fetchStationNameToId(tenantId);
    const resolveStationId = (nome?: string): string | undefined =>
      nome ? nameToId.get(nome.trim().toLowerCase()) : undefined;

    const items: OrderItemForPrint[] = pedido.itens.map((item) => {
      const productionParts = (item.partes ?? [])
        .map((p) => ({
          name: p.nome,
          station_id: p.estacaoId ?? resolveStationId(p.estacao) ?? '',
          station_name: p.estacao,
        }))
        .filter((p) => !!p.station_id);

      return {
        item_name: item.nome,
        quantity: item.quantidade,
        skip_kds: item.skip_kds || item.semPreparo,
        station_id: resolveStationId(item.estacao) ?? null,
        item_id: item.menuItemId ?? null,
        production_parts: productionParts.length > 0 ? productionParts : undefined,
        options: (item.opcoes ?? [])
          .filter((o) => o.opcaoNome)
          .map((o) => ({ option_name: o.opcaoNome, obrigatorio: o.obrigatorio })),
        observations: (item.observacoes ?? []).map((text) => ({ text })),
        notes: item.observacaoLivre ?? null,
      };
    });

    const destino: OrderPrintDestino = {
      tipo: pedido.destino,
      destination_name: pedido.nomeCliente ?? pedido.participantToken ?? pedido.senha ?? null,
      table_number: pedido.mesaNumero ?? null,
    };

    const senha = pedido.participantToken ?? pedido.senha;

    await queueOrderForPrint(
      tenantId,
      pedido.id,
      pedido.numeroStr ?? String(pedido.numero),
      ORIGEM_TO_DB[pedido.origem] ?? pedido.origem,
      items,
      destino,
      mapaEstacoes,
      pedido.totalAmount,
      undefined,
      senha,
    );

    // Delivery/retirada: também reimprime o comprovante que vai grampeado
    if (pedido.origem === 'delivery') {
      try {
        await enqueueDeliveryReceipt(pedido, tenantId);
      } catch (e) {
        console.warn('[reprintPedidoGestor] Falha ao enfileirar comprovante:', e);
      }
    }

    return { success: true };
  } catch (e) {
    console.warn('[reprintPedidoGestor] Fila indisponível, caindo no ticket local:', e);
    return printPedidoGestorLocal(pedido, impressoraFallback);
  }
}

// ─── Fallback: ticket único direto no agente local / navegador ────────────────

function buildTicketItems(pedido: KDSPedido): TicketItem[] {
  return pedido.itens.map((item) => {
    const opcoes = (item.opcoes ?? [])
      .filter((o) => !!o.opcaoNome)
      .map((o) => ({ nome: o.opcaoNome, obrigatorio: o.obrigatorio }));

    const observacoesSet = new Set<string>();
    const observacoes: string[] = [];
    const addObs = (text: string | undefined | null) => {
      const t = text?.trim();
      if (!t || observacoesSet.has(t)) return;
      observacoesSet.add(t);
      observacoes.push(t);
    };
    (item.observacoes ?? []).forEach(addObs);
    addObs(item.observacaoLivre);

    return {
      quantidade: item.quantidade,
      nome: item.nome,
      opcoes: opcoes.length > 0 ? opcoes : undefined,
      observacoes: observacoes.length > 0 ? observacoes : undefined,
    };
  });
}

export function buildGestorTicketPayload(pedido: KDSPedido, impressora?: Impressora): TicketPayload {
  const obsLines: string[] = [];
  if (pedido.deliveryAddress) obsLines.push(`Endereço: ${pedido.deliveryAddress}`);
  if (pedido.paymentMethodName && !pedido.isPaid) obsLines.push(`Pagar na entrega: ${pedido.paymentMethodName}`);
  if (pedido.notes?.trim()) obsLines.push(pedido.notes.trim());

  const senha = pedido.participantToken ?? pedido.senha;

  const payload: TicketPayload = {
    numero: pedido.numero,
    destino: destinoStr(pedido),
    origem: ORIGEM_PT[pedido.origem] ?? pedido.origem,
    impressora_id: impressora?.id ?? '',
    itens: buildTicketItems(pedido),
    data_hora: new Date(pedido.criadoEm).toLocaleString('pt-BR'),
    ...(pedido.destino === 'mesa' && pedido.mesaNumero != null ? { mesa: String(pedido.mesaNumero) } : {}),
    ...(senha ? { senha } : {}),
    ...(pedido.totalAmount > 0 ? { total: pedido.totalAmount } : {}),
    ...(obsLines.length > 0 ? { observacao_geral: obsLines.join('\n') } : {}),
  };

  // O agente resolve impressora_id pelo config.json dele; se o ID do sistema
  // não estiver lá, ele usa o ip/port do corpo como fallback.
  if (impressora?.ip) {
    (payload as unknown as Record<string, unknown>).ip = impressora.ip.trim();
    (payload as unknown as Record<string, unknown>).port = 9100;
  }

  return payload;
}

/** HTML usado APENAS no fallback do navegador (janela de impressão). */
export function buildGestorFallbackHTML(pedido: KDSPedido): string {
  const numStr = String(pedido.numero).padStart(4, '0');
  const origem = ORIGEM_PT[pedido.origem] ?? pedido.origem;
  const garcomLine = pedido.garcomNome ? `<p>Gar&ccedil;om: ${pedido.garcomNome}</p>` : '';
  const addressLine = pedido.deliveryAddress ? `<p>📍 ${pedido.deliveryAddress}</p>` : '';
  const paymentLine = pedido.paymentMethodName && !pedido.isPaid
    ? `<p style="font-weight:bold;border:1px solid #000;padding:4px;margin:4px 0;">&#128179; Pagar na entrega: ${pedido.paymentMethodName}</p>`
    : '';
  const notesLine = pedido.notes?.trim() ? `<p><strong>OBS:</strong> ${pedido.notes.trim()}</p>` : '';
  const totalLine = pedido.totalAmount > 0
    ? `<p style="text-align:right;font-size:14px;font-weight:bold;">TOTAL: ${pedido.totalAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</p>`
    : '';
  const itensHtml = pedido.itens.map((i) => {
    const opts = i.opcoes?.length ? `<div style="padding-left:10px;font-size:11px">${i.opcoes.map((o) => `${o.obrigatorio ? '' : '+ '}${o.opcaoNome}`).join(', ')}</div>` : '';
    const obsList = [...(i.observacoes ?? []), ...(i.observacaoLivre?.trim() ? [i.observacaoLivre.trim()] : [])];
    const obs = obsList.length ? `<div style="color:red;font-weight:bold;font-size:11px">${obsList.map((o) => '&#9888; ' + o).join('<br/>')}</div>` : '';
    return `<div style="margin:4px 0"><strong>${i.quantidade}x ${i.nome}</strong>${i.categoriaNome ? ` <small>(${i.categoriaNome})</small>` : ''}${opts}${obs}</div>`;
  }).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Pedido #${numStr}</title><style>body{font-family:monospace;font-size:12px;padding:16px}h2{margin:0 0 4px}hr{border:1px dashed #000}p{margin:2px 0;font-size:11px}</style></head><body><h2>Pedido #${numStr}</h2><p>${destinoStr(pedido)} &mdash; ${origem}</p>${garcomLine}${addressLine}${paymentLine}${notesLine}<hr/>${itensHtml}<hr/>${totalLine}<small>${new Date(pedido.criadoEm).toLocaleString('pt-BR')}</small></body></html>`;
}

/** Fallback: ticket único (formato cozinha) direto no agente local → navegador. */
export async function printPedidoGestorLocal(pedido: KDSPedido, impressora?: Impressora): Promise<PrintResult> {
  const payload = buildGestorTicketPayload(pedido, impressora);
  const html = buildGestorFallbackHTML(pedido);
  return sendToPrinter(html, impressora, payload);
}

import type { KDSPedido } from '@/types/kds';
import type { Impressora } from '@/contexts/ImpressorasContext';
import { sendToPrinter, type TicketPayload, type TicketItem, type PrintResult } from '@/lib/printUtils';

/**
 * Impressão manual de pedido no Gestor de Pedidos.
 *
 * Monta o MESMO payload JSON estruturado que a cozinha usa (KDS auto-print /
 * print_queue ticket_json) para que o agente local formate o ticket em ESC/POS
 * — antes era enviado HTML cru, que a térmica imprimia como código-fonte.
 * O HTML continua existindo apenas como fallback do navegador (janela de
 * impressão), usado quando não há agente/impressora de rede.
 */

const ORIGEM_PT: Record<string, string> = {
  caixa: 'Caixa',
  garcom: 'Garçom',
  mesa: 'Mesa (QR Code)',
  autoatendimento: 'Autoatendimento',
  delivery: 'Delivery',
};

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

function buildTicketItems(pedido: KDSPedido): TicketItem[] {
  // Impressão manual da comanda: inclui TODOS os itens (inclusive bebidas/sem
  // preparo), diferente do auto-print da cozinha que filtra itens de cozinha.
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
  // Observação geral: endereço de entrega, pagamento na entrega e notas do pedido
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

/**
 * Imprime a comanda do pedido no formato do ticket de cozinha.
 * 1. Agente local com JSON estruturado (ESC/POS formatado, silencioso)
 * 2. Fallback: janela de impressão do navegador com o HTML
 */
export async function printPedidoGestor(pedido: KDSPedido, impressora?: Impressora): Promise<PrintResult> {
  const payload = buildGestorTicketPayload(pedido, impressora);
  const html = buildGestorFallbackHTML(pedido);
  return sendToPrinter(html, impressora, payload);
}

import type { PedidoRecente } from '@/types/pdv';
import type { Impressora } from '@/contexts/ImpressorasContext';
import { sendToPrinter, type PrintResult } from '@/lib/printUtils';
import { ehCancelado } from '@/lib/pedidosRegras';
import { ehGrupo, itensAtivos, moedaTexto, rotuloNumero } from './textoPedido';

// Resumo do pedido (impressão na impressora de "Pedidos"). Copiado de buildPedidoHTML/printPedidoResumo do
// PedidoDetalheModal antigo, com três acertos: sem item cancelado, número curto e "CANCELADO"/"CORTESIA"
// no rodapé (antes um pedido cancelado saía como "PENDENTE").

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function situacaoDoPagamento(p: PedidoRecente): string {
  if (ehCancelado(p)) return 'CANCELADO';
  if (p.cortesia) return 'CORTESIA';
  return p.pago ? 'PAGO' : 'PENDENTE';
}

export function buildResumoHTML(p: PedidoRecente, agora: Date = new Date()): string {
  const itens = itensAtivos(p).map((i) =>
    `<tr><td>${i.quantidade}x ${esc(i.nome)}</td><td style="text-align:right">${moedaTexto(i.preco * i.quantidade)}</td></tr>`,
  ).join('');
  const rotulo = rotuloNumero(p);
  const titulo = `${ehGrupo(p) ? 'PEDIDOS' : 'PEDIDO'} ${rotulo}`;
  const quando = agora.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"/><title>${esc(titulo)}</title>
<style>* { margin:0; padding:0; box-sizing:border-box; } body { font-family: Arial, sans-serif; padding: 12px; width: 320px; }
h2 { text-align:center; margin-bottom:4px; font-size:18px; } p { margin:2px 0; }
table { width:100%; border-collapse:collapse; } td { padding:3px 0; font-size:13px; }
.total { border-top:2px solid #000; font-weight:bold; font-size:15px; } .center { text-align:center; }
.divider { border-top:1px dashed #999; margin:8px 0; } .small { font-size:11px; color:#666; }</style></head>
<body><h2>${esc(titulo)}</h2><p class="center small">${esc(quando)}</p>
<div class="divider"></div><table>${itens}</table><div class="divider"></div>
<table><tr class="total"><td>TOTAL</td><td style="text-align:right">${moedaTexto(p.total)}</td></tr></table>
<div class="divider"></div><p class="center">${situacaoDoPagamento(p)}</p></body></html>`;
}

/** Imprime o resumo. Quem chama trata o resultado: erro só quando não imprimiu nem abriu a janela do navegador. */
export async function imprimirResumo(p: PedidoRecente, impressora: Impressora | undefined): Promise<PrintResult> {
  return sendToPrinter(buildResumoHTML(p), impressora, undefined, { paperWidthPx: 320 });
}

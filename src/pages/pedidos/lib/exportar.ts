import type { PedidoRecente } from '@/types/pdv';
import { destinoStr } from './conversores';
import { DB_STATUS_LABEL, STATUS_LABEL, origemLabelFor } from '../components/utils';

// Planilha (CSV) dos pedidos que estão na tela. Saiu do page.tsx; mesmas colunas de antes.
// - Resumo: uma linha por pedido. Detalhado: uma linha por item (item cancelado fica de fora).
// - Pedido "pagos juntos" vira uma linha por pedido real (o card do grupo não existe na planilha).
// - Ponto e vírgula e BOM UTF-8 para o Excel em português abrir sem bagunçar acento.

/** Célula de CSV: texto que começa com = + - @ vira fórmula no Excel (o nome do cliente do QR é
 *  digitado por ele) — prefixa com ' para abrir como texto. */
export function celulaCsv(v: string | number): string {
  const t = String(v);
  const seguro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return `"${seguro.replace(/"/g, '""')}"`;
}

const dinheiro = (v: number) => v.toFixed(2).replace('.', ',');
const texto = (v: number | undefined) => (v !== undefined ? String(v) : '');

/** Pedidos de verdade: o card de "pagos juntos" é trocado pelos pedidos que ele reúne. */
function individuais(pedidos: PedidoRecente[]): PedidoRecente[] {
  return pedidos.flatMap((p) => (p.pedidosOriginais?.length ? p.pedidosOriginais : [p]));
}

const CABECALHO_RESUMO = ['Nº Pedido', 'Código', 'Sessão', 'Data', 'Hora', 'Status', 'Pagamento', 'Destino', 'Origem', 'Operador', 'Itens', 'SLA Espera (min)', 'SLA Cozinha (min)', 'Tempo Total (min)', 'Total (R$)'];
const CABECALHO_DETALHADO = ['Nº Pedido', 'Código', 'Sessão', 'Data', 'Hora', 'Status', 'Pagamento', 'Destino', 'Origem', 'Operador', 'Item', 'Qtd', 'Preço Unit (R$)', 'Subtotal Item (R$)', 'Opções', 'Observação', 'Estação', 'SLA Espera (min)', 'SLA Cozinha (min)', 'Tempo Total (min)', 'Total Pedido (R$)'];

/** Colunas que abrem as duas planilhas (nº, código, sessão, data, hora, status, pagamento, destino, origem, operador). */
function colunasDoPedido(p: PedidoRecente): string[] {
  return [
    String(p.numero).padStart(4, '0'), p.numeroCodigo ?? '', p.session_number ?? '', p.dataPedido ?? '', p.criadoEm,
    DB_STATUS_LABEL[p.status] ?? STATUS_LABEL[p.status] ?? p.status,
    p.pago ? 'Pago' : 'Pendente',
    destinoStr(p), origemLabelFor(p), p.garcomNome ?? '',
  ];
}

/** O texto do CSV (sem o BOM). Separado do download para dar para testar. */
export function montarCsv(pedidos: PedidoRecente[], modo: 'resumo' | 'detalhado'): string {
  const lista = individuais(pedidos);
  let cabecalho: string[];
  const linhas: string[][] = [];

  if (modo === 'detalhado') {
    cabecalho = CABECALHO_DETALHADO;
    for (const p of lista) {
      for (const item of p.itensDetalhes.filter((i) => !i.cancelado)) {
        linhas.push([
          ...colunasDoPedido(p),
          item.nome, String(item.quantidade),
          dinheiro(item.preco),
          dinheiro(item.preco * item.quantidade),
          item.opcoes.join(' | '), item.observacao ?? '', item.estacao ?? '',
          texto(p.slaEspera), texto(p.slaCozinha), texto(p.tempoAberto),
          dinheiro(p.total),
        ]);
      }
    }
  } else {
    cabecalho = CABECALHO_RESUMO;
    for (const p of lista) {
      linhas.push([
        ...colunasDoPedido(p),
        p.itensDetalhes.filter((i) => !i.cancelado).map((i) => `${i.quantidade}x ${i.nome}`).join(' | '),
        texto(p.slaEspera), texto(p.slaCozinha), texto(p.tempoAberto),
        dinheiro(p.total),
      ]);
    }
  }
  return [cabecalho, ...linhas].map((l) => l.map(celulaCsv).join(';')).join('\n');
}

/** Nome do arquivo: o rótulo do período sem barra, espaço nem seta ("01/10 → 04/10" → "01-10_04-10"). */
export function nomeArquivoCsv(modo: 'resumo' | 'detalhado', rotuloPeriodo: string, hoje: string): string {
  const rotulo = rotuloPeriodo.replace(/\//g, '-').replace(/[\s→]+/g, '_').replace(/[\\:*?"<>|]/g, '');
  return `${modo === 'detalhado' ? 'pedidos_detalhado' : 'pedidos'}_${rotulo}_${hoje}.csv`;
}

/** Baixa a planilha dos pedidos que estão na tela. `hoje` = AAAA-MM-DD de Brasília (vai no nome do arquivo). */
export function baixarPedidosCsv(pedidos: PedidoRecente[], modo: 'resumo' | 'detalhado', rotuloPeriodo: string, hoje: string): void {
  const csv = montarCsv(pedidos, modo);
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeArquivoCsv(modo, rotuloPeriodo, hoje);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

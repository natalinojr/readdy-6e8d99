import { ifoodShipping } from '@/lib/ifoodShipping';

// Ao conectar uma loja aos pedidos do iFood, traz sozinho os pedidos dos últimos 15 dias (dono, 06/10).
// Usa a ação order_backfill da ifood-shipping: lista as vendas do período (API de Vendas, app de Finanças) e lê o
// detalhe de cada pedido no iFood (itens e cliente; o iFood guarda ~15 dias). Só grava ifood_orders/itens — não
// mexe em cozinha nem estoque. Cada chamada importa até 150; repete enquanto sobrar.
export async function trazerPedidosAntigos(tenantId: string, dias = 15): Promise<{ importados: number; semDetalhe: number; erro?: string }> {
  let importados = 0, semDetalhe = 0;
  for (let k = 0; k < 4; k++) {
    const r = await ifoodShipping<{ importados?: number; sem_detalhe?: number; restantes?: number }>('order_backfill', tenantId, { dias });
    if (!r.success) return { importados, semDetalhe, erro: r.error };
    importados += Number(r.importados ?? 0);
    semDetalhe += Number(r.sem_detalhe ?? 0);
    if (!Number(r.restantes ?? 0)) break;
  }
  return { importados, semDetalhe };
}

export const textoAntigos = (r: { importados: number; semDetalhe: number; erro?: string }) =>
  r.erro ? `Não deu para trazer os pedidos antigos agora (${r.erro}).`
    : r.importados > 0 ? `${r.importados} ${r.importados === 1 ? 'pedido' : 'pedidos'} dos últimos 15 dias trazidos com os itens.`
    : 'Os pedidos dos últimos 15 dias já estavam aqui.';

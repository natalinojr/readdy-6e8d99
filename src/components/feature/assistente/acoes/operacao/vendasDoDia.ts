// Contas do dia usadas pelas ações "Vendas do dia" e "Fechamento do dia" (mesmos filtros de
// fn_get_sales_report). Arquivo à parte para os dois painéis não divergirem.
import { supabase } from '@/lib/supabase';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { precosEfetivosDosItens, type ItemDeVenda, type PedidoParaPreco } from '@/lib/precoItensVenda';

// Hora (0–23) em Brasília de um timestamp.
const horaBrasilia = (ts: string) => Number(new Date(ts).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' }));

/** Pedidos pagos do dia (mesmos filtros de fn_get_sales_report). null = não deu para ler. */
export async function pedidosPagosDoDia(tenantId: string, dia: string): Promise<{ id: string; created_at: string; total_amount: number }[] | null> {
  const todos: { id: string; created_at: string; total_amount: number }[] = [];
  const LOTE = 1000;
  for (let de = 0; ; de += LOTE) {
    const { data, error } = await supabase.from('orders').select('id, created_at, total_amount')
      .eq('tenant_id', tenantId).eq('is_paid', true).neq('status', 'cancelled')
      .eq('is_training', false).eq('is_draft', false).is('ifood_order_id', null)
      .gte('created_at', `${dia}T00:00:00-03:00`).lte('created_at', `${dia}T23:59:59-03:00`)
      .order('created_at').range(de, de + LOTE - 1);
    if (error) return null;
    todos.push(...((data ?? []) as typeof todos));
    if ((data ?? []).length < LOTE) return todos;
  }
}

export function porHora(pedidos: { created_at: string; total_amount: number }[] | null): number[] | null {
  if (!pedidos) return null;
  const horas = Array<number>(24).fill(0);
  for (const o of pedidos) horas[horaBrasilia(o.created_at)] += Number(o.total_amount ?? 0);
  return horas;
}

/** Faturamento por categoria do cardápio (itens não cancelados), maior primeiro. null = não deu para ler. */
export async function porCategoria(tenantId: string, ids: string[]): Promise<{ nome: string; valor: number; qtd: number }[] | null> {
  const mapa = new Map<string, { valor: number; qtd: number }>();
  type Item = ItemDeVenda & { menu_items: { menu_categories: { name: string } | null } | null };
  // Em pedaços: muitos ids num .in() estouram o tamanho da URL.
  for (let i = 0; i < ids.length; i += 150) {
    const lote = ids.slice(i, i + 150);
    // subtotal e canal de cada pedido decidem se o item_price já traz os adicionais (delivery grava só o preço base).
    const { data: peds, error: pedErr } = await supabase.from('orders').select('id, subtotal, origin_type')
      .in('id', lote).eq('tenant_id', tenantId);
    if (pedErr) return null;
    const pedidos = new Map<string, PedidoParaPreco>(((peds ?? []) as Array<PedidoParaPreco & { id: string }>).map((p) => [p.id, p]));
    // Paginado: o PostgREST corta em 1000 linhas sem avisar e 150 pedidos com vários itens podem passar disso.
    // O tipo gerado do join vem como array; na prática o PostgREST devolve objeto (FK para um) — daí o cast.
    const { rows, error } = await fetchAllRows<Item>((de, ate) =>
      supabase.from('order_items')
        .select('order_id, item_price, quantity, order_item_options(additional_price), menu_items!order_items_item_id_fkey(menu_categories(name))')
        .in('order_id', lote).eq('tenant_id', tenantId).neq('status', 'cancelled')
        .order('id').range(de, ate) as unknown as PromiseLike<{ data: Item[] | null; error: { message: string } | null }>);
    if (error) return null;
    const precos = precosEfetivosDosItens(rows, pedidos);
    rows.forEach((oi, k) => {
      const nome = oi.menu_items?.menu_categories?.name ?? 'Sem categoria';
      const c = mapa.get(nome) ?? { valor: 0, qtd: 0 };
      c.valor += precos[k] * (oi.quantity ?? 1);
      c.qtd += oi.quantity ?? 1;
      mapa.set(nome, c);
    });
  }
  return [...mapa.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.valor - a.valor);
}

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import { useAuth } from '@/contexts/AuthContext';
import { getPeriodDates } from '@/lib/dateUtils';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { precosEfetivosDosItens, type ItemDeVenda, type PedidoParaPreco } from '@/lib/precoItensVenda';

export interface CategoryRevenue {
  category_name: string;
  total_qty: number;
  total_revenue: number;
}

export interface HourlyRevenue {
  hour: number;
  revenue: number;
  orders: number;
}

export interface ItemRevenue {
  item_name: string;
  total_qty: number;
  total_revenue: number;
}

export interface VisaoGeralExtrasData {
  by_category: CategoryRevenue[];
  by_hour: HourlyRevenue[];
  /** Itens mais vendidos (por quantidade) — pedidos do sistema, sem os do iFood (ifood_repasse). */
  by_item: ItemRevenue[];
}

interface ItemRow extends ItemDeVenda {
  item_name: string | null;
  menu_items?: { category_id: string; menu_categories: { name: string } | null } | null;
}

// Soma por nome do item (o mesmo produto vendido em pedidos diferentes vira uma linha).
// `precos` = preço unitário efetivo de cada item (com os adicionais do delivery), na mesma ordem.
function porItem(items: { item_name: string | null; quantity: number | null }[], precos: number[]): ItemRevenue[] {
  const m = new Map<string, ItemRevenue>();
  items.forEach((oi, i) => {
    const nome = (oi.item_name ?? '').trim() || 'Sem nome';
    const k = nome.toLowerCase();
    const g = m.get(k) ?? { item_name: nome, total_qty: 0, total_revenue: 0 };
    g.total_qty += oi.quantity ?? 1;
    g.total_revenue += precos[i] * (oi.quantity ?? 1);
    m.set(k, g);
  });
  return [...m.values()].sort((a, b) => b.total_qty - a.total_qty || b.total_revenue - a.total_revenue);
}

// Hora (0–23) de Brasília — getHours() usa o fuso do aparelho e muda a hora do pico conforme quem olha.
const FORMATO_HORA = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: '2-digit', hourCycle: 'h23' });
const horaBrasilia = (ts: string) => Number(FORMATO_HORA.format(new Date(ts))) % 24;

const SELECT_ITENS = 'order_id, item_name, item_price, quantity, item_id, order_item_options(additional_price), menu_items!order_items_item_id_fkey(category_id, menu_categories(name))';
const SELECT_ITENS_SEM_CATEGORIA = 'order_id, item_name, item_price, quantity, order_item_options(additional_price)';
// Pedidos por consulta (.in() grande estoura a URL) e consultas em paralelo.
const LOTE_PEDIDOS = 150;
const LOTES_EM_PARALELO = 4;

/**
 * Itens (não cancelados) dos pedidos, em lotes de pedidos e com paginação dentro de cada lote: o PostgREST
 * corta em 1000 linhas sem avisar, e 30 dias de uma loja já passam disso.
 */
async function buscarItens(tenantId: string, orderIds: string[], select: string): Promise<{ rows: ItemRow[]; error: { message: string } | null }> {
  const lotes: string[][] = [];
  for (let i = 0; i < orderIds.length; i += LOTE_PEDIDOS) lotes.push(orderIds.slice(i, i + LOTE_PEDIDOS));
  const rows: ItemRow[] = [];
  for (let g = 0; g < lotes.length; g += LOTES_EM_PARALELO) {
    const rs = await Promise.all(lotes.slice(g, g + LOTES_EM_PARALELO).map((ids) =>
      fetchAllRows<ItemRow>((a, b) =>
        supabase
          .from('order_items')
          .select(select)
          .in('order_id', ids)
          .eq('tenant_id', tenantId)
          // Exclui itens cancelados: o pedido não é cancelado, mas um item dele pode ter sido.
          // Sem isso o faturamento por categoria diverge do líquido (total_amount já exclui cancelados).
          .neq('status', 'cancelled')
          .order('id')
          .range(a, b) as unknown as PromiseLike<{ data: ItemRow[] | null; error: { message: string } | null }>,
      ),
    ));
    for (const r of rs) {
      if (r.error) return { rows, error: r.error };
      rows.push(...r.rows);
    }
  }
  return { rows, error: null };
}

/** `intervalo` (ISO) substitui o período — ex.: o dia da loja no Dashboard (sessões abertas no dia). */
export function useVisaoGeralExtras(periodo: string, intervalo?: { from: string; to: string } | null) {
  const { user } = useAuth();
  const [data, setData] = useState<VisaoGeralExtrasData | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user?.tenantId) return;
    setLoading(true);
    try {
      // Usa getPeriodDates para respeitar o período selecionado (Hoje, Ontem, 7 dias, etc.)
      // Retorna strings ISO com timezone Brasília já prontas para o Supabase
      const { from: fromTs, to: toTs } = intervalo ?? getPeriodDates(periodo);

      // Paginado: o PostgREST corta em 1000 linhas sem avisar e uma loja passa disso em poucos dias.
      const { rows: orders, error: ordersErr } = await fetchAllRows<{ id: string; created_at: string; total_amount: number | string | null; subtotal: number | string | null; origin_type: string | null }>((de, ate) =>
        supabase
          .from('orders')
          .select('id, created_at, total_amount, subtotal, origin_type')
          .eq('tenant_id', user.tenantId)
          .not('status', 'in', '(cancelled,draft)')
          .eq('is_training', false)
          .eq('is_draft', false)
          // Venda = pedido pago (igual ao faturamento do Dashboard); aberto/não pago não entra na categoria nem na hora.
          .eq('is_paid', true)
          // Pedido do iFood pago pelo repasse: a venda é contada pelo iFood (faturamento, card iFood),
          // não aqui. Sem isso, categorias e "Mais vendidos (sem iFood)" somavam os itens do iFood.
          .eq('ifood_repasse', false)
          .gte('created_at', fromTs)
          .lte('created_at', toTs)
          .order('id')
          .range(de, ate),
      );

      if (ordersErr) throw new Error(ordersErr.message);

      const orderIds = orders.map((o) => o.id);
      // subtotal/canal de cada pedido: decidem se o item_price já traz os adicionais (precoItemPedido.ts)
      const pedidos = new Map<string, PedidoParaPreco>(orders.map((o) => [o.id, { subtotal: o.subtotal, origin_type: o.origin_type }]));

      // Vendas por hora (hora de Brasília)
      const hourMap: Record<number, HourlyRevenue> = {};
      orders.forEach((o) => {
        const h = horaBrasilia(o.created_at);
        if (!hourMap[h]) hourMap[h] = { hour: h, revenue: 0, orders: 0 };
        hourMap[h].revenue += Number(o.total_amount ?? 0);
        hourMap[h].orders += 1;
      });
      const byHour: HourlyRevenue[] = Array.from({ length: 24 }, (_, h) =>
        hourMap[h] ?? { hour: h, revenue: 0, orders: 0 }
      );

      // Vendas por categoria
      let byCategory: CategoryRevenue[] = [];
      let byItem: ItemRevenue[] = [];
      if (orderIds.length > 0) {
        const comCategoria = await buscarItens(user.tenantId, orderIds, SELECT_ITENS);
        let items = comCategoria.rows;
        const semJoin = !!comCategoria.error;
        if (semJoin) {
          // Fallback sem join de categoria
          const fb = await buscarItens(user.tenantId, orderIds, SELECT_ITENS_SEM_CATEGORIA);
          if (fb.error) throw new Error(fb.error.message);
          items = fb.rows;
        }

        // item_price × quantidade com os adicionais do delivery (combo nasce com 0): sem isso a soma das
        // categorias fica abaixo do subtotal dos pedidos.
        const precos = precosEfetivosDosItens(items, pedidos);
        const catMap: Record<string, CategoryRevenue> = {};
        items.forEach((oi, i) => {
          const catName = (semJoin ? null : oi.menu_items?.menu_categories?.name) ?? 'Sem categoria';
          if (!catMap[catName]) catMap[catName] = { category_name: catName, total_qty: 0, total_revenue: 0 };
          catMap[catName].total_qty += oi.quantity ?? 1;
          catMap[catName].total_revenue += precos[i] * (oi.quantity ?? 1);
        });
        byCategory = Object.values(catMap).sort((x, y) => y.total_revenue - x.total_revenue);
        byItem = porItem(items, precos);
      }

      setData({ by_category: byCategory, by_hour: byHour, by_item: byItem });
    } catch (e) {
      console.error('[useVisaoGeralExtras]', e);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [user?.tenantId, periodo, intervalo?.from, intervalo?.to]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load(); }, [load]);

  return { data, loading, reload: load };
}
